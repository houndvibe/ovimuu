import { z } from 'zod';
import { AiError } from '../errors.ts';
import { type YandexConfig, yandexRequest } from './http.ts';

const COMPLETION_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion';

export interface CompletionRequest {
  /** Model path inside the folder, e.g. "yandexgpt-5.1/latest". */
  model: string;
  system: string;
  user: string;
  /** JSON Schema the answer must follow (structured output). */
  jsonSchema: Record<string, unknown>;
  temperature: number;
  maxTokens: number;
}

const responseSchema = z.object({
  result: z.object({
    alternatives: z
      .array(z.object({ message: z.object({ text: z.string() }), status: z.string().optional() }))
      .min(1),
  }),
});

/** Returns the raw text of the first alternative. JSON parsing/validation is the caller's job. */
export async function complete(cfg: YandexConfig, req: CompletionRequest): Promise<string> {
  const res = await yandexRequest(cfg, COMPLETION_URL, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      modelUri: `gpt://${cfg.folderId}/${req.model}`,
      completionOptions: {
        stream: false,
        temperature: req.temperature,
        maxTokens: String(req.maxTokens),
      },
      messages: [
        { role: 'system', text: req.system },
        { role: 'user', text: req.user },
      ],
      jsonSchema: { schema: req.jsonSchema },
    }),
  });
  const parsed = responseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new AiError('unavailable', 'Unexpected completion response');
  return parsed.data.result.alternatives[0]!.message.text;
}
