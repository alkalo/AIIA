# AIIA — Product Requirements Document

## Visión
AIIA es una aplicación desktop Windows con dos modos que conviven:

1. **AIIA Chat** — asistente conversacional local (estilo ChatGPT) con streaming, historial, herramientas de búsqueda/lectura web y puente a agentes.
2. **Agentes** — hasta 5 agentes personalizados de búsqueda y recopilación de datos. El usuario describe qué necesita; la IA diseña el agente; el usuario revisa y aprueba; el agente se ejecuta periódicamente mientras el PC está encendido.

Todo local-first: datos y credenciales en el PC. IA por defecto **Ollama** (gratis). **Gemini opcional** con API key del usuario (tokens de pago en Google). Tagline: *Local-first AI chat & search agents* / *Chat e agentes de búsqueda con IA local-first*.

## Usuarios
- Personas no técnicas que quieren chatear con IA local gratis y/o automatizar búsquedas (empleo, candidatos, proveedores, grants, etc.)
- Uso personal, máximo 5 agentes published

## Requisitos funcionales

### RF-01 Creación de agentes
- Prompt en lenguaje natural + plantillas (job-search, candidate-search, supplier-search, opportunities, custom)
- IA genera AgentSpec JSON editable
- Preview run con esfuerzo bajo antes de revisión
- También se puede iniciar un draft de agente desde AIIA Chat

### RF-02 Revisión humana
- Estados: draft → pending_review → published | paused | error
- Diff entre versiones
- Aprobación obligatoria para publicar

### RF-03 Ejecución
- Triggers configurables (intervalMinutes)
- Solo con app/PC activo
- Niveles de esfuerzo: low, medium, high, super_high
- Barra de progreso por fase con tiempo estimado
- Puede ejecutarse en paralelo con una sesión de AIIA Chat (mismo provider: Ollama o Gemini)

### RF-04 Búsqueda (agentes)
- DuckDuckGo + URLs directas + Playwright
- Login en sitios cuando sea necesario (credenciales cifradas)

### RF-05 Resultados
- Inbox en app con diff de nuevos
- Export Excel/CSV local
- Notificaciones Windows
- Feedback útil/no útil

### RF-06 Configuración
- Idioma UI EN/ES
- Retención configurable por agente
- Detección dinámica de hardware para modelos Ollama (modo local)
- Proveedor de IA: Local (Ollama) o Gemini; API key de Gemini cifrada con DPAPI en Ajustes
- Default: Local; Gemini solo si hay key y el usuario lo elige

### RF-07 AIIA Chat
- Home de la app (`/`) es AIIA Chat
- Streaming token a token (respuesta progresiva)
- Historial de conversaciones en SQLite local: crear, abrir, archivar, borrar
- Responde en el idioma del mensaje del usuario
- System prompt fijo de producto (asistente AIIA local-first; Gemini si está activo)
- Contexto largo: umbral alto; si se excede, el exceso se convierte en artefacto/archivo local referenciado en el hilo
- Herramientas desde el chat: búsqueda web, lectura de URL/página, crear draft de agente hacia el flujo de revisión
- Sin export de conversación en v1
- Fuera de alcance chat v1: ejecución arbitraria de código/terminal, generación de imágenes cloud, plugins/GPTs store

## Requisitos no funcionales
- 100% local, sin telemetría
- Cifrado de datos y credenciales
- Distribución: landing Render + instalador MSI via GitHub Releases
- Chat y runs de agentes no se bloquean mutuamente a nivel de cola global

## Fuera de alcance v1
- macOS/Linux, multiusuario, cloud sync de datos
- Plugins / GPT store / servicios cloud de almacenamiento
- Billing interno (Gemini se paga con la API key del usuario en Google)
## Epic 8 (local parity)
- Visión: adjuntar imágenes al chat (modelo VL Ollama)
- Generación de imágenes local (API Automatic1111/Forge en localhost si está disponible)
- Export de conversación a Markdown
- Intérprete Python acotado (timeout, sin cloud)
- Modos de chat: Automático / Instantáneo / Eficaz / Pro / Máx (profundidad de búsqueda y pensamiento)
