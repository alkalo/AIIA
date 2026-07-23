/**
 * Per-region coverage summary for opportunity runs (logged + progress hint).
 */
import { detectGrantRegions, type GrantRegionId } from "./grant-sources.js";
import type { ExtractedItem } from "./types.js";

export type CoverageRegion = GrantRegionId | "unknown";

const HOST_REGION: { re: RegExp; region: GrantRegionId }[] = [
  { re: /\.gov\.au|communitygrants|frrr\.org|philanthropy\.org\.au|grantly\.au|probonoaustralia|socialenterprise\.org\.au|communitydirectors|impactinvestingaustralia/i, region: "au" },
  { re: /govt\.nz|communitymatters/i, region: "nz" },
  { re: /europa\.eu|cordis\.|euractiv/i, region: "eu" },
  { re: /gov\.uk|tnlcommunityfund|grantfinder/i, region: "uk" },
  { re: /grants\.gov|instrumentl|foundationcenter|philanthropynewsdigest/i, region: "us" },
  { re: /canada\.ca|communityfoundations\.ca|idrc-crdi\.ca/i, region: "ca" },
  { re: /boe\.es|cdti\.es|enisa\.es|gob\.es|compromisoempresarial|administracion\.gob\.es/i, region: "es" },
  { re: /iadb\.org|cepal\.org|eclac\.org|caf\.com/i, region: "latam" },
  { re: /adb\.org/i, region: "asia" },
  { re: /afdb\.org|uneca\.org/i, region: "africa" },
  { re: /isdb\.org|unescwa\.org|ebrd\.com/i, region: "mena" },
  { re: /fundsforngos|globalgiving|devex\.com|terravivagrants|ssir\.org|candid\.org|worldbank\.org|undp\.org|alliancemagazine/i, region: "global" },
];

export function inferItemRegion(item: {
  url?: unknown;
  title?: unknown;
  organization?: unknown;
  summary?: unknown;
  description?: unknown;
  reason?: unknown;
  scope?: unknown;
}): CoverageRegion {
  const url = String(item.url ?? "");
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep */
  }
  for (const { re, region } of HOST_REGION) {
    if (re.test(host) || re.test(url)) return region;
  }
  const blob = [
    item.title,
    item.organization,
    item.summary,
    item.description,
    item.reason,
    item.scope,
  ]
    .map((x) => String(x ?? ""))
    .join(" ");
  const regions = detectGrantRegions(blob);
  if (regions.has("au")) return "au";
  if (regions.has("nz")) return "nz";
  if (regions.has("eu")) return "eu";
  if (regions.has("uk")) return "uk";
  if (regions.has("us")) return "us";
  if (regions.has("ca")) return "ca";
  if (regions.has("es")) return "es";
  if (regions.has("latam")) return "latam";
  if (regions.has("asia")) return "asia";
  if (regions.has("africa")) return "africa";
  if (regions.has("mena")) return "mena";
  if (regions.has("global")) return "global";
  return "unknown";
}

export interface RegionCoverageRow {
  region: CoverageRegion;
  count: number;
  samples: string[];
}

export function buildRegionCoverage(
  items: ExtractedItem[],
  requested: Set<GrantRegionId>
): {
  rows: RegionCoverageRow[];
  gaps: GrantRegionId[];
  summaryLines: string[];
} {
  const counts = new Map<CoverageRegion, { count: number; samples: string[] }>();
  for (const item of items) {
    const region = inferItemRegion(item);
    const entry = counts.get(region) ?? { count: 0, samples: [] };
    entry.count += 1;
    if (entry.samples.length < 3) {
      const label = String(item.program_name ?? item.title ?? item.url ?? "").slice(0, 60);
      if (label) entry.samples.push(label);
    }
    counts.set(region, entry);
  }

  const order: CoverageRegion[] = [
    "global",
    "au",
    "nz",
    "eu",
    "uk",
    "us",
    "ca",
    "es",
    "latam",
    "asia",
    "africa",
    "mena",
    "unknown",
  ];
  const rows: RegionCoverageRow[] = order
    .filter((r) => counts.has(r))
    .map((r) => ({
      region: r,
      count: counts.get(r)!.count,
      samples: counts.get(r)!.samples,
    }));

  const present = new Set(rows.map((r) => r.region));
  const gaps: GrantRegionId[] = [...requested].filter((r) => {
    if (r === "global") return false;
    return !present.has(r);
  });

  const summaryLines = [
    ...rows.map(
      (r) =>
        `${r.region}: ${r.count}${r.samples.length ? ` — ${r.samples.join("; ")}` : ""}`
    ),
    gaps.length > 0 ? `Huecos (sin items): ${gaps.join(", ")}` : "Sin huecos regionales detectados",
  ];

  return { rows, gaps, summaryLines };
}

export function requestedRegionsForSpec(prompt: string, criteria = ""): Set<GrantRegionId> {
  return detectGrantRegions(`${prompt} ${criteria}`);
}

/** Regions requested but missing from current URL set (ignores "global" as a hard requirement). */
export function uncoveredRegions(
  urls: string[],
  requested: Set<GrantRegionId>
): GrantRegionId[] {
  const present = new Set<GrantRegionId>();
  for (const url of urls) {
    const r = inferItemRegion({ url });
    if (r !== "unknown") present.add(r);
  }
  return [...requested].filter((r) => {
    if (r === "global") return false;
    return !present.has(r);
  });
}
