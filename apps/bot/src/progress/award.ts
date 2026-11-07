// Awarding and revoking XP. "Exactly once" is guaranteed by unique indexes on xp_events
// (intake_id for intake XP, (user_id, date) for the day bonus), not by checks in code.
import {
  activeDays,
  and,
  type Db,
  eq,
  gte,
  inArray,
  intakes,
  isNotNull,
  lt,
  sql,
  unlocks,
  userProgress,
  xpEvents,
} from '@ovimuu/db';
import { addDays, localDate } from '../domain/dates.ts';
import { localToUtc } from '../domain/intakes.ts';
import {
  DAY_BONUS_XP,
  isDayComplete,
  isXpEligible,
  LEVEL_REWARDS,
  levelForXp,
  newlyReachedLevels,
  XP_PER_INTAKE,
} from '../domain/xp.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface ProgressChange {
  /** Day bonuses newly awarded by this change. */
  dayBonuses: number;
  /** Levels reached for the first time (congratulate). */
  levelUps: { level: number; reward: string | null }[];
  xpTotal: number;
  level: number;
}

async function isDayCompleteInDb(tx: Tx, userId: number, date: string, tz: string) {
  const from = localToUtc(date, 0, tz);
  const to = localToUtc(addDays(date, 1), 0, tz);
  const rows = await tx
    .select({ xpId: xpEvents.id })
    .from(intakes)
    .leftJoin(xpEvents, and(eq(xpEvents.intakeId, intakes.id), eq(xpEvents.kind, 'intake')))
    .where(
      and(
        eq(intakes.userId, userId),
        isNotNull(intakes.scheduleId),
        gte(intakes.scheduledAt, from),
        lt(intakes.scheduledAt, to),
      ),
    );
  return isDayComplete(rows.map((r) => ({ hasXp: r.xpId !== null })));
}

/** Recomputes xp_total / level from xp_events and unlocks rewards for new levels. */
async function recompute(tx: Tx, userId: number) {
  const [{ total }] = (await tx
    .select({ total: sql<number>`coalesce(sum(${xpEvents.amount}), 0)::int` })
    .from(xpEvents)
    .where(eq(xpEvents.userId, userId))) as [{ total: number }];
  const [progress] = await tx.select().from(userProgress).where(eq(userProgress.userId, userId));
  const level = levelForXp(total);
  const best = progress?.bestLevel ?? 1;
  const levelUps = newlyReachedLevels(best, level).map((l) => ({
    level: l,
    reward: LEVEL_REWARDS[l] ?? null,
  }));
  for (const { reward } of levelUps) {
    if (reward) {
      await tx.insert(unlocks).values({ userId, itemKey: reward }).onConflictDoNothing();
    }
  }
  await tx
    .update(userProgress)
    .set({ xpTotal: total, level, bestLevel: Math.max(best, level) })
    .where(eq(userProgress.userId, userId));
  return { xpTotal: total, level, levelUps };
}

/** Awards XP for intakes just marked as taken (+ active day, day bonus, level-ups). */
export async function awardForIntakes(
  db: Db,
  userId: number,
  intakeIds: number[],
  tz: string,
): Promise<ProgressChange> {
  return db.transaction(async (tx) => {
    const rows = intakeIds.length
      ? await tx
          .select({
            id: intakes.id,
            scheduleId: intakes.scheduleId,
            scheduledAt: intakes.scheduledAt,
            confirmedAt: intakes.confirmedAt,
          })
          .from(intakes)
          .where(
            and(
              inArray(intakes.id, intakeIds),
              eq(intakes.userId, userId),
              eq(intakes.status, 'taken'),
            ),
          )
      : [];

    const dates = new Set<string>();
    for (const r of rows) {
      const date = localDate(r.scheduledAt, tz);
      dates.add(date);
      if (isXpEligible(r)) {
        await tx
          .insert(xpEvents)
          .values({ userId, kind: 'intake', intakeId: r.id, amount: XP_PER_INTAKE })
          .onConflictDoNothing();
      }
      const newDay = await tx
        .insert(activeDays)
        .values({ userId, date })
        .onConflictDoNothing()
        .returning({ date: activeDays.date });
      if (newDay.length > 0) {
        await tx
          .update(userProgress)
          .set({ daysWithOvi: sql`${userProgress.daysWithOvi} + 1` })
          .where(eq(userProgress.userId, userId));
      }
    }

    let dayBonuses = 0;
    for (const date of dates) {
      if (!(await isDayCompleteInDb(tx, userId, date, tz))) continue;
      const inserted = await tx
        .insert(xpEvents)
        .values({ userId, kind: 'day_complete', date, amount: DAY_BONUS_XP })
        .onConflictDoNothing()
        .returning({ id: xpEvents.id });
      dayBonuses += inserted.length;
    }

    return { dayBonuses, ...(await recompute(tx, userId)) };
  });
}

/** Undo: removes intake XP and any day bonus that is no longer deserved. */
export async function revokeForIntakes(
  db: Db,
  userId: number,
  intakeIds: number[],
  tz: string,
): Promise<void> {
  if (intakeIds.length === 0) return;
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ scheduledAt: intakes.scheduledAt })
      .from(intakes)
      .where(and(inArray(intakes.id, intakeIds), eq(intakes.userId, userId)));
    await tx
      .delete(xpEvents)
      .where(
        and(
          eq(xpEvents.userId, userId),
          eq(xpEvents.kind, 'intake'),
          inArray(xpEvents.intakeId, intakeIds),
        ),
      );
    for (const date of new Set(rows.map((r) => localDate(r.scheduledAt, tz)))) {
      if (await isDayCompleteInDb(tx, userId, date, tz)) continue;
      await tx
        .delete(xpEvents)
        .where(
          and(
            eq(xpEvents.userId, userId),
            eq(xpEvents.kind, 'day_complete'),
            eq(xpEvents.date, date),
          ),
        );
    }
    await recompute(tx, userId);
  });
}

/** Intake XP earned by the given intakes (for "+N XP" in the reminder message). */
export async function intakeXp(db: Db, intakeIds: number[]): Promise<number> {
  if (intakeIds.length === 0) return 0;
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${xpEvents.amount}), 0)::int` })
    .from(xpEvents)
    .where(and(eq(xpEvents.kind, 'intake'), inArray(xpEvents.intakeId, intakeIds)));
  return row?.total ?? 0;
}
