import type { LlmClient, ResearchProfile } from "@aiia/ollama-client";
import { defaultLlmTimeoutMs } from "@aiia/ollama-client";
import type { AgentSpec } from "./types.js";
import { buildQueriesFromPrompt } from "./query-replan.js";
import { resolveTemplateId } from "./templates.js";
import { coerceJsonObject } from "./json-utils.js";
import { isRealEstateTarget } from "./opportunity-subtype.js";
import {
  REAL_ESTATE_ALLOWED_HOSTS,
  sanitizePortalsList,
  sanitizeSiteQueries,
  realEstateSeedQueries,
} from "./real-estate-sources.js";

export interface PlannedQuery {
  query: string;
  priority: number;
}

export interface SearchPlan {
  intent: string;
  sourceTypes: string[];
  portals: string[];
  queries: PlannedQuery[];
  coverageCriteria: string;
  avoid: string[];
}

export function fallbackSearchPlan(spec: AgentSpec): SearchPlan {
  const built = isRealEstateTarget(spec)
    ? realEstateSeedQueries(spec, 12)
    : buildQueriesFromPrompt(spec);
  return {
    intent: spec.prompt,
    sourceTypes: isRealEstateTarget(spec)
      ? ["property portals", "real estate listings"]
      : ["web"],
    portals: isRealEstateTarget(spec) ? [...REAL_ESTATE_ALLOWED_HOSTS] : [],
    queries: built.map((q, i) => ({ query: q, priority: built.length - i })),
    coverageCriteria: spec.filters.criteria || "Relevant results matching the user goal",
    avoid: isRealEstateTarget(spec)
      ? ["invented domains", "job boards", "Australia/US portals unless asked"]
      : [],
  };
}

export async function buildSearchPlan(
  spec: AgentSpec,
  profile: ResearchProfile,
  ollama: LlmClient,
  plannerModel: string,
  numCtx: number
): Promise<SearchPlan> {
  const fallback = fallbackSearchPlan(spec);
  if (!profile.llmPlan) return fallback;

  try {
    const response = await ollama.chat(
      [
        {
          role: "system",
          content: `You are a research strategist. Given a user goal, produce a JSON search plan:
{
  "intent": "one sentence",
  "sourceTypes": ["job boards", "official sites", ...],
  "portals": ["linkedin.com/jobs", ...],
  "queries": [{"query": "specific search string", "priority": 1-10}],
  "coverageCriteria": "how to know coverage is sufficient",
  "avoid": ["things to exclude"]
}
Each query MUST include key terms from the goal. Use site: operators ONLY on real, well-known portals — never invent domain names.
For Spain/Catalonia property searches: write queries in Spanish; portals must be idealista.com, fotocasa.es, habitaclia.com, milanuncios.com, pisos.com, yaencontre.com. Never use realestate.com.au or fake regional *.com hosts.
Write search queries in English when the goal targets Australia, New Zealand, global, or English-language portals — even if the goal text is in Spanish.
Return ONLY valid JSON.`,
        },
        {
          role: "user",
          content: `Goal: ${spec.prompt}\nCriteria: ${spec.filters.criteria}\nTemplate: ${resolveTemplateId((spec.templateId ?? "custom") as import("./types.js").TemplateId)}${isRealEstateTarget(spec) ? "\nSubtype: real_estate (Spanish property portals only)" : ""}`,
        },
      ],
      { model: plannerModel, temperature: 0.35, format: "json", numCtx, timeoutMs: defaultLlmTimeoutMs(plannerModel) }
    );
    const parsed = (coerceJsonObject<Partial<SearchPlan>>(response) ?? {}) as Partial<SearchPlan>;
    const queries: PlannedQuery[] = Array.isArray(parsed.queries)
      ? parsed.queries
          .map((q) => {
            if (typeof q === "string") return { query: q, priority: 5 };
            if (q && typeof q === "object" && "query" in q) {
              return {
                query: String((q as PlannedQuery).query),
                priority: Number((q as PlannedQuery).priority) || 5,
              };
            }
            return null;
          })
          .filter((q): q is PlannedQuery => !!q && q.query.trim().length > 3)
      : fallback.queries;

    let portals = parsed.portals ?? fallback.portals;
    let cleanedQueries = queries.length > 0 ? queries : fallback.queries;
    if (isRealEstateTarget(spec)) {
      portals = sanitizePortalsList(
        portals.length > 0 ? portals : [...REAL_ESTATE_ALLOWED_HOSTS],
        REAL_ESTATE_ALLOWED_HOSTS
      );
      if (portals.length === 0) portals = [...REAL_ESTATE_ALLOWED_HOSTS];
      const sanitized = sanitizeSiteQueries(
        cleanedQueries.map((q) => q.query),
        REAL_ESTATE_ALLOWED_HOSTS
      );
      cleanedQueries =
        sanitized.length > 0
          ? sanitized.map((query, i) => ({
              query,
              priority: cleanedQueries[i]?.priority ?? 5,
            }))
          : fallback.queries;
    }

    return {
      intent: parsed.intent ?? fallback.intent,
      sourceTypes: parsed.sourceTypes?.length ? parsed.sourceTypes : fallback.sourceTypes,
      portals,
      queries: cleanedQueries,
      coverageCriteria: parsed.coverageCriteria ?? fallback.coverageCriteria,
      avoid: parsed.avoid ?? fallback.avoid,
    };
  } catch {
    return fallback;
  }
}

