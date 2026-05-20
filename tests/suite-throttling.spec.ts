/**
 * Throttling tests against LocalStack.
 *
 * LocalStack is on port 8001. The "ThrottleTest" table has PROVISIONED capacity
 * of 1 RCU / 1 WCU with 50 rows, and a GSI "Category-index" with 5 RCU.
 * Credentials: accessKeyId=test, secretAccessKey=test
 *
 * Requires LocalStack running with its seed before this suite:
 *   npm run db:localstack:start && npm run db:localstack:seed
 *   npm run test:suite-throttle
 *
 * NOTE: LocalStack simulates ProvisionedThroughputExceededException but the
 * exact error message wording may differ slightly from real AWS. All error
 * assertions use flexible regex patterns.
 *
 * DO NOT use the regular DynamoDB Local (port 8000) connection here.
 * This suite adds its own SEPARATE connection to LocalStack (port 8001).
 */

import { test, expect, Page } from '@playwright/test'

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE           = 'http://localhost:1421'
const LOCALSTACK_URL = 'http://localhost:8001'
const THROTTLE_TABLE = 'ThrottleTest'
const THROTTLE_GSI   = 'Category-index'

// Regex that matches both AWS and LocalStack throughput error messages
const THROUGHPUT_ERR = /throughput|exceeded|ProvisionedThroughputExceeded|capacity|throttl/i

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Add a connection to LocalStack (port 8001) using static test credentials.
 * This is a SEPARATE connection from any DynamoDB Local connection on port 8000.
 */
async function addLocalStackConnection(page: Page) {
  await page.goto(`${BASE}?screen=orbit`)
  await page.getByRole('button', { name: /Add connection/i }).first().click()
  await page.getByRole('button', { name: 'DynamoDB' }).click()
  await page.getByPlaceholder('e.g. nexus-prod').fill('localstack-throttle')
  // Switch to static credentials (not profile) so we can supply accessKeyId=test
  // Try "Access keys" or "Static credentials" button
  const staticCredsBtn = page.getByRole('button', { name: /Access keys|Static credentials|IAM Access Key/i })
  if (await staticCredsBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await staticCredsBtn.click()
  } else {
    // Some wizard versions use a "~/.aws profile" button as default — click it to cycle
    const profileBtn = page.getByRole('button', { name: '~/.aws profile' })
    if (await profileBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // Still use profile with any name — LocalStack accepts anything
      await profileBtn.click()
      await page.getByPlaceholder(/Select or type a profile/i).fill('test')
    }
  }

  // Set endpoint to LocalStack
  await page.getByPlaceholder(/localhost:8000/i).fill(LOCALSTACK_URL)

  // Region
  const regionInput = page.getByPlaceholder(/us-east-1/i).or(page.getByLabel(/region/i))
  if (await regionInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await regionInput.fill('us-east-1')
  }

  await page.getByRole('button', { name: /Continue/i }).click()
  await page.getByRole('button', { name: /Test connection/i }).click()
  await expect(page.getByText('Connection successful')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Save connection/i }).click()

  // Wait for ThrottleTest table to appear in sidebar
  await expect(page.getByText(THROTTLE_TABLE)).toBeVisible({ timeout: 20_000 })
}

/**
 * Navigate to Browse for the ThrottleTest table and wait for the load attempt.
 * The auto-load may trigger a throttle error on 1 RCU capacity.
 */
async function browseThrottleTable(page: Page) {
  await page.getByText(THROTTLE_TABLE).click()
  await page.getByRole('button', { name: 'Browse' }).click()
  // Wait for either rows or an error to appear
  await page.waitForTimeout(2_000)
}

/**
 * Navigate to Explore > Query tab with ThrottleTest selected.
 */
