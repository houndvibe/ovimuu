// Scheduler side of reminders: sending new reminders, repeats and snooze resends.
// Every send is preceded by an atomic claim in the DB, so a repeated job run never
// sends a second message (at-most-once delivery).
import type { Db } from '@ovimuu/db';
import { type Api, GrammyError } from 'grammy';
import { groupDue, nextRepeatAt, sleepCutoff } from '../domain/reminders.ts';
import { logger } from '../logger.ts';
import {
  claimReminder,
  claimRepeat,
  claimSnooze,
  closeReminder,
  findDueIntakes,
  findDueRepeats,
  findDueSnoozes,
  getReminderItems,
  type Reminder,
  setIntakeStatus,
  updateReminder,
} from '../repo/reminders.ts';
import { getUserForMessaging, settingsToAnchors, type UserSettings } from '../repo/users.ts';
import { texts } from '../texts.ts';
import { renderReminder } from './view.ts';

export interface SendDeps {
  db: Db;
  api: Api;
}

function firstRepeatAt(reminder: Reminder, sentAt: Date, settings: UserSettings): Date | null {
  return nextRepeatAt({
    sentAt,
    repeatsSent: 0,
    repeatCount: settings.repeatCount,
    repeatDelayMin: settings.repeatDelayMin,
    cutoff: sleepCutoff(reminder.scheduledAt, settings.timezone, settingsToAnchors(settings)),
  });
}

/** The user blocked the bot or deleted the chat: stop trying. */
const isUnreachable = (err: unknown) =>
  err instanceof GrammyError && (err.error_code === 403 || err.error_code === 400);

/** Sends the reminder message (initial or after snooze) and records it. */
async function deliver(deps: SendDeps, reminder: Reminder, now: Date): Promise<void> {
  const { telegramId, settings } = await getUserForMessaging(deps.db, reminder.userId);
  const items = await getReminderItems(deps.db, reminder.id);
  const view = renderReminder({ ...reminder, snoozedUntil: null }, items, settings.timezone);
  try {
    const message = await deps.api.sendMessage(telegramId, view.text, {
      reply_markup: view.reply_markup,
    });
    await updateReminder(deps.db, reminder.id, {
      messageId: message.message_id,
      sentAt: now,
      repeatsSent: 0,
      repeatAt: firstRepeatAt(reminder, now, settings),
    });
    logger.info({ userId: reminder.userId, reminderId: reminder.id }, 'reminder sent');
  } catch (err) {
    logger.error({ userId: reminder.userId, reminderId: reminder.id, err }, 'reminder failed');
    // Already claimed: never retry, to avoid duplicates. Intakes stay pending → not_marked.
    await closeReminder(deps.db, reminder.id, now);
  }
}

export async function sendNewReminders(deps: SendDeps, now: Date): Promise<void> {
  const due = await findDueIntakes(deps.db, now);
  for (const group of groupDue(due)) {
    const { userId, scheduledAt } = group[0]!;
    const reminder = await claimReminder(
      deps.db,
      userId,
      scheduledAt,
      group.map((i) => i.id),
    );
    if (reminder) await deliver(deps, reminder, now);
  }
}

export async function sendRepeats(deps: SendDeps, now: Date): Promise<void> {
  for (const reminder of await findDueRepeats(deps.db, now)) {
    const items = await getReminderItems(deps.db, reminder.id);
    if (!items.some((i) => i.status === 'pending') || !reminder.messageId || !reminder.sentAt) {
      await updateReminder(deps.db, reminder.id, { repeatAt: null });
      continue;
    }
    const { telegramId, settings } = await getUserForMessaging(deps.db, reminder.userId);
    const next = nextRepeatAt({
      sentAt: reminder.sentAt,
      repeatsSent: reminder.repeatsSent + 1,
      repeatCount: settings.repeatCount,
      repeatDelayMin: settings.repeatDelayMin,
      cutoff: sleepCutoff(reminder.scheduledAt, settings.timezone, settingsToAnchors(settings)),
    });
    if (!(await claimRepeat(deps.db, reminder, next))) continue;
    try {
      // Short nudge as a reply; the buttons stay on the original message.
      await deps.api.sendMessage(telegramId, texts.reminders.repeat, {
        reply_parameters: { message_id: reminder.messageId, allow_sending_without_reply: true },
      });
      logger.info({ userId: reminder.userId, reminderId: reminder.id }, 'reminder repeated');
    } catch (err) {
      logger.error({ userId: reminder.userId, reminderId: reminder.id, err }, 'repeat failed');
      if (isUnreachable(err)) await closeReminder(deps.db, reminder.id, now);
    }
  }
}

export async function sendSnoozed(deps: SendDeps, now: Date): Promise<void> {
  for (const reminder of await findDueSnoozes(deps.db, now)) {
    if (!(await claimSnooze(deps.db, reminder))) continue;
    const items = await getReminderItems(deps.db, reminder.id);
    const snoozed = items.filter((i) => i.status === 'snoozed').map((i) => i.intakeId);
    if (snoozed.length === 0) continue;
    await setIntakeStatus(deps.db, snoozed, ['snoozed'], 'pending', null);

    // Remove buttons from the old message; the fresh one below carries them.
    if (reminder.messageId) {
      const { telegramId } = await getUserForMessaging(deps.db, reminder.userId);
      await deps.api
        .editMessageReplyMarkup(telegramId, reminder.messageId)
        .catch((err) => logger.warn({ err }, 'failed to clear old reminder buttons'));
    }
    await deliver(deps, reminder, now);
  }
}

export async function runReminderTick(deps: SendDeps, now = new Date()): Promise<void> {
  await sendNewReminders(deps, now);
  await sendSnoozed(deps, now);
  await sendRepeats(deps, now);
}
