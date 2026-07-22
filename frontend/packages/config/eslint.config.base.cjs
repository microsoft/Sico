const globals = require("globals");
const js = require("@eslint/js");
const reactPlugin = require("eslint-plugin-react");
const reactHooksPlugin = require("eslint-plugin-react-hooks");
const importPlugin = require("eslint-plugin-import");
const jsxA11yPlugin = require("eslint-plugin-jsx-a11y");
const unusedImportsPlugin = require("eslint-plugin-unused-imports");
const checkFilePlugin = require("eslint-plugin-check-file");
const githubPlugin = require("eslint-plugin-github").default;
const perfectionistPlugin = require("eslint-plugin-perfectionist");
const nPlugin = require("eslint-plugin-n");
const tailwindcssPlugin = require("eslint-plugin-tailwindcss");
const storybookPlugin = require("eslint-plugin-storybook");
const airbnbExtended = require("eslint-config-airbnb-extended");
const tsEslint = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const prettierConfig = require("eslint-config-prettier");
const path = require("path");
const fs = require("fs");
const localRulesPlugin = require("eslint-plugin-local-rules");
const oxlintPlugin = require("eslint-plugin-oxlint");

function getPackageName(rootDir) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
    );
    return pkg.name;
  } catch {
    return null;
  }
}

// Type-aware rules are now handled by oxlint. Build the set so we can
// explicitly disable them in ESLint (setting "off" alone doesn't prevent
// the rule from loading and crashing without projectService).
// naming-convention is excluded — its type-aware selector was removed so
// the remaining syntactic selectors run fine without projectService.
const typeAwareRuleNames = Object.entries(tsEslint.rules)
  .filter(([, rule]) => rule.meta?.docs?.requiresTypeChecking)
  .map(([name]) => `@typescript-eslint/${name}`)
  .filter((name) => name !== "@typescript-eslint/naming-convention");

/**
 * Creates the base ESLint config array.
 * @param {{ tsconfigRootDir: string }} options — each consumer passes its own __dirname
 */
