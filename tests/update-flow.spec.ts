/**
 * DataOrbit — Update flow E2E suite
 * Run: npx playwright test --project=update-flow
 */
import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const OUT = path.resolve(__dirname, '../screenshots')

async function snap(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false })
  console.log(`  ✓  ${name}.png`)
}

async function openWithUpdater(page: Page, extra = '') {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/?mock=1&updater=1${extra}`)
  await page.waitForSelector('text=Update Available', { timeout: 8000 })
  await page.waitForTimeout(300)
}

test.describe('UpdaterModal', () => {
  test('01 — modal appears on startup', async ({ page }) => {
    await openWithUpdater(page)
    await expect(page.getByText('Update Available', { exact: true })).toBeVisible()
    await expect(page.getByText(/ready to install/i)).toBeVisible()
    await snap(page, 'upd-01-modal-appears')
  })

  test('02 — changelog section visible', async ({ page }) => {
    await openWithUpdater(page)
    await expect(page.getByText(/what.s new/i).first()).toBeVisible()
    const body = await page.locator('body').innerText()
    expect(body.toLowerCase()).toMatch(/dynamo|table|connect|query|browse/)
    await snap(page, 'upd-02-changelog-visible')
  })

  test('03 — Later dismisses modal', async ({ page }) => {
    await openWithUpdater(page)
    await page.getByText('Later', { exact: true }).click()
    await page.waitForTimeout(400)
    await expect(page.getByText('Update Available', { exact: true })).not.toBeVisible()
    await snap(page, 'upd-03-modal-dismissed')
  })

  test('04 — bell dot visible after dismiss', async ({ page }) => {
    await openWithUpdater(page, '&news=1')
    await page.getByText('Later', { exact: true }).click()
    await page.waitForTimeout(500)
    await expect(page.locator('[data-testid="news-bell-dot"]')).toBeVisible()
    await snap(page, 'upd-04-bell-dot')
  })

  test('05 — bell dropdown shows Update item after dismiss', async ({ page }) => {
    await openWithUpdater(page, '&news=1')
    await page.getByText('Later', { exact: true }).click()
    await page.waitForTimeout(500)
    await page.locator('[data-testid="news-bell"]').click()
    await page.waitForTimeout(300)
    await expect(page.locator('[data-testid="news-dropdown"]')).toBeVisible()
    await expect(page.locator('[data-testid="news-item-update-available"]')).toBeVisible()
    await snap(page, 'upd-05-bell-update-item')
  })

  test('06 — clicking Update item reopens modal', async ({ page }) => {
    await openWithUpdater(page, '&news=1')
    await page.getByText('Later', { exact: true }).click()
    await page.waitForTimeout(500)
    await page.locator('[data-testid="news-bell"]').click()
    await page.waitForTimeout(300)
    await page.locator('[data-testid="news-item-update-available"]').click()
    await page.waitForTimeout(400)
    await expect(page.getByText('Update Available', { exact: true })).toBeVisible()
    await snap(page, 'upd-06-modal-reopened')
  })

  test('07 — bell with news only (no pending update)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/?mock=1&news=1')
    await page.waitForSelector('.text-text-primary', { timeout: 8000 })
    await page.waitForTimeout(500)
    await expect(page.locator('[data-testid="news-bell"]')).toBeVisible()
    await page.locator('[data-testid="news-bell"]').click()
    await page.waitForTimeout(300)
    await expect(page.locator('[data-testid="news-dropdown"]')).toBeVisible()
    await snap(page, 'upd-07-bell-news-only')
  })
})

test('10 — full update flow', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/?mock=1&updater=1&news=1')
  await page.waitForSelector('text=Update Available', { timeout: 8000 })
  await page.waitForTimeout(300)

  await expect(page.getByText('Update Available')).toBeVisible()
  await snap(page, 'upd-10a-modal')

  await page.getByText('Later', { exact: true }).click()
  await page.waitForTimeout(500)
  await expect(page.getByText('Update Available')).not.toBeVisible()
  await snap(page, 'upd-10b-dismissed')

  await expect(page.locator('[data-testid="news-bell-dot"]')).toBeVisible()
  await snap(page, 'upd-10c-bell-dot')

  await page.locator('[data-testid="news-bell"]').click()
  await page.waitForTimeout(300)
  await expect(page.locator('[data-testid="news-item-update-available"]')).toBeVisible()
  await snap(page, 'upd-10d-bell-open')

  await page.locator('[data-testid="news-item-update-available"]').click()
  await page.waitForTimeout(400)
  await expect(page.getByText('Update Available')).toBeVisible()
  await snap(page, 'upd-10e-reopened')
})
