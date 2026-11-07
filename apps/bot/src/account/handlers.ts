// /delete (wipe all user data) and /stats (admin only).
import { type Db, eq, users } from '@ovimuu/db';
import { Composer, InlineKeyboard } from 'grammy';
import type { BotContext } from '../context.ts';
import { logger } from '../logger.ts';
import { collectStats } from '../repo/stats.ts';
import { texts } from '../texts.ts';
import { markChosen } from '../ui.ts';

const t = texts.account;

/** The confirmation button is valid this long. */
const DELETE_CONFIRM_WINDOW_SEC = 10 * 60;
const deletePattern = /^del:(\d+):(ok|cancel)$/;

/** Deletes the user row; everything else goes with it via ON DELETE CASCADE. */
export async function deleteAllUserData(db: Db, userId: number): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}

export const account = new Composer<BotContext>();

account.command('delete', async (ctx) => {
  const issuedAt = Math.floor(Date.now() / 1000);
  await ctx.reply(t.deleteConfirm, {
    reply_markup: new InlineKeyboard()
      .text(t.deleteButton, `del:${issuedAt}:ok`)
      .text(t.cancelButton, `del:${issuedAt}:cancel`),
  });
});

account.callbackQuery(deletePattern, async (ctx) => {
  const [, issuedAt, action] = ctx.match;
  await ctx.answerCallbackQuery();
  if (action === 'cancel') {
    await markChosen(ctx, t.deleteCancelled);
    return;
  }
  if (Date.now() / 1000 - Number(issuedAt) > DELETE_CONFIRM_WINDOW_SEC) {
    await markChosen(ctx, t.deleteExpired);
    return;
  }
  await deleteAllUserData(ctx.db, ctx.user.id);
  logger.info({ userId: ctx.user.id }, 'user data deleted');
  await markChosen(ctx, t.deleted);
});

account.command('stats', async (ctx, next) => {
  // Not the admin: behave as if the command did not exist.
  if (ctx.from?.id !== ctx.adminTelegramId) return next();
  const week = await collectStats(ctx.db, new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const all = await collectStats(ctx.db, null);
  await ctx.reply(t.stats(week, all));
});
