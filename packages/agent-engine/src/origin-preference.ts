/**
 * Prefer discovery channels that historically produced finals (from health-history originCounts).
 * Complements host-health: channel-level rather than host-level.
 */
import type { HealthHistoryEntry } from "./source-health.js";
import {
  classifyDiscoveryOrigin,
  type DiscoveryOriginId,
} from "./discovery-origin.js";

export interface OriginBoostable {
  url: string;
  relevance?: number;
  fetchPriority: "high" | "medium" | "skip";
  snippet?: string;
  rankReason?: string;
}

/** Sum originCounts across recent history (weight exhausted SERP runs lightly). */
export function accumulateOriginScores(
  entries: HealthHistoryEntry[]
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const e of entries.slice(-12)) {
    const oc = e.originCounts;
    if (!oc || Object.keys(oc).length === 0) continue;
    const weight = e.serpExhausted ? 1.15 : 1; // when SERP dies, non-SERP origins matter more
    for (const [id, n] of Object.entries(oc)) {
      if (!n || n <= 0) continue;
      scores.set(id, (scores.get(id) ?? 0) + n * weight);
    }
  }
  return scores;
}

/**
 * Origin → relevance delta (−6 … +14).
 * Strong historical channels get a fetch boost; chronically weak SERP gets a gentle demotion.
 */
export function originBoostMapFromHistory(
  entries: HealthHistoryEntry[]
): Map<DiscoveryOriginId, number> {
  const scores = accumulateOriginScores(entries);
  const map = new Map<DiscoveryOriginId, number>();
  if (scores.size === 0) return map;

  let total = 0;
  for (const n of scores.values()) total += n;
  if (total < 4) return map; // too little signal

  for (const [id, n] of scores.entries()) {
    const share = n / total;
    let delta = 0;
    if (share >= 0.35) delta = 14;
    else if (share >= 0.22) delta = 10;
    else if (share >= 0.12) delta = 6;
    else if (share >= 0.06) delta = 3;
    else if (id === "serp" && share < 0.08) delta = -6;
    else if (id === "other" && share < 0.05) delta = -2;
    if (delta !== 0) map.set(id as DiscoveryOriginId, delta);
  }
  return map;
}

/** Apply channel preference to ranked sources (re-sort by relevance). */
export function applyOriginPreferenceBoost<T extends OriginBoostable>(
  ranked: T[],
  boosts: Map<DiscoveryOriginId, number>
): T[] {
  if (boosts.size === 0 || ranked.length === 0) return ranked;
  const next = ranked.map((r) => {
    const origin = classifyDiscoveryOrigin(r.rankReason, r.snippet);
    const delta = boosts.get(origin) ?? 0;
    if (!delta) return r;
    const relevance = Math.max(0, Math.min(100, (r.relevance ?? 50) + delta));
    let fetchPriority = r.fetchPriority;
    if (delta >= 8 && r.fetchPriority === "medium") fetchPriority = "high";
    else if (delta <= -6 && r.fetchPriority === "medium") fetchPriority = "skip";
    return {
      ...r,
      relevance,
      fetchPriority,
      rankReason:
        delta > 0
          ? `${r.rankReason ?? "rank"} · origin-pref ${origin} +${delta}`
          : `${r.rankReason ?? "rank"} · origin-pref ${origin} ${delta}`,
    };
  });
  next.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  return next;
}

export function formatOriginBoostSummary(
  boosts: Map<DiscoveryOriginId, number>
): string {
  return [...boosts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, d]) => `${id}:${d > 0 ? "+" : ""}${d}`)
    .join(", ");
}

/** RSS share of historical finals (0–1). */
export function rssShareFromHistory(entries: HealthHistoryEntry[]): number {
  const scores = accumulateOriginScores(entries);
  let total = 0;
  for (const n of scores.values()) total += n;
  if (total < 4) return 0;
  return (scores.get("rss") ?? 0) / total;
}

