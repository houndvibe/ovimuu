import { describe, expect, it } from 'vitest';
import {
  etcZoneForOffset,
  formatLocalTime,
  formatUtcOffset,
  isValidTimeZone,
  parseTimeZoneInput,
} from './timezone.ts';

// 2026-11-05 12:00 UTC
const now = new Date(Date.UTC(2026, 10, 5, 12, 0));

describe('etcZoneForOffset', () => {
  it('inverts the sign as IANA Etc zones require', () => {
    expect(etcZoneForOffset(5)).toBe('Etc/GMT-5');
    expect(etcZoneForOffset(-3)).toBe('Etc/GMT+3');
    expect(etcZoneForOffset(0)).toBe('Etc/UTC');
  });

  it('rejects out-of-range offsets', () => {
    expect(etcZoneForOffset(15)).toBeNull();
    expect(etcZoneForOffset(-13)).toBeNull();
    expect(etcZoneForOffset(2.5)).toBeNull();
  });

  it('produces zones Intl understands', () => {
    for (let h = -12; h <= 14; h++) expect(isValidTimeZone(etcZoneForOffset(h)!)).toBe(true);
  });
});

describe('formatLocalTime / formatUtcOffset', () => {
  it('formats wall-clock time in a zone', () => {
    expect(formatLocalTime(now, 'Europe/Moscow')).toBe('15:00');
    expect(formatLocalTime(new Date(Date.UTC(2026, 10, 5, 21, 5)), 'Europe/Moscow')).toBe('0:05');
    expect(formatLocalTime(now, 'Asia/Vladivostok')).toBe('22:00');
  });

  it('formats the UTC offset', () => {
    expect(formatUtcOffset(now, 'Europe/Moscow')).toBe('UTC+3');
    expect(formatUtcOffset(now, 'Etc/GMT+3')).toBe('UTC−3');
    expect(formatUtcOffset(now, 'Etc/UTC')).toBe('UTC');
  });
});

describe('parseTimeZoneInput', () => {
  it.each([
    ['17:00', 'Etc/GMT-5'],
    ['17.02', 'Etc/GMT-5'],
    ['1658', 'Etc/GMT-5'],
    ['9:00', 'Etc/GMT+3'],
    ['12:10', 'Etc/UTC'],
    // Ambiguous ±24h cases resolve to (-11h, +13h].
    ['0:00', 'Etc/GMT-12'], // Kamchatka, not UTC−12
    ['1:00', 'Etc/GMT-13'], // Tonga, not UTC−11
    ['2:00', 'Etc/GMT+10'], // Hawaii, not UTC+14
  ])('infers the zone from local time %s', (input, expected) => {
    expect(parseTimeZoneInput(input, now)).toBe(expected);
  });

  it.each([
    ['UTC+5', 'Etc/GMT-5'],
    ['utc +5', 'Etc/GMT-5'],
    ['GMT-3', 'Etc/GMT+3'],
    ['+7', 'Etc/GMT-7'],
    ['−2', 'Etc/GMT+2'],
    ['UTC+05:00', 'Etc/GMT-5'],
    ['UTC', 'Etc/UTC'],
    ['МСК', 'Etc/GMT-3'],
    ['мск+4', 'Etc/GMT-7'],
    ['МСК-1', 'Etc/GMT-2'],
  ])('parses offset %s', (input, expected) => {
    expect(parseTimeZoneInput(input, now)).toBe(expected);
  });

  it.each(['Казань', '', '25:00', '12:61', '12:30', 'UTC+20', 'UTC+5:30'])(
    'rejects %j',
    (input) => {
      expect(parseTimeZoneInput(input, now)).toBeNull();
    },
  );
});
