/**
 * Order SERP engines using historical hit counts from health-history.
 */
import type { RunnableSearchEngineId } from "@aiia/scraper";
import type { HealthHistoryEntry } from "./source-health.js";

/** Map result tags (brave-api) back to runnable engine ids (brave). */
function runnableKey(engine: string): string {
  if (engine === "brave-api") return "brave";
  return engine;
}

/** Parse "Brave API:12, Mojeek:5" style topSerp lines into counts. */
export function parseTopSerpLine(line?: string): Record<string, number> {
  if (!line?.trim()) return {};
  const out: Record<string, number> = {};
  for (const part of line.split(/[,·|]/)) {
    const m = /([A-Za-z0-9 _-]+)\s*:\s*(\d+)/.exec(part.trim());
    if (!m) continue;
    const label = m[1].trim().toLowerCase();
    const n = Number(m[2]);
    if (!n) continue;
    let id = label;
    if (/brave\s*api/.test(label)) id = "brave";
    else if (/brave\s*html|brave$/.test(label)) id = "brave";
    else if (/ddg-?lite|duckduckgo-lite/.test(label)) id = "duckduckgo-lite";
    else if (/ddg|duckduckgo/.test(label)) id = "duckduckgo-html";
    else if (/mojeek/.test(label)) id = "mojeek";
    else if (/ecosia/.test(label)) id = "ecosia";
    else if (/bing/.test(label)) id = "bing";
    out[id] = (out[id] ?? 0) + n;
  }
  return out;
}

export function accumulateEngineScores(
  entries: HealthHistoryEntry[]
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const e of entries.slice(-12)) {
    const weight = e.serpExhausted ? 0.25 : 1;
    const hits =
      e.serpEngineHits && Object.keys(e.serpEngineHits).length > 0
        ? e.serpEngineHits
        : parseTopSerpLine(e.topSerp);
    for (const [eng, n] of Object.entries(hits)) {
      if (!n || n <= 0) continue;
      const key = runnableKey(eng);
      scores.set(key, (scores.get(key) ?? 0) + n * weight);
    }
  }
  return scores;
}

/**
 * Stable reorder: historically stronger engines first; unknown engines keep relative order.
 * Does not drop engines.
 */
export function orderEnginesByHistory<T extends string>(
  engines: T[],
  entries: HealthHistoryEntry[]
): T[] {
  if (engines.length <= 1 || entries.length === 0) return engines;
  const scores = accumulateEngineScores(entries);
  if (scores.size === 0) return engines;

  return [...engines]
    .map((eng, idx) => ({ eng, idx, score: scores.get(eng) ?? 0 }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.idx - b.idx;
    })
    .map((x) => x.eng);
}

/** Prefer Brave when API key present, then historical order. */
export function resolveEngineOrder(
  engines: RunnableSearchEngineId[],
  entries: HealthHistoryEntry[],
  opts?: { braveApiKey?: string }
): RunnableSearchEngineId[] {
  let ordered = orderEnginesByHistory(engines, entries);
  if (opts?.braveApiKey) {
    ordered = [
      "brave",
      ...ordered.filter((e): e is RunnableSearchEngineId => e !== "brave"),
    ];
  }
  return ordered;
}
