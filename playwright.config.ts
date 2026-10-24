import { defineConfig, type PlaywrightTestProject } from '@playwright/test';

// Brand channels exercise real Chrome/Edge. WebKit is the Safari engine check,
// not a claim that the installed Safari application was tested.
const projects: PlaywrightTestProject[] = [
  { name: 'chrome', use: { browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL === 'chromium' ? 'chromium' : 'chrome' } },
  { name: 'safari-webkit', use: { browserName: 'webkit' } },
  { name: 'edge', use: { browserName: 'chromium', channel: 'msedge', launchOptions: process.env.PLAYWRIGHT_EDGE_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EDGE_EXECUTABLE_PATH } : {} } },
];
// Keep previous single-engine commands working; without an override run all three.
const legacyTarget = process.env.PLAYWRIGHT_BROWSER || process.env.PLAYWRIGHT_CHANNEL;
const legacyProjects: Record<string, string> = { webkit: 'safari-webkit', safari: 'safari-webkit', 'safari-webkit': 'safari-webkit', chrome: 'chrome', chromium: 'chrome', edge: 'edge', msedge: 'edge' };
if (legacyTarget && !legacyProjects[legacyTarget]) throw new Error(`未知浏览器 ${legacyTarget}，请选择 chrome、webkit 或 msedge`);

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1600, height: 1050 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: legacyTarget ? projects.filter(project => project.name === legacyProjects[legacyTarget]) : projects,
  webServer: {
    command: 'bun run dev --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
});
