# Effort Levels — Agents & Chat

Applies to **Local (Ollama)** and **Gemini** (user API key). Higher tiers are strictly stronger.

## Agents (`EffortLevel`)

| Nivel | ID | Fuentes / olas (orden) | Budget | Tiempo aprox |
|-------|-----|------------------------|--------|--------------|
| Instantáneo | `low` | SERP snippets, 1 ola | 2 min | segundos–~2 min |
| Estándar | `medium` | plan + ranking + top pages | 20 min | ~5–20 min |
| Profundo | `high` | muchas olas + critic | 75 min | ~30–75 min |
| Investigación | `super_high` | multi-ola pesada | 2 h | ~1.25–2 h |
| Máx | `ultra_high` | máxima búsqueda (32 olas, deep fetch) | **3 h** | ~2–3 h (tope duro) |

Parámetros canónicos: `packages/ollama-client/src/index.ts` (`EFFORT_CONFIGS`) y `research-profile.ts` (`RESEARCH_PROFILES`).

Gemini: `medium`/`low` → Flash; `high`+ → Pro (planner/critic).

## Chat modes

| Modo | ID | Comportamiento | Gemini |
|------|-----|----------------|--------|
| Instantáneo | `instant` | segundos, casi sin web | Flash |
| Eficaz | `eficaz` | presupuesto ~5–20 min búsqueda + leer páginas | Flash |
| Pro | `pro` | investigación profunda multi-query (~30–75 min) | Pro |
| Máx | `max` | máxima potencia (tope duro **3 h**) | Pro |

Definidos en `apps/desktop/src/chatModes.ts`; profundidad de motores en `chat.rs` (`instant` / `eficaz` / `pro` / `max`).

## Fases de progreso UI (agentes)
1. `planning` — Planificando
2. `searching` — Buscando
3. `extracting` — Extrayendo
4. `filtering` — Filtrando
5. `exporting` — Exportando
6. `done` — Completado

## Uso
- **Preview**: siempre `low`
- **Ejecución programada**: effort del AgentSpec (default `medium`)
- **ultra_high / Chat max**: tope duro 3 h; en Local conviene HW `high+` (Gemini Pro consume más tokens)
