# AIIA Project Context

## Qué es AIIA
Desktop Windows app con **AIIA Chat** (asistente estilo ChatGPT) y hasta **5 agentes** de búsqueda/recopilación. Ollama local por defecto; **Gemini opcional** con API key del usuario. Playwright para scraping. Datos siempre locales.

Tagline: *Local-first AI chat & search agents* / *Chat e agentes de búsqueda con IA local-first*.

## Estructura del repo
```
AIIA/
├── apps/desktop/           # Tauri 2 + React
├── crates/aiia-core/       # Rust core (DB, crypto, scheduler, chats)
├── packages/
│   ├── ollama-client/
│   ├── agent-engine/
│   ├── scraper/
│   ├── agent-runner/
│   └── chat-tools/         # tools del chat (si existe como package)
├── landing/                # Render static site
└── docs/                   # BMAD + specs
```

## Comandos clave
```bash
npm install
npm run tauri:dev          # desarrollo
npm run tauri:build        # build MSI
npm run build:packages     # compilar packages TS
```

## Decisiones fijas
- Dos modos en paralelo: **AIIA Chat** (home `/`) y **Agentes** (`/agents`)
- AgentSpec JSON es el contrato del agente
- Revisión humana obligatoria antes de publish
- Effort levels: low | medium | high | super_high
- Max 5 agentes published
- i18n UI: en, es; el chat responde en el idioma del mensaje
- Chat: streaming, historial local, archivar/borrar, export Markdown, visión e imágenes locales
- Modelo Ollama = el más potente que aguante el HW del usuario (modo local)
- Provider: `local` (default) | `gemini` (API key en Ajustes, DPAPI)
- Chat y runs de agentes comparten el mismo provider; pueden solaparse
- Fuera de alcance: plugins, GPT store, cloud sync de datos, visión/imagen cloud de terceros

## Para Cursor
- Leer `docs/agent-spec-schema.md` antes de tocar agent-engine
- Leer `docs/effort-levels.md` para params Ollama
- Epic Chat: `docs/epics/README.md` → Epic 7
- Gemini es opcional (key del usuario); no hay billing en AIIA
- Mantener datos y credenciales en local

## Windows Defender y Ollama

- **AIIA no instala Ollama en silencio** al pulsar «Generar agente». Ese flujo solo comprueba que Ollama esté instalado, lo inicia si hace falta y descarga el modelo vía API HTTP.
- La **instalación de Ollama** es manual y con consentimiento del usuario: onboarding y Ajustes abren `https://ollama.com/download` y ofrecen «Comprobar y preparar» tras la instalación.
- Si Windows Defender bloquea escritura o ejecución (`Acceso denegado`, error 5), la app muestra un mensaje accionable en lugar de cerrarse sin aviso.
- **Exclusión opcional en Defender:** solo la carpeta de modelos Ollama (`%USERPROFILE%\.ollama`), no toda la app AIIA.
- El **auto-update** usa `aiia-update-helper.exe` (Rust empaquetado), no scripts PowerShell con `-ExecutionPolicy Bypass`, `schtasks` ni `taskkill`.


La plantilla `opportunities` admite subtipos vía `opportunitySubtype`:

| Subtipo | Vista bandeja | Schema típico |
|---------|---------------|---------------|
| `jobs` | Tabla (empresa, ubicación, etc.) | `title`, `company`, `location`, `url`, … |
| `grants` | Tarjetas tipo boletín | `scope`, `organization`, `program_name`, `description`, `max_funding`, `currency`, `deadline`, `url` |
| `tenders`, `events` | Tarjetas | Similar a grants según prompt |

- Si `opportunitySubtype` no está en el spec, se infiere del prompt (keywords: grant, subvención, convocatoria, funding, beca, tender, licitación).
- Fuentes de búsqueda: `duckduckgo` (siempre), `url` (página estática), `rss` (feed Atom/RSS).
- Dedupe por defecto: grants → `organization` + `program_name`; jobs → `title` + `url`.
- Ejemplo de prompt grants: *"Grants para comunidades rurales, wellbeing y proyectos locales (Australia y global). Campos: scope, organization, program_name, description, max_funding, currency, deadline, url."*
