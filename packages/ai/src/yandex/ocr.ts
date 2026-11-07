import { z } from 'zod';
import { AiError } from '../errors.ts';
import { type YandexConfig, yandexRequest } from './http.ts';

const OCR_URL = 'https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const responseSchema = z.object({
  result: z.object({
    textAnnotation: z.object({ fullText: z.string().optional() }).optional(),
  }),
});

function detectMime(image: Buffer): 'JPEG' | 'PNG' | null {
  if (image[0] === 0xff && image[1] === 0xd8) return 'JPEG';
  if (image.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'PNG';
  return null;
}

/** Image → text. Uses the "handwritten" model: mixed printed + handwritten, ru/en only. */
export async function ocr(cfg: YandexConfig, image: Buffer): Promise<string> {
  const mimeType = detectMime(image);
  if (!mimeType) throw new AiError('unsupported_format', 'Unsupported image format');
  if (image.byteLength > MAX_IMAGE_BYTES) throw new AiError('image_too_large');

  const res = await yandexRequest(cfg, OCR_URL, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mimeType,
      languageCodes: ['ru', 'en'],
      model: 'handwritten',
      content: image.toString('base64'),
    }),
  });
  const parsed = responseSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new AiError('unavailable', 'Unexpected OCR response');

  const text = parsed.data.result.textAnnotation?.fullText?.trim() ?? '';
  if (!text) throw new AiError('nothing_recognized');
  return text;
}
