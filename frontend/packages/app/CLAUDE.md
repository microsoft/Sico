# @sico/app — CLAUDE.md

Sico frontend application — TanStack Router file-based routing, Jotai state, react-query + axios data layer, zod validation.

Thin route-only scaffold. Features live in `@sico/shared/features/{name}/` so DWP can consume them. **No `src/features/` here** — route files mount shared features.

## Commands

`npm run dev` / `build` / `preview` / `lint` / `test` / `test:build` / `e2e` (Playwright builds first).

`VITE_BACKEND` (`sico` default | `dwp`) picks the backend profile in `services/backend-profile.ts` (axios `baseURL` + chat endpoints + `SicoConfig` flags); unknown value throws at startup.

```bash
VITE_BACKEND=dwp pnpm build   # or pnpm dev — sico is the default
```


## Structure

```text
packages/app/
├── src/                      Source code
│   ├── app.tsx               Root App component + Provider chain
│   ├── main.tsx              Entry point
│   ├── components/           App-only composition (root-providers, …) — NOT business UI
│   ├── router.ts             TanStack Router instance
│   ├── routeTree.gen.ts      Auto-generated — DO NOT EDIT
│   ├── routes/               File-based route tree; each route mounts a shared feature (≤30 LOC)
│   ├── services/             axios + react-query bindings to shared's createApiClient
│   ├── store.ts              Jotai store re-export
│   └── styles/               Global styles + tokens
├── test/                     Vitest unit + integration tests
├── e2e/                      Playwright E2E tests
├── index.html                Vite entry HTML
├── vite.config.ts            Vite + TanStack Router plugin
├── vitest.config.ts          Vitest config
├── vitest.config.build.ts    Vitest against built bundle
├── playwright.config.ts      Playwright config
├── tsconfig.json             Extends @sico/config/tsconfig.react.json
└── eslint.config.cjs         Extends base + react-refresh plugin
```

## Dependencies

Depends on: `@sico/ui`, `@sico/shared`, `@sico/config` (dev) · Depended on by: none (leaf).
