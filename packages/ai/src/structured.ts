import type { z } from 'zod';
import { AiError } from './errors.ts';
import { toModelJsonSchema } from './schemas.ts';
import type { YandexConfig } from './yandex/http.ts';
import { complete } from './yandex/gpt.ts';

export interface StructuredRequest<T extends z.ZodType> {
  model: string;
  system: string;
  user: string;
  schema: T;
  maxTokens: number;
}

/** Models occasionally wrap JSON in markdown fences despite structured output. */
function extractJson(text: string): unknown {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return JSON.parse(fenced ? fenced[1]! : text);
}

/**
 * Calls the model with structured output and validates the answer with zod.
 * Invalid answer → one retry (slightly higher temperature) → AiError('invalid_response').
 */
export async function completeStructured<T extends z.ZodType>(
  cfg: YandexConfig,
  req: StructuredRequest<T>,
): Promise<z.infer<T>> {
  const jsonSchema = toModelJsonSchema(req.schema);
  for (const temperature of [0, 0.3]) {
    const text = await complete(cfg, {
      model: req.model,
      system: req.system,
      user: req.user,
      jsonSchema,
      temperature,
      maxTokens: req.maxTokens,
    });
    try {
      const parsed = req.schema.safeParse(extractJson(text));
      if (parsed.success) return parsed.data;
    } catch {
      // Not JSON: fall through to retry.
    }
  }
  throw new AiError('invalid_response', 'Model returned an invalid answer twice');
}
