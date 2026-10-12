import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/showcase',
  timeout: process.env.SHOWCASE_BASE_URL ? 180_000 : 90_000,
  expect: { timeout: process.env.SHOWCASE_BASE_URL ? 20_000 : 5_000 },
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    baseURL: process.env.SHOWCASE_BASE_URL ?? 'http://127.0.0.1:4196/storyforge/',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  ...(!process.env.SHOWCASE_BASE_URL ? { webServer: {
    command: 'npm run preview -- --mode showcase --host 127.0.0.1 --port 4196 --strictPort',
    url: 'http://127.0.0.1:4196/storyforge/',
    reuseExistingServer: false,
    timeout: 120_000,
  } } : {}),
})
