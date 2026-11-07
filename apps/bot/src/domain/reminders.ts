// Reminder timing rules. Pure functions, no grammY / DB dependencies.
import type { Anchors } from './anchors.ts';
import { addDays, localDate } from './dates.ts';
import { localToUtc } from './intakes.ts';

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;

/** Reminders for intakes due longer ago than this (e.g. after downtime) are not sent. */
export const LATE_LIMIT_MIN = 60;
export const SNOOZE_OPTIONS_MIN = [15, 30, 60] as const;

export type IntakeStatus = 'pending' | 'taken' | 'snoozed' | 'skipped' | 'not_marked';

/** Statuses that can still be marked as taken / skipped (incl. retroactively). */
export const OPEN_STATUSES: readonly IntakeStatus[] = ['pending', 'snoozed', 'not_marked'];
export const isOpen = (s: IntakeStatus) => OPEN_STATUSES.includes(s);

export type QuestKind = 'morning' | 'day' | 'evening' | 'night';

export function questKind(localHour: number): QuestKind {
  if (localHour >= 5 && localHour < 12) return 'morning';
  if (localHour >= 12 && localHour < 17) return 'day';
  if (localHour >= 17 && localHour < 22) return 'evening';
  return 'night';
}

/** Local hour (0–23) of an instant in `tz`. */
export function localHour(instant: Date, tz: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(
      instant,
    ),
  );
}

/** Minutes since local midnight of an instant in `tz`. */
function localMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get('hour') * 60 + get('minute');
}

/**
 * The "sleep" anchor of the logical day an intake belongs to. An intake between midnight
 * and wake-up belongs to the previous day; sleep earlier than wake is after midnight.
 */
export function sleepCutoff(scheduledAt: Date, tz: string, anchors: Anchors): Date {
  const date = localDate(scheduledAt, tz);
  const logicalDate = localMinutes(scheduledAt, tz) < anchors.wake ? addDays(date, -1) : date;
  const sleep = anchors.sleep < anchors.wake ? anchors.sleep + MINUTES_PER_DAY : anchors.sleep;
  const shift = Math.floor(sleep / MINUTES_PER_DAY);
  return localToUtc(addDays(logicalDate, shift), sleep - shift * MINUTES_PER_DAY, tz);
}

/**
 * When to send the next "Ови напоминает" reply, or null if no more repeats:
 * repeat k is sent `k × delay` after the reminder, at most `repeatCount` times,
 * and never after the sleep anchor.
 */
export function nextRepeatAt(opts: {
  sentAt: Date;
  repeatsSent: number;
  repeatCount: number;
  repeatDelayMin: number;
  cutoff: Date;
}): Date | null {
  if (opts.repeatsSent >= opts.repeatCount) return null;
  const at = new Date(
    opts.sentAt.getTime() + (opts.repeatsSent + 1) * opts.repeatDelayMin * MS_PER_MINUTE,
  );
  return at.getTime() <= opts.cutoff.getTime() ? at : null;
}

/** Start of the user's local today: earlier open intakes become not_marked. */
export function startOfLocalDay(now: Date, tz: string): Date {
  return localToUtc(localDate(now, tz), 0, tz);
}

/** Groups due intakes into one reminder per (user, scheduled time). */
export function groupDue<T extends { userId: number; scheduledAt: Date }>(items: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = `${item.userId}|${item.scheduledAt.getTime()}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}
