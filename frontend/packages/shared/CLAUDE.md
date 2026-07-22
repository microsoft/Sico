# @sico/shared — CLAUDE.md

Cross-app code that's not pure UI — hooks, atoms, services, schemas, composer components, and full **feature implementations**. DWP (superset app) consumes features from here directly.

## Commands

`npm run dev` (Storybook :6007) / `lint` / `test` / `build-storybook`.

## Structure

```text
packages/shared/
├── src/
│   ├── features/                 Business features — one dir per feature; mirrors the top-level by-kind layout below (`components/ hooks/ atoms/ services/ schemas/ utils/ constants/`) + an `index.ts` barrel as the only public entry
│   ├── components/
│   │   ├── auth/                 auth-gate
│   │   ├── error-boundary/       error-fallback (+chrome, inner, outer)
│   │   └── shell/                app-shell, login-layout, offline-banner
│   ├── atoms/                    Jotai atoms (auth, …)
│   ├── hooks/                    React hooks
│   ├── services/                 axios, query-client, synthesize-error
│   ├── schemas/                  zod schemas (api, auth)
│   ├── utils/                    pure helpers (logger, local-storage, …)
│   ├── constants/                shared constants
│   ├── testing/                  test helpers (consumed by app + shared tests)
│   └── index.ts                  Package entry (barrel)
├── stories/                      Composer stories (visible UI only)
├── test/                         Mirrors src/ structure
├── vite.config.ts                Storybook + Vitest only (no build)
├── vitest.config.ts              Extends `@sico/config/vitest.config.base.ts`
├── tsconfig.json                 Extends `@sico/config/tsconfig.react.json`
└── eslint.config.cjs             Extends base (minimal)
```

## Conventions

- **Not pure UI.** UI primitives live in `@sico/ui`; this package is for composers and business logic that touch app state/services.
- **Storybook is optional.** Composers that ship visible UI (e.g. `<ErrorFallback>`, `<OfflineBanner>`) **must** ship a `.stories.tsx` so reviewers can audit states without booting the app. Pure logic modules (atoms, hooks, services, utils, schemas) do not need stories.
- **Promotion rule.** A feature-local module inside `features/{name}/` that picks up a 2nd consumer moves to the matching top-level by-kind dir (cross-feature primitive) + gets re-exported from `src/index.ts`.

## Dependencies

Depends on: `@sico/config` (dev), `@sico/ui` · Depended on by: `@sico/app`.
