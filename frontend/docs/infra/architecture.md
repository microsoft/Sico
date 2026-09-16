# Architecture — Sico frontend

## Repository Structure

```text
frontend/
├── packages/
│   ├── config/             Shared engineering configuration
│   ├── ui/                 Design tokens + Atomic components
│   ├── shared/             Shared business logic
│   └── app/                Frontend application
├── docs/
│   ├── design-system/      Design tokens + usage guidelines
│   ├── features/           Per-feature design/plan/review docs
│   ├── infra/              Infrastructure documentation (this file lives here)
│   ├── migration/          Legacy-to-SICO migration notes
│   └── research/           Studio-comparison research notes
├── scripts/                Repo automation scripts
├── .agents/                Agent skill definitions
├── .claude/                Claude Code project config
├── .mcp.json               Project MCP servers
├── CLAUDE.md               Entry point for Claude Code
├── README.md               Human-facing intro
├── package.json            Root workspace manifest
├── pnpm-workspace.yaml     pnpm workspace definition
├── pnpm-lock.yaml          Lockfile
├── turbo.json              Turborepo task definitions
├── .oxlintrc.json          oxlint type-aware rules
└── skills-lock.json        Pinned skill versions
```

Packages form a single-direction dependency chain (enforced by convention):

```text
@sico/app → @sico/shared → @sico/ui → @sico/config
```

**Package roles**

| Package | Role | Depends on |
|---------|------|------------|
| `@sico/config` | Shared engineering configuration (ESLint, oxlint, oxfmt, tsconfig, Vitest). No runtime code. | — |
| `@sico/ui` | Design tokens + atomic UI primitives (shadcn restyles, Tailwind v4). Pure presentation, no app state or services. | `@sico/config` (dev) |
| `@sico/shared` | Cross-app code that isn't pure UI — hooks, Jotai atoms, services, zod schemas, composer components, and full **feature implementations**. | `@sico/ui`, `@sico/config` (dev) |
| `@sico/app` | The Sico frontend application — a thin, route-only scaffold (TanStack Router, Jotai, react-query/axios, zod) that mounts shared features. | `@sico/shared`, `@sico/ui`, `@sico/config` (dev) |

The chain is strictly single-direction — `@sico/app → @sico/shared → @sico/ui → @sico/config` — so a lower layer never imports an upper one.

**How apps extend `@sico/shared`**

`@sico/shared` is the minimal business core: business features (UI + state + services + schemas) live in `@sico/shared/src/features/{name}/`. Apps build on the full chain — `@sico/config`, `@sico/ui`, `@sico/shared` — and stay thin: `@sico/app`, DWP, or a future one each mounts shared features and adds only its own app-specific logic that shared doesn't provide (e.g. a notification system).

A route binds a feature to a URL — `@sico/app` for example:

```tsx
// packages/app/src/routes/_authed/project.index.tsx
import {
  Projects,
  projectsQueryOptions,
} from "@sico/shared/features/projects/index.ts";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/project/")({
  loader: ({ context }) => {
    void context.queryClient.prefetchInfiniteQuery(
      projectsQueryOptions({}, context.apiClient),
    );
  },
  component: Projects,
});
```

## Anatomy of a feature

Each feature is a self-contained slice that mirrors the package's top-level by-kind layout, with an `index.ts` barrel as its **only** public entry. A representative feature (`features/projects/`):

```text
features/projects/
├── index.ts                Public barrel — the only entry other packages import
├── constants.ts            Feature-local constants
├── components/             Feature UI (composers built from @sico/ui primitives)
├── hooks/                  react-query hooks + query options
├── services/               axios calls to the backend
├── schemas/                zod schemas validating responses at the boundary
└── assets/                 Feature-local static assets (svg, …)
```

**Promotion rule:** when a feature-local module picks up a 2nd consumer, it moves up to the matching top-level by-kind dir in `@sico/shared/src/` (becoming a cross-feature primitive) and is re-exported from `src/index.ts`.

**Data flow**

A feature's read path is a fixed pipeline — **schema → service → react-query → component** — with errors thrown across a Suspense/ErrorBoundary seam rather than threaded through props:

```text
schema      zod parses the response at the boundary; a bad shape throws ZodError
  ↓
service     async fn calls axios, unwraps the envelope, returns a typed value
  ↓
react-query queryOptions + useSuspenseQuery — suspends while pending, throws on error
  ↓
component   feature root wraps <ErrorBoundary><Suspense>; leaf reads data directly
```

A minimal implementation path:

```tsx
// schema — one zod schema is both the boundary validator and the inferred type
const envelope = apiResponseSchema(/* { projects, total, hasNext } → Paged<Project> */);

// service — request, parse at the boundary, throw on an off-contract body
export async function fetchProjects(apiClient, params) {
  const res = await apiClient.get("/project/user_projects", { params });
  return envelope.parse(res.data).data; // ZodError → caught by the boundary
}

// react-query — options split from the hook so a loader can prefetch the same key
export const projectsQueryOptions = (params, apiClient) => ({
  queryKey: ["projects", "list", params],
  queryFn: ({ pageParam }) => fetchProjects(apiClient, { ...params, page: pageParam }),
});

// component — the root owns the Suspense/ErrorBoundary seam; the leaf just reads data
function Projects() {
  const { reset } = useQueryErrorResetBoundary();
  return (
    <ErrorBoundary FallbackComponent={ErrorView} onReset={reset}>
      <Suspense fallback={<ProjectsGridSkeleton />}>
        <ProjectsGrid />
      </Suspense>
    </ErrorBoundary>
  );
}
```

