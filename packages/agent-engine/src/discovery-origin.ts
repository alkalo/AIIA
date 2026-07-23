/**
 * Classify final items by discovery channel (seed / RSS / expand / SERP…).
 * Uses provenance text in reason / snippet / rankReason tags set during the run.
 */

export type DiscoveryOriginId =
  | "gap-fill"
  | "rss"
  | "depth-2"
  | "listing-expand"
  | "portal-seed"
  | "serp"
  | "other";

const ORIGIN_ORDER: DiscoveryOriginId[] = [
  "gap-fill",
  "rss",
  "depth-2",
  "listing-expand",
  "portal-seed",
  "serp",
  "other",
];

const ORIGIN_LABEL: Record<DiscoveryOriginId, string> = {
  "gap-fill": "Gap-fill",
  rss: "RSS",
  "depth-2": "Depth-2",
  "listing-expand": "Expand",
  "portal-seed": "Seeds",
  serp: "SERP",
  other: "Otros",
};

/** Infer discovery origin from provenance / reason text. */
export function classifyDiscoveryOrigin(...parts: unknown[]): DiscoveryOriginId {
  const blob = parts.map((p) => String(p ?? "")).join(" ").toLowerCase();
  if (!blob.trim()) return "other";
  if (/gap-fill|gap fill region/i.test(blob)) return "gap-fill";
  if (/rss feed|\brss\b|atom feed/i.test(blob)) return "rss";
  if (/depth-2|depth 2|related opportunity/i.test(blob)) return "depth-2";
  if (
    /listing deep-link|listing pagination|portal-parser|deep link expanded|pagination/i.test(blob)
  ) {
    return "listing-expand";
  }
  if (/portal coverage seed|portal seed|coverage seed/i.test(blob)) return "portal-seed";
  if (
    /serp|duckduckgo|mojeek|brave|ecosia|bing|search result|snippet/i.test(blob) ||
    /heuristic|extracted/i.test(blob)
  ) {
    return "serp";
  }
  return "other";
}

/** Count finals (or any item set) by discovery origin. */
export function countDiscoveryOrigins(
  items: Array<{ reason?: unknown; description?: unknown; summary?: unknown; snippet?: unknown }>
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const id = classifyDiscoveryOrigin(
      item.reason,
      item.description,
      item.summary,
      item.snippet
    );
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/** Human labels for UI chips / health report lines. */
export function formatOriginLabel(id: string): string {
  return ORIGIN_LABEL[id as DiscoveryOriginId] ?? id;
}

/** Sorted chips: ["Seeds:8", "RSS:5", "SERP:3"]. */
export function formatOriginChips(counts: Record<string, number> | undefined): string[] {
  if (!counts) return [];
  const known = ORIGIN_ORDER.filter((id) => (counts[id] ?? 0) > 0);
  const extra = Object.keys(counts).filter(
    (k) => !(ORIGIN_ORDER as string[]).includes(k) && (counts[k] ?? 0) > 0
  );
  return [...known, ...extra].map((id) => `${formatOriginLabel(id)}:${counts[id]}`);
}

/** One line for the source-health text block. */
export function formatOriginSummary(counts: Record<string, number> | undefined): string {
  const chips = formatOriginChips(counts);
  if (chips.length === 0) return "";
  return `Origen de finales: ${chips.join(" · ")}`;
}
