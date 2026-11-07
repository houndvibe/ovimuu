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
  ne,
  scheduleSlots,
  schedules,
  users,
} from '@ovimuu/db';
import type { PlannedIntake, ScheduleInput } from '../domain/intakes.ts';

/** Non-completed schedules of the user with their slots. */
export async function loadSchedules(db: Db, userId: number): Promise<ScheduleInput[]> {
  const rows = await db
    .select({ schedule: schedules, slot: scheduleSlots })
    .from(schedules)
    .innerJoin(medications, eq(medications.id, schedules.medicationId))
    .innerJoin(scheduleSlots, eq(scheduleSlots.scheduleId, schedules.id))
    .where(and(eq(medications.userId, userId), ne(schedules.status, 'completed')));

  const byId = new Map<number, ScheduleInput>();
  for (const { schedule: s, slot } of rows) {
    let entry = byId.get(s.id);
    if (!entry) {
      entry = {
        id: s.id,
        medicationId: s.medicationId,
        frequencyType: s.frequencyType,
        everyNDays: s.everyNDays,
        weekdays: s.weekdays,
        startDate: s.startDate,
        endDate: s.endDate,
        status: s.status,
        pausedUntil: s.pausedUntil,
        slots: [],
      };
      byId.set(s.id, entry);
    }
    entry.slots.push({
      id: slot.id,
      time: slot.time,
      anchor: slot.anchor,
      anchorOffsetMin: slot.anchorOffsetMin,
    });
  }
  return [...byId.values()];
}

/** Inserts planned intakes; existing (slot_id, scheduled_at) pairs are left untouched. */
export async function insertIntakes(
  db: Db,
  userId: number,
  planned: PlannedIntake[],
): Promise<number> {
  if (planned.length === 0) return 0;
  const inserted = await db
    .insert(intakes)
    .values(planned.map((p) => ({ userId, ...p })))
    .onConflictDoNothing({ target: [intakes.slotId, intakes.scheduledAt] })
    .returning({ id: intakes.id });
  return inserted.length;
}

/**
 * Deletes future scheduled intakes that are still untouched: pending and no reminder sent.
 * taken / skipped / not_marked / snoozed are never touched.
 */
export async function deleteFuturePending(db: Db, userId: number, now: Date): Promise<number> {
  const deleted = await db
    .delete(intakes)
    .where(
      and(
        eq(intakes.userId, userId),
        eq(intakes.status, 'pending'),
        gt(intakes.scheduledAt, now),
        isNull(intakes.reminderId),
        isNotNull(intakes.scheduleId),
      ),
    )
    .returning({ id: intakes.id });
  return deleted.length;
}

/** Status housekeeping for the user's local `today`. */
export async function updateScheduleStatuses(db: Db, userId: number, today: string) {
  const userMeds = db
    .select({ id: medications.id })
    .from(medications)
    .where(eq(medications.userId, userId));
  // Course is over: the end date has passed.
  await db
    .update(schedules)
    .set({ status: 'completed' })
    .where(
      and(
        inArray(schedules.medicationId, userMeds),
        ne(schedules.status, 'completed'),
        lt(schedules.endDate, today),
      ),
    );
  // Pause is over: the resume date has come.
  await db
    .update(schedules)
    .set({ status: 'active', pausedUntil: null })
    .where(
      and(
        inArray(schedules.medicationId, userMeds),
        eq(schedules.status, 'paused'),
        lte(schedules.pausedUntil, today),
      ),
    );
}

/** Users who finished onboarding — the only ones with schedules. */
export async function listActiveUserIds(db: Db): Promise<number[]> {
  const rows = await db.select({ id: users.id }).from(users).where(isNull(users.onboardingStep));
  return rows.map((r) => r.id);
}
