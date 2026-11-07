import { describe, expect, it } from 'vitest';
import type { DraftMed } from './domain/draft.ts';
import { texts } from './texts.ts';

const anchors = { wake: 480, breakfast: 540, lunch: 780, dinner: 1140, sleep: 1380 };
const today = '2026-11-07';

function med(fields: Partial<DraftMed>): DraftMed {
  return {
    name: 'Магний',
    doseAmount: null,
    doseUnit: null,
    unitsPerIntake: 1,
    unitForm: 'таблетка',
    frequencyType: 'daily',
    everyNDays: null,
    weekdays: null,
    timesPerDay: 1,
    slots: [{ time: null, anchor: 'breakfast', anchorOffsetMin: null }],
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

describe('medication card', () => {
  const card = (fields: Partial<DraftMed>) => texts.add.medCard(med(fields), anchors, today);

  it('shows dose, units, frequency and slot times', () => {
    expect(
      card({ name: 'Витамин D3', doseAmount: 2000, doseUnit: 'МЕ', unitForm: 'капсула' }),
    ).toBe('💊 Витамин D3 2000 МЕ — 1 капсула\n   каждый день · завтрак (9:00)');
  });

  it('shows anchor offsets with the resulting time', () => {
    expect(card({ slots: [{ time: null, anchor: 'breakfast', anchorOffsetMin: -30 }] })).toContain(
      'за 30 мин до завтрака (8:30)',
    );
    expect(card({ slots: [{ time: '21:00', anchor: null, anchorOffsetMin: null }] })).toContain(
      'в 21:00',
    );
  });

  it('shows course length and end date', () => {
    expect(card({ durationDays: 30 })).toContain('30 дней, до 6 декабря');
    expect(card({ startDate: '2026-11-10', endDate: '2026-11-20' })).toContain(
      'с 10 ноября, до 20 ноября',
    );
  });

  it('describes other frequencies', () => {
    expect(card({ frequencyType: 'every_n_days', everyNDays: 2 })).toContain('через день');
    expect(card({ frequencyType: 'every_n_days', everyNDays: 3 })).toContain('раз в 3 дня');
    expect(card({ frequencyType: 'weekdays', weekdays: [1, 4] })).toContain('пн, чт');
    expect(card({ frequencyType: 'once' })).toContain('один раз');
  });

  it('describes meal presets for buttons', () => {
    expect(
      texts.add.mealPresetButton({
        anchors: ['breakfast', 'lunch', 'dinner'],
        offsetMin: 0,
        relation: 'after',
      }),
    ).toBe('После завтрака, обеда и ужина');
    expect(
      texts.add.mealPresetButton({
        anchors: ['breakfast', 'dinner'],
        offsetMin: -30,
        relation: 'before',
      }),
    ).toBe('За 30 мин до завтрака и ужина');
  });
});
