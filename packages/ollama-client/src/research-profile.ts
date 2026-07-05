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

export const RESEARCH_PROFILES: Record<EffortLevel, ResearchProfile> = {
  low: {
    wallClockBudgetSec: 240,
    searchWaves: 1,
    llmPlan: false,
    llmRank: false,
    llmRankBatchSize: 0,
    fetchPolicy: "none",
    extractPolicy: "serp_only",
    extractTopK: 10,
    fetchRatio: 0,
    parallelSearch: 3,
    parallelExtract: 1,
    gapAnalysis: false,
    useCritic: false,
    reasoningDepth: 0,
    estimatedMinutes: [1, 3],
  },
  medium: {
    wallClockBudgetSec: 900,
    searchWaves: 2,
    llmPlan: true,
    llmRank: true,
    llmRankBatchSize: 20,
    fetchPolicy: "top",
    extractPolicy: "top_k",
    extractTopK: 16,
    fetchRatio: 0.5,
    parallelSearch: 3,
    parallelExtract: 2,
    gapAnalysis: true,
    useCritic: false,
    reasoningDepth: 1,
    estimatedMinutes: [5, 12],
  },
  high: {
    wallClockBudgetSec: 3900,
    searchWaves: 8,
    llmPlan: true,
    llmRank: true,
    llmRankBatchSize: 25,
    fetchPolicy: "adaptive",
    extractPolicy: "top_k",
    extractTopK: 30,
    fetchRatio: 0.7,
    parallelSearch: 3,
    parallelExtract: 3,
    gapAnalysis: true,
    useCritic: true,
    reasoningDepth: 2,
    estimatedMinutes: [30, 60],
  },
  super_high: {
    wallClockBudgetSec: 7500,
    searchWaves: 14,
    llmPlan: true,
    llmRank: true,
    llmRankBatchSize: 30,
    fetchPolicy: "adaptive",
    extractPolicy: "all_ranked",
    extractTopK: 60,
    fetchRatio: 0.75,
    parallelSearch: 4,
    parallelExtract: 3,
    gapAnalysis: true,
    useCritic: true,
    reasoningDepth: 2,
    estimatedMinutes: [60, 120],
  },
  ultra_high: {
    wallClockBudgetSec: 15000,
    searchWaves: 24,
    llmPlan: true,
    llmRank: true,
    llmRankBatchSize: 35,
    fetchPolicy: "deep",
    extractPolicy: "all_ranked",
    extractTopK: 100,
    fetchRatio: 0.9,
    parallelSearch: 4,
    parallelExtract: 4,
    gapAnalysis: true,
    useCritic: true,
    reasoningDepth: 3,
    estimatedMinutes: [120, 240],
  },
};

export interface ResolvedModels {
  plannerModel: string;
  extractorModel: string;
  criticModel?: string;
}

// Escalera de modelos de mayor a menor calidad, con requisitos de RAM/VRAM
// aproximados. Se elige dinámicamente el mejor modelo que el PC puede ejecutar.
const MODEL_LADDER: { model: string; minRamGb: number; minVramGb: number }[] = [
  { model: "qwen2.5:32b", minRamGb: 48, minVramGb: 24 },
  { model: "qwen2.5:14b", minRamGb: 16, minVramGb: 10 },
  { model: "qwen2.5:7b", minRamGb: 8, minVramGb: 6 },
  { model: "qwen2.5:3b", minRamGb: 4, minVramGb: 0 },
  { model: "llama3.2:1b", minRamGb: 0, minVramGb: 0 },
];

/** Índice en la escalera del mejor modelo que soporta el hardware (0 = mayor). */
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

/**
 * Selecciona modelos dinámicamente según el PC. Por defecto usa el modelo más
 * potente que el hardware admite en TODOS los modos; en modos rápidos la
 * extracción (que se repite mucho) usa un modelo un escalón más ligero para
 * respetar el presupuesto de tiempo.
 */
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
  // Reservar tiempo para lectura/extracción: dejar de buscar cuando se haya
  // consumido una fracción del presupuesto (más alta en modos largos, que deben
  // aprovechar casi todo el tiempo buscando muchas fuentes del sector).
  const elapsed = (Date.now() - startTimeMs) / 1000;
  const ratio = elapsed / profile.wallClockBudgetSec;
  const searchBudgetRatio = profile.searchWaves >= 8 ? 0.8 : 0.7;
  if (ratio >= searchBudgetRatio) return true;
  return waveIndex >= profile.searchWaves;
}

export function getEffortEstimateFromProfile(effort: EffortLevel | string | undefined): string {
  const profile = RESEARCH_PROFILES[effort as EffortLevel];
  if (!profile) return "—";
  const [lo, hi] = profile.estimatedMinutes;
  if (hi >= 60) {
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
    return `${fmt(lo / 60)}–${fmt(hi / 60)} h`;
  }
  const fmtMin = (n: number) => (n < 1 ? "<1" : String(Math.round(n)));
  return `${fmtMin(lo)}–${fmtMin(hi)} min`;
}
