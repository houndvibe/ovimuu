import { pino } from 'pino';

// Structured logs. Never log message contents or medical data — ids and event names only.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(process.env.NODE_ENV !== 'production' && {
    transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } },
  }),
});
