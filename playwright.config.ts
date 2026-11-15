import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const MAC_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const useMacChrome =
  process.platform === 'darwin' && !process.env.CI && existsSync(MAC_CHROME_PATH);

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
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(useMacChrome ? { channel: 'chrome' } : {}),
      },
    },
  ],
  webServer: {
    // CI already runs an explicit `npm run build` step, so just preview the
    // existing dist/ there; locally, build first for a one-command run.
    command: process.env.CI
      ? 'npm run preview -- --port 4173'
      : 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
