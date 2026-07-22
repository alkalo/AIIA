import { EFFORT_CONFIGS, type EffortLevel } from "@aiia/ollama-client/browser";
import type { AgentSpec } from "./types.js";
import { isGrantTarget, isRealEstateTarget } from "./opportunity-subtype.js";

export interface SearchLimits {
  maxSources: number;
  maxResultsPerQuery: number;
  fromAgentConfig: boolean;
}

/**
 * Floor so deep research (esp. real-estate / grants) is not starved by a low
 * planner maxSources (e.g. 15) when the user picked ultra/super effort.
 */
function qualityFloor(spec: AgentSpec, effort: EffortLevel): number {
  const deep = isRealEstateTarget(spec) || isGrantTarget(spec);
  if (!deep) return 0;
  if (effort === "ultra_high") return 200;
  if (effort === "super_high") return 150;
  if (effort === "high") return 100;
  if (effort === "medium") return 60;
  return 0;
}

/** Resuelve cuántos enlaces recopilar/priorizar según la spec del agente (o el modo de esfuerzo). */
export function resolveSearchLimits(spec: AgentSpec, effort: EffortLevel): SearchLimits {
  const cfg = EFFORT_CONFIGS[effort];
  const configuredMax = spec.search.maxSources;
  const configuredPerQuery = spec.search.maxResultsPerQuery;

  const fromAgentConfig = configuredMax != null && configuredMax > 0;

  let maxSources = fromAgentConfig ? Math.max(1, configuredMax) : cfg.maxSources;
  const floor = qualityFloor(spec, effort);
  if (floor > 0) {
    maxSources = Math.max(maxSources, Math.min(floor, cfg.maxSources));
  }

  const maxResultsPerQuery =
    configuredPerQuery != null && configuredPerQuery > 0
      ? Math.max(1, configuredPerQuery)
      : cfg.maxResultsPerQuery;

  // Deep research: never starve per-query depth when maxSources was floored up.
  const deep = isRealEstateTarget(spec) || isGrantTarget(spec);
  const perQueryFloor =
    deep && effort !== "low"
      ? effort === "ultra_high"
        ? 20
        : effort === "super_high"
          ? 16
          : 12
      : 0;
  const resolvedPerQuery =
    perQueryFloor > 0 ? Math.max(maxResultsPerQuery, perQueryFloor) : maxResultsPerQuery;

  return { maxSources, maxResultsPerQuery: resolvedPerQuery, fromAgentConfig };
}

/** Resultados a pedir por consulta para poder alcanzar maxSources con N consultas. */
export function perQueryLimit(
  maxSources: number,
  maxResultsPerQuery: number,
  queryCount: number
): number {
  const n = Math.max(1, queryCount);
  return Math.min(Math.max(maxResultsPerQuery, Math.ceil(maxSources / n)), maxSources);
}

export function getMaxSources(spec: AgentSpec, effort: EffortLevel): number {
  return resolveSearchLimits(spec, effort).maxSources;
}
