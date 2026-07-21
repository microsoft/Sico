const createBaseConfig = require("@sico/config/eslint.config.base.cjs");
const reactRefresh = require("eslint-plugin-react-refresh");

module.exports = [
  ...createBaseConfig({ tsconfigRootDir: __dirname }),
  {
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    // TanStack Router file-based routing reserves `__*.tsx` (root) and
    // `_*.tsx` (layout) prefixes that don't fit kebab-case; `react-refresh/
    // only-export-components` also conflicts with TanStack's
    // `export const Route = createFileRoute(...)({ component: Inline })`
    // shape (warns on Inline, not Route, so `allowExportNames` can't help).
    files: ["src/routes/**/*.{ts,tsx}"],
    rules: {
      "check-file/filename-naming-convention": "off",
      "react-refresh/only-export-components": "off",
    },
  },
];
