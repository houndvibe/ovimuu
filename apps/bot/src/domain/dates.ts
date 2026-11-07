// Calendar date helpers on "YYYY-MM-DD" strings. Pure functions.

/** User's local calendar date in `tz`, as YYYY-MM-DD. */
export function localDate(now: Date, tz: string): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** "2026-12-06" → "6 декабря" (year added when it differs from `today`'s year). */
export function formatDateRu(date: string, today: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const base = `${day} ${MONTHS_GENITIVE[month - 1]}`;
  return year === Number(today.slice(0, 4)) ? base : `${base} ${year}`;
}
