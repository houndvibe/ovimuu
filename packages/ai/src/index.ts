import { normalizeParseResult, normalizeSlots } from './normalize.ts';
import { INTENT_SYSTEM_PROMPT, PARSE_SYSTEM_PROMPT } from './prompts.ts';
import {
  type IntentResult,
  intentResultSchema,
  type ParseResult,
  parseResultSchema,
} from './schemas.ts';
import { completeStructured } from './structured.ts';
import type { YandexConfig } from './yandex/http.ts';
import { ocr } from './yandex/ocr.ts';
import { transcribe } from './yandex/speechkit.ts';

export { AiError, type AiErrorCode } from './errors.ts';
export { createFakeAi } from './fake.ts';
export { MAX_IMAGE_BYTES } from './yandex/ocr.ts';
export { MAX_VOICE_BYTES, MAX_VOICE_DURATION_SEC } from './yandex/speechkit.ts';
export * from './schemas.ts';

export interface UserContext {
  /** User's local date, YYYY-MM-DD. Used only to resolve the year of explicit dates. */
  today: string;
  /** Current draft when the user sends corrections ("Исправить"). */
  currentDraft?: ParseResult;
}

export interface ActiveMedSummary {
  id: number;
  name: string;
  /** Short human-readable schedule, e.g. "каждый день после завтрака, 1 капсула". */
  schedule: string;
}

export interface AiService {
  transcribe(audio: Buffer, mime: string): Promise<string>;
  ocr(image: Buffer): Promise<string>;
  parseMedications(text: string, ctx: UserContext): Promise<ParseResult>;
  routeIntent(text: string, meds: ActiveMedSummary[], today: string): Promise<IntentResult>;
}

export interface AiConfig extends YandexConfig {
  models?: {
    /** Stronger model for parsing prescriptions. */
    parse?: string;
    /** Light model for intent routing. */
    intent?: string;
  };
}

export const DEFAULT_MODELS = {
  parse: 'yandexgpt-5.1/latest',
  intent: 'aliceai-llm-flash/latest',
} as const;

function parseUserMessage(text: string, ctx: UserContext): string {
  const parts = [`Сегодня: ${ctx.today}`];
  if (ctx.currentDraft) {
    parts.push(`Текущий черновик:\n${JSON.stringify(ctx.currentDraft)}`);
    parts.push(`Исправления пользователя:\n${text}`);
  } else {
    parts.push(`Текст:\n${text}`);
  }
  return parts.join('\n\n');
}

function intentUserMessage(text: string, meds: ActiveMedSummary[], today: string): string {
  const list = meds.length
    ? meds.map((m) => `- id ${m.id}: ${m.name} (${m.schedule})`).join('\n')
    : '(список пуст)';
  return `Сегодня: ${today}\n\nАктивные препараты:\n${list}\n\nСообщение:\n${text}`;
}

/** Yandex Cloud implementation of the AI interface. */
export function createAi(config: AiConfig): AiService {
  const models = { ...DEFAULT_MODELS, ...config.models };
  return {
    transcribe: (audio, mime) => transcribe(config, audio, mime),
    ocr: (image) => ocr(config, image),

    async parseMedications(text, ctx) {
      const result = await completeStructured(config, {
        model: models.parse,
        system: PARSE_SYSTEM_PROMPT,
        user: parseUserMessage(text, ctx),
        schema: parseResultSchema,
        maxTokens: 4000,
      });
      return normalizeParseResult(result);
    },

    async routeIntent(text, meds, today) {
      const result = await completeStructured(config, {
        model: models.intent,
        system: INTENT_SYSTEM_PROMPT,
        user: intentUserMessage(text, meds, today),
        schema: intentResultSchema,
        maxTokens: 800,
      });
      // Defensive: never let the model reference ids we did not provide.
      const known = new Set(meds.map((m) => m.id));
      const slots = result.params.slots ? normalizeSlots(result.params.slots) : null;
      return {
        ...result,
        targets: [...new Set(result.targets)].filter((id) => known.has(id)),
        params: { ...result.params, slots: slots?.length ? slots : null },
      };
    },
  };
}
