import {
  and,
  type Db,
  eq,
  gt,
  inArray,
  intakes,
  isNotNull,
  isNull,
  lt,
  lte,
  medications,
  reminders,
} from '@ovimuu/db';
import { type IntakeStatus, LATE_LIMIT_MIN } from '../domain/reminders.ts';

export type Reminder = typeof reminders.$inferSelect;

export interface ReminderItem {
  intakeId: number;
  status: IntakeStatus;
  scheduledAt: Date;
  confirmedAt: Date | null;
  name: string;
  doseAmount: number | null;
  doseUnit: string | null;
  unitsPerIntake: number;
  unitForm: string | null;
}

/** Scheduled intakes that are due, not yet reminded, and not too late to remind. */
export async function findDueIntakes(db: Db, now: Date) {
  const earliest = new Date(now.getTime() - LATE_LIMIT_MIN * 60_000);
  return db
    .select({ id: intakes.id, userId: intakes.userId, scheduledAt: intakes.scheduledAt })
    .from(intakes)
    .where(
      and(
        eq(intakes.status, 'pending'),
        isNull(intakes.reminderId),
        isNotNull(intakes.scheduleId),
        lte(intakes.scheduledAt, now),
        gt(intakes.scheduledAt, earliest),
      ),
    );
}

/**
 * Creates a reminder and attaches the intakes to it — before anything is sent, so a
 * repeated job run cannot send a second message. Returns null if nothing was claimed.
 */
export async function claimReminder(
  db: Db,
  userId: number,
  scheduledAt: Date,
  intakeIds: number[],
): Promise<Reminder | null> {
  return db.transaction(async (tx) => {
    const [reminder] = await tx.insert(reminders).values({ userId, scheduledAt }).returning();
    const claimed = await tx
      .update(intakes)
      .set({ reminderId: reminder!.id })
      .where(and(inArray(intakes.id, intakeIds), isNull(intakes.reminderId)))
      .returning({ id: intakes.id });
    if (claimed.length === 0) {
      await tx.delete(reminders).where(eq(reminders.id, reminder!.id));
      return null;
    }
    return reminder!;
  });
}

export async function updateReminder(
  db: Db,
  id: number,
  patch: Partial<Omit<Reminder, 'id' | 'userId'>>,
): Promise<void> {
  await db.update(reminders).set(patch).where(eq(reminders.id, id));
}

export const closeReminder = (db: Db, id: number, now: Date) =>
  updateReminder(db, id, { closedAt: now, repeatAt: null, snoozedUntil: null });

export async function getReminder(db: Db, id: number, userId: number): Promise<Reminder | null> {
  const [row] = await db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, id), eq(reminders.userId, userId)));
  return row ?? null;
}

export async function getReminderItems(db: Db, reminderId: number): Promise<ReminderItem[]> {
  const rows = await db
    .select({
      intakeId: intakes.id,
      status: intakes.status,
      scheduledAt: intakes.scheduledAt,
      confirmedAt: intakes.confirmedAt,
      name: medications.name,
      doseAmount: medications.doseAmount,
      doseUnit: medications.doseUnit,
      unitsPerIntake: medications.unitsPerIntake,
      unitForm: medications.unitForm,
    })
    .from(intakes)
    .innerJoin(medications, eq(medications.id, intakes.medicationId))
    .where(eq(intakes.reminderId, reminderId))
    .orderBy(intakes.id);
  return rows.map((r) => ({
    ...r,
    doseAmount: r.doseAmount === null ? null : Number(r.doseAmount),
    unitsPerIntake: Number(r.unitsPerIntake),
  }));
}

export async function findDueRepeats(db: Db, now: Date): Promise<Reminder[]> {
  return db
    .select()
    .from(reminders)
    .where(
      and(lte(reminders.repeatAt, now), isNull(reminders.closedAt), isNull(reminders.snoozedUntil)),
    );
}

/** Atomically advances the repeat counter; false if another run already did it. */
export async function claimRepeat(
  db: Db,
  r: Reminder,
  nextRepeatAt: Date | null,
): Promise<boolean> {
  const updated = await db
    .update(reminders)
    .set({ repeatAt: nextRepeatAt, repeatsSent: r.repeatsSent + 1 })
    .where(and(eq(reminders.id, r.id), eq(reminders.repeatsSent, r.repeatsSent)))
    .returning({ id: reminders.id });
  return updated.length > 0;
}

export async function findDueSnoozes(db: Db, now: Date): Promise<Reminder[]> {
  return db
    .select()
    .from(reminders)
    .where(and(lte(reminders.snoozedUntil, now), isNull(reminders.closedAt)));
}

/** Atomically clears the snooze; false if another run already took it. */
export async function claimSnooze(db: Db, r: Reminder): Promise<boolean> {
  const updated = await db
    .update(reminders)
    .set({ snoozedUntil: null })
    .where(and(eq(reminders.id, r.id), isNotNull(reminders.snoozedUntil)))
    .returning({ id: reminders.id });
  return updated.length > 0;
}

/** Sets status for the given intakes, but only those currently in one of `from`. */
export async function setIntakeStatus(
  db: Db,
  intakeIds: number[],
  from: readonly IntakeStatus[],
  status: IntakeStatus,
  confirmedAt: Date | null,
): Promise<void> {
  if (intakeIds.length === 0) return;
  await db
    .update(intakes)
    .set({ status, confirmedAt })
    .where(and(inArray(intakes.id, intakeIds), inArray(intakes.status, [...from])));
}

/** End of day: unanswered intakes before `before` become not_marked (≠ skipped). */
export async function markNotMarked(db: Db, userId: number, before: Date): Promise<number> {
  const updated = await db
    .update(intakes)
    .set({ status: 'not_marked' })
    .where(
      and(
        eq(intakes.userId, userId),
        inArray(intakes.status, ['pending', 'snoozed']),
        lt(intakes.scheduledAt, before),
      ),
    )
    .returning({ id: intakes.id });
  return updated.length;
}
