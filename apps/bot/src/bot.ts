import { Bot } from 'grammy';
import { addFlow } from './add/handlers.ts';
import { type BotContext, type Deps, privateOnly, userMiddleware } from './context.ts';
import { logger } from './logger.ts';
import { onboarding } from './onboarding/handlers.ts';

export function createBot(token: string, deps: Deps): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  bot.use(privateOnly);
  bot.use(userMiddleware(deps));
  bot.use(onboarding);
  // Onboarding complete: free-form input goes to the add-medication flow.
  bot.use(addFlow);
  bot.on('callback_query', (ctx) => ctx.answerCallbackQuery());

  bot.catch((err) => {
    // Log only metadata; never message contents (may contain medical data).
    logger.error({ updateId: err.ctx.update.update_id, err: err.error }, 'update failed');
  });

  return bot;
}
