import type { AiService } from './index.ts';

/** AI stub for bot tests and offline development. Unimplemented methods throw. */
export function createFakeAi(overrides: Partial<AiService> = {}): AiService {
  const notImplemented = (name: string) => () =>
    Promise.reject(new Error(`FakeAi.${name} is not implemented in this test`));
  return {
    transcribe: notImplemented('transcribe'),
    ocr: notImplemented('ocr'),
    parseMedications: notImplemented('parseMedications'),
    routeIntent: notImplemented('routeIntent'),
    ...overrides,
  };
}
