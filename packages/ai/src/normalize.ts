import type { ParsedSlot, ParseResult } from './schemas.ts';

// Deterministic cleanup of structurally sloppy (but schema-valid) model output.
// Never adds information — only removes contradictions and empty placeholders.

function normalizeSlot(slot: ParsedSlot): ParsedSlot | null {
  if (slot.time === null && slot.anchor === null) return null; // empty placeholder
  if (slot.time !== null) return { time: slot.time, anchor: null, anchorOffsetMin: null };
  return slot;
}

export const normalizeSlots = (slots: ParsedSlot[]): ParsedSlot[] =>
  slots.map(normalizeSlot).filter((s): s is ParsedSlot => s !== null);

/** Models sometimes emit the string "null" or "" instead of null. */
const cleanString = (value: string | null): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' || trimmed.toLowerCase() === 'null' ? null : trimmed;
};

export function normalizeParseResult(result: ParseResult): ParseResult {
  return {
    medications: result.medications.map((m) => {
      const slots = normalizeSlots(m.slots);
      return {
        ...m,
        name: cleanString(m.name),
        doseUnit: cleanString(m.doseUnit),
        unitForm: cleanString(m.unitForm),
        notes: cleanString(m.notes),
        slots,
        // Named intake moments determine the count when the model left it empty.
        timesPerDay: m.timesPerDay ?? (slots.length > 0 ? slots.length : null),
        everyNDays: m.frequencyType === 'every_n_days' ? m.everyNDays : null,
        weekdays: m.frequencyType === 'weekdays' ? m.weekdays : null,
      };
    }),
  };
}
