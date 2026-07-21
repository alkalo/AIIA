# AIIA Development Guide

## Prerequisites
- Node.js 20+
- Rust stable (rustup)
- Ollama installed locally (manual install from https://ollama.com/download)
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

## Modes
- **AIIA Chat** — home `/` and `/chat/:id` (streaming Ollama, tools, historial)
- **Agentes** — `/agents`, `/create`, `/review/:id`, `/inbox`, `/runs`

## AIIA Chat smoke
```bash
# Ollama must be running on :11434
npm run smoke:chat
cargo test -p aiia-core chat_
```

## Adding a Tauri command
1. Implement in `crates/aiia-core` (if persistence) or `apps/desktop/src-tauri`
2. Expose in `apps/desktop/src-tauri/src/lib.rs` invoke_handler
3. Call from React via `apps/desktop/src/api.ts`

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
