const strings = {
  en: {
    "nav.how": "How it works",
    "nav.effort": "Effort levels",
    "nav.features": "Features",
    "nav.download": "Download",
    "nav.faq": "FAQ",
    "hero.title": "Local AI agents that search and collect data for you",
    "hero.subtitle":
      "Describe what you need in plain language. AIIA builds a custom agent with local AI, runs it on a schedule, and delivers filtered results to your inbox, Excel, or CSV — all on your PC.",
    "hero.download": "Download for Windows",
    "hero.note": "Free · 100% local · No cloud · No paid APIs",
    "how.title": "How it works",
    "how.subtitle": "From idea to automated results in five steps",
    "how.step1.title": "Describe your goal",
    "how.step1.desc":
      "Tell AIIA what to find — job listings, suppliers, candidates, market research. Use a template or write your own prompt.",
    "how.step2.title": "AI builds your agent",
    "how.step2.desc":
      "Local AI (Ollama) generates a search strategy: queries, sources, output fields, and filters. You can edit everything before publishing.",
    "how.step3.title": "Review and publish",
    "how.step3.desc":
      "Human review is required. Check the agent spec, run a quick preview, then publish. Up to 5 agents can run at once.",
    "how.step4.title": "Scheduled runs",
    "how.step4.desc":
      "Agents run automatically on an interval while your PC is on. Choose an effort level from quick scans to deep multi-hour research.",
    "how.step5.title": "Results in your inbox",
    "how.step5.desc":
      "Filtered results with relevance scores land in the app inbox. Export to Excel or CSV. Mark items useful or not to improve future runs.",
    "effort.title": "Effort levels",
    "effort.subtitle": "Pick how deep each run should go — from minutes to hours",
    "effort.col.level": "Level",
    "effort.col.time": "Typical time",
    "effort.col.desc": "What you get",
    "effort.low.name": "Fast",
    "effort.low.time": "1–3 min",
    "effort.low.desc": "Quick SERP snippets, minimal AI reasoning",
    "effort.medium.name": "Standard",
    "effort.medium.time": "5–12 min",
    "effort.medium.desc": "AI plans queries, ranks sources, reads top pages",
    "effort.high.name": "Deep",
    "effort.high.time": "30–60 min",
    "effort.high.desc": "Multi-wave search, coverage analysis, critic review",
    "effort.super.name": "Research",
    "effort.super.time": "1–2 h",
    "effort.super.desc": "Many sector sources, exhaustive waves",
    "effort.ultra.name": "Pro",
    "effort.ultra.time": "2–4 h",
    "effort.ultra.desc": "Maximum coverage across every relevant source",
    "features.title": "Why AIIA",
    "features.agents.title": "Custom AI agents",
    "features.agents.desc":
      "Jobs, candidates, suppliers, monitoring — describe anything. Local AI creates a tailored search agent with editable queries and output schema.",
    "features.local.title": "100% local",
    "features.local.desc":
      "Ollama runs on your PC. Data, credentials, and AI never leave your machine. Internet is only used during agent runs for web search.",
    "features.secure.title": "Encrypted credentials",
    "features.secure.desc":
      "Site logins are stored with Windows DPAPI encryption. Secrets are never logged in plain text.",
    "features.schedule.title": "Scheduled runs",
    "features.schedule.desc":
      "Set an interval and agents run automatically while the app and PC are active.",
    "features.output.title": "Flexible output",
    "features.output.desc":
      "Inbox inside the app, Excel workbooks, CSV exports — with relevance scores and direct links.",
    "features.feedback.title": "Learns from feedback",
    "features.feedback.desc":
      "Mark results useful or not. AIIA can suggest agent improvements based on your feedback.",
    "req.title": "Requirements",
    "req.windows": "Windows 10 or 11 (64-bit)",
    "req.ollama": "Ollama installed and running",
    "req.ram": "8 GB RAM minimum (16 GB recommended for Deep/Pro modes)",
    "req.internet": "Internet connection during agent runs (for web search only)",
    "req.no": "No Google account, no paid APIs, no cloud storage",
    "download.title": "Download AIIA for Windows",
    "download.subtitle": "Free desktop installer. No account required.",
    "download.cta": "Download Windows installer (.msi)",
    "download.releases": "All releases on GitHub",
    "download.step1": "Install Ollama from ollama.com and pull a model (e.g. qwen2.5:7b)",
    "download.step2": "Download and run the AIIA installer",
    "download.step3": "Open AIIA, complete onboarding, and create your first agent",
    "download.note": "First launch may download AI models automatically based on your hardware.",
    "faq.title": "FAQ",
    "faq.q1": "Is AIIA free?",
    "faq.a1":
      "Yes. The app, local AI (Ollama), and web search during runs are free. You only need your own Windows PC.",
    "faq.q2": "Does my data leave my computer?",
    "faq.a2":
      "No. Agents, results, and credentials stay on your machine. Internet is used only to search and read public web pages during a run.",
    "faq.q3": "How many agents can I run?",
    "faq.a3": "You can publish up to 5 agents at the same time. Each agent runs on its own schedule.",
    "faq.q4": "Do I need to be online all the time?",
    "faq.a4":
      "Only during agent runs. The app and your data work fully offline; scheduled runs need internet for search.",
    "faq.q5": "Which AI models does it use?",
    "faq.a5":
      "AIIA uses Ollama with models like Qwen 2.5. It picks the best model your hardware can run — larger RAM gets better models automatically.",
    "footer.tagline": "Build More Architect Dreams",
    "footer.github": "GitHub",
    "footer.license": "MIT License",
  },
  es: {
    "nav.how": "Cómo funciona",
    "nav.effort": "Niveles",
    "nav.features": "Características",
    "nav.download": "Descargar",
    "nav.faq": "FAQ",
    "hero.title": "Agentes de IA local que buscan y recopilan datos por ti",
    "hero.subtitle":
      "Describe lo que necesitas en lenguaje natural. AIIA crea un agente personalizado con IA local, lo ejecuta según programación y entrega resultados filtrados en bandeja, Excel o CSV — todo en tu PC.",
    "hero.download": "Descargar para Windows",
    "hero.note": "Gratis · 100% local · Sin nube · Sin APIs de pago",
    "how.title": "Cómo funciona",
    "how.subtitle": "De la idea a resultados automáticos en cinco pasos",
    "how.step1.title": "Describe tu objetivo",
    "how.step1.desc":
      "Dile a AIIA qué buscar — ofertas de empleo, proveedores, candidatos, investigación. Usa una plantilla o escribe tu propio prompt.",
    "how.step2.title": "La IA crea tu agente",
    "how.step2.desc":
      "La IA local (Ollama) genera la estrategia: consultas, fuentes, campos de salida y filtros. Puedes editarlo todo antes de publicar.",
    "how.step3.title": "Revisa y publica",
    "how.step3.desc":
      "La revisión humana es obligatoria. Revisa la spec del agente, ejecuta un preview rápido y publica. Hasta 5 agentes activos a la vez.",
    "how.step4.title": "Ejecuciones programadas",
    "how.step4.desc":
      "Los agentes se ejecutan solos a intervalos con el PC encendido. Elige el nivel de esfuerzo, de escaneos rápidos a investigación de horas.",
    "how.step5.title": "Resultados en bandeja",
    "how.step5.desc":
      "Resultados filtrados con puntuación llegan a la bandeja. Exporta a Excel o CSV. Marca útil/no útil para mejorar futuras ejecuciones.",
    "effort.title": "Niveles de esfuerzo",
    "effort.subtitle": "Elige la profundidad de cada ejecución — de minutos a horas",
    "effort.col.level": "Nivel",
    "effort.col.time": "Tiempo típico",
    "effort.col.desc": "Qué obtienes",
    "effort.low.name": "Rápido",
    "effort.low.time": "1–3 min",
    "effort.low.desc": "Snippets SERP al instante, poco razonamiento IA",
    "effort.medium.name": "Estándar",
    "effort.medium.time": "5–12 min",
    "effort.medium.desc": "IA planifica, prioriza fuentes y lee páginas clave",
    "effort.high.name": "Profundo",
    "effort.high.time": "30–60 min",
    "effort.high.desc": "Búsqueda multi-ola, análisis de cobertura, revisión crítica",
    "effort.super.name": "Investigación",
    "effort.super.time": "1–2 h",
    "effort.super.desc": "Muchas fuentes del sector, olas exhaustivas",
    "effort.ultra.name": "Pro",
    "effort.ultra.time": "2–4 h",
    "effort.ultra.desc": "Máxima cobertura en todas las fuentes relevantes",
    "features.title": "Por qué AIIA",
    "features.agents.title": "Agentes IA personalizados",
    "features.agents.desc":
      "Empleo, candidatos, proveedores, monitorización — describe cualquier cosa. La IA local crea un agente con consultas y campos editables.",
    "features.local.title": "100% local",
    "features.local.desc":
      "Ollama corre en tu PC. Datos, credenciales e IA nunca salen de tu máquina. Internet solo se usa durante ejecuciones para buscar en la web.",
    "features.secure.title": "Credenciales cifradas",
    "features.secure.desc":
      "Los logins de sitios se guardan con cifrado DPAPI de Windows. Los secretos nunca se registran en texto plano.",
    "features.schedule.title": "Ejecuciones programadas",
    "features.schedule.desc":
      "Configura un intervalo y los agentes se ejecutan solos mientras la app y el PC están activos.",
    "features.output.title": "Salida flexible",
    "features.output.desc":
      "Bandeja en la app, Excel, CSV — con puntuación de relevancia y enlaces directos.",
    "features.feedback.title": "Aprende de tu feedback",
    "features.feedback.desc":
      "Marca resultados útiles o no. AIIA puede sugerir mejoras al agente según tu feedback.",
    "req.title": "Requisitos",
    "req.windows": "Windows 10 u 11 (64 bits)",
    "req.ollama": "Ollama instalado y en ejecución",
    "req.ram": "8 GB RAM mínimo (16 GB recomendado para modos Profundo/Pro)",
    "req.internet": "Conexión a internet durante ejecuciones (solo para búsqueda web)",
    "req.no": "Sin cuenta Google, sin APIs de pago, sin almacenamiento en nube",
    "download.title": "Descargar AIIA para Windows",
    "download.subtitle": "Instalador de escritorio gratuito. Sin cuenta.",
    "download.cta": "Descargar instalador Windows (.msi)",
    "download.releases": "Todas las versiones en GitHub",
    "download.step1": "Instala Ollama desde ollama.com y descarga un modelo (ej. qwen2.5:7b)",
    "download.step2": "Descarga y ejecuta el instalador de AIIA",
    "download.step3": "Abre AIIA, completa el onboarding y crea tu primer agente",
    "download.note": "El primer arranque puede descargar modelos de IA según tu hardware.",
    "faq.title": "Preguntas frecuentes",
    "faq.q1": "¿AIIA es gratis?",
    "faq.a1":
      "Sí. La app, la IA local (Ollama) y la búsqueda web durante ejecuciones son gratis. Solo necesitas tu PC con Windows.",
    "faq.q2": "¿Mis datos salen del ordenador?",
    "faq.a2":
      "No. Agentes, resultados y credenciales permanecen en tu máquina. Internet solo se usa para buscar y leer páginas públicas durante una ejecución.",
    "faq.q3": "¿Cuántos agentes puedo tener?",
    "faq.a3": "Puedes publicar hasta 5 agentes simultáneamente. Cada uno con su propia programación.",
    "faq.q4": "¿Necesito estar siempre online?",
    "faq.a4":
      "Solo durante ejecuciones. La app y tus datos funcionan offline; las ejecuciones programadas necesitan internet para buscar.",
    "faq.q5": "¿Qué modelos de IA usa?",
    "faq.a5":
      "AIIA usa Ollama con modelos como Qwen 2.5. Elige el mejor modelo que tu hardware admite — más RAM permite modelos más potentes.",
    "footer.tagline": "Build More Architect Dreams",
    "footer.github": "GitHub",
    "footer.license": "Licencia MIT",
  },
};

function detectLang() {
  const saved = localStorage.getItem("aiia-landing-lang");
  if (saved && strings[saved]) return saved;
  const nav = (navigator.language || "es").toLowerCase();
  return nav.startsWith("es") ? "es" : "en";
}

let lang = detectLang();

function setLang(l) {
  if (!strings[l]) return;
  lang = l;
  localStorage.setItem("aiia-landing-lang", l);
  document.documentElement.lang = l;
  applyLang();
  document.querySelectorAll(".lang button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === l);
  });
}

function applyLang() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key && strings[lang][key]) {
      el.textContent = strings[lang][key];
    }
  });
}

function applyConfig() {
  const cfg = window.AIIA_CONFIG;
  if (!cfg) return;
  document.querySelectorAll("[data-href='release']").forEach((el) => {
    el.href = cfg.releaseUrl;
  });
  document.querySelectorAll("[data-href='repo']").forEach((el) => {
    el.href = cfg.repoUrl;
  });
  document.querySelectorAll("[data-href='ollama']").forEach((el) => {
    el.href = cfg.ollamaUrl;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.documentElement.lang = lang;
  applyLang();
  applyConfig();
  document.querySelectorAll(".lang button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
  });
});
