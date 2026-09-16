# CLAUDE.md — frontend

The canonical Sico frontend lives in `frontend/` inside the Sico monorepo. It is
a pnpm + Turborepo workspace for the application and shared frontend packages.

## Stack

React 19 + TypeScript 5.9, Vite 6 + SWC, Tailwind v4, tsgo + oxlint + ESLint + oxfmt, Vitest + RTL + Playwright, Storybook 9, `@tanstack/react-router`, jotai + immer, react-query + axios, zod, react-error-boundary.

## Packages

- `@sico/config` — Shared engineering configuration (no runtime code)
- `@sico/ui` — Design tokens + atomic components (shadcn restyles, Tailwind v4)
- `@sico/shared` — Cross-app code that's not pure UI (hooks, atoms, services, schemas, composers)
- `@sico/app` — Sico frontend application (TanStack Router, Jotai, react-query/axios, zod)

Dependency chain: `@sico/app → @sico/shared → @sico/ui → @sico/config`.

## Commands

`pnpm install` → `pnpm dev` / `pnpm lint` / `pnpm test` (turbo-orchestrated across all packages). The Vite development proxy targets `http://localhost:8080`; start the full stack with `make -C .. compose-up`. See [README.md](README.md) for lifecycle commands.

## Botmux SICO Loop Routing

When `<botmux_routing>` is present, automatically initialize `sico-loop` only
for requests that ask to implement, fix, or otherwise mutate the repository.
Reviews, retrospectives, explanations, questions, and status requests may load
the skill's rules but must not create a Run. A reply to a genuine active-Run
decision continues that Run; an analytical follow-up does not start a new one.
Before initialization, apply the skill's `ALREADY_SATISFIED` preflight so a
request already met by the current `HEAD` exits without a worktree or workers.

## Message Catalogs

`packages/shared/src/locales/*/messages.{po,js,mjs}` are huge generated Lingui catalogs. Don't
read, grep, or diff them unless the task is itself about localization; exclude them from
repo-wide sweeps (`git diff -- . ':!*/locales/*'`).

## Architecture

See [docs/infra/architecture.md](docs/infra/architecture.md) for repository structure, lint
pipeline, and workflow.

## Design

See [docs/design-system/sico-design-guideline.md](docs/design-system/sico-design-guideline.md) for semantic
design tokens and usage guidelines.

## Behavioral Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
