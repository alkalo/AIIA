import { EFFORT_CONFIGS, type EffortLevel } from "@aiia/ollama-client";
import type { AgentSpec } from "./types.js";

export interface SearchLimits {
  maxSources: number;
  maxResultsPerQuery: number;
  fromAgentConfig: boolean;
}

/** Resuelve cuántos enlaces recopilar/priorizar según la spec del agente (o el modo de esfuerzo). */
export function resolveSearchLimits(spec: AgentSpec, effort: EffortLevel): SearchLimits {
  const cfg = EFFORT_CONFIGS[effort];
  const configuredMax = spec.search.maxSources;
  const configuredPerQuery = spec.search.maxResultsPerQuery;

  const fromAgentConfig = configuredMax != null && configuredMax > 0;

  const maxSources =
    fromAgentConfig ? Math.max(1, configuredMax) : cfg.maxSources;

  const maxResultsPerQuery =
    configuredPerQuery != null && configuredPerQuery > 0
      ? Math.max(1, configuredPerQuery)
      : cfg.maxResultsPerQuery;

  return { maxSources, maxResultsPerQuery, fromAgentConfig };
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
