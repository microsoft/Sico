/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
