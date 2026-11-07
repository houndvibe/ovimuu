import type { Db } from '@ovimuu/db';
import { addDays, localDate } from '../domain/dates.ts';
import { planIntakes } from '../domain/intakes.ts';
import { startOfLocalDay } from '../domain/reminders.ts';
import { markNotMarked } from '../repo/reminders.ts';
import { logger } from '../logger.ts';
import {
  deleteFuturePending,
  insertIntakes,
  listActiveUserIds,
  loadSchedules,
  updateScheduleStatuses,
} from '../repo/intakes.ts';
import { getSettings, settingsToAnchors } from '../repo/users.ts';

/**
 * Ensures intakes exist for the user's local today and tomorrow (yesterday is included so
 * "before sleep" slots after midnight are covered). Idempotent; never creates past intakes.
 */
export async function generateForUser(db: Db, userId: number, now = new Date()): Promise<number> {
  const settings = await getSettings(db, userId);
  const today = localDate(now, settings.timezone);
  await updateScheduleStatuses(db, userId, today);
  // End of day: unanswered intakes from previous local days become not_marked.
  const notMarked = await markNotMarked(db, userId, startOfLocalDay(now, settings.timezone));
  if (notMarked > 0) logger.info({ userId, count: notMarked }, 'intakes not marked');

  const planned = planIntakes({
    schedules: await loadSchedules(db, userId),
    anchors: settingsToAnchors(settings),
    timezone: settings.timezone,
    dates: [addDays(today, -1), today, addDays(today, 1)],
    notBefore: now,
  });
  return insertIntakes(db, userId, planned);
}

/** After a schedule / time zone / anchor change: rebuild untouched future intakes. */
export async function regenerateForUser(db: Db, userId: number, now = new Date()): Promise<void> {
  const deleted = await deleteFuturePending(db, userId, now);
  const created = await generateForUser(db, userId, now);
  logger.info({ userId, deleted, created }, 'intakes regenerated');
}

export async function generateForAllUsers(db: Db, now = new Date()): Promise<void> {
  const userIds = await listActiveUserIds(db);
  let created = 0;
  for (const userId of userIds) {
    try {
      created += await generateForUser(db, userId, now);
    } catch (err) {
      // One user's broken data must not block everyone else.
      logger.error({ userId, err }, 'intake generation failed');
    }
  }
  logger.info({ users: userIds.length, created }, 'intakes generated');
}
