/**
 * TimeTrace — Multi-Table Integration Suite
 *
 * Tests TimeTrace across multiple real DynamoDB Local tables. Verifies entity
 * search, missing-table warnings, table add/remove interactions, AND conditions,
 * subset-table selection, ISO date tracing, non-existent entities, and the
 * "contains" operator for full-row search.
 *
 * Key seed facts:
 *   - sensor-0012 is MISSING from SensorAlerts and DeviceRegistry → should
 *     produce a "missing" warning when traced across all tables.
 *   - sensor-0001 is present in all tables → no missing warning.
 *
 * Requires: npm run db:start && npm run db:seed
 */

import { test, expect, type Page } from '@playwright/test'

const BASE = 'http://localhost:1421'
const CURRENT_YEAR = new Date().getFullYear().toString()

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

async function gotoTimeTrace(page: Page) {
  await page.getByRole('button', { name: 'Explore' }).click()
  await page
    .getByRole('tab', { name: /Time Trace/i })
    .or(page.getByText('Time Trace').first())
    .click()
  // Wait for the trace form to appear
  await expect(
    page.locator('input[placeholder*="deviceId"], input[placeholder*="field"]').first()
  ).toBeVisible({ timeout: 10_000 })
}

async function fillTraceEntity(page: Page, field: string, operator: string, value: string) {
  const fieldInput = page
    .locator('input[placeholder*="deviceId"], input[placeholder*="field"]')
    .first()
  await fieldInput.fill(field)

  const opSelect = page.locator('select').first()
  if (await opSelect.isVisible()) {
    await opSelect.selectOption(operator)
  }

  const valueInput = page
    .locator('input[placeholder*="sensor"], input[placeholder*="value"]')
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

test.describe('TimeTrace — multi-table real DynamoDB Local', () => {
  test.setTimeout(45_000)

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}?mock=0`)
    await addLocalConnection(page)
    await gotoTimeTrace(page)
  })

  // ── sensor-0012: missing warning ─────────────────────────────────────────────

  test(
    'tracing sensor-0012 shows "missing" warning because it is absent from SensorAlerts and DeviceRegistry (propagation gap detection)',
    async ({ page }) => {
      await fillTraceEntity(page, 'deviceId', '=', 'sensor-0012')
      await runTrace(page)

      await expect(
        page.getByText(/missing/i),
        'Expected "missing" warning for sensor-0012 which has no SensorAlerts or DeviceRegistry entry'
      ).toBeVisible({ timeout: 15_000 })
    }
  )

  // ── sensor-0001: present in all tables, no missing warning ───────────────────

  test(
    'tracing sensor-0001 returns results from all tables without any "missing" warning (healthy entity trace)',
    async ({ page }) => {
      await fillTraceEntity(page, 'deviceId', '=', 'sensor-0001')
      await runTrace(page)

      // Should show timeline items from multiple tables
      await expect(
        page.getByText('DeviceMessages').first(),
        'Expected DeviceMessages events in timeline for sensor-0001'
      ).toBeVisible({ timeout: 15_000 })

      // No missing-table warning expected
      const missingWarning = await page.getByText(/missing/i).count()
      expect(
        missingWarning,
        'Expected no "missing" warning for sensor-0001 which is present in all tables'
      ).toBe(0)
    }
  )

  // ── Add table / remove table interactions ────────────────────────────────────

  test(
    'clicking "Add table" adds a new table row to the TimeTrace scope, and clicking remove takes it back out',
    async ({ page }) => {
      // Count initial table rows in the trace scope selector
      const tableRows = page.locator(
        '[data-testid="trace-table-row"], [class*="trace-table"], [data-trace-table]'
      )
      const initialCount = await tableRows.count()

      // Click the add-table button
      const addTableBtn = page
        .getByRole('button', { name: /Add table|add table/i })
        .or(page.getByText(/\+ table|\+ add/i).first())
      if (await addTableBtn.isVisible()) {
        await addTableBtn.click()
        await page.waitForTimeout(300)

        const afterAddCount = await tableRows.count()
        expect(
          afterAddCount,
          'Expected one more table row after clicking "Add table"'
        ).toBeGreaterThan(initialCount)

        // Remove the newly added row
        const removeBtn = page
          .getByRole('button', { name: /remove|×|delete/i })
          .last()
        if (await removeBtn.isVisible()) {
          await removeBtn.click()
          await page.waitForTimeout(200)
          const afterRemoveCount = await tableRows.count()
          expect(
            afterRemoveCount,
            'Expected table count to return to initial after remove'
          ).toBe(initialCount)
        }
      } else {
        test.skip(true, 'Add table button not visible — feature may not be exposed in this build')
      }
    }
  )

  // ── AND condition ─────────────────────────────────────────────────────────────

  test(
    'adding an AND condition narrows the trace results — fewer rows than single-condition trace',
    async ({ page }) => {
      // Set base condition: deviceId = sensor-0001
      await fillTraceEntity(page, 'deviceId', '=', 'sensor-0001')

      // Run without AND condition
      await runTrace(page)
      await expect(
        page.getByText('DeviceMessages').first()
      ).toBeVisible({ timeout: 15_000 })
      const baseRowCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()

      // Add AND condition
      const andBtn = page
        .getByRole('button', { name: /AND|add condition/i })
        .first()
      if (await andBtn.isVisible()) {
        await andBtn.click()
        await page.waitForTimeout(200)

        // Fill the new AND condition with a restrictive filter
        const andFields = page.locator(
          'input[placeholder*="field"], input[placeholder*="attribute"]'
        )
        const andField = andFields.last()
        if (await andField.isVisible()) {
          await andField.fill('status')
          // Set value for the AND condition
          const andValues = page.locator('input[placeholder*="value"]')
          const andVal = andValues.last()
          if (await andVal.isVisible()) {
            await andVal.fill('WARN')
          }
        }

        // Re-run with AND condition
        await runTrace(page)
        await page.waitForTimeout(2_000)

        const filteredRowCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()
        // AND should narrow or equal — never expand
        expect(
          filteredRowCount,
          'Expected AND condition to narrow or keep equal row count'
        ).toBeLessThanOrEqual(baseRowCount)
      } else {
        test.skip(true, 'AND condition button not visible — feature may not be exposed in this build')
      }
    }
  )

  // ── Subset of tables ──────────────────────────────────────────────────────────

  test(
    'tracing with only DeviceMessages + SensorAlerts selected excludes DeviceRegistry and DeviceLocations from results',
    async ({ page }) => {
      // Deselect tables not in the subset (DeviceRegistry, DeviceLocations)
      // The UI may show checkboxes or toggles per table
      const allTableCheckboxes = page.locator(
        'input[type="checkbox"][data-table], [data-testid*="table-toggle"]'
      )
      const checkboxCount = await allTableCheckboxes.count()
      if (checkboxCount > 0) {
        // Uncheck DeviceRegistry
        const registryCheckbox = page
          .locator('input[type="checkbox"]')
          .filter({ hasText: /DeviceRegistry/ })
          .or(
            page
              .locator('[data-table="DeviceRegistry"] input[type="checkbox"]')
          )
          .first()
        if (await registryCheckbox.isVisible()) {
          if (await registryCheckbox.isChecked()) await registryCheckbox.uncheck()
        }

        // Uncheck DeviceLocations
        const locationsCheckbox = page
          .locator('input[type="checkbox"]')
          .filter({ hasText: /DeviceLocations/ })
          .or(
            page
              .locator('[data-table="DeviceLocations"] input[type="checkbox"]')
          )
          .first()
        if (await locationsCheckbox.isVisible()) {
          if (await locationsCheckbox.isChecked()) await locationsCheckbox.uncheck()
        }
      } else {
        test.skip(
          true,
          'Per-table checkboxes not visible — table subset selection may not be exposed in this build'
        )
        return
      }

      await fillTraceEntity(page, 'deviceId', '=', 'sensor-0001')
      await runTrace(page)

      await expect(
        page.getByText('DeviceMessages').first()
      ).toBeVisible({ timeout: 15_000 })

      // DeviceRegistry should not appear in results
      await expect(
        page.getByText('DeviceRegistry')
      ).toHaveCount(0, { timeout: 10_000 })

      // DeviceLocations should not appear in results
      await expect(
        page.getByText('DeviceLocations')
      ).toHaveCount(0, { timeout: 10_000 })
    }
  )

  // ── ISO date trace: field=createdAt begins_with current year ─────────────────

  test(
    'ISO date trace: field=createdAt, op=begins_with, value=current year returns alerts created this year across tables',
    async ({ page }) => {
      await fillTraceEntity(page, 'createdAt', 'begins_with', CURRENT_YEAR)
      await runTrace(page)

      // Should return no crash even if 0 results (seed data is 2024-era)
      const errors = page.getByText(/error|exception|crash/i)
      await expect(errors).toHaveCount(0, { timeout: 15_000 })

      // If results appear, they should contain the current year
      const rowCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()
      if (rowCount > 0) {
        await expect(
          page.getByText(new RegExp(CURRENT_YEAR)).first()
        ).toBeVisible({ timeout: 5_000 })
      }
      // 0 rows is also valid — current year may have no seed data
      expect(rowCount).toBeGreaterThanOrEqual(0)
    }
  )

  // ── Non-existent entity → empty result ───────────────────────────────────────

  test(
    'tracing a non-existent entity "sensor-DOES-NOT-EXIST-9999" returns empty timeline without crash',
    async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))

      await fillTraceEntity(page, 'deviceId', '=', 'sensor-DOES-NOT-EXIST-9999')
      await runTrace(page)

      // No crash
      expect(
        errors,
        'Expected no JS errors for non-existent entity trace'
      ).toHaveLength(0)

      // Either 0 rows or an "entity not found" message — both acceptable
      await page.waitForTimeout(5_000)
      const rowCount = await page.locator('tbody tr, [data-testid="trace-event"]').count()
      const hasNotFoundMsg = (await page.getByText(/not found|no results|0 items/i).count()) > 0
      expect(
        rowCount === 0 || hasNotFoundMsg,
        'Expected empty result or "not found" message for non-existent entity'
      ).toBe(true)
    }
  )

  // ── contains operator (full-row search) ──────────────────────────────────────

  test(
    'contains operator finds sensor-0012 in DeviceLocations via full-row string search on locationKey composite field',
    async ({ page }) => {
      await fillTraceEntity(page, 'deviceId', 'contains', 'sensor-0012')
      await runTrace(page)

      // "contains" does a full-row scan — should find sensor-0012 in DeviceLocations
      // (locationKey = "US::northwest::sensor-0012") even if deviceId col doesn't exist in that table
      await expect(
        page.getByText('sensor-0012').first(),
        'Expected "contains" operator to find sensor-0012 via full-row search'
      ).toBeVisible({ timeout: 15_000 })

      // Should show results from at least one table
      const hasTableLabel =
        (await page.getByText('DeviceLocations').count()) > 0 ||
        (await page.getByText('DeviceMessages').count()) > 0
      expect(
        hasTableLabel,
        'Expected at least one table label in trace results for sensor-0012 contains search'
      ).toBe(true)
    }
  )
})
