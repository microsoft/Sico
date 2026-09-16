# Sico frontend

The canonical Sico frontend workspace lives in `frontend/` in the Sico monorepo. It contains the React application and shared frontend packages and is built from source by the repository's Compose and Kind workflows.

## Running the frontend

### Full stack with Docker

Run `make compose-up` from the repository root. This builds and serves the
frontend together with nginx, Backend, Core, and the required infrastructure at
`http://localhost:8080`.

### App-only development against DWP

From `frontend/`, run only the frontend application with Vite hot reload while
using the DWP test environment:

```bash
pnpm install --frozen-lockfile
VITE_API_TARGET=https://test.sico.microsoft.com \
  VITE_LOGIN_PREFILL_CREDENTIALS=false \
  pnpm --filter @sico/app dev
```

The Vite server normally starts at `http://localhost:5173` and proxies
`/api/sico/*` and `/storage/*` to the configured DWP environment. The DWP
backend uses Sico's canonical `/api/sico/*` API paths rather than `/api/dwp/*`.
Local Vite and Compose/Kind builds leave `VITE_LOGIN_PREFILL_CREDENTIALS`
unset and prefill the seeded local operator account. Set it to `false` for any
frontend development session that targets a shared environment.

## Packages

| Package | Description |
|---------|-------------|
| [`@sico/config`](packages/config/) | Shared engineering configuration (no runtime code) |
| [`@sico/ui`](packages/ui/) | Design tokens + atomic components (shadcn restyles, Tailwind v4) |
| [`@sico/shared`](packages/shared/) | Cross-app code that's not pure UI (hooks, atoms, services, schemas, composers) |
| [`@sico/app`](packages/app/) | Sico frontend application (TanStack Router, Jotai, react-query/axios, zod) |

Dependency chain: `@sico/app → @sico/shared → @sico/ui → @sico/config`.

## Validation

Run the relevant commands from `frontend/`:

```bash
pnpm lint
pnpm test
pnpm build
```

Repository CI validates localization consistency, linting, tests, and the
production build.

## License

MIT
