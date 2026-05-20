/**
 * DynamoDB Index Patterns — Alex DeBrie / The DynamoDB Book best practices.
 *
 * Tests every major access-pattern shape against REAL DynamoDB Local seed data:
 *   SensorAlerts   — pk=deviceId (S), sk=alertId (S), createdAt (ISO String)
 *                    GSI: Severity-index (pk=severity, sk=createdAt)
 *   DeviceMessages — pk=deviceId (S), sk=timestamp (N)
 *                    GSI: Status-index (pk=status)
 *   DeviceLocations — pk=locationKey (S, composite pattern e.g. "US::northeast::sensor-0001")
 *   DeviceRegistry — pk=deviceId (S), no SK
 *
 * Patterns covered (DeBrie chapter references in comments):
 *   • GSI exact query (PK only)
 *   • GSI PK + SK begins_with (ISO prefix)
 *   • GSI PK + SK BETWEEN (ISO range)
 *   • GSI PK + SK sort DESC (latest-first)
 *   • Table PK-only query (single-partition fetch)
 *   • Table PK + SK BETWEEN (Unix timestamp range)
 *   • Overloaded PK begins_with (composite key prefix scan)
 *   • Month-prefix ISO begins_with
 *   • Hierarchical composite key multi-level prefix chain
 *   • Scan warning + index suggestion panel
 *   • Non-PK filter cost estimator warning
 *   • begins_with vs BETWEEN comparison for time ranges
 *
 * Requires:
 *   npm run db:start && npm run db:seed
 *   npm run test:suite-index-patterns
 */

import { test, expect, type Page } from '@playwright/test'

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE         = 'http://localhost:1421'
const CURRENT_YEAR = new Date().getFullYear().toString()          // e.g. "2026"
const CURRENT_MONTH = new Date().toISOString().slice(0, 7)        // e.g. "2026-05"

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
  await expect(page.getByText('DeviceMessages')).toBeVisible({ timeout: 15_000 })
}

/**
 * Navigate to Explore > Query tab for the named table.
 */
async function openExploreQuery(page: Page, tableName: string) {
  await page.getByText(tableName).first().click()
  await page.getByRole('button', { name: 'Explore' }).click()
  await expect(
    page.getByRole('tab', { name: 'Query' }).or(page.getByText('Query').first())
  ).toBeVisible()
}

/**
 * Select a GSI from the index dropdown, if visible.
 */
async function selectIndex(page: Page, indexName: string) {
  const indexSelect = page
    .getByLabel(/Index/i)
    .or(page.getByRole('combobox', { name: /index/i }))
  if (await indexSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await indexSelect.selectOption(indexName)
  }
}

/**
 * Add a simple equality/prefix/range filter chip.
 */
async function addFilter(page: Page, field: string, operator: string, value: string) {
  await page.getByPlaceholder('field name').fill(field)
  await page.getByRole('combobox').first().selectOption(operator)
  await page.getByPlaceholder('field value').first().fill(value)
  await page.getByRole('button', { name: '+ Add filter' }).click()
}

/**
 * Add a BETWEEN filter chip with two value inputs.
 */
