# Стартовый промпт для Claude Code

Скопируй текст ниже в первую сессию Claude Code (из корня репозитория).

---

Прочитай `CLAUDE.md`, `docs/decisions.md` и `docs/brief.md`. Мы начинаем этап 1 (бот) по разделу «Порядок работ» в `docs/decisions.md`.

Сделай шаги 1–2:

1. Каркас монорепо на pnpm workspaces: `apps/bot`, `apps/miniapp` (пока пустой Vite + React шаблон), `packages/db`, `packages/ai`. Общий `tsconfig.base.json`, ESLint + Prettier, vitest.
2. `docker-compose.yml` для разработки (только postgres 16) и `.env.example` со всеми переменными: `BOT_TOKEN`, `DATABASE_URL`, `ADMIN_TELEGRAM_ID`, `YC_FOLDER_ID`, `YC_API_KEY`, `PUBLIC_URL`. Загрузка env через zod с понятной ошибкой при отсутствии переменной.
3. В `apps/bot` — минимальный grammY-бот в long polling, отвечающий на `/start`.
4. В `packages/db` — схема Drizzle по разделу 4 `decisions.md`, первая миграция, уникальные индексы для `xp_events`.
5. Скрипты в корне: `dev`, `db:generate`, `db:migrate`, `test`, `typecheck`, `lint`. Допиши их в раздел «Команды» в `CLAUDE.md`.

Перед тем как писать код, коротко покажи план структуры папок и схемы БД и дождись моего «ок». Если в `decisions.md` что-то противоречиво или неясно для реализации — спроси, а не придумывай.

---

## Дальнейшие сессии

Удобно начинать каждую сессию одной строкой, например:

> Продолжаем этап 1, шаг 4 из `docs/decisions.md` (`packages/ai`). Сначала план, потом код.

После каждого шага: попроси прогнать `typecheck` и тесты, закоммить. Если по ходу меняется решение — попроси обновить `docs/decisions.md` в том же коммите.