module.exports = function createBaseConfig({ tsconfigRootDir }) {
  // Resolve monorepo root for import-x/no-extraneous-dependencies — hoisted
  // devDeps live in the root package.json, not in each package.
  const rootDir = path.resolve(tsconfigRootDir, "../..");
  // Canonical SICO auth LS keys — mirrors the `AUTH_*_LS` constants in
  // `packages/shared/src/utils/local-storage.ts`.
  // Kept for documentation; the selectors below ban *all* localStorage member
  // access regardless of key. The only legitimate caller is
  // `packages/shared/src/utils/local-storage.ts` (the wrapper) — every other
  // file must go through the wrapper so the auth LS contract has exactly
  // one runtime entry point.
  const AUTH_LS_METHODS = ["getItem", "setItem", "removeItem", "clear"];
  const pkgName = getPackageName(tsconfigRootDir);
  const reverseImports = {
    "@sico/ui": ["@sico/app"],
    "@sico/shared": ["@sico/app"],
  }[pkgName] || [];
  return [
  {
    // When updating these ignores, also update .oxfmtrc.json and
    // .oxlintrc.json `ignorePatterns` to keep all three in sync.
    //
    // Build/test plumbing files (`vite.config.ts`, `vitest.config.ts`,
    // `vitest.config.build.ts`, `playwright.config.ts`) import `vite` /
    // `@playwright/test` from root devDeps; their `node_modules`
    // resolution differs from runtime code. Playwright artifact dirs
    // (`playwright-report/`, `test-results/`) and TanStack Router's
    // codegen output (`src/routeTree.gen.ts`) are also ignored.
    // Globs are harmless in packages that don't ship them.
    ignores: [
      "dist",
      "eslint.config.cjs",
      "vite.config.ts",
      "vitest.config.ts",
      "vitest.config.build.ts",
      "playwright.config.ts",
      "playwright-report/**",
      "test-results/**",
      "src/routeTree.gen.ts",
      "storybook-static",
      ".storybook/**/*",
      "**/node_modules/**",
      "**/dist/**",
      "test/fixtures/**",
      "**/public/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      parser: tsParser,
      globals: {
        ...globals.browser,
        ...globals.es2020,
        React: "readonly",
        structuredClone: "readonly",
      },
      parserOptions: {
        tsconfigRootDir,
      },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      import: importPlugin,
      "import-x": airbnbExtended.plugins.importX.plugins["import-x"],
      "jsx-a11y": jsxA11yPlugin,
      "unused-imports": unusedImportsPlugin,
      "check-file": checkFilePlugin,
      github: githubPlugin,
      perfectionist: perfectionistPlugin,
      "@typescript-eslint": tsEslint,
      "@stylistic": airbnbExtended.plugins.stylistic.plugins["@stylistic"],
      "local-rules": localRulesPlugin,
      tailwindcss: tailwindcssPlugin,
      storybook: storybookPlugin,
      n: nPlugin,
    },
    settings: {
      "import/resolver": {
        // Match `import-x/resolver` below so both plugins classify the
        // `@/...` alias as `internal` (instead of legacy `import`
        // treating it as `unknown` and `import-x` treating it as
        // `internal`). Without parity, `import/order` and
        // `import-x/order` produce conflicting fixes for files that
        // mix `@/...` and `../relative` imports — "Circular fixes
        // detected" in test files like `offline-banner.test.tsx`.
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx"],
        },
      },
      "import-x/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
        node: {
          extensions: [".js", ".jsx", ".ts", ".tsx"],
        },
      },
      react: {
        version: "detect",
      },
      tailwindcss: {
        // Tailwind v4 ships no JS config file — its design tokens live in
        // `@theme` blocks inside CSS. Without this, eslint-plugin-tailwindcss
        // logs "Cannot resolve default tailwindcss config path" once per file
        // (hundreds of lines of noise). Point it at the shared @sico/ui
        // globals.css via an absolute path derived from THIS config file's
        // location so it resolves identically no matter which package's CWD
        // eslint runs from.
        config: require("node:path").join(
          __dirname,
          "../ui/src/styles/globals.css",
        ),
      },
    },
    rules: {
      ...airbnbExtended.rules.base.bestPractices.rules,
      ...airbnbExtended.rules.base.errors.rules,
      ...airbnbExtended.rules.base.es6.rules,
      ...airbnbExtended.rules.base.imports.rules,
      ...airbnbExtended.rules.base.style.rules,
      ...airbnbExtended.rules.base.variables.rules,
      ...airbnbExtended.rules.react.base.rules,
      ...airbnbExtended.rules.react.hooks.rules,
      ...airbnbExtended.rules.react.jsxA11y.rules,
      ...airbnbExtended.rules.typescript.base.rules,
      ...airbnbExtended.rules.typescript.typescriptEslint.rules,
      ...airbnbExtended.rules.typescript.imports.rules,
      ...tsEslint.configs["recommended-type-checked"].rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs["jsx-runtime"].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsxA11yPlugin.configs.recommended.rules,
      // Disable import-x rules that conflict with TypeScript's module resolution or existing codebase
      "import-x/extensions": "off",
      "import-x/no-unresolved": "off",
      "import-x/no-relative-packages": "off",
      eqeqeq: ["error", "always"],
      "n/global-require": "error",
      "import/no-relative-packages": "off",
      "react/jsx-filename-extension": [
        "error",
        { extensions: [".jsx", ".tsx"] },
      ],
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true },
      ],
      "@stylistic/lines-between-class-members": [
        "error",
        "always",
        { exceptAfterSingleLine: true },
      ],
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "variable",
          modifiers: ["global"],
          format: ["camelCase"],
          filter: {
            match: true,
            regex: "Atom$",
          },
        },
        {
          selector: "variable",
          modifiers: ["global", "const"],
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
        },
        {
          // this represents lets, not consts
          selector: "variable",
          modifiers: ["global"],
          format: ["camelCase"],
        },
        {
          selector: "variable",
          format: ["camelCase", "PascalCase", "UPPER_CASE"],
        },
        {
          selector: "function",
          format: ["camelCase", "PascalCase"],
        },
        {
          selector: "typeLike",
          format: ["PascalCase"],
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "clsx",
              message: "Please use 'cn' utility instead of clsx.",
            },
            {
              name: "react-cookie",
              message:
                "Do not import react-cookie. Cookies must be handled by the dedicated auth/cookie service.",
            },
            ...reverseImports.map((source) => ({
              name: source,
              message: `Reverse-direction import: ${pkgName} must not import ${source}.`,
            })),
          ],
          patterns: [
            {
              group: ["styled-components", "styled-components/*"],
              message:
                "Do not use styled-components. This project uses Tailwind v4 for styling.",
            },
          ],
        },
      ],
      "@typescript-eslint/no-restricted-imports": "off",
      "@typescript-eslint/no-unnecessary-condition": "error",
      // superseded by unused-imports
      "@typescript-eslint/no-unused-vars": "off",
      // superseded by unused-imports
      "no-unused-vars": "off",
      "@typescript-eslint/no-use-before-define": "off",
      "react/no-unknown-property": "error",
      "@stylistic/padding-line-between-statements": [
        "error",
        {
          blankLine: "always",
          prev: "*",
          next: "function",
        },
        {
          blankLine: "always",
          prev: "function",
          next: "*",
        },
      ],
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            arguments: false,
            attributes: false,
            properties: false,
            variables: false,
          },
        },
      ],
      "@typescript-eslint/unbound-method": [
        "error",
        {
          ignoreStatic: true,
        },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNever: true,
        },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "class-methods-use-this": "off",
      "check-file/filename-naming-convention": [
        "error",
        {
          "**/*.{ts,tsx}": "KEBAB_CASE",
        },
        { ignoreMiddleExtensions: true },
      ],
      "func-style": ["error", "declaration", { allowArrowFunctions: true }],
      "func-names": ["error", "as-needed", { generators: "never" }],
      "github/array-foreach": "error",
      "local-rules/no-erroneous-spaces-in-classname": "error",
      "local-rules/require-avatar-fallback": "error",
      "local-rules/require-role-for-list-none": "error",
      "import/order": [
        "error",
        {
          alphabetize: {
            caseInsensitive: true,
            order: "asc",
          },
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling"],
            "index",
          ],
          "newlines-between": "always",
          warnOnUnassignedImports: true,
        },
      ],
      "import/prefer-default-export": "off",
      "import-x/prefer-default-export": "off",
      "jsx-a11y/no-redundant-roles": [
        "error",
        {
          ul: ["list"],
          li: ["list"],
        },
      ],
      "jsx-a11y/no-autofocus": "off",
      "max-classes-per-file": "off",
      // Machine-checkable half of the `code-quality` rule — over the cap
      // means "split it", not "raise the number". Function length is scoped
      // by extension below.
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      "max-params": ["error", 4],
      "max-depth": ["error", 4],
      "no-await-in-loop": "off",
      "no-console": "error",
      "no-continue": "off",
      "no-implicit-coercion": ["error", { boolean: true }],
      "no-restricted-syntax": [
        "error",
        "ForInStatement",
        "LabeledStatement",
        "WithStatement",
        "TSEnumDeclaration",
        {
          selector:
            "MemberExpression[object.name='document'][property.name='cookie']",
          message:
            "Do not access document.cookie directly. Cookies must be handled by the dedicated auth/cookie service.",
        },
        ...AUTH_LS_METHODS.flatMap((method) => [
          {
            selector: `CallExpression[callee.object.name='localStorage'][callee.property.name='${method}']`,
            message:
              "Direct localStorage access is banned. Import the wrapper from '@sico/shared/utils/local-storage' (or '@/utils/local-storage' inside @sico/shared) so the auth LS contract has one entry point.",
          },
          {
            selector: `CallExpression[callee.object.object.name='window'][callee.object.property.name='localStorage'][callee.property.name='${method}']`,
            message:
              "Direct localStorage access is banned. Import the wrapper from '@sico/shared/utils/local-storage' (or '@/utils/local-storage' inside @sico/shared) so the auth LS contract has one entry point.",
          },
        ]),
      ],
      "no-void": ["error", { allowAsStatement: true }],
      // formatting handled by oxfmt – run standalone via lint:fmt
      quotes: ["error", "double", { avoidEscape: true }],
      "react/no-array-index-key": "error",
      "react/require-default-props": "off",
      ...tailwindcssPlugin.configs.recommended.rules,
      "tailwindcss/no-custom-classname": [
        "error",
        {
          callees: ["clsx", "cn"],
          cssFiles: ["src/styles/globals.css"],
          // Each entry is a JS regex the plugin anchors as `^(entry)$` against
          // the class (variant prefix stripped) — so `scrollbar` does NOT cover
          // `scrollbar-none`; each utility needs its own entry. Keep it small and
          // additive; audit periodically (drop an entry `grep -rE` no longer hits
          // across packages/{ui,shared,app}/{src,stories}).
          whitelist: [
            // ─── Component-layer tokens ──────────────────────────────────
            // Matches `{utility}-{component}-{slot}-{state}` for any new
            // component token. Covers: button, input, surface, status, menu,
            // card, chip, dialog, tabs, tooltip, popover, sheet, icon,
            // focus, progress, etc.
            "(bg|text|border|ring|shadow|fill|stroke|outline)\\-(button|input|surface|status|menu|card|chip|dialog|tabs?|tooltip|popover|sheet|icon|focus|progress)\\-.+",
            // Card / surface borders use a `{border,ring}-stroke-*` namespace
            // (e.g. `border-stroke-subtle-card-rest`, `border-stroke-strong-rest`,
            // `ring-stroke-subtle-card-rest`) where the outer utility is
            // `border`/`ring` and `stroke` is the semantic token group. The
            // `ring` utility covers Popover, whose upstream uses a decorative
            // ring rather than a layout border.
            // (`ring-focus-ring-*` is already covered by the component regex above.)
            "(border|ring)\\-stroke\\-.+",
            // ─── Semantic foreground / gradient ──────────────────────────
            "text\\-foreground\\-.+",
            "bg\\-gradient\\-.+",
            // ─── Typography @theme tokens (--leading-*, --text-2xs) ──────
            // Tailwind ships text-xs…text-9xl but not `2xs`; both are SICO
            // @theme tokens cssFiles can't see (see the bridge note below).
            "(leading\\-(display|body|body-2)|text\\-2xs)",
            // ─── Top-level semantic aliases (no -prefix segment) ─────────
            // (`bg-background` / `text-foreground` live in the shadcn bridge
            // regex below — kept here only for `border-divider`, which has no
            // bridge entry.)
            "border\\-divider",
            // ─── Shadcn bridge color tokens (designer-confirmed @theme
            // mappings in globals.css → SICO semantic tokens). These are the
            // fixed shadcn variable names (`--color-foreground`, `--color-ring`,
            // `--color-input`, …) that restyled components keep verbatim from
            // upstream. `@theme` vars aren't emitted as literal CSS classes, so
            // `cssFiles` can't see them — the whitelist is the mechanism.
            // `-foreground` is bound only to the tokens that actually own a
            // foreground pair in the shadcn contract (`card`, `popover`,
            // `primary`, …) — `background`/`foreground`/`border`/`input`/`ring`
            // have none, so `input-foreground` & friends stay rejected. The
            // trailing `/\d+` covers opacity modifiers (`ring-ring/50`).
            "(bg|text|border|ring|shadow|fill|stroke|outline)\\-(background|foreground|border|input|ring|(card|popover|primary|secondary|muted|accent|destructive)(\\-foreground)?)(/\\d+)?",
            // ─── Custom utilities defined in globals.css @utility ────────
            "scrollbar(\\-none)?",
            "toast\\-loading\\-bar",
            // `shiny-text` lays the swept gradient skin (paired with
            // `animate-shimmer`); `skeleton` lays the shimmer-sweep skin for
            // loading placeholders (paired with `animate-skeleton`).
            "shiny\\-text",
            "skeleton",
            // App-canvas ambient background — three sibling layers on
            // app-shell's `<main>`: `bg-app-glow-warm` / `bg-app-glow-cool` are
            // the two blurred color washes; `bg-app-grain` is the paper-grain
            // overlay multiplied over both.
            "bg\\-app\\-(glow\\-(warm|cool)|grain)",
            // ─── Shadow scale aliases ────────────────────────────────────
            "shadow\\-(s|m|l)",
            // DW-home hero avatar glow + app-shell seam shadow (globals.css
            // @theme; `cssFiles` can't resolve @sico/ui vars from @sico/shared).
            "shadow\\-(avatar\\-glow\\-(rest|hover)|seam)",
            // ─── Animation: third-party library primitives ──────────────
            // tw-animate-css / Tailwind v4 built-ins. Names owned by the
            // library; the lint plugin doesn't know them. Matches
            // `motion-safe:`/`motion-reduce:` variants too.
            "animate\\-(in|out)",
            "fade\\-(in|out)\\-\\d+",
            "zoom\\-(in|out)\\-\\d+",
            "slide\\-in\\-from\\-.+",
            // ─── Animation: SICO --animate-* tokens (globals.css @theme) ──
            // var()-aliased @theme vars `cssFiles` can't resolve (the
            // thinking-strip shimmer, the skeleton sheen, the login
            // entrance/exit, the DW-home entrance). One line per token so each
            // stays grep-auditable.
            "animate\\-shimmer",
            "animate\\-skeleton",
            "animate\\-login\\-(entrance|exit)",
            "animate\\-starter\\-(reveal|fade)",
            // ─── Motion scale: SICO --duration-* / --ease-* (globals.css
            // @theme) ────────────────────────────────────────────────────
            // Semantic motion tokens (`duration-medium-1`, `ease-persistent`,
            // …) the Sidebar + chat Sidepane width transitions ride. `@theme`
            // vars aren't emitted as literal classes, so `cssFiles` can't see
            // them — the whitelist is the mechanism.
            "duration\\-(micro|short\\-[12]|medium\\-[12]|mega)",
            "ease\\-(entrance|exit|persistent|elastic)",
            // ─── Foundation color scales (stories + token audit pages) ───
            "(bg|text|border)\\-(primary|danger|warn|neutral|success|info)\\-\\d+",
          ],
        },
      ],
      "tailwindcss/enforces-negative-arbitrary-values": "error",
      "tailwindcss/enforces-shorthand": "error",
      "tailwindcss/no-contradicting-classname": "error",
      "sort-imports": [
        "error",
        {
          ignoreCase: true,
          ignoreDeclarationSort: true,
        },
      ],
      // Use import-x/no-extraneous-dependencies instead.
      "import/no-extraneous-dependencies": "off",
      "import-x/no-extraneous-dependencies": [
        "error",
        {
          // `e2e/**/*` is for Playwright specs (only `app` ships them today;
          // glob is harmless in packages without an e2e tree).
          devDependencies: ["./test/**/*", "./stories/**/*", "./e2e/**/*"],
          packageDir: [tsconfigRootDir, rootDir],
        },
      ],
      // Allows us to automatically remove unused imports
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          ignoreRestSiblings: true,
          caughtErrors: "none",
        },
      ],
      "no-param-reassign": [
        "error",
        {
          props: true,
          ignorePropertyModificationsFor: [
            "draft", // immer pattern
            "acc", // reduce function
          ],
          ignorePropertyModificationsForRegex: [
            "^(r|.*R)ef$", // React refs
          ],
        },
      ],
      "no-template-curly-in-string": "error",
      "no-underscore-dangle": ["error", { allow: [] }],
      "react/jsx-props-no-spreading": "error",
      "react/function-component-definition": ["error"],
      "react/no-danger": "error",
      "react/no-unused-prop-types": "error",
      "react/jsx-one-expression-per-line": "off",
      "react/jsx-wrap-multilines": "off",
      "react/jsx-curly-newline": "off",
      "react/jsx-indent": "off",
      "react/jsx-closing-tag-location": "off",
      "react-hooks/refs": "off",
      "no-bitwise": "error",
      "no-alert": "error",
      "consistent-return": "error",
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }],
      "no-promise-executor-return": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/dot-notation": "error",
      "@typescript-eslint/no-unused-expressions": "error",
      "no-script-url": "error",
      // Type checking is already provided by typescript and don't need it from lint.
      "no-undef": "off",
      "import/no-named-default": "error",
      // Use @typescript-eslint/no-redeclare instead to allow type redeclarations
      "no-redeclare": "off",
      "@typescript-eslint/no-redeclare": "error",
      "no-plusplus": ["error", { allowForLoopAfterthoughts: true }],
      // Class-component-only rules — this codebase has zero class components.
      "react/no-direct-mutation-state": "off",
      "react/prefer-stateless-function": "off",
      "react/static-property-placement": "off",
      "react/no-arrow-function-lifecycle": "off",
      "react/require-render-return": "off",
      "react/sort-comp": "off",
      "react/state-in-constructor": "off",
      "react/no-redundant-should-component-update": "off",
      "react/prefer-exact-props": "off",
      "react/default-props-match-prop-types": "off",
      "react/no-did-update-set-state": "off",
      "react/no-will-update-set-state": "off",
      "react/no-is-mounted": "off",
      "react/no-string-refs": "off",
      "react/no-access-state-in-setstate": "off",
      "react/no-unused-state": "off",
      "react/prefer-es6-class": "off",
      "react/no-unused-class-component-methods": "off",
    },
  },
  // Function-length cap, split by extension: a .ts module's 50 lines is logic
  // complexity; a .tsx component's is mostly JSX markup, so it gets 100.
  {
    files: ["**/*.ts"],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["**/*.tsx"],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 100, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // Test files override — relax non-type-aware rules only.
  // Type-aware rules (`@typescript-eslint/no-unsafe-*`, `unbound-method`,
  // `no-base-to-string`, `prefer-promise-reject-errors`) live in
  // `.oxlintrc.json`'s `test/**` override — ESLint auto-disables them via
  // `oxlintPlugin.buildFromOxlintConfig` so duplicating them here is dead
  // code. Keep this block focused on rules ESLint actually owns.
  {
    files: ["test/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "max-lines-per-function": "off",
      "max-lines": "off",
    },
  },
  // Stories override — Storybook stories are dev-only authoring helpers.
  // As with the test override above, type-aware rules are owned by
  // `.oxlintrc.json`'s `**/stories/**` override. Only `react-hooks` is
  // ESLint's to relax here. Uses `**/stories/**` (any depth) to match
  // oxlint's glob.
  {
    files: ["**/stories/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "max-lines-per-function": "off",
      "max-lines": "off",
    },
  },
  // E2E specs (Playwright) — `e2e/**` sits outside `test/**`. Its `test(...)`
  // step callbacks are legitimately long, same as unit describe/it blocks.
  {
    files: ["**/e2e/**/*.{ts,tsx}"],
    rules: {
      "max-lines-per-function": "off",
      "max-lines": "off",
    },
  },
  // Override for JavaScript files to not use TypeScript-specific rules and parser
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node,
      },
    },
    plugins: {
      n: nPlugin,
    },
    rules: {
      "consistent-return": "off",
      "import/extensions": "off",
      "no-template-curly-in-string": "error",
      "no-console": "error",
      "no-underscore-dangle": ["error", { allow: [] }],
      "no-bitwise": "error",
      "n/global-require": "error",
      "no-unused-vars": [
        "error",
        {
          caughtErrors: "none",
        },
      ],
    },
  },
  // Must be last among rule-disabling configs — disables ESLint rules that conflict with oxfmt formatting
  prettierConfig,
  // Enable curly after eslint-config-prettier (it disables curly as a "special rule")
  { rules: { curly: ["error", "all"] } },
  // Auto-disable ESLint rules that oxlint handles (reads .oxlintrc.json).
  // Also catches future non-type-aware rule migrations automatically.
  ...oxlintPlugin.buildFromOxlintConfig(require("./.oxlintrc.json")),
  // Disable remaining type-aware rules not in oxlintrc — they crash without
  // projectService. Airbnb spreads them in multiple places so we need a catch-all.
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: Object.fromEntries(typeAwareRuleNames.map((rule) => [rule, "off"])),
  },
  // Don't flag eslint-disable comments as "unused" when the rule they
  // suppress has been migrated to oxlint. oxlint still reads these comments.
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  ];
};
