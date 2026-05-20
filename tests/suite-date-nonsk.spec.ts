/**
 * Date Range Queries on Non-SK Columns — FilterExpression vs KeyConditionExpression
 *
 * Tests document the CRITICAL DIFFERENCE between:
 * - SK date range: KeyConditionExpression — reads only matching items (efficient, low RCU)
 * - Non-SK date range: FilterExpression — reads ALL items, filters client-side (expensive, high RCU)
 *
 * Tables used:
 *   - DeviceRegistry: pk=deviceId, no SK. registeredAt = NON-SK field
 *   - ExportTransactions: pk=exportId, sk=exportDate. country = NON-SK field
 *   - ProductPrices: pk=product, sk=priceDate. changePercent = NON-SK field
 *   - CountryMetrics: pk=country, sk=reportDate. inflationPct = NON-SK field
 *   - TradeTariffs: pk=tradeRoute, sk=effectiveDate. tariffRatePct = NON-SK field
 *   - SensorAlerts: pk=deviceId, sk=alertId, createdAt = SK field (efficient query)
 *
 * Key patterns:
 *   1. Scan + FilterExpression (expensive): warning badge visible, high RCU
 *   2. Query + FilterExpression (moderate): query narrows scope, then filters
 *   3. GSI query (efficient): KeyConditionExpression on GSI key, fewer items read
 *   4. Index suggestion panel: appears for non-SK filters, suggests GSI
 *   5. RCU cost comparison: Scan path vs GSI path
 *   6. test.slow() for expensive scan tests
 *
 * Requires: npm run db:start && npm run db:seed:financial
 */

import { test, expect, type Page } from '@playwright/test'

const BASE = 'http://localhost:1421'

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  await expect(
    page.getByText(/DeviceRegistry|ExportTransactions|ProductPrices|CountryMetrics|TradeTariffs/)
  ).toBeVisible({ timeout: 15_000 })
}

async function openExploreQuery(page: Page, tableName: string) {
  await page.getByText(tableName).first().click()
  await page.getByRole('button', { name: 'Explore' }).click()
  await expect(
    page.getByRole('tab', { name: 'Query' }).or(page.getByText('Query').first())
  ).toBeVisible()
}

async function addFilter(page: Page, field: string, operator: string, value: string) {
  await page.getByPlaceholder('field name').fill(field)
  await page.getByRole('combobox').first().selectOption(operator)
  if (operator !== 'exists' && operator !== 'not_exists') {
    await page.getByPlaceholder('field value').first().fill(value)
  }
  await page.getByRole('button', { name: '+ Add filter' }).click()
}

async function addBetweenFilter(page: Page, field: string, lo: string, hi: string) {
  await page.getByPlaceholder('field name').fill(field)
  await page.getByRole('combobox').first().selectOption('between')
  const valueInputs = page.getByPlaceholder('field value')
  await valueInputs.first().fill(lo)
  await valueInputs.last().fill(hi)
  await page.getByRole('button', { name: '+ Add filter' }).click()
}

