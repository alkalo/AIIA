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
  "search": {
    "queries": ["search query strings"],
    "sources": [{"type":"duckduckgo"}],
    "requiresLogin": [],
    "maxSources": 25
  },
  "filters": {
    "criteria": "filter criteria description",
    "minScore": 55,
    "dedupe": {"enabled": true, "fields": ["title","url"]}
  },
  "output": {
    "schema": ["field names — infer from user intent"],
    "destinations": ["inbox","excel","csv"],
    "excelPath": "%USERPROFILE%/AIIA/exports/agent-name.xlsx",
    "excelMode": "update_same",
    "notify": true
  },
  "schedule": {
    "intervalMinutes": 1440,
    "onlyWhenRunning": true,
    "timezone": "Europe/Madrid"
  },
  "effort": "medium",
  "retentionDays": 90
}`;

export const PLANNER_SYSTEM = `You are an expert agent planner for AIIA. Given a user prompt and optional reference files, generate a JSON AgentSpec (without id/version/status).

Templates are soft intent categories only — never impose a fixed industry schema. Always tailor queries, schema fields, filters, schedule, and maxSources to what the user actually asked for.

maxSources = how many distinct web links to collect and rank (typical: 8–15 quick scan, 25–40 job/opportunity search, 50+ deep research). Set lower for narrow alerts, higher when the user wants exhaustive coverage.

When the goal is job/vacancy hunting: queries MUST target real job postings, not company or profile pages. Use site: operators for job boards relevant to the role and language (e.g. site:linkedin.com/jobs, site:indeed.com, site:glassdoor.com, and for Spanish roles site:infojobs.net, site:tecnoempleo.com, site:computrabajo.com). Include the exact job title in every query. Set maxSources to 25–40. Avoid bare queries like "empleo" or "jobs".

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
} {
  const resolvedTemplateId = resolveTemplateId(
    (parsed.templateId as import("./types.js").TemplateId) ?? templateId
  );
  const schema =
    parsed.output?.schema?.length ? parsed.output.schema : fallbackSchema(userPrompt);
  const queries =
    parsed.search?.queries?.length ? parsed.search.queries : fallbackQueries(userPrompt);
  const dedupeFields = parsed.filters?.dedupe?.fields?.length
    ? parsed.filters.dedupe.fields
    : fallbackDedupeFields(schema);

  return { schema, queries, dedupeFields, resolvedTemplateId };
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
