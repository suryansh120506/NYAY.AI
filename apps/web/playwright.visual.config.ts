import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression (opt-in, not part of `pnpm e2e`): pixel comparisons of key screens on the offline build.
 *   pnpm test:visual:update   create or refresh the baselines (run once on each new machine; files are per-OS)
 *   pnpm test:visual          compare against them
 * Baselines live next to the spec in tests/visual/__screenshots__/.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./tests/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" } },
  use: { baseURL: `http://localhost:${PORT}`, reducedMotion: "reduce" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
