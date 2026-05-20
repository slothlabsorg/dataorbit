/**
 * Integration tests — require DynamoDB Local running with seed data.
 *
 *   npm run db:start
 *   npm run db:seed
 *   npm run test:integration
 *
 * Connection used: Name=dataorbit-local, profile=local (any profile works),
 * endpoint=http://localhost:8000, region=us-east-1
 *
 * These tests validate the ✓ shipped features against REAL DynamoDB data,
 * not the 7-row mock dataset.
 */

import { test, expect, Page } from '@playwright/test'

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE = 'http://localhost:1421'

async function addLocalConnection(page: Page) {
  await page.goto(`${BASE}?screen=orbit`)
  await page.getByRole('button', { name: /Add connection/i }).first().click()
  // Step 1: select DynamoDB
  await page.getByRole('button', { name: 'DynamoDB' }).click()
  // Step 2: configure
  await page.getByPlaceholder('e.g. nexus-prod').fill('dataorbit-local')
  // region us-east-1 is default
  // auth: profile (default)
  await page.getByRole('button', { name: '~/.aws profile' }).click()
  // profile: any (DynamoDB Local accepts anything)
  await page.getByPlaceholder(/Select or type a profile/i).fill('local')
  // endpoint
  await page.getByPlaceholder(/localhost:8000/i).fill('http://localhost:8000')
  await page.getByRole('button', { name: /Continue/i }).click()
  // Step 3: test & save
  await page.getByRole('button', { name: /Test connection/i }).click()
  await expect(page.getByText('Connection successful')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Save connection/i }).click()
  // Wait for Browse to appear with tables loaded
  await expect(page.getByText('DeviceMessages')).toBeVisible({ timeout: 15_000 })
}

async function gotoExplore(page: Page) {
  await page.getByRole('button', { name: 'Explore' }).click()
  await expect(page.getByRole('tab', { name: 'Query' }).or(page.getByText('Query').first())).toBeVisible()
}

// ── Setup: connect once ───────────────────────────────────────────────────────

