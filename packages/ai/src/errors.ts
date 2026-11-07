export type AiErrorCode =
  /** Voice longer than the synchronous STT limit. */
  | 'audio_too_long'
  /** Voice file larger than the synchronous STT limit. */
  | 'audio_too_large'
  | 'image_too_large'
  | 'unsupported_format'
  /** Nothing usable was recognized (silence, blank photo). */
  | 'nothing_recognized'
  /** Model returned invalid JSON / schema mismatch twice in a row. */
  | 'invalid_response'
  /** Network error, timeout, or non-2xx response from Yandex Cloud. */
  | 'unavailable';

/** The only error type thrown by @ovimuu/ai. Messages never contain user content. */
export class AiError extends Error {
  override name = 'AiError';

  constructor(
    readonly code: AiErrorCode,
    message: string = code,
    readonly status?: number,
  ) {
    super(message);
  }
}
