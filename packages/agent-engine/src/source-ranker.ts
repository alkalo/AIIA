import type { LlmClient, ResearchProfile } from "@aiia/ollama-client";
import { defaultLlmTimeoutMs } from "@aiia/ollama-client";
import type { AgentSpec, SearchResult } from "./types.js";
import { rankSearchResults, type SearchHit } from "./search-quality.js";
import { coerceJsonArray } from "./json-utils.js";
import { isGrantTarget, isCurationOpportunityTarget, isRealEstateTarget } from "./opportunity-subtype.js";
import { isDirectGrantUrl, isLowQualityGrantUrl } from "./result-quality.js";
import { isBarePortalHomepage, isRelevantRealEstateHit } from "./real-estate-sources.js";

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

/** Zone deep-link portal seeds should be fetched (Playwright) — bare homepages stay skip. */
function isFetchablePortalSeed(r: { url: string; snippet?: string }, profile: ResearchProfile): boolean {
  if (!/portal seed/i.test(r.snippet ?? "")) return false;
  if (profile.fetchPolicy === "none") return false;
  if (isBarePortalHomepage(r.url)) return false;
  return true;
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
  const heuristic = rankSearchResults(hits, spec, limit)
    .map((r, i) => {
      const isPortalSeed = /portal seed/i.test(r.snippet ?? "");
      const fetchSeed = isFetchablePortalSeed(r, profile);
      const lowGrant =
        (isGrantTarget(spec) || isCurationOpportunityTarget(spec)) &&
        isLowQualityGrantUrl(r.url) &&
        !isDirectGrantUrl(r.url) &&
        !isPortalSeed;
      const offGeo =
        isRealEstateTarget(spec) && !isPortalSeed && !isRelevantRealEstateHit(r, spec);
      return {
        ...r,
        relevance: isPortalSeed
          ? 92
          : offGeo
            ? 5
            : lowGrant
              ? Math.min(40, 70 - i)
              : 70 - i,
        fetchPriority: (offGeo || lowGrant
          ? "skip"
          : fetchSeed
            ? "high"
            : isPortalSeed || profile.fetchPolicy === "none"
              ? "skip"
              : "medium") as FetchPriority,
        rankReason: fetchSeed
          ? "Portal zone seed — fetch listing page"
          : isPortalSeed
            ? "Portal seed — keep for coverage, skip fetch"
            : offGeo
              ? "Outside requested zones / off-topic"
              : lowGrant
                ? "Portal homepage — skip fetch"
                : "Heuristic rank",
      };
    })
    .filter((r) => {
      if (!isRealEstateTarget(spec)) return true;
      if (/portal seed/i.test(r.snippet ?? "")) return true;
      return isRelevantRealEstateHit(r, spec);
    });

  if (!profile.llmRank || hits.length === 0) {
    return applyFetchPolicy(heuristic, profile, limit);
  }

  const rankBatchSize = Math.min(hits.length, Math.max(limit, profile.llmRankBatchSize));
  const batch = hits.slice(0, rankBatchSize);
  try {
    const geoHint = isRealEstateTarget(spec)
      ? " CRITICAL: reject any result outside the exact geographic areas in the goal (e.g. Madrid/Fuenlabrada when goal is Alt Camp/Penedès). Reject recipes, dictionaries, and unrelated pages (relevance 0, fetchPriority skip). Prefer Idealista/Fotocasa deep links in the target comarcas."
      : "";
    const response = await ollama.chat(
      [
        {
          role: "system",
          content: `Score each search result for relevance to the user goal (0-100).
Return JSON array: [{"url":"...", "relevance": 0-100, "fetchPriority": "high"|"medium"|"skip", "reason": "brief"}]
Prioritize authoritative sources matching the goal. Prefer individual grant/call/opportunity/listing pages over portal homepages. Mark low-quality, off-topic, or bare homepage roots as skip.${geoHint}`,
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

    const merged: RankedSource[] = hits
      .filter((r) => {
        if (!isRealEstateTarget(spec)) return true;
        if (/portal seed/i.test(r.snippet ?? "")) return true;
        return isRelevantRealEstateHit(r, spec);
      })
      .map((r) => {
        const isPortalSeed = /portal seed/i.test(r.snippet ?? "");
        const fetchSeed = isFetchablePortalSeed(r, profile);
        const llm = byUrl.get(normalizeUrlKey(r.url));
        const relevance = isPortalSeed
          ? Math.max(90, llm?.relevance ?? 90)
          : (llm?.relevance ?? 50);
        return {
          ...r,
          relevance,
          fetchPriority: (fetchSeed
            ? "high"
            : isPortalSeed
              ? "skip"
              : llm?.fetchPriority ?? (relevance >= 60 ? "medium" : "skip")) as FetchPriority,
          rankReason: fetchSeed
            ? "Portal zone seed — fetch listing page"
            : isPortalSeed
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
    ...pinned.map((r) => {
      const fetchSeed = isFetchablePortalSeed(r, profile);
      return {
        ...r,
        fetchPriority: (fetchSeed ? "high" : "skip") as FetchPriority,
        relevance: Math.max(r.relevance ?? 0, fetchSeed ? 92 : 78),
        rankReason:
          r.rankReason ??
          (fetchSeed
            ? "Portal zone seed — fetch listing page"
            : "Portal seed — keep for coverage, skip fetch"),
      };
    }),
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
