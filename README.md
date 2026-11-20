# Insane AI Agent VR UI

React / Express / tRPC / Drizzle starter, adapted from the Sandbox web-db-user template.

- `pnpm dev`: development server; honors `PORT` (default 3000).
- `pnpm build` / `pnpm start`: build and serve `dist/index.js` and `dist/public/`.
- `pnpm db:migrate`: apply checked-in migrations. `pnpm db:push`: generate and apply new schema changes.
- `pnpm check` / `pnpm test`: types and application tests.

## Lokální paměť a asistent

`agent-memory/` je modelově nezávislá paměť, skill router, MCP server a asistentská smyčka pro Termux. Běží na Node 24 (`node:sqlite` + FTS5) a nepotřebuje nové runtime závislosti.

```bash
node agent-memory/src/cli.ts context "jak se staví APK"
node agent-memory/src/cli.ts chat "Zjisti, jak se spouštějí testy, a spusť je"
node agent-memory/src/cli.ts ui --project manus_tvorba
```

Architektura je v `docs/memory-architecture.md`, asistent a samoučení v `docs/memory-phase2.md`, konfigurace v `docs/memory-config.md`.

Start with the Webdev skill's default-template guide. Platform login, storage, payments and service contracts live in its shared references; read the relevant capability before extending its helper.

`server/_core/publicConfig.ts` exposes only named public runtime values. Private keys stay server-side. The platform serves managed `/manus-storage/` assets; the application does not register a second proxy.

Platform configuration is readable and editable through `webdev.config`. Default settings are initial values, not enforced constraints. The agent may modify the files, commands and configuration or follow the flexible guide for another stack.
