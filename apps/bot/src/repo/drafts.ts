import { and, type Db, drafts, eq, medications, scheduleSlots, schedules } from '@ovimuu/db';
import type { DraftMed, MedicationRecord, Question } from '../domain/draft.ts';

/** What the bot is waiting for on an open draft. */
export type Awaiting =
  /** Confirmation card is shown (or nothing pending). */
  | null
  /** A clarification question; `textInput` = waiting for a typed answer ("Другое", "Своё время"). */
  | { type: 'question'; question: Question; textInput: boolean }
  /** User pressed "Исправить" and should describe the change. */
  | { type: 'correction' };

export interface DraftPayload {
  meds: DraftMed[];
  awaiting: Awaiting;
  /** Incremented on every prompt; buttons carry it so stale ones are ignored. */
  seq: number;
  /** Number of corrections, for /stats. */
  editCount: number;
}

export interface Draft {
  id: number;
  userId: number;
  payload: DraftPayload;
}

const toDraft = (row: typeof drafts.$inferSelect): Draft => ({
  id: row.id,
  userId: row.userId,
  payload: row.payload as DraftPayload,
});

/** The user's open, non-expired add-draft. Expired drafts are marked as such. */
export async function getOpenDraft(db: Db, userId: number): Promise<Draft | null> {
  const [row] = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.status, 'open'), eq(drafts.kind, 'add')));
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.update(drafts).set({ status: 'expired' }).where(eq(drafts.id, row.id));
    return null;
  }
  return toDraft(row);
}

export async function createDraft(db: Db, userId: number, payload: DraftPayload): Promise<Draft> {
  const [row] = await db.insert(drafts).values({ userId, kind: 'add', payload }).returning();
  return toDraft(row!);
}

export async function saveDraft(db: Db, draft: Draft): Promise<void> {
  await db.update(drafts).set({ payload: draft.payload }).where(eq(drafts.id, draft.id));
}

export async function closeDraft(
  db: Db,
  draftId: number,
  status: 'cancelled' | 'confirmed',
): Promise<void> {
  await db.update(drafts).set({ status }).where(eq(drafts.id, draftId));
}

/** Creates medications + schedules + slots and confirms the draft, atomically. */
export async function confirmDraft(
  db: Db,
  draft: Draft,
  records: MedicationRecord[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const r of records) {
      const [medication] = await tx
        .insert(medications)
        .values({ userId: draft.userId, ...r.medication })
        .returning({ id: medications.id });
      const [schedule] = await tx
        .insert(schedules)
        .values({ medicationId: medication!.id, ...r.schedule })
        .returning({ id: schedules.id });
      if (r.slots.length > 0) {
        await tx
          .insert(scheduleSlots)
          .values(r.slots.map((s) => ({ scheduleId: schedule!.id, ...s })));
      }
    }
    await tx.update(drafts).set({ status: 'confirmed' }).where(eq(drafts.id, draft.id));
  });
}
