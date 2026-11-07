import { z } from 'zod';

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === '' ? undefined : v))
  .optional();

// Empty string counts as missing; later checks run only if the value is present.
const required = z.string().trim().min(1, 'is required');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    BOT_TOKEN: required,
    DATABASE_URL: required.pipe(z.url('must be a valid URL')),
    ADMIN_TELEGRAM_ID: required
      .pipe(z.string().regex(/^\d+$/, 'must be a numeric Telegram user id'))
      .transform(Number),
    YC_FOLDER_ID: required,
    YC_API_KEY: required,
    YC_MODEL_PARSE: optionalString,
    YC_MODEL_INTENT: optionalString,
    PUBLIC_URL: optionalString.pipe(z.url('must be a valid URL').optional()),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.PUBLIC_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_URL'],
        message: 'is required when NODE_ENV=production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  override name = 'EnvError';
}

/** Parses environment variables; throws EnvError listing every problem at once. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    const missing = issue.code === 'invalid_type' && source[key] === undefined;
    return `  - ${key}: ${missing ? 'is required' : issue.message}`;
  });
  throw new EnvError(
    `Invalid environment configuration:\n${lines.join('\n')}\n` +
      'Copy .env.example to .env and fill in the values.',
  );
}

let cached: Env | undefined;

export function loadEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
