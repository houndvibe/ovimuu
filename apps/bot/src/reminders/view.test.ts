import { describe, expect, it } from 'vitest';
import type { Reminder, ReminderItem } from '../repo/reminders.ts';
import { renderReminder } from './view.ts';

const tz = 'Europe/Moscow';
const at = new Date('2026-11-07T09:00:00+03:00');

const reminder: Reminder = {
  id: 7,
  userId: 1,
  scheduledAt: at,
  messageId: 100,
  sentAt: at,
  repeatsSent: 0,
  repeatAt: null,
  snoozedUntil: null,
  closedAt: null,
  createdAt: at,
};

const item = (fields: Partial<ReminderItem>): ReminderItem => ({
  intakeId: 1,
  status: 'pending',
  scheduledAt: at,
  confirmedAt: null,
  name: 'Витамин D3',
  doseAmount: 2000,
  doseUnit: 'МЕ',
  unitsPerIntake: 1,
  unitForm: 'капсула',
  ...fields,
});

const buttons = (view: ReturnType<typeof renderReminder>) =>
  view.reply_markup.inline_keyboard.map((row) => row.map((b) => b.text));
const callbacks = (view: ReturnType<typeof renderReminder>) =>
  view.reply_markup.inline_keyboard
    .flat()
    .map((b) => ('callback_data' in b ? b.callback_data : ''));

describe('renderReminder', () => {
  const two = [item({}), item({ intakeId: 2, name: 'Омега-3', doseAmount: null, doseUnit: null })];

  it('renders a grouped morning reminder with all buttons', () => {
    const view = renderReminder(reminder, two, tz);
    expect(view.text).toBe(
      '☀️ Утренний квест\n\n• Витамин D3 2000 МЕ — 1 капсула\n• Омега-3 — 1 капсула',
    );
    expect(buttons(view)).toEqual([
      ['✅ Всё принято', '⏰ Позже'],
      ['Пропустить'],
      ['Отметить по отдельности'],
    ]);
    expect(callbacks(view)).toEqual(['rm:7:all', 'rm:7:later', 'rm:7:skip', 'rm:7:each']);
  });

  it('has no "each" button for a single medication', () => {
    expect(buttons(renderReminder(reminder, [item({})], tz))).toEqual([
      ['✅ Принято', '⏰ Позже'],
      ['Пропустить'],
    ]);
  });

  it('shows the taken time and an undo button when done', () => {
    const view = renderReminder(
      reminder,
      [item({ status: 'taken', confirmedAt: new Date('2026-11-07T09:12:00+03:00') })],
      tz,
    );
    expect(view.text).toContain('✅ Витамин D3');
    expect(view.text).toContain('✅ Принято в 9:12');
    expect(callbacks(view)).toEqual(['rm:7:undo']);
  });

  it('adds earned XP to the status line, but not when there is none', () => {
    const taken = [item({ status: 'taken', confirmedAt: new Date('2026-11-07T09:12:00+03:00') })];
    expect(renderReminder(reminder, taken, tz, 'main', 10).text).toContain(
      '✅ Принято в 9:12 · +10 XP',
    );
    expect(renderReminder(reminder, taken, tz, 'main', 0).text).not.toContain('XP');
  });

  it('shows skipped and mixed outcomes', () => {
    expect(renderReminder(reminder, [item({ status: 'skipped' })], tz).text).toContain(
      'ничего страшного',
    );
    const mixed = renderReminder(
      reminder,
      [
        { ...two[0]!, status: 'taken', confirmedAt: at },
        { ...two[1]!, status: 'skipped' },
      ],
      tz,
    );
    expect(mixed.text).toContain('⏭ Омега-3');
    expect(mixed.text).toContain('Готово');
  });

  it('shows the snooze time and keeps buttons', () => {
    const view = renderReminder(
      { ...reminder, snoozedUntil: new Date('2026-11-07T09:45:00+03:00') },
      [item({ status: 'snoozed' })],
      tz,
    );
    expect(view.text).toContain('⏰ Напомню в 9:45');
    expect(callbacks(view)).toContain('rm:7:all');
  });

  it('renders snooze options and per-item buttons', () => {
    expect(callbacks(renderReminder(reminder, two, tz, 'later'))).toEqual([
      'rm:7:s:15',
      'rm:7:s:30',
      'rm:7:s:60',
      'rm:7:back',
    ]);
    const each = renderReminder(reminder, [two[0]!, { ...two[1]!, status: 'taken' }], tz, 'each');
    expect(callbacks(each)).toEqual(['rm:7:t:1', 'rm:7:k:1', 'rm:7:back']);
  });

  it('lets yesterday’s not_marked intakes be marked', () => {
    expect(callbacks(renderReminder(reminder, [item({ status: 'not_marked' })], tz))).toContain(
      'rm:7:all',
    );
  });

  it('uses the evening title by local time', () => {
    const evening = { ...reminder, scheduledAt: new Date('2026-11-07T19:00:00+03:00') };
    expect(renderReminder(evening, [item({})], tz).text).toMatch(/^🌆 Вечерний квест/);
  });
});
