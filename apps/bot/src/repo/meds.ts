import {
  and,
  type Db,
  drafts,
  eq,
  gte,
  inArray,
  intakes,
  isNull,
  lt,
  medications,
  ne,
  scheduleSlots,
  schedules,
} from '@ovimuu/db';
import type { ChangeIntent, ChangeParams, MedState } from '../domain/change.ts';

/** Non-deleted medications with a non-completed schedule (active or paused). */
export async function listActiveMeds(db: Db, userId: number): Promise<MedState[]> {
  const rows = await db
    .select({ med: medications, schedule: schedules, slot: scheduleSlots })
    .from(medications)
    .innerJoin(schedules, eq(schedules.medicationId, medications.id))
    .innerJoin(scheduleSlots, eq(scheduleSlots.scheduleId, schedules.id))
    .where(
      and(
        eq(medications.userId, userId),
        isNull(medications.deletedAt),
        ne(schedules.status, 'completed'),
      ),
    )
    .orderBy(medications.id, scheduleSlots.id);

  const byMed = new Map<number, MedState>();
  for (const { med, schedule: s, slot } of rows) {
    let state = byMed.get(med.id);
    if (!state) {
      state = {
        medicationId: med.id,
        scheduleId: s.id,
        name: med.name,
        doseAmount: med.doseAmount === null ? null : Number(med.doseAmount),
        doseUnit: med.doseUnit,
        unitsPerIntake: Number(med.unitsPerIntake),
        unitForm: med.unitForm,
        notes: med.notes,
        frequencyType: s.frequencyType,
        everyNDays: s.everyNDays,
        weekdays: s.weekdays,
        startDate: s.startDate,
        endDate: s.endDate,
        status: s.status,
        pausedUntil: s.pausedUntil,
        slots: [],
      };
      byMed.set(med.id, state);
    }
    // One schedule per medication in practice; extra schedules are ignored here.
    if (s.id === state.scheduleId) {
      state.slots.push({
        time: slot.time,
        anchor: slot.anchor,
        anchorOffsetMin: slot.anchorOffsetMin,
      });
    }
  }
  return [...byMed.values()];
}

/** Applies a confirmed change. Intakes are rebuilt by the caller (regenerateForUser). */
export async function applyMedChange(
  db: Db,
  s: MedState,
  intent: ChangeIntent,
  p: ChangeParams,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    switch (intent) {
      case 'change_time': {
        // Old slots go away; past intakes keep their history (slot_id → NULL).
        await tx.delete(scheduleSlots).where(eq(scheduleSlots.scheduleId, s.scheduleId));
        await tx.insert(scheduleSlots).values(
          (p.slots ?? []).map((x) => ({
            scheduleId: s.scheduleId,
            time: x.time,
            anchor: x.time ? null : x.anchor,
            anchorOffsetMin: x.time ? 0 : (x.anchorOffsetMin ?? 0),
          })),
        );
        return;
      }
      case 'change_amount':
        await tx
          .update(medications)
          .set({ unitsPerIntake: String(p.unitsPerIntake) })
          .where(eq(medications.id, s.medicationId));
        return;
      case 'pause':
        await tx
          .update(schedules)
          .set({ status: 'paused', pausedUntil: p.pauseIndefinite ? null : p.pauseUntil })
          .where(eq(schedules.id, s.scheduleId));
        return;
      case 'resume':
        await tx
          .update(schedules)
          .set({ status: 'active', pausedUntil: null })
          .where(eq(schedules.id, s.scheduleId));
        return;
      case 'complete':
        await tx
          .update(schedules)
          .set({ status: 'completed' })
          .where(eq(schedules.medicationId, s.medicationId));
        return;
      case 'delete':
        // Soft delete: history and XP stay; the medication disappears everywhere.
        await tx
          .update(schedules)
          .set({ status: 'completed' })
          .where(eq(schedules.medicationId, s.medicationId));
        await tx
          .update(medications)
          .set({ deletedAt: now })
          .where(eq(medications.id, s.medicationId));
        return;
    }
  });
}

