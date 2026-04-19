# DataOrbit — Dev Setup

## Prerequisites

- **Node.js** 18+ (`brew install node` or [nvm](https://github.com/nvm-sh/nvm))
- **Rust** (via rustup — do NOT use Homebrew's Rust)
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  source "$HOME/.cargo/env"
  ```
- **Tauri CLI** (installed automatically via npm)

### macOS only
```bash
xcode-select --install
```

---

## Install dependencies

```bash
cd dataorbit
npm install
```

---

## Run in dev mode

```bash
npm run tauri dev
```

This starts Vite on port **1421** and opens a native window with hot-reload.

### If port 1421 is already in use:
```bash
lsof -ti :1421 | xargs kill -9
npm run tauri dev
```

### Preview in browser (no Tauri, mock data):
```bash
npm run dev
# Open http://localhost:1421/?mock=1
```

URL params:
- `?mock=1` — load mock connections and data
- `?screen=browse` — open directly on a specific screen

---

## Build

```bash
npm run build          # Frontend only (dist/)
npm run tauri build    # Full native bundle (src-tauri/target/release/bundle/)
```

---

## TypeScript check

```bash
npx tsc --noEmit
```

---

## Rust (backend)

Commands run from `src-tauri/`:

```bash
cd src-tauri
cargo check          # type-check
cargo clippy         # lint
cargo build          # debug build
cargo build --release
```

---

## Project structure

```
dataorbit/
├── src/
│   ├── components/
│   │   ├── layout/     # Shell, Sidebar, Titlebar, StatusBar
│   │   └── ui/         # Button, Modal, Toggle, Badge, JsonTree, …
│   ├── screens/        # Home, Browse, Explore, Stream, QueryHistory, Settings, Docs, Support
│   ├── lib/            # tauri.ts (API), time.ts (formatters)
│   ├── mock/           # Mock data for browser preview
│   ├── types/          # TypeScript types
│   └── styles/
│       └── globals.css
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   └── commands/
│   │       ├── connections.rs  # Save/load connections to disk
│   │       └── dynamo.rs       # DynamoDB queries
│   ├── Cargo.toml
│   └── tauri.conf.json
├── public/
│   └── images/
│       ├── slothy-dataorbit.png
│       └── dataorbit-icon.png
└── tailwind.config.ts  # Purple/violet theme tokens
```
