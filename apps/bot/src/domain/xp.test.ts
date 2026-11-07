import { describe, expect, it } from 'vitest';
import {
  isDayComplete,
  isXpEligible,
  levelForXp,
  levelProgress,
  newlyReachedLevels,
  xpForLevel,
} from './xp.ts';

describe('levels', () => {
  it('costs 100 × N to go from level N to N+1', () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 100, 300, 600, 1000]);
  });

  it.each([
    [0, 1],
    [99, 1],
    [100, 2],
    [299, 2],
    [300, 3],
    [600, 4],
  ])('%d XP → level %d', (xp, level) => {
    expect(levelForXp(xp)).toBe(level);
  });

  it('reports progress inside the level', () => {
    expect(levelProgress(130)).toEqual({ level: 2, current: 30, needed: 200 });
    expect(levelProgress(0)).toEqual({ level: 1, current: 0, needed: 100 });
  });

  it('lists levels above the best one reached', () => {
    expect(newlyReachedLevels(1, 3)).toEqual([2, 3]);
    expect(newlyReachedLevels(3, 2)).toEqual([]);
    expect(newlyReachedLevels(2, 2)).toEqual([]);
  });
});

describe('isXpEligible', () => {
  const at = new Date('2026-11-07T09:00:00Z');
  const hours = (h: number) => new Date(at.getTime() + h * 3_600_000);

  it('allows confirmation within 24 hours', () => {
    expect(isXpEligible({ scheduleId: 1, scheduledAt: at, confirmedAt: hours(0.2) })).toBe(true);
    expect(isXpEligible({ scheduleId: 1, scheduledAt: at, confirmedAt: hours(24) })).toBe(true);
    expect(isXpEligible({ scheduleId: 1, scheduledAt: at, confirmedAt: hours(24.1) })).toBe(false);
  });

  it('never gives XP for ad-hoc or unconfirmed intakes', () => {
    expect(isXpEligible({ scheduleId: null, scheduledAt: at, confirmedAt: at })).toBe(false);
    expect(isXpEligible({ scheduleId: 1, scheduledAt: at, confirmedAt: null })).toBe(false);
  });
});

describe('isDayComplete', () => {
  it('needs every intake of the day to have XP', () => {
    expect(isDayComplete([{ hasXp: true }, { hasXp: true }])).toBe(true);
    expect(isDayComplete([{ hasXp: true }, { hasXp: false }])).toBe(false);
    expect(isDayComplete([])).toBe(false);
  });
});
