/**
 * DataOrbit — Visual Snapshot Suite
 *
 * Captures every screen + key interaction state with mock data.
 * Run: npm run screenshots
 * View: open screenshots/  (PNG files)
 */
import { test, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

// ── helpers ──────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const OUT = path.resolve(__dirname, '../screenshots')
const BASE = '/?mock=1'

function url(screen: string, extra = '') {
  return `${BASE}&screen=${screen}${extra}`
}

async function goto(page: Page, screen: string, extra = '') {
  await page.goto(url(screen, extra))
  await page.waitForSelector('[data-testid="app-ready"], .text-text-primary', { timeout: 8000 })
  await page.waitForTimeout(400)
}

async function snap(page: Page, name: string) {
  const filePath = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: filePath, fullPage: false })
  console.log(`  ✓  ${name}.png`)
}

/** Fill the filter builder and click "+ Add filter" */
async function addFilter(
  page: Page,
  field: string,
  op: string,
  value = '',
  value2 = '',
) {
  const fieldInput = page.locator('input[placeholder="deviceId"]').first()
  await fieldInput.fill(field)
  // nth(1) — the Limit select is first (nth 0), operator select is second (nth 1)
  const opSelect = page.locator('select').nth(1)
  await opSelect.selectOption(op)
  await page.waitForTimeout(80)
  if (op !== 'exists' && op !== 'not_exists') {
    const valInput = page.locator('input[placeholder="sensor-4421"]').first()
    await valInput.fill(value)
  }
  if (op === 'between' && value2) {
    const endInput = page.locator('input[placeholder="end"]').first()
    await endInput.fill(value2)
  }
  await page.locator('button').filter({ hasText: /\+ Add filter/ }).first().click()
  await page.waitForTimeout(150)
}

async function runQuery(page: Page) {
  await page.locator('button').filter({ hasText: /▶ Run/ }).first().click()
  await page.waitForTimeout(500)
}

// Ensure output dir exists
test.beforeAll(() => {
  fs.mkdirSync(OUT, { recursive: true })
  console.log(`\n📸  Screenshots → ${OUT}\n`)
})

// ── Home screen ───────────────────────────────────────────────────────────────

test('home — default with connections', async ({ page }) => {
  await goto(page, 'home')
  await snap(page, '01-home-default')
})

test('home — sidebar collapsed', async ({ page }) => {
  await goto(page, 'home')
  const toggle = page.locator('[data-testid="sidebar-collapse"], button[title*="collapse" i], button[aria-label*="collapse" i]').first()
  if (await toggle.count() > 0) {
    await toggle.click()
    await page.waitForTimeout(350)
  }
  await snap(page, '02-home-sidebar-collapsed')
})

// ── Browse screen ─────────────────────────────────────────────────────────────

test('browse — table grid view', async ({ page }) => {
  await goto(page, 'browse')
  await snap(page, '03-browse-grid')
})

test('browse — table JSON view', async ({ page }) => {
  await goto(page, 'browse')
  // Button text is lowercase 'json'
  const jsonBtn = page.getByText('json', { exact: true }).first()
  if (await jsonBtn.count() > 0) {
    await jsonBtn.click()
    await page.waitForTimeout(300)
  }
  await snap(page, '04-browse-json')
})

test('browse — row detail panel open', async ({ page }) => {
  await goto(page, 'browse')
  const rows = page.locator('table tbody tr, [data-row]')
  if (await rows.count() > 0) {
    await rows.first().click()
    await page.waitForTimeout(400)
  }
  await snap(page, '05-browse-row-detail')
})

test('browse — table meta bar (pk/sk info)', async ({ page }) => {
  await goto(page, 'browse')
  await snap(page, '06-browse-meta-bar')
})

// ── Explore screen — basic states ─────────────────────────────────────────────

test('explore — empty filter builder', async ({ page }) => {
  await goto(page, 'explore')
  await snap(page, '07-explore-empty')
})

test('explore — filter chip added', async ({ page }) => {
  await goto(page, 'explore')
  const fieldInput = page.locator('input[placeholder="deviceId"]').first()
  if (await fieldInput.count() > 0) {
    await fieldInput.fill('deviceId')
    await page.waitForTimeout(100)
    const addFilter = page.locator('button').filter({ hasText: /Add filter/i }).first()
    if (await addFilter.count() > 0) {
      await addFilter.click()
      await page.waitForTimeout(300)
    }
  }
  await snap(page, '08-explore-filter-added')
})

