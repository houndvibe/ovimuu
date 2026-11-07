import { AiError } from '../errors.ts';

export interface YandexConfig {
  folderId: string;
  apiKey: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const isRetryable = (status: number) => status === 429 || status >= 500;

/**
 * Authenticated request to Yandex Cloud. Retries once on network errors, timeouts,
 * 429 and 5xx. Asks Yandex not to log request data (x-data-logging-enabled: false).
 */
export async function yandexRequest(
  cfg: YandexConfig,
  url: string,
  init: { body: string | Uint8Array; headers?: Record<string, string> },
): Promise<Response> {
  const doFetch = cfg.fetch ?? fetch;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await doFetch(url, {
        method: 'POST',
        body: init.body,
        headers: {
          Authorization: `Api-Key ${cfg.apiKey}`,
          'x-folder-id': cfg.folderId,
          'x-data-logging-enabled': 'false',
          ...init.headers,
        },
        signal: AbortSignal.timeout(cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (res.ok) return res;
      lastStatus = res.status;
      if (!isRetryable(res.status)) break;
    } catch {
      // Network error or timeout: retry once.
      lastStatus = undefined;
    }
  }

  throw new AiError(
    'unavailable',
    `Yandex Cloud request failed${lastStatus ? ` with status ${lastStatus}` : ''}`,
    lastStatus,
  );
}
