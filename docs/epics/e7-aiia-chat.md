# Epic 7 — AIIA Chat

## Objetivo
Añadir modo **AIIA Chat** (home) que conviva con agentes: streaming local, historial, tools web y bridge a AgentSpec. Sin APIs de pago.

## Estado
**Implementado** (2026-07-21). Pulido iterativo en curso (markdown, stop, atajos, landing).

## Checkpoints / Stories

| Story | Entrega | Estado |
|-------|---------|--------|
| E7-S1 | Shell UI + i18n/tagline | Done — `/` = Chat; `/agents` = dashboard |
| E7-S2 | SQLite + Tauri CRUD | Done — chats, mensajes, artifacts |
| E7-S3 | Streaming + HW model | Done — eventos `chat-stream` + modelo por HW |
| E7-S4 | Historial UX | Done — nuevo / archivar / desarchivar / borrar / renombrar |
| E7-S5 | Artifacts | Done — compactación >100k chars |
| E7-S6 | Tools web | Done — `web_search`, `fetch_url` |
| E7-S7 | Bridge agentes | Done — `create_agent` → draft + review |
| E7-S8 | Convivencia | Done — sin mutex global Ollama |
| E7-S9 | Pulido | Done — onboarding, banner Ollama, smoke, stop, markdown |

## Fuera de alcance
Plugins, GPT store, cloud. (Export / code / vision local → Epic 8.)


## Dependencias
- `packages/ollama-client` / Tauri `ollama_chat_stream`
- `crates/aiia-core` (tablas `chats`, `chat_messages`, `chat_artifacts`)
- UI `apps/desktop` (`pages/Chat.tsx`)

## Smoke
```bash
npm run smoke:chat   # requiere Ollama en :11434
cargo test -p aiia-core chat_
```
