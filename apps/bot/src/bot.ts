import { Bot } from 'grammy';
import { account } from './account/handlers.ts';
import { addFlow } from './add/handlers.ts';
import { changeButtons } from './change/handlers.ts';
import { input } from './input.ts';
import { type BotContext, type Deps, privateOnly, userMiddleware } from './context.ts';
import { logger } from './logger.ts';
import { onboarding } from './onboarding/handlers.ts';
import { reminderButtons } from './reminders/handlers.ts';

export function createBot(token: string, deps: Deps): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);

  bot.use(privateOnly);
  bot.use(userMiddleware(deps));
  // /delete and /stats work at any time, including during onboarding.
  bot.use(account);
  bot.use(onboarding);
  // Buttons (code only, no AI).
  bot.use(reminderButtons);
  bot.use(addFlow);
  bot.use(changeButtons);
  // Free-form input after onboarding: add-draft, change-draft or routeIntent.
  bot.use(input);
  bot.on('callback_query', (ctx) => ctx.answerCallbackQuery());

  bot.catch((err) => {
    // Log only metadata; never message contents (may contain medical data).
    logger.error({ updateId: err.ctx.update.update_id, err: err.error }, 'update failed');
  });

  return bot;
}
