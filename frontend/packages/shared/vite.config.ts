import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

// Storybook consumes this for the Tailwind v4 + SWC plugins and the
// `@` → `src/` alias. Without `@tailwindcss/vite` Storybook can't scan
// `stories/**` for utility classes, so previews render unstyled.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