This pipeline owns **server state** only. **Client state** (auth/session) lives in jotai atoms under `@sico/shared/src/atoms/` (e.g. `auth-atom.ts`) — a separate layer that components read directly, not part of the read path above.

**UI composition**

A feature's UI is assembled from four stacked layers — each one only ever reaches down to the layers below it:

```text
④ feature composers     @sico/shared/features/{name}/components/ — feature-owned, not shared
  ↑
③ shared composers      @sico/shared/components/ — cross-feature UI (promoted on a 2nd consumer)
  ↑
② atomic components     @sico/ui — Button, Avatar, Dialog, Table … (shadcn restyles)
  ↑
① design tokens         @sico/ui/styles/globals.css — semantic CSS vars (Tailwind classes)
```

- **① design tokens** — semantic CSS variables consumed as Tailwind classes. The single source of visual truth; components never hardcode a raw color or size.
- **② atomic components** — the presentation primitives in `@sico/ui`. Pure UI styled entirely from layer ①, with no app state or services.
- **③ shared composers** — cross-feature UI in `@sico/shared/components/`, built from layers ① + ②. A feature-local composer lands here once it gains a 2nd consumer (the promotion rule).
- **④ feature composers** — a feature's own `components/`, private to that feature: they compose the layers below and bind in data + behavior.

This stack is the UI face of the dependency chain: a feature imports downward, never the reverse.

## Code Quality

Quality is enforced in three layers — a machine hard gate, soft guidance before the code is written, and a review pass before merge:

**Hard gate — lint**

All packages share one four-layer pipeline, configured centrally in `@sico/config`:

```text
tsgo     → Type errors
oxlint   → Type-aware rules (Rust)
ESLint   → Airbnb + React + a11y + custom rules
oxfmt    → Formatting + Tailwind class sorting
```

Type-aware rules run in **oxlint**, NOT ESLint (auto-disabled via `eslint-plugin-oxlint`). Mechanical thresholds (function ≤ 50/100 lines, file ≤ 300, params ≤ 4, nesting ≤ 4) are ESLint rules, so crossing one fails the build.

**Soft guidance — rules + skills**

What lint can't encode is loaded into the agent's context before it writes:

- **Path-scoped rules** (`.claude/rules/*.md`) — eight files (`code-quality`, `i18n`, `react`, `schemas`, `security`, `stories`, `styling`, `testing`) whose `paths:` globs decide which source files pull them in. They carry the *why* lint can't, kept in sync with the thresholds.
- **Best-practice skills** — e.g. `vercel-react-best-practices`, an orthogonal performance axis the SICO rules don't cover.

**Code review — `sico-review`**

`sico-review` dispatches 5 reviewer subagents in parallel against the merge-base diff, each owning a scope — `code-quality-reviewer` (duplication, dead code, naming, error handling), `react-reviewer` (hook deps, rendering, state), `security-reviewer` (XSS, injection, secrets, auth boundaries), `style-reviewer` (kebab-case, `cn()`, token discipline), `typescript-reviewer` (explicit return types, no `any`, strict null) — and rolls their findings into a single report.

## Testing

Three kinds of tests, each catching a different class of regression:

**Visual — Storybook**

Renders each component's states in isolation so reviewers can verify appearance, accessibility, and token usage by eye — without booting the full app.

**Unit — Vitest + RTL (test-driven)**

Pins the behavior of individual components, hooks, and logic. Written test-first: a failing test defines the expected behavior before the code that satisfies it exists.

**E2E — Playwright**

Drives the running app like a user — routing, auth, and the core feature flows — to catch breakage that only shows up once the pieces are wired together.

## Workflow

A feature is delivered by `sico-kickoff`, which orchestrates the superpowers workflow end to end. An existing, signed-off `migration.md` can seed the kickoff for legacy features.

```text
[`sico-kickoff`] orchestrates:

  1. Brainstorm   superpowers:brainstorming        ──► design.md  (+ worktree at sign-off)
  2. Plan         superpowers:writing-plans        ──► plan.md
  3. Implement    superpowers:subagent-driven-development ──► code + tests
        ▲
        │ fix-loop: comment → back to Implement; clean → advance
        ▼
  4. Figma audit  sico-figma-audit ◆   (UI only — pixel parity vs Figma frames)
  5. Review       sico-review ◆        (5 reviewer subagents over the merge-base diff)
  6. QA pass      agent-browser dogfood ◆   (real-browser exploratory testing)
        │
        ▼
  7. Complete     superpowers:finishing-a-development-branch ──► push + PR
```

Each ◆ stage is an inspection gate: it emits a `**Verdict:**` of `approve` / `comment` / `blocked` and never patches code itself. A `comment` loops back to Implement for a fix and re-runs the inspection; only a clean pass advances. Inspection and fixing are kept strictly separate.