export function queriesFromPlan(plan: SearchPlan): string[] {
  return [...plan.queries]
    .sort((a, b) => b.priority - a.priority)
    .map((q) => q.query.trim())
    .filter(Boolean);
}

export interface CoverageAnalysis {
  sufficient: boolean;
  gaps: string[];
  newQueries: string[];
}

export async function analyzeCoverage(
  spec: AgentSpec,
  plan: SearchPlan,
  collected: { title: string; url: string; snippet: string }[],
  ollama: LlmClient,
  plannerModel: string,
  numCtx: number
): Promise<CoverageAnalysis> {
  const sample = collected.slice(0, 25).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet.slice(0, 150),
  }));

  try {
    const response = await ollama.chat(
      [
        {
          role: "system",
          content: `Analyze search coverage for the user goal. Return JSON:
{"sufficient": boolean, "gaps": ["what is missing"], "newQueries": ["follow-up searches"]}
If coverage is good enough, sufficient=true and newQueries=[]. Return ONLY JSON.`,
        },
        {
          role: "user",
          content: `Goal: ${spec.prompt}\nCoverage criteria: ${plan.coverageCriteria}\nFound ${collected.length} sources:\n${JSON.stringify(sample)}`,
        },
      ],
      { model: plannerModel, temperature: 0.3, format: "json", numCtx, timeoutMs: defaultLlmTimeoutMs(plannerModel) }
    );
    const parsed = (coerceJsonObject<CoverageAnalysis>(response) ?? {
      sufficient: true,
      gaps: [],
      newQueries: [],
    }) as CoverageAnalysis;
    return {
      sufficient: !!parsed.sufficient,
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.filter((g) => typeof g === "string") : [],
      newQueries: Array.isArray(parsed.newQueries)
        ? parsed.newQueries.filter((q): q is string => typeof q === "string" && q.trim().length > 3)
        : [],
    };
  } catch {
    const blob = `${spec.prompt} ${spec.filters.criteria}`;
    const auNz = /australia|new zealand|au\b|nz\b/i.test(blob);
    const fallback = auNz
      ? [
          "community grant australia open deadline",
          "new zealand community wellbeing grant open",
          "site:business.gov.au grants community",
          "site:frrr.org.au funding grant",
        ]
      : [
          "grant open deadline funding opportunity",
          "community foundation grant application",
        ];
    return { sufficient: false, gaps: ["coverage analysis failed"], newQueries: fallback };
  }
}
