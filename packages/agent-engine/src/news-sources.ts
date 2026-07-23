/**
 * Sector / impact news query packs and portal seeds.
 * Defaults to multi-region atlas when the prompt is not locale-locked.
 */
import { detectGrantRegions, type GrantRegionId } from "./grant-sources.js";

function newsRegions(prompt: string): Set<GrantRegionId> {
  return detectGrantRegions(prompt || "global");
}

export function sectorNewsQueryPack(prompt: string, max = 20): string[] {
  const core = prompt.replace(/\s+/g, " ").trim().slice(0, 140);
  const year = new Date().getFullYear();
  const regions = newsRegions(prompt);
  const exhaustive = regions.has("global") && regions.size === 1;
  const has = (id: GrantRegionId) => exhaustive || regions.has("global") || regions.has(id);

  const base: string[] = [`${core} news ${year}`, `${core} announcement ${year}`];
  if (core) base.unshift(`${core} last 30 days`);

  if (has("au")) {
    base.push(
      `social enterprise news Australia ${year}`,
      `B Corp Australia news ${year}`,
      `impact investing Australia ${year}`,
      `philanthropy Australia news ${year}`,
      `First Nations enterprise news Australia ${year}`,
      `nonprofit sector Australia funding news ${year}`,
      `ESG social procurement Australia ${year}`,
      `site:probonoaustralia.com.au`,
      `site:communitydirectors.com.au news`,
      `site:socialenterprise.org.au`,
      `site:philanthropy.org.au news`
    );
  }
  if (has("eu") || has("uk")) {
    base.push(
      `European social enterprise news ${year}`,
      `impact investing Europe news ${year}`,
      `site:euractiv.com social economy`,
      `UK social enterprise news ${year}`,
      `site:theguardian.com social enterprise`
    );
  }
  if (has("es")) {
    base.push(
      `economía social noticias España ${year}`,
      `emprendeduría social noticias ${year}`,
      `site:compromisoempresarial.com`
    );
  }
  if (has("us") || has("ca")) {
    base.push(
      `US nonprofit funding news ${year}`,
      `impact investing North America ${year}`,
      `site:ssir.org`,
      `Canadian social enterprise news ${year}`
    );
  }
  if (has("latam") || has("africa") || has("asia") || has("mena")) {
    base.push(
      `global south social enterprise news ${year}`,
      `development funding news ${year}`,
      `site:devex.com news`
    );
  }
  if (has("global") || exhaustive) {
    base.push(
      `global impact investing news ${year}`,
      `nonprofit funding news ${year}`,
      `site:ssir.org`,
      `site:devex.com news`,
      `site:alliancemagazine.org`
    );
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of base) {
    const k = q.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
    if (out.length >= max) break;
  }
  return out;
}

type NewsSeed = { title: string; url: string; snippet: string };

const GLOBAL_NEWS_SEEDS: NewsSeed[] = [
  {
    title: "Stanford Social Innovation Review",
    url: "https://ssir.org/",
    snippet: "Sector news portal seed — global",
  },
  {
    title: "Devex — News",
    url: "https://www.devex.com/news",
    snippet: "Sector news portal seed — global development",
  },
  {
    title: "Alliance Magazine — News",
    url: "https://www.alliancemagazine.org/news/",
    snippet: "Sector news portal seed — philanthropy",
  },
  {
    title: "World Bank — News",
    url: "https://www.worldbank.org/en/news",
    snippet: "Sector news portal seed — multilateral",
  },
  {
    title: "UNDP — News",
    url: "https://www.undp.org/news-centre",
    snippet: "Sector news portal seed — UNDP",
  },
];