test('explore — scan warning visible (no pk filter)', async ({ page }) => {
  await goto(page, 'explore')
  // Add a non-pk filter so the scan warning callout appears
  await addFilter(page, 'status', '=', 'WARN')
  await snap(page, '09-explore-scan-warning')
})

test('explore — cost estimator (scan mode — high RCU)', async ({ page }) => {
  await goto(page, 'explore')
  // No PK filter → Scan mode → red RCU badge visible before running
  await snap(page, '10-explore-cost-scan-mode')
})

// ── Explore screen — query operator showcase ──────────────────────────────────

test('explore — pk = query: deviceId = sensor-4421 (2 results)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'deviceId', '=', 'sensor-4421')
  await runQuery(page)
  await snap(page, '11-explore-pk-equals')
})

test('explore — battery <= 20 (low battery sensors: 0012 + 9900)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'battery', '<=', '20')
  await runQuery(page)
  await snap(page, '12-explore-battery-lte')
})

test('explore — status in WARN,CRIT (2 results)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'status', 'in', 'WARN,CRIT')
  await runQuery(page)
  await snap(page, '13-explore-status-in')
})

test('explore — deviceId begins_with sensor (Scan — all results)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'deviceId', 'begins_with', 'sensor')
  await runQuery(page)
  await snap(page, '14-explore-begins-with-scan')
})

test('explore — firmware contains v2.1 (FilterExpression warning)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'firmware', 'contains', 'v2.1')
  await runQuery(page)
  await snap(page, '15-explore-contains-filter-expr')
})

test('explore — battery exists (shows all rows with battery field)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'battery', 'exists')
  await runQuery(page)
  await snap(page, '16-explore-exists')
})

test('explore — temp > 30 (WARN/CRIT sensors)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'temp', '>', '30')
  await runQuery(page)
  await snap(page, '17-explore-gt-filter')
})

test('explore — pk= query + sort DESC', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'deviceId', '=', 'sensor-4421')
  // Toggle sort to DESC
  const sortBtn = page.locator('button').filter({ hasText: /ASC|DESC/ }).first()
  if (await sortBtn.count() > 0) {
    await sortBtn.click()
    await page.waitForTimeout(100)
  }
  await runQuery(page)
  await snap(page, '18-explore-pk-sort-desc')
})

test('explore — time preset Last 1h (auto between chip on timestamp)', async ({ page }) => {
  await goto(page, 'explore')
  // Add PK filter first, then apply time preset
  await addFilter(page, 'deviceId', '=', 'sensor-4421')
  const presetBtn = page.getByText('Last 1h').first()
  if (await presetBtn.count() > 0) {
    await presetBtn.click()
    await page.waitForTimeout(150)
  }
  await runQuery(page)
  await snap(page, '19-explore-time-preset-1h')
})

test('explore — time preset Last 24h (all sensors in range)', async ({ page }) => {
  await goto(page, 'explore')
  const presetBtn = page.getByText('Last 24h').first()
  if (await presetBtn.count() > 0) {
    await presetBtn.click()
    await page.waitForTimeout(150)
  }
  await runQuery(page)
  await snap(page, '20-explore-time-preset-24h')
})

test('explore — no results (firmware = v9.0.0)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'deviceId', '=', 'sensor-4421')
  await addFilter(page, 'firmware', '=', 'v9.0.0')
  await runQuery(page)
  await snap(page, '21-explore-no-results')
})

test('explore — != operator (status != OK shows WARN + CRIT)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'status', '!=', 'OK')
  await runQuery(page)
  await snap(page, '21b-explore-neq')
})

test('explore — not_exists operator (field absent)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'firmware', 'not_exists')
  await runQuery(page)
  await snap(page, '21c-explore-not-exists')
})

test('explore — between explicit values (temp between 20 and 25)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'temp', 'between', '20', '25')
  await runQuery(page)
  await snap(page, '21d-explore-between-explicit')
})

