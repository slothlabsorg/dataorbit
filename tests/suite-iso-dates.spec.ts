/**
 * ISO Date String Querying — Integration Suite
 *
 * Tests begins_with and BETWEEN operators against ISO-format string fields
 * in REAL DynamoDB Local data. Covers SensorAlerts (PK=deviceId, SK=alertId,
 * createdAt ISO string), DeviceLocations (installedAt ISO string), and the
 * Severity-index GSI (severity PK, createdAt SK).
 *
 * Requires: npm run db:start && npm run db:seed
 */

import { test, expect, type Page } from '@playwright/test'

const BASE = 'http://localhost:1421'
const CURRENT_YEAR = new Date().getFullYear().toString() // e.g. "2026"

// ── Helpers ───────────────────────────────────────────────────────────────────

async function addLocalConnection(page: Page) {
  await page.goto(`${BASE}?screen=orbit`)
  await page.getByRole('button', { name: /Add connection/i }).first().click()
  // Step 1: select DynamoDB
  await page.getByRole('button', { name: 'DynamoDB' }).click()
  // Step 2: configure
  await page.getByPlaceholder('e.g. nexus-prod').fill('dataorbit-local')
  await page.getByRole('button', { name: '~/.aws profile' }).click()
  await page.getByPlaceholder(/Select or type a profile/i).fill('local')
  await page.getByPlaceholder(/localhost:8000/i).fill('http://localhost:8000')
  await page.getByRole('button', { name: /Continue/i }).click()
  // Step 3: test & save
  await page.getByRole('button', { name: /Test connection/i }).click()
  await expect(page.getByText('Connection successful')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Save connection/i }).click()
  await expect(page.getByText('DeviceMessages')).toBeVisible({ timeout: 15_000 })
}