/** Today's unanswered scheduled intakes of a medication. */
export async function findOpenIntakesInRange(
  db: Db,
  userId: number,
  medicationId: number,
  from: Date,
  to: Date,
) {
  return db
    .select({
      id: intakes.id,
      scheduledAt: intakes.scheduledAt,
      status: intakes.status,
      reminderId: intakes.reminderId,
    })
    .from(intakes)
    .where(
      and(
        eq(intakes.userId, userId),
        eq(intakes.medicationId, medicationId),
        inArray(intakes.status, ['pending', 'snoozed']),
        gte(intakes.scheduledAt, from),
        lt(intakes.scheduledAt, to),
      ),
    );
}

/** "Выпила магний" with nothing scheduled today: an ad-hoc taken intake (no XP). */
export async function createAdHocTaken(
  db: Db,
  userId: number,
  medicationId: number,
  now: Date,
): Promise<number> {
  const [row] = await db
    .insert(intakes)
    .values({ userId, medicationId, scheduledAt: now, status: 'taken', confirmedAt: now })
    .returning({ id: intakes.id });
  return row!.id;
}

export async function deleteIntake(db: Db, intakeId: number): Promise<void> {
  await db.delete(intakes).where(eq(intakes.id, intakeId));
}

export async function getIntakeReminderIds(db: Db, intakeIds: number[]): Promise<number[]> {
  if (intakeIds.length === 0) return [];
  const rows = await db
    .select({ reminderId: intakes.reminderId })
    .from(intakes)
    .where(inArray(intakes.id, intakeIds));
  return [...new Set(rows.map((r) => r.reminderId).filter((id): id is number => id !== null))];
}

// ---------- Change drafts (drafts.kind = 'change') ----------

export interface MarkedIntake {
  intakeId: number;
  /** Status before marking; null for an ad-hoc intake created by the mark. */
  prevStatus: 'pending' | 'snoozed' | null;
}

export interface ChangePayload {
  intent: ChangeIntent | 'mark_taken';
  /** Medication ids to choose from when the target is ambiguous. */
  candidates: number[];
  medicationId: number | null;
  params: ChangeParams;
  awaiting: 'target' | 'slot' | 'slot_typed' | 'units' | 'units_typed' | 'pause' | 'confirm' | null;
  seq: number;
  /** mark_taken only: what was marked, for the 10-minute undo. */
  marked?: MarkedIntake[];
  markedAt?: string;
  undone?: boolean;
  // For "ИИ ошибся" only; stripped from closed drafts by the hourly job.
  inputText?: string;
  intentResult?: unknown;
  feedbackSent?: boolean;
}

export interface ChangeDraft {
  id: number;
  payload: ChangePayload;
}

export async function getOpenChangeDraft(db: Db, userId: number): Promise<ChangeDraft | null> {
  const [row] = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.status, 'open'), eq(drafts.kind, 'change')));
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.update(drafts).set({ status: 'expired' }).where(eq(drafts.id, row.id));
    return null;
  }
  return { id: row.id, payload: row.payload as ChangePayload };
}

export async function getChangeDraftById(
  db: Db,
  userId: number,
  id: number,
): Promise<(ChangeDraft & { status: string }) | null> {
  const [row] = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.id, id), eq(drafts.userId, userId), eq(drafts.kind, 'change')));
  return row ? { id: row.id, status: row.status, payload: row.payload as ChangePayload } : null;
}

/** Opens a change draft, cancelling any previous open one (only one at a time). */
export async function createChangeDraft(
  db: Db,
  userId: number,
  payload: ChangePayload,
  status: 'open' | 'confirmed' = 'open',
): Promise<ChangeDraft> {
  await db
    .update(drafts)
    .set({ status: 'cancelled' })
    .where(and(eq(drafts.userId, userId), eq(drafts.status, 'open'), eq(drafts.kind, 'change')));
  const [row] = await db
    .insert(drafts)
    .values({ userId, kind: 'change', payload, status })
    .returning({ id: drafts.id });
  return { id: row!.id, payload };
}

export async function saveChangeDraft(
  db: Db,
  draft: ChangeDraft,
  status?: 'open' | 'confirmed' | 'cancelled',
): Promise<void> {
  await db
    .update(drafts)
    .set({ payload: draft.payload, ...(status && { status }) })
    .where(eq(drafts.id, draft.id));
}
