# @sico/config

Shared engineering configuration for all packages in the sico-frontend monorepo.

## What's Inside

| File | Purpose | Consumed By |
|------|---------|-------------|
| `eslint.config.base.cjs` | Base ESLint config (Airbnb + React + a11y + tailwindcss + local-rules) | All packages via `createBaseConfig()` |
| `eslint-local-rules.cjs` | Entry point for custom ESLint rules | All packages via proxy file |
| `eslint-local-rules/` | Custom rule implementations | `eslint-local-rules.cjs` |
| `.oxlintrc.json` | oxlint type-aware rules | All packages via `-c` flag |
| `.oxfmtrc.json` | oxfmt formatting + Tailwind class sorting | All packages via `--config` flag |
| `tsconfig.base.json` | TypeScript base (no JSX) | Packages without React |
| `tsconfig.react.json` | TypeScript + React JSX (extends base) | ui, shared, app |
| `vitest.config.base.ts` | Vitest base config | ui, shared, app |
| `commitlint.config.js` | Conventional commit rules | Root lefthook |

## How Packages Consume Config

### ESLint

```js
// packages/<name>/eslint.config.cjs
const createBaseConfig = require("@sico/config/eslint.config.base.cjs");
module.exports = [...createBaseConfig({ tsconfigRootDir: __dirname })];
```

Each package also needs a proxy file for local-rules:

```js
// packages/<name>/eslint-local-rules.cjs
module.exports = require("@sico/config/eslint-local-rules.cjs");
```

### oxlint / oxfmt

```bash
oxlint -c ../../packages/config/.oxlintrc.json --disable-nested-config
oxfmt --config ../../packages/config/.oxfmtrc.json
```

### TypeScript

```json
{ "extends": "@sico/config/tsconfig.react.json" }
```
