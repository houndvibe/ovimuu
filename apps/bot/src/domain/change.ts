// Schedule changes by phrase: previews, missing parameters, pause dates, which intake to
// mark. Pure functions, no grammY / DB dependencies.
import type { Anchor, IntentResult, ParsedSlot } from '@ovimuu/ai';
import { addDays } from './dates.ts';
import type { DraftMed } from './draft.ts';
import { isoWeekday } from './intakes.ts';

export type ChangeIntent =
  'change_time' | 'change_amount' | 'pause' | 'resume' | 'complete' | 'delete';

export const CHANGE_INTENTS: readonly ChangeIntent[] = [
  'change_time',
  'change_amount',
  'pause',
  'resume',
  'complete',
  'delete',
];
export const isChangeIntent = (i: string): i is ChangeIntent =>
  (CHANGE_INTENTS as readonly string[]).includes(i);

/** A medication with its current (non-completed) schedule, as stored. */
export interface MedState {
  medicationId: number;
  scheduleId: number;
  name: string;
  doseAmount: number | null;
  doseUnit: string | null;
  unitsPerIntake: number;
  unitForm: string | null;
  notes: string | null;
  frequencyType: 'daily' | 'every_n_days' | 'weekdays' | 'once';
  everyNDays: number | null;
  weekdays: number[] | null;
  startDate: string;
  endDate: string | null;
  status: 'active' | 'paused' | 'completed';
  pausedUntil: string | null;
  slots: { time: string | null; anchor: Anchor | null; anchorOffsetMin: number }[];
}

export interface ChangeParams {
  slots: ParsedSlot[] | null;
  unitsPerIntake: number | null;
  /** Resume date for a pause (exclusive end). */
  pauseUntil: string | null;
  /** "Пока не скажу": paused until resumed explicitly. */
  pauseIndefinite: boolean;
}

/** Same shape as a draft medication, so cards and summaries can be reused. */
export function toDraftMed(s: MedState): DraftMed {
  return {
    name: s.name,
    doseAmount: s.doseAmount,
    doseUnit: s.doseUnit,
    unitsPerIntake: s.unitsPerIntake,
    unitForm: s.unitForm,
    frequencyType: s.frequencyType,
    everyNDays: s.everyNDays,
    weekdays: s.weekdays,
    timesPerDay: s.slots.length,
    slots: s.slots.map((x) => ({
      time: x.time ? x.time.slice(0, 5) : null,
      anchor: x.time ? null : x.anchor,
      anchorOffsetMin: x.anchorOffsetMin || null,
    })),
    mealRelation: null,
    mealOffsetMin: null,
    durationDays: null,
    startDate: s.startDate,
    endDate: s.endDate,
    notes: s.notes,
    unsupportedReason: null,
  };
}

/** First day strictly after `today` that falls on ISO weekday `weekday`. */
export function nextWeekday(today: string, weekday: number): string {
  let date = addDays(today, 1);
  while (isoWeekday(date) !== weekday) date = addDays(date, 1);
  return date;
}

/** Resume date from what the model extracted; null if none or not in the future. */
export function resolvePauseUntil(
  p: Pick<IntentResult['params'], 'pauseUntil' | 'pauseUntilWeekday' | 'pauseDays'>,
  today: string,
): string | null {
  let date: string | null = null;
  if (p.pauseUntil) date = p.pauseUntil;
  else if (p.pauseUntilWeekday) date = nextWeekday(today, p.pauseUntilWeekday);
  else if (p.pauseDays && p.pauseDays > 0) date = addDays(today, p.pauseDays);
  return date && date > today ? date : null;
}

export function paramsFromIntent(r: IntentResult, today: string): ChangeParams {
  const slots = r.params.slots?.filter((s) => s.time !== null || s.anchor !== null) ?? null;
  return {
    slots: slots?.length ? slots : null,
    unitsPerIntake:
      r.params.unitsPerIntake !== null && r.params.unitsPerIntake > 0
        ? r.params.unitsPerIntake
        : null,
    pauseUntil: resolvePauseUntil(r.params, today),
    pauseIndefinite: false,
  };
}

/** Which parameter still has to be asked before showing the preview. */
export function missingParam(
  intent: ChangeIntent,
  p: ChangeParams,
): 'slot' | 'units' | 'pause' | null {
  if (intent === 'change_time' && !p.slots?.length) return 'slot';
  if (intent === 'change_amount' && p.unitsPerIntake === null) return 'units';
  if (intent === 'pause' && !p.pauseUntil && !p.pauseIndefinite) return 'pause';
  return null;
}

/** The medication state after applying the change (for "было → станет"). */
export function applyChange(s: MedState, intent: ChangeIntent, p: ChangeParams): MedState {
  switch (intent) {
    case 'change_time':
      return {
        ...s,
        slots: (p.slots ?? []).map((x) => ({
          time: x.time,
          anchor: x.time ? null : x.anchor,
          anchorOffsetMin: x.time ? 0 : (x.anchorOffsetMin ?? 0),
        })),
      };
    case 'change_amount':
      return { ...s, unitsPerIntake: p.unitsPerIntake ?? s.unitsPerIntake };
    case 'pause':
      return { ...s, status: 'paused', pausedUntil: p.pauseIndefinite ? null : p.pauseUntil };
    case 'resume':
      return { ...s, status: 'active', pausedUntil: null };
    case 'complete':
    case 'delete':
      return { ...s, status: 'completed' };
  }
}

/** For "выпила магний": today's open intake closest to now, or null (→ ad-hoc intake). */
export function pickIntakeToMark(
  candidates: { id: number; scheduledAt: Date }[],
  now: Date,
): number | null {
  let best: { id: number; distance: number } | null = null;
  for (const c of candidates) {
    const distance = Math.abs(c.scheduledAt.getTime() - now.getTime());
    if (!best || distance < best.distance) best = { id: c.id, distance };
  }
  return best?.id ?? null;
}

/** "Отменить" after marking by phrase works this long. */
export const MARK_UNDO_WINDOW_MS = 10 * 60 * 1000;
