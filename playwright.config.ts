import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  outputDir: './screenshots/artifacts',
  snapshotDir: './screenshots/snapshots',
  timeout: 15_000,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'screenshots/report', open: 'never' }],
  ],

  use: {
    baseURL: 'http://localhost:1421',
    // Match the Tauri window dimensions exactly
    viewport: { width: 1100, height: 720 },
    // Dark color scheme like the app
    colorScheme: 'dark',
    screenshot: 'only-on-failure',
    // Enough time for React + animations to settle
    actionTimeout: 5_000,
  },

  projects: [
    {
      name: 'dataorbit',
      testMatch: 'tests/screenshots.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'interactions',
      testMatch: 'tests/interactions.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Auto-start the Vite dev server
  webServer: {
    command: 'npm run dev',
    port: 1421,
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
