import { defineConfig, type PlaywrightTestProject } from '@playwright/test';

const projects: PlaywrightTestProject[] = [
  { name: 'chrome', use: { browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL === 'chromium' ? 'chromium' : 'chrome' } },
  { name: 'safari-webkit', use: { browserName: 'webkit' } },
  { name: 'edge', use: { browserName: 'chromium', channel: 'msedge', launchOptions: process.env.PLAYWRIGHT_EDGE_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EDGE_EXECUTABLE_PATH } : {} } },
];

export default defineConfig({
  testDir: './tests/server-browser',
  // Each run has its own temporary database. Tests replace that library serially;
  // concurrent editors are created explicitly within an individual test.
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results/server',
  use: {
    baseURL: 'http://127.0.0.1:5183',
    viewport: { width: 1600, height: 1050 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects,
  webServer: {
    command: 'bun tests/server-browser/start-server.ts',
    url: 'http://127.0.0.1:5183/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
