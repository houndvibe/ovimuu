import type { Db } from '@ovimuu/db';
import type { Api } from 'grammy';
import { isOpen } from '../domain/reminders.ts';
import { logger } from '../logger.ts';
import { intakeXp } from '../progress/award.ts';
import { closeReminder, getReminder, getReminderItems, updateReminder } from '../repo/reminders.ts';
import { renderReminder } from './view.ts';

/**
 * Re-renders a reminder message after its intakes changed elsewhere (e.g. "выпила магний"
 * by phrase), closing or reopening the reminder to match.
 */
export async function refreshReminderMessage(
  deps: { db: Db; api: Api },
  userId: number,
  telegramId: number,
  reminderId: number,
  tz: string,
): Promise<void> {
  let reminder = await getReminder(deps.db, reminderId, userId);
  if (!reminder?.messageId) return;
  const items = await getReminderItems(deps.db, reminderId);
  const anyOpen = items.some((i) => isOpen(i.status));
  if (!anyOpen && !reminder.closedAt) {
    await closeReminder(deps.db, reminderId, new Date());
    reminder = { ...reminder, closedAt: new Date(), repeatAt: null, snoozedUntil: null };
  } else if (anyOpen && reminder.closedAt) {
    await updateReminder(deps.db, reminderId, { closedAt: null });
    reminder = { ...reminder, closedAt: null };
  }
  const xp = await intakeXp(
    deps.db,
    items.map((i) => i.intakeId),
  );
  const view = renderReminder(reminder, items, tz, 'main', xp);
  await deps.api
    .editMessageText(telegramId, reminder.messageId!, view.text, {
      reply_markup: view.reply_markup,
    })
    .catch((err) => logger.warn({ err }, 'failed to refresh reminder message'));
}
