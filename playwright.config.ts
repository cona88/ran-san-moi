import { defineConfig, devices } from '@playwright/test';

// E2E runs against the production build served by `vite preview`,
// so the smoke test exercises the same bundle that ships.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // In CI, emit inline annotations AND a downloadable HTML report (uploaded as
  // an artifact); the bare 'github' reporter writes no report directory.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // CI already runs an explicit `pnpm build` step, so just preview the
    // existing dist/ there; locally, build first for a one-command run.
    command: process.env.CI ? 'pnpm preview --port 4173' : 'pnpm build && pnpm preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
