import { describe, expect, it } from 'vitest';
import { addDays, formatDateRu, localDate } from './dates.ts';
import { parseAmount, parseClockTime } from './parse-input.ts';
import { formatDays, formatUnits, pluralRu } from './plural.ts';

describe('pluralRu / formatUnits', () => {
  it.each([
    [1, 'таблетка'],
    [2, 'таблетки'],
    [5, 'таблеток'],
    [11, 'таблеток'],
    [21, 'таблетка'],
    [22, 'таблетки'],
    [0.5, 'таблетки'],
  ])('%d → %s', (n, form) => {
    expect(pluralRu(n, 'таблетка', 'таблетки', 'таблеток')).toBe(form);
  });

  it('formats known, unknown and missing forms', () => {
    expect(formatUnits(2, 'капсула')).toBe('2 капсулы');
    expect(formatUnits(10, 'капли')).toBe('10 капель');
    expect(formatUnits(0.5, 'таблетка')).toBe('0,5 таблетки');
    expect(formatUnits(1, 'саше')).toBe('1 саше');
    expect(formatUnits(2, null)).toBe('2 шт.');
    expect(formatDays(30)).toBe('30 дней');
    expect(formatDays(21)).toBe('21 день');
  });
});

describe('parseAmount', () => {
  it.each([
    ['2', 2],
    ['1.5', 1.5],
    ['1,5', 1.5],
    ['2 таблетки', 2],
    ['½', 0.5],
    ['половину', 0.5],
  ])('%j → %d', (input, n) => {
    expect(parseAmount(input)).toBe(n);
  });

  it.each(['', 'две', '0', '100', '2x'])('rejects %j', (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});

describe('parseClockTime', () => {
  it.each([
    ['9:30', 570],
    ['09.30', 570],
    ['930', 570],
    ['21', 1260],
    ['в 8:00', 480],
    ['0:15', 15],
  ])('%j → %d', (input, minutes) => {
    expect(parseClockTime(input)).toBe(minutes);
  });

  it.each(['24:00', '9:60', 'утром', ''])('rejects %j', (input) => {
    expect(parseClockTime(input)).toBeNull();
  });
});

describe('dates', () => {
  it('computes the local date in a time zone', () => {
    const late = new Date(Date.UTC(2026, 10, 7, 22, 30)); // 01:30 next day in Moscow
    expect(localDate(late, 'Europe/Moscow')).toBe('2026-11-08');
    expect(localDate(late, 'Etc/UTC')).toBe('2026-11-07');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-11-07', 29)).toBe('2026-12-06');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('formats dates in Russian', () => {
    expect(formatDateRu('2026-12-06', '2026-11-07')).toBe('6 декабря');
    expect(formatDateRu('2027-01-10', '2026-11-07')).toBe('10 января 2027');
  });
});
