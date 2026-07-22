# @sico/ui — CLAUDE.md

Design tokens + Atomic components for SICO. React 19 + Tailwind CSS v4 + shadcn/ui restyles.

## Commands

`npm run dev` (Storybook :6006) / `lint` / `test` / `build-storybook`.

## Structure

```text
packages/ui/
├── src/
│   ├── components/ui/        shadcn-restyled atomic components
│   ├── lib/utils.ts          `cn()` helper (clsx + tailwind-merge)
│   ├── styles/
│   │   └── globals.css       Tailwind v4 entry + `@theme {}` design tokens
│   ├── assets/fonts/         Bundled font files
│   └── index.ts              Package entry
├── stories/                  Storybook stories + MDX (one pair per component)
├── test/                     Vitest (components / config / lib)
├── components.json           shadcn CLI config
├── vite.config.ts            Storybook + Vitest only (no build)
├── vitest.config.ts          Extends `@sico/config/vitest.config.base.ts`
├── tsconfig.json             Extends `@sico/config/tsconfig.react.json`
└── eslint.config.cjs         Extends base + storybook plugin
```

Each component is a 4-file unit:

```text
src/components/ui/{name}.tsx          Shadcn restyle (cva + Base UI primitives)
stories/{name}.stories.tsx            Live demos + Controls
stories/{name}.mdx                    Narrative + Token Audit
test/components/{name}.test.tsx       Props → className matrix
```

## Conventions

### Tokens

- Token layers (high → low): **Component** → Shadcn Theme → Semantic → Brand → **Foundation**. Each layer references the one below via `var()`, never reverse, never skip-and-hardcode.

### Components

- Components are **shadcn restyles** — start from `shadcn add`, only swap styles to SICO tokens; never change props, interaction, a11y, cva structure, or Radix primitives.
- Use semantic tokens (`bg-button-primary-rest`), not foundation tokens (`bg-neutral-800`).

## Workflow

Development is driven by skills. **Always invoke the relevant skill before writing code.**

```text
[`sico-add-tokens`] ──► globals.css `@theme {}`  (design tokens; independent)

[`shadcn`] ──► src/components/ui/{name}.tsx       (CLI scaffold)
   │
   ▼
[`sico-add-shadcn-components`] orchestrates:
   ├─► restyle to SICO tokens
   ├─► [`sico-add-stories`] ────► stories/{name}.{stories.tsx,mdx}
   └─► [`sico-add-shadcn-tests`] ─► test/components/{name}.test.tsx
```

## Dependencies

Depends on: `@sico/config` (dev) · Depended on by: `@sico/shared`, `@sico/app`.
