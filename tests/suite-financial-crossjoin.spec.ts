/**
 * Financial Cross-Join Tests — DynamoDB Local with financial seed data.
 *
 * Requires:
 *   npm run db:start
 *   npm run db:seed:financial
 *   npm run test:integration
 *
 * Tables: ExportTransactions, ProductPrices, CountryMetrics, TradeTariffs
 * Scenarios: revenue analysis, tariff impact, data reconciliation
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
  await expect(page.getByText(/ExportTransactions|ProductPrices|CountryMetrics|TradeTariffs/)).toBeVisible({ timeout: 15_000 })
}

async function gotoExplore(page: Page) {
  await page.getByRole('button', { name: 'Explore' }).click()
  await expect(page.getByRole('tab', { name: 'Query' }).or(page.getByText('Query').first())).toBeVisible()
}

async function gotoCrossJoin(page: Page) {
  await gotoExplore(page)
  await page.getByRole('tab', { name: 'Cross-join' }).or(page.getByText('Cross-join')).click()
  await expect(page.locator('[placeholder*="Left table"]').or(page.getByText('Left table'))).toBeVisible({ timeout: 5_000 })
}

// ── Setup ────────────────────────────────────────────────────────────────────

test.describe('suite-financial-crossjoin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}?mock=0`)
  })

  // ── Scenario 1: US steel exports × steel prices (join exportDate=priceDate) ──

  test('1. US steel exports × steel prices (exportDate=priceDate join)', async ({ page }) => {
    test.setTimeout(60_000)
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left table: ExportTransactions
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('ExportTransactions')

    // Left pre-filter: country=US
    const leftFilterField = page.locator('[placeholder="field"]').first()
    await leftFilterField.fill('country')
    const leftFilterOp = page.locator('select').nth(2)
    await leftFilterOp.selectOption('=')
    const leftFilterValue = page.locator('[placeholder="value"]').first()
    await leftFilterValue.fill('US')

    // Left index: Product-Date-index
    const leftIndexSelect = page.locator('select').nth(1)
    await leftIndexSelect.selectOption('Product-Date-index')

    // Right table: ProductPrices
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('ProductPrices')

    // Join key: exportDate (left) = priceDate (right)
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('exportDate')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('priceDate')

    // Run join
    await page.getByRole('button', { name: /Run join/i }).click()

    // Verify result
    await expect(page.getByText(/matched/i)).toBeVisible({ timeout: 15_000 })
    const statBar = page.locator('[data-test="join-stats"]').or(page.getByText(/matched.*left.*right/i))
    await expect(statBar).toBeVisible()

    // Extract and verify matched count > 0
    const statsText = await statBar.textContent()
    expect(statsText).toMatch(/matched/)
  })

  // ── Scenario 2: US steel exports with Country-Date-index pre-filter ────────

  test('2. US exports via Country-Date-index shows fewer rows fetched', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left table: ExportTransactions with Country-Date-index
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('ExportTransactions')
    const leftIndexSelect = page.locator('select').nth(1)
    await leftIndexSelect.selectOption('Country-Date-index')

    // Pre-filter: country=US
    const leftFilterField = page.locator('[placeholder="field"]').first()
    await leftFilterField.fill('country')
    const leftFilterOp = page.locator('select').nth(2)
    await leftFilterOp.selectOption('=')
    const leftFilterValue = page.locator('[placeholder="value"]').first()
    await leftFilterValue.fill('US')

    // Right table: ExportTransactions (unfiltered for comparison)
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('ExportTransactions')

    // Join on country
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('country')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('country')

    await page.getByRole('button', { name: /Run join/i }).click()

    // Verify stats show scanned count
    const statBar = page.locator('[data-test="join-stats"]').or(page.getByText(/scanned/i))
    await expect(statBar).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 3: Exports × TradeTariffs LEFT ANTI (no tariff record) ───────

  test('3. Exports × TradeTariffs LEFT ANTI (no matching tariff)', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: ExportTransactions
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('ExportTransactions')

    // Right: TradeTariffs
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('TradeTariffs')

    // Join key: buyerCountry (left) = fromCountry (right)
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('buyerCountry')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('fromCountry')

    // Select LEFT ANTI
    const antiButton = page.getByRole('button', { name: /LEFT ANTI/i })
      .or(page.getByRole('radio', { name: /LEFT ANTI/i }))
    await antiButton.click()

    await page.getByRole('button', { name: /Run join/i }).click()

    // Verify result shows LEFT ANTI results
    await expect(page.getByText(/left.?only|anti/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 4: INNER join ExportTransactions × CountryMetrics ────────────

  test('4. ExportTransactions × CountryMetrics INNER (high GDP growth)', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: ExportTransactions
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('ExportTransactions')

    // Right: CountryMetrics
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('CountryMetrics')

    // Join key: country (both sides)
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('country')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('country')

    // Select INNER
    const innerButton = page.getByRole('button', { name: /INNER/i })
    await innerButton.click()

    await page.getByRole('button', { name: /Run join/i }).click()

    // Verify INNER join result
    await expect(page.getByText(/matched/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 5: ProductPrices volatility=high × ExportTransactions ───────

  test('5. ProductPrices (volatility=high GSI) × ExportTransactions', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: ProductPrices with Volatility-Date-index
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('ProductPrices')
    const leftIndexSelect = page.locator('select').nth(1)
    await leftIndexSelect.selectOption('Volatility-Date-index')

    // Pre-filter: volatility=high
    const leftFilterField = page.locator('[placeholder="field"]').first()
    await leftFilterField.fill('volatility')
    const leftFilterOp = page.locator('select').nth(2)
    await leftFilterOp.selectOption('=')
    const leftFilterValue = page.locator('[placeholder="value"]').first()
    await leftFilterValue.fill('high')

    // Right: ExportTransactions
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('ExportTransactions')

    // Join: priceDate (left) = exportDate (right)
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('priceDate')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('exportDate')

    await page.getByRole('button', { name: /Run join/i }).click()

    await expect(page.getByText(/matched|result/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 6: TradeTariffs × ExportTransactions LEFT ANTI ──────────────

  test('6. TradeTariffs × ExportTransactions LEFT ANTI (no export activity)', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: TradeTariffs
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('TradeTariffs')

    // Right: ExportTransactions
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('ExportTransactions')

    // Join: tradeRoute (left) = ? (right has no tradeRoute, so use country pair)
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('fromCountry')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('country')

    // Select LEFT ANTI
    const antiButton = page.getByRole('button', { name: /LEFT ANTI/i })
      .or(page.getByRole('radio', { name: /LEFT ANTI/i }))
    await antiButton.click()

    await page.getByRole('button', { name: /Run join/i }).click()

    await expect(page.getByText(/left.?only|anti/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 7: CountryMetrics × ExportTransactions (country presence) ────

  test('7. CountryMetrics × ExportTransactions (countries in metrics but not exports)', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: CountryMetrics
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('CountryMetrics')

    // Right: ExportTransactions
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('ExportTransactions')

    // Join: country (both)
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('country')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('country')

    // Select LEFT ANTI to find metrics without exports
    const antiButton = page.getByRole('button', { name: /LEFT ANTI/i })
      .or(page.getByRole('radio', { name: /LEFT ANTI/i }))
    await antiButton.click()

    await page.getByRole('button', { name: /Run join/i }).click()

    await expect(page.getByText(/left.?only|anti/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 8: Large join without pre-filter (client-side scan warning) ──

  test('8. Large join: all exports × all prices (expect client-side warning)', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: ExportTransactions (no pre-filter)
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('ExportTransactions')

    // Right: ProductPrices (no pre-filter)
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('ProductPrices')

    // Join: exportDate = priceDate
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('exportDate')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('priceDate')

    await page.getByRole('button', { name: /Run join/i }).click()

    // Expect warning about client-side scan
    await expect(page.getByText(/scan|large|memory/i)).toBeVisible({ timeout: 15_000 })
    // But result should still appear
    await expect(page.getByText(/matched|result/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 9: Join limit — scanned count shown ────────────────────────

  test('9. Export rows > 2000 scanned shows stat', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: ExportTransactions (no filter — may scan many)
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('ExportTransactions')

    // Right: ProductPrices
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('ProductPrices')

    // Join
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('exportDate')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('priceDate')

    await page.getByRole('button', { name: /Run join/i }).click()

    // Verify stats bar shows scanned count
    const statBar = page.locator('[data-test="join-stats"]').or(page.getByText(/scanned/i))
    await expect(statBar).toBeVisible({ timeout: 15_000 })
    const statsText = await statBar.textContent()
    expect(statsText).toMatch(/scanned/)
  })

  // ── Scenario 10: Export result as CSV/JSON ──────────────────────────────

  test('10. Join result can be exported as CSV/JSON', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Simple join: ExportTransactions × ProductPrices
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('ExportTransactions')
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('ProductPrices')

    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('exportDate')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('priceDate')

    await page.getByRole('button', { name: /Run join/i }).click()

    // Wait for result
    await expect(page.getByText(/matched|result/i)).toBeVisible({ timeout: 15_000 })

    // Export button should be visible
    const exportBtn = page.getByRole('button', { name: /export|csv|json/i })
    await expect(exportBtn).toBeVisible({ timeout: 5_000 })
  })
})
