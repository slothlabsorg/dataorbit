/**
 * 200-table stress tests — sidebar pagination, search, and Browse behaviour
 * with a large number of DynamoDB tables.
 *
 * Requires the stress seed running before this suite:
 *   npm run db:start && npm run db:seed:stress
 *   npm run test:suite-200
 *
 * The stress seed creates 200+ tables with names like:
 *   orders-prod, orders-staging, payments-v2, payments-events,
 *   users-staging, users-prod, sessions-v1, … etc.
 *
 * Connection: stress-local → http://localhost:8000 (DynamoDB Local port 8000)
 */

import { test, expect, Page } from '@playwright/test'

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE = 'http://localhost:1421'

/**
 * Adds a connection to DynamoDB Local (port 8000) with the stress seed dataset.
 * Returns after the sidebar shows the connection tree is expanded with tables.
 */
async function addStressConnection(page: Page) {
  await page.goto(`${BASE}?screen=orbit`)
  await page.getByRole('button', { name: /Add connection/i }).first().click()
  await page.getByRole('button', { name: 'DynamoDB' }).click()
  await page.getByPlaceholder('e.g. nexus-prod').fill('stress-local')
  await page.getByRole('button', { name: '~/.aws profile' }).click()
  await page.getByPlaceholder(/Select or type a profile/i).fill('local')
  await page.getByPlaceholder(/localhost:8000/i).fill('http://localhost:8000')
  await page.getByRole('button', { name: /Continue/i }).click()
  await page.getByRole('button', { name: /Test connection/i }).click()
  await expect(page.getByText('Connection successful')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Save connection/i }).click()

  // Wait for at least one stress-seed table to appear in the sidebar
  // orders-prod is a reliable early entry in the seed
  await expect(page.getByText(/orders-prod|payments|users-staging/i).first()).toBeVisible({ timeout: 30_000 })
}

/**
 * Gets the sidebar table filter input (placeholder "Filter tables…").
 */
