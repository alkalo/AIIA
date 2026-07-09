import type { AgentSpec, EffortLevel, OpportunitySubtype } from "./types.js";
import {
  defaultDedupeFields,
  resolveOpportunitySubtype,
} from "./opportunity-subtype.js";

const VALID_EFFORTS: EffortLevel[] = [
  "low",
  "medium",
  "high",
  "super_high",
  "ultra_high",
];

function validEffort(value: unknown): EffortLevel {
  if (typeof value === "string" && VALID_EFFORTS.includes(value as EffortLevel)) {
    return value as EffortLevel;
  }
  return "medium";
}

/** Ensure AgentSpec has all nested fields required by the UI and Rust backend. */
export function normalizeAgentSpec(spec: Partial<AgentSpec> & { id: string }): AgentSpec {
  const queries = spec.search?.queries?.filter(Boolean) ?? [];
  const sources =
    spec.search?.sources && spec.search.sources.length > 0
      ? spec.search.sources
      : [{ type: "duckduckgo" as const }];

  const schema = spec.output?.schema?.filter(Boolean) ?? ["title", "url", "score", "reason"];
  const destinations = spec.output?.destinations?.length
    ? spec.output.destinations
    : (["inbox"] as AgentSpec["output"]["destinations"]);

  const opportunitySubtype: OpportunitySubtype | undefined =
    spec.opportunitySubtype ?? resolveOpportunitySubtype(spec as AgentSpec);

  const dedupeFields =
    spec.filters?.dedupe?.fields?.length
      ? spec.filters.dedupe.fields
      : defaultDedupeFields({ ...spec, opportunitySubtype } as AgentSpec);

  return {
    id: spec.id,
    version: spec.version ?? 1,
    name: spec.name?.trim() || "New Agent",
    prompt: spec.prompt?.trim() || "",
    templateId: spec.templateId,
    opportunitySubtype,
    contextAttachments: spec.contextAttachments,
    search: {
      queries: queries.length > 0 ? queries : [spec.prompt?.slice(0, 100) || "search"],
      sources,
      requiresLogin: spec.search?.requiresLogin ?? [],
      ...(spec.search?.maxSources != null && spec.search.maxSources > 0
        ? { maxSources: spec.search.maxSources }
        : {}),
      ...(spec.search?.maxResultsPerQuery != null && spec.search.maxResultsPerQuery > 0
        ? { maxResultsPerQuery: spec.search.maxResultsPerQuery }
        : {}),
    },
    filters: {
      criteria: spec.filters?.criteria ?? spec.prompt ?? "",
      minScore: spec.filters?.minScore ?? 55,
      dedupe: spec.filters?.dedupe ?? { enabled: true, fields: dedupeFields },
    },
    output: {
      schema,
      destinations,
      excelPath: spec.output?.excelPath,
      excelMode: spec.output?.excelMode ?? "update_same",
      notify: spec.output?.notify ?? true,
    },
    schedule: {
      intervalMinutes: spec.schedule?.intervalMinutes ?? 1440,
      onlyWhenRunning: spec.schedule?.onlyWhenRunning ?? true,
      timezone: spec.schedule?.timezone ?? "Europe/Madrid",
    },
    effort: validEffort(spec.effort),
    retentionDays: spec.retentionDays ?? 90,
    status: spec.status ?? "draft",
  };
}
