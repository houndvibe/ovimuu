import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['apps/bot', 'packages/*'],
    passWithNoTests: true,
  },
});
