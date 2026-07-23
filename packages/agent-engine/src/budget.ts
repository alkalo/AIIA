import type { ResearchProfile, BudgetPhase } from "@aiia/ollama-client";

export function fetchLimitForBudget(
  total: number,
  profile: ResearchProfile,
  phase: BudgetPhase,
  pinnedHigh = 0,
  /** Extra slots for multi-region opportunity coverage (best-effort). */
  regionBoost = 0
): number {
  if (profile.fetchPolicy === "none") return 0;
  let ratio = profile.fetchRatio;
  if (phase === "tight") ratio *= 0.5;
  if (phase === "critical") ratio *= 0.25;
  const computed = Math.min(
    total,
    Math.max(profile.fetchPolicy === "top" ? 3 : 1, Math.ceil(total * ratio))
  );
  const withBoost = computed + Math.max(0, regionBoost);
  // Always fetch every high-priority portal seed even late in the wall-clock.
  return Math.min(total, Math.max(withBoost, pinnedHigh));
}

/**
 * Boost page-fetch budget when the agent targets many regions (exhaustive opportunities).
 * Caps at +18 so wall-clock stays bounded.
 */
export function regionFetchBoost(regionCount: number, exhaustiveGlobal: boolean): number {
  if (regionCount <= 1 && !exhaustiveGlobal) return 0;
  const perRegion = Math.max(0, regionCount - 1) * 2;
  const globalExtra = exhaustiveGlobal ? 6 : 0;
  return Math.min(18, perRegion + globalExtra);
}

/**
 * Extra fetch slots when mid-run coverage already shows empty regions
 * (or ranked URLs lack those hosts). Critical phase keeps a smaller bump.
 */
export function gapFetchBoost(gapCount: number, phase: BudgetPhase): number {
  if (gapCount <= 0) return 0;
  if (phase === "critical") return Math.min(4, gapCount * 2);
  if (phase === "tight") return Math.min(8, gapCount * 2);
  return Math.min(12, gapCount * 3);
}

/**
 * Listing-expand candidate cap — higher for exhaustive / gap-heavy runs.
 */
export function expandCapForExhaustive(
  maxSources: number,
  opts: { exhaustive?: boolean; gapCount?: number } = {}
): number {
  const base = Math.min(80, Math.max(24, Math.floor(maxSources / 3)));
  const exhaustive = Boolean(opts.exhaustive);
  const gaps = Math.max(0, opts.gapCount ?? 0);
  if (!exhaustive && gaps === 0) return base;
  const extra = exhaustive ? 24 : 0;
  const gapExtra = Math.min(30, gaps * 6);
  return Math.min(120, base + extra + gapExtra);
}

export function extractLimitForBudget(
  total: number,
  profile: ResearchProfile,
  phase: BudgetPhase
): number {
  if (profile.extractPolicy === "serp_only") return 0;
  if (profile.extractPolicy === "all_ranked" && phase !== "critical") return total;
  let k = profile.extractTopK;
  if (phase === "tight") k = Math.ceil(k * 0.6);
  if (phase === "critical") k = Math.min(k, Math.max(3, Math.ceil(k * 0.35)));
  return Math.min(total, k);
}
