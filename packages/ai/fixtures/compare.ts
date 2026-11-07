import type { ParsedMedication, ParseResult } from '../src/index.ts';

const STRING_FIELDS = new Set<keyof ParsedMedication>(['name', 'doseUnit', 'unitForm']);

/** Lowercase, Latin look-alikes → Cyrillic, drop punctuation: "Омега-3" ≈ "омега 3", "ME" ≈ "МЕ". */
export function normalizeText(value: string): string {
  const latinToCyrillic: Record<string, string> = {
    a: 'а',
    b: 'в',
    e: 'е',
    m: 'м',
    o: 'о',
    c: 'с',
    x: 'х',
    p: 'р',
    k: 'к',
    h: 'н',
    t: 'т',
  };
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/[abemocxpkht]/g, (ch) => latinToCyrillic[ch] ?? ch);
}

function normalizeField(key: keyof ParsedMedication, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (STRING_FIELDS.has(key) && typeof value === 'string') return normalizeText(value);
  if (key === 'slots' && Array.isArray(value)) {
    // Slot order does not matter; a null offset equals 0.
    return value.map((s) => JSON.stringify([s.time, s.anchor, s.anchorOffsetMin ?? 0])).sort();
  }
  if (key === 'weekdays' && Array.isArray(value)) return [...value].sort();
  return value;
}

const ALL_FIELDS: (keyof ParsedMedication)[] = [
  'name',
  'doseAmount',
  'doseUnit',
  'unitsPerIntake',
  'unitForm',
  'frequencyType',
  'everyNDays',
  'weekdays',
  'timesPerDay',
  'slots',
  'mealRelation',
  'mealOffsetMin',
  'durationDays',
  'startDate',
  'endDate',
  'unsupportedReason',
];

/** Returns human-readable differences (empty array = match). Medications are matched by order. */
export function diffParseResult(
  expected: ParseResult,
  actual: ParseResult,
  fields: (keyof ParsedMedication)[] = ALL_FIELDS,
): string[] {
  const diffs: string[] = [];
  if (expected.medications.length !== actual.medications.length) {
    diffs.push(
      `medications: expected ${expected.medications.length}, got ${actual.medications.length}`,
    );
  }
  expected.medications.forEach((exp, i) => {
    const act = actual.medications[i];
    if (!act) return;
    for (const key of fields) {
      const e = JSON.stringify(normalizeField(key, exp[key]));
      const a = JSON.stringify(normalizeField(key, act[key]));
      if (e !== a)
        diffs.push(
          `[${i}].${key}: expected ${JSON.stringify(exp[key])}, got ${JSON.stringify(act[key])}`,
        );
    }
  });
  return diffs;
}

/** Compares only the keys present in `expected` (params compared per listed key). */
export function diffPartial(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  path = '',
): string[] {
  const diffs: string[] = [];
  for (const [key, exp] of Object.entries(expected)) {
    const act = actual[key];
    if (exp && typeof exp === 'object' && !Array.isArray(exp)) {
      diffs.push(
        ...diffPartial(
          exp as Record<string, unknown>,
          (act ?? {}) as Record<string, unknown>,
          `${path}${key}.`,
        ),
      );
      continue;
    }
    const norm = (v: unknown) =>
      key === 'slots' ? normalizeField('slots', v) : Array.isArray(v) ? [...v].sort() : (v ?? null);
    if (JSON.stringify(norm(exp)) !== JSON.stringify(norm(act))) {
      diffs.push(`${path}${key}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`);
    }
  }
  return diffs;
}
