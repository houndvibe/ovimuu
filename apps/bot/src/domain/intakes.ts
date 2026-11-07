// Intake planning: which concrete intakes a set of schedules produces in a time window.
// Pure functions, no grammY / DB dependencies.
import { type AnchorKey, type Anchors, parseTime } from './anchors.ts';
import { addDays } from './dates.ts';

const MINUTES_PER_DAY = 24 * 60;
const MS_PER_MINUTE = 60_000;

// ---------- Local time ↔ UTC ----------

/** Offset of `tz` from UTC at `instant`, in minutes (e.g. +180 for Moscow). */
export function tzOffsetMinutes(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MS_PER_MINUTE);
}

/**
 * Converts a local wall-clock time in `tz` to a UTC instant.
 * DST gap (time does not exist) → shifted forward; DST overlap (time occurs twice) → first one.
 */
export function localToUtc(date: string, minutes: number, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  const offsetBefore = tzOffsetMinutes(naive - MINUTES_PER_DAY * MS_PER_MINUTE, tz);
  const offsetAfter = tzOffsetMinutes(naive + MINUTES_PER_DAY * MS_PER_MINUTE, tz);

  const candidates = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => naive - offset * MS_PER_MINUTE)
    .filter((t) => naive - tzOffsetMinutes(t, tz) * MS_PER_MINUTE === t)
    .sort((a, b) => a - b);
  if (candidates.length > 0) return new Date(candidates[0]!);
  // Gap: interpret with the pre-transition offset, which lands after the jump.
  return new Date(naive - offsetBefore * MS_PER_MINUTE);
}

// ---------- Schedules ----------

export interface SlotInput {
  id: number;
  time: string | null;
  anchor: AnchorKey | null;
  anchorOffsetMin: number;
}

export interface ScheduleInput {
  id: number;
  medicationId: number;
  frequencyType: 'daily' | 'every_n_days' | 'weekdays' | 'once';
  everyNDays: number | null;
  weekdays: number[] | null;
  startDate: string;
  endDate: string | null;
  status: 'active' | 'paused' | 'completed';
  /** Resume date: intakes start again on this date. Null with status "paused" = indefinitely. */
  pausedUntil: string | null;
  slots: SlotInput[];
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** ISO weekday of a calendar date: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Whether the schedule has intakes on this (logical) local date. */
export function isScheduleDay(s: ScheduleInput, date: string): boolean {
  if (s.status === 'completed') return false;
  if (s.status === 'paused' && (s.pausedUntil === null || date < s.pausedUntil)) return false;
  if (date < s.startDate || (s.endDate !== null && date > s.endDate)) return false;
  switch (s.frequencyType) {
    case 'daily':
      return true;
    case 'every_n_days':
      return s.everyNDays !== null && daysBetween(s.startDate, date) % s.everyNDays === 0;
    case 'weekdays':
      return (s.weekdays ?? []).includes(isoWeekday(date));
    case 'once':
      return date === s.startDate;
  }
}

/**
 * Local time of a slot relative to the start of its logical day, in minutes. May be ≥ 24h
 * (sleep after midnight, offsets past midnight) or negative (offset before midnight).
 */
export function slotMinutes(slot: SlotInput, anchors: Anchors): number {
  if (slot.time) return parseTime(slot.time);
  if (!slot.anchor) throw new Error(`Slot ${slot.id} has neither time nor anchor`);
  // Sleep earlier than wake means after midnight, i.e. the next calendar day.
  const sleepShift = slot.anchor === 'sleep' && anchors.sleep < anchors.wake ? MINUTES_PER_DAY : 0;
  return anchors[slot.anchor] + sleepShift + slot.anchorOffsetMin;
}

export interface PlannedIntake {
  scheduleId: number;
  slotId: number;
  medicationId: number;
  scheduledAt: Date;
}

export interface PlanInput {
  schedules: ScheduleInput[];
  anchors: Anchors;
  timezone: string;
  /** Logical local dates to plan. */
  dates: string[];
  /** Intakes at or before this instant are skipped (never create intakes in the past). */
  notBefore: Date;
}

export function planIntakes(input: PlanInput): PlannedIntake[] {
  const planned: PlannedIntake[] = [];
  for (const date of input.dates) {
    for (const s of input.schedules) {
      if (!isScheduleDay(s, date)) continue;
      for (const slot of s.slots) {
        const total = slotMinutes(slot, input.anchors);
        const dayShift = Math.floor(total / MINUTES_PER_DAY);
        const minutes = total - dayShift * MINUTES_PER_DAY;
        const scheduledAt = localToUtc(addDays(date, dayShift), minutes, input.timezone);
        if (scheduledAt.getTime() <= input.notBefore.getTime()) continue;
        planned.push({
          scheduleId: s.id,
          slotId: slot.id,
          medicationId: s.medicationId,
          scheduledAt,
        });
      }
    }
  }
  return planned.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
}
