import { Bot } from 'grammy';
import { texts } from './texts.ts';

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  bot.command('start', (ctx) => ctx.reply(texts.start));

  bot.catch((err) => {
    // Log only metadata; never message contents (may contain medical data).
    console.error(`Error while handling update ${err.ctx.update.update_id}:`, err.error);
  });

  return bot;
}
