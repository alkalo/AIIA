# AIIA Project Context

## Qué es AIIA
Desktop Windows app para crear hasta 5 agentes locales de búsqueda/recopilación con Ollama + Playwright. Todo local, sin APIs de pago ni Google.

## Estructura del repo
```
AIIA/
├── apps/desktop/           # Tauri 2 + React
├── crates/aiia-core/       # Rust core
├── packages/
│   ├── ollama-client/
│   ├── agent-engine/
│   ├── scraper/
│   └── agent-runner/
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
- AgentSpec JSON es el contrato del agente
- Revisión humana obligatoria antes de publish
- Effort levels: low | medium | high | super_high
- Max 5 agentes published
- i18n: en, es

## Para Cursor
- Leer `docs/agent-spec-schema.md` antes de tocar agent-engine
- Leer `docs/effort-levels.md` para params Ollama
- No añadir APIs de pago ni Google
- Mantener todo en local

## Oportunidades y subvenciones (grants)

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
