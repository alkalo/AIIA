import type { TemplateId } from "./types.js";

export interface AgentTemplate {
  id: TemplateId;
  nameKey: string;
  descriptionKey: string;
  placeholderKey: string;
  intentGuidance: { en: string; es: string };
  /** Ocultar en el selector (solo compatibilidad con agentes antiguos) */
  legacy?: boolean;
}

/** Plantillas amplias: guían a la IA sin fijar campos ni consultas */
export const TEMPLATES: AgentTemplate[] = [
  {
    id: "web-research",
    nameKey: "templates.webResearch.name",
    descriptionKey: "templates.webResearch.description",
    placeholderKey: "templates.webResearch.placeholder",
    intentGuidance: {
      en: "Open-ended web research. Collect whatever fields best answer the user's question — summaries, facts, sources, dates, comparisons. Adapt depth and structure to the topic.",
      es: "Investigación abierta en la web. Recopila los campos que mejor respondan a la pregunta del usuario — resúmenes, datos, fuentes, fechas, comparativas. Adapta profundidad y estructura al tema.",
    },
  },
  {
    id: "opportunities",
    nameKey: "templates.opportunities.name",
    descriptionKey: "templates.opportunities.description",
    placeholderKey: "templates.opportunities.placeholder",
    intentGuidance: {
      en: "Listings and opportunities (jobs, grants, tenders, deals, events, etc.). Infer the exact domain from the user. Include identifiers, key attributes, links, and relevance — not a fixed HR or sales schema.",
      es: "Listados y oportunidades (empleo, subvenciones, licitaciones, ofertas, eventos, etc.). Infiere el dominio exacto del usuario. Incluye identificadores, atributos clave, enlaces y relevancia — no un esquema fijo de RRHH o ventas.",
    },
  },
  {
    id: "people-orgs",
    nameKey: "templates.peopleOrgs.name",
    descriptionKey: "templates.peopleOrgs.description",
    placeholderKey: "templates.peopleOrgs.placeholder",
    intentGuidance: {
      en: "People, companies, or organizations. Fields should match the role (contact, supplier, partner, expert, competitor). Prefer public profile links and concise attributes over rigid name/title/skills columns.",
      es: "Personas, empresas u organizaciones. Los campos deben encajar con el rol (contacto, proveedor, partner, experto, competidor). Prioriza enlaces públicos y atributos concisos frente a columnas rígidas de nombre/título/skills.",
    },
  },
  {
    id: "monitoring",
    nameKey: "templates.monitoring.name",
    descriptionKey: "templates.monitoring.description",
    placeholderKey: "templates.monitoring.placeholder",
    intentGuidance: {
      en: "Recurring tracking of a topic, market, or competitor. Emphasize what changed, dates, and comparable metrics. Schedule should reflect how often updates matter to the user.",
      es: "Seguimiento periódico de un tema, mercado o competidor. Prioriza qué cambió, fechas y métricas comparables. La programación debe reflejar cada cuánto importan las novedades al usuario.",
    },
  },
  {
    id: "custom",
    nameKey: "templates.custom.name",
    descriptionKey: "templates.custom.description",
    placeholderKey: "templates.custom.placeholder",
    intentGuidance: {
      en: "Fully user-driven. Infer intent, queries, schema, and schedule only from the description and attachments.",
      es: "Totalmente definido por el usuario. Infiere intención, consultas, esquema y programación solo desde la descripción y los archivos adjuntos.",
    },
  },
  // Compatibilidad con agentes existentes
  {
    id: "job-search",
    nameKey: "templates.jobSearch.name",
    descriptionKey: "templates.jobSearch.description",
    placeholderKey: "templates.opportunities.placeholder",
    intentGuidance: {
      en: "Listings and opportunities. Infer job-related fields from the user prompt.",
      es: "Listados y oportunidades. Infiere campos relacionados con empleo desde el prompt del usuario.",
    },
    legacy: true,
  },
  {
    id: "candidate-search",
    nameKey: "templates.candidateSearch.name",
    descriptionKey: "templates.candidateSearch.description",
    placeholderKey: "templates.peopleOrgs.placeholder",
    intentGuidance: {
      en: "People or profiles. Infer relevant attributes from the user prompt.",
      es: "Personas o perfiles. Infiere atributos relevantes desde el prompt del usuario.",
    },
    legacy: true,
  },
  {
    id: "supplier-search",
    nameKey: "templates.supplierSearch.name",
    descriptionKey: "templates.supplierSearch.description",
    placeholderKey: "templates.peopleOrgs.placeholder",
    intentGuidance: {
      en: "Companies or organizations. Infer supplier/partner fields from the user prompt.",
      es: "Empresas u organizaciones. Infiere campos de proveedor/partner desde el prompt del usuario.",
    },
    legacy: true,
  },
];

export const TEMPLATE_OPTIONS = TEMPLATES.filter((t) => !t.legacy);

const CANONICAL_IDS = new Set(TEMPLATE_OPTIONS.map((t) => t.id));

export function resolveTemplateId(id: TemplateId): TemplateId {
  if (CANONICAL_IDS.has(id)) return id;
  const map: Partial<Record<TemplateId, TemplateId>> = {
    "job-search": "opportunities",
    "candidate-search": "people-orgs",
    "supplier-search": "people-orgs",
  };
  return map[id] ?? "custom";
}

export function getTemplate(id: TemplateId): AgentTemplate {
  return (
    TEMPLATES.find((t) => t.id === id) ??
    TEMPLATES.find((t) => t.id === resolveTemplateId(id)) ??
    TEMPLATES.find((t) => t.id === "custom")!
  );
}

export function getTemplatePlaceholderKey(id: TemplateId): string {
  return getTemplate(id).placeholderKey;
}

/** Mensaje de usuario para el planner: pistas suaves, sin esquema fijo */
export function buildPlannerUserMessage(
  userPrompt: string,
  templateId: TemplateId,
  lang: "en" | "es",
  attachmentBlock: string
): string {
  const canonical = resolveTemplateId(templateId);
  const template = getTemplate(canonical);
  const guidance = lang === "es" ? template.intentGuidance.es : template.intentGuidance.en;

  return `Intent category: ${canonical}
Planner hints (soft guidance — adapt fully to the user, do not copy literally):
${guidance}

Rules:
- Derive search queries, output schema, filters, and schedule from the user description.
- Schema: 4–8 domain-specific fields plus "score" and "reason". Use snake_case English names.
- Queries: 2–5 diverse strings in the user's language. Each query MUST include main nouns from the user prompt (not generic-only like "empleo" or "jobs remote").
- NEVER output generic-only queries when the user prompt is specific.
- If reference files are attached, use them for criteria, keywords, and fields.

User description:
${userPrompt}${attachmentBlock}`;
}

export function fallbackSchema(_prompt: string): string[] {
  return ["title", "summary", "source", "url", "score", "reason"];
}

export function fallbackQueries(prompt: string): string[] {
  const trimmed = prompt.trim();
  if (!trimmed) return ["search"];
  const tokens = trimmed
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);
  const core = tokens.slice(0, 8).join(" ");
  const out = new Set<string>([trimmed.slice(0, 120), core]);
  if (core) {
    out.add(`${core} empleo OR jobs`);
    out.add(`site:linkedin.com ${core}`);
    out.add(`site:indeed.com ${core}`);
  }
  return [...out].filter((q) => q.length > 3).slice(0, 6);
}

export function fallbackDedupeFields(schema: string[]): string[] {
  const prefer = ["url", "title", "name", "id"];
  const picked = prefer.filter((f) => schema.includes(f));
  return picked.length > 0 ? picked : ["title", "url"];
}
