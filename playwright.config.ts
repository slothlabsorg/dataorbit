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
      name: 'update-flow',
      testMatch: 'tests/update-flow.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'interactions',
      testMatch: 'tests/interactions.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Integration tests against DynamoDB Local.
      // Requires: npm run db:start && npm run db:seed before running.
      name: 'integration',
      testMatch: 'tests/integration.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      timeout: 30_000,
    },

    // ── Advanced test suites ──────────────────────────────────────────────────
    // All suites require: npm run db:start && npm run db:seed
    // Throttling suites also require: npm run db:localstack:start && npm run db:localstack:seed
    // Large pagination suites also require: npm run db:seed:large
    // 200-table suite requires: npm run db:seed:stress

    { name: 'suite-iso-dates',        testMatch: 'tests/suite-iso-dates.spec.ts',        use: { ...devices['Desktop Chrome'] }, timeout: 30_000 },
    { name: 'suite-cross-join-real',  testMatch: 'tests/suite-cross-join-real.spec.ts',  use: { ...devices['Desktop Chrome'] }, timeout: 45_000 },
    { name: 'suite-time-trace-multi', testMatch: 'tests/suite-time-trace-multi.spec.ts', use: { ...devices['Desktop Chrome'] }, timeout: 45_000 },
    { name: 'suite-export',           testMatch: 'tests/suite-export.spec.ts',           use: { ...devices['Desktop Chrome'] }, timeout: 30_000 },
    { name: 'suite-200-tables',       testMatch: 'tests/suite-200-tables.spec.ts',       use: { ...devices['Desktop Chrome'] }, timeout: 60_000 },
    { name: 'suite-throttling',       testMatch: 'tests/suite-throttling.spec.ts',       use: { ...devices['Desktop Chrome'] }, timeout: 30_000 },
    { name: 'suite-errors',           testMatch: 'tests/suite-errors.spec.ts',           use: { ...devices['Desktop Chrome'] }, timeout: 30_000 },
    { name: 'suite-pagination-large', testMatch: 'tests/suite-pagination-large.spec.ts', use: { ...devices['Desktop Chrome'] }, timeout: 60_000 },
    { name: 'suite-index-patterns',     testMatch: 'tests/suite-index-patterns.spec.ts',     use: { ...devices['Desktop Chrome'] }, timeout: 30_000 },

    // Update modal suite — no db required, uses ?preview_update URL param
    { name: 'suite-update-modal', testMatch: 'tests/suite-update-modal.spec.ts', use: { ...devices['Desktop Chrome'] }, timeout: 20_000 },

    // Financial dataset suites — require: npm run db:start && npm run db:seed:financial
    { name: 'suite-financial-crossjoin', testMatch: 'tests/suite-financial-crossjoin.spec.ts', use: { ...devices['Desktop Chrome'] }, timeout: 60_000 },
    { name: 'suite-financial-trace',     testMatch: 'tests/suite-financial-trace.spec.ts',     use: { ...devices['Desktop Chrome'] }, timeout: 60_000 },
    { name: 'suite-date-nonsk',          testMatch: 'tests/suite-date-nonsk.spec.ts',          use: { ...devices['Desktop Chrome'] }, timeout: 45_000 },
    { name: 'suite-crossjoin-advanced',  testMatch: 'tests/suite-crossjoin-advanced.spec.ts',  use: { ...devices['Desktop Chrome'] }, timeout: 60_000 },
  ],

  // Auto-start the Vite dev server
  webServer: {
    command: 'npm run dev',
    port: 1421,
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
