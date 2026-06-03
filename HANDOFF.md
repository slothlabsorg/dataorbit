# DataOrbit — Handoff Checklist

Manual items that need to be done by hand on whichever machine picks this up
next. Code work continues normally; the items below cannot be automated by an
agent because they involve Apple keys, secrets, or out-of-band testing.

Status as of last push:
- Launch date: **Monday June 15, 2026** (one week after CloudOrbit + WattsOrbit)
- Site countdown: see slothlabs.org `/next/dataorbit/` permalink
- Same Apple signing + Tauri updater setup as the rest of the Orbit suite

---

## 1. Apple Developer — must be done by hand

The Apple Developer membership is purchased. The signing pipeline still needs
the certs and secrets wired up before a notarized DMG can ship. None of this
can be done by a Claude Code agent — it requires you to be logged in on
developer.apple.com and on the Mac with the certificate.

### One-time Apple setup
- [ ] developer.apple.com → Certificates → create a **Developer ID Application**
      certificate. Download the `.cer`, double-click to install in Keychain.
- [ ] Keychain Access → My Certificates → expand the Developer ID certificate →
      right-click the private key → Export → `.p12` with a strong password.
      **Save the password** — it becomes `APPLE_CERTIFICATE_PASSWORD`.
- [ ] Base64 the .p12: `base64 -i Certificates.p12 -o Certificates.b64.txt`
- [ ] appleid.apple.com → Sign-in and Security → **App-Specific Passwords** →
      generate one (label it "dataorbit-notarize"). This is `APPLE_PASSWORD`.
- [ ] developer.apple.com → Membership → record the **Team ID** (10-char
      string). This is `APPLE_TEAM_ID`.
- [ ] Confirm the **signing identity** string with
      `security find-identity -v -p codesigning` (looks like
      `"Developer ID Application: Your Name (TEAMID)"`). This is
      `APPLE_SIGNING_IDENTITY`.

