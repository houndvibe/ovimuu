// Buttons under reminder messages. Handled by code only, no AI.
import { Composer } from 'grammy';
import type { BotContext } from '../context.ts';
import {
  type IntakeStatus,
  isOpen,
  OPEN_STATUSES,
  SNOOZE_OPTIONS_MIN,
  startOfLocalDay,
} from '../domain/reminders.ts';
import { DAY_BONUS_XP } from '../domain/xp.ts';
import { logger } from '../logger.ts';
import { awardForIntakes, intakeXp, revokeForIntakes } from '../progress/award.ts';
import {
  closeReminder,
  getReminder,
  getReminderItems,
  type Reminder,
  setIntakeStatus,
  updateReminder,
} from '../repo/reminders.ts';
import { getSettings } from '../repo/users.ts';
import { texts } from '../texts.ts';
import { reminderCallbackPattern, renderReminder, type ViewMode } from './view.ts';

const t = texts.reminders;

export const reminderButtons = new Composer<BotContext>();

reminderButtons.callbackQuery(reminderCallbackPattern, async (ctx) => {
  const [, idStr, action, argStr] = ctx.match;
  const reminder = await getReminder(ctx.db, Number(idStr), ctx.user.id);
  if (!reminder) {
    await ctx.answerCallbackQuery(t.alreadyDone);
    return;
  }
  const { timezone } = await getSettings(ctx.db, ctx.user.id);
  const now = new Date();
  let items = await getReminderItems(ctx.db, reminder.id);
  const openIds = items.filter((i) => isOpen(i.status)).map((i) => i.intakeId);
  const arg = argStr ? Number(argStr) : undefined;

  const show = async (r: Reminder, mode: ViewMode = 'main') => {
    items = await getReminderItems(ctx.db, r.id);
    const xp = await intakeXp(
      ctx.db,
      items.map((i) => i.intakeId),
    );
    const view = renderReminder(r, items, timezone, mode, xp);
    await ctx
      .editMessageText(view.text, { reply_markup: view.reply_markup })
      .catch((err) => logger.warn({ err }, 'failed to edit reminder message'));
  };
  /** Marks intakes, awards XP for taken ones, closes the reminder once nothing is open. */
  const mark = async (ids: number[], status: IntakeStatus, mode: ViewMode = 'main') => {
    await setIntakeStatus(ctx.db, ids, OPEN_STATUSES, status, now);
    const change =
      status === 'taken' ? await awardForIntakes(ctx.db, ctx.user.id, ids, timezone) : null;
    const remaining = (await getReminderItems(ctx.db, reminder.id)).some((i) => isOpen(i.status));
    let r = reminder;
    if (!remaining) {
      await closeReminder(ctx.db, reminder.id, now);
      r = { ...reminder, closedAt: now, repeatAt: null, snoozedUntil: null };
    }
    logger.info(
      {
        userId: ctx.user.id,
        reminderId: reminder.id,
        status,
        count: ids.length,
        xp: change?.xpTotal,
      },
      'intakes marked',
    );
    await ctx.answerCallbackQuery();
    await show(r, remaining ? mode : 'main');
    if (change) {
      for (let i = 0; i < change.dayBonuses; i++)
        await ctx.reply(texts.progress.dayBonus(DAY_BONUS_XP));
      for (const up of change.levelUps)
        await ctx.reply(texts.progress.levelUp(up.level, up.reward));
    }
  };

  const needsOpen = ['all', 'skip', 'later', 'each', 's', 't', 'k', 'back'];
  if (needsOpen.includes(action!) && openIds.length === 0) {
    await ctx.answerCallbackQuery(t.alreadyDone);
    await show(reminder);
    return;
  }

  switch (action) {
    case 'all':
      return mark(openIds, 'taken');
    case 'skip':
      return mark(openIds, 'skipped');
    case 't':
    case 'k':
      if (arg === undefined || !openIds.includes(arg)) break;
      return mark([arg], action === 't' ? 'taken' : 'skipped', 'each');
    case 'later':
    case 'each':
      await ctx.answerCallbackQuery();
      return show(reminder, action);
    case 'back':
      await ctx.answerCallbackQuery();
      return show(reminder);
    case 's': {
      if (!SNOOZE_OPTIONS_MIN.some((m) => m === arg)) break;
      const until = new Date(now.getTime() + arg! * 60_000);
      await setIntakeStatus(ctx.db, openIds, ['pending', 'snoozed'], 'snoozed', null);
      await updateReminder(ctx.db, reminder.id, { snoozedUntil: until, repeatAt: null });
      logger.info(
        { userId: ctx.user.id, reminderId: reminder.id, minutes: arg },
        'reminder snoozed',
      );
      await ctx.answerCallbackQuery();
      return show({ ...reminder, snoozedUntil: until, repeatAt: null });
    }
    case 'undo': {
      // Back to unanswered: pending today, not_marked if the day is already over.
      const answered = items.filter((i) => !isOpen(i.status));
      const dayStart = startOfLocalDay(now, timezone);
      const past = answered.filter((i) => i.scheduledAt < dayStart).map((i) => i.intakeId);
      const today = answered.filter((i) => i.scheduledAt >= dayStart).map((i) => i.intakeId);
      // Undoing "taken" also removes its XP (and a day bonus that is no longer deserved).
      const taken = answered.filter((i) => i.status === 'taken').map((i) => i.intakeId);
      await revokeForIntakes(ctx.db, ctx.user.id, taken, timezone);
      await setIntakeStatus(ctx.db, past, ['taken', 'skipped'], 'not_marked', null);
      await setIntakeStatus(ctx.db, today, ['taken', 'skipped'], 'pending', null);
      await updateReminder(ctx.db, reminder.id, { closedAt: null });
      logger.info({ userId: ctx.user.id, reminderId: reminder.id }, 'reminder undone');
      await ctx.answerCallbackQuery(t.undone);
      return show({ ...reminder, closedAt: null });
    }
  }
  await ctx.answerCallbackQuery(t.alreadyDone);
});
