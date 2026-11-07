import type { Db } from '@ovimuu/db';
import type { Api } from 'grammy';
import { PgBoss } from 'pg-boss';
import { logger } from '../logger.ts';
import { runReminderTick } from '../reminders/send.ts';
import { stripClosedDraftInputs } from '../repo/drafts.ts';
import { generateForAllUsers } from '../scheduling/generate.ts';

export const QUEUES = {
  generateIntakes: 'intakes.generate',
  reminderTick: 'reminders.tick',
} as const;

/** Hourly at :05 — intakes for today/tomorrow, statuses, not_marked, draft cleanup. */
const GENERATE_CRON = '5 * * * *';
/** Every minute — due reminders, snooze resends, repeats. */
const TICK_CRON = '* * * * *';

/** Starts pg-boss (schema "pgboss" in the app database) and registers jobs. */
export async function startScheduler(databaseUrl: string, db: Db, api: Api): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss' });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.start();

  // "singleton": at most one active job per queue, so runs never overlap.
  await boss.createQueue(QUEUES.generateIntakes, { policy: 'singleton' });
  await boss.createQueue(QUEUES.reminderTick, { policy: 'singleton' });

  await boss.work(QUEUES.generateIntakes, async () => {
    await generateForAllUsers(db);
    // Data minimization: closed drafts must not keep user input or model output.
    await stripClosedDraftInputs(db);
  });
  await boss.work(QUEUES.reminderTick, async () => {
    await runReminderTick({ db, api });
  });

  await boss.schedule(QUEUES.generateIntakes, GENERATE_CRON);
  await boss.schedule(QUEUES.reminderTick, TICK_CRON);
  // Catch up right away after a restart instead of waiting for the next hour.
  await boss.send(QUEUES.generateIntakes);

  logger.info('scheduler started');
  return boss;
}
