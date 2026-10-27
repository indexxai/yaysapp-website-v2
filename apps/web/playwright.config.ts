import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    // A fake microphone, so voice notes can be recorded in tests.
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'], ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] }, testMatch: /responsive/ },
  ],
  webServer: [
    { command: 'node ../../infra/test-stack.mjs', url: 'http://127.0.0.1:4100/v1/health', timeout: 90_000, reuseExistingServer: false, stdout: 'ignore', stderr: 'pipe' },
    { command: 'npx next start -p 3100 -H 127.0.0.1', url: 'http://127.0.0.1:3100/sign-in', timeout: 60_000, reuseExistingServer: false },
  ],
});
