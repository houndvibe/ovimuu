import { describe, expect, it } from 'vitest';
import {
  groupDue,
  isOpen,
  localHour,
  nextRepeatAt,
  questKind,
  sleepCutoff,
  startOfLocalDay,
} from './reminders.ts';

const anchors = { wake: 480, breakfast: 540, lunch: 780, dinner: 1140, sleep: 1380 };
const tz = 'Europe/Moscow';
const msk = (s: string) => new Date(`${s}+03:00`);

describe('questKind', () => {
  it.each([
    [5, 'morning'],
    [11, 'morning'],
    [12, 'day'],
    [16, 'day'],
    [17, 'evening'],
    [21, 'evening'],
    [22, 'night'],
    [0, 'night'],
    [4, 'night'],
  ] as const)('%d → %s', (hour, kind) => {
    expect(questKind(hour)).toBe(kind);
  });

  it('reads the local hour', () => {
    expect(localHour(msk('2026-11-07T09:00:00'), tz)).toBe(9);
    expect(localHour(msk('2026-11-07T09:00:00'), 'Asia/Vladivostok')).toBe(16);
  });
});

describe('sleepCutoff', () => {
  it('is the same-day sleep anchor', () => {
    expect(sleepCutoff(msk('2026-11-07T09:00:00'), tz, anchors)).toEqual(
      msk('2026-11-07T23:00:00'),
    );
  });

  it('handles sleep after midnight', () => {
    const late = { ...anchors, sleep: 30 };
    expect(sleepCutoff(msk('2026-11-07T21:00:00'), tz, late)).toEqual(msk('2026-11-08T00:30:00'));
  });

  it('assigns intakes between midnight and wake-up to the previous day', () => {
    const late = { ...anchors, sleep: 60 };
    expect(sleepCutoff(msk('2026-11-08T00:30:00'), tz, late)).toEqual(msk('2026-11-08T01:00:00'));
  });
});

describe('nextRepeatAt', () => {
  const sentAt = msk('2026-11-07T09:00:00');
  const base = { sentAt, repeatCount: 2, repeatDelayMin: 30, cutoff: msk('2026-11-07T23:00:00') };

  it('schedules repeats k × delay after the reminder', () => {
    expect(nextRepeatAt({ ...base, repeatsSent: 0 })).toEqual(msk('2026-11-07T09:30:00'));
    expect(nextRepeatAt({ ...base, repeatsSent: 1 })).toEqual(msk('2026-11-07T10:00:00'));
  });

  it('stops after repeatCount', () => {
    expect(nextRepeatAt({ ...base, repeatsSent: 2 })).toBeNull();
    expect(nextRepeatAt({ ...base, repeatCount: 0, repeatsSent: 0 })).toBeNull();
  });

  it('never repeats after the sleep anchor', () => {
    expect(
      nextRepeatAt({
        ...base,
        sentAt: msk('2026-11-07T22:45:00'),
        repeatsSent: 0,
      }),
    ).toBeNull();
  });
});

describe('startOfLocalDay', () => {
  it('is local midnight in UTC', () => {
    expect(startOfLocalDay(msk('2026-11-07T15:00:00'), tz)).toEqual(msk('2026-11-07T00:00:00'));
    expect(startOfLocalDay(msk('2026-11-07T01:00:00'), 'Etc/UTC')).toEqual(
      new Date('2026-11-06T00:00:00Z'),
    );
  });
});

describe('groupDue / isOpen', () => {
  it('groups by user and exact time', () => {
    const t1 = msk('2026-11-07T09:00:00');
    const t2 = msk('2026-11-07T19:00:00');
    const groups = groupDue([
      { id: 1, userId: 1, scheduledAt: t1 },
      { id: 2, userId: 1, scheduledAt: new Date(t1) },
      { id: 3, userId: 2, scheduledAt: t1 },
      { id: 4, userId: 1, scheduledAt: t2 },
    ]);
    expect(groups.map((g) => g.map((i) => i.id))).toEqual([[1, 2], [3], [4]]);
  });

  it('treats not_marked as still markable', () => {
    expect(isOpen('not_marked')).toBe(true);
    expect(isOpen('taken')).toBe(false);
  });
});
