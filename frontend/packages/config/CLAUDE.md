# @sico/config — CLAUDE.md

Shared engineering configuration. Contains no runtime code and has no scripts — consumed by other packages only.

## Structure

```text
packages/config/
├── eslint.config.base.cjs    Base ESLint config — `createBaseConfig({ tsconfigRootDir })`
├── eslint-local-rules.cjs    Proxy entry for custom rules
├── eslint-local-rules/       Custom ESLint rule implementations (JSX/a11y)
├── .oxlintrc.json            oxlint type-aware rules
├── .oxfmtrc.json             oxfmt formatting + Tailwind class sorting
├── tsconfig.base.json        TypeScript base (no JSX)
├── tsconfig.react.json       TypeScript + React JSX
├── vitest.config.base.ts     Vitest base config
└── commitlint.config.js      Conventional commit rules
```

**Do not modify these config files casually.** They are the single source of truth for engineering standards — every change ripples to every consumer. If a package needs different behavior, override at the consumer instead of editing the base:

- ESLint → extend in `packages/<pkg>/eslint.config.cjs`
- TypeScript → extend in `packages/<pkg>/tsconfig.json`
- Vitest → extend in `packages/<pkg>/vitest.config.ts`
- oxlint / oxfmt → pass per-package flags in `package.json` scripts

## Dependencies

Depends on: none (zero deps) · Depended on by: `@sico/ui`, `@sico/shared`, `@sico/app`.
