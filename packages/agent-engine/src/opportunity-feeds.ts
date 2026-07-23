/**
 * Official / high-signal RSS & Atom feeds for opportunity + sector discovery.
 * Used when SERP is weak — feeds are fetched via packages/scraper fetchFeed.
 */
import type { AgentSpec } from "./types.js";
import { detectGrantRegions, type GrantRegionId } from "./grant-sources.js";
import { isGrantTarget, isCurationOpportunityTarget, isSectorNewsTarget } from "./opportunity-subtype.js";

export interface OpportunityFeed {
  title: string;
  url: string;
  region: GrantRegionId | "news";
}

const GLOBAL_FEEDS: OpportunityFeed[] = [
  {
    title: "Devex — News",
    url: "https://www.devex.com/news.rss",
    region: "global",
  },
  {
    title: "Stanford Social Innovation Review",
    url: "https://ssir.org/rss.xml",
    region: "global",
  },
  {
    title: "Funds for NGOs — Latest (feed)",
    url: "https://www2.fundsforngos.org/feed/",
    region: "global",
  },
  {
    title: "Alliance Magazine — News",
    url: "https://www.alliancemagazine.org/feed/",
    region: "global",
  },
  {
    title: "Philanthropy News Digest",
    url: "https://philanthropynewsdigest.org/rss",
    region: "global",
  },
  {
    title: "World Bank — News",
    url: "https://www.worldbank.org/en/news/all/rss",
    region: "global",
  },
  {
    title: "UNDP — News",
    url: "https://www.undp.org/news/rss.xml",
    region: "global",
  },
];

const REGION_FEEDS: Partial<Record<Exclude<GrantRegionId, "global">, OpportunityFeed[]>> = {
  au: [
    {
      title: "Pro Bono Australia — News",
      url: "https://probonoaustralia.com.au/feed/",
      region: "au",
    },
    {
      title: "Philanthropy Australia — News",
      url: "https://www.philanthropy.org.au/feed/",
      region: "au",
    },
    {
      title: "Social Enterprise Australia — News",
      url: "https://www.socialenterprise.org.au/feed/",
      region: "au",
    },
  ],
  nz: [
    {
      title: "Community Matters (NZ) — News",
      url: "https://www.communitymatters.govt.nz/news-and-resources/feed/",
      region: "nz",
    },
  ],
  eu: [
    {
      title: "EURACTIV — Economy",
      url: "https://www.euractiv.com/sections/economy-jobs/feed/",
      region: "eu",
    },
    {
      title: "EU Newsroom — RSS",
      url: "https://ec.europa.eu/commission/presscorner/api/rdf",
      region: "eu",
    },
    {
      title: "CORDIS — News",
      url: "https://cordis.europa.eu/news?format=rss",
      region: "eu",
    },
  ],
  uk: [
    {
      title: "GOV.UK — News Atom",
      url: "https://www.gov.uk/search/news-and-communications.atom",
      region: "uk",
    },
    {
      title: "National Lottery Community Fund — News",
      url: "https://www.tnlcommunityfund.org.uk/news/feed",
      region: "uk",
    },
    {
      title: "UK Community Foundations — News",
      url: "https://www.ukcommunityfoundations.org/news/feed",
      region: "uk",
    },
  ],
  us: [
    {
      title: "Grants.gov — Opportunities available (XML)",
      url: "https://www.grants.gov/xml/OpportunitiesAvailable.xml",
      region: "us",
    },
    {
      title: "Candid Philanthropy News Digest — US",
      url: "https://philanthropynewsdigest.org/rfps/rss",
      region: "us",
    },
  ],
  ca: [
    {
      title: "Canada.ca — News releases RSS",
      url: "https://www.canada.ca/en/news.atom",
      region: "ca",
    },
    {
      title: "IDRC — Funding opportunities",
      url: "https://idrc-crdi.ca/en/funding/rss.xml",
      region: "ca",
    },
    {
      title: "IDRC — News and events",
      url: "https://idrc-crdi.ca/en/news-events/rss.xml",
      region: "ca",
    },
  ],
  es: [
    {
      title: "BOE — Últimas disposiciones (Atom)",
      url: "https://www.boe.es/rss/atom.php?c=BOE",
      region: "es",
    },
    {
      title: "Compromiso Empresarial — Feed",
      url: "https://www.compromisoempresarial.com/feed/",
      region: "es",
    },
    {
      title: "CDTI — Noticias",
      url: "https://www.cdti.es/noticias/rss",
      region: "es",
    },
  ],
  latam: [
    {
      title: "IDB — News",
      url: "https://www.iadb.org/en/news/rss.xml",
      region: "latam",
    },
    {
      title: "CEPAL / ECLAC — News",
      url: "https://www.cepal.org/en/pressreleases/rss.xml",
      region: "latam",
    },
    {
      title: "CAF — News",
      url: "https://www.caf.com/en/currently/news/rss/",
      region: "latam",
    },
  ],
  asia: [
    {
      title: "ADB — News",
      url: "https://www.adb.org/news/feed",
      region: "asia",
    },
    {
      title: "ADB — Projects",
      url: "https://www.adb.org/projects/feed",
      region: "asia",
    },
    {
      title: "ADB — Business opportunities",
      url: "https://www.adb.org/business/opportunities/feed",
      region: "asia",
    },
  ],
  africa: [
    {
      title: "African Development Bank — News",
      url: "https://www.afdb.org/en/news-and-events/rss.xml",
      region: "africa",
    },
    {
      title: "UNECA — News",
      url: "https://www.uneca.org/rss.xml",
      region: "africa",
    },
  ],
  mena: [
    {
      title: "UNESCWA — News",
      url: "https://www.unescwa.org/news/rss.xml",
      region: "mena",
    },
    {
      title: "EBRD — News",
      url: "https://www.ebrd.com/news/rss.html",
      region: "mena",
    },
  ],
};