/**
 * Raise feed fetch cap when RSS historically produced many finals.
 * Opp base ~28 → up to 36; news base ~16 → up to 22.
 */
export function feedCapForHistory(
  baseCap: number,
  entries: HealthHistoryEntry[]
): { cap: number; rssShare: number; extra: number } {
  const rssShare = rssShareFromHistory(entries);
  let extra = 0;
  if (rssShare >= 0.35) extra = 10;
  else if (rssShare >= 0.22) extra = 6;
  else if (rssShare >= 0.12) extra = 4;
  const maxCap = baseCap >= 24 ? 36 : 22;
  return {
    cap: Math.min(maxCap, baseCap + extra),
    rssShare,
    extra,
  };
}

/** Share of finals from listing-expand + depth-2 (0–1). */
export function expandShareFromHistory(entries: HealthHistoryEntry[]): number {
  const scores = accumulateOriginScores(entries);
  let total = 0;
  for (const n of scores.values()) total += n;
  if (total < 4) return 0;
  const expand =
    (scores.get("listing-expand") ?? 0) + (scores.get("depth-2") ?? 0);
  return expand / total;
}

/**
 * Extra listing-expand candidate slots when expand historically produced finals.
 * Added on top of exhaustive/gap caps (bounded in expandCapForExhaustive).
 */
export function expandCapExtraFromHistory(entries: HealthHistoryEntry[]): number {
  const share = expandShareFromHistory(entries);
  if (share >= 0.35) return 24;
  if (share >= 0.22) return 16;
  if (share >= 0.12) return 10;
  return 0;
}

/**
 * Raise listing pagination budget when expand historically produced finals.
 * Base: 2 pages × 4 hubs → up to 5 pages × 8 hubs.
 */
export function paginationBudgetFromHistory(entries: HealthHistoryEntry[]): {
  pagesPerHub: number;
  maxHubs: number;
  share: number;
  detail: string;
} {
  const share = expandShareFromHistory(entries);
  let pagesPerHub = 2;
  let maxHubs = 4;
  if (share >= 0.35) {
    pagesPerHub = 5;
    maxHubs = 8;
  } else if (share >= 0.22) {
    pagesPerHub = 4;
    maxHubs = 6;
  } else if (share >= 0.12) {
    pagesPerHub = 3;
    maxHubs = 5;
  }
  return {
    pagesPerHub,
    maxHubs,
    share,
    detail: pagesPerHub > 2 || maxHubs > 4 ? `${pagesPerHub}p×${maxHubs}h` : "",
  };
}

/** Share of finals from depth-2 alone (0–1). */
export function depth2ShareFromHistory(entries: HealthHistoryEntry[]): number {
  const scores = accumulateOriginScores(entries);
  let total = 0;
  for (const n of scores.values()) total += n;
  if (total < 4) return 0;
  return (scores.get("depth-2") ?? 0) / total;
}

/**
 * Raise depth-2 crawl cap when that channel historically produced finals.
 * Base typically 6–16 → up to 28.
 */
export function depth2CapForHistory(
  baseCap: number,
  entries: HealthHistoryEntry[]
): { cap: number; share: number; extra: number } {
  const share = depth2ShareFromHistory(entries);
  let extra = 0;
  if (share >= 0.22) extra = 12;
  else if (share >= 0.12) extra = 8;
  else if (share >= 0.06) extra = 4;
  return {
    cap: Math.min(28, baseCap + extra),
    share,
    extra,
  };
}

/** Share of finals from gap-fill alone (0–1). */
export function gapFillShareFromHistory(entries: HealthHistoryEntry[]): number {
  const scores = accumulateOriginScores(entries);
  let total = 0;
  for (const n of scores.values()) total += n;
  if (total < 4) return 0;
  return (scores.get("gap-fill") ?? 0) / total;
}

