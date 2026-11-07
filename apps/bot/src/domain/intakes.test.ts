import { describe, expect, it } from 'vitest';
import {
  isoWeekday,
  isScheduleDay,
  localToUtc,
  planIntakes,
  type ScheduleInput,
  slotMinutes,
  tzOffsetMinutes,
} from './intakes.ts';

const anchors = { wake: 480, breakfast: 540, lunch: 780, dinner: 1140, sleep: 1380 };
const iso = (d: Date) => d.toISOString().replace(':00.000Z', 'Z');

function schedule(fields: Partial<ScheduleInput>): ScheduleInput {
  return {
    id: 1,
    medicationId: 10,
    frequencyType: 'daily',
    everyNDays: null,
    weekdays: null,
    startDate: '2026-11-01',
    endDate: null,
    status: 'active',
    pausedUntil: null,
    slots: [{ id: 100, time: null, anchor: 'breakfast', anchorOffsetMin: 0 }],
    ...fields,
  };
}

describe('localToUtc', () => {
  it('converts in fixed-offset zones', () => {
    expect(iso(localToUtc('2026-11-07', 540, 'Europe/Moscow'))).toBe('2026-11-07T06:00Z');
    expect(iso(localToUtc('2026-11-07', 540, 'Asia/Vladivostok'))).toBe('2026-11-06T23:00Z');
    expect(iso(localToUtc('2026-11-07', 540, 'Etc/GMT+3'))).toBe('2026-11-07T12:00Z');
    expect(iso(localToUtc('2026-11-07', 0, 'Etc/UTC'))).toBe('2026-11-07T00:00Z');
  });

  it('handles DST in Europe/Berlin', () => {
    expect(iso(localToUtc('2026-07-01', 540, 'Europe/Berlin'))).toBe('2026-07-01T07:00Z');
    expect(iso(localToUtc('2026-12-01', 540, 'Europe/Berlin'))).toBe('2026-12-01T08:00Z');
  });

  it('shifts a nonexistent time forward (spring gap)', () => {
    // 2026-03-29 02:30 does not exist in Berlin; becomes 03:30 CEST = 01:30Z.
    expect(iso(localToUtc('2026-03-29', 150, 'Europe/Berlin'))).toBe('2026-03-29T01:30Z');
  });

  it('picks the first occurrence of an ambiguous time (autumn overlap)', () => {
    // 2026-10-25 02:30 happens twice in Berlin; first is CEST (UTC+2) = 00:30Z.
    expect(iso(localToUtc('2026-10-25', 150, 'Europe/Berlin'))).toBe('2026-10-25T00:30Z');
  });

  it('computes offsets', () => {
    expect(tzOffsetMinutes(Date.UTC(2026, 10, 7), 'Europe/Moscow')).toBe(180);
    expect(tzOffsetMinutes(Date.UTC(2026, 10, 7), 'Etc/GMT+3')).toBe(-180);
  });
});

describe('isScheduleDay', () => {
  it('respects start and end dates (inclusive)', () => {
    const s = schedule({ startDate: '2026-11-05', endDate: '2026-11-07' });
    expect(isScheduleDay(s, '2026-11-04')).toBe(false);
    expect(isScheduleDay(s, '2026-11-05')).toBe(true);
    expect(isScheduleDay(s, '2026-11-07')).toBe(true);
    expect(isScheduleDay(s, '2026-11-08')).toBe(false);
  });

  it('counts every-N-days from the start date', () => {
    const s = schedule({ frequencyType: 'every_n_days', everyNDays: 2, startDate: '2026-11-01' });
    expect(
      ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((d) => isScheduleDay(s, d)),
    ).toEqual([true, false, true, false]);
    const every3 = schedule({
      frequencyType: 'every_n_days',
      everyNDays: 3,
      startDate: '2026-11-30',
    });
    expect(isScheduleDay(every3, '2026-12-03')).toBe(true);
  });

  it('uses ISO weekdays', () => {
    expect(isoWeekday('2026-11-09')).toBe(1); // Monday
    expect(isoWeekday('2026-11-08')).toBe(7); // Sunday
    const s = schedule({ frequencyType: 'weekdays', weekdays: [1, 4] });
    expect(isScheduleDay(s, '2026-11-09')).toBe(true);
    expect(isScheduleDay(s, '2026-11-12')).toBe(true);
    expect(isScheduleDay(s, '2026-11-10')).toBe(false);
  });

  it('has a single day for one-time intakes', () => {
    const s = schedule({ frequencyType: 'once', startDate: '2026-11-07' });
    expect(isScheduleDay(s, '2026-11-07')).toBe(true);
    expect(isScheduleDay(s, '2026-11-08')).toBe(false);
  });

  it('treats paused_until as the resume date', () => {
    const s = schedule({ status: 'paused', pausedUntil: '2026-11-15' });
    expect(isScheduleDay(s, '2026-11-14')).toBe(false);
    expect(isScheduleDay(s, '2026-11-15')).toBe(true);
    expect(isScheduleDay(schedule({ status: 'paused' }), '2027-01-01')).toBe(false);
  });

  it('never produces intakes for completed schedules', () => {
    expect(isScheduleDay(schedule({ status: 'completed' }), '2026-11-07')).toBe(false);
  });
});