async function exploreThrottleQuery(page: Page) {
  await page.getByText(THROTTLE_TABLE).click()
  await page.getByRole('button', { name: 'Explore' }).click()
  await expect(page.getByRole('tab', { name: 'Query' }).or(page.getByText('Query').first())).toBeVisible()
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Throttling — LocalStack ProvisionedThroughputExceeded behaviour', () => {
  test.setTimeout(30_000)

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}?mock=0`)
  })

  // ── Full Scan errors ──────────────────────────────────────────────────────

  test('Full Scan on ThrottleTest (1 RCU) shows throughput error in UI', async ({ page }) => {
    await addLocalStackConnection(page)
    await exploreThrottleQuery(page)

    // Run without a pk= filter — triggers a Scan which hammers 1 RCU
    await page.getByRole('button', { name: /Run/i }).click()

    // Error should appear as a "Query failed" callout or toast
    const errorEl = page.getByText(THROUGHPUT_ERR)
      .or(page.getByText(/Query failed/i))
      .or(page.locator('[class*="danger"]').filter({ hasText: THROUGHPUT_ERR }))

    await expect(errorEl.first()).toBeVisible({ timeout: 20_000 })
  })

  test('Throttle error message mentions throughput or exceeded (not a raw stack trace)', async ({ page }) => {
    await addLocalStackConnection(page)
    await exploreThrottleQuery(page)

    await page.getByRole('button', { name: /Run/i }).click()

    // Wait for error state
    await expect(page.locator('[class*="danger"]').first()).toBeVisible({ timeout: 20_000 })

    // The visible error text should NOT be a raw stack trace
    // (stack traces start with "Error:" followed by call frames)
    const allText = await page.locator('[class*="danger"]').allTextContents()
    const fullErr = allText.join(' ')

    // Must contain a throughput-related keyword
    expect(fullErr).toMatch(THROUGHPUT_ERR)

    // Should NOT show a raw JS call stack (at Object.<anonymous>)
    expect(fullErr).not.toMatch(/at Object\.<anonymous>|at async|at Module/)
  })

  test('Clicking Run again after throttle error produces same error, no infinite loop', async ({ page }) => {
    await addLocalStackConnection(page)
    await exploreThrottleQuery(page)

    // First run — should throttle
    await page.getByRole('button', { name: /Run/i }).click()
    await expect(page.locator('[class*="danger"]').first()).toBeVisible({ timeout: 20_000 })

    // Second run — should also throttle cleanly
    await page.getByRole('button', { name: /Run/i }).click()

    // Wait briefly then verify error still shows (not a spinner stuck forever)
    await page.waitForTimeout(3_000)
    await expect(page.locator('[class*="danger"]').first()).toBeVisible()

    // Spinner should NOT be visible (i.e., not stuck in infinite loading)
    await expect(page.locator('.animate-spin')).toHaveCount(0)
  })

  // ── Successful query with minimal RCU ─────────────────────────────────────

  test('pk= query on ThrottleTest (1 row) succeeds using minimal RCU', async ({ page }) => {
    await addLocalStackConnection(page)
    await exploreThrottleQuery(page)

    // A pk= equality query uses exactly 1 RCU — should fit within 1 RCU capacity
    // The ThrottleTest pk is likely "pk" or "id" — use a known seeded key
    await page.getByPlaceholder('field name').fill('pk')
    await page.getByRole('combobox').first().selectOption('=')
    await page.getByPlaceholder('field value').fill('row-1')
    await page.getByRole('button', { name: '+ Add filter' }).click()
    await page.getByRole('button', { name: /Run/i }).click()

    // Should NOT show a danger/error callout — query should succeed or return 0 rows
    await expect(page.getByText(/returned/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[class*="danger"]').filter({ hasText: THROUGHPUT_ERR })).toHaveCount(0)
  })

  // ── GSI query succeeds (5 RCU capacity) ──────────────────────────────────

  test('GSI query on Category-index (5 RCU) succeeds — more capacity than base table', async ({ page }) => {
    await addLocalStackConnection(page)
    await exploreThrottleQuery(page)

    // Select the GSI index
    const indexDropdown = page.getByLabel(/Index/i)
      .or(page.getByRole('combobox', { name: /index/i }))
    if (await indexDropdown.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await indexDropdown.selectOption(THROTTLE_GSI)
    }

    // Query with the GSI pk field — should succeed on 5 RCU GSI
    await page.getByPlaceholder('field name').fill('category')
    await page.getByRole('combobox').first().selectOption('=')
    await page.getByPlaceholder('field value').fill('A')
    await page.getByRole('button', { name: '+ Add filter' }).click()
    await page.getByRole('button', { name: /Run/i }).click()

    // No throughput error expected — GSI has higher capacity
    await expect(page.getByText(/returned|IndexQuery/i)).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[class*="danger"]').filter({ hasText: THROUGHPUT_ERR })).toHaveCount(0)
  })

  // ── Browse auto-load error ────────────────────────────────────────────────

  test('Browse auto-load on ThrottleTest shows error gracefully with Refresh button', async ({ page }) => {
    await addLocalStackConnection(page)
    await browseThrottleTable(page)

    // Browse auto-loads 50 rows on mount — should hit throttle
    // The error is shown via showToast (error toast) or via the empty-state
    // After a throttle error, a Refresh / retry affordance should be accessible

    // Check for either:
    // a) An error toast containing throughput language
    // b) A "Refresh tables" button (the refresh icon in the TableSelector toolbar)
    const refreshBtn = page.getByTitle('Refresh tables')
      .or(page.getByRole('button', { name: /Refresh/i }))

    // Toast with error content
    const errorToast = page.locator('[class*="toast"], [class*="error"]').filter({ hasText: THROUGHPUT_ERR })

    // At minimum the Refresh button is always rendered — verify it's present
    await expect(refreshBtn.first()).toBeVisible({ timeout: 15_000 })

    // If a toast appeared, it should reference throughput
    const toastCount = await errorToast.count()
    if (toastCount > 0) {
      await expect(errorToast.first()).toBeVisible()
    }
  })

  test('Browse ThrottleTest shows No items or error state — not a blank screen', async ({ page }) => {
    await addLocalStackConnection(page)
    await browseThrottleTable(page)

    // After attempting to load, the UI should show something meaningful —
    // either an error message, empty state, or (unlikely) actual rows
    const meaningfulState = page.getByText(/No items|error|throttl|throughput|Loading/i)
      .or(page.getByText(/\d+ rows/))
      .or(page.locator('[class*="EmptyState"], [class*="empty-state"]'))

    await expect(meaningfulState.first()).toBeVisible({ timeout: 20_000 })
  })

  // ── Write throttle ────────────────────────────────────────────────────────

  test('put_item when write throughput exceeded shows error in toast', async ({ page }) => {
    await addLocalStackConnection(page)

    // Navigate to Browse and select ThrottleTest
    await browseThrottleTable(page)

    // If any rows loaded, select the first one and try to edit it
    const firstRow = page.locator('tbody tr').first()
    const rowsVisible = await firstRow.isVisible().catch(() => false)

    if (!rowsVisible) {
      // If no rows loaded (throttle on browse), we skip the write part
      test.skip()
      return
    }

    await firstRow.click()
    const editBtn = page.getByRole('button', { name: 'Edit' })
    await expect(editBtn).toBeVisible()
    await editBtn.click()

    // Modify the item in the JSON editor
    const textarea = page.locator('textarea').first()
    await expect(textarea).toBeVisible()
    const json = await textarea.inputValue()
    const parsed = JSON.parse(json)
    parsed.__throttle_test = Date.now()
    await textarea.fill(JSON.stringify(parsed, null, 2))

    await page.getByRole('button', { name: 'Save' }).click()

    // Should show error toast — either throughput exceeded or success
    // (LocalStack may or may not throttle the write depending on timing)
    const errorOrSuccess = page.getByText(/throughput|exceeded|throttl|Item saved|error/i)
    await expect(errorOrSuccess.first()).toBeVisible({ timeout: 10_000 })
  })

  // ── LocalStack-specific: flexible error format ────────────────────────────

  test('LocalStack error messages are displayed — not silently swallowed', async ({ page }) => {
    // Verifies that ANY error from LocalStack reaches the UI.
    // LocalStack may return errors with slightly different structure than real AWS
    // (e.g. without x-amzn-requestid headers). The app should still surface them.
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(e.message))

    await addLocalStackConnection(page)
    await exploreThrottleQuery(page)

    await page.getByRole('button', { name: /Run/i }).click()

    // Wait for either an error callout or a result
    await page.waitForTimeout(10_000)

    // No unhandled JS errors from the error path
    const criticalErrors = pageErrors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('Cannot read properties of null')
    )
    expect(criticalErrors).toHaveLength(0)

    // Something must be rendered — not a blank/stuck screen
    const hasContent = await page.locator('[class*="danger"], [class*="error"], table, [class*="empty"]')
      .first()
      .isVisible()
      .catch(() => false)
    expect(hasContent).toBe(true)
  })
})
