// Shared helpers for conversational flows (add, change, mark).
import { AiError } from '@ovimuu/ai';
import type { BotContext } from './context.ts';
import type { Anchors } from './domain/anchors.ts';
import { localDate } from './domain/dates.ts';
import { logger } from './logger.ts';
import { getSettings, settingsToAnchors } from './repo/users.ts';
import { texts } from './texts.ts';

export type Source = 'text' | 'voice' | 'photo';

export interface UserClock {
  anchors: Anchors;
  today: string;
  timezone: string;
}

export async function userClock(ctx: BotContext): Promise<UserClock> {
  const settings = await getSettings(ctx.db, ctx.user.id);
  return {
    anchors: settingsToAnchors(settings),
    today: localDate(new Date(), settings.timezone),
    timezone: settings.timezone,
  };
}

/** Runs an AI/download step with a typing indicator; on failure replies and returns null. */
export async function withAi<T>(
  ctx: BotContext,
  source: Source,
  fn: () => Promise<T>,
): Promise<T | null> {
  await ctx.replyWithChatAction('typing').catch(() => undefined);
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AiError) {
      logger.warn({ userId: ctx.user.id, code: err.code, status: err.status }, 'ai error');
      await ctx.reply(texts.add.aiError(err.code, source));
    } else {
      logger.error({ userId: ctx.user.id, err }, 'ai step failed');
      await ctx.reply(texts.add.aiError('unavailable', source));
    }
    return null;
  }
}
