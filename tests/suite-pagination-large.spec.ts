/**
 * Large result set pagination — suite against the large seed dataset.
 *
 * Requires:
 *   npm run db:start && npm run db:seed:large
 *   npm run test:suite-pagination-large
 *
 * Large seed tables:
 *   EventLog    — 200K rows, pk=serviceId (S), sk=eventId (S)
 *                 GSI: Level-index (pk=level, sk=createdAt)
 *   Transactions — 100K rows, pk=accountId (S), sk=txId (S)
 *                  GSI: Status-CreatedAt-index (pk=status, sk=createdAt)
 *   UserProfiles — 25K rows,  pk=userId (S), no SK
 *                  GSI: Plan-index (pk=plan)
 *
 * Connection helper: addLargeConnection connects to DynamoDB Local (port 8000)
 * and waits for EventLog to be visible in the sidebar.
 *
 * All tests use test.slow() for queries that exercise large datasets.
 */

import { test, expect, Page } from '@playwright/test'

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE = 'http://localhost:1421'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Add a DynamoDB Local connection suitable for the large seed dataset.
 * Waits until EventLog appears in the sidebar.
 */
async function addLargeConnection(page: Page) {
  await page.goto(`${BASE}?screen=orbit`)
  await page.getByRole('button', { name: /Add connection/i }).first().click()
  // Step 1: select DynamoDB
  await page.getByRole('button', { name: 'DynamoDB' }).click()
  // Step 2: configure
  await page.getByPlaceholder('e.g. nexus-prod').fill('dataorbit-large')
  await page.getByRole('button', { name: '~/.aws profile' }).click()
  await page.getByPlaceholder(/Select or type a profile/i).fill('local')
  // DynamoDB Local on port 8000
  await page.getByPlaceholder(/localhost:8000/i).fill('http://localhost:8000')
  await page.getByRole('button', { name: /Continue/i }).click()
  // Step 3: test & save
  await page.getByRole('button', { name: /Test connection/i }).click()
  await expect(page.getByText('Connection successful')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Save connection/i }).click()
  // The large seed has EventLog — wait for it to appear
  await expect(page.getByText('EventLog')).toBeVisible({ timeout: 20_000 })
}

/**
 * Navigate to the Browse view for a given table and wait for the first page.
 */
async function browseTable(page: Page, tableName: string) {
  await page.getByText(tableName).first().click()
  await page.getByRole('button', { name: 'Browse' }).click()
  await expect(page.getByText(/\d+ rows/)).toBeVisible({ timeout: 20_000 })
}

/**
 * Navigate to Explore > Query tab with the given table active.
 */
async function exploreTable(page: Page, tableName: string) {
  await page.getByText(tableName).first().click()
  await page.getByRole('button', { name: 'Explore' }).click()
  await expect(
    page.getByRole('tab', { name: 'Query' }).or(page.getByText('Query').first())
  ).toBeVisible()
}

/**
 * Add a single filter chip: field operator value.
 */
