import { describe, expect, it } from 'vitest';
import {
  applyFrequency,
  applyMealPreset,
  applySlot,
  applyUnits,
  applyWeekdays,
  anchorSlot,
  type DraftMed,
  draftToRecords,
  exactTimeSlot,
  nextQuestion,
  scheduleDates,
  splitUnsupported,
  toggleWeekday,
} from './draft.ts';

function med(fields: Partial<DraftMed>): DraftMed {
  return {
    name: null,
    doseAmount: null,
    doseUnit: null,
    unitsPerIntake: null,
    unitForm: null,
    frequencyType: null,
    everyNDays: null,
    weekdays: null,
    timesPerDay: null,
    slots: [],
    mealRelation: null,
    mealOffsetMin: null,
    durationDays: null,
    startDate: null,
    endDate: null,
    notes: null,
    unsupportedReason: null,
    ...fields,
  };
}

const complete = med({
  name: 'Омега-3',
  unitsPerIntake: 1,
  unitForm: 'капсула',
  frequencyType: 'daily',
  timesPerDay: 1,
  slots: [anchorSlot('breakfast')],
});

describe('nextQuestion', () => {
  it('returns null for a complete draft', () => {
    expect(nextQuestion([complete])).toBeNull();
  });

  it('asks in order: name → frequency → units → slot', () => {
    expect(nextQuestion([med({})])).toEqual({ kind: 'name', med: 0 });
    expect(nextQuestion([med({ name: 'Магний' })])).toEqual({ kind: 'frequency', med: 0 });
    expect(nextQuestion([med({ name: 'Магний', frequencyType: 'daily' })])).toEqual({
      kind: 'units',
      med: 0,
    });
    expect(
      nextQuestion([med({ name: 'Магний', frequencyType: 'daily', unitsPerIntake: 1 })]),
    ).toEqual({ kind: 'slot', med: 0, index: 0, total: 1, mealPreset: null });
  });

  it('moves to the next medication once the first is complete', () => {
    expect(nextQuestion([complete, med({ name: 'Магний' })])).toEqual({
      kind: 'frequency',
      med: 1,
    });
  });

  it('asks for each remaining slot', () => {
    const m = med({
      name: 'Магний',
      frequencyType: 'daily',
      unitsPerIntake: 1,
      timesPerDay: 2,
      slots: [anchorSlot('breakfast')],
    });
    expect(nextQuestion([m])).toMatchObject({ kind: 'slot', index: 1, total: 2 });
  });

  it('offers a meal preset for "N times a day after meals"', () => {
    const m = med({
      name: 'Магне B6',
      frequencyType: 'daily',
      unitsPerIntake: 1,
      timesPerDay: 3,
      mealRelation: 'after',
    });
    expect(nextQuestion([m])).toMatchObject({
      kind: 'slot',
      mealPreset: { anchors: ['breakfast', 'lunch', 'dinner'], offsetMin: 0, relation: 'after' },
    });
  });

  it('uses -30 min for "before meals" without an explicit offset', () => {
    const m = med({
      name: 'X',
      frequencyType: 'daily',
      unitsPerIntake: 1,
      timesPerDay: 2,
      mealRelation: 'before',
    });
    expect(nextQuestion([m])).toMatchObject({
      mealPreset: { anchors: ['breakfast', 'dinner'], offsetMin: -30 },
    });
  });

  it('offers no preset for a single daily intake', () => {
    const m = med({
      name: 'X',
      frequencyType: 'daily',
      unitsPerIntake: 1,
      timesPerDay: 1,
      mealRelation: 'after',
    });
    expect(nextQuestion([m])).toMatchObject({ kind: 'slot', mealPreset: null });
  });

  it('needs one slot for a one-time intake', () => {
    const m = med({ name: 'X', frequencyType: 'once', unitsPerIntake: 1, timesPerDay: 3 });
    expect(nextQuestion([m])).toMatchObject({ kind: 'slot', total: 1 });
  });
});

