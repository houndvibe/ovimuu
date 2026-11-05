import { createDb } from '@ovimuu/db';
import { createBot } from './bot.ts';
import { EnvError, loadEnv } from './env.ts';
import { logger } from './logger.ts';

function main(): void {
  let env;
  try {
    env = loadEnv();
  } catch (e) {
    if (e instanceof EnvError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }

  const { db, pool } = createDb(env.DATABASE_URL);
  const bot = createBot(env.BOT_TOKEN, db);

  const stop = async () => {
    await bot.stop();
    await pool.end();
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());

  // Development: long polling. Production webhook comes in the deploy step.
  void bot.start({
    onStart: (me) => logger.info(`Bot @${me.username} started (long polling)`),
  });
}

main();
