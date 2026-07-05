import type { ResearchProfile, BudgetPhase } from "@aiia/ollama-client";

export function fetchLimitForBudget(
  total: number,
  profile: ResearchProfile,
  phase: BudgetPhase
): number {
  if (profile.fetchPolicy === "none") return 0;
  let ratio = profile.fetchRatio;
  if (phase === "tight") ratio *= 0.5;
  if (phase === "critical") ratio *= 0.25;
  return Math.min(total, Math.max(profile.fetchPolicy === "top" ? 3 : 1, Math.ceil(total * ratio)));
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
