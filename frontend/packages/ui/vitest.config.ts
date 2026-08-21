/// <reference types="vitest" />
import path from "node:path";

import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "@sico/config/vitest.config.base.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    test: {
      include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
      setupFiles: ["test/setup.ts"],
      coverage: {
        include: ["src/**"],
      },
    },
  }),
);
