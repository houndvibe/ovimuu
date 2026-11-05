import { describe, expect, it } from 'vitest';
import {
  type Anchors,
  formatTime,
  parseTime,
  shiftTime,
  toDbTime,
  validateAnchors,
} from './anchors.ts';

const defaults: Anchors = { wake: 480, breakfast: 540, lunch: 780, dinner: 1140, sleep: 1380 };

describe('time conversions', () => {
  it('parses Postgres time values', () => {
    expect(parseTime('08:00:00')).toBe(480);
    expect(parseTime('23:30')).toBe(1410);
    expect(() => parseTime('8am')).toThrow();
  });

  it('formats for DB and display', () => {
    expect(toDbTime(485)).toBe('08:05');
    expect(formatTime(485)).toBe('8:05');
    expect(formatTime(0)).toBe('0:00');
  });

  it('shifts with wrap-around midnight', () => {
    expect(shiftTime(1410, 30)).toBe(0);
    expect(shiftTime(0, -30)).toBe(1410);
    expect(shiftTime(540, 30)).toBe(570);
  });
});

describe('validateAnchors', () => {
  it('accepts the defaults', () => {
    expect(validateAnchors(defaults)).toEqual({ ok: true });
  });

  it('accepts sleep after midnight', () => {
    expect(validateAnchors({ ...defaults, sleep: 30 })).toEqual({ ok: true });
  });

  it('rejects breakfast before wake', () => {
    expect(validateAnchors({ ...defaults, breakfast: 450 })).toEqual({
      ok: false,
      before: 'wake',
      after: 'breakfast',
    });
  });

  it('rejects equal adjacent anchors', () => {
    expect(validateAnchors({ ...defaults, dinner: 780 })).toMatchObject({ ok: false });
  });

  it('rejects sleep between wake and dinner', () => {
    expect(validateAnchors({ ...defaults, sleep: 1000 })).toEqual({
      ok: false,
      before: 'dinner',
      after: 'sleep',
    });
  });
});
