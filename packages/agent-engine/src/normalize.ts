import type { AgentSpec, EffortLevel, OpportunitySubtype } from "./types.js";
import {
  defaultDedupeFields,
  defaultOutputSchema,
  isGrantTarget,
  isRealEstateTarget,
  isSectorNewsTarget,
  isCurationOpportunityTarget,
  resolveOpportunitySubtype,
  resolveContentMode,
} from "./opportunity-subtype.js";
import { isNewsletterWrapTarget } from "./newsletter.js";

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

  const opportunitySubtype: OpportunitySubtype | undefined =
    spec.opportunitySubtype ?? resolveOpportunitySubtype(spec as AgentSpec);
  const contentMode = spec.contentMode ?? resolveContentMode({ ...spec, opportunitySubtype } as AgentSpec);

  const draft = { ...spec, opportunitySubtype, contentMode } as AgentSpec;
  const schema =
    spec.output?.schema?.filter(Boolean)?.length
      ? spec.output.schema.filter(Boolean)
      : defaultOutputSchema(draft);
  const destinations = spec.output?.destinations?.length
    ? spec.output.destinations
    : (["inbox"] as AgentSpec["output"]["destinations"]);

  const dedupeFields =
    spec.filters?.dedupe?.fields?.length
      ? spec.filters.dedupe.fields
      : defaultDedupeFields(draft);

  let effort = validEffort(spec.effort);
  let maxSources = spec.search?.maxSources;
  if (isRealEstateTarget(draft) || opportunitySubtype === "real_estate") {
    effort = atLeastEffort(effort, "super_high");
    if (maxSources == null || maxSources < 120) maxSources = Math.max(maxSources ?? 0, 120);
  } else if (
    isGrantTarget(draft) ||
    isCurationOpportunityTarget(draft) ||
    opportunitySubtype === "grants" ||
    opportunitySubtype === "programs" ||
    opportunitySubtype === "awards" ||
    opportunitySubtype === "exposure"
  ) {
    effort = atLeastEffort(effort, "super_high");
    if (maxSources == null || maxSources < 100) maxSources = Math.max(maxSources ?? 0, 100);
  } else if (isSectorNewsTarget(draft) || opportunitySubtype === "sector_news") {
    effort = atLeastEffort(effort, "high");
    if (maxSources == null || maxSources < 60) maxSources = Math.max(maxSources ?? 0, 60);
  }

  const scheduleInterval = spec.schedule?.intervalMinutes ?? 1440;
  const cloudEnabled = Boolean(spec.schedule?.cloudEnabled);
  const onlyWhenRunning = cloudEnabled
    ? false
    : (spec.schedule?.onlyWhenRunning ?? true);

  const requireVerification =
    spec.filters?.requireVerification ??
    (isCurationOpportunityTarget(draft) || isNewsletterWrapTarget(draft));

  const maxAgeDays =
    spec.filters?.maxAgeDays ??
    (isSectorNewsTarget(draft) || isNewsletterWrapTarget(draft) ? 35 : undefined);

  const minDaysRemaining =
    spec.filters?.minDaysRemaining ??
    (isCurationOpportunityTarget(draft) ? 7 : undefined);

  return {
    id: spec.id,
    version: spec.version ?? 1,
    name: spec.name?.trim() || "New Agent",
    prompt: spec.prompt?.trim() || "",
    templateId: spec.templateId,
    opportunitySubtype,
    contentMode: contentMode === "auto" ? undefined : contentMode,
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
      ...(maxAgeDays != null ? { maxAgeDays } : {}),
      ...(minDaysRemaining != null ? { minDaysRemaining } : {}),
      ...(requireVerification ? { requireVerification: true } : {}),
    },
    output: {
      schema,
      destinations,
      excelPath: spec.output?.excelPath,
      excelMode: spec.output?.excelMode ?? "update_same",
      notify: spec.output?.notify ?? true,
      ...(spec.output?.emailTo?.trim() ? { emailTo: spec.output.emailTo.trim() } : {}),
    },
    schedule: {
      intervalMinutes: scheduleInterval,
      onlyWhenRunning,
      ...(cloudEnabled ? { cloudEnabled: true } : {}),
      timezone: spec.schedule?.timezone ?? "Europe/Madrid",
    },
    effort,
    retentionDays: spec.retentionDays ?? 90,
    status: spec.status ?? "draft",
  };
}