test('explore — multi-chip: pk= AND status=OK (combined filters)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'deviceId', '=', 'sensor-4421')
  await addFilter(page, 'status', '=', 'OK')
  await runQuery(page)
  await snap(page, '21e-explore-multi-chip')
})

test('explore — scan confirmation dialog (large table without pk filter)', async ({ page }) => {
  await goto(page, 'explore')
  await addFilter(page, 'status', '=', 'WARN')
  // Clicking Run on Scan mode (no pk=) should show confirmation, not results
  await page.locator('button').filter({ hasText: /▶ Run/ }).first().click()
  await page.waitForTimeout(400)
  await snap(page, '21f-explore-scan-confirm')
})

// ── Stream screen ──────────────────────────────────────────────────────────────

test('stream — idle (not started)', async ({ page }) => {
  await goto(page, 'stream')
  await snap(page, '22-stream-idle')
})

test('stream — live: all events list', async ({ page }) => {
  await goto(page, 'stream')
  const startBtn = page.getByText(/Start stream/i).first()
  if (await startBtn.count() > 0) {
    await startBtn.click()
    await page.waitForTimeout(700)
  }
  await snap(page, '23-stream-live-all')
})

test('stream — MODIFY event detail panel (diff view)', async ({ page }) => {
  await goto(page, 'stream')
  const startBtn = page.getByText(/Start stream/i).first()
  if (await startBtn.count() > 0) {
    await startBtn.click()
    await page.waitForTimeout(600)
    // Filter to MODIFY events to isolate the event with diff data
    const modifyBtn = page.getByText('MODIFY', { exact: true }).first()
    if (await modifyBtn.count() > 0) {
      await modifyBtn.click()
      await page.waitForTimeout(250)
    }
    // Click the MODIFY event row to open the detail panel
    const eventRow = page.locator('[class*="cursor-pointer"][class*="border-b"]').first()
    if (await eventRow.count() > 0) {
      await eventRow.click()
      await page.waitForTimeout(400)
    }
  }
  await snap(page, '24-stream-modify-detail')
})

test('stream — REMOVE events filtered', async ({ page }) => {
  await goto(page, 'stream')
  const startBtn = page.getByText(/Start stream/i).first()
  if (await startBtn.count() > 0) {
    await startBtn.click()
    await page.waitForTimeout(600)
    // Filter to REMOVE events
    const removeBtn = page.getByText('REMOVE', { exact: true }).first()
    if (await removeBtn.count() > 0) {
      await removeBtn.click()
      await page.waitForTimeout(250)
    }
  }
  await snap(page, '25-stream-remove-filter')
})

// ── Query History screen ───────────────────────────────────────────────────────

test('history — full list', async ({ page }) => {
  await goto(page, 'history')
  await snap(page, '26-history-list')
})

test('history — search filtered', async ({ page }) => {
  await goto(page, 'history')
  const input = page.locator('input[placeholder*="Search" i]').first()
  if (await input.count() > 0) {
    await input.fill('sensor')
    await page.waitForTimeout(200)
  }
  await snap(page, '27-history-search')
})

test('history — row hover (run again visible)', async ({ page }) => {
  await goto(page, 'history')
  const rows = page.locator('[class*="cursor-pointer"][class*="rounded"]')
  if (await rows.count() > 0) {
    await rows.first().hover()
    await page.waitForTimeout(200)
  }
  await snap(page, '28-history-row-hover')
})

// ── Settings / Docs / Support ──────────────────────────────────────────────────

test('settings — default view', async ({ page }) => {
  await goto(page, 'settings')
  await snap(page, '29-settings')
})

test('docs — default', async ({ page }) => {
  await goto(page, 'docs')
  await snap(page, '30-docs')
})

test('support — default', async ({ page }) => {
  await goto(page, 'support')
  await snap(page, '31-support')
})

// ── Add Connection Wizard ──────────────────────────────────────────────────────

test('wizard — step 1: DB type picker', async ({ page }) => {
  await goto(page, 'home')
  const addBtn = page.getByText(/Add Connection/i).first()
  if (await addBtn.count() > 0) {
    await addBtn.click()
    await page.waitForTimeout(350)
  }
  await snap(page, '32-wizard-step1-type')
})

