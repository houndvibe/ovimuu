import type { BotContext } from './context.ts';
import { logger } from './logger.ts';

/** Appends a "chosen" line to the pressed message and removes its keyboard. */
export async function markChosen(ctx: BotContext, line: string): Promise<void> {
  const text = ctx.callbackQuery?.message?.text;
  try {
    if (text) await ctx.editMessageText(`${text}\n\n${line}`);
    else await ctx.editMessageReplyMarkup();
  } catch (err) {
    logger.warn({ err }, 'failed to edit message');
  }
}