describe('applying answers', () => {
  it('applies frequency choices', () => {
    const [m] = applyFrequency([med({ name: 'X' })], 0, 'every_other_day');
    expect(m).toMatchObject({ frequencyType: 'every_n_days', everyNDays: 2 });
  });

  it('applies sorted unique weekdays and rejects an empty set', () => {
    expect(applyWeekdays([med({})], 0, [5, 1, 5])[0]).toMatchObject({
      frequencyType: 'weekdays',
      weekdays: [1, 5],
    });
    expect(() => applyWeekdays([med({})], 0, [])).toThrow();
  });

  it('toggles weekdays', () => {
    expect(toggleWeekday([1, 5], 3)).toEqual([1, 3, 5]);
    expect(toggleWeekday([1, 3, 5], 3)).toEqual([1, 5]);
  });

  it('applies units and slots', () => {
    let meds = applyUnits([med({})], 0, 2);
    meds = applySlot(meds, 0, exactTimeSlot(570));
    expect(meds[0]).toMatchObject({
      unitsPerIntake: 2,
      slots: [{ time: '09:30', anchor: null }],
    });
  });

  it('applies a meal preset', () => {
    const [m] = applyMealPreset([med({})], 0, {
      anchors: ['breakfast', 'dinner'],
      offsetMin: -30,
      relation: 'before',
    });
    expect(m!.slots).toEqual([
      { time: null, anchor: 'breakfast', anchorOffsetMin: -30 },
      { time: null, anchor: 'dinner', anchorOffsetMin: -30 },
    ]);
    expect(m!.timesPerDay).toBe(2);
  });

  it('does not mutate the input', () => {
    const meds = [med({})];
    applyUnits(meds, 0, 2);
    expect(meds[0]!.unitsPerIntake).toBeNull();
  });
});

describe('splitUnsupported', () => {
  it('separates unsupported schemes', () => {
    const result = splitUnsupported([
      complete,
      med({ name: 'Преднизолон', unsupportedReason: 'stepped_dose' }),
    ]);
    expect(result.supported).toEqual([complete]);
    expect(result.unsupported).toEqual([{ name: 'Преднизолон', reason: 'stepped_dose' }]);
  });
});

describe('scheduleDates / draftToRecords', () => {
  const today = '2026-11-07';

  it('starts today and computes the end from the course length', () => {
    expect(scheduleDates({ ...complete, durationDays: 30 }, today)).toEqual({
      start: '2026-11-07',
      end: '2026-12-06',
    });
    expect(scheduleDates(complete, today)).toEqual({ start: today, end: null });
  });

  it('respects explicit dates and one-time intakes', () => {
    expect(
      scheduleDates({ ...complete, startDate: '2026-11-10', durationDays: 10 }, today),
    ).toEqual({ start: '2026-11-10', end: '2026-11-19' });
    expect(scheduleDates({ ...complete, frequencyType: 'once' }, today)).toEqual({
      start: today,
      end: today,
    });
  });

  it('converts a complete draft into records', () => {
    const [record] = draftToRecords(
      [{ ...complete, doseAmount: 1000, doseUnit: 'МЕ', slots: [exactTimeSlot(540)] }],
      today,
    );
    expect(record).toEqual({
      medication: {
        name: 'Омега-3',
        doseAmount: '1000',
        doseUnit: 'МЕ',
        unitsPerIntake: '1',
        unitForm: 'капсула',
        notes: null,
      },
      schedule: {
        frequencyType: 'daily',
        everyNDays: null,
        weekdays: null,
        startDate: today,
        endDate: null,
      },
      slots: [{ time: '09:00', anchor: null, anchorOffsetMin: 0 }],
    });
  });

  it('refuses an incomplete draft', () => {
    expect(() => draftToRecords([med({ name: 'X' })], today)).toThrow(/incomplete/);
  });
});
