/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

// Build-artifact regression tests. Run via `pnpm test:build` against a
// fresh `dist/` — excluded from default discovery in `vitest.config.ts`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/build/**/*.test.ts"],
    passWithNoTests: false,
  },
});