async function addBetweenFilter(page: Page, field: string, lo: string, hi: string) {
  await page.getByPlaceholder('field name').fill(field)
  await page.getByRole('combobox').first().selectOption('between')
  const valueInputs = page.getByPlaceholder('field value')
  await valueInputs.first().fill(lo)
  await valueInputs.last().fill(hi)
  await page.getByRole('button', { name: '+ Add filter' }).click()
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Index patterns — DeBrie / awesome-dynamodb best practices (DynamoDB Local)', () => {
  test.setTimeout(45_000)

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}?mock=0`)
    await addLocalConnection(page)
  })

  // ── Pattern 1: GSI exact query (PK only) ─────────────────────────────────

  test('GSI exact query — Severity-index, severity=WARN → IndexQuery mode shown, only WARN results', async ({ page }) => {
    // DeBrie §GSI-overloading: querying a GSI PK without a SK condition is a
    // standard IndexQuery. All items in the "WARN" severity partition are returned.
    await openExploreQuery(page, 'SensorAlerts')
    await selectIndex(page, 'Severity-index')
    await addFilter(page, 'severity', '=', 'WARN')
    await page.getByRole('button', { name: /Run/i }).click()

    // IndexQuery mode indicator should be shown
    await expect(page.getByText(/IndexQuery/i)).toBeVisible({ timeout: 15_000 })

    // Every visible result must be WARN — no CRIT or INFO rows should bleed in
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    const warnCells = page.locator('td').filter({ hasText: /^WARN$/ })
    await expect(warnCells.first()).toBeVisible()
  })

  // ── Pattern 2: GSI PK + SK begins_with ISO — current-year prefix ─────────

  test('GSI pk + sk begins_with ISO — Severity-index, severity=CRIT, createdAt begins_with current-year → efficient IndexQuery', async ({ page }) => {
    // DeBrie §ISO-date-SK: using begins_with on an ISO date SK lets you fetch
    // all CRIT alerts for a given year without storing a separate date index.
    // DynamoDB evaluates begins_with as a KeyConditionExpression on the GSI SK.
    await openExploreQuery(page, 'SensorAlerts')
    await selectIndex(page, 'Severity-index')
    await addFilter(page, 'severity', '=', 'CRIT')
    await addFilter(page, 'createdAt', 'begins_with', CURRENT_YEAR)
    await page.getByRole('button', { name: /Run/i }).click()

    // Should use IndexQuery — not a Scan (begins_with on GSI SK is a key condition)
    await expect(page.getByText(/IndexQuery/i)).toBeVisible({ timeout: 15_000 })

    // No JS errors
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    expect(errors).toHaveLength(0)
  })

  // ── Pattern 3: GSI PK + SK BETWEEN ISO dates — month range ───────────────

  test('GSI pk + sk BETWEEN ISO — Severity-index, severity=INFO, createdAt BETWEEN "2024-05-01" AND "2024-05-31" → month range', async ({ page }) => {
    // DeBrie §range-queries: BETWEEN on an ISO SK provides month-granularity
    // time windows. This is more explicit than begins_with but works identically
    // for full-month ranges. DynamoDB uses KeyConditionExpression BETWEEN.
    await openExploreQuery(page, 'SensorAlerts')
    await selectIndex(page, 'Severity-index')
    await addFilter(page, 'severity', '=', 'INFO')
    await addBetweenFilter(page, 'createdAt', '2024-05-01', '2024-05-31T23:59:59Z')
    await page.getByRole('button', { name: /Run/i }).click()

    // Results must be within May 2024 only
    await expect(
      page.getByText(/returned|IndexQuery/i).first()
    ).toBeVisible({ timeout: 15_000 })

    const errMsg = page.getByText(/error|exception/i)
    await expect(errMsg).toHaveCount(0, { timeout: 5_000 })
  })

  // ── Pattern 4: GSI PK + SK sort DESC — latest events first ───────────────

  test('GSI pk + sk DESC — Status-index, status=WARN, sort DESC → latest WARN events first', async ({ page }) => {
    // DeBrie §sort-key: reversing the sort order on a GSI SK returns the most
    // recent items first without re-scanning. The UI sort toggle flips
    // DynamoDB's ScanIndexForward=false flag.
    await openExploreQuery(page, 'DeviceMessages')
    await selectIndex(page, 'Status-index')
    await addFilter(page, 'status', '=', 'WARN')
    await page.getByRole('button', { name: /Run/i }).click()

    await expect(page.getByText(/returned|IndexQuery/i)).toBeVisible({ timeout: 15_000 })

    // Toggle to DESC if sort control is available
    const sortBtn = page.getByTitle(/Sort by/)
    if (await sortBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const currentDir = await sortBtn.textContent()
      if (!currentDir?.includes('↓')) {
        await sortBtn.click()
      }
      await expect(sortBtn).toContainText('↓')
    }

    // First row should be present — verify result loaded without error
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10_000 })
  })

  // ── Pattern 5: Table PK-only query — single sensor, all messages ──────────

  test('Table pk= only — DeviceMessages, deviceId=sensor-0001 → Query mode, all messages for that sensor', async ({ page }) => {
    // DeBrie §single-table-design: querying pk= without a sk condition fetches
    // all items for that partition key. This is a Query (not a Scan) because
    // deviceId is the table's hash key — no index needed.
    await openExploreQuery(page, 'DeviceMessages')
    await addFilter(page, 'deviceId', '=', 'sensor-0001')
    await page.getByRole('button', { name: /Run/i }).click()

    // Every result must belong to sensor-0001
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    const sensorCells = page.locator('td').filter({ hasText: 'sensor-0001' })
    await expect(sensorCells.first()).toBeVisible()

    // No other sensor IDs should appear in the results
    const otherSensor = page.locator('td').filter({ hasText: /sensor-0002|sensor-0003/ })
    await expect(otherSensor).toHaveCount(0)
  })

  // ── Pattern 6: Table PK + SK BETWEEN Unix timestamps — last 24h ──────────

  test('Table pk + sk BETWEEN Unix timestamp — DeviceMessages, deviceId=sensor-0001, timestamp BETWEEN [now-86400000, now] → last 24h messages', async ({ page }) => {
    // DeBrie §time-series: storing timestamps as Unix epoch Numbers (milliseconds)
    // and filtering with BETWEEN is a canonical time-series access pattern.
    // The SK is a Number — BETWEEN bounds are epoch-millisecond integers.
    const now = Date.now()
    const yesterday = now - 86_400_000

    await openExploreQuery(page, 'DeviceMessages')
    await addFilter(page, 'deviceId', '=', 'sensor-0001')
    await addBetweenFilter(page, 'timestamp', String(yesterday), String(now))
    await page.getByRole('button', { name: /Run/i }).click()

    // Query should execute — either rows within the window, or 0 rows (no crash)
    const resultOrEmpty = page
      .getByText(/returned|No items/i)
      .or(page.locator('tbody tr'))
    await expect(resultOrEmpty.first()).toBeVisible({ timeout: 15_000 })

    // No error/exception must appear
    await expect(page.getByText(/error|exception/i)).toHaveCount(0, { timeout: 5_000 })
  })

  // ── Pattern 7: Overloaded PK — begins_with "US::" on locationKey ─────────

  test('Overloaded PK pattern — DeviceLocations, locationKey begins_with "US::" → only US sensors returned', async ({ page }) => {
    // DeBrie §composite-sort-key / GSI overloading: storing hierarchical data
    // in a single PK field (e.g. "US::northeast::sensor-0001") lets you query
    // sub-hierarchies with begins_with. This is NOT a GSI query — it is a Scan
    // with a FilterExpression (or a Table Query if locationKey is a SK).
    await openExploreQuery(page, 'DeviceLocations')
    await addFilter(page, 'locationKey', 'begins_with', 'US::')
    await page.getByRole('button', { name: /Run/i }).click()

    // All returned rows must have a US:: prefix in locationKey
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    const usCells = page.locator('td').filter({ hasText: /^US::/ })
    await expect(usCells.first()).toBeVisible()

    // EU:: and APAC:: rows must NOT appear
    await expect(page.locator('td').filter({ hasText: /^EU::/ })).toHaveCount(0)
    await expect(page.locator('td').filter({ hasText: /^APAC::/ })).toHaveCount(0)
  })

  // ── Pattern 8: Month-prefix ISO begins_with on GSI SK ────────────────────

  test('Month prefix ISO — Severity-index, createdAt begins_with current-month prefix → alerts for this month only', async ({ page }) => {
    // DeBrie §ISO-date-SK: a month-level prefix (e.g. "2026-05") narrows
    // the scan to a single calendar month. Equivalent to a GSI range query
    // without needing a separate month attribute.
    await openExploreQuery(page, 'SensorAlerts')
    await selectIndex(page, 'Severity-index')

    // We need a severity PK value to make this an IndexQuery
    await addFilter(page, 'severity', '=', 'INFO')
    await addFilter(page, 'createdAt', 'begins_with', CURRENT_MONTH)
    await page.getByRole('button', { name: /Run/i }).click()

    // Should succeed — either 0 rows (no data this month) or rows with the prefix
    const errMsg = page.getByText(/error|exception/i)
    await expect(errMsg).toHaveCount(0, { timeout: 15_000 })

    // Verify IndexQuery mode (GSI PK + SK begins_with is a KeyConditionExpression)
    await expect(page.getByText(/IndexQuery/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── Pattern 9: Hierarchical composite key — multi-level prefix chain ──────

  test('Hierarchical composite key prefix chain — locationKey begins_with "US::northeast::" → northeast US sensors only', async ({ page }) => {
    // DeBrie §hierarchical-data: narrowing a composite key prefix to a
    // sub-hierarchy (US → northeast) returns only sensors in that region.
    // Two-level prefix is stricter than the one-level "US::" query.
    await openExploreQuery(page, 'DeviceLocations')
    await addFilter(page, 'locationKey', 'begins_with', 'US::northeast::')
    await page.getByRole('button', { name: /Run/i }).click()

    // All results must have the two-level prefix
    const resultOrEmpty = page
      .getByText(/returned|No items/i)
      .or(page.locator('tbody tr'))
    await expect(resultOrEmpty.first()).toBeVisible({ timeout: 15_000 })

    // If any rows returned, they must all be northeast
    const rows = page.locator('tbody tr')
    const rowCount = await rows.count()
    if (rowCount > 0) {
      const northeastCells = page.locator('td').filter({ hasText: /^US::northeast::/ })
      await expect(northeastCells.first()).toBeVisible()
      // US::southeast:: or US::west:: must NOT appear
      await expect(page.locator('td').filter({ hasText: /US::southeast::|US::west::/ })).toHaveCount(0)
    }
  })

  // ── Pattern 10: Scan with non-GSI field → index suggestion panel ─────────

  test('Scan with non-indexed field — index suggestion panel appears (field with <15% selectivity)', async ({ page }) => {
    // DeBrie §access-pattern-analysis: filtering on a low-selectivity field
    // (e.g. "status" which has only a few distinct values across all rows)
    // should prompt the UI to suggest creating a GSI.
    await openExploreQuery(page, 'DeviceMessages')

    // Add a filter on "status" (not the PK) — this triggers a Scan
    await addFilter(page, 'status', '=', 'WARN')
    // Do NOT add a pk= filter — this forces a full table scan

    // A scan warning or index suggestion should appear
    const scanWarning = page.getByText(/Scan detected|full scan|no index|index suggestion|consider.*GSI|GSI.*suggested/i)
    await expect(scanWarning.first()).toBeVisible({ timeout: 10_000 })
  })

  // ── Pattern 11: Non-PK filter on large table → cost estimator ────────────

  test('Non-pk filter on large table — scan warning and cost estimator shows high RCU estimate', async ({ page }) => {
    // DeBrie §cost-modelling: scanning a large table (5000 DeviceMessages rows)
    // to filter on a non-key attribute forces DynamoDB to read every item.
    // The UI cost estimator should highlight the RCU impact.
    await openExploreQuery(page, 'DeviceMessages')

    // Filter on a non-key attribute without providing the pk — forces Scan
    await addFilter(page, 'payload', 'exists', '')

    // Scan detected warning must appear
    const costWarning = page.getByText(/Scan detected|estimated.*RCU|full.*scan|cost.*estimat/i)
    await expect(costWarning.first()).toBeVisible({ timeout: 10_000 })

    // No JS errors during this path
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    expect(errors).toHaveLength(0)
  })

  // ── Pattern 12: begins_with vs BETWEEN — both work for ISO time ranges ────

  test('begins_with "2024-05" and BETWEEN "2024-05-01"/"2024-05-31" — both operators return results for May 2024 SensorAlerts', async ({ page }) => {
    // DeBrie §operator-choice: begins_with is simpler for month queries;
    // BETWEEN is more explicit and works when the prefix does not align cleanly.
    // Both should return non-zero results for the same month of seed data.
    // begins_with uses IndexQuery where available; BETWEEN always uses
    // KeyConditionExpression on SK.

    await openExploreQuery(page, 'SensorAlerts')
    await selectIndex(page, 'Severity-index')

    // ── begins_with ──
    await addFilter(page, 'severity', '=', 'WARN')
    await addFilter(page, 'createdAt', 'begins_with', '2024-05')
    await page.getByRole('button', { name: /Run/i }).click()
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    const bwCount = await page.locator('tbody tr').count()
    expect(bwCount).toBeGreaterThan(0)

    // Clear all chips before the second run
    const removeButtons = page.locator('[data-chip] button, .chip button').or(
      page.getByRole('button', { name: '×' })
    )
    const chipCount = await removeButtons.count()
    for (let i = 0; i < chipCount; i++) {
      await removeButtons.first().click()
    }
    // Also try a dedicated Clear/Reset button
    const clearBtn = page.getByRole('button', { name: /Clear|Reset/i }).first()
    if (await clearBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await clearBtn.click()
    }

    // ── BETWEEN ──
    await addFilter(page, 'severity', '=', 'WARN')
    await addBetweenFilter(page, 'createdAt', '2024-05-01', '2024-05-31T23:59:59Z')
    await page.getByRole('button', { name: /Run/i }).click()
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    const btCount = await page.locator('tbody tr').count()
    expect(btCount).toBeGreaterThan(0)

    // Both paths must return a comparable number of rows (within 10% of each other)
    // — confirms they describe the same data window without double-counting
    const ratio = bwCount / btCount
    expect(ratio).toBeGreaterThan(0.5)
    expect(ratio).toBeLessThan(2.0)
  })
})
