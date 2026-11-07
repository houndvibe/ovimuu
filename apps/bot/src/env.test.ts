import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from './env.ts';

const valid = {
  BOT_TOKEN: '123:abc',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  ADMIN_TELEGRAM_ID: '42',
  YC_FOLDER_ID: 'b1gfolder',
  YC_API_KEY: 'AQVNkey',
};

describe('parseEnv', () => {
  it('parses a minimal valid env', () => {
    const env = parseEnv(valid);
    expect(env.ADMIN_TELEGRAM_ID).toBe(42);
    expect(env.NODE_ENV).toBe('development');
    expect(env.YC_MODEL_PARSE).toBeUndefined();
  });

  it('treats empty strings as missing for optional vars', () => {
    expect(parseEnv({ ...valid, PUBLIC_URL: '' }).PUBLIC_URL).toBeUndefined();
  });

  it('lists every missing required variable', () => {
    expect(() => parseEnv({})).toThrow(EnvError);
    try {
      parseEnv({ BOT_TOKEN: '' });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('BOT_TOKEN: is required');
      expect(msg).toContain('DATABASE_URL: is required');
      expect(msg).toContain('ADMIN_TELEGRAM_ID: is required');
      expect(msg).toContain('YC_API_KEY: is required');
    }
  });

  it('requires PUBLIC_URL in production', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/PUBLIC_URL/);
    expect(
      parseEnv({ ...valid, NODE_ENV: 'production', PUBLIC_URL: 'https://example.com' }).PUBLIC_URL,
    ).toBe('https://example.com');
  });

  it('rejects a non-numeric admin id', () => {
    expect(() => parseEnv({ ...valid, ADMIN_TELEGRAM_ID: 'me' })).toThrow(/numeric/);
    expect(() => parseEnv({ ...valid, ADMIN_TELEGRAM_ID: '' })).not.toThrow(/numeric/);
  });
});
