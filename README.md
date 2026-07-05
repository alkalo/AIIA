# AIIA — Local AI Search Agents

Desktop Windows app that creates up to 5 local AI agents for automated search and data collection using Ollama + Playwright.

## Features

- **Natural language agent creation** — describe what to search, local AI builds the agent
- **Human review required** before publishing
- **Effort levels** — low, medium, high, super high with progress bar
- **Scheduled execution** while PC is on
- **Outputs** — inbox, Excel, CSV, Windows notifications
- **100% local** — no cloud, no paid APIs, no Google
- **EN/ES** bilingual UI

## Prerequisites

- Windows 10/11
- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/)
- [Ollama](https://ollama.com/) running locally

## Quick start

```bash
git clone https://github.com/alkalo/AIIA.git
cd AIIA
npm install
npm run build:packages
npm run playwright:install
npm run tauri:dev
```

## Build installer

```bash
npm run tauri:build
```

MSI output: `target/release/bundle/msi/` (Cargo workspace root)

## Download (Windows)

- **Landing:** https://aiia-landing.onrender.com
- **Installer:** https://github.com/alkalo/AIIA/releases/latest

## Project structure

```
AIIA/
├── apps/desktop/       # Tauri 2 + React UI
├── crates/aiia-core/   # Rust: DB, crypto, scheduler
├── packages/           # TypeScript: agent-engine, scraper, ollama-client
├── landing/            # Static site for Render
└── docs/               # BMAD docs + specs
```

## Documentation

- [PRD](docs/prd.md)
- [Architecture](docs/architecture.md)
- [Agent Spec Schema](docs/agent-spec-schema.md)
- [Development Guide](docs/development-guide.md)

## Landing page (Render)

Live site: **https://aiia-landing.onrender.com**

Deploy `landing/` as a static site on Render (free tier). See `render.yaml`.

## License

MIT
