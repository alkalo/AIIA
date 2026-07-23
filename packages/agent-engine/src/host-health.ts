/**
 * Per-host scrape health learned across runs (local inbox/{agentId}/host-health.json).
 * Used to boost historically productive portals and gently demote dead hosts.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface HostHealthStat {
  /** EMA-ish productivity score 0–100 */
  score: number;
  /** Times this host appeared in final results */
  finals: number;
  /** Times this host was seen as a seed/candidate with zero finals in a run */
  misses: number;
  lastAt: string;
}

export interface HostHealthFile {
  agentId: string;
  updatedAt: string;
  hosts: Record<string, HostHealthStat>;
}

export interface HostBoostable {
  url: string;
  relevance?: number;
  fetchPriority: "high" | "medium" | "skip";
  snippet?: string;
  rankReason?: string;
}

const HOST_HEALTH_MAX = 80;

export function hostHealthPath(dataDir: string, agentId: string): string {
  return join(dataDir, "inbox", agentId, "host-health.json");
}

export function normalizeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export async function readHostHealth(
  dataDir: string,
  agentId: string
): Promise<HostHealthFile> {
  const path = hostHealthPath(dataDir, agentId);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as HostHealthFile;
    if (parsed && typeof parsed.hosts === "object") return parsed;
  } catch {
    /* first run */
  }
  return { agentId, updatedAt: new Date().toISOString(), hosts: {} };
}

/**
 * Boost map: host → relevance delta (−12 … +18).
 * High score hosts that produced finals recently get a positive delta.
 */
export function hostBoostMapFromHealth(file: HostHealthFile): Map<string, number> {
  const map = new Map<string, number>();
  for (const [host, st] of Object.entries(file.hosts)) {
    if (!host || !st) continue;
    let delta = 0;
    if (st.score >= 70) delta = 18;
    else if (st.score >= 55) delta = 12;
    else if (st.score >= 40) delta = 6;
    else if (st.score >= 25) delta = 2;
    else if (st.score < 12 && st.misses >= 3) delta = -12;
    else if (st.score < 20 && st.misses >= 2) delta = -6;
    if (delta !== 0) map.set(host, delta);
  }
  return map;
}

/** Apply historical host boost to ranked sources (re-sort by relevance). */
export function applyHostHealthBoost<T extends HostBoostable>(
  ranked: T[],
  boosts: Map<string, number>
): T[] {
  if (boosts.size === 0 || ranked.length === 0) return ranked;
  const next = ranked.map((r) => {
    const host = normalizeHost(r.url);
    const delta = host ? boosts.get(host) ?? 0 : 0;
    if (!delta) return r;
    const relevance = Math.max(0, Math.min(100, (r.relevance ?? 50) + delta));
    let fetchPriority = r.fetchPriority;
    if (delta >= 10 && r.fetchPriority === "medium") fetchPriority = "high";
    else if (delta <= -10 && r.fetchPriority === "medium") fetchPriority = "skip";
    return {
      ...r,
      relevance,
      fetchPriority,
      rankReason:
        delta > 0
          ? `${r.rankReason ?? "rank"} · host-health +${delta}`
          : `${r.rankReason ?? "rank"} · host-health ${delta}`,
    };
  });
  next.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  return next;
}

/**
 * Update host health after a run.
 * @param finalUrls URLs that made it to final results
 * @param candidateHosts hosts that were fetched/seeded but may not have finals
 */
export async function updateHostHealth(
  dataDir: string,
  agentId: string,
  finalUrls: string[],
  candidateHosts: string[] = []
): Promise<HostHealthFile> {
  const file = await readHostHealth(dataDir, agentId);
  const now = new Date().toISOString();
  const finalCounts = new Map<string, number>();
  for (const url of finalUrls) {
    const h = normalizeHost(url);
    if (!h) continue;
    finalCounts.set(h, (finalCounts.get(h) ?? 0) + 1);
  }

  const touched = new Set<string>([...finalCounts.keys(), ...candidateHosts.map(normalizeHost).filter(Boolean)]);

  for (const host of touched) {
    const prev = file.hosts[host] ?? { score: 30, finals: 0, misses: 0, lastAt: now };
    const n = finalCounts.get(host) ?? 0;
    let score = prev.score;
    let finals = prev.finals;
    let misses = prev.misses;
    if (n > 0) {
      const pulse = Math.min(40, 10 + n * 6);
      score = Math.round(prev.score * 0.65 + pulse * 0.35);
      finals += n;
    } else {
      score = Math.round(prev.score * 0.85);
      misses += 1;
    }
    score = Math.max(0, Math.min(100, score));
    file.hosts[host] = { score, finals, misses, lastAt: now };
  }

  // Cap file size: keep top hosts by score
  const entries = Object.entries(file.hosts).sort((a, b) => b[1].score - a[1].score);
  file.hosts = Object.fromEntries(entries.slice(0, HOST_HEALTH_MAX));
  file.agentId = agentId;
  file.updatedAt = now;

  const path = hostHealthPath(dataDir, agentId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(file, null, 2), "utf-8");
  return file;
}

/** One-line summary for logs. */
export function formatHostHealthBoostSummary(boosts: Map<string, number>): string {
  const parts = [...boosts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([h, d]) => `${h}:${d > 0 ? "+" : ""}${d}`);
  return parts.join(", ");
}