describe('slotMinutes', () => {
  it('handles exact times, anchors and offsets', () => {
    expect(
      slotMinutes({ id: 1, time: '21:30:00', anchor: null, anchorOffsetMin: 0 }, anchors),
    ).toBe(1290);
    expect(
      slotMinutes({ id: 1, time: null, anchor: 'breakfast', anchorOffsetMin: -30 }, anchors),
    ).toBe(510);
  });

  it('moves sleep after midnight to the next day', () => {
    const late = { ...anchors, sleep: 30 };
    expect(slotMinutes({ id: 1, time: null, anchor: 'sleep', anchorOffsetMin: 0 }, late)).toBe(
      1470,
    );
    expect(slotMinutes({ id: 1, time: null, anchor: 'sleep', anchorOffsetMin: 0 }, anchors)).toBe(
      1380,
    );
  });
});

describe('planIntakes', () => {
  const base = { anchors, timezone: 'Europe/Moscow', notBefore: new Date(0) };

  it('plans one intake per slot per schedule day, sorted by time', () => {
    const s = schedule({
      slots: [
        { id: 101, time: null, anchor: 'dinner', anchorOffsetMin: 0 },
        { id: 100, time: null, anchor: 'breakfast', anchorOffsetMin: 0 },
      ],
    });
    const planned = planIntakes({ ...base, schedules: [s], dates: ['2026-11-07', '2026-11-08'] });
    expect(planned.map((p) => [p.slotId, iso(p.scheduledAt)])).toEqual([
      [100, '2026-11-07T06:00Z'],
      [101, '2026-11-07T16:00Z'],
      [100, '2026-11-08T06:00Z'],
      [101, '2026-11-08T16:00Z'],
    ]);
    expect(planned[0]).toMatchObject({ scheduleId: 1, medicationId: 10 });
  });

  it('skips intakes at or before notBefore', () => {
    const planned = planIntakes({
      ...base,
      schedules: [schedule({})],
      dates: ['2026-11-07', '2026-11-08'],
      notBefore: new Date('2026-11-07T12:00:00Z'), // 15:00 Moscow, after breakfast
    });
    expect(planned.map((p) => iso(p.scheduledAt))).toEqual(['2026-11-08T06:00Z']);
  });

  it('places "before sleep" after midnight on the next calendar day', () => {
    const s = schedule({ slots: [{ id: 100, time: null, anchor: 'sleep', anchorOffsetMin: 0 }] });
    const planned = planIntakes({
      ...base,
      anchors: { ...anchors, sleep: 30 },
      schedules: [s],
      dates: ['2026-11-07'],
    });
    // 2026-11-08 00:30 Moscow = 2026-11-07 21:30Z
    expect(planned.map((p) => iso(p.scheduledAt))).toEqual(['2026-11-07T21:30Z']);
  });

  it('keeps the logical day for schedule rules when a slot crosses midnight', () => {
    // Weekdays: Saturday only (6). Sleep at 00:30 → the intake lands on Sunday's calendar date.
    const s = schedule({
      frequencyType: 'weekdays',
      weekdays: [6],
      slots: [{ id: 100, time: null, anchor: 'sleep', anchorOffsetMin: 0 }],
    });
    const planned = planIntakes({
      ...base,
      anchors: { ...anchors, sleep: 30 },
      schedules: [s],
      dates: ['2026-11-07', '2026-11-08'], // Sat, Sun
    });
    expect(planned.map((p) => iso(p.scheduledAt))).toEqual(['2026-11-07T21:30Z']);
  });

  it('uses the user time zone', () => {
    const planned = planIntakes({
      ...base,
      timezone: 'Asia/Vladivostok',
      schedules: [schedule({})],
      dates: ['2026-11-07'],
    });
    expect(planned.map((p) => iso(p.scheduledAt))).toEqual(['2026-11-06T23:00Z']);
  });
});
