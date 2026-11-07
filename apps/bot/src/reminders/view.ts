// Renders a reminder message (text + keyboard) from the current state of its intakes.
import { InlineKeyboard } from 'grammy';
import { isOpen, localHour, questKind, SNOOZE_OPTIONS_MIN } from '../domain/reminders.ts';
import { formatLocalTime } from '../domain/timezone.ts';
import type { Reminder, ReminderItem } from '../repo/reminders.ts';
import { texts } from '../texts.ts';

const t = texts.reminders;

export type ViewMode = 'main' | 'later' | 'each';

// Callback data: "rm:<reminderId>:<action>[:<arg>]" (≤ 64 bytes).
export const reminderCallbackPattern = /^rm:(\d+):(\w+)(?::(\d+))?$/;
const data = (id: number, action: string, arg?: number) =>
  `rm:${id}:${action}${arg !== undefined ? `:${arg}` : ''}`;

function markOf(item: ReminderItem): 'open' | 'taken' | 'skipped' {
  if (item.status === 'taken') return 'taken';
  if (item.status === 'skipped') return 'skipped';
  return 'open';
}

function statusLine(
  reminder: Reminder,
  items: ReminderItem[],
  tz: string,
  xp: number,
): string | null {
  const open = items.filter((i) => isOpen(i.status));
  if (open.length > 0) {
    return reminder.snoozedUntil
      ? t.snoozedUntil(formatLocalTime(reminder.snoozedUntil, tz))
      : null;
  }
  if (items.every((i) => i.status === 'taken')) {
    const last = Math.max(...items.map((i) => i.confirmedAt?.getTime() ?? 0));
    return t.withXp(t.takenAt(formatLocalTime(new Date(last), tz)), xp);
  }
  if (items.every((i) => i.status === 'skipped')) return t.skipped;
  return t.withXp(t.mixedDone, xp);
}

function keyboard(reminder: Reminder, items: ReminderItem[], mode: ViewMode): InlineKeyboard {
  const id = reminder.id;
  const open = items.filter((i) => isOpen(i.status));
  if (open.length === 0) return new InlineKeyboard().text(t.undoButton, data(id, 'undo'));

  if (mode === 'later') {
    const kb = new InlineKeyboard();
    for (const min of SNOOZE_OPTIONS_MIN) kb.text(t.snoozeButton(min), data(id, 's', min));
    return kb.row().text(t.backButton, data(id, 'back'));
  }
  if (mode === 'each') {
    const kb = new InlineKeyboard();
    for (const item of open) {
      kb.text(t.takeOneButton(item.name), data(id, 't', item.intakeId))
        .text(t.skipOneButton, data(id, 'k', item.intakeId))
        .row();
    }
    return kb.text(t.backButton, data(id, 'back'));
  }
  const kb = new InlineKeyboard()
    .text(t.takeAllButton(open.length > 1), data(id, 'all'))
    .text(t.laterButton, data(id, 'later'))
    .row()
    .text(t.skipButton, data(id, 'skip'));
  if (open.length > 1) kb.row().text(t.eachButton, data(id, 'each'));
  return kb;
}

export function renderReminder(
  reminder: Reminder,
  items: ReminderItem[],
  tz: string,
  mode: ViewMode = 'main',
  /** Intake XP earned by this reminder's intakes, shown once everything is answered. */
  xp = 0,
): { text: string; reply_markup: InlineKeyboard } {
  const title = t.title[questKind(localHour(reminder.scheduledAt, tz))];
  const lines = items.map((i) => t.item(markOf(i), i));
  const status = statusLine(reminder, items, tz, xp);
  const text = [title, lines.join('\n'), status].filter(Boolean).join('\n\n');
  return { text, reply_markup: keyboard(reminder, items, mode) };
}