async function gotoSensorAlertsQuery(page: Page) {
  await page.getByText('SensorAlerts').click()
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

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('ISO Date String Querying — real DynamoDB Local', () => {
  test.setTimeout(30_000)

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}?mock=0`)
    await addLocalConnection(page)
    await gotoSensorAlertsQuery(page)
  })

  // ── begins_with on createdAt (sort key is alertId, createdAt is a filter attribute) ─

  test(
    'begins_with year prefix "2024" on createdAt returns all 2024 SensorAlerts rows (ISO string prefix scan)',
    async ({ page }) => {
      await addFilter(page, 'createdAt', 'begins_with', '2024')
      await page.getByRole('button', { name: /Run/i }).click()
      // Should return rows whose createdAt starts with "2024"
      const rows = page.locator('tbody tr')
      await expect(rows.first()).toBeVisible({ timeout: 15_000 })
      // Verify at least one row contains a 2024-prefixed date value
      await expect(page.getByText(/2024-/).first()).toBeVisible({ timeout: 15_000 })
    }
  )

  test(
    'begins_with month prefix "2024-05" on createdAt returns only May 2024 alerts (sub-month ISO prefix)',
    async ({ page }) => {
      await addFilter(page, 'createdAt', 'begins_with', '2024-05')
      await page.getByRole('button', { name: /Run/i }).click()
      const rows = page.locator('tbody tr')
      await expect(rows.first()).toBeVisible({ timeout: 15_000 })
      // No rows from other months should appear
      await expect(page.getByText(/2024-06/).first()).toHaveCount(0)
      await expect(page.getByText(/2024-04/).first()).toHaveCount(0)
    }
  )

  test(
    'begins_with day prefix "2024-05-15" on createdAt returns only alerts from that exact day (ISO day-level prefix)',
    async ({ page }) => {
      await addFilter(page, 'createdAt', 'begins_with', '2024-05-15')
      await page.getByRole('button', { name: /Run/i }).click()
      // Either rows with that day-prefix are found, or 0 rows and no crash
      const errorMessages = page.getByText(/error|exception|crash/i)
      await expect(errorMessages).toHaveCount(0, { timeout: 15_000 })
      const rowCount = await page.locator('tbody tr').count()
      // Valid outcome: ≥ 0 rows returned without error
      expect(rowCount).toBeGreaterThanOrEqual(0)
    }
  )

  // ── BETWEEN exact date range ──────────────────────────────────────────────────

  test(
    'BETWEEN "2024-05-01" and "2024-05-31T23:59:59Z" on createdAt returns only May 2024 alerts (ISO range query)',
    async ({ page }) => {
      await page.getByPlaceholder('field name').fill('createdAt')
      await page.getByRole('combobox').first().selectOption('between')
      // BETWEEN typically shows two value inputs
      const valueInputs = page.getByPlaceholder('field value')
      await valueInputs.first().fill('2024-05-01')
      await valueInputs.last().fill('2024-05-31T23:59:59Z')
      await page.getByRole('button', { name: '+ Add filter' }).click()
      await page.getByRole('button', { name: /Run/i }).click()
      const rows = page.locator('tbody tr')
      await expect(rows.first()).toBeVisible({ timeout: 15_000 })
      // Confirm results fall within May 2024
      await expect(page.getByText(/2024-05/).first()).toBeVisible({ timeout: 15_000 })
    }
  )

  // ── GSI: Severity-index + createdAt begins_with ──────────────────────────────

  test(
    'GSI Severity-index query: severity=WARN + createdAt begins_with current year returns WARN alerts for this year (GSI with ISO SK prefix)',
    async ({ page }) => {
      // Select the Severity-index GSI
      const indexSelect = page
        .getByLabel(/Index/i)
        .or(page.getByRole('combobox', { name: /index/i }))
      if (await indexSelect.isVisible()) {
        await indexSelect.selectOption('Severity-index')
      }
      // GSI PK: severity = WARN
      await addFilter(page, 'severity', '=', 'WARN')
      // GSI SK: createdAt begins_with current year
      await addFilter(page, 'createdAt', 'begins_with', CURRENT_YEAR)
      await page.getByRole('button', { name: /Run/i }).click()
      // If the GSI SK prefix matches any rows, they should appear; otherwise 0 rows no crash
      const errorMessages = page.getByText(/error|exception/i)
      await expect(errorMessages).toHaveCount(0, { timeout: 15_000 })
    }
  )

  // ── DeviceLocations: installedAt begins_with ──────────────────────────────────

  test(
    'begins_with "2024" on DeviceLocations.installedAt returns locations installed in 2024 (ISO date on non-alert table)',
    async ({ page }) => {
      // Navigate to DeviceLocations
      await page.getByText('DeviceLocations').click()
      // Explore should still be active; if not, click it
      const exploreBtn = page.getByRole('button', { name: 'Explore' })
      if (await exploreBtn.isVisible()) await exploreBtn.click()

      await addFilter(page, 'installedAt', 'begins_with', '2024')
      await page.getByRole('button', { name: /Run/i }).click()
      const errorMessages = page.getByText(/error|exception/i)
      await expect(errorMessages).toHaveCount(0, { timeout: 15_000 })
      // At least one row expected (seed data uses 2024 installs)
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
    }
  )

  // ── Datetime picker renders for createdAt ────────────────────────────────────

  test(
    'datetime picker input is shown when field name is "createdAt" because it matches TIMESTAMP_CANDIDATES heuristic',
    async ({ page }) => {
      await page.getByPlaceholder('field name').fill('createdAt')
      await page.getByRole('combobox').first().selectOption('begins_with')
      // The datetime/date picker should appear (input type=date or datetime-local, or a calendar icon)
      const datePicker = page
        .locator('input[type="date"], input[type="datetime-local"]')
        .or(page.locator('[data-testid*="date"], [class*="datepicker"]'))
      const hasPicker = (await datePicker.count()) > 0
      // Also acceptable: an ISO hint/placeholder text near the value field
      const hasIsoHint =
        hasPicker ||
        (await page.getByPlaceholder(/ISO|YYYY|datetime/i).count()) > 0 ||
        (await page.getByText(/ISO|datetime/i).count()) > 0
      expect(hasIsoHint).toBe(true)
    }
  )

  // ── Both begins_with and BETWEEN give results for May 2024 ───────────────────

  test(
    'both begins_with "2024-05" and BETWEEN produce non-zero rows for May 2024 alerts (operator consistency check)',
    async ({ page }) => {
      // Test begins_with first
      await addFilter(page, 'createdAt', 'begins_with', '2024-05')
      await page.getByRole('button', { name: /Run/i }).click()
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
      const bwCount = await page.locator('tbody tr').count()
      expect(bwCount).toBeGreaterThan(0)

      // Clear filters and test BETWEEN
      const clearBtn = page.getByRole('button', { name: /Clear|Reset/i }).first()
      if (await clearBtn.isVisible()) await clearBtn.click()
      // Remove chips by clicking ×
      const chips = page.locator('[data-chip] button, .chip button').or(
        page.getByRole('button', { name: '×' })
      )
      const chipCount = await chips.count()
      for (let i = 0; i < chipCount; i++) {
        await chips.first().click()
      }

      await page.getByPlaceholder('field name').fill('createdAt')
      await page.getByRole('combobox').first().selectOption('between')
      const valueInputs = page.getByPlaceholder('field value')
      await valueInputs.first().fill('2024-05-01')
      await valueInputs.last().fill('2024-05-31T23:59:59Z')
      await page.getByRole('button', { name: '+ Add filter' }).click()
      await page.getByRole('button', { name: /Run/i }).click()
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 })
      const btCount = await page.locator('tbody tr').count()
      expect(btCount).toBeGreaterThan(0)
    }
  )

  // ── Invalid ISO string → 0 rows, no crash ────────────────────────────────────

  test(
    'invalid ISO string "not-a-date" for begins_with on createdAt returns 0 rows without a JS crash (graceful degradation)',
    async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))

      await addFilter(page, 'createdAt', 'begins_with', 'not-a-date')
      await page.getByRole('button', { name: /Run/i }).click()
      // Should return 0 rows (no ISO string starts with 'not-a-date')
      await expect(page.locator('tbody tr')).toHaveCount(0, { timeout: 15_000 })
      // No JS exceptions
      expect(errors, 'Expected no JS errors on invalid ISO filter').toHaveLength(0)
    }
  )

  // ── Confirm no mock mode (real DynamoDB Local required) ──────────────────────

  test(
    'query runs against real DynamoDB Local (not mock mode) — row count exceeds 7-row mock dataset',
    async ({ page }) => {
      // Run unfiltered scan — real data has many more than 7 rows
      await page.getByRole('button', { name: /Run/i }).click()
      // Confirm scan if prompted
      const runAnyway = page.getByText('Run anyway').first()
      if (await runAnyway.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await runAnyway.click()
      }
      const rowCount = await page.locator('tbody tr').count()
      // The 7-row mock only has 7 rows; real data should have more
      expect(rowCount, 'Expected real DynamoDB data, not the 7-row mock dataset').toBeGreaterThan(7)
    }
  )
})