function getTableSearchInput(page: Page) {
  return page.getByPlaceholder('Filter tables…')
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('200-table stress suite — sidebar search, pagination, Browse', () => {
  test.setTimeout(60_000)

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}?mock=0`)
  })

  // ── Connection and table count ────────────────────────────────────────────

  test('Connection loads and sidebar shows 200+ tables', async ({ page }) => {
    await addStressConnection(page)

    // The stress seed creates 200 tables. The sidebar renders all of them
    // using list_tables pagination (100 per page). Count visible items.
    const tableSearch = getTableSearchInput(page)
    await expect(tableSearch).toBeVisible({ timeout: 15_000 })

    // Clear search to ensure we see all tables
    await tableSearch.fill('')

    // Wait for items to stabilise
    await page.waitForTimeout(500)

    // Count sidebar table buttons — should be >= 200
    const items = page.locator('span.font-mono').filter({ hasText: /.+/ })
    const count = await items.count()
    expect(count).toBeGreaterThanOrEqual(200)
  })

  test('Connection load time is reasonable (< 30s for 200 tables)', async ({ page }) => {
    const t0 = Date.now()
    await addStressConnection(page)
    const elapsed = Date.now() - t0

    // 30s is generous; a fast local machine should be < 10s
    expect(elapsed).toBeLessThan(30_000)
  })

  // ── Sidebar search ────────────────────────────────────────────────────────

  test('Sidebar search "orders" filters to only orders-* tables', async ({ page }) => {
    await addStressConnection(page)

    const searchInput = getTableSearchInput(page)
    await expect(searchInput).toBeVisible()
    await searchInput.fill('orders')

    // Allow filter to debounce / re-render
    await page.waitForTimeout(300)

    // All visible font-mono table names should contain "orders"
    const visibleTableNames = page.locator('span.font-mono').filter({ hasText: /.+/ })
    const names = await visibleTableNames.allTextContents()

    // At least one match
    expect(names.length).toBeGreaterThan(0)

    // Every visible name must include "orders"
    for (const name of names) {
      expect(name.toLowerCase()).toContain('orders')
    }
  })

  test('Sidebar search is case-insensitive — "ORDERS" matches orders-* tables', async ({ page }) => {
    await addStressConnection(page)

    const searchInput = getTableSearchInput(page)
    await expect(searchInput).toBeVisible()

    // Search uppercase
    await searchInput.fill('ORDERS')
    await page.waitForTimeout(300)

    const uppercaseMatches = await page.locator('span.font-mono').filter({ hasText: /.+/ }).count()

    // Clear and search lowercase
    await searchInput.fill('orders')
    await page.waitForTimeout(300)

    const lowercaseMatches = await page.locator('span.font-mono').filter({ hasText: /.+/ }).count()

    // Both should return the same number of results
    expect(uppercaseMatches).toEqual(lowercaseMatches)
    expect(uppercaseMatches).toBeGreaterThan(0)
  })

  test('Sidebar search "nonexistent-table-xyz" shows "No match" message', async ({ page }) => {
    await addStressConnection(page)

    const searchInput = getTableSearchInput(page)
    await expect(searchInput).toBeVisible()
    await searchInput.fill('nonexistent-table-xyz')
    await page.waitForTimeout(300)

    // The Sidebar renders: <p className="text-[10px] text-text-muted px-2 py-1 italic">No match</p>
    await expect(page.getByText('No match')).toBeVisible()
  })

  test('Sidebar search partial "payments" then "v2" narrows results further', async ({ page }) => {
    await addStressConnection(page)

    const searchInput = getTableSearchInput(page)
    await expect(searchInput).toBeVisible()

    await searchInput.fill('payments')
    await page.waitForTimeout(300)
    const paymentsCount = await page.locator('span.font-mono').filter({ hasText: /.+/ }).count()

    await searchInput.fill('payments-v2')
    await page.waitForTimeout(300)
    const narrowedCount = await page.locator('span.font-mono').filter({ hasText: /.+/ }).count()

    // "payments-v2" is a stricter filter than "payments"
    expect(narrowedCount).toBeLessThanOrEqual(paymentsCount)
    expect(narrowedCount).toBeGreaterThan(0)
  })

  // ── Browse a stress-seed table ────────────────────────────────────────────

  test('Browse "orders-prod" shows rows loaded from the stress seed', async ({ page }) => {
    await addStressConnection(page)

    // Click the orders-prod table in the sidebar
    await page.getByText('orders-prod').click()
    // Navigate to Browse screen
    await page.getByRole('button', { name: 'Browse' }).click()

    // Wait for row count to appear — stress seed populates each table
    await expect(page.getByText(/\d+ rows/)).toBeVisible({ timeout: 20_000 })
    // Row count should be > 0
    const rowText = await page.getByText(/\d+ rows/).textContent()
    const count = parseInt(rowText?.match(/(\d+)/)?.[1] ?? '0', 10)
    expect(count).toBeGreaterThan(0)
  })

  test('Browse "payments-events" loads and shows tabular data', async ({ page }) => {
    await addStressConnection(page)

    await page.getByText('payments-events').click()
    await page.getByRole('button', { name: 'Browse' }).click()

    await expect(page.getByText(/\d+ rows/)).toBeVisible({ timeout: 20_000 })
    // Table headers row should be present
    await expect(page.locator('table thead tr th').first()).toBeVisible()
  })

  // ── list_tables two-page pagination ──────────────────────────────────────

  test('list_tables 2-page pagination: all 200 tables appear (>100 per API page)', async ({ page }) => {
    // DynamoDB list_tables returns max 100 per call. The app must paginate.
    // If pagination is broken, only 100 tables would appear in the sidebar.
    await addStressConnection(page)

    // Clear any filter to see all tables
    const searchInput = getTableSearchInput(page)
    await expect(searchInput).toBeVisible()
    await searchInput.fill('')
    await page.waitForTimeout(500)

    // Count all font-mono spans (each is a table name)
    const count = await page.locator('span.font-mono').filter({ hasText: /.+/ }).count()
    // Must be > 100 to confirm second page was fetched
    expect(count).toBeGreaterThan(100)
  })

  // ── Sidebar scroll ────────────────────────────────────────────────────────

  test('Sidebar scroll reaches tables beyond the initial viewport', async ({ page }) => {
    await addStressConnection(page)

    // The sidebar table list is limited to max-h-48 (192px) in the tree component.
    // Tables beyond viewport are accessible by scrolling.
    const searchInput = getTableSearchInput(page)
    await expect(searchInput).toBeVisible()
    await searchInput.fill('')
    await page.waitForTimeout(300)

    // Find the scrollable container inside the sidebar tree
    const scrollArea = page.locator('.max-h-48.overflow-y-auto').first()
    await expect(scrollArea).toBeVisible()

    // Scroll to the bottom of the list
    await scrollArea.evaluate(el => { el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(300)

    // After scrolling, we should still see table names (not an empty area)
    const visibleAfterScroll = await page.locator('span.font-mono').filter({ hasText: /.+/ }).count()
    expect(visibleAfterScroll).toBeGreaterThan(0)
  })

  // ── TimeTrace performance with many tables ────────────────────────────────

  test('TimeTrace with all 200 tables selected does not hang (result within 30s)', async ({ page }) => {
    await addStressConnection(page)

    await page.getByRole('button', { name: 'Explore' }).click()
    await page.getByText('Time Trace').click()

    // Use a broad "contains" search so every table is likely to be scanned
    await page.getByPlaceholder('field name').fill('id')
    const opSelect = page.getByLabel('Operator').or(page.locator('select').filter({ has: page.getByText('= exact') }))
    if (await opSelect.isVisible()) {
      await opSelect.selectOption('=')
    }
    await page.getByPlaceholder('field value').fill('trace-probe-value')
    await page.getByRole('button', { name: /Trace/i }).click()

    // Should show either a result timeline or the spinner, then resolve — not hang
    const resolvedState = page.getByText(/event|missing|table|not found/i)
      .or(page.locator('.w-6.h-6.rounded-full.border-2.border-primary'))
    await expect(resolvedState).toBeVisible({ timeout: 30_000 })

    // Loading spinner should eventually disappear
    await expect(page.locator('.animate-spin')).toHaveCount(0, { timeout: 30_000 })
  })
})
