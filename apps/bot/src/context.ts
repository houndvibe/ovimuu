import type { AiService } from '@ovimuu/ai';
import type { Db } from '@ovimuu/db';
import type { Context, MiddlewareFn } from 'grammy';
import { getOrCreateUser, type User } from './repo/users.ts';

export interface Deps {
  db: Db;
  ai: AiService;
  /** Telegram id allowed to use /stats. */
  adminTelegramId: number;
}

export type BotContext = Context &
  Deps & {
    /** Set by userMiddleware for every handled update. */
    user: User;
  };

/** Only private chats with a known sender are handled; everything else is ignored. */
export const privateOnly: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (ctx.chat?.type === 'private' && ctx.from && !ctx.from.is_bot) await next();
};

export function userMiddleware(deps: Deps): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    ctx.db = deps.db;
    ctx.ai = deps.ai;
    ctx.adminTelegramId = deps.adminTelegramId;
    ctx.user = await getOrCreateUser(deps.db, ctx.from!.id, ctx.from!.first_name ?? null);
    await next();
  };
}