test('wizard — step 2: DynamoDB config', async ({ page }) => {
  await goto(page, 'home')
  const addBtn = page.getByText(/Add Connection/i).first()
  if (await addBtn.count() > 0) {
    await addBtn.click()
    await page.waitForTimeout(400)
    const modalPanel = page.locator('[class*="rounded-2xl"][class*="bg-bg-elevated"]').first()
    const dynamoBtn = modalPanel.locator('button').filter({ hasText: /DynamoDB/ }).first()
    if (await dynamoBtn.count() > 0) {
      await dynamoBtn.click()
      await page.waitForTimeout(350)
    }
  }
  await snap(page, '33-wizard-step2-config')
})

test('wizard — step 3: test connection', async ({ page }) => {
  await goto(page, 'home')
  const addBtn = page.getByText(/Add Connection/i).first()
  if (await addBtn.count() > 0) {
    await addBtn.click()
    await page.waitForTimeout(400)
    const modalPanel = page.locator('[class*="rounded-2xl"][class*="bg-bg-elevated"]').first()
    const dynamoBtn = modalPanel.locator('button').filter({ hasText: /DynamoDB/ }).first()
    if (await dynamoBtn.count() > 0) {
      await dynamoBtn.click()
      await page.waitForTimeout(350)
    }
    const nameInput = modalPanel.locator('input').first()
    if (await nameInput.count() > 0) {
      await nameInput.fill('nexus-prod')
      await page.waitForTimeout(100)
    }
    const continueBtn = modalPanel.locator('button').filter({ hasText: /Continue/ }).first()
    if (await continueBtn.count() > 0) {
      await continueBtn.click()
      await page.waitForTimeout(350)
    }
  }
  await snap(page, '34-wizard-step3-test')
})

// ── Time Trace scenarios ───────────────────────────────────────────────────────

test('explore — time trace: empty state with suggestions', async ({ page }) => {
  await goto(page, 'explore')
  const traceTab = page.getByText('Time Trace').first()
  if (await traceTab.count() > 0) {
    await traceTab.click()
    await page.waitForTimeout(300)
  }
  await snap(page, '35a-trace-empty')
})

test('explore — time trace: sensor-0012 (WARN with missing alert + registry)', async ({ page }) => {
  await goto(page, 'explore')
  const traceTab = page.getByText('Time Trace').first()
  if (await traceTab.count() > 0) {
    await traceTab.click()
    await page.waitForTimeout(300)
    const valueInput = page.locator('input[placeholder="sensor-0012"]').first()
    if (await valueInput.count() > 0) {
      await valueInput.fill('sensor-0012')
      await page.waitForTimeout(100)
    }
    const traceBtn = page.locator('button').filter({ hasText: /⏱ Trace|Trace/ }).first()
    if (await traceBtn.count() > 0) {
      await traceBtn.click()
      await page.waitForTimeout(600)
    }
  }
  await snap(page, '35b-trace-sensor-0012-missing-alert')
})

test('explore — time trace: sensor-4421 (healthy full lifecycle)', async ({ page }) => {
  await goto(page, 'explore')
  const traceTab = page.getByText('Time Trace').first()
  if (await traceTab.count() > 0) {
    await traceTab.click()
    await page.waitForTimeout(300)
    const valueInput = page.locator('input[placeholder="sensor-0012"]').first()
    if (await valueInput.count() > 0) {
      await valueInput.fill('sensor-4421')
      await page.waitForTimeout(100)
    }
    const traceBtn = page.locator('button').filter({ hasText: /⏱ Trace|Trace/ }).first()
    if (await traceBtn.count() > 0) {
      await traceBtn.click()
      await page.waitForTimeout(600)
    }
  }
  await snap(page, '35c-trace-sensor-4421-healthy')
})

test('explore — time trace: expanded event card (full row fields)', async ({ page }) => {
  await goto(page, 'explore')
  const traceTab = page.getByText('Time Trace').first()
  if (await traceTab.count() > 0) {
    await traceTab.click()
    await page.waitForTimeout(300)
    const valueInput = page.locator('input[placeholder="sensor-0012"]').first()
    if (await valueInput.count() > 0) {
      await valueInput.fill('sensor-4421')
    }
    const traceBtn = page.locator('button').filter({ hasText: /⏱ Trace|Trace/ }).first()
    if (await traceBtn.count() > 0) {
      await traceBtn.click()
      await page.waitForTimeout(600)
      // Click first event card to expand it
      const firstCard = page.locator('button[class*="rounded-xl"][class*="border"]').first()
      if (await firstCard.count() > 0) {
        await firstCard.click()
        await page.waitForTimeout(300)
      }
    }
  }
  await snap(page, '35d-trace-expanded-card')
})

