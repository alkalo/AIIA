# Epic 7 — AIIA Chat

## Objetivo
Añadir modo **AIIA Chat** (home) que conviva con agentes: streaming (Ollama local o Gemini opcional), historial, tools web y bridge a AgentSpec.

## Estado
**Implementado** (2026-07-21). Dual-mode Local/Gemini añadido; pulido iterativo en curso.

## Checkpoints / Stories

| Story | Entrega | Estado |
|-------|---------|--------|
| E7-S1 | Shell UI + i18n/tagline | Done — `/` = Chat; `/agents` = dashboard |
| E7-S2 | SQLite + Tauri CRUD | Done — chats, mensajes, artifacts |
| E7-S3 | Streaming + HW model | Done — `llm_chat_stream` (Ollama o Gemini) + modelo por HW en local |
| E7-S4 | Historial UX | Done — nuevo / archivar / desarchivar / borrar / renombrar |
| E7-S5 | Artifacts | Done — compactación >100k chars |
| E7-S6 | Tools web | Done — `web_search`, `fetch_url` |
| E7-S7 | Bridge agentes | Done — `create_agent` → draft + review |
| E7-S8 | Convivencia | Done — sin mutex global; mismo `ai_provider` en chat y agentes |
| E7-S9 | Pulido | Done — onboarding, banner Ollama solo en local, smoke, stop, markdown |
| E7-S10 | Dual provider | Done — toggle Local/Gemini, API key DPAPI en Ajustes |

## Fuera de alcance
Plugins, GPT store, cloud sync de datos. (Export / code / vision local → Epic 8.) Function-calling nativo Gemini → futuro.


## Dependencias
- `packages/ollama-client` (`LlmClient`, Ollama + Gemini) / Tauri `llm_chat_stream` + `gemini.rs`
- `crates/aiia-core` (tablas `chats`, `chat_messages`, `chat_artifacts`, `credentials`)
- UI `apps/desktop` (`pages/Chat.tsx`, `pages/Settings.tsx`)

## Smoke
```bash
npm run smoke:chat   # Ollama en :11434; Gemini si GEMINI_API_KEY
cargo test -p aiia-desktop --lib
cargo test -p aiia-core
```
