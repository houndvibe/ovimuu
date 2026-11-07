import { describe, expect, it } from 'vitest';
import { med } from '../fixtures/parse.ts';
import { normalizeParseResult } from './normalize.ts';

const norm = (fields: Parameters<typeof med>[0]) =>
  normalizeParseResult({ medications: [med(fields)] }).medications[0]!;

describe('normalizeParseResult', () => {
  it('drops empty placeholder slots', () => {
    const m = norm({
      slots: [
        { time: null, anchor: 'breakfast', anchorOffsetMin: null },
        { time: null, anchor: null, anchorOffsetMin: null },
      ],
    });
    expect(m.slots).toEqual([{ time: null, anchor: 'breakfast', anchorOffsetMin: null }]);
  });

  it('lets an exact time win over an anchor', () => {
    const m = norm({ slots: [{ time: '09:00', anchor: 'wake', anchorOffsetMin: 10 }] });
    expect(m.slots).toEqual([{ time: '09:00', anchor: null, anchorOffsetMin: null }]);
  });

  it('turns "null" strings into null', () => {
    const m = norm({ name: 'Магний', doseUnit: 'null', unitForm: ' ', notes: 'NULL' });
    expect(m).toMatchObject({ name: 'Магний', doseUnit: null, unitForm: null, notes: null });
  });

  it('capitalizes the first letter of the name only', () => {
    expect(norm({ name: 'мелатонин' }).name).toBe('Мелатонин');
    expect(norm({ name: 'магне B6' }).name).toBe('Магне B6');
  });

  it('derives timesPerDay from named slots only when missing', () => {
    expect(
      norm({ slots: [{ time: '09:00', anchor: null, anchorOffsetMin: null }] }).timesPerDay,
    ).toBe(1);
    expect(
      norm({ timesPerDay: 2, slots: [{ time: '09:00', anchor: null, anchorOffsetMin: null }] })
        .timesPerDay,
    ).toBe(2);
    expect(norm({}).timesPerDay).toBeNull();
  });

  it('clears frequency params that do not match the frequency type', () => {
    const m = norm({ frequencyType: 'daily', everyNDays: 2, weekdays: [1] });
    expect(m).toMatchObject({ everyNDays: null, weekdays: null });
  });
});
