import { z } from 'zod';

// Schemas for model output. The same schema is sent to the model as JSON Schema
// (structured output) and used to validate the answer. Every field the text may not
// mention is nullable: the model must return null instead of guessing.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const anchorSchema = z.enum(['wake', 'breakfast', 'lunch', 'dinner', 'sleep']);

export const slotSchema = z.object({
  /** Exact local time "HH:MM", if stated. */
  time: hhmm.nullable(),
  anchor: anchorSchema.nullable(),
  /** Minutes relative to the anchor: +30 = "30 min after breakfast", -15 = "15 min before". */
  anchorOffsetMin: z.number().int().nullable(),
});

export const unsupportedReasonSchema = z.enum(['stepped_dose', 'as_needed', 'cycle', 'other']);

export const parsedMedicationSchema = z.object({
  name: z.string().nullable(),
  doseAmount: z.number().nullable(),
  /** мг, МЕ, мл, мкг, ... */
  doseUnit: z.string().nullable(),
  unitsPerIntake: z.number().nullable(),
  /** таблетка, капсула, капли, ... (nominative singular) */
  unitForm: z.string().nullable(),
  frequencyType: z.enum(['daily', 'every_n_days', 'weekdays', 'once']).nullable(),
  everyNDays: z.number().int().nullable(),
  /** ISO weekdays: 1 = Monday ... 7 = Sunday. */
  weekdays: z.array(z.number().int().min(1).max(7)).nullable(),
  /** "2 раза в день" → 2, even when the exact times are unknown. */
  timesPerDay: z.number().int().nullable(),
  /** Only explicitly stated intake times; may be shorter than timesPerDay. */
  slots: z.array(slotSchema),
  /** "до/во время/после еды" without naming a specific meal. */
  mealRelation: z.enum(['before', 'during', 'after']).nullable(),
  mealOffsetMin: z.number().int().nullable(),
  /** "курс 14 дней" → 14. End date is computed by code, never by the model. */
  durationDays: z.number().int().nullable(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  notes: z.string().nullable(),
  unsupportedReason: unsupportedReasonSchema.nullable(),
});

export const parseResultSchema = z.object({
  medications: z.array(parsedMedicationSchema),
});

export const intentSchema = z.enum([
  'add',
  'change_time',
  'change_amount',
  'pause',
  'complete',
  'delete',
  'mark_taken',
  'other',
]);

export const intentResultSchema = z.object({
  intent: intentSchema,
  /** Ids from the provided list of active medications only. */
  targets: z.array(z.number().int()),
  params: z.object({
    slots: z.array(slotSchema).nullable(),
    unitsPerIntake: z.number().nullable(),
    pauseUntil: isoDate.nullable(),
    pauseDays: z.number().int().nullable(),
  }),
  otherKind: z.enum(['chat', 'medical']).nullable(),
});

export type Anchor = z.infer<typeof anchorSchema>;
export type ParsedSlot = z.infer<typeof slotSchema>;
export type ParsedMedication = z.infer<typeof parsedMedicationSchema>;
export type ParseResult = z.infer<typeof parseResultSchema>;
export type Intent = z.infer<typeof intentSchema>;
export type IntentResult = z.infer<typeof intentResultSchema>;
export type UnsupportedReason = z.infer<typeof unsupportedReasonSchema>;

export function toModelJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}
