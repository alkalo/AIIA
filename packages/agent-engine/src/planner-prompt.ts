import { resolveOpportunitySubtype } from "./opportunity-subtype.js";
import {
  buildPlannerUserMessage,
  fallbackDedupeFields,
  fallbackQueries,
  fallbackSchema,
  getTemplate,
  resolveTemplateId,
} from "./templates.js";

export const PLANNER_JSON_SHAPE = `{
  "name": "string",
  "prompt": "string (refined user prompt)",
  "templateId": "web-research|opportunities|people-orgs|monitoring|custom",
  "opportunitySubtype": "jobs|grants|tenders|events|deals|real_estate|custom",
  "search": {
    "queries": ["search query strings"],
    "sources": [{"type":"duckduckgo"}, {"type":"url","url":"https://..."}, {"type":"rss","url":"https://..."}],
    "requiresLogin": [],
    "maxSources": 120
  },
  "filters": {
    "criteria": "filter criteria description",
    "minScore": 55,
    "dedupe": {"enabled": true, "fields": ["title","url"]}
  },
  "output": {
    "schema": ["field names — infer from user intent"],
    "destinations": ["inbox","excel","csv","email"],
    "excelPath": "%USERPROFILE%/AIIA/exports/agent-name.xlsx",
    "excelMode": "update_same",
    "notify": true,
    "emailTo": "optional@example.com"
  },
  "schedule": {
    "intervalMinutes": 1440,
    "onlyWhenRunning": true,
    "timezone": "Europe/Madrid"
  },
  "effort": "super_high",
  "retentionDays": 90
}`;

export const PLANNER_SYSTEM = `You are an expert agent planner for AIIA. Given a user prompt and optional reference files, generate a JSON AgentSpec (without id/version/status).

Templates are soft intent categories only — never impose a fixed industry schema. Always tailor queries, schema fields, filters, schedule, and maxSources to what the user actually asked for.

maxSources = how many distinct web links to collect and rank (typical: 8–15 quick scan, 25–40 job search, 120–200 real-estate/grants deep research, 50+ general deep research). Prefer higher values when the user wants exhaustive coverage. Default effort to "super_high" or "ultra_high" for property / grant searches.

When the goal is job/vacancy hunting (opportunitySubtype jobs): queries MUST target real job postings, not company or profile pages. Use site: operators for job boards relevant to the role and language (e.g. site:linkedin.com/jobs, site:indeed.com, site:glassdoor.com, and for Spanish roles site:infojobs.net, site:tecnoempleo.com, site:computrabajo.com). Include the exact job title in every query. Set maxSources to 25–40. Avoid bare queries like "empleo" or "jobs".

When the goal is grants/funding (opportunitySubtype grants): set output.schema to scope, organization, program_name, description, max_funding, currency, deadline, url, score, reason. Queries MUST target grant listings and official calls — use site: on government portals, EU funding, and grant aggregators relevant to the user's geography. NEVER use LinkedIn/Indeed. Set maxSources to 100–150, effort to super_high or ultra_high. Include url or rss sources when the user mentions newsletters or specific grant listing pages. dedupe.fields should be organization and program_name.

When the goal is a monthly/weekly "grants & impact news" wrap-up / newsletter (BFGN-style): combine open grants AND sector news. Prefer destinations including "email" (copy-ready plain-text wrap for the human to paste — AIIA NEVER sends mail) plus inbox. Schema should cover both grant fields (program_name, max_funding, deadline, url) and news fields (title, summary, why_it_may_matter, source, publication_date, url). Prioritise Australian purpose-led / social enterprise / philanthropy / First Nations / regional community funding. Schedule ~monthly (intervalMinutes 43200) or weekly (10080). Use Australian English. Prefer effort ultra_high with Gemini when available for editorial curation.

When the goal is real estate / property listings (opportunitySubtype real_estate): set output.schema to title, location, price, summary, url, score, reason. Queries MUST be in the user's language for local markets (Spanish for Spain/Catalonia). Use ONLY real portals: site:idealista.com, site:fotocasa.es, site:habitaclia.com, site:milanuncios.com, site:pisos.com, site:yaencontre.com. NEVER invent domains (no realestate.com.au, no fake *.com portals). Include ONE comarca/zone per query (never pack four zones into one string). Set maxSources to 120–200, effort to super_high or ultra_high (prefer ultra_high for multi-comarca / renovation hunts). Prefer deep Idealista/Fotocasa zone URLs as search.sources (not bare homepages).

Output ONLY valid JSON matching this structure:
${PLANNER_JSON_SHAPE}`;

export function applyPlannerDefaults(
  parsed: Partial<import("./types.js").AgentSpec>,
  userPrompt: string,
  templateId: import("./types.js").TemplateId
): {
  schema: string[];
  queries: string[];
  dedupeFields: string[];
  resolvedTemplateId: import("./types.js").TemplateId;
  opportunitySubtype: import("./types.js").OpportunitySubtype;
} {
  const resolvedTemplateId = resolveTemplateId(
    (parsed.templateId as import("./types.js").TemplateId) ?? templateId
  );
  const draft = {
    prompt: userPrompt,
    templateId: resolvedTemplateId,
    opportunitySubtype: parsed.opportunitySubtype,
    filters: { criteria: parsed.filters?.criteria ?? userPrompt },
    search: { queries: parsed.search?.queries ?? [] },
  } as import("./types.js").AgentSpec;
  const subtype = parsed.opportunitySubtype ?? resolveOpportunitySubtype(draft);
  const schema =
    parsed.output?.schema?.length
      ? parsed.output.schema
      : fallbackSchema(userPrompt, resolvedTemplateId);
  const queries =
    parsed.search?.queries?.length
      ? parsed.search.queries
      : fallbackQueries(userPrompt, resolvedTemplateId);
  const dedupeFields = parsed.filters?.dedupe?.fields?.length
    ? parsed.filters.dedupe.fields
    : fallbackDedupeFields(schema, resolvedTemplateId, userPrompt);

  return { schema, queries, dedupeFields, resolvedTemplateId, opportunitySubtype: subtype };
}

export function buildPlannerChatMessages(
  userPrompt: string,
  templateId: import("./types.js").TemplateId,
  lang: "en" | "es",
  attachmentBlock: string
): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: PLANNER_SYSTEM },
    {
      role: "user",
      content: buildPlannerUserMessage(userPrompt, templateId, lang, attachmentBlock),
    },
  ];
}

// Re-export for tests / UI
export { getTemplate, resolveTemplateId };
