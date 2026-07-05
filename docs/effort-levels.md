# Effort Levels — Mapeo a parámetros Ollama

| Nivel | ID | Pasos LLM | Max fuentes | Temperature | num_ctx | Tiempo aprox |
|-------|-----|-----------|-------------|-------------|---------|--------------|
| Bajo | `low` | 1 | 5 | 0.3 | 2048 | 30s–2min |
| Medio | `medium` | 2 | 15 | 0.5 | 4096 | 2–8min |
| Alto | `high` | 3 + rerank | 30 | 0.4 | 8192 | 8–20min |
| Super alto | `super_high` | multi-pass | 50 | 0.3 | 16384 | 20–45min |

## Fases de progreso UI
1. `planning` — Planificando
2. `searching` — Buscando
3. `extracting` — Extrayendo
4. `filtering` — Filtrando
5. `exporting` — Exportando
6. `done` — Completado

## Uso
- **Preview**: siempre `low`
- **Ejecución programada**: effort del AgentSpec (default `medium`)
- **Super high**: advertir si HW profile < `high`