> If you've already done the cert work for CloudOrbit / WattsOrbit, the same
> Developer ID cert and Team ID are reused — only the **app-specific password**
> needs to be regenerated per app (or you can reuse one across apps as long
> as you don't revoke it).

### GitHub repo secrets to add (Settings → Secrets and variables → Actions)
- [ ] `APPLE_CERTIFICATE` — contents of `Certificates.b64.txt`
- [ ] `APPLE_CERTIFICATE_PASSWORD` — the .p12 export password
- [ ] `APPLE_SIGNING_IDENTITY` — the `Developer ID Application: …` string
- [ ] `APPLE_ID` — your Apple ID email
- [ ] `APPLE_PASSWORD` — the app-specific password
- [ ] `APPLE_TEAM_ID` — 10-char team id
- [ ] `RELEASE_TOKEN` — fine-grained PAT, Contents:Write on this repo only
      (used by `update-manifest.yml` to push `latest.json` back to main —
      same pattern as wattsorbit / cloudorbit)

### Tauri updater key (separate from Apple)
- [ ] `npx tauri signer generate -w ~/.tauri/dataorbit.key` (set a password)
- [ ] Copy the printed **public** key into `src-tauri/tauri.conf.json` →
      `plugins.updater.pubkey` (replace any placeholder)
- [ ] `TAURI_PRIVATE_KEY` secret = contents of `~/.tauri/dataorbit.key`
- [ ] `TAURI_KEY_PASSWORD` secret = the password you set

### Release flow source-of-truth
- `.github/workflows/release.yml` has the APPLE_* envs commented out near the
  build step. Uncomment them once the secrets exist.
- `tauri.conf.json` → `bundle.macOS.signingIdentity` is `null` today; flip to
  `"-"` for ad-hoc or to the `Developer ID Application: …` string for prod
  signing once the cert is in Keychain on the runner.

### First end-to-end notarized release
- [ ] Tag `v0.1.0` (or whatever the next semver is) and push the tag.
- [ ] Watch the Actions run — should produce a signed + notarized DMG.
- [ ] Pull the DMG to a clean Mac (or `xattr -d com.apple.quarantine`-test
      after download from a browser) and confirm Gatekeeper opens it without
      "unidentified developer" warning.
- [ ] `update-manifest.yml` should auto-fire and commit `latest.json`.
- [ ] Confirm `latest.json` URL responds with 200 and the right signature.

---

## 2. News feature — manual test plan

The News screen + NewsBell + UpdaterModal pattern is the same across all
Orbit apps. Run through this on the next machine when the dev build is up.

- [ ] `npm run tauri dev` opens the app cleanly (no Rust panics in the term)
- [ ] Sidebar shows the **News** entry; clicking it loads articles with
      markdown rendered (bold, lists, links) — pull-to-refresh works
- [ ] **NewsBell in the title bar / tray**: red unread dot appears when there
      is an unseen news item; clicking opens the dropdown
- [ ] Dropdown items show the right tone (primary/success/neutral) — colours
      come from `badgeTone` in the JSON feed
- [ ] Clicking a news item opens its detail or external link
- [ ] After the dropdown is opened, the unread dot clears and stays cleared
      across app restarts (persisted state)
- [ ] News feed URL points at production: `https://slothlabs.org/news/feed.json`
      with the `dataorbit` filter applied
- [ ] Network failure path: kill internet, refresh — graceful error state, not
      a blank screen

---

## 3. Updater feature — manual test plan

- [ ] **Cold start with current version**: no banner, no modal, no dot
- [ ] **Cold start with latest.json forced to a higher version**:
      `UpdaterModal` pops up automatically on first foreground
- [ ] Modal shows changelog rendered as markdown, "Install & Restart" button,
      and a Dismiss action
- [ ] **Dismiss**: modal closes, NewsBell shows an "Update available" item
      with the same version/changelog
- [ ] Reopening the modal from the bell shows the same content
- [ ] **Install & Restart**: the download progress bar progresses to 100%,
      then the app relaunches and reports the new version
- [ ] Signature verification: edit `latest.json` to point at a different
      `.tar.gz` than the signature was generated for → updater MUST refuse
      with a clear error, not crash silently

---

## 4. Other DataOrbit-specific items

- [ ] **DynamoDB live streaming**: connect to `nexus-prod` mock + a real
      AWS profile, run a streamed query, confirm rows append in real time
      and `Stop` halts the stream cleanly.
- [ ] **Cross-table joins**: open Explore → Cross-join tab. Run each of the
      five join types (inner / left / left-anti / right / right-anti) on
      two mock tables and confirm row counts match expectations. The
      LEFT-ANTI flow is the killer feature — verify it surfaces missing
      rows from the right table correctly.
- [ ] **Query history**: run 3 queries, restart the app, confirm history
      persisted with timestamps and re-run-from-history works.
- [ ] **AddConnectionWizard auto-advance**: click any DB type card on step
      1 → must auto-advance to step 2. Step 2 Continue stays disabled until
      the connection name field is non-empty.
- [ ] **CouchDB + time-series adapters**: smoke-test that adding a
      non-DynamoDB connection still completes without crashing the wizard.
- [ ] **EmptyState animation**: with no connections, confirm the upward
      float animation doesn't get clipped (the `pt-2` fix on the motion
      div should still hold).
- [ ] **Profile switcher**: switching AWS profiles in the connection panel
      re-authenticates against the new profile and updates the table list.
- [ ] `screenshots/` directory was just refreshed — verify they all render
      at 1400×900 and update the marketing site if any layout changed.

---

## 5. Pre-flight before tagging v0.1.0

- [ ] `cargo test` from `src-tauri/` is green (16 unit tests in
      `commands/dynamo.rs`)
- [ ] `npm run build` (frontend) succeeds with no TS errors
- [ ] Playwright screenshot suite passes 26/26 (wizard tests scoped to the
      modal selector)
- [ ] `npm run tauri build` produces a working `.app` and `.dmg` locally
- [ ] All Apple secrets confirmed in GitHub
- [ ] `update-manifest.yml` dry-run test (push a pre-release tag first)
- [ ] News feed shows the launch announcement at the top of the bell

When everything above is green, tag `v0.1.0` and let the CI ship it.
