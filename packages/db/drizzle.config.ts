import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs from packages/db; load the root .env when present.
try {
  process.loadEnvFile('../../.env');
} catch {
  // No .env file: rely on the process environment.
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and fill it in.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
