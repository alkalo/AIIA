# Epic 1: Foundation
- E1-S1: Monorepo scaffolding
- E1-S2: BMAD docs + Cursor rules
- E1-S3: Landing page Render

# Epic 2: Core Local
- E2-S1: SQLite + migrations
- E2-S2: Ollama client + HW detection
- E2-S3: Effort levels + i18n

# Epic 3: Agent Engine
- E3-S1: AgentSpec types + validation
- E3-S2: PlannerAgent
- E3-S3: UI crear/preview + versionado

# Epic 4: Scraper & Executor
- E4-S1: DuckDuckGo search
- E4-S2: Playwright extraction
- E4-S3: Filter/rank + progress bar

# Epic 5: Scheduler & Outputs
- E5-S1: Scheduler + system tray
- E5-S2: Human review flow
- E5-S3: Inbox, Excel, CSV, notifications

# Epic 6: Release
- E6-S1: Templates + feedback loop
- E6-S2: Retention cleanup
- E6-S3: GitHub Actions MSI

# Epic 7: AIIA Chat — **Done**
- E7-S1: BMAD + shell UI (home Chat, rutas `/agents`, nav sidebar estilo ChatGPT, i18n/tagline)
- E7-S2: Persistencia SQLite (`chats`, `chat_messages`, `chat_artifacts`) + Tauri CRUD
- E7-S3: Streaming Ollama (`chatStream`) + modelo por HW + system prompt
- E7-S4: Historial UX — nuevo / abrir / archivar / borrar
- E7-S5: Contexto largo → artefacto local
- E7-S6: Tools web en chat (DuckDuckGo + fetch URL vía scraper)
- E7-S7: Bridge chat → draft AgentSpec + review
- E7-S8: Convivencia chat + run agente en paralelo
- E7-S9: Pulido E2E — onboarding, errores Ollama, smoke localhost

# Epic 8: AIIA Chat local parity — **Done**
- E8-S1: Vision (adjuntar imágenes + modelo VL Ollama)
- E8-S2: Generación de imágenes local (A1111/Forge API)
- E8-S3: Export chat Markdown
- E8-S4: Python acotado (timeout)
- Fuera: plugins, GPT store, cloud

# Epic 9: BFGN Grants & Impact News wrap — **Done (core)**
- E9-S1: Copy-ready wrap text (no SMTP) + Inbox review/copy gate
- E9-S2: Example prompt + docs
- E9-S3: Multi-lane research (grants / SE / NGO / ESG) + editor maxSources / per-query top-N

# Epic 10: Cloud cron Gemini — **Done (scaffold)**
- E10-S1: `schedule.cloudEnabled` + local scheduler skip
- E10-S2: `services/cloud-scheduler` worker + desktop push/pull
- E10-S3: Settings UI + Dashboard Push to Cloud + sync on app open
- Docs: `docs/architecture-cloud-cron.md`

# Epic 11: Opportunities + Sector news curation — **Done**
- E11-S1: Taxonomía programs/awards/exposure/sector_news + contentMode
- E11-S2: Curation pipeline (verify, freshness, exclude, fingerprint, editorial score)
- E11-S3: Inbox review queue (pending/approve/reject/archive)
- Docs: `docs/epics/e11-opportunities-news.md` + example prompts

