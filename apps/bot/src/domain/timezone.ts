// Pure time zone helpers. No grammY / DB dependencies.

const MINUTES_PER_DAY = 24 * 60;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local wall-clock time in `tz`, formatted as "H:MM" (e.g. "9:05", "17:20"). */
export function formatLocalTime(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

/** UTC offset of `tz` at `now`, formatted as "UTC+3", "UTC−5", "UTC+5:30", "UTC". */
export function formatUtcOffset(now: Date, tz: string): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(now)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const offset = name.replace(/^GMT/, '');
  return offset === '' ? 'UTC' : `UTC${offset.replace('-', '−')}`;
}

/**
 * IANA zone for a whole-hour UTC offset. Note the inverted sign of Etc/GMT zones:
 * UTC+5 is "Etc/GMT-5". These zones have no DST.
 */
export function etcZoneForOffset(offsetHours: number): string | null {
  if (!Number.isInteger(offsetHours) || offsetHours < -12 || offsetHours > 14) return null;
  if (offsetHours === 0) return 'Etc/UTC';
  return offsetHours > 0 ? `Etc/GMT-${offsetHours}` : `Etc/GMT+${-offsetHours}`;
}

const MSK_OFFSET_HOURS = 3;
/** Max distance from a whole hour accepted when inferring the offset from typed local time. */
const LOCAL_TIME_TOLERANCE_MIN = 20;

/**
 * Parses free-form time zone input from the user, without AI:
 * - current local time: "14:35", "14.35", "1435", "9:05";
 * - UTC offset: "UTC+5", "GMT-3", "+5", "−2";
 * - Moscow-relative offset: "МСК+2", "мск-1".
 * Returns an IANA zone (Etc/* for offsets) or null if not understood.
 */
export function parseTimeZoneInput(input: string, now: Date): string | null {
  const text = input.trim().toLowerCase().replace(/−|–/g, '-').replace(/\s+/g, '');

  const msk = /^(?:мск|msk)(?:([+-])(\d{1,2}))?$/.exec(text);
  if (msk) {
    const delta = msk[1] ? Number(msk[2]) * (msk[1] === '-' ? -1 : 1) : 0;
    return etcZoneForOffset(MSK_OFFSET_HOURS + delta);
  }

  const offset = /^(?:utc|gmt)?([+-])(\d{1,2})(?::?00)?$/.exec(text);
  if (offset) {
    return etcZoneForOffset(Number(offset[2]) * (offset[1] === '-' ? -1 : 1));
  }
  if (text === 'utc' || text === 'gmt') return 'Etc/UTC';

  const time = /^(\d{1,2})[:.]?(\d{2})$/.exec(text);
  if (time) {
    const hours = Number(time[1]);
    const minutes = Number(time[2]);
    if (hours > 23 || minutes > 59) return null;
    const localMin = hours * 60 + minutes;
    const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    let diff = localMin - utcMin;
    // Offsets 24h apart give the same wall-clock time. Resolve into (-11h, +13h], which keeps
    // populated zones (Hawaii −10, Kamchatka +12, Tonga +13); rarer ones can be typed as UTC±N.
    if (diff > 13 * 60) diff -= MINUTES_PER_DAY;
    if (diff <= -11 * 60) diff += MINUTES_PER_DAY;
    const offsetHours = Math.round(diff / 60);
    if (Math.abs(diff - offsetHours * 60) > LOCAL_TIME_TOLERANCE_MIN) return null;
    return etcZoneForOffset(offsetHours);
  }

  return null;
}
