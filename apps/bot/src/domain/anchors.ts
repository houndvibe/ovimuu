// Pure helpers for daily routine anchors. Times are minutes since local midnight.

export const ANCHOR_KEYS = ['wake', 'breakfast', 'lunch', 'dinner', 'sleep'] as const;
export type AnchorKey = (typeof ANCHOR_KEYS)[number];
export type Anchors = Record<AnchorKey, number>;

const MINUTES_PER_DAY = 24 * 60;
export const ANCHOR_STEP_MIN = 30;

export function isAnchorKey(value: string): value is AnchorKey {
  return (ANCHOR_KEYS as readonly string[]).includes(value);
}

/** Parses Postgres `time` ("08:00:00" or "08:00") into minutes since midnight. */
export function parseTime(value: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) throw new Error(`Invalid time value: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since midnight → "HH:MM" for Postgres `time`. */
export function toDbTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Minutes since midnight → "H:MM" for display. */
export function formatTime(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Shifts a time by `delta` minutes, wrapping around midnight. */
export function shiftTime(minutes: number, delta: number): number {
  return (((minutes + delta) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export type AnchorsValidation = { ok: true } | { ok: false; before: AnchorKey; after: AnchorKey };

/**
 * Daytime anchors must be strictly ordered: wake < breakfast < lunch < dinner.
 * Sleep must come after dinner, possibly after midnight (but before wake).
 */
export function validateAnchors(a: Anchors): AnchorsValidation {
  const day: AnchorKey[] = ['wake', 'breakfast', 'lunch', 'dinner'];
  for (let i = 1; i < day.length; i++) {
    const before = day[i - 1]!;
    const after = day[i]!;
    if (a[before] >= a[after]) return { ok: false, before, after };
  }
  const sleepOk = a.sleep > a.dinner || a.sleep < a.wake;
  return sleepOk ? { ok: true } : { ok: false, before: 'dinner', after: 'sleep' };
}
