// Draft clarification logic: which field to ask next, applying answers, and turning a
// complete draft into DB records. Pure functions, no grammY / DB dependencies.
import type { Anchor, ParsedMedication, ParsedSlot, UnsupportedReason } from '@ovimuu/ai';
import { addDays } from './dates.ts';
import { toDbTime } from './anchors.ts';

export type DraftMed = ParsedMedication;

export type FrequencyChoice = 'daily' | 'every_other_day' | 'weekdays' | 'once';

export type Question =
  | { kind: 'name'; med: number }
  | { kind: 'frequency'; med: number }
  | { kind: 'weekdays'; med: number; selected: number[] }
  | { kind: 'units'; med: number }
  | {
      kind: 'slot';
      med: number;
      /** 0-based index of the slot being asked; `total` slots are needed. */
      index: number;
      total: number;
      /** One-tap meal preset ("после завтрака, обеда и ужина"), when applicable. */
      mealPreset: MealPreset | null;
    };

export interface MealPreset {
  anchors: Anchor[];
  offsetMin: number;
  relation: 'before' | 'during' | 'after';
}

/** Number of intake moments a med needs per day. */
export function requiredSlotCount(m: DraftMed): number {
  if (m.frequencyType === 'once') return 1;
  return Math.max(m.timesPerDay ?? 1, 1);
}

const MEAL_ANCHORS: Record<number, Anchor[]> = {
  2: ['breakfast', 'dinner'],
  3: ['breakfast', 'lunch', 'dinner'],
};

/** "2–3 раза в день до/во время/после еды" with no meals named → a one-tap preset. */
export function mealPresetFor(m: DraftMed): MealPreset | null {
  const anchors = MEAL_ANCHORS[requiredSlotCount(m)];
  if (!m.mealRelation || !anchors || m.slots.length > 0) return null;
  const defaultOffset = m.mealRelation === 'before' ? -30 : 0;
  return { anchors, offsetMin: m.mealOffsetMin ?? defaultOffset, relation: m.mealRelation };
}

/** The next missing required field, in order: name → frequency → units → slots. */
export function nextQuestion(meds: DraftMed[]): Question | null {
  for (const [i, m] of meds.entries()) {
    if (!m.name) return { kind: 'name', med: i };
    if (!m.frequencyType) return { kind: 'frequency', med: i };
    if (m.unitsPerIntake === null) return { kind: 'units', med: i };
    const total = requiredSlotCount(m);
    if (m.slots.length < total) {
      return { kind: 'slot', med: i, index: m.slots.length, total, mealPreset: mealPresetFor(m) };
    }
  }
  return null;
}

function updateMed(meds: DraftMed[], index: number, patch: Partial<DraftMed>): DraftMed[] {
  if (!meds[index]) throw new Error(`No medication at index ${index}`);
  return meds.map((m, i) => (i === index ? { ...m, ...patch } : m));
}

export const applyName = (meds: DraftMed[], i: number, name: string) =>
  updateMed(meds, i, { name: name.trim() });

/** "weekdays" needs a follow-up question, so it is applied via applyWeekdays. */
export function applyFrequency(
  meds: DraftMed[],
  i: number,
  choice: Exclude<FrequencyChoice, 'weekdays'>,
): DraftMed[] {
  switch (choice) {
    case 'daily':
      return updateMed(meds, i, { frequencyType: 'daily', everyNDays: null, weekdays: null });
    case 'every_other_day':
      return updateMed(meds, i, { frequencyType: 'every_n_days', everyNDays: 2, weekdays: null });
    case 'once':
      return updateMed(meds, i, { frequencyType: 'once', everyNDays: null, weekdays: null });
  }
}

export function applyWeekdays(meds: DraftMed[], i: number, days: number[]): DraftMed[] {
  const weekdays = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (weekdays.length === 0) throw new Error('At least one weekday is required');
  return updateMed(meds, i, { frequencyType: 'weekdays', weekdays, everyNDays: null });
}

export function toggleWeekday(selected: number[], day: number): number[] {
  return selected.includes(day)
    ? selected.filter((d) => d !== day)
    : [...selected, day].sort((a, b) => a - b);
}

export const applyUnits = (meds: DraftMed[], i: number, units: number) =>
  updateMed(meds, i, { unitsPerIntake: units });

export function applySlot(meds: DraftMed[], i: number, slot: ParsedSlot): DraftMed[] {
  return updateMed(meds, i, { slots: [...meds[i]!.slots, slot] });
}

export function applyMealPreset(meds: DraftMed[], i: number, preset: MealPreset): DraftMed[] {
  const slots = preset.anchors.map((anchor) => ({
    time: null,
    anchor,
    anchorOffsetMin: preset.offsetMin || null,
  }));
  return updateMed(meds, i, { slots, timesPerDay: slots.length });
}

export const exactTimeSlot = (minutes: number): ParsedSlot => ({
  time: toDbTime(minutes),
  anchor: null,
  anchorOffsetMin: null,
});

export const anchorSlot = (anchor: Anchor): ParsedSlot => ({
  time: null,
  anchor,
  anchorOffsetMin: null,
});

export function splitUnsupported(meds: DraftMed[]): {
  supported: DraftMed[];
  unsupported: { name: string | null; reason: UnsupportedReason }[];
} {
  const supported: DraftMed[] = [];
  const unsupported: { name: string | null; reason: UnsupportedReason }[] = [];
  for (const m of meds) {
    if (m.unsupportedReason) unsupported.push({ name: m.name, reason: m.unsupportedReason });
    else supported.push(m);
  }
  return { supported, unsupported };
}

/** Effective dates shown on the card and saved: start defaults to today. */
export function scheduleDates(m: DraftMed, today: string): { start: string; end: string | null } {
  const start = m.startDate ?? today;
  if (m.frequencyType === 'once') return { start, end: start };
  if (m.endDate) return { start, end: m.endDate };
  if (m.durationDays && m.durationDays > 0)
    return { start, end: addDays(start, m.durationDays - 1) };
  return { start, end: null };
}

export interface MedicationRecord {
  medication: {
    name: string;
    doseAmount: string | null;
    doseUnit: string | null;
    unitsPerIntake: string;
    unitForm: string | null;
    notes: string | null;
  };
  schedule: {
    frequencyType: 'daily' | 'every_n_days' | 'weekdays' | 'once';
    everyNDays: number | null;
    weekdays: number[] | null;
    startDate: string;
    endDate: string | null;
  };
  slots: { time: string | null; anchor: Anchor | null; anchorOffsetMin: number }[];
}

/** Converts a complete draft into DB records. Throws if anything is still missing. */
export function draftToRecords(meds: DraftMed[], today: string): MedicationRecord[] {
  if (nextQuestion(meds) !== null) throw new Error('Draft is incomplete');
  return meds.map((m) => {
    const { start, end } = scheduleDates(m, today);
    return {
      medication: {
        name: m.name!,
        doseAmount: m.doseAmount === null ? null : String(m.doseAmount),
        doseUnit: m.doseUnit,
        unitsPerIntake: String(m.unitsPerIntake),
        unitForm: m.unitForm,
        notes: m.notes,
      },
      schedule: {
        frequencyType: m.frequencyType!,
        everyNDays: m.frequencyType === 'every_n_days' ? m.everyNDays : null,
        weekdays: m.frequencyType === 'weekdays' ? m.weekdays : null,
        startDate: start,
        endDate: end,
      },
      slots: m.slots.map((s) => ({
        time: s.time,
        anchor: s.time ? null : s.anchor,
        anchorOffsetMin: s.time ? 0 : (s.anchorOffsetMin ?? 0),
      })),
    };
  });
}