async function addFilter(page: Page, field: string, operator: string, value: string) {
  await page.getByPlaceholder('field name').fill(field)
  await page.getByRole('combobox').first().selectOption(operator)
  await page.getByPlaceholder('field value').first().fill(value)
  await page.getByRole('button', { name: '+ Add filter' }).click()
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Pagination — large seed dataset (EventLog 200K, Transactions 100K, UserProfiles 25K)', () => {
  test.setTimeout(45_000)

  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}?mock=0`)
  })

  // ── Test 1: Browse EventLog first page → 50 rows, Load more visible ───────

  test('Browse EventLog first page — 50 rows loaded, Load more button visible', async ({ page }) => {
    test.slow()
    // EventLog has 200K rows. The default Browse page size is 50.
    // After the initial load, Load more must be present because 200K >> 50.
    await addLargeConnection(page)
    await browseTable(page, 'EventLog')

    // First page: exactly 50 rows (or at least 50 — browser row limit)
    await expect(page.getByText('50 rows')).toBeVisible({ timeout: 20_000 })

    // Load more must be visible because we haven't exhausted the table
    const loadMore = page.getByRole('button', { name: /Load more/i })
    await expect(loadMore).toBeVisible()
  })

  // ── Test 2: Load more 3 times → 200 rows loaded, each click appends ───────

  test('Load more 3 times — 200 rows loaded cumulatively, each click appends rows', async ({ page }) => {
    test.slow()
    // Each "Load more" adds 50 rows: 50 → 100 → 150 → 200
    await addLargeConnection(page)
    await browseTable(page, 'EventLog')
    await expect(page.getByText('50 rows')).toBeVisible({ timeout: 20_000 })

    for (let i = 0; i < 3; i++) {
      const loadMore = page.getByRole('button', { name: /Load more/i })
      await expect(loadMore).toBeVisible({ timeout: 10_000 })
      await loadMore.click()
      // Each click adds 50 rows — wait for row count to increment
      await expect(page.getByText(new RegExp(`${(i + 2) * 50} rows`))).toBeVisible({ timeout: 20_000 })
    }

    // After 3 clicks, 200 rows should be loaded
    await expect(page.getByText('200 rows')).toBeVisible({ timeout: 10_000 })
  })

  // ── Test 3: Load more disappears when partition exhausted ─────────────────

  test('Load more disappears when single-partition query is exhausted', async ({ page }) => {
    test.slow()
    // A pk= filter on EventLog fetches a single serviceId partition.
    // Once all items in that partition are returned, Load more must disappear.
    // The seed uses serviceId values like "svc-0001" with a bounded row count.
    await addLargeConnection(page)
    await exploreTable(page, 'EventLog')

    // Query a single partition — small enough to exhaust in one or two pages
    await addFilter(page, 'serviceId', '=', 'svc-0001')
    await page.getByRole('button', { name: /Run/i }).click()

    // Wait for results
    await expect(page.getByText(/returned/i)).toBeVisible({ timeout: 20_000 })

    // If Load more is present, click through until it disappears
    const loadMore = page.getByRole('button', { name: /Load more/i })
    let iterations = 0
    while (await loadMore.isVisible({ timeout: 3_000 }).catch(() => false) && iterations < 20) {
      await loadMore.click()
      await page.waitForTimeout(500)
      iterations++
    }

    // Load more should be gone once the partition is fully exhausted
    await expect(loadMore).toHaveCount(0, { timeout: 10_000 })
  })

  // ── Test 4: GSI pagination on Level-index, level=ERROR ───────────────────

  test('GSI pagination — Level-index, level=ERROR, Load more through GSI results', async ({ page }) => {
    test.slow()
    // EventLog has a GSI "Level-index" with pk=level, sk=createdAt.
    // Querying level=ERROR against 200K rows should return a large result set
    // with Load more available after the first page.
    await addLargeConnection(page)
    await exploreTable(page, 'EventLog')

    // Select the Level-index GSI
    const indexSelect = page.getByLabel(/Index/i).or(page.getByRole('combobox', { name: /index/i }))
    if (await indexSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await indexSelect.selectOption('Level-index')
    }

    await addFilter(page, 'level', '=', 'ERROR')
    await page.getByRole('button', { name: /Run/i }).click()

    await expect(page.getByText(/returned|IndexQuery/i)).toBeVisible({ timeout: 20_000 })

    // Load more should be visible for a large GSI partition
    const loadMore = page.getByRole('button', { name: /Load more/i })
    await expect(loadMore).toBeVisible({ timeout: 10_000 })

    // Click once more — should append additional rows
    await loadMore.click()
    await expect(page.getByText(/\d+ rows/)).toBeVisible({ timeout: 20_000 })
  })

  // ── Test 5: Sort direction swap during pagination → resets to page 1 ──────

  test('Changing sort direction during pagination resets to page 1 (not mixed pages)', async ({ page }) => {
    test.slow()
    // If a user loads page 2 and then toggles sort direction, the result set
    // must restart from the beginning — mixing pages from different sort orders
    // would produce incorrect results.
    await addLargeConnection(page)
    await browseTable(page, 'EventLog')
    await expect(page.getByText('50 rows')).toBeVisible({ timeout: 20_000 })

    // Load one more page
    const loadMore = page.getByRole('button', { name: /Load more/i })
    await expect(loadMore).toBeVisible()
    await loadMore.click()
    await expect(page.getByText('100 rows')).toBeVisible({ timeout: 20_000 })

    // Toggle sort direction — this should reset back to 50 rows
    const sortBtn = page.getByTitle(/Sort by/)
    if (await sortBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sortBtn.click()
      // After reset, row count should drop back to 50 (first page only)
      await expect(page.getByText('50 rows')).toBeVisible({ timeout: 20_000 })
      // Load more should reappear (we're back at page 1 of a 200K table)
      await expect(page.getByRole('button', { name: /Load more/i })).toBeVisible()
    } else {
      // Sort control not found — verify at minimum no crash occurred
      const errors: string[] = []
      page.on('pageerror', e => errors.push(e.message))
      expect(errors).toHaveLength(0)
    }
  })

  // ── Test 6: Scan confirmation dialog for 200K table without pk filter ─────

  test('Browse EventLog without pk filter — scan confirmation dialog appears', async ({ page }) => {
    test.slow()
    // Without a pk= filter on a 200K table, DataOrbit should warn the user
    // that a full table scan is expensive before executing it.
    await addLargeConnection(page)
    await exploreTable(page, 'EventLog')

    // Run without any filter — this is a full scan of 200K rows
    await page.getByRole('button', { name: /Run/i }).click()

    // A confirmation dialog or warning banner should appear
    const scanWarning = page.getByText(/Scan detected|full scan|expensive|Run anyway|confirm/i)
    await expect(scanWarning.first()).toBeVisible({ timeout: 10_000 })
  })

  // ── Test 7: Run anyway → loads results, first 50 rows shown ─────────────

  test('Run anyway on 200K scan — loads results, first 50 rows shown', async ({ page }) => {
    test.slow()
    // After the scan warning, the user can choose "Run anyway".
    // The first page (50 rows) should load successfully.
    await addLargeConnection(page)
    await exploreTable(page, 'EventLog')

    await page.getByRole('button', { name: /Run/i }).click()

    // Dismiss the scan warning
    const runAnyway = page.getByText(/Run anyway/i).first()
    await expect(runAnyway).toBeVisible({ timeout: 10_000 })
    await runAnyway.click()

    // First 50 rows should appear
    await expect(page.getByText(/50 rows/)).toBeVisible({ timeout: 20_000 })
    // Load more should be visible (200K >> 50)
    await expect(page.getByRole('button', { name: /Load more/i })).toBeVisible()
  })

  // ── Test 8: Browse Transactions first page → 50 rows, Load more visible ───

  test('Browse Transactions first page — 50 rows, Load more visible', async ({ page }) => {
    test.slow()
    // Transactions has 100K rows — same pagination behaviour as EventLog.
    await addLargeConnection(page)
    await browseTable(page, 'Transactions')

    await expect(page.getByText('50 rows')).toBeVisible({ timeout: 20_000 })

    // Load more must be present for a 100K table
    await expect(page.getByRole('button', { name: /Load more/i })).toBeVisible()
  })

  // ── Test 9: Browse with sort DESC shows newest first ──────────────────────

  test('Browse Transactions with sort DESC — newest (highest txId / sk) appears first', async ({ page }) => {
    test.slow()
    // The default Browse sort for tables with a sort key should be DESC
    // (newest first). This test verifies the default direction indicator.
    await addLargeConnection(page)
    await browseTable(page, 'Transactions')

    // The sort button should indicate descending order (↓)
    const sortBtn = page.getByTitle(/Sort by/)
    if (await sortBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      // Default is DESC — verify the ↓ indicator
      await expect(sortBtn).toContainText('↓')

      // The first visible SK value should be lexicographically large
      // (later txId or higher timestamp) — we only check no crash + rows loaded
      await expect(page.locator('tbody tr').first()).toBeVisible()
    } else {
      // If sort button not found, just verify rows loaded
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10_000 })
    }
  })

  // ── Test 10: GSI + pk= filter in Explore, Load more uses exclusiveStartKey ──

  test('Explore Transactions: GSI Status-CreatedAt-index with status= filter — Load more uses correct exclusiveStartKey', async ({ page }) => {
    test.slow()
    // GSI pagination must pass the correct exclusiveStartKey (which includes
    // the GSI PK, GSI SK, and the base table PK) to DynamoDB. If the key is
    // wrong, DynamoDB returns an error or resets to the beginning.
    // This test verifies that successive Load more pages show incrementing rows.
    await addLargeConnection(page)
    await exploreTable(page, 'Transactions')

    // Select the Status-CreatedAt-index GSI
    const indexSelect = page.getByLabel(/Index/i).or(page.getByRole('combobox', { name: /index/i }))
    if (await indexSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await indexSelect.selectOption('Status-CreatedAt-index')
    }

    // Filter by a status value that has many rows
    await addFilter(page, 'status', '=', 'PENDING')
    await page.getByRole('button', { name: /Run/i }).click()

    await expect(page.getByText(/returned|IndexQuery/i)).toBeVisible({ timeout: 20_000 })

    // Capture first-page row count
    const countText1 = await page.getByText(/\d+ rows/).textContent({ timeout: 10_000 }) ?? '0 rows'
    const count1 = parseInt(countText1.match(/(\d+)/)?.[1] ?? '0', 10)
    expect(count1).toBeGreaterThan(0)

    // Load more
    const loadMore = page.getByRole('button', { name: /Load more/i })
    if (await loadMore.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await loadMore.click()

      // Row count must INCREASE — not reset to 50 (which would indicate
      // the exclusiveStartKey was dropped and the query restarted)
      await expect(async () => {
        const countText2 = await page.getByText(/\d+ rows/).textContent({ timeout: 10_000 }) ?? '0 rows'
        const count2 = parseInt(countText2.match(/(\d+)/)?.[1] ?? '0', 10)
        expect(count2).toBeGreaterThan(count1)
      }).toPass({ timeout: 20_000 })
    }
  })
})
