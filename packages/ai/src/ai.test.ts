import { describe, expect, it } from 'vitest';
import { diffParseResult, normalizeText } from '../fixtures/compare.ts';
import { intentFixtures } from '../fixtures/intent.ts';
import { med, parseFixtures } from '../fixtures/parse.ts';
import { AiError, createAi } from './index.ts';
import { intentResultSchema, parseResultSchema, toModelJsonSchema } from './schemas.ts';
import { completion, queuedFetch, requestBody, testConfig } from './test-utils.ts';
import { yandexRequest } from './yandex/http.ts';
import { ocr } from './yandex/ocr.ts';
import { MAX_VOICE_BYTES, transcribe } from './yandex/speechkit.ts';

const validParse = JSON.stringify({ medications: [med({ name: 'Магний' })] });
const validIntent = (targets: number[]) =>
  JSON.stringify({
    intent: 'mark_taken',
    targets,
    params: { slots: null, unitsPerIntake: null, pauseUntil: null, pauseDays: null },
    otherKind: null,
  });

describe('schemas and fixtures', () => {
  it.each(parseFixtures.map((f) => [f.id, f]))('parse fixture %s matches the schema', (_, f) => {
    expect(parseResultSchema.safeParse(f.expected).success).toBe(true);
  });

  it('produces a JSON Schema without $schema for the model', () => {
    const js = toModelJsonSchema(intentResultSchema);
    expect(js).not.toHaveProperty('$schema');
    expect(js.type).toBe('object');
  });

  it('rejects slots with malformed time', () => {
    const bad = {
      medications: [med({ slots: [{ time: '9:00', anchor: null, anchorOffsetMin: null }] })],
    };
    expect(parseResultSchema.safeParse(bad).success).toBe(false);
  });

  it('intent fixtures reference only known intents', () => {
    for (const f of intentFixtures) {
      expect(intentResultSchema.shape.intent.safeParse(f.expected.intent).success).toBe(true);
    }
  });
});

describe('fixture comparison', () => {
  it('normalizes look-alike letters and punctuation', () => {
    expect(normalizeText('Омега-3')).toBe(normalizeText('омега 3'));
    expect(normalizeText('ME')).toBe(normalizeText('МЕ'));
    expect(normalizeText('Магне B6')).toBe(normalizeText('Магне В6'));
  });

  it('ignores slot order and treats null offset as 0', () => {
    const a = {
      medications: [
        med({
          slots: [
            { time: null, anchor: 'wake', anchorOffsetMin: null },
            { time: null, anchor: 'sleep', anchorOffsetMin: 0 },
          ],
        }),
      ],
    };
    const b = {
      medications: [
        med({
          slots: [
            { time: null, anchor: 'sleep', anchorOffsetMin: null },
            { time: null, anchor: 'wake', anchorOffsetMin: 0 },
          ],
        }),
      ],
    };
    expect(diffParseResult(a, b)).toEqual([]);
  });
});

