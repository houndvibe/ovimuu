import type { Db } from '@ovimuu/db';
import { PgBoss } from 'pg-boss';
import { logger } from '../logger.ts';
import { generateForAllUsers } from '../scheduling/generate.ts';

export const QUEUES = {
  generateIntakes: 'intakes.generate',
} as const;

/** Hourly at :05 — keeps intakes for local today/tomorrow in place for every user. */
const GENERATE_CRON = '5 * * * *';

/** Starts pg-boss (schema "pgboss" in the app database) and registers jobs. */
export async function startScheduler(databaseUrl: string, db: Db): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss' });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.start();

  await boss.createQueue(QUEUES.generateIntakes);
  await boss.work(QUEUES.generateIntakes, async () => {
    await generateForAllUsers(db);
  });
  await boss.schedule(QUEUES.generateIntakes, GENERATE_CRON);
  // Catch up right away after a restart instead of waiting for the next hour.
  await boss.send(QUEUES.generateIntakes);

  logger.info('scheduler started');
  return boss;
}