/** Sector-news pack: global + major regional news feeds (not grants.gov XML). */
const NEWS_FEEDS: OpportunityFeed[] = [
  ...GLOBAL_FEEDS,
  ...(REGION_FEEDS.au ?? []),
  ...(REGION_FEEDS.nz ?? []),
  ...(REGION_FEEDS.eu ?? []),
  ...(REGION_FEEDS.uk ?? []),
  ...(REGION_FEEDS.ca ?? []).filter((f) => !/funding\/rss/i.test(f.url)),
  ...(REGION_FEEDS.es ?? []).filter((f) => !/boe\.es/i.test(f.url)),
  ...(REGION_FEEDS.latam ?? []),
  ...(REGION_FEEDS.asia ?? []).filter((f) => /\/news\//i.test(f.url)),
  ...(REGION_FEEDS.africa ?? []),
  ...(REGION_FEEDS.mena ?? []),
];

/**
 * Select RSS/Atom feeds for the agent based on detected regions.
 * Global / unspecified → multi-region feed atlas.
 */
export function opportunityFeedsForSpec(spec: AgentSpec): OpportunityFeed[] {
  const blob = `${spec.prompt} ${spec.filters.criteria}`;
  if (isSectorNewsTarget(spec) && !isGrantTarget(spec) && !isCurationOpportunityTarget(spec)) {
    const seen = new Set<string>();
    return NEWS_FEEDS.filter((f) => {
      const k = f.url.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (!isGrantTarget(spec) && !isCurationOpportunityTarget(spec) && !isSectorNewsTarget(spec)) {
    return [];
  }

  const regions = detectGrantRegions(blob);
  const exhaustive = regions.has("global") && regions.size === 1;
  const out: OpportunityFeed[] = [...GLOBAL_FEEDS];

  for (const [id, feeds] of Object.entries(REGION_FEEDS) as [
    Exclude<GrantRegionId, "global">,
    OpportunityFeed[],
  ][]) {
    if (exhaustive || regions.has("global") || regions.has(id)) {
      out.push(...feeds);
    }
  }

  const seen = new Set<string>();
  return out.filter((f) => {
    const k = f.url.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Prefer feeds for gap / weak regions first, then global aggregators, then the rest.
 * Improves exhaustiveness when prior runs left regional holes.
 */
export function prioritizeFeedsByRegions(
  feeds: OpportunityFeed[],
  preferRegions: Iterable<string>
): OpportunityFeed[] {
  const want = new Set(
    [...preferRegions].map((r) => String(r).toLowerCase()).filter((r) => r && r !== "global")
  );
  if (want.size === 0 || feeds.length <= 1) return feeds;

  const preferred: OpportunityFeed[] = [];
  const global: OpportunityFeed[] = [];
  const rest: OpportunityFeed[] = [];
  for (const f of feeds) {
    const reg = String(f.region).toLowerCase();
    if (want.has(reg)) preferred.push(f);
    else if (reg === "global" || reg === "news") global.push(f);
    else rest.push(f);
  }
  return [...preferred, ...global, ...rest];
}
