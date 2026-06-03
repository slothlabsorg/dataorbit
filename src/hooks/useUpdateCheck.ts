import { useState, useEffect } from 'react'

export interface AppUpdate {
  version: string
  body?: string
  isPreview?: boolean        // true when injected via URL param (testing/demo)
  install: () => Promise<void>
  dismiss: () => void        // snooze — remind again after SNOOZE_DAYS
  dismissForever: () => void // don't show for this version again
}

// How many days to wait before re-showing after "Later"
const SNOOZE_DAYS = 7
// During early releases, show an update nudge even without a new version
// if the user has snoozed but N days have passed
const EARLY_RELEASE_NUDGE_DAYS = 14

const LS_DISMISSED_VERSION = 'dataorbit.update.dismissed_version'
const LS_SNOOZED_AT        = 'dataorbit.update.snoozed_at'

function shouldSnoozeExpired(): boolean {
  try {
    const at = localStorage.getItem(LS_SNOOZED_AT)
    if (!at) return true
    const msSince = Date.now() - Number(at)
    return msSince > SNOOZE_DAYS * 86_400_000
  } catch { return true }
}

function isDismissedForever(version: string): boolean {
  try {
    return localStorage.getItem(LS_DISMISSED_VERSION) === version
  } catch { return false }
}

function recordSnooze() {
  try { localStorage.setItem(LS_SNOOZED_AT, String(Date.now())) } catch { /* ok */ }
}

function recordDismissForever(version: string) {
  try {
    localStorage.setItem(LS_DISMISSED_VERSION, version)
    localStorage.setItem(LS_SNOOZED_AT, String(Date.now()))
  } catch { /* ok */ }
}

// ── Preview injection via URL params ──────────────────────────────────────────
//
// Add ?preview_update=1.2.0&preview_body=What+is+new to any page to force
// the modal to appear. Used by Playwright tests and manual QA demos.

function getPreviewUpdate(): { version: string; body: string } | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const version = params.get('preview_update')
    if (!version) return null
    const body = params.get('preview_body') ?? 'Preview release — testing update modal.\n\n• New features\n• Bug fixes\n• Performance improvements'
    return { version, body }
  } catch { return null }
}

export function useUpdateCheck(): { update: AppUpdate | null; installing: boolean } {
  const [update, setUpdate]         = useState<AppUpdate | null>(null)
  const [installing, setInstalling] = useState(false)

  function makeUpdate(version: string, body: string | undefined, isPreview: boolean, doInstall: () => Promise<void>): AppUpdate {
    return {
      version,
      body,
      isPreview,
      dismiss: () => {
        recordSnooze()
        setUpdate(null)
      },
      dismissForever: () => {
        recordDismissForever(version)
        setUpdate(null)
      },
      install: async () => {
        setInstalling(true)
        try { await doInstall() } finally { setInstalling(false) }
      },
    }
  }

  useEffect(() => {
    let cancelled = false

    async function run() {
      // 1. Preview mode — URL param overrides everything
      const preview = getPreviewUpdate()
      if (preview) {
        setUpdate(makeUpdate(preview.version, preview.body, true, async () => {
          // In preview mode, simulate a short install delay
          await new Promise(r => setTimeout(r, 1500))
        }))
        return
      }

      // 2. Real updater check
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const result = await check()
        if (cancelled) return

        if (result) {
          const version = result.version
          const body    = result.body ?? undefined
          // Skip if user permanently dismissed this version
          if (isDismissedForever(version)) return
          // Skip if snoozed and snooze hasn't expired yet
          if (!shouldSnoozeExpired()) return

          setUpdate(makeUpdate(version, body, false, async () => {
            await result.downloadAndInstall()
            const { relaunch } = await import('@tauri-apps/plugin-process')
            await relaunch()
          }))
        } else {
          // No new version — but during early releases, nudge periodically
          // if it's been more than EARLY_RELEASE_NUDGE_DAYS since last snooze
          const snoozedAt = localStorage.getItem(LS_SNOOZED_AT)
          if (snoozedAt) {
            const daysSince = (Date.now() - Number(snoozedAt)) / 86_400_000
            if (daysSince > EARLY_RELEASE_NUDGE_DAYS) {
              // Show an "early release" nudge with the current version
              const currentVersion = '1.0.0'
              if (!isDismissedForever(currentVersion)) {
                setUpdate(makeUpdate(
                  currentVersion,
                  `DataOrbit is in active development. Check for updates to get the latest features, bug fixes, and improvements.\n\nThis is an early release — your feedback shapes what we build next.`,
                  false,
                  async () => { window.open('https://github.com/slothlabsorg/dataorbit/releases', '_blank') }
                ))
              }
            }
          } else {
            // First time — record snooze so we track future checks
            recordSnooze()
          }
        }
      } catch {
        // Updater not configured or no network — silent
      }
    }

    run()
    return () => { cancelled = true }
  }, [])

  return { update, installing }
}