describe('yandexRequest', () => {
  it('sends auth and no-logging headers', async () => {
    const f = queuedFetch({ body: {} });
    await yandexRequest(testConfig(f), 'https://x', { body: '{}' });
    const headers = f.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Api-Key secret');
    expect(headers['x-folder-id']).toBe('folder1');
    expect(headers['x-data-logging-enabled']).toBe('false');
  });

  it('retries once on 5xx', async () => {
    const f = queuedFetch({ status: 503 }, { body: {} });
    await yandexRequest(testConfig(f), 'https://x', { body: '{}' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 4xx', async () => {
    const f = queuedFetch({ status: 401 });
    await expect(yandexRequest(testConfig(f), 'https://x', { body: '{}' })).rejects.toMatchObject({
      code: 'unavailable',
      status: 401,
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('gives up after two network errors', async () => {
    const f = queuedFetch(new Error('ECONNRESET'), new Error('ECONNRESET'));
    await expect(yandexRequest(testConfig(f), 'https://x', { body: '{}' })).rejects.toBeInstanceOf(
      AiError,
    );
  });
});

describe('transcribe', () => {
  it('returns recognized text', async () => {
    const f = queuedFetch({ body: { result: 'выпила магний' } });
    await expect(transcribe(testConfig(f), Buffer.from('ogg'), 'audio/ogg')).resolves.toBe(
      'выпила магний',
    );
    expect(String(f.mock.calls[0]![0])).toContain('format=oggopus');
  });

  it('rejects non-ogg audio and oversized files without calling the API', async () => {
    const f = queuedFetch();
    await expect(transcribe(testConfig(f), Buffer.from('x'), 'audio/mpeg')).rejects.toMatchObject({
      code: 'unsupported_format',
    });
    await expect(
      transcribe(testConfig(f), Buffer.alloc(MAX_VOICE_BYTES + 1), 'audio/ogg'),
    ).rejects.toMatchObject({ code: 'audio_too_large' });
    expect(f).not.toHaveBeenCalled();
  });

  it('reports silence as nothing_recognized', async () => {
    const f = queuedFetch({ body: { result: '' } });
    await expect(transcribe(testConfig(f), Buffer.from('ogg'), 'audio/ogg')).rejects.toMatchObject({
      code: 'nothing_recognized',
    });
  });
});

describe('ocr', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

  it('detects JPEG and returns full text', async () => {
    const f = queuedFetch({
      body: { result: { textAnnotation: { fullText: 'Магний 1 таб.\n' } } },
    });
    await expect(ocr(testConfig(f), jpeg)).resolves.toBe('Магний 1 таб.');
    expect(requestBody(f, 0)).toMatchObject({
      mimeType: 'JPEG',
      model: 'handwritten',
      languageCodes: ['ru', 'en'],
    });
  });

  it('rejects unknown formats', async () => {
    await expect(ocr(testConfig(queuedFetch()), Buffer.from('GIF89a'))).rejects.toMatchObject({
      code: 'unsupported_format',
    });
  });

  it('reports blank images as nothing_recognized', async () => {
    const f = queuedFetch({ body: { result: { textAnnotation: { fullText: '' } } } });
    await expect(ocr(testConfig(f), jpeg)).rejects.toMatchObject({ code: 'nothing_recognized' });
  });
});

describe('parseMedications', () => {
  const ctx = { today: '2026-11-07' };

  it('returns a validated result and sends the schema', async () => {
    const f = queuedFetch(completion(validParse));
    const ai = createAi(testConfig(f));
    await expect(ai.parseMedications('магний', ctx)).resolves.toEqual(JSON.parse(validParse));
    const body = requestBody(f, 0);
    expect(body.modelUri).toBe('gpt://folder1/yandexgpt-5.1/latest');
    expect(body).toHaveProperty('jsonSchema.schema.type', 'object');
  });

  it('accepts JSON wrapped in markdown fences', async () => {
    const f = queuedFetch(completion('```json\n' + validParse + '\n```'));
    await expect(createAi(testConfig(f)).parseMedications('магний', ctx)).resolves.toHaveProperty(
      'medications',
    );
  });

  it('retries once with higher temperature on an invalid answer', async () => {
    const f = queuedFetch(completion('{"medications": [{"name": 5}]}'), completion(validParse));
    await expect(createAi(testConfig(f)).parseMedications('магний', ctx)).resolves.toHaveProperty(
      'medications',
    );
    expect(f).toHaveBeenCalledTimes(2);
    expect(requestBody(f, 1)).toHaveProperty('completionOptions.temperature', 0.3);
  });

  it('throws invalid_response after two invalid answers', async () => {
    const f = queuedFetch(completion('not json'), completion('{}'));
    await expect(createAi(testConfig(f)).parseMedications('магний', ctx)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('includes the current draft for corrections', async () => {
    const f = queuedFetch(completion(validParse));
    const draft = JSON.parse(validParse);
    await createAi(testConfig(f)).parseMedications('после ужина', { ...ctx, currentDraft: draft });
    const user = (requestBody(f, 0).messages as { text: string }[])[1]!.text;
    expect(user).toContain('Текущий черновик');
    expect(user).toContain('после ужина');
  });

  it('uses the configured model', async () => {
    const f = queuedFetch(completion(validParse));
    await createAi({ ...testConfig(f), models: { parse: 'aliceai-llm/latest' } }).parseMedications(
      'x',
      ctx,
    );
    expect(requestBody(f, 0).modelUri).toBe('gpt://folder1/aliceai-llm/latest');
  });
});

describe('routeIntent', () => {
  const meds = [{ id: 1, name: 'Магний', schedule: 'каждый день' }];

  it('drops target ids that were not provided', async () => {
    const f = queuedFetch(completion(validIntent([1, 99, 1])));
    const result = await createAi(testConfig(f)).routeIntent('выпила магний', meds, '2026-11-07');
    expect(result.targets).toEqual([1]);
    expect(requestBody(f, 0).modelUri).toBe('gpt://folder1/aliceai-llm-flash/latest');
  });
});
