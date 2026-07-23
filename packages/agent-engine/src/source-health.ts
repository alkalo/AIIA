/**
 * Source-health summary for a run (logged near the end) + rolling history on disk.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { formatOriginSummary } from "./discovery-origin.js";

export interface SourceHealthInput {
  serpEngineHits: Record<string, number>;
  seedCount: number;
  feedItemCount: number;
  listingExpandCount: number;
  depth2Count: number;
  pageFetchOk: number;
  pageFetchFail: number;
  finalCount: number;
  serpExhausted: boolean;
  gapFillCount?: number;
  portalParserCount?: number;
  portalDetailCount?: number;
  feedSkippedCount?: number;
  feedFailCount?: number;
  /** Cooling feed hosts, e.g. "adb.org hasta 2026-07-23T18:00" */
  feedCooldownLines?: string[];
  /** Finals counted by discovery channel (rss, portal-seed, serp…). */
  originCounts?: Record<string, number>;
}

export function formatSourceHealthReport(h: SourceHealthInput): string {
  const engines = Object.entries(h.serpEngineHits)
    .filter(([, n]) => n > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([e, n]) => `${formatEngineId(e)}:${n}`)
    .join(", ");
  const originLine = formatOriginSummary(h.originCounts);
  const lines = [
    `SERP: ${engines || "0 hits"}${h.serpExhausted ? " (agotado/bloqueado)" : ""}`,
    `Semillas portal: ${h.seedCount} · RSS: ${h.feedItemCount}${
      h.feedSkippedCount ? ` · cooldown ${h.feedSkippedCount}` : ""
    }${h.feedFailCount ? ` · fallos ${h.feedFailCount}` : ""}`,
    `Expand listados: ${h.listingExpandCount} · profundidad-2: ${h.depth2Count}`,
    ...(h.portalParserCount && h.portalParserCount > 0
      ? [`Parsers portal: ${h.portalParserCount}`]
      : []),
    ...(h.portalDetailCount && h.portalDetailCount > 0
      ? [`Detalle portal (deadline/org): ${h.portalDetailCount}`]
      : []),
    `Fetch OK/fail: ${h.pageFetchOk}/${h.pageFetchFail}`,
    ...(h.gapFillCount && h.gapFillCount > 0
      ? [`Gap-fill mid-run: ${h.gapFillCount} portales`]
      : []),
    ...(h.feedCooldownLines && h.feedCooldownLines.length > 0
      ? [`Feeds en cooldown: ${h.feedCooldownLines.join("; ")}`]
      : []),
    ...(originLine ? [originLine] : []),
    `Resultados finales: ${h.finalCount}`,
  ];
  return lines.join("\n");
}

function formatEngineId(id: string): string {
  if (id === "brave-api") return "Brave API";
  if (id === "brave") return "Brave HTML";
  if (id === "duckduckgo-html") return "DDG";
  if (id === "duckduckgo-lite") return "DDG-Lite";
  if (id === "mojeek") return "Mojeek";
  if (id === "ecosia") return "Ecosia";
  if (id === "bing") return "Bing";
  return id;
}

/** Sorted SERP chips for UI: ["Brave API:12", "Mojeek:5"]. */
export function formatSerpEngineChips(hits: Record<string, number> | undefined): string[] {
  if (!hits) return [];
  return Object.entries(hits)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([e, n]) => `${formatEngineId(e)}:${n}`);
}

export interface HealthHistoryEntry {
  at: string;
  runId?: string;
  finalCount: number;
  serpExhausted: boolean;
  seedCount: number;
  feedItemCount: number;
  listingExpandCount: number;
  depth2Count: number;
  pageFetchOk: number;
  pageFetchFail: number;
  regionGaps?: string[];
  gapFillCount?: number;
  /** Top engines summary e.g. "Brave API:12, Mojeek:5" */
  topSerp?: string;
  /** Per-engine hit counts from the run (preferred over topSerp when present). */
  serpEngineHits?: Record<string, number>;
  /** Finals by discovery channel. */
  originCounts?: Record<string, number>;
}

const HISTORY_MAX = 20;

export function healthHistoryPath(dataDir: string, agentId: string): string {
  return join(dataDir, "inbox", agentId, "health-history.json");
}

export async function appendHealthHistory(
  dataDir: string,
  agentId: string,
  entry: HealthHistoryEntry
): Promise<void> {
  const path = healthHistoryPath(dataDir, agentId);
  await mkdir(dirname(path), { recursive: true });
  let prev: HealthHistoryEntry[] = [];
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as { entries?: HealthHistoryEntry[] };
    if (Array.isArray(parsed.entries)) prev = parsed.entries;
  } catch {
    /* first write */
  }
  const entries = [...prev, entry].slice(-HISTORY_MAX);
  await writeFile(path, JSON.stringify({ agentId, updatedAt: entry.at, entries }, null, 2), "utf-8");
}

export async function readHealthHistory(
  dataDir: string,
  agentId: string,
  limit = 10
): Promise<HealthHistoryEntry[]> {
  const path = healthHistoryPath(dataDir, agentId);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as { entries?: HealthHistoryEntry[] };
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    return entries.slice(-Math.max(1, limit));
  } catch {
    return [];
  }
}

/** One-line trend for UI / logs. */
export function formatHealthHistoryTrend(entries: HealthHistoryEntry[]): string {
  if (entries.length === 0) return "";
  return entries
    .slice(-8)
    .map((e) => {
      const day = e.at.slice(0, 10);
      const gaps = e.regionGaps?.length ? ` gaps:${e.regionGaps.length}` : "";
      const serp = e.serpExhausted ? " SERP↓" : "";
      return `${day}: ${e.finalCount}${serp}${gaps}`;
    })
    .join(" · ");
}
