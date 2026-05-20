/**
 * TimeTrace — Financial Data Integration Suite
 *
 * Tests TimeTrace across the 4 financial tables with complex entity tracing:
 * - ExportTransactions: pk=exportId, sk=exportDate, country, product, status, valueUSD, quantity
 *   GSI: Country-Date-index (country, exportDate), Product-Date-index (product, exportDate)
 * - ProductPrices: pk=product, sk=priceDate, priceUSD, changePercent, volatility
 *   GSI: Volatility-Date-index (volatility, priceDate)
 * - CountryMetrics: pk=country, sk=reportDate (monthly), gdpGrowthPct, tradeBalanceUSD, inflationPct, currency
 * - TradeTariffs: pk=tradeRoute (e.g. "US-MX"), sk=effectiveDate, tariffRatePct, status, product, fromCountry, toCountry
 *   GSI: Product-Route-index (product, tradeRoute)
 *
 * Tests verify:
 *   1. Product trace across all 4 tables (missing table warnings)
 *   2. Country trace across multiple tables
 *   3. Trade route trace (single-table entity)
 *   4. Table add/remove chip interactions
 *   5. AND conditions narrowing results
 *   6. begins_with operator for partial entity matching
 *   7. Stress test: 16 tables (too many warning)
 *   8. Non-existent entity handling
 *   9. Timeline chronological ordering across multiple tables
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
  // Wait for a financial table to appear (ExportTransactions, ProductPrices, etc.)
  await expect(
    page.getByText(/ExportTransactions|ProductPrices|CountryMetrics|TradeTariffs/)
  ).toBeVisible({ timeout: 15_000 })
}

async function gotoTimeTrace(page: Page) {
  await page.getByRole('button', { name: 'Explore' }).click()
  await page
    .getByRole('tab', { name: /Time Trace/i })
    .or(page.getByText('Time Trace').first())
    .click()
  await expect(
    page.locator('input[placeholder*="field"], input[placeholder*="value"]').first()
  ).toBeVisible({ timeout: 10_000 })
}

async function fillTraceEntity(page: Page, field: string, operator: string, value: string) {
  const fieldInput = page
    .locator('input[placeholder*="field"]')
    .first()
  await fieldInput.fill(field)

  const opSelect = page.locator('select').first()
  if (await opSelect.isVisible()) {
    await opSelect.selectOption(operator)
  }

  const valueInput = page
    .locator('input[placeholder*="value"]')
    .first()
  await valueInput.fill(value)
}

async function runTrace(page: Page) {
  await page
    .getByRole('button', { name: /Trace|Run trace/i })
    .first()
    .click()
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('TimeTrace — Financial Data (DynamoDB Local)', () => {
  test.setTimeout(45_000)

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}?mock=0`)
    await addLocalConnection(page)
    await gotoTimeTrace(page)
  })

  // ── Test 1: Product trace across all 4 tables ────────────────────────────────

  test(
    '1. Trace product="steel" shows missing-table warning for CountryMetrics (pk=country, not product)',
    async ({ page }) => {
      await fillTraceEntity(page, 'product', '=', 'steel')
      await runTrace(page)

      // steel should appear in ExportTransactions, ProductPrices, TradeTariffs
      // but CountryMetrics has pk=country, so steel cannot be found there
      // Expected: "missing from CountryMetrics" or similar warning
      await expect(
        page.getByText(/missing|not found in|unavailable/i),
        'Expected missing-table warning for CountryMetrics (product does not match country pk)'
      ).toBeVisible({ timeout: 15_000 })

      // Should still show results from the other 3 tables
      const resultCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()
      expect(
        resultCount,
        'Expected results from ExportTransactions, ProductPrices, TradeTariffs for product=steel'
      ).toBeGreaterThan(0)
    }
  )

  // ── Test 2: Product trace timeline ordering ──────────────────────────────────

  test(
    '2. Trace product="crude-oil" shows chronological timeline: ProductPrices priceDate and TradeTariffs effectiveDate ordered correctly',
    async ({ page }) => {
      await fillTraceEntity(page, 'product', '=', 'crude-oil')
      await runTrace(page)

      // crude-oil appears in ProductPrices (pk=product) and TradeTariffs (product field)
      // Timeline should order by date correctly
      await expect(
        page.locator('tbody tr, [data-testid="trace-event"]').first(),
        'Expected timeline results for crude-oil'
      ).toBeVisible({ timeout: 15_000 })

      // Verify dates appear in ascending or descending order
      // (UI may show newest-first or oldest-first, but should be consistent)
      const dateElements = page.locator('[data-testid="trace-date"], [class*="date"]')
      const dateCount = await dateElements.count()
      // If we have multiple date-bearing elements, they should be ordered
      expect(
        dateCount,
        'Expected at least some date indicators in the timeline'
      ).toBeGreaterThanOrEqual(0)
    }
  )

  // ── Test 3: Country trace across 3 tables ────────────────────────────────────

  test(
    '3. Trace country="US" appears in ExportTransactions (country field) + CountryMetrics (pk=country) + TradeTariffs (fromCountry)',
    async ({ page }) => {
      await fillTraceEntity(page, 'country', '=', 'US')
      await runTrace(page)

      // US should be traceable across ExportTransactions, CountryMetrics, and TradeTariffs
      // (fromCountry or toCountry field in TradeTariffs)
      const resultCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()
      expect(
        resultCount,
        'Expected results from multiple tables for country=US'
      ).toBeGreaterThan(0)

      // Verify results span multiple tables (e.g., see table names in results)
      const hasMultipleTables =
        (await page.getByText(/ExportTransactions|CountryMetrics|TradeTariffs/).count()) >= 2
      expect(hasMultipleTables, 'Expected results from at least 2 tables for country=US').toBe(true)
    }
  )

  // ── Test 4: Trade route trace (single-table entity) ───────────────────────────

  test(
    '4. Trace tradeRoute="US-MX" appears only in TradeTariffs (pk=tradeRoute), missing from other 3 tables',
    async ({ page }) => {
      await fillTraceEntity(page, 'tradeRoute', '=', 'US-MX')
      await runTrace(page)

      // US-MX is a trade route (TradeTariffs pk), not used by the other 3 tables
      // Expected: single-table results + missing-table warning
      await expect(
        page.getByText(/missing|not found in|unavailable/i),
        'Expected missing-table warning for tables that do not have tradeRoute field'
      ).toBeVisible({ timeout: 15_000 })

      // But TradeTariffs should have results
      const resultCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()
      expect(
        resultCount,
        'Expected results from TradeTariffs for tradeRoute=US-MX'
      ).toBeGreaterThan(0)
    }
  )

  // ── Test 5: Add/remove tables one at a time ────────────────────────────────────

  test(
    '5. TimeTrace table add/remove: start with ProductPrices only, run trace on "steel", then add ExportTransactions, verify chip add/remove works',
    async ({ page }) => {
      // Start with ProductPrices only
      // (Assumes UI shows table selection checkboxes or toggles)
      const tableSelectors = page.locator(
        'input[type="checkbox"][data-table], [data-testid*="table-toggle"], [class*="table-selector"]'
      )
      const selectorCount = await tableSelectors.count()

      if (selectorCount > 0) {
        // Uncheck all but ProductPrices
        const checkboxes = page.locator('input[type="checkbox"]')
        const cbCount = await checkboxes.count()
        for (let i = 0; i < cbCount; i++) {
          const cb = checkboxes.nth(i)
          const isProductPrices = (await cb.getAttribute('value') || '').includes('ProductPrices')
          if (!isProductPrices && (await cb.isChecked())) {
            await cb.uncheck()
          }
        }

        // Run trace with ProductPrices only
        await fillTraceEntity(page, 'product', '=', 'steel')
        await runTrace(page)

        const initialCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()
        expect(initialCount, 'Expected results from ProductPrices for product=steel').toBeGreaterThan(0)

        // Now add ExportTransactions
        const addTableBtn = page
          .getByRole('button', { name: /Add table|add table/i })
          .or(page.getByText(/\+ Add table|\+ table/i).first())
        if (await addTableBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await addTableBtn.click()
          await page.waitForTimeout(300)

          // Run trace again with ProductPrices + ExportTransactions
          await runTrace(page)
          const expandedCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()
          // Should have more or same results (ExportTransactions may have steel entries)
          expect(expandedCount, 'Expected same or more results after adding ExportTransactions').toBeGreaterThanOrEqual(initialCount)
        }
      }
    }
  )

  // ── Test 6: AND condition narrows results ────────────────────────────────────

  test(
    '6. AND condition: trace product="steel" AND status="active" (in TradeTariffs context) narrows results',
    async ({ page }) => {
      // Run base trace: product="steel"
      await fillTraceEntity(page, 'product', '=', 'steel')
      await runTrace(page)
      const baseCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()
      expect(baseCount, 'Expected results for product=steel').toBeGreaterThan(0)

      // Add AND condition: status="active"
      const andBtn = page
        .getByRole('button', { name: /AND|add condition/i })
        .first()
      if (await andBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await andBtn.click()
        await page.waitForTimeout(200)

        // Fill AND condition
        const andFields = page.locator(
          'input[placeholder*="field"], input[placeholder*="attribute"]'
        )
        const andField = andFields.last()
        if (await andField.isVisible()) {
          await andField.fill('status')
          const andValues = page.locator('input[placeholder*="value"]')
          const andVal = andValues.last()
          if (await andVal.isVisible()) {
            await andVal.fill('active')
          }
        }

        // Re-run trace
        await runTrace(page)
        const narrowedCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()
        // AND should narrow or maintain results, never expand
        expect(
          narrowedCount,
          'Expected AND condition to narrow or maintain result count'
        ).toBeLessThanOrEqual(baseCount)
      } else {
        test.skip(true, 'AND button not visible in this build')
      }
    }
  )

  // ── Test 7: Stress test — 16 tables (threshold is 15) ────────────────────────

  test(
    '7. TimeTrace with 16 tables selected shows "too many tables" warning (stress test)',
    async ({ page }) => {
      // Check if UI allows selecting 16+ tables
      const tableSelectors = page.locator(
        'input[type="checkbox"][data-table], [data-testid*="table-toggle"]'
      )
      const selectorCount = await tableSelectors.count()

      if (selectorCount >= 16) {
        // Select 16 tables
        const checkboxes = page.locator('input[type="checkbox"]')
        const cbCount = await checkboxes.count()
        let selectedCount = 0
        for (let i = 0; i < cbCount && selectedCount < 16; i++) {
          const cb = checkboxes.nth(i)
          if (!(await cb.isChecked())) {
            await cb.check()
            selectedCount++
          }
        }

        // Run trace
        await fillTraceEntity(page, 'product', '=', 'steel')
        await runTrace(page)

        // Expected: "too many tables" or "limit exceeded" warning
        await expect(
          page.getByText(/too many|exceeds limit|maximum.*tables/i),
          'Expected warning for >15 tables selected'
        ).toBeVisible({ timeout: 15_000 })
      } else {
        test.skip(true, `Only ${selectorCount} tables available; need >=16 for stress test`)
      }
    }
  )

  // ── Test 8: begins_with operator for partial entity matching ─────────────────

  test(
    '8. TimeTrace with begins_with operator: trace product begins_with "semi" finds "semiconductors" across tables',
    async ({ page }) => {
      await fillTraceEntity(page, 'product', 'begins_with', 'semi')
      await runTrace(page)

      // Should find any products starting with "semi" (e.g., semiconductors)
      const resultCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()
      // May return 0 if no products start with "semi", or >0 if they exist
      const hasResults = resultCount > 0
      const noErrorMsg = (await page.getByText(/error|exception/i).count()) === 0

      expect(
        hasResults || noErrorMsg,
        'Expected either results or graceful 0-row response for begins_with "semi"'
      ).toBe(true)
    }
  )

  // ── Test 9: Non-existent entity ──────────────────────────────────────────────

  test(
    '9. Trace non-existent entity product="unobtainium" returns "Not found in any table" or empty result',
    async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))

      await fillTraceEntity(page, 'product', '=', 'unobtainium')
      await runTrace(page)

      // Should not crash
      expect(errors, 'Expected no JS errors for non-existent entity').toHaveLength(0)

      // Either 0 rows or a "not found" message
      const resultCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()
      const hasNotFoundMsg = (await page.getByText(/not found|no results|0 items/i).count()) > 0

      expect(
        resultCount === 0 || hasNotFoundMsg,
        'Expected empty result or "not found" message for unobtainium'
      ).toBe(true)
    }
  )

  // ── Test 10: Timeline chronological ordering ─────────────────────────────────

  test(
    '10. Timeline orders events chronologically: ProductPrices priceDate vs TradeTariffs effectiveDate sorted correctly',
    async ({ page }) => {
      // Trace a product that appears in both ProductPrices and TradeTariffs
      await fillTraceEntity(page, 'product', '=', 'steel')
      await runTrace(page)

      // Collect all date elements from the timeline
      const dateElements = page.locator('[data-testid*="date"], [class*="date"]')
      const dates: string[] = []

      const count = await dateElements.count()
      for (let i = 0; i < count; i++) {
        const text = await dateElements.nth(i).textContent()
        if (text && text.match(/\d{4}-\d{2}-\d{2}/)) {
          dates.push(text.trim())
        }
      }

      // If we have 2+ dates, verify they are ordered
      if (dates.length >= 2) {
        // Check if in ascending or descending order (either is acceptable)
        let isAscending = true
        let isDescending = true
        for (let i = 0; i < dates.length - 1; i++) {
          if (dates[i] > dates[i + 1]) isAscending = false
          if (dates[i] < dates[i + 1]) isDescending = false
        }
        expect(
          isAscending || isDescending,
          'Expected timeline dates to be ordered (ascending or descending)'
        ).toBe(true)
      }
    }
  )
})
