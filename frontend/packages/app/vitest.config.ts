/// <reference types="vitest" />
import path from "node:path";

import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "@sico/config/vitest.config.base.ts";

// `test/build/**` needs a fresh `dist/` (runs only under `test:build`).
// `e2e/**` is Playwright-only.
export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    test: {
      include: ["test/**/*.test.{ts,tsx}"],
      exclude: [...configDefaults.exclude, "test/build/**", "e2e/**"],
      setupFiles: ["test/setup.ts"],
      coverage: {
        include: ["src/**"],
      },
    },
  }),
);
