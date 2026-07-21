import type { Preview } from "@storybook/react-vite";
import { LucideProvider } from "lucide-react";
import { createElement } from "react";

import "@sico/ui/styles/globals.css";

const preview: Preview = {
  parameters: {
    options: {
      storySort: {
        method: "alphabetical",
      },
    },
  },
  decorators: [
    (Story) => createElement(LucideProvider, { strokeWidth: 1 }, createElement(Story)),
  ],
};

export default preview;
