import { createAi } from '@ovimuu/ai';
import { createDb } from '@ovimuu/db';
import { createBot } from './bot.ts';
import { EnvError, loadEnv } from './env.ts';
import { startScheduler } from './jobs/scheduler.ts';
import { logger } from './logger.ts';

async function main(): Promise<void> {
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
  const ai = createAi({
    folderId: env.YC_FOLDER_ID,
    apiKey: env.YC_API_KEY,
    models: {
      ...(env.YC_MODEL_PARSE && { parse: env.YC_MODEL_PARSE }),
      ...(env.YC_MODEL_INTENT && { intent: env.YC_MODEL_INTENT }),
    },
  });
  const bot = createBot(env.BOT_TOKEN, { db, ai, adminTelegramId: env.ADMIN_TELEGRAM_ID });
  const boss = await startScheduler(env.DATABASE_URL, db, bot.api);

  const stop = async () => {
    await bot.stop();
    await boss.stop();
    await pool.end();
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());

  // Development: long polling. Production webhook comes in the deploy step.
  void bot.start({
    onStart: (me) => logger.info(`Bot @${me.username} started (long polling)`),
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'startup failed');
  process.exit(1);
});
