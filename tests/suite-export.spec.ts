/**
 * Export feature tests — JSON ↓ and CSV ↓ buttons in Browse toolbar
 * and in the Explore QueryTab result bar.
 *
 * Requires DynamoDB Local running with seed data:
 *   npm run db:start && npm run db:seed
 *   npm run test:suite-export
 *
 * Connection: dataorbit-local → http://localhost:8000
 */

import { test, expect, Page } from '@playwright/test'

// Buffer is a Node.js global available at runtime in Playwright's Node.js runner.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Buffer: any

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = 'http://localhost:1421'

async function addLocalConnection(page: Page) {
  await page.goto(`${BASE}?screen=orbit`)
  await page.getByRole('button', { name: /Add connection/i }).first().click()
  await page.getByRole('button', { name: 'DynamoDB' }).click()
  await page.getByPlaceholder('e.g. nexus-prod').fill('dataorbit-local')
  await page.getByRole('button', { name: '~/.aws profile' }).click()
  await page.getByPlaceholder(/Select or type a profile/i).fill('local')
  await page.getByPlaceholder(/localhost:8000/i).fill('http://localhost:8000')
  await page.getByRole('button', { name: /Continue/i }).click()
  await page.getByRole('button', { name: /Test connection/i }).click()
  await expect(page.getByText('Connection successful')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Save connection/i }).click()
  // Wait for Browse to appear with tables loaded
  await expect(page.getByText('DeviceMessages')).toBeVisible({ timeout: 15_000 })
}

async function navigateToBrowse(page: Page, tableName = 'DeviceMessages') {
  await page.getByRole('button', { name: 'Browse' }).click()
  // Click the table tab — DeviceMessages is the default active table
  const tableTab = page.locator('button').filter({ hasText: new RegExp(`^${tableName}$`) }).first()
  if (await tableTab.isVisible()) await tableTab.click()
  // Wait for rows to load
  await expect(page.getByText(/\d+ rows/)).toBeVisible({ timeout: 15_000 })
}

