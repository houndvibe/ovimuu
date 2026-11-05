import type { Db } from '@ovimuu/db';
import type { Context, MiddlewareFn } from 'grammy';
import { getOrCreateUser, type User } from './repo/users.ts';

export type BotContext = Context & {
  db: Db;
  /** Set by userMiddleware for every handled update. */
  user: User;
};

/** Only private chats with a known sender are handled; everything else is ignored. */
export const privateOnly: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (ctx.chat?.type === 'private' && ctx.from && !ctx.from.is_bot) await next();
};

export function userMiddleware(db: Db): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    ctx.db = db;
    ctx.user = await getOrCreateUser(db, ctx.from!.id, ctx.from!.first_name ?? null);
    await next();
  };
}