const REGION_NEWS_SEEDS: Partial<Record<Exclude<GrantRegionId, "global">, NewsSeed[]>> = {
  au: [
    {
      title: "Pro Bono Australia — News",
      url: "https://probonoaustralia.com.au/news/",
      snippet: "Sector news portal seed",
    },
    {
      title: "Social Enterprise Australia",
      url: "https://www.socialenterprise.org.au/news",
      snippet: "Sector news portal seed",
    },
    {
      title: "Philanthropy Australia — News",
      url: "https://www.philanthropy.org.au/news/",
      snippet: "Sector news portal seed",
    },
    {
      title: "Community Directors — News",
      url: "https://www.communitydirectors.com.au/news",
      snippet: "Sector news portal seed",
    },
  ],
  nz: [
    {
      title: "Community Matters NZ — News",
      url: "https://www.communitymatters.govt.nz/news-and-resources/",
      snippet: "Sector news portal seed — NZ",
    },
  ],
  eu: [
    {
      title: "EURACTIV — Economy",
      url: "https://www.euractiv.com/sections/economy-jobs/",
      snippet: "Sector news portal seed — EU",
    },
  ],
  uk: [
    {
      title: "GOV.UK — News (funding)",
      url: "https://www.gov.uk/search/news-and-communications",
      snippet: "Sector news portal seed — UK",
    },
  ],
  us: [
    {
      title: "Philanthropy News Digest",
      url: "https://philanthropynewsdigest.org/",
      snippet: "Sector news portal seed — US",
    },
  ],
  ca: [
    {
      title: "Community Foundations of Canada — News",
      url: "https://communityfoundations.ca/news/",
      snippet: "Sector news portal seed — CA",
    },
  ],
  es: [
    {
      title: "Compromiso Empresarial",
      url: "https://www.compromisoempresarial.com/",
      snippet: "Sector news portal seed — ES",
    },
  ],
  latam: [
    {
      title: "CEPAL — News",
      url: "https://www.cepal.org/en/news",
      snippet: "Sector news portal seed — LATAM",
    },
    {
      title: "CAF — News",
      url: "https://www.caf.com/en/currently/news/",
      snippet: "Sector news portal seed — LATAM",
    },
  ],
  asia: [
    {
      title: "ADB — News",
      url: "https://www.adb.org/news",
      snippet: "Sector news portal seed — Asia",
    },
  ],
  africa: [
    {
      title: "AfDB — News",
      url: "https://www.afdb.org/en/news-and-events",
      snippet: "Sector news portal seed — Africa",
    },
    {
      title: "UNECA — Stories",
      url: "https://www.uneca.org/stories",
      snippet: "Sector news portal seed — Africa",
    },
  ],
  mena: [
    {
      title: "UNESCWA — News",
      url: "https://www.unescwa.org/news",
      snippet: "Sector news portal seed — MENA",
    },
    {
      title: "EBRD — News",
      url: "https://www.ebrd.com/news.html",
      snippet: "Sector news portal seed — MENA/Europe",
    },
  ],
};

export function sectorNewsPortalSeeds(prompt = ""): NewsSeed[] {
  const regions = newsRegions(prompt);
  const exhaustive = regions.has("global") && regions.size === 1;
  const seeds: NewsSeed[] = [...GLOBAL_NEWS_SEEDS];

  for (const [id, list] of Object.entries(REGION_NEWS_SEEDS) as [
    Exclude<GrantRegionId, "global">,
    NewsSeed[],
  ][]) {
    if (exhaustive || regions.has("global") || regions.has(id)) {
      seeds.push(...list);
    }
  }

  const seen = new Set<string>();
  return seeds.filter((s) => {
    const k = s.url.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * News portal seeds for specific regions only (gap-fill mid-run).
 * Always includes a couple of global news hubs as fallback.
 */
export function sectorNewsPortalSeedsForRegions(
  regions: Iterable<GrantRegionId | string>
): NewsSeed[] {
  const want = new Set(
    [...regions].map((r) => String(r).toLowerCase()).filter(Boolean)
  );
  if (want.size === 0) return [];

  const seeds: NewsSeed[] = [];
  // Always keep 1–2 global aggregators so gap-fill isn't empty if REGION_NEWS_SEEDS miss.
  seeds.push(GLOBAL_NEWS_SEEDS[0], GLOBAL_NEWS_SEEDS[1] ?? GLOBAL_NEWS_SEEDS[0]);

  for (const [id, list] of Object.entries(REGION_NEWS_SEEDS) as [
    Exclude<GrantRegionId, "global">,
    NewsSeed[],
  ][]) {
    if (want.has(id) || want.has("global")) {
      seeds.push(...list);
    }
  }

  const seen = new Set<string>();
  return seeds.filter((s) => {
    const k = s.url.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
