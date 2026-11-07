import { z } from 'zod';
import { AiError } from '../errors.ts';
import { type YandexConfig, yandexRequest } from './http.ts';

const STT_URL = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize';

/** Synchronous recognition limits. The caller checks duration before downloading the file. */
export const MAX_VOICE_DURATION_SEC = 30;
export const MAX_VOICE_BYTES = 1024 * 1024;

const responseSchema = z.object({ result: z.string().optional() });

/** Speech → text. Telegram voice messages are OGG/Opus, which SpeechKit accepts directly. */
export async function transcribe(cfg: YandexConfig, audio: Buffer, mime: string): Promise<string> {
  if (!/ogg|opus/i.test(mime))
    throw new AiError('unsupported_format', `Unsupported audio: ${mime}`);
  if (audio.byteLength > MAX_VOICE_BYTES) throw new AiError('audio_too_large');

  const url = `${STT_URL}?lang=ru-RU&format=oggopus`;
  const res = await yandexRequest(cfg, url, { body: new Uint8Array(audio) });
  const parsed = responseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new AiError('unavailable', 'Unexpected SpeechKit response');

  const text = parsed.data.result?.trim() ?? '';
  if (!text) throw new AiError('nothing_recognized');
  return text;
}
