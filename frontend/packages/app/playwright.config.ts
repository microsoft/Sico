import { defineConfig } from "@playwright/test";

// `webServer` runs `vite preview` (production-like static server) so
// E2E coverage stays close to what users actually receive.
const PREVIEW_PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Bumped to match webServer.timeout so a slow first build isn't blamed
  // on a slow test.
  timeout: 120_000,
  reporter: process.env.CI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
        ["json", { outputFile: "playwright-report/e2e.json" }],
      ]
    : "list",
  use: {
    // `SICO_E2E_URL` points CI/smoke jobs at a deployed preview.
    baseURL: process.env.SICO_E2E_URL ?? `http://localhost:${PREVIEW_PORT}`,
    headless: true,
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: process.env.SICO_E2E_URL
    ? undefined
    : {
        command: `pnpm vite preview --port ${PREVIEW_PORT}`,
        port: PREVIEW_PORT,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