// ── Cross-table join scenarios ─────────────────────────────────────────────────

test('explore — cross-join LEFT ANTI: DeviceMessages vs SensorAlerts (sensor-0012 missing)', async ({ page }) => {
  await goto(page, 'explore')
  // Switch to Cross-join tab
  const joinTab = page.getByText('Cross-join').first()
  if (await joinTab.count() > 0) {
    await joinTab.click()
    await page.waitForTimeout(350)
  }
  // Defaults: left=DeviceMessages, right=SensorAlerts, join=LEFT ANTI
  // Just run to reveal sensor-0012 missing from SensorAlerts
  const runBtn = page.locator('button').filter({ hasText: /Run join/ }).first()
  if (await runBtn.count() > 0) {
    await runBtn.click()
    await page.waitForTimeout(600)
  }
  await snap(page, '36-explore-join-left-anti-missing-alert')
})

test('explore — cross-join INNER: DeviceMessages ∩ SensorAlerts (matched rows only)', async ({ page }) => {
  await goto(page, 'explore')
  const joinTab = page.getByText('Cross-join').first()
  if (await joinTab.count() > 0) {
    await joinTab.click()
    await page.waitForTimeout(350)
  }
  // Switch to INNER join
  const innerBtn = page.getByText('INNER', { exact: true }).first()
  if (await innerBtn.count() > 0) {
    await innerBtn.click()
    await page.waitForTimeout(150)
  }
  const runBtn = page.locator('button').filter({ hasText: /Run join/ }).first()
  if (await runBtn.count() > 0) {
    await runBtn.click()
    await page.waitForTimeout(600)
  }
  await snap(page, '37-explore-join-inner')
})

test('explore — cross-join LEFT: DeviceMessages left-join DeviceRegistry (unregistered devices)', async ({ page }) => {
  await goto(page, 'explore')
  const joinTab = page.getByText('Cross-join').first()
  if (await joinTab.count() > 0) {
    await joinTab.click()
    await page.waitForTimeout(350)
  }
  // Change right table to DeviceRegistry
  const rightSelect = page.locator('select').nth(1)
  if (await rightSelect.count() > 0) {
    await rightSelect.selectOption('DeviceRegistry')
    await page.waitForTimeout(100)
  }
  // Switch to LEFT join
  const leftBtn = page.locator('button').filter({ hasText: /^LEFT$/ }).first()
  if (await leftBtn.count() > 0) {
    await leftBtn.click()
    await page.waitForTimeout(150)
  }
  const runBtn = page.locator('button').filter({ hasText: /Run join/ }).first()
  if (await runBtn.count() > 0) {
    await runBtn.click()
    await page.waitForTimeout(600)
  }
  await snap(page, '38-explore-join-left-unregistered')
})

// ── Window size variations ────────────────────────────────────────────────────

test('browse — 1400×900 (larger display)', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await goto(page, 'browse')
  await snap(page, '39-browse-1400x900')
})

test('browse — 800×600 (minimum window)', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await goto(page, 'browse')
  await snap(page, '40-browse-minimum-window')
})

// ── Composite: all screens ────────────────────────────────────────────────────

test('composite — all 8 screens', async ({ page }) => {
  const screens: [string, string][] = [
    ['home',    '41a-composite-home'],
    ['browse',  '41b-composite-browse'],
    ['explore', '41c-composite-explore'],
    ['stream',  '41d-composite-stream'],
    ['history', '41e-composite-history'],
    ['settings','41f-composite-settings'],
    ['docs',    '41g-composite-docs'],
    ['support', '41h-composite-support'],
  ]
  for (const [screen, filename] of screens) {
    await page.goto(url(screen))
    await page.waitForTimeout(500)
    await snap(page, filename)
  }
})
