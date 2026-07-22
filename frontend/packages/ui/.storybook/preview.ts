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

import type { Preview } from "@storybook/react-vite";
import { withThemeByDataAttribute } from "@storybook/addon-themes";
import { LucideProvider } from "lucide-react";
import { createElement } from "react";

import "../src/styles/globals.css";

const preview: Preview = {
  parameters: {
    options: {
      storySort: {
        order: ["Theme", "Utilities", "Components"],
        method: "alphabetical",
      },
    },
    // Hide storybook-design-token's per-story panel. Its preset injects the
    // panel via managerEntries (can't be dropped from the addons list without
    // also losing the JSON the Theme/DesignTokens MDX depends on), so suppress
    // it here by its paramKey. The viteFinal hook that emits
    // design-tokens.source.json is untouched, so DesignTokenDocBlock still works.
    designToken: { disable: true },
  },
  decorators: [
    (Story) => createElement(LucideProvider, { strokeWidth: 1 }, createElement(Story)),
    withThemeByDataAttribute({
      themes: {
        light: "light",
        dark: "dark",
      },
      defaultTheme: "light",
      attributeName: "data-theme",
    }),
  ],
};

export default preview;
