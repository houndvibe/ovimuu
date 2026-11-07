import { vi } from 'vitest';
import type { YandexConfig } from './yandex/http.ts';

export type FakeResponse = { status?: number; body?: unknown } | Error;

/** fetch mock returning queued responses in order; records requests. */
export function queuedFetch(...responses: FakeResponse[]) {
  const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('No more queued responses');
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status ?? 200 });
  });
  return fn;
}

export function testConfig(fetchFn: ReturnType<typeof queuedFetch>): YandexConfig {
  return { folderId: 'folder1', apiKey: 'secret', fetch: fetchFn as unknown as typeof fetch };
}

export const completion = (text: string) => ({
  body: {
    result: {
      alternatives: [{ message: { role: 'assistant', text }, status: 'ALTERNATIVE_STATUS_FINAL' }],
    },
  },
});

export function requestBody(
  fn: ReturnType<typeof queuedFetch>,
  call: number,
): Record<string, unknown> {
  return JSON.parse(String(fn.mock.calls[call]![1]!.body));
}
