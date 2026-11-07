// Deterministic parsing of short typed answers (no AI). Pure functions.

export const MAX_UNITS_PER_INTAKE = 50;

/** "2", "1.5", "1,5", "2 таблетки", "½" → number; null if not understood or out of range. */
export function parseAmount(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (/^½/.test(text) || /^пол(овин)?/.test(text)) return 0.5;
  const match = /^(\d+(?:[.,]\d+)?)(?:\s|$)/.exec(text);
  if (!match) return null;
  const n = Number(match[1]!.replace(',', '.'));
  return n > 0 && n <= MAX_UNITS_PER_INTAKE ? n : null;
}

/** "9:30", "9.30", "09 30", "930", "21", "в 8:00" → minutes since midnight; null if invalid. */
export function parseClockTime(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/^в\s+/, '');
  const match = /^(\d{1,2})(?:[:.\s-]?(\d{2}))?$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