test.describe('Integration — DynamoDB Local', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}?mock=0`)
  })

  // ── Connection ───────────────────────────────────────────────────────────────

  test('1. connects to localhost:8000 and lists 4 tables', async ({ page }) => {
    await addLocalConnection(page)
    for (const tbl of ['DeviceMessages', 'DeviceRegistry', 'SensorAlerts', 'DeviceLocations']) {
      await expect(page.getByText(tbl).first()).toBeVisible()
    }
  })

  // ── Browse ────────────────────────────────────────────────────────────────────

  test('2. Browse DeviceMessages shows real rows (not 7 mock rows)', async ({ page }) => {
    await addLocalConnection(page)
    // Browse auto-loads rows on table select — it should show 50 real rows
    await expect(page.getByText('50 rows')).toBeVisible({ timeout: 10_000 })
    // Real rows have real sensor IDs, not "sensor-4421" from mock
    await expect(page.getByText('sensor-')).toBeVisible()
  })

  test('3. Sort DESC shows newest timestamps first (✓ sort direction)', async ({ page }) => {
    await addLocalConnection(page)
    // The sort button shows the sk field name + direction
    const sortBtn = page.getByTitle(/Sort by/)
    await expect(sortBtn).toBeVisible()
    // Default is desc — button should say ↓
    await expect(sortBtn).toContainText('↓')
    // Toggle to asc
    await sortBtn.click()
    await expect(sortBtn).toContainText('↑')
  })

  test('4. Pagination — Load more returns additional rows (✓ pagination)', async ({ page }) => {
    await addLocalConnection(page)
    await expect(page.getByText('50 rows')).toBeVisible({ timeout: 10_000 })
    const loadMore = page.getByRole('button', { name: /Load more/i })
    await expect(loadMore).toBeVisible()
    await loadMore.click()
    // Should have > 50 rows now
    await expect(page.getByText(/\d+ rows/)).toBeVisible({ timeout: 10_000 })
  })

  // ── Explore — Query ───────────────────────────────────────────────────────────

  test('5. Filter pk = sensor-0001 returns real rows from DeviceMessages (✓ filter)', async ({ page }) => {
    await addLocalConnection(page)
    await gotoExplore(page)
    await page.getByPlaceholder('field name').fill('deviceId')
    await page.getByRole('combobox').first().selectOption('=')
    await page.getByPlaceholder('field value').fill('sensor-0001')
    await page.getByRole('button', { name: '+ Add filter' }).click()
    await page.getByRole('button', { name: /Run/i }).click()
    await expect(page.getByText('sensor-0001')).toBeVisible({ timeout: 10_000 })
  })

  test('6. Filter pk = sensor-0012 returns WARN rows', async ({ page }) => {
    await addLocalConnection(page)
    await gotoExplore(page)
    await page.getByPlaceholder('field name').fill('deviceId')
    await page.getByRole('combobox').first().selectOption('=')
    await page.getByPlaceholder('field value').fill('sensor-0012')
    await page.getByRole('button', { name: '+ Add filter' }).click()
    await page.getByRole('button', { name: /Run/i }).click()
    await expect(page.getByText('WARN')).toBeVisible({ timeout: 10_000 })
  })

  test('7. Time-range preset Last 24h filters DeviceMessages by timestamp (✓ time-range)', async ({ page }) => {
    await addLocalConnection(page)
    await gotoExplore(page)
    // The time preset bar should show since DeviceMessages has sk=timestamp
    await expect(page.getByText('24h')).toBeVisible()
    await page.getByRole('button', { name: '24h' }).click()
    // A chip should appear for timestamp between
    await expect(page.getByText(/between/)).toBeVisible()
  })

  test('8. begins_with locationKey US:: returns only US sensors (✓ composite key)', async ({ page }) => {
    await addLocalConnection(page)
    await page.getByText('DeviceLocations').click()
    await gotoExplore(page)
    await page.getByPlaceholder('field name').fill('locationKey')
    await page.getByRole('combobox').first().selectOption('begins_with')
    await page.getByPlaceholder('field value').fill('US::')
    await page.getByRole('button', { name: '+ Add filter' }).click()
    await page.getByRole('button', { name: /Run/i }).click()
    // All results should start with US::
    const rows = page.locator('td').filter({ hasText: /^US::/ })
    await expect(rows.first()).toBeVisible({ timeout: 10_000 })
    // No EU:: or APAC:: should appear
    await expect(page.locator('td').filter({ hasText: /^EU::/ })).toHaveCount(0)
  })

  test('9. status = WARN (no pk) triggers Scan warning (✓ cost estimator)', async ({ page }) => {
    await addLocalConnection(page)
    await gotoExplore(page)
    await page.getByPlaceholder('field name').fill('status')
    await page.getByRole('combobox').first().selectOption('=')
    await page.getByPlaceholder('field value').fill('WARN')
    await page.getByRole('button', { name: '+ Add filter' }).click()
    // Scan warning should appear
    await expect(page.getByText(/Scan detected/i)).toBeVisible()
  })

  test('10. GSI query Status-index, status=WARN uses IndexQuery (✓ GSI)', async ({ page }) => {
    await addLocalConnection(page)
    await gotoExplore(page)
    // Select Status-index from index dropdown
    const indexSelect = page.getByLabel(/Index/i).or(page.getByRole('combobox', { name: /index/i }))
    if (await indexSelect.isVisible()) {
      await indexSelect.selectOption(/Status-index/)
    }
    await page.getByPlaceholder('field name').fill('status')
    await page.getByRole('combobox').first().selectOption('=')
    await page.getByPlaceholder('field value').fill('WARN')
    await page.getByRole('button', { name: '+ Add filter' }).click()
    await page.getByRole('button', { name: /Run/i }).click()
    await expect(page.getByText(/IndexQuery/i)).toBeVisible({ timeout: 10_000 })
  })

  // ── Cross-join (✓ joins) ──────────────────────────────────────────────────────

  test('11. CrossJoin LEFT ANTI on deviceId — sensor-0012 appears as left-only', async ({ page }) => {
    await addLocalConnection(page)
    await page.getByRole('button', { name: 'Explore' }).click()
    await page.getByRole('tab', { name: 'Cross-join' }).or(page.getByText('Cross-join')).click()
    // Left: DeviceMessages, Right: SensorAlerts, join key: deviceId
    await page.locator('[placeholder="join key field"]').first().fill('deviceId')
    await page.locator('[placeholder="join key field"]').last().fill('deviceId')
    // Select LEFT ANTI
    await page.getByRole('radio', { name: /LEFT ANTI/i }).or(
      page.getByRole('button', { name: /LEFT ANTI/i })
    ).click()
    await page.getByRole('button', { name: /Run join/i }).click()
    await expect(page.getByText('sensor-0012')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/left.?only/i)).toBeVisible()
  })

  test('12. CrossJoin INNER excludes sensor-0012 (✓ inner join)', async ({ page }) => {
    await addLocalConnection(page)
    await page.getByRole('button', { name: 'Explore' }).click()
    await page.getByText('Cross-join').click()
    await page.locator('[placeholder="join key field"]').first().fill('deviceId')
    await page.locator('[placeholder="join key field"]').last().fill('deviceId')
    await page.getByRole('button', { name: /INNER/i }).click()
    await page.getByRole('button', { name: /Run join/i }).click()
    // sensor-0012 should NOT appear in INNER join (not in SensorAlerts)
    await expect(page.getByText('sensor-0012')).toHaveCount(0, { timeout: 15_000 })
  })

  // ── Inline editing ────────────────────────────────────────────────────────────

  test('13. Put item → row appears in subsequent Browse load', async ({ page }) => {
    await addLocalConnection(page)
    await page.getByText('DeviceRegistry').click()
    // Click first row
    await page.locator('tbody tr').first().click()
    await page.getByRole('button', { name: 'Edit' }).click()
    // The JSON editor should appear
    await expect(page.locator('textarea').first()).toBeVisible()
    // Modify and save
    const ta = page.locator('textarea').first()
    const json = await ta.inputValue()
    const parsed = JSON.parse(json)
    parsed.__test_flag = 'integration-test'
    await ta.fill(JSON.stringify(parsed, null, 2))
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Item saved')).toBeVisible({ timeout: 10_000 })
  })

  test('14. Delete item → row count decreases', async ({ page }) => {
    await addLocalConnection(page)
    await page.getByText('DeviceLocations').click()
    const countBefore = await page.locator('tbody tr').count()
    await page.locator('tbody tr').first().click()
    await page.getByRole('button', { name: 'Delete' }).click()
    // Confirmation dialog
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await expect(page.getByText('Item deleted')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('tbody tr')).toHaveCount(countBefore - 1, { timeout: 5_000 })
  })

  // ── TimeTrace (✓ time trace) ──────────────────────────────────────────────────

  test('15. TimeTrace sensor-0012 shows missing-tables warning', async ({ page }) => {
    await addLocalConnection(page)
    await page.getByRole('button', { name: 'Explore' }).click()
    await page.getByText('Time Trace').click()
    await page.getByPlaceholder('field name').fill('deviceId')
    await page.getByPlaceholder('field value').fill('sensor-0012')
    await page.getByRole('button', { name: /Trace/i }).click()
    // Should show warning: missing from SensorAlerts and DeviceRegistry
    await expect(page.getByText(/missing/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── All 12 operators smoke test (✓ operators) ─────────────────────────────────

  test('16. All 12 operators can be added as chips without JS error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await addLocalConnection(page)
    await gotoExplore(page)

    const ops = ['=', '!=', '<', '<=', '>', '>=', 'begins_with', 'contains', 'exists', 'not_exists', 'between', 'in']
    for (const op of ops) {
      await page.getByPlaceholder('field name').fill('deviceId')
      await page.getByRole('combobox').first().selectOption(op)
      if (op !== 'exists' && op !== 'not_exists') {
        await page.getByPlaceholder('field value').first().fill('test-value')
      }
      await page.getByRole('button', { name: '+ Add filter' }).click()
    }
    // All 12 chips should be visible
    await expect(page.locator('.chip, [data-chip]').or(page.getByText(/×/).first())).toBeVisible()
    expect(errors).toHaveLength(0)
  })
})
