/**
 * Boost / demote candidates from human Inbox review (approved ↑, rejected ↓).
 * Complements host-health (machine) with explicit reviewer preference.
 */
import type { ExtractedItem } from "./types.js";
import { opportunityContentKey } from "./canonical-url.js";
import { normalizeHost } from "./host-health.js";

export interface ApprovedSignals {
  /** host → weighted approval count */
  hosts: Map<string, number>;
  /** lowercase org / funder tokens (approved) */
  orgs: Set<string>;
  /** content keys (org|program|deadline) from approved items */
  contentKeys: Set<string>;
  approvedCount: number;
  /** host → rejection count (never boost these unless also approved) */
  rejectedHosts: Map<string, number>;
  /** lowercase org tokens from rejected items */
  rejectedOrgs: Set<string>;
  rejectedCount: number;
}

export interface ApprovedBoostable {
  url: string;
  title?: string;
  relevance?: number;
  fetchPriority: "high" | "medium" | "skip";
  snippet?: string;
  rankReason?: string;
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function normalizeOrg(item: ExtractedItem): string {
  return str(item.organization || item.organisation || item.source)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

/** Build signals from prior inbox items (approved ↑; archived light ↑; rejected ↓). */
export function buildApprovedSignals(priorItems: ExtractedItem[]): ApprovedSignals {
  const hosts = new Map<string, number>();
  const orgs = new Set<string>();
  const contentKeys = new Set<string>();
  const rejectedHosts = new Map<string, number>();
  const rejectedOrgs = new Set<string>();
  let approvedCount = 0;
  let rejectedCount = 0;

  for (const item of priorItems) {
    const status = str(item.review_status).toLowerCase();
    const host = normalizeHost(str(item.url));
    const org = normalizeOrg(item);

    if (status === "rejected") {
      rejectedCount += 1;
      if (host) rejectedHosts.set(host, (rejectedHosts.get(host) ?? 0) + 1);
      if (org.length >= 4) rejectedOrgs.add(org);
      continue;
    }

    let weight = 0;
    if (status === "approved") weight = 1;
    else if (status === "archived") weight = 0.35;
    else continue;

    approvedCount += weight >= 1 ? 1 : 0;
    if (host) hosts.set(host, (hosts.get(host) ?? 0) + weight);
    if (org.length >= 4) orgs.add(org);

    const ck = opportunityContentKey(item);
    if (ck) contentKeys.add(ck);
  }

  // Cap hosts to top productive approved hosts
  if (hosts.size > 40) {
    const top = [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    hosts.clear();
    for (const [h, n] of top) hosts.set(h, n);
  }
  if (rejectedHosts.size > 40) {
    const top = [...rejectedHosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    rejectedHosts.clear();
    for (const [h, n] of top) rejectedHosts.set(h, n);
  }

  return {
    hosts,
    orgs,
    contentKeys,
    approvedCount,
    rejectedHosts,
    rejectedOrgs,
    rejectedCount,
  };
}

export function hasReviewSignals(signals: ApprovedSignals): boolean {
  return (
    signals.hosts.size > 0 ||
    signals.orgs.size > 0 ||
    signals.rejectedHosts.size > 0 ||
    signals.rejectedOrgs.size > 0
  );
}

/** Host / org → relevance delta for a candidate (approved positive, rejected negative). */
export function approvedDeltaForCandidate(
  candidate: { url: string; title?: string; snippet?: string; rankReason?: string },
  signals: ApprovedSignals
): number {
  if (!hasReviewSignals(signals)) return 0;
  let delta = 0;
  const host = normalizeHost(candidate.url);
  const blob = `${candidate.title ?? ""} ${candidate.snippet ?? ""} ${candidate.rankReason ?? ""}`.toLowerCase();

  if (host && signals.hosts.has(host)) {
    const w = signals.hosts.get(host) ?? 0;
    delta += w >= 2 ? 18 : 14;
  } else if (host && signals.rejectedHosts.has(host)) {
    const n = signals.rejectedHosts.get(host) ?? 0;
    // Need repeated rejects before heavy demotion (one bad listing ≠ bad portal).
    delta -= n >= 3 ? 14 : n >= 2 ? 10 : 6;
  }

  let orgApproved = false;
  if (signals.orgs.size > 0) {
    for (const org of signals.orgs) {
      if (org.length >= 5 && blob.includes(org)) {
        delta += 8;
        orgApproved = true;
        break;
      }
    }
  }
  if (!orgApproved && signals.rejectedOrgs.size > 0) {
    for (const org of signals.rejectedOrgs) {
      if (org.length >= 5 && blob.includes(org)) {
        delta -= 6;
        break;
      }
    }
  }

  return Math.max(-18, Math.min(20, delta));
}

/** Apply Inbox review preference to ranked sources. */
export function applyApprovedBoost<T extends ApprovedBoostable>(
  ranked: T[],
  signals: ApprovedSignals
): T[] {
  if (ranked.length === 0 || !hasReviewSignals(signals)) return ranked;
  const next = ranked.map((r) => {
    const delta = approvedDeltaForCandidate(r, signals);
    if (!delta) return r;
    const relevance = Math.max(0, Math.min(100, (r.relevance ?? 50) + delta));
    let fetchPriority = r.fetchPriority;
    if (delta >= 10 && r.fetchPriority === "medium") fetchPriority = "high";
    else if (delta <= -10 && r.fetchPriority === "medium") fetchPriority = "skip";
    const tag =
      delta > 0
        ? `approved-boost +${delta}`
        : `rejected-demote ${delta}`;
    return {
      ...r,
      relevance,
      fetchPriority,
      rankReason: `${r.rankReason ?? "rank"} · ${tag}`,
    };
  });
  next.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  return next;
}

export function formatApprovedBoostSummary(signals: ApprovedSignals): string {
  const hostParts = [...signals.hosts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([h, n]) => `${h}×${n % 1 === 0 ? n : n.toFixed(1)}`);
  const rejectParts = [...signals.rejectedHosts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([h, n]) => `${h}×${n}`);
  return [
    `approved:${signals.approvedCount}`,
    hostParts.length ? `hosts↑: ${hostParts.join(", ")}` : "",
    signals.orgs.size ? `orgs↑:${signals.orgs.size}` : "",
    signals.rejectedCount ? `rejected:${signals.rejectedCount}` : "",
    rejectParts.length ? `hosts↓: ${rejectParts.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
