/**
 * Per-feed soft health: skip recently failing RSS/Atom URLs for a cooldown window.
 * Stored under inbox/{agentId}/feed-health.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface FeedHealthStat {
  fails: number;
  successes: number;
  /** Skip until this ISO timestamp when fails accumulate */
  cooldownUntil?: string;
  lastAt: string;
  lastError?: string;
}

export interface FeedHealthFile {
  agentId: string;
  updatedAt: string;
  feeds: Record<string, FeedHealthStat>;
}

const FEED_HEALTH_MAX = 60;
/** After this many consecutive fails, cool down the feed. */
const FAIL_THRESHOLD = 2;
/** Cooldown duration after threshold (ms). */
export const FEED_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h

export function feedHealthPath(dataDir: string, agentId: string): string {
  return join(dataDir, "inbox", agentId, "feed-health.json");
}

function feedKey(url: string): string {
  return url.trim().toLowerCase();
}

export async function readFeedHealth(
  dataDir: string,
  agentId: string
): Promise<FeedHealthFile> {
  const path = feedHealthPath(dataDir, agentId);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as FeedHealthFile;
    if (parsed && typeof parsed.feeds === "object") return parsed;
  } catch {
    /* first run */
  }
  return { agentId, updatedAt: new Date().toISOString(), feeds: {} };
}

async function writeFeedHealth(dataDir: string, file: FeedHealthFile): Promise<void> {
  const path = feedHealthPath(dataDir, file.agentId);
  await mkdir(dirname(path), { recursive: true });
  const entries = Object.entries(file.feeds).sort(
    (a, b) => (b[1].fails + b[1].successes) - (a[1].fails + a[1].successes)
  );
  file.feeds = Object.fromEntries(entries.slice(0, FEED_HEALTH_MAX));
  file.updatedAt = new Date().toISOString();
  await writeFile(path, JSON.stringify(file, null, 2), "utf-8");
}

/** True when the feed should be attempted now. */
export function isFeedHealthy(file: FeedHealthFile, url: string, now = Date.now()): boolean {
  const st = file.feeds[feedKey(url)];
  if (!st?.cooldownUntil) return true;
  const until = Date.parse(st.cooldownUntil);
  if (Number.isNaN(until)) return true;
  return until <= now;
}

export async function noteFeedSuccess(
  dataDir: string,
  agentId: string,
  url: string
): Promise<void> {
  const file = await readFeedHealth(dataDir, agentId);
  const key = feedKey(url);
  const prev = file.feeds[key];
  file.feeds[key] = {
    fails: 0,
    successes: (prev?.successes ?? 0) + 1,
    lastAt: new Date().toISOString(),
  };
  file.agentId = agentId;
  await writeFeedHealth(dataDir, file);
}

export async function noteFeedFailure(
  dataDir: string,
  agentId: string,
  url: string,
  error?: string
): Promise<void> {
  const file = await readFeedHealth(dataDir, agentId);
  const key = feedKey(url);
  const prev = file.feeds[key];
  const fails = (prev?.fails ?? 0) + 1;
  const now = new Date();
  const st: FeedHealthStat = {
    fails,
    successes: prev?.successes ?? 0,
    lastAt: now.toISOString(),
    lastError: error ? error.slice(0, 200) : prev?.lastError,
  };
  if (fails >= FAIL_THRESHOLD) {
    st.cooldownUntil = new Date(now.getTime() + FEED_COOLDOWN_MS).toISOString();
  }
  file.feeds[key] = st;
  file.agentId = agentId;
  await writeFeedHealth(dataDir, file);
}

/** Filter feeds that are not in cooldown. */
export function filterHealthyFeeds<T extends { url: string }>(
  feeds: T[],
  file: FeedHealthFile,
  now = Date.now()
): { active: T[]; skipped: T[] } {
  const active: T[] = [];
  const skipped: T[] = [];
  for (const f of feeds) {
    if (isFeedHealthy(file, f.url, now)) active.push(f);
    else skipped.push(f);
  }
  return { active, skipped };
}

/** One-line / multi-line summary for run health reports. */
export function formatFeedHealthSummary(
  file: FeedHealthFile,
  now = Date.now()
): { coolingCount: number; lines: string[] } {
  const cooling: { title: string; until: string }[] = [];
  for (const [url, st] of Object.entries(file.feeds)) {
    if (!st.cooldownUntil) continue;
    const until = Date.parse(st.cooldownUntil);
    if (Number.isNaN(until) || until <= now) continue;
    const host = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./i, "");
      } catch {
        return url.slice(0, 40);
      }
    })();
    cooling.push({ title: host, until: st.cooldownUntil.slice(0, 16) });
  }
  cooling.sort((a, b) => a.title.localeCompare(b.title));
  return {
    coolingCount: cooling.length,
    lines: cooling.slice(0, 8).map((c) => `${c.title} hasta ${c.until}`),
  };
}
