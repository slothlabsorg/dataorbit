# Contributing to DataOrbit

Thanks for helping build DataOrbit! This guide gets you from zero to a running dev environment.

---

## Prerequisites

### Rust
Install via rustup — do **not** use Homebrew's Rust:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

### Node.js
Either via Homebrew or nvm:
```bash
brew install node
# or
nvm install --lts && nvm use --lts
```

### macOS system deps
```bash
xcode-select --install
```

---

## Fork & clone

```bash
gh repo fork slothlabs/dataorbit --clone
cd dataorbit
npm install
```

---

## Run locally

```bash
npm run tauri dev
```

To preview in browser with mock data (no Rust needed):
```bash
npm run dev
# http://localhost:1421/?mock=1
```

---

## Making changes

### Frontend (React/TypeScript)
- Components in `src/components/`
- Screens in `src/screens/`
- Color tokens in `tailwind.config.ts` — the palette is purple/violet
- Type-check before submitting: `npx tsc --noEmit`

### Backend (Rust)
Run commands from `src-tauri/`:
```bash
cd src-tauri
cargo check
cargo clippy -- -D warnings
```

---

## Pull request checklist

- [ ] `npx tsc --noEmit` passes (zero errors)
- [ ] `cargo check` passes in `src-tauri/`
- [ ] UI tested in browser preview (`?mock=1`) and ideally in `tauri dev`
- [ ] No new console errors or warnings

---

## Code style

- TypeScript: strict mode, no unused locals/params
- React: functional components, hooks only
- Tailwind: use design tokens from `tailwind.config.ts`, not raw hex values
- Rust: `cargo clippy` clean

---

## Adding a new database type

1. Add the type to `DbType` in `src/types/index.ts`
2. Add color/label entries in `src/components/ui/Badge.tsx` (`DbTypeBadge`)
3. Add a card in `AddConnectionWizard.tsx` with `available: false` until ready
4. Create `src-tauri/src/commands/<dbtype>.rs` with query/list commands
5. Register the commands in `src-tauri/src/main.rs`
6. Update the roadmap in `README.md`
