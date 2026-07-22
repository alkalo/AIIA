import type { AgentSpec, EffortLevel, OpportunitySubtype } from "./types.js";
import {
  defaultDedupeFields,
  isRealEstateTarget,
  resolveOpportunitySubtype,
} from "./opportunity-subtype.js";

const VALID_EFFORTS: EffortLevel[] = [
  "low",
  "medium",
  "high",
  "super_high",
  "ultra_high",
];

const EFFORT_RANK: Record<EffortLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  super_high: 3,
  ultra_high: 4,
};

function validEffort(value: unknown): EffortLevel {
  if (typeof value === "string" && VALID_EFFORTS.includes(value as EffortLevel)) {
    return value as EffortLevel;
  }
  return "medium";
}

function atLeastEffort(current: EffortLevel, min: EffortLevel): EffortLevel {
  return EFFORT_RANK[current] >= EFFORT_RANK[min] ? current : min;
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

  let effort = validEffort(spec.effort);
  let maxSources = spec.search?.maxSources;
  const draft = { ...spec, opportunitySubtype } as AgentSpec;
  if (isRealEstateTarget(draft) || opportunitySubtype === "real_estate") {
    // Property searches need deep portal coverage — never leave medium/high + thin link caps.
    effort = atLeastEffort(effort, "super_high");
    if (maxSources == null || maxSources < 120) maxSources = Math.max(maxSources ?? 0, 120);
  }

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
      ...(maxSources != null && maxSources > 0 ? { maxSources } : {}),
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
    effort,
    retentionDays: spec.retentionDays ?? 90,
    status: spec.status ?? "draft",
  };
}
