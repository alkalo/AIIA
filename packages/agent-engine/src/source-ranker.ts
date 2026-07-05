import type { OllamaClient, ResearchProfile } from "@aiia/ollama-client";
import type { AgentSpec, SearchResult } from "./types.js";
import { rankSearchResults, type SearchHit } from "./search-quality.js";
import { coerceJsonArray } from "./json-utils.js";

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
  ollama: OllamaClient,
  plannerModel: string,
  numCtx: number
): Promise<RankedSource[]> {
  const heuristic = rankSearchResults(hits, spec, limit).map((r, i) => ({
    ...r,
    relevance: 70 - i,
    fetchPriority: profile.fetchPolicy === "none" ? ("skip" as const) : ("medium" as const),
    rankReason: "Heuristic rank",
  }));

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
Prioritize authoritative sources matching the goal. Mark low-quality or off-topic as skip.`,
        },
        {
          role: "user",
          content: `Goal: ${spec.prompt}\nCriteria: ${spec.filters.criteria}\nResults:\n${JSON.stringify(
            batch.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet.slice(0, 200) }))
          )}`,
        },
      ],
      { model: plannerModel, temperature: 0.25, format: "json", numCtx }
    );
    const scored = coerceJsonArray<LlmRankItem>(response);
    if (scored.length === 0) return applyFetchPolicy(heuristic, profile, limit);

    const byUrl = new Map<string, LlmRankItem>();
    for (const s of scored) {
      if (s?.url) byUrl.set(normalizeUrlKey(s.url), s);
    }

    const merged: RankedSource[] = hits.map((r) => {
      const llm = byUrl.get(normalizeUrlKey(r.url));
      const relevance = llm?.relevance ?? 50;
      return {
        ...r,
        relevance,
        fetchPriority: llm?.fetchPriority ?? (relevance >= 60 ? "medium" : "skip"),
        rankReason: llm?.reason ?? "LLM rank",
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
  if (profile.fetchPolicy === "none") {
    return ranked.slice(0, limit).map((r) => ({ ...r, fetchPriority: "skip" }));
  }
  return ranked.slice(0, limit);
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
