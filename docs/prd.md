# AIIA — Product Requirements Document

## Visión
AIIA es una aplicación desktop Windows que permite crear agentes personalizados de búsqueda y recopilación de datos usando IA local (Ollama). El usuario describe en lenguaje natural qué necesita; la IA diseña el agente; el usuario revisa y aprueba; el agente se ejecuta periódicamente mientras el PC está encendido.

## Usuarios
- Personas no técnicas que necesitan automatizar búsquedas (empleo, candidatos, proveedores, etc.)
- Uso personal, máximo 5 agentes activos

## Requisitos funcionales

### RF-01 Creación de agentes
- Prompt en lenguaje natural + plantillas (job-search, candidate-search, supplier-search, custom)
- IA genera AgentSpec JSON editable
- Preview run con esfuerzo bajo antes de revisión

### RF-02 Revisión humana
- Estados: draft → pending_review → published | paused | error
- Diff entre versiones
- Aprobación obligatoria para publicar

### RF-03 Ejecución
- Triggers configurables (intervalMinutes)
- Solo con app/PC activo
- Niveles de esfuerzo: low, medium, high, super_high
- Barra de progreso por fase con tiempo estimado

### RF-04 Búsqueda
- DuckDuckGo + URLs directas + Playwright
- Login en sitios cuando sea necesario (credenciales cifradas)

### RF-05 Resultados
- Inbox en app con diff de nuevos
- Export Excel/CSV local
- Notificaciones Windows
- Feedback útil/no útil

### RF-06 Configuración
- Idioma EN/ES
- Retención configurable por agente
- Detección dinámica de hardware para modelos Ollama

## Requisitos no funcionales
- 100% local, sin telemetría
- Cifrado de datos y credenciales
- Distribución: landing Render + instalador MSI via GitHub Releases

## Fuera de alcance v1
- macOS/Linux, multiusuario, cloud sync, APIs de pago, Google services
