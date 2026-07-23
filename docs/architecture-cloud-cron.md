# AIIA Cloud cron (Gemini only)

## Idea
| Provider | PC apagado | Quién ejecuta |
|----------|------------|---------------|
| **Local (Ollama)** | No | Scheduler del desktop (app abierta) |
| **Gemini + `cloudEnabled`** | Sí | `services/cloud-scheduler` en la nube |

Al abrir AIIA, hace `pull_cloud_runs` y vuelca resultados a Bandeja / wrap copy-paste.

## Desplegar en Render (gratis)

El Blueprint del repo (`render.yaml`) incluye `aiia-cloud` en plan **free**.

1. [Render](https://render.com) → **New** → **Blueprint** → conecta este repo.
2. Acepta el servicio `aiia-cloud` (y opcionalmente `aiia-landing`).
3. Tras el deploy, en el servicio → **Environment** → copia el valor de `AIIA_CLOUD_TOKEN`.
4. URL típica: `https://aiia-cloud.onrender.com` (o la que asigne Render).
5. En AIIA → **Ajustes** → pega URL + token → Guardar.
6. **Keep-alive (obligatorio en free):** crea un ping HTTP cada **10 minutos** a `GET https://TU-URL/health` ([cron-job.org](https://cron-job.org), UptimeRobot, etc.). Sin esto el free se duerme a los 15 min y el cron no corre.

### Límites del plan free
- Sin disco persistente: si el servicio se duerme, reinicia o redeploya, **se pierden agentes/runs** locales del worker → vuelve a **Push to Cloud** desde el Dashboard.
- Cold start ~1 min tras idle.
- Sin Chromium/Playwright (build lo omite): búsqueda HTTP sí; scrape de páginas con browser puede fallar. Para scrape serio → plan de pago + disco + `playwright install`.

### Upgrade (opcional)
Plan Starter+ con **persistent disk** montado en `/var/data` y `AIIA_CLOUD_DATA_DIR=/var/data` → datos sobreviven redeploys y no hace falta keep-alive externo.

## Variables de entorno
| Var | Uso |
|-----|-----|
| `AIIA_CLOUD_TOKEN` | Secreto compartido con la app (Render lo genera) |
| `AIIA_CLOUD_DATA_DIR` | Carpeta de agents/runs/inbox |
| `AIIA_RUNNER_JS` | Path a `packages/agent-runner/dist/index.js` |
| `PORT` | Lo pone Render automáticamente |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `1` en free |

Build local / CI: `npm run cloud:build` luego `npm run cloud:start`.

## Cómo usar un agente en cloud
1. Provider = **Gemini** + API key (Google AI Studio; no hace falta GCP Console).
2. En el agente: marcar **Ejecutar en AIIA Cloud (Gemini)**.
3. Publicar → en Dashboard **Push to Cloud**.
4. El PC puede apagarse; el worker corre due cada minuto (mientras esté despierto).
5. Al abrir la app (o Sync now) ves resultados en Inbox.

## Seguridad
- La API key de Gemini se envía al cloud al hacer Push (HTTPS + bearer).
- Render ya da HTTPS en `*.onrender.com`.
- Ollama **nunca** se ejecuta en cloud.

## Estado
- v0.1.23+: código desktop + worker + Blueprint free incluidos.