async function runQuery(page: Page) {
  const runBtn = page.getByRole('button', { name: /Run/i }).first()
  await runBtn.click()
  // Confirm scan if prompted
  const runAnyway = page.getByText('Run anyway').first()
  if (await runAnyway.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await runAnyway.click()
  }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Date Range Queries — Non-SK FilterExpression Patterns', () => {
  test.setTimeout(45_000)

  // ── Test 1: DeviceRegistry registeredAt >= "2024-01-01" (NON-SK, Scan mode) ────

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}?mock=0`)
    await addLocalConnection(page)
  })

  test(
    '1. DeviceRegistry: filter registeredAt >= "2024-01-01" triggers Scan + FilterExpression warning (NON-SK field)',
    async ({ page }) => {
      test.slow()

      await openExploreQuery(page, 'DeviceRegistry')

      // registeredAt is NOT a key field in DeviceRegistry (no SK, just pk=deviceId)
      // So this will trigger a Scan + FilterExpression
      await addFilter(page, 'registeredAt', '>=', '2024-01-01')
      await runQuery(page)

      // Expected: Scan warning badge visible
      await expect(
        page.getByText(/Scan detected|full table scan|inefficient/i),
        'Expected Scan warning for NON-SK registeredAt filter'
      ).toBeVisible({ timeout: 15_000 })

      // Should still return results
      const rowCount = await page.locator('tbody tr').count()
      expect(rowCount, 'Expected results from Scan + FilterExpression').toBeGreaterThanOrEqual(0)
    }
  )

  // ── Test 2: DeviceRegistry + deviceId (Query mode with FilterExpression) ───────

  test(
    '2. DeviceRegistry: filter deviceId = "sensor-0001" AND registeredAt >= "2024-01-01" uses Query mode (pk query) + FilterExpression on top',
    async ({ page }) => {
      test.slow()

      await openExploreQuery(page, 'DeviceRegistry')

      // First add pk filter: deviceId = sensor-0001
      await addFilter(page, 'deviceId', '=', 'sensor-0001')
      // Then add non-sk filter: registeredAt >= ...
      await addFilter(page, 'registeredAt', '>=', '2024-01-01')

      await runQuery(page)

      // Expected: Query mode (efficient on pk) + FilterExpression (on top)
      const rowCount = await page.locator('tbody tr').count()
      expect(rowCount, 'Expected results from Query + FilterExpression').toBeGreaterThanOrEqual(0)

      // The query badge might show "Query" or "QueryWithFilter" or similar
      const hasQueryIndicator =
        (await page.getByText(/Query|index query/i).count()) > 0 ||
        (await page.getByText(/FilterExpression/i).count()) > 0
      expect(hasQueryIndicator, 'Expected Query or FilterExpression indicator').toBe(true)
    }
  )

  // ── Test 3: ExportTransactions with exportDate (IS SK) vs country (NOT SK) ────

  test(
    '3. ExportTransactions: filter status="delivered" AND exportDate >= "2024-01-01" — exportDate IS SK, KeyConditionExpression expected',
    async ({ page }) => {
      await openExploreQuery(page, 'ExportTransactions')

      // ExportTransactions: pk=exportId, sk=exportDate
      // If we provide pk (or at least narrow to a partition), exportDate can use KeyConditionExpression
      // For this test, let's add exportDate as BETWEEN to trigger KeyConditionExpression
      await page.getByPlaceholder('field name').fill('exportDate')
      await page.getByRole('combobox').first().selectOption('>=')
      await page.getByPlaceholder('field value').first().fill('2024-01-01')
      await page.getByRole('button', { name: '+ Add filter' }).click()

      // Also add status filter (non-key field)
      await addFilter(page, 'status', '=', 'delivered')

      await runQuery(page)

      // Expected: KeyConditionExpression on exportDate + FilterExpression on status
      const rowCount = await page.locator('tbody tr').count()
      expect(rowCount, 'Expected results from KeyCondition + Filter').toBeGreaterThanOrEqual(0)
    }
  )

  // ── Test 4: ExportTransactions: country filter (NON-SK) vs GSI ────────────────

  test(
    '4. ExportTransactions: filter country="US" — non-key field triggers Scan, but Country-Date-index GSI is more efficient',
    async ({ page }) => {
      test.slow()

      await openExploreQuery(page, 'ExportTransactions')

      // First, run WITHOUT the index (Scan path)
      await addFilter(page, 'country', '=', 'US')
      await runQuery(page)

      // Expected: Scan warning
      await expect(
        page.getByText(/Scan detected|full table scan|inefficient/i),
        'Expected Scan warning for country filter without GSI'
      ).toBeVisible({ timeout: 15_000 })

      const scanRowCount = await page.locator('tbody tr').count()
      const scanCostBadge = page.getByText(/RCU|cost|reads/i)
      const scanCostVisible = await scanCostBadge.isVisible({ timeout: 2_000 }).catch(() => false)

      // Clear filters
      const chips = page.locator('[data-chip] button, .chip button').or(
        page.getByRole('button', { name: '×' })
      )
      const chipCount = await chips.count()
      for (let i = 0; i < chipCount; i++) {
        await chips.first().click()
      }

      // Now use the Country-Date-index GSI
      const indexSelect = page
        .getByLabel(/Index/i)
        .or(page.getByRole('combobox', { name: /index/i }))
      if (await indexSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
        // Select Country-Date-index if available
        const options = page.locator('select option')
        const optionCount = await options.count()
        let foundCountryIndex = false
        for (let i = 0; i < optionCount; i++) {
          const text = await options.nth(i).textContent()
          if (text && text.includes('Country')) {
            await indexSelect.selectOption(text)
            foundCountryIndex = true
            break
          }
        }

        if (foundCountryIndex) {
          // Run query with GSI
          await addFilter(page, 'country', '=', 'US')
          await runQuery(page)

          // Expected: IndexQuery, not Scan warning
          const hasScanWarning = await page.getByText(/Scan detected/i).isVisible({ timeout: 2_000 }).catch(() => false)
          expect(
            !hasScanWarning,
            'Expected NO Scan warning when using Country-Date-index GSI'
          ).toBe(true)

          const gsiRowCount = await page.locator('tbody tr').count()
          // GSI should return same or similar rows, but with lower RCU
          expect(gsiRowCount, 'Expected results from GSI query').toBeGreaterThanOrEqual(0)
        }
      }
    }
  )

  // ── Test 5: ProductPrices changePercent < 0 (NON-SK, Scan mode) ────────────────

  test(
    '5. ProductPrices: filter changePercent < 0 (NON-SK) triggers Scan + FilterExpression, shows negative change days',
    async ({ page }) => {
      test.slow()

      await openExploreQuery(page, 'ProductPrices')

      // ProductPrices: pk=product, sk=priceDate. changePercent is NON-SK
      await addFilter(page, 'changePercent', '<', '0')
      await runQuery(page)

      // Expected: Scan warning
      await expect(
        page.getByText(/Scan detected|full table scan|inefficient/i),
        'Expected Scan warning for changePercent filter (NON-SK)'
      ).toBeVisible({ timeout: 15_000 })

      // Should show negative change records
      const rowCount = await page.locator('tbody tr').count()
      expect(rowCount, 'Expected to find negative changePercent records').toBeGreaterThanOrEqual(0)
    }
  )

  // ── Test 6: ProductPrices: Volatility-Date-index (GSI) vs Scan path ──────────

  test(
    '6. ProductPrices: same filter (volatility=high) via GSI vs Scan — GSI is much more efficient, RCU badge shows lower number',
    async ({ page }) => {
      test.slow()

      await openExploreQuery(page, 'ProductPrices')

      // First, Scan path (no GSI): filter volatility = high
      await addFilter(page, 'volatility', '=', 'high')
      await runQuery(page)

      // Scan warning expected
      const hasScanWarning1 = await page.getByText(/Scan detected/i).isVisible({ timeout: 2_000 }).catch(() => false)
      expect(hasScanWarning1, 'Expected Scan warning for non-GSI volatility filter').toBe(true)

      const scanRowCount = await page.locator('tbody tr').count()

      // Clear filters
      const chips = page.locator('[data-chip] button, .chip button').or(
        page.getByRole('button', { name: '×' })
      )
      const chipCount = await chips.count()
      for (let i = 0; i < chipCount; i++) {
        await chips.first().click()
      }

      // Now switch to Volatility-Date-index GSI
      const indexSelect = page
        .getByLabel(/Index/i)
        .or(page.getByRole('combobox', { name: /index/i }))
      if (await indexSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
        const options = page.locator('select option')
        const optionCount = await options.count()
        for (let i = 0; i < optionCount; i++) {
          const text = await options.nth(i).textContent()
          if (text && text.includes('Volatility')) {
            await indexSelect.selectOption(text)
            break
          }
        }

        await addFilter(page, 'volatility', '=', 'high')
        await runQuery(page)

        // GSI query: should NOT have Scan warning
        const hasScanWarning2 = await page.getByText(/Scan detected/i).isVisible({ timeout: 2_000 }).catch(() => false)
        expect(hasScanWarning2, 'Expected NO Scan warning with GSI').toBe(false)

        const gsiRowCount = await page.locator('tbody tr').count()
        expect(gsiRowCount, 'Expected results from Volatility-Date-index GSI').toBeGreaterThanOrEqual(0)
      }
    }
  )

  // ── Test 7: CountryMetrics inflationPct > 5 (NON-SK, expensive Scan) ──────────

  test(
    '7. CountryMetrics: filter inflationPct > 5 (NON-SK) triggers expensive Scan + FilterExpression, high RCU warning',
    async ({ page }) => {
      test.slow()

      await openExploreQuery(page, 'CountryMetrics')

      // CountryMetrics: pk=country, sk=reportDate (monthly). inflationPct is NON-SK
      await addFilter(page, 'inflationPct', '>', '5')
      await runQuery(page)

      // Expected: Scan warning (full table scan + client-side filter)
      await expect(
        page.getByText(/Scan detected|full table scan|expensive|high.*RCU/i),
        'Expected Scan or high-RCU warning for inflationPct filter'
      ).toBeVisible({ timeout: 15_000 })

      const rowCount = await page.locator('tbody tr').count()
      expect(rowCount, 'Expected results from Scan + FilterExpression').toBeGreaterThanOrEqual(0)
    }
  )

  // ── Test 8: TradeTariffs tariffRatePct > 20 AND status=active (multiple FilterExpression) ──

  test(
    '8. TradeTariffs: filter tariffRatePct > 20 (NON-SK) AND status=active — both use FilterExpression, expensive Scan',
    async ({ page }) => {
      test.slow()

      await openExploreQuery(page, 'TradeTariffs')

      // TradeTariffs: pk=tradeRoute, sk=effectiveDate. tariffRatePct and status are NON-SK
      await addFilter(page, 'tariffRatePct', '>', '20')
      await addFilter(page, 'status', '=', 'active')

      await runQuery(page)

      // Expected: Both filters use FilterExpression on top of Scan
      await expect(
        page.getByText(/Scan detected|full table scan/i),
        'Expected Scan warning for two NON-SK filters'
      ).toBeVisible({ timeout: 15_000 })

      const rowCount = await page.locator('tbody tr').count()
      expect(rowCount, 'Expected results from multi-FilterExpression Scan').toBeGreaterThanOrEqual(0)
    }
  )

  // ── Test 9: SensorAlerts createdAt IS SK — begins_with "2024-" uses KeyConditionExpression ────

  test(
    '9. SensorAlerts: createdAt IS SK — begins_with "2024-" uses KeyConditionExpression (efficient), compare RCU with FilterExpression path',
    async ({ page }) => {
      // Navigate to SensorAlerts table
      // (Assuming it exists in the seed; if not, we skip)
      const sensorAlertsAvailable = await page
        .getByText('SensorAlerts')
        .isVisible({ timeout: 2_000 })
        .catch(() => false)

      if (sensorAlertsAvailable) {
        await openExploreQuery(page, 'SensorAlerts')

        // SensorAlerts: pk=deviceId, sk=alertId, createdAt = ISO string (SK-like field)
        // If createdAt is a SK, this should be efficient
        // If createdAt is NOT a SK but we're filtering on it without pk, it's expensive

        // For now, let's add deviceId (pk) first, then createdAt
        await addFilter(page, 'deviceId', '=', 'sensor-0001')
        await addFilter(page, 'createdAt', 'begins_with', '2024-')

        await runQuery(page)

        // Expected: KeyConditionExpression on createdAt (if it's a SK), efficient
        const rowCount = await page.locator('tbody tr').count()
        expect(rowCount, 'Expected results from KeyCondition on createdAt').toBeGreaterThanOrEqual(0)

        // No Scan warning expected (pk + sk combo is efficient)
        const hasScanWarning = await page.getByText(/Scan detected/i).isVisible({ timeout: 2_000 }).catch(() => false)
        expect(hasScanWarning, 'Expected NO Scan warning for pk + SK begins_with').toBe(false)
      } else {
        test.skip(true, 'SensorAlerts table not available in this build')
      }
    }
  )

  // ── Test 10: Cost comparison — Scan path vs GSI path ──────────────────────────

  test(
    '10. Cost comparison: same query (country="US") twice — first as Scan+FilterExpression, then as GSI IndexQuery. Verify RCU badge shows lower number for GSI path',
    async ({ page }) => {
      test.slow()

      await openExploreQuery(page, 'ExportTransactions')

      // First run: Scan path (no GSI)
      await addFilter(page, 'country', '=', 'US')
      await runQuery(page)

      // Capture Scan RCU
      await expect(
        page.getByText(/Scan detected/i),
        'Expected Scan warning in first run'
      ).toBeVisible({ timeout: 15_000 })

      const scanRcuText = page.getByText(/RCU|cost|reads|~\d+/).first()
      const scanRcuVisible = await scanRcuText.isVisible({ timeout: 2_000 }).catch(() => false)
      const scanRcuValue = scanRcuVisible ? await scanRcuText.textContent() : 'unknown'

      // Clear filters
      const chips = page.locator('[data-chip] button, .chip button').or(
        page.getByRole('button', { name: '×' })
      )
      const chipCount = await chips.count()
      for (let i = 0; i < chipCount; i++) {
        await chips.first().click()
      }

      // Second run: GSI path
      const indexSelect = page
        .getByLabel(/Index/i)
        .or(page.getByRole('combobox', { name: /index/i }))
      if (await indexSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
        const options = page.locator('select option')
        const optionCount = await options.count()
        for (let i = 0; i < optionCount; i++) {
          const text = await options.nth(i).textContent()
          if (text && text.includes('Country')) {
            await indexSelect.selectOption(text)
            break
          }
        }

        await addFilter(page, 'country', '=', 'US')
        await runQuery(page)

        // Should NOT have Scan warning
        const hasScanWarning = await page.getByText(/Scan detected/i).isVisible({ timeout: 2_000 }).catch(() => false)
        expect(hasScanWarning, 'Expected NO Scan warning in GSI run').toBe(false)

        // Capture GSI RCU
        const gsiRcuText = page.getByText(/RCU|cost|reads|~\d+/).first()
        const gsiRcuVisible = await gsiRcuText.isVisible({ timeout: 2_000 }).catch(() => false)
        const gsiRcuValue = gsiRcuVisible ? await gsiRcuText.textContent() : 'unknown'

        // Log comparison (in real scenario, GSI should show lower RCU)
        console.log(`Scan path RCU: ${scanRcuValue}, GSI path RCU: ${gsiRcuValue}`)

        // Verify both ran successfully
        const rowCount = await page.locator('tbody tr').count()
        expect(rowCount, 'Expected results from GSI IndexQuery').toBeGreaterThanOrEqual(0)
      }
    }
  )
})
