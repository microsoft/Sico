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
