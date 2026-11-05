import { createBot } from './bot.ts';
import { EnvError, loadEnv } from './env.ts';

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

  const bot = createBot(env.BOT_TOKEN);

  const stop = () => void bot.stop();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  // Development: long polling. Production webhook comes in the deploy step.
  void bot.start({
    onStart: (me) => console.log(`Bot @${me.username} started (long polling)`),
  });
}

main();
