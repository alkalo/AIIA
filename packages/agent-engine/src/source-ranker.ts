import type { LlmClient, ResearchProfile } from "@aiia/ollama-client";
import { defaultLlmTimeoutMs } from "@aiia/ollama-client";
import type { AgentSpec, SearchResult } from "./types.js";
import { rankSearchResults, type SearchHit } from "./search-quality.js";
import { coerceJsonArray } from "./json-utils.js";
import { isGrantTarget } from "./opportunity-subtype.js";
import { isDirectGrantUrl, isLowQualityGrantUrl } from "./result-quality.js";

export type FetchPriority = "high" | "medium" | "skip";

export interface RankedSource extends SearchResult {
  relevance: number;
  fetchPriority: FetchPriority;
  rankReason?: string;
}

interface LlmRankItem {
  url: string;
  relevance: number;
  fetchPriority: FetchPriority;
  reason?: string;
}

export async function rankSources(
  hits: SearchHit[],
  spec: AgentSpec,
  profile: ResearchProfile,
  limit: number,
  ollama: LlmClient,
  plannerModel: string,
  numCtx: number
): Promise<RankedSource[]> {
  const heuristic = rankSearchResults(hits, spec, limit).map((r, i) => {
    const isPortalSeed = /portal seed/i.test(r.snippet ?? "");
    const lowGrant =
      isGrantTarget(spec) &&
      isLowQualityGrantUrl(r.url) &&
      !isDirectGrantUrl(r.url) &&
      !isPortalSeed;
    return {
      ...r,
      relevance: isPortalSeed ? 78 : lowGrant ? Math.min(40, 70 - i) : 70 - i,
      fetchPriority: (profile.fetchPolicy === "none" || lowGrant || isPortalSeed
        ? "skip"
        : "medium") as FetchPriority,
      rankReason: isPortalSeed
        ? "Portal seed — keep for coverage, skip fetch"
        : lowGrant
          ? "Portal homepage — skip fetch"
          : "Heuristic rank",
    };
  });

  if (!profile.llmRank || hits.length === 0) {
    return applyFetchPolicy(heuristic, profile, limit);
  }

  const rankBatchSize = Math.min(hits.length, Math.max(limit, profile.llmRankBatchSize));
  const batch = hits.slice(0, rankBatchSize);
  try {
    const response = await ollama.chat(
      [
        {
          role: "system",
          content: `Score each search result for relevance to the user goal (0-100).
Return JSON array: [{"url":"...", "relevance": 0-100, "fetchPriority": "high"|"medium"|"skip", "reason": "brief"}]
Prioritize authoritative sources matching the goal. Prefer individual grant/call/opportunity pages over portal homepages or generic /grants finders. Mark low-quality, off-topic, or bare homepage roots as skip.`,
        },
        {
          role: "user",
          content: `Goal: ${spec.prompt}\nCriteria: ${spec.filters.criteria}\nResults:\n${JSON.stringify(
            batch.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet.slice(0, 200) }))
          )}`,
        },
      ],
      { model: plannerModel, temperature: 0.25, format: "json", numCtx, timeoutMs: defaultLlmTimeoutMs(plannerModel) }
    );
    const scored = coerceJsonArray<LlmRankItem>(response);
    if (scored.length === 0) return applyFetchPolicy(heuristic, profile, limit);

    const byUrl = new Map<string, LlmRankItem>();
    for (const s of scored) {
      if (s?.url) byUrl.set(normalizeUrlKey(s.url), s);
    }

    const merged: RankedSource[] = hits.map((r) => {
      const isPortalSeed = /portal seed/i.test(r.snippet ?? "");
      const llm = byUrl.get(normalizeUrlKey(r.url));
      const relevance = isPortalSeed
        ? Math.max(78, llm?.relevance ?? 78)
        : (llm?.relevance ?? 50);
      return {
        ...r,
        relevance,
        fetchPriority: (isPortalSeed
          ? "skip"
          : llm?.fetchPriority ?? (relevance >= 60 ? "medium" : "skip")) as FetchPriority,
        rankReason: isPortalSeed
          ? "Portal seed — keep for coverage, skip fetch"
          : llm?.reason ?? "LLM rank",
      };
    });

    merged.sort((a, b) => b.relevance - a.relevance);
    return applyFetchPolicy(merged, profile, limit);
  } catch {
    return applyFetchPolicy(heuristic, profile, limit);
  }
}

function applyFetchPolicy(
  ranked: RankedSource[],
  profile: ResearchProfile,
  limit: number
): RankedSource[] {
  const pinned = ranked.filter((r) => /portal seed/i.test(r.snippet ?? ""));
  const rest = ranked.filter((r) => !/portal seed/i.test(r.snippet ?? ""));
  const room = Math.max(0, limit - pinned.length);
  const merged = [
    ...pinned.map((r) => ({
      ...r,
      fetchPriority: "skip" as FetchPriority,
      relevance: Math.max(r.relevance ?? 0, 78),
      rankReason: r.rankReason ?? "Portal seed — keep for coverage, skip fetch",
    })),
    ...rest.slice(0, room),
  ];
  if (profile.fetchPolicy === "none") {
    return merged.map((r) => ({ ...r, fetchPriority: "skip" as FetchPriority }));
  }
  return merged;
}

export function sourcesToFetch(
  ranked: RankedSource[],
  fetchLimit: number
): RankedSource[] {
  return ranked.filter((r) => r.fetchPriority !== "skip").slice(0, fetchLimit);
}

function normalizeUrlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}
