# E10 — Cloud cron (Gemini)

## Goal
Run published agents on a schedule **without the PC on**, when the LLM is **Gemini**. Local Ollama still requires the desktop app / PC.

## User flow
1. Desplegar `aiia-cloud` (Blueprint Render free) → Ajustes → URL + token
2. Keep-alive: ping `/health` cada 10 min (plan free)
3. Provider = Gemini + API key
4. En el agente: marcar **Ejecutar en AIIA Cloud**
5. Publicar → Dashboard **Subir a Cloud**
6. Apagar PC; el worker ejecuta due agents
7. Al abrir AIIA → sync automático → Inbox / wrap

## Components
| Piece | Role |
|-------|------|
| `schedule.cloudEnabled` | Agent opts into cloud; local scheduler skips it |
| `services/cloud-scheduler` | HTTP + minute cron + agent-runner |
| `cloud.rs` Tauri cmds | push agent, pull runs, settings |
| Settings / Dashboard | Configure + Push / Sync |

## Non-goals
- Hosting Ollama in the cloud
- Syncing chat history or full DB to cloud
- Managed SaaS hosting by AIIA (self-host for now)