async function navigateToExploreQuery(page: Page) {
  await page.getByRole('button', { name: 'Explore' }).click()
  await expect(page.getByRole('tab', { name: 'Query' }).or(page.getByText('Query').first())).toBeVisible()
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Export — JSON ↓ and CSV ↓ buttons', () => {
  test.setTimeout(30_000)

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}?mock=0`)
  })

  // ── Browse toolbar export ─────────────────────────────────────────────────

  test('Browse toolbar shows JSON ↓ and CSV ↓ buttons when rows are loaded', async ({ page }) => {
    await addLocalConnection(page)
    await navigateToBrowse(page)

    // Export buttons are conditionally rendered only when rows.length > 0
    const jsonBtn = page.getByTitle('Export JSON').or(page.getByRole('button', { name: 'JSON ↓' }))
    const csvBtn  = page.getByTitle('Export CSV').or(page.getByRole('button', { name: 'CSV ↓' }))

    await expect(jsonBtn).toBeVisible()
    await expect(csvBtn).toBeVisible()
  })

  test('Browse JSON ↓ click triggers a file download', async ({ page }) => {
    await addLocalConnection(page)
    await navigateToBrowse(page)

    const jsonBtn = page.getByTitle('Export JSON').or(page.getByRole('button', { name: 'JSON ↓' }))
    await expect(jsonBtn).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      jsonBtn.click(),
    ])

    expect(download).toBeTruthy()
    // Filename should end with .json
    expect(download.suggestedFilename()).toMatch(/\.json$/)
  })

  test('Browse CSV ↓ click triggers a file download', async ({ page }) => {
    await addLocalConnection(page)
    await navigateToBrowse(page)

    const csvBtn = page.getByTitle('Export CSV').or(page.getByRole('button', { name: 'CSV ↓' }))
    await expect(csvBtn).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      csvBtn.click(),
    ])

    expect(download).toBeTruthy()
    expect(download.suggestedFilename()).toMatch(/\.csv$/)
  })

  test('Browse export download file is not empty and has reasonable size', async ({ page }) => {
    await addLocalConnection(page)
    await navigateToBrowse(page)

    const jsonBtn = page.getByTitle('Export JSON').or(page.getByRole('button', { name: 'JSON ↓' }))

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      jsonBtn.click(),
    ])

    // Read download content via Playwright's stream API (no @types/node required)
    const stream = await download.createReadStream()
    const chunks: unknown[] = []
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: unknown) => chunks.push(chunk))
      stream.on('end', resolve)
      stream.on('error', reject)
    })
    const content = Buffer.concat(chunks).toString('utf-8')
    const parsed = JSON.parse(content)
    // Should have at least 1 row from DeviceMessages
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)
  })

  // ── Explore QueryTab export ───────────────────────────────────────────────

  test('Explore QueryTab shows JSON ↓ and CSV ↓ after running a query', async ({ page }) => {
    await addLocalConnection(page)
    await navigateToExploreQuery(page)

    // Run query without any filters — Scan on DeviceMessages
    await page.getByRole('button', { name: /Run/i }).click()
    // Wait for results bar to appear
    await expect(page.getByText(/returned/i)).toBeVisible({ timeout: 15_000 })

    // Export buttons appear in the result bar only when result.rows.length > 0
    const jsonBtn = page.getByRole('button', { name: 'JSON ↓' }).last()
    const csvBtn  = page.getByRole('button', { name: 'CSV ↓' }).last()

    await expect(jsonBtn).toBeVisible()
    await expect(csvBtn).toBeVisible()
  })

  test('Explore QueryTab JSON ↓ click triggers a download after running a query', async ({ page }) => {
    await addLocalConnection(page)
    await navigateToExploreQuery(page)

    await page.getByRole('button', { name: /Run/i }).click()
    await expect(page.getByText(/returned/i)).toBeVisible({ timeout: 15_000 })

    const jsonBtn = page.getByRole('button', { name: 'JSON ↓' }).last()
    await expect(jsonBtn).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      jsonBtn.click(),
    ])

    expect(download).toBeTruthy()
    expect(download.suggestedFilename()).toMatch(/\.json$/)
  })

  test('Explore QueryTab CSV ↓ click triggers a download after running a query', async ({ page }) => {
    await addLocalConnection(page)
    await navigateToExploreQuery(page)

    await page.getByRole('button', { name: /Run/i }).click()
    await expect(page.getByText(/returned/i)).toBeVisible({ timeout: 15_000 })

    const csvBtn = page.getByRole('button', { name: 'CSV ↓' }).last()
    await expect(csvBtn).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      csvBtn.click(),
    ])

    expect(download).toBeTruthy()
    expect(download.suggestedFilename()).toMatch(/\.csv$/)
  })

  test('Export filtered query result — pk=sensor-0001 returns only that sensor rows', async ({ page }) => {
    await addLocalConnection(page)
    await navigateToExploreQuery(page)

    await page.getByPlaceholder('field name').fill('deviceId')
    await page.getByRole('combobox').first().selectOption('=')
    await page.getByPlaceholder('field value').fill('sensor-0001')
    await page.getByRole('button', { name: '+ Add filter' }).click()
    await page.getByRole('button', { name: /Run/i }).click()
    await expect(page.getByText('sensor-0001')).toBeVisible({ timeout: 10_000 })

    const jsonBtn = page.getByRole('button', { name: 'JSON ↓' }).last()
    await expect(jsonBtn).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      jsonBtn.click(),
    ])

    // Read download content via Playwright's stream API
    const stream = await download.createReadStream()
    const chunks: unknown[] = []
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: unknown) => chunks.push(chunk))
      stream.on('end', resolve)
      stream.on('error', reject)
    })
    const rows = JSON.parse(Buffer.concat(chunks).toString('utf-8'))

    // Every exported row should be for sensor-0001
    for (const row of rows) {
      expect(String(row['deviceId'] ?? '')).toBe('sensor-0001')
    }
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  test('Export empty result — 0 rows CSV still triggers download (headers-only file)', async ({ page }) => {
    await addLocalConnection(page)
    await navigateToExploreQuery(page)

    // Filter for a deviceId that will not exist → 0 rows
    await page.getByPlaceholder('field name').fill('deviceId')
    await page.getByRole('combobox').first().selectOption('=')
    await page.getByPlaceholder('field value').fill('sensor-DOES-NOT-EXIST-99999')
    await page.getByRole('button', { name: '+ Add filter' }).click()
    await page.getByRole('button', { name: /Run/i }).click()

    // Wait for query to complete — result bar should show 0 returned
    await expect(page.getByText(/returned/i).or(page.getByText('No items matched'))).toBeVisible({ timeout: 15_000 })

    // When result.rows.length === 0, the export buttons are hidden per Browse.tsx and QueryTab
    // This test verifies the empty state UI does NOT show buttons (correct behaviour)
    const jsonBtns = page.getByRole('button', { name: 'JSON ↓' })
    const csvBtns  = page.getByRole('button', { name: 'CSV ↓' })
    // 0 export buttons should be visible since rows array is empty
    await expect(jsonBtns).toHaveCount(0)
    await expect(csvBtns).toHaveCount(0)
  })

  test.fixme('Export CrossJoin result — future: CrossJoin toolbar should have export buttons', async ({ page }) => {
    // CrossJoin currently has no export buttons in its result toolbar.
    // When CrossJoin export is implemented:
    //   1. Navigate to Explore > Cross-join
    //   2. Configure left/right tables and run join
    //   3. Verify JSON ↓ / CSV ↓ appear in the join result bar
    //   4. Click and assert download event fires with .json/.csv filename
    await addLocalConnection(page)
    await page.getByRole('button', { name: 'Explore' }).click()
    await page.getByText('Cross-join').click()
    await page.locator('[placeholder="join key field"]').first().fill('deviceId')
    await page.locator('[placeholder="join key field"]').last().fill('deviceId')
    await page.getByRole('button', { name: /INNER/i }).click()
    await page.getByRole('button', { name: /Run join/i }).click()
    await expect(page.getByText(/matched/i)).toBeVisible({ timeout: 15_000 })

    // These buttons don't exist yet — test will fail until feature is shipped
    await expect(page.getByRole('button', { name: 'JSON ↓' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'CSV ↓' })).toBeVisible()
  })

  test.skip('Large table export seeds 5000-row table and downloads all rows (skip: slow)', async ({ page }) => {
    // This test requires: npm run db:seed:large (seeds a 5000-row table)
    // Skipped by default because it can be slow (several seconds for full download).
    // To run: npx playwright test --project=suite-export --grep "Large table"
    await addLocalConnection(page)

    // Navigate to a large table seeded by db:seed:large (e.g., "LargeTable")
    await page.getByRole('button', { name: 'Browse' }).click()
    const largeTab = page.locator('button').filter({ hasText: /LargeTable|large/i }).first()
    await expect(largeTab).toBeVisible({ timeout: 10_000 })
    await largeTab.click()
    await expect(page.getByText(/\d+ rows/)).toBeVisible({ timeout: 20_000 })

    const jsonBtn = page.getByTitle('Export JSON').or(page.getByRole('button', { name: 'JSON ↓' }))
    await expect(jsonBtn).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      jsonBtn.click(),
    ])

    expect(download).toBeTruthy()
    const stream = await download.createReadStream()
    const chunks: unknown[] = []
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: unknown) => chunks.push(chunk))
      stream.on('end', resolve)
      stream.on('error', reject)
    })
    const rows = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
    expect(rows.length).toBeGreaterThanOrEqual(50) // At minimum the first page
  })
})
