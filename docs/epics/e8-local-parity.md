# Epic 8 — AIIA Chat local parity

## Objetivo
Paridad local con capacidades tipo ChatGPT **sin** plugins, GPT store ni cloud: visión, gen. de imágenes local, export Markdown e intérprete Python acotado.

## Estado
**Implementado** (2026-07-21).

## Checkpoints / Stories

| Story | Entrega | Estado |
|-------|---------|--------|
| E8-S1 | Visión: adjuntar imágenes + modelo VL Ollama | Done — `images` en mensajes, `pick_vision_model`, paste/file |
| E8-S2 | Gen. imágenes local (A1111/Forge `:7860`/`:7861`) | Done — tool `generate_image` |
| E8-S3 | Export chat Markdown | Done — `export_chat_markdown` + abrir ruta |
| E8-S4 | Python acotado (timeout + bloqueos básicos) | Done — tool `run_python` |
| E8-S5 | Modos de chat (auto / instantáneo / eficaz / pro / máx) | Done — profundidad búsqueda + thinking |

## Fuera de alcance
Plugins, GPT store, APIs cloud de imagen/visión, sandbox OS completo.

## Dependencias opcionales (runtime)
- Visión: modelo VL en Ollama (p. ej. `qwen2.5vl`, `llava`)
- Imágenes: Automatic1111 o Forge con `--api` en localhost
- Python: `python` / `py` en PATH

## Smoke
```bash
npm run smoke:chat
cargo test -p aiia-core chat_
```
