# @aiia/cloud-scheduler

Worker Gemini-only: cron de agentes con el PC apagado.

Docs: [`docs/architecture-cloud-cron.md`](../../docs/architecture-cloud-cron.md)

## Render free (recomendado)

1. Blueprint del repo → servicio `aiia-cloud`.
2. Copia `AIIA_CLOUD_TOKEN` del dashboard de Render.
3. En AIIA Ajustes: URL cloud + token + **tu** API key de Gemini (cada usuario la suya).
4. Ping `/health` cada 10 min (keep-alive free).
5. Agente con cloud + Push from Dashboard (el Push envía la key del usuario; no se configura en Render).

## Local

Desde la raíz del monorepo:

```bash
npm run cloud:build
export AIIA_CLOUD_TOKEN=dev-secret
export AIIA_CLOUD_DATA_DIR=./cloud-data
export AIIA_RUNNER_JS=./packages/agent-runner/dist/index.js
npm run cloud:start
```

Health: `GET /health`