/**
 * Extra mid-run gap-fill portal seeds when that channel historically produced finals.
 * Added on top of exhaustive/region base caps (bounded ≤36).
 */
export function gapFillCapExtraFromHistory(entries: HealthHistoryEntry[]): number {
  const share = gapFillShareFromHistory(entries);
  if (share >= 0.22) return 12;
  if (share >= 0.12) return 8;
  if (share >= 0.06) return 4;
  return 0;
}

/** Portal-seed share of historical finals (0–1). */
export function portalSeedShareFromHistory(entries: HealthHistoryEntry[]): number {
  const scores = accumulateOriginScores(entries);
  let total = 0;
  for (const n of scores.values()) total += n;
  if (total < 4) return 0;
  const seeds = (scores.get("portal-seed") ?? 0) + (scores.get("gap-fill") ?? 0);
  return seeds / total;
}

const PINNABLE_ORIGINS: DiscoveryOriginId[] = [
  "portal-seed",
  "gap-fill",
  "rss",
  "listing-expand",
  "depth-2",
];

function deltaForShare(share: number): number {
  if (share >= 0.35) return 14;
  if (share >= 0.22) return 10;
  if (share >= 0.12) return 6;
  return 0;
}

/**
 * Pin candidates from historically strong non-SERP channels to fetchPriority high
 * so SERP noise cannot crowd them out of the fetch budget.
 * Covers portal-seed, gap-fill, rss, listing-expand, depth-2.
 */
export function pinStrongOriginsFromHistory<T extends OriginBoostable>(
  ranked: T[],
  entries: HealthHistoryEntry[]
): {
  ranked: T[];
  pinned: number;
  byOrigin: Record<string, number>;
  strongOrigins: string[];
} {
  const empty = { ranked, pinned: 0, byOrigin: {}, strongOrigins: [] as string[] };
  if (ranked.length === 0) return empty;

  const scores = accumulateOriginScores(entries);
  let total = 0;
  for (const n of scores.values()) total += n;
  if (total < 4) return empty;

  const originDelta = new Map<DiscoveryOriginId, number>();
  const strongOrigins: string[] = [];
  for (const id of PINNABLE_ORIGINS) {
    const share = (scores.get(id) ?? 0) / total;
    const delta = deltaForShare(share);
    if (delta > 0) {
      originDelta.set(id, delta);
      strongOrigins.push(`${id}:${Math.round(share * 100)}%`);
    }
  }
  if (originDelta.size === 0) return empty;

  const byOrigin: Record<string, number> = {};
  let pinned = 0;
  const next = ranked.map((r) => {
    const origin = classifyDiscoveryOrigin(r.rankReason, r.snippet);
    const delta = originDelta.get(origin);
    if (!delta) return r;
    pinned += 1;
    byOrigin[origin] = (byOrigin[origin] ?? 0) + 1;
    const relevance = Math.max(0, Math.min(100, (r.relevance ?? 50) + delta));
    const fetchPriority =
      r.fetchPriority === "skip" ? r.fetchPriority : ("high" as const);
    return {
      ...r,
      relevance,
      fetchPriority,
      rankReason: `${r.rankReason ?? "rank"} · origin-pin:${origin} +${delta}`,
    };
  });
  next.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  return { ranked: next, pinned, byOrigin, strongOrigins };
}

/** @deprecated Use pinStrongOriginsFromHistory */
export function pinPortalSeedsFromHistory<T extends OriginBoostable>(
  ranked: T[],
  entries: HealthHistoryEntry[]
): { ranked: T[]; share: number; pinned: number; delta: number } {
  const share = portalSeedShareFromHistory(entries);
  const full = pinStrongOriginsFromHistory(ranked, entries);
  const seedPinned =
    (full.byOrigin["portal-seed"] ?? 0) + (full.byOrigin["gap-fill"] ?? 0);
  return {
    ranked: full.ranked,
    share,
    pinned: seedPinned,
    delta: deltaForShare(share),
  };
}
