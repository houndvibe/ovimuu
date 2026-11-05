import type { Db } from '@ovimuu/db';
import { Bot } from 'grammy';
import { type BotContext, privateOnly, userMiddleware } from './context.ts';
import { logger } from './logger.ts';
import { onboarding } from './onboarding/handlers.ts';
import { texts } from './texts.ts';

export function createBot(token: string, db: Db): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  bot.use(privateOnly);
  bot.use(userMiddleware(db));
  bot.use(onboarding);

  // Onboarding complete. The add-medication flow arrives in stage 1, step 5.
  bot.on('message', (ctx) => ctx.reply(texts.addFlowStub));
  bot.on('callback_query', (ctx) => ctx.answerCallbackQuery());

  bot.catch((err) => {
    // Log only metadata; never message contents (may contain medical data).
    logger.error({ updateId: err.ctx.update.update_id, err: err.error }, 'update failed');
  });

  return bot;
}
