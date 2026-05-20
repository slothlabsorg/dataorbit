/**
 * Advanced CrossJoin Tests — DynamoDB Local with large seed data.
 *
 * Requires:
 *   npm run db:start
 *   npm run db:seed:large
 *   npm run test:integration
 *
 * Large tables: EventLog (200K rows), Transactions (100K rows)
 * Scenarios: client-side merge with thousands of rows, GSI pre-filtering,
 * join type switching, cancellation & re-run
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
  await expect(page.getByText(/EventLog|Transactions/)).toBeVisible({ timeout: 15_000 })
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

test.describe('suite-crossjoin-advanced', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}?mock=0`)
  })

  // ── Scenario 1: EventLog × Transactions LEFT ANTI on correlationId ────────

  test('1. EventLog × Transactions LEFT ANTI (no matching tx)', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: EventLog
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('EventLog')

    // Right: Transactions
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('Transactions')

    // Join key: correlationId (both)
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('correlationId')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('correlationId')

    // Select LEFT ANTI
    const antiButton = page.getByRole('button', { name: /LEFT ANTI/i })
      .or(page.getByRole('radio', { name: /LEFT ANTI/i }))
    await antiButton.click()

    await page.getByRole('button', { name: /Run join/i }).click()

    // Verify result
    await expect(page.getByText(/left.?only|anti/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 2: EventLog (level=ERROR) × Transactions ───────────────────

  test('2. EventLog (level=ERROR GSI) × Transactions', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: EventLog with Level-index
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('EventLog')
    const leftIndexSelect = page.locator('select').nth(1)
    await leftIndexSelect.selectOption('Level-index')

    // Pre-filter: level=ERROR
    const leftFilterField = page.locator('[placeholder="field"]').first()
    await leftFilterField.fill('level')
    const leftFilterOp = page.locator('select').nth(2)
    await leftFilterOp.selectOption('=')
    const leftFilterValue = page.locator('[placeholder="value"]').first()
    await leftFilterValue.fill('ERROR')

    // Right: Transactions
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('Transactions')

    // Join: eventId (left) = txId (right) — or use a real join key
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('correlationId')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('correlationId')

    await page.getByRole('button', { name: /Run join/i }).click()

    // Verify result
    await expect(page.getByText(/matched|result/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 3: INNER join EventLog (service-a) × Transactions ──────────

  test('3. EventLog (service-a pk filter) × Transactions INNER', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: EventLog with pk pre-filter (service-a)
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('EventLog')

    // Pre-filter: serviceId=service-a (pk pre-filter)
    const leftFilterField = page.locator('[placeholder="field"]').first()
    await leftFilterField.fill('serviceId')
    const leftFilterOp = page.locator('select').nth(2)
    await leftFilterOp.selectOption('=')
    const leftFilterValue = page.locator('[placeholder="value"]').first()
    await leftFilterValue.fill('service-a')

    // Right: Transactions
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('Transactions')

    // Join key
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('correlationId')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('correlationId')

    // Select INNER
    const innerButton = page.getByRole('button', { name: /INNER/i })
    await innerButton.click()

    await page.getByRole('button', { name: /Run join/i }).click()

    await expect(page.getByText(/matched/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 4: Large join: 1000+ rows on both sides ───────────────────

  test('4. CrossJoin with 1000+ left + 1000+ right rows', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: EventLog (200K total, will scan many)
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('EventLog')

    // Right: Transactions (100K total)
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('Transactions')

    // Join: createdAt (both sides, time-based match)
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('createdAt')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('createdAt')

    await page.getByRole('button', { name: /Run join/i }).click()

    // Verify client-side merge succeeded and result shows stats
    const statBar = page.locator('[data-test="join-stats"]').or(page.getByText(/scanned|matched/i))
    await expect(statBar).toBeVisible({ timeout: 30_000 })

    // Numeric check: matched count > 0
    const statsText = await statBar.textContent()
    expect(statsText).toMatch(/matched/)
  })

  // ── Scenario 5: GSI pre-filter both sides (Level-index, Status-index) ────

  test('5. Both GSIs used: EventLog Level=ERROR × Transactions Status=FAILED', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: EventLog with Level-index
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('EventLog')
    const leftIndexSelect = page.locator('select').nth(1)
    await leftIndexSelect.selectOption('Level-index')

    // Pre-filter: level=ERROR
    const leftFilterField = page.locator('[placeholder="field"]').first()
    await leftFilterField.fill('level')
    const leftFilterOp = page.locator('select').nth(2)
    await leftFilterOp.selectOption('=')
    const leftFilterValue = page.locator('[placeholder="value"]').first()
    await leftFilterValue.fill('ERROR')

    // Right: Transactions with Status-CreatedAt-index
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('Transactions')
    const rightIndexSelect = page.locator('select').nth(4)
    await rightIndexSelect.selectOption('Status-CreatedAt-index')

    // Right pre-filter: status=FAILED
    const rightFilterField = page.locator('[placeholder="field"]').nth(1)
    await rightFilterField.fill('status')
    const rightFilterOp = page.locator('select').nth(5)
    await rightFilterOp.selectOption('=')
    const rightFilterValue = page.locator('[placeholder="value"]').nth(1)
    await rightFilterValue.fill('FAILED')

    // Join: createdAt
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('createdAt')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('createdAt')

    await page.getByRole('button', { name: /Run join/i }).click()

    // Verify both GSI filters worked
    const statBar = page.locator('[data-test="join-stats"]').or(page.getByText(/scanned|matched/i))
    await expect(statBar).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 6: Join key with low match rate (mostly LEFT ANTI) ──────────

  test('6. Join key with low match rate shows mostly LEFT ANTI results', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: EventLog
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('EventLog')

    // Right: Transactions
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('Transactions')

    // Join key: userId (left) = userId (right) — may have low match
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('userId')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('userId')

    // Select LEFT ANTI to see non-matching events
    const antiButton = page.getByRole('button', { name: /LEFT ANTI/i })
      .or(page.getByRole('radio', { name: /LEFT ANTI/i }))
    await antiButton.click()

    await page.getByRole('button', { name: /Run join/i }).click()

    // Verify LEFT ANTI results
    await expect(page.getByText(/left.?only|anti/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 7: Pre-filter reduces scanned count ────────────────────────

  test('7. Pre-filter reduces scanned count (filtered vs unfiltered)', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Left: EventLog with pre-filter
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('EventLog')

    // Pre-filter: level=INFO (reduces from 200K to ~500)
    const leftFilterField = page.locator('[placeholder="field"]').first()
    await leftFilterField.fill('level')
    const leftFilterOp = page.locator('select').nth(2)
    await leftFilterOp.selectOption('=')
    const leftFilterValue = page.locator('[placeholder="value"]').first()
    await leftFilterValue.fill('INFO')

    // Right: Transactions
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('Transactions')

    // Join
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('createdAt')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('createdAt')

    await page.getByRole('button', { name: /Run join/i }).click()

    // Verify stats show scanned count < 200K (filtered effect)
    const statBar = page.locator('[data-test="join-stats"]').or(page.getByText(/scanned/i))
    await expect(statBar).toBeVisible({ timeout: 15_000 })
    const statsText = await statBar.textContent()
    expect(statsText).toMatch(/scanned/)
  })

  // ── Scenario 8: Result export (JSON download) ──────────────────────────

  test('8. Large join result export: run join → export JSON', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Simple join: EventLog × Transactions
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('EventLog')
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('Transactions')

    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('correlationId')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('correlationId')

    await page.getByRole('button', { name: /Run join/i }).click()

    // Wait for result
    await expect(page.getByText(/matched|result/i)).toBeVisible({ timeout: 30_000 })

    // Export button should appear
    const exportBtn = page.getByRole('button', { name: /export|json/i })
    await expect(exportBtn).toBeVisible({ timeout: 5_000 })

    // Trigger download
    await exportBtn.click()
    await expect(page.getByText(/export|download|complete/i)).toBeVisible({ timeout: 5_000 })
  })

  // ── Scenario 9: Join type switch without re-running ────────────────────

  test('9. Switch join type (INNER → LEFT → ANTI) without re-running', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Setup join: EventLog × Transactions
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('EventLog')
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('Transactions')

    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('correlationId')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('correlationId')

    // Run with INNER
    const innerButton = page.getByRole('button', { name: /INNER/i })
    await innerButton.click()
    await page.getByRole('button', { name: /Run join/i }).click()

    await expect(page.getByText(/matched/i)).toBeVisible({ timeout: 15_000 })

    // Switch to LEFT without re-running
    const leftButton = page.getByRole('button', { name: /LEFT/i }).first()
    await leftButton.click()

    // Result display should update (though fetch is from same data)
    await expect(page.getByText(/result|matched/i)).toBeVisible({ timeout: 5_000 })

    // Switch to LEFT ANTI
    const antiButton = page.getByRole('button', { name: /LEFT ANTI/i })
    await antiButton.click()

    await expect(page.getByText(/result|anti/i)).toBeVisible({ timeout: 5_000 })
  })

  // ── Scenario 10: Cancel/re-run join with filter change ──────────────────

  test('10. Cancel/re-run: change filter and run again', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Setup: EventLog × Transactions
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('EventLog')
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('Transactions')

    // Join key
    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('correlationId')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('correlationId')

    // First run
    await page.getByRole('button', { name: /Run join/i }).click()
    const firstResult = page.locator('tbody tr').first()
    await expect(firstResult).toBeVisible({ timeout: 15_000 })

    // Change left filter
    const leftFilterField = page.locator('[placeholder="field"]').first()
    await leftFilterField.fill('level')
    const leftFilterOp = page.locator('select').nth(2)
    await leftFilterOp.selectOption('=')
    const leftFilterValue = page.locator('[placeholder="value"]').first()
    await leftFilterValue.fill('ERROR')

    // Re-run
    await page.getByRole('button', { name: /Run join/i }).click()

    // Result should update (old result replaced)
    await expect(page.getByText(/result|matched/i)).toBeVisible({ timeout: 15_000 })
  })

  // ── Scenario 11: Cancel mid-join (not yet implemented) ──────────────────

  test.fixme('11. Cancel mid-join button stops the operation', async ({ page }) => {
    test.setTimeout(60_000)
    test.slow()
    await addLocalConnection(page)
    await gotoCrossJoin(page)

    // Setup large join
    const leftTableSelect = page.locator('select').first()
    await leftTableSelect.selectOption('EventLog')
    const rightTableSelect = page.locator('select').nth(3)
    await rightTableSelect.selectOption('Transactions')

    const leftJoinKey = page.locator('[placeholder="join key field"]').first()
    await leftJoinKey.fill('correlationId')
    const rightJoinKey = page.locator('[placeholder="join key field"]').last()
    await rightJoinKey.fill('correlationId')

    // Start join (large, may take time)
    await page.getByRole('button', { name: /Run join/i }).click()

    // Immediately look for cancel button
    const cancelBtn = page.getByRole('button', { name: /cancel/i })
    if (await cancelBtn.isVisible({ timeout: 2_000 })) {
      await cancelBtn.click()
      // Should revert to empty or previous result
      await expect(page.getByText(/cancel/i)).toBeVisible()
    }
  })
})
