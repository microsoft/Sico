# Fonts

## `Geist-Variable.woff2`

**Status:** Active (variable font, weight 100–900).

The primary UI typeface — [Geist][geist-src] by Vercel (OFL 1.1). The CSS
shipping path (`src/assets/fonts/Geist-Variable.woff2`, referenced from
`src/styles/globals.css` via a single `@font-face` block) is the canonical
runtime path. A single variable file covers every weight, so `--font-sans`
resolves to `"Geist", ui-sans-serif, system-ui, sans-serif`.

The unit tests under `test/config/globals-css.test.ts` string-match the CSS
for the `Geist` family and the single `@font-face` block.

[geist-src]: https://github.com/vercel/geist-font
