# AIIA Development Guide

## Prerequisites
- Node.js 20+
- Rust stable (rustup)
- Ollama installed locally
- Windows 10/11

## Setup
```bash
cd AIIA
npm install
npm run build:packages
npm run tauri:dev
```

## Playwright browsers (first time)
```bash
npm run playwright:install
```

## Project layout
See `docs/project-context.md`

## Adding a Tauri command
1. Implement in `crates/aiia-core`
2. Expose in `apps/desktop/src-tauri/src/lib.rs`
3. Call from React via `@tauri-apps/api/core` invoke

## Running agent manually
```bash
node packages/agent-runner/dist/index.js --agent-id <uuid> --effort low
```

## Build release
```bash
npm run tauri:build
```
Output: `apps/desktop/src-tauri/target/release/bundle/msi/`

## Render landing
Deploy `landing/` as static site. Set publish directory to `landing`.
