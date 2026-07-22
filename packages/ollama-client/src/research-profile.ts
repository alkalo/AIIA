import type { EffortLevel, HardwareInfo } from "./index.js";

export type FetchPolicy = "none" | "top" | "adaptive" | "deep";
export type ExtractPolicy = "serp_only" | "top_k" | "all_ranked";

export interface ResearchProfile {
  wallClockBudgetSec: number;
  searchWaves: number;
  llmPlan: boolean;
  llmRank: boolean;
  llmRankBatchSize: number;
  fetchPolicy: FetchPolicy;
  extractPolicy: ExtractPolicy;
  extractTopK: number;
  fetchRatio: number;
  parallelSearch: number;
  parallelExtract: number;
  gapAnalysis: boolean;
  useCritic: boolean;
  reasoningDepth: 0 | 1 | 2 | 3;
  estimatedMinutes: [number, number];
}

/** Progressive power ladder; ultra_high hard-capped at 4 hours. */
export const RESEARCH_PROFILES: Record<EffortLevel, ResearchProfile> = {
  low: {
    wallClockBudgetSec: 120,
    searchWaves: 1,
    llmPlan: false,
    llmRank: false,
    llmRankBatchSize: 0,
    fetchPolicy: "none",
    extractPolicy: "serp_only",
    extractTopK: 8,
    fetchRatio: 0,
    parallelSearch: 3,
    parallelExtract: 1,
    gapAnalysis: false,
    useCritic: false,
    reasoningDepth: 0,
    estimatedMinutes: [0, 2],
  },
  medium: {
    wallClockBudgetSec: 1200,
    searchWaves: 3,
    llmPlan: true,
    llmRank: true,
    llmRankBatchSize: 22,
    fetchPolicy: "top",
    extractPolicy: "top_k",
    extractTopK: 20,
    fetchRatio: 0.55,
    parallelSearch: 3,
    parallelExtract: 2,
    gapAnalysis: true,
    useCritic: false,
    reasoningDepth: 1,
    estimatedMinutes: [5, 20],
  },
  high: {
    wallClockBudgetSec: 4500,
    searchWaves: 10,
    llmPlan: true,
    llmRank: true,
    llmRankBatchSize: 28,
    fetchPolicy: "adaptive",
    extractPolicy: "top_k",
    extractTopK: 40,
    fetchRatio: 0.75,
    parallelSearch: 3,
    parallelExtract: 3,
    gapAnalysis: true,
    useCritic: true,
    reasoningDepth: 2,
    estimatedMinutes: [30, 75],
  },
  super_high: {
    wallClockBudgetSec: 9000, // 2.5 h
    searchWaves: 24,
    llmPlan: true,
    llmRank: true,
    llmRankBatchSize: 36,
    fetchPolicy: "deep",
    extractPolicy: "all_ranked",
    extractTopK: 100,
    fetchRatio: 0.9,
    parallelSearch: 2,
    parallelExtract: 3,
    gapAnalysis: true,
    useCritic: true,
    reasoningDepth: 2,
    estimatedMinutes: [90, 150],
  },
  ultra_high: {
    // Hard ceiling: 4 hours — deep portal coverage + Playwright fetches
    wallClockBudgetSec: 14400,
    searchWaves: 48,
    llmPlan: true,
    llmRank: true,
    llmRankBatchSize: 56,
    fetchPolicy: "deep",
    extractPolicy: "all_ranked",
    extractTopK: 280,
    fetchRatio: 1,
    parallelSearch: 2,
    parallelExtract: 5,
    gapAnalysis: true,
    useCritic: true,
    reasoningDepth: 3,
    estimatedMinutes: [150, 240],
  },
};

export interface ResolvedModels {
  plannerModel: string;
  extractorModel: string;
  criticModel?: string;
}

const MODEL_LADDER: { model: string; minRamGb: number; minVramGb: number }[] = [
  { model: "qwen2.5:32b", minRamGb: 48, minVramGb: 24 },
  { model: "qwen2.5:14b", minRamGb: 24, minVramGb: 10 },
  { model: "qwen2.5:7b", minRamGb: 8, minVramGb: 6 },
  { model: "qwen2.5:3b", minRamGb: 4, minVramGb: 0 },
  { model: "llama3.2:1b", minRamGb: 0, minVramGb: 0 },
];

function bestLadderIndex(hw: HardwareInfo): number {
  for (let i = 0; i < MODEL_LADDER.length; i++) {
    const e = MODEL_LADDER[i];
    if (hw.totalRamGb >= e.minRamGb || (e.minVramGb > 0 && hw.vramGb >= e.minVramGb)) {
      return i;
    }
  }
  return MODEL_LADDER.length - 1;
}

function modelAt(index: number): string {
  const i = Math.max(0, Math.min(MODEL_LADDER.length - 1, index));
  return MODEL_LADDER[i].model;
}

export function resolveModels(hw: HardwareInfo, effort: EffortLevel): ResolvedModels {
  const best = bestLadderIndex(hw);
  const lighter = best + 1;
  switch (effort) {
    case "ultra_high":
    case "super_high":
    case "high":
      return {
        plannerModel: modelAt(best),
        extractorModel: modelAt(best),
        criticModel: modelAt(best),
      };
    case "medium":
      return {
        plannerModel: modelAt(best),
        extractorModel: modelAt(lighter),
        criticModel: modelAt(best),
      };
    default:
      return {
        plannerModel: modelAt(best),
        extractorModel: modelAt(lighter),
      };
  }
}

export function getResearchProfile(effort: EffortLevel): ResearchProfile {
  return RESEARCH_PROFILES[effort];
}

export type BudgetPhase = "normal" | "tight" | "critical";

export function budgetPhase(startTimeMs: number, profile: ResearchProfile): BudgetPhase {
  const elapsed = (Date.now() - startTimeMs) / 1000;
  const ratio = elapsed / profile.wallClockBudgetSec;
  if (ratio >= 0.95) return "critical";
  if (ratio >= 0.7) return "tight";
  return "normal";
}

export function budgetElapsedSec(startTimeMs: number): number {
  return Math.round((Date.now() - startTimeMs) / 1000);
}

export function shouldStopWaves(startTimeMs: number, profile: ResearchProfile, waveIndex: number): boolean {
  const elapsed = (Date.now() - startTimeMs) / 1000;
  const ratio = elapsed / profile.wallClockBudgetSec;
  // Ultra/max modes spend almost all budget searching; lighter modes reserve more for extract.
  const searchBudgetRatio = profile.searchWaves >= 16 ? 0.95 : profile.searchWaves >= 8 ? 0.9 : 0.7;
  if (ratio >= searchBudgetRatio) return true;
  return waveIndex >= profile.searchWaves;
}

export function getEffortEstimateFromProfile(effort: EffortLevel | string | undefined): string {
  const profile = RESEARCH_PROFILES[effort as EffortLevel];
  if (!profile) return "—";
  const [lo, hi] = profile.estimatedMinutes;
  // Language-neutral ranges (UI already labels Instant / Max).
  if (hi <= 2) return "≤2 min";
  // Prefer minutes until the floor is ≥1 h (avoids "0.5–1.3 h").
  if (lo >= 60) {
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
    return `${fmt(lo / 60)}–${fmt(hi / 60)} h`;
  }
  const fmtMin = (n: number) => (n < 1 ? "<1" : String(Math.round(n)));
  return `${fmtMin(lo)}–${fmtMin(hi)} min`;
}
