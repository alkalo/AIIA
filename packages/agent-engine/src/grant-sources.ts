import type { AgentSpec } from "./types.js";
import { isGrantTarget, isCurationOpportunityTarget } from "./opportunity-subtype.js";

const STOP_WORDS = new Set([
  "de", "la", "el", "en", "un", "una", "del", "los", "las", "por", "con", "para",
  "the", "and", "for", "que", "grant", "grants", "subvenc", "funding", "convocatoria",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

/** Regions inferred from the agent prompt / criteria. */
export type GrantRegionId =
  | "global"
  | "au"
  | "nz"
  | "eu"
  | "uk"
  | "us"
  | "ca"
  | "es"
  | "latam"
  | "asia"
  | "africa"
  | "mena";

export function detectGrantRegions(blob: string): Set<GrantRegionId> {
  const regions = new Set<GrantRegionId>();
  if (/australia|australian|\bau\b|frrr|grantconnect/i.test(blob)) regions.add("au");
  if (/new zealand|\bnz\b|aotearoa|communitymatters/i.test(blob)) regions.add("nz");
  if (/europe|\beu\b|horizon|cordis|european|creative europe/i.test(blob)) regions.add("eu");
  if (/\buk\b|united kingdom|british|england|scotland|wales/i.test(blob)) regions.add("uk");
  if (/\busa\b|united states|\bu\.s\.a?\b|grants\.gov/i.test(blob)) regions.add("us");
  if (/canada|canadian/i.test(blob)) regions.add("ca");
  if (/spain|españa|español|madrid|barcelona|gobierno de españa|boe\.es/i.test(blob)) {
    regions.add("es");
  }
  if (/latam|latin america|latinoam|mexico|méxico|brasil|brazil|argentina|chile|colombia|peru|perú/i.test(blob)) {
    regions.add("latam");
  }
  if (/asia|india|japan|singapore|asean|indonesia|philippines|korea|china/i.test(blob)) {
    regions.add("asia");
  }
  if (
    /africa|african|\bsahel\b|nigeria|kenya|ghana|ethiopia|senegal|south africa|afdb|african development bank/i.test(
      blob
    )
  ) {
    regions.add("africa");
  }
  if (
    /\bmena\b|middle east|norte de [aá]frica|north africa|maghreb|gulf|arab|saudi|uae|egypt|jordan|lebanon|morocco|tunisia|isdb|islamic development bank/i.test(
      blob
    )
  ) {
    regions.add("mena");
  }
  if (/global|worldwide|international|exhaustiv|todas las region|all countries|multi-?country/i.test(blob)) {
    regions.add("global");
  }
  // No region signal → treat as global exhaustive (best default for coverage).
  if (regions.size === 0) regions.add("global");
  return regions;
}

function wantsExhaustiveGlobal(regions: Set<GrantRegionId>): boolean {
  return regions.has("global") && regions.size === 1;
}

function preferEnglishSearch(spec: AgentSpec): boolean {
  const blob = `${spec.prompt} ${spec.filters.criteria}`;
  const regions = detectGrantRegions(blob);
  if (regions.has("es") && regions.size === 1) return false;
  if (regions.has("latam") && !regions.has("us") && !regions.has("au") && !regions.has("uk")) {
    return /english|inglés/i.test(blob);
  }
  return (
    regions.has("au") ||
    regions.has("nz") ||
    regions.has("uk") ||
    regions.has("us") ||
    regions.has("ca") ||
    regions.has("eu") ||
    regions.has("global") ||
    regions.has("asia") ||
    regions.has("africa") ||
    regions.has("mena") ||
    /wellbeing|grant|funding/i.test(blob)
  );
}

function coreKeywords(spec: AgentSpec, max = 6): string {
  if (preferEnglishSearch(spec)) {
    const en = [
      "community",
      "wellbeing",
      "grant",
      "australia",
      "new zealand",
      "local",
      "nonprofit",
      "funding",
      "rural",
    ];
    const blob = `${spec.prompt} ${spec.filters.criteria}`.toLowerCase();
    const picked = en.filter((w) => blob.includes(w) || blob.includes(w.replace(" ", "")));
    if (/australia|australian|au\b/i.test(blob)) picked.unshift("australia");
    if (/new zealand|nz\b/i.test(blob)) picked.unshift("new zealand");
    if (/wellbeing|bienestar/i.test(blob)) picked.unshift("wellbeing");
    if (/community|comunidad/i.test(blob)) picked.unshift("community");
    if (/global|international|worldwide/i.test(blob)) picked.unshift("global");
    return [...new Set(picked)].slice(0, max).join(" ") || "community grant funding";
  }
  const tokens = tokenize(`${spec.prompt} ${spec.filters.criteria}`);
  return [...new Set(tokens)].slice(0, max).join(" ");
}

interface GrantBoards {
  id: GrantRegionId;
  match: RegExp;
  boards: string[];
}

const GLOBAL_GRANT_BOARDS = [
  "fundsforngos.org",
  "grantwatch.com",
  "devex.com",
  "globalgiving.org",
  "candid.org",
  "grantmaker.io",
  "instrumentl.com",
  "terravivagrants.org",
  "worldbank.org",
  "undp.org",
];

const GRANT_BOARDS_BY_REGION: GrantBoards[] = [
  {
    id: "au",
    match: /australia|australian|au\b|nz\b|new zealand|frrr|rural|regional renewal/i,
    boards: [
      "communitygrantguru.com.au",
      "business.gov.au/grants",
      "philanthropy.org.au",
      "frrr.org.au",
      "ourcommunity.com.au",
      "grants.gov.au",
      "communitygrants.gov.au",
      "grantly.au",
    ],
  },
  {
    id: "nz",
    match: /new zealand|nz\b|aotearoa/i,
    boards: ["communitymatters.govt.nz", "govt.nz"],
  },
  {
    id: "es",
    match: /spain|españa|español|\bes\b|madrid|barcelona|gobierno de españa|boe\.es/i,
    boards: [
      "sede.administracion.gob.es",
      "boe.es",
      "cdti.es",
      "enisa.es",
      "fundaciononce.es",
      "info.igae.pap.hacienda.gob.es",
    ],
  },
  {
    id: "eu",
    match: /europe|eu\b|horizon|cordis|european/i,
    boards: [
      "ec.europa.eu/info/funding-tenders",
      "cordis.europa.eu",
      "eic.ec.europa.eu",
      "culture.ec.europa.eu",
    ],
  },
  {
    id: "uk",
    match: /uk\b|united kingdom|british|england/i,
    boards: ["gov.uk", "grantfinder.co.uk", "tnlcommunityfund.org.uk", "fundingcentral.org.uk"],
  },
  {
    id: "us",
    match: /usa\b|united states|u\.s\.a?\b|grants\.gov/i,
    boards: ["grants.gov", "foundationcenter.org", "grantwatch.com", "instrumentl.com"],
  },
  {
    id: "ca",
    match: /canada|canadian/i,
    boards: ["canada.ca", "grantwatch.com"],
  },
  {
    id: "latam",
    match: /latam|latin america|latinoam|mexico|brasil|argentina|chile|colombia/i,
    boards: ["fundsforngos.org", "iadb.org", "cepal.org", "caf.com"],
  },
  {
    id: "asia",
    match: /asia|india|singapore|asean|indonesia|japan/i,
    boards: ["fundsforngos.org", "adb.org", "terravivagrants.org"],
  },
  {
    id: "africa",
    match: /africa|african|nigeria|kenya|ghana|ethiopia|senegal|afdb/i,
    boards: ["afdb.org", "uneca.org", "fundsforngos.org", "terravivagrants.org"],
  },
  {
    id: "mena",
    match: /mena|middle east|maghreb|gulf|arab|egypt|morocco|isdb/i,
    boards: ["isdb.org", "unescwa.org", "fundsforngos.org", "ebrd.com"],
  },
];

export function grantBoards(spec: AgentSpec): string[] {
  const blob = `${spec.prompt} ${spec.filters.criteria} ${spec.search.queries.join(" ")}`;
  const regions = detectGrantRegions(blob);
  const boards = [...GLOBAL_GRANT_BOARDS];
  const exhaustive = wantsExhaustiveGlobal(regions);

  for (const region of GRANT_BOARDS_BY_REGION) {
    if (exhaustive || regions.has(region.id) || region.match.test(blob)) {
      // Avoid Spain boards when goal is clearly AU/NZ-only (Spanish prompt for AU).
      if (
        (regions.has("au") || regions.has("nz")) &&
        !regions.has("es") &&
        !exhaustive &&
        region.id === "es"
      ) {
        continue;
      }
      boards.push(...region.boards);
    }
  }
  return [...new Set(boards)];
}

function isSpanish(spec: AgentSpec): boolean {
  if (preferEnglishSearch(spec)) return false;
  return /(ci[oó]n|subvenc|convocatoria|espa[nñ]a|ayuda|beca)/i.test(
    `${spec.prompt} ${spec.filters.criteria}`
  );
}

export function grantExpansionQueries(
  spec: AgentSpec,
  alreadyUsed: Set<string>,
  count: number
): string[] {
  if (!isGrantTarget(spec) || count <= 0) return [];
  const core = coreKeywords(spec);
  if (!core) return [];

  const out: string[] = [];
  const push = (q: string) => {
    const norm = q.trim().toLowerCase();
    if (!norm || alreadyUsed.has(norm) || out.some((x) => x.toLowerCase() === norm)) return;
    out.push(q.trim());
  };

  const boards = grantBoards(spec);
  const es = isSpanish(spec);

  for (const board of boards) {
    push(`site:${board} ${core}`);
    if (out.length >= count) return out.slice(0, count);
  }

  const variants = es
    ? [
        `${core} convocatoria abierta`,
        `${core} subvención plazo`,
        `${core} ayudas financiación`,
        `${core} becas deadline`,
        `${core} financiación abierta internacional`,
      ]
    : [
        `${core} grant application deadline`,
        `${core} funding opportunity open`,
        `${core} community grant closing date`,
        `${core} foundation grant apply now`,
        `${core} open round grants`,
        `${core} call for proposals open`,
      ];
  for (const v of variants) {
    push(v);
    if (out.length >= count) break;
  }

  return out.slice(0, count);
}

/** Banco de consultas EN prioritarias para ola 0 (antes / junto al plan LLM). */
export function grantSeedQueries(spec: AgentSpec, max = 12): string[] {
  if (!isGrantTarget(spec)) return [];
  const used = new Set<string>();
  const out: string[] = [];
  const push = (q: string) => {
    const norm = q.trim().toLowerCase();
    if (!norm || used.has(norm)) return;
    used.add(norm);
    out.push(q.trim());
  };

  const blob = `${spec.prompt} ${spec.filters.criteria}`;
  const regions = detectGrantRegions(blob);
  const exhaustive = wantsExhaustiveGlobal(regions);

  if (regions.has("au") || exhaustive) {
    push("community grant australia open deadline");
    push("FRRR community grant application open");
    push("site:business.gov.au/grants community wellbeing open");
    push("site:grants.gov.au open grant community");
    push("site:communitygrants.gov.au grant open");
    push("site:frrr.org.au funding grant closing");
    push("site:philanthropy.org.au grant open");
  }
  if (regions.has("nz") || exhaustive) {
    push("new zealand community wellbeing grant open");
    push("site:communitymatters.govt.nz grant open");
    push("new zealand lottery grants board community");
  }
  if (regions.has("eu") || exhaustive) {
    push("EU funding opportunities open call");
    push("site:ec.europa.eu/info/funding-tenders open call");
    push("horizon europe call for proposals open");
  }
  if (regions.has("uk") || exhaustive) {
    push("UK community grant open applications");
    push("site:gov.uk grant funding open");
    push("site:tnlcommunityfund.org.uk funding open");
  }
  if (regions.has("us") || exhaustive) {
    push("site:grants.gov open opportunity community nonprofit");
    push("US foundation grant open deadline nonprofit");
  }
  if (regions.has("ca") || exhaustive) {
    push("Canada community grant open funding");
    push("site:canada.ca funding grant open");
  }
  if (regions.has("es") || exhaustive) {
    push("convocatoria subvención abierta España");
    push("site:boe.es subvenciones convocatoria");
    push("ayudas financiación proyectos España plazo");
  }
  if (regions.has("latam") || exhaustive) {
    push("Latin America NGO grant open funding");
    push("site:fundsforngos.org latin america grant");
  }
  if (regions.has("asia") || exhaustive) {
    push("Asia Pacific community grant open");
    push("site:fundsforngos.org asia grant deadline");
  }
  if (regions.has("africa") || exhaustive) {
    push("Africa NGO grant open funding deadline");
    push("site:afdb.org funding opportunity open");
    push("African Development Bank call for proposals");
  }
  if (regions.has("mena") || exhaustive) {
    push("Middle East North Africa grant open funding");
    push("site:isdb.org funding opportunity open");
    push("MENA community development grant deadline");
  }

  push("global community wellbeing grant application open");
  push("site:fundsforngos.org community grant open");
  push("site:devex.com funding opportunity open");
  push("site:globalgiving.org funding");
  push("site:worldbank.org opportunities funding");
  push("site:undp.org funding opportunity open");

  const expanded = grantExpansionQueries(spec, used, Math.max(0, max - out.length));
  for (const q of expanded) push(q);

  return out.slice(0, max);
}

export interface GrantPortalSeed {
  title: string;
  url: string;
  snippet: string;
}

const GLOBAL_SEEDS: GrantPortalSeed[] = [
  {
    title: "Funds for NGOs — grants",
    url: "https://www2.fundsforngos.org/category/latest-funds-for-ngos/",
    snippet: "Portal seed: global NGO / community grant listings.",
  },
  {
    title: "GlobalGiving — projects",
    url: "https://www.globalgiving.org/search/",
    snippet: "Portal seed: GlobalGiving search listings.",
  },
  {
    title: "Devex — Funding",
    url: "https://www.devex.com/funding",
    snippet: "Portal seed: Devex international funding opportunities.",
  },
  {
    title: "Terra Viva Grants",
    url: "https://terravivagrants.org/",
    snippet: "Portal seed: Terra Viva global grant directory.",
  },
  {
    title: "Candid — Funding Information Network",
    url: "https://candid.org/find-funding",
    snippet: "Portal seed: Candid / Foundation Directory style funding search.",
  },
  {
    title: "GrantWatch — latest grants",
    url: "https://www.grantwatch.com/grant-search.php",
    snippet: "Portal seed: GrantWatch searchable open grants.",
  },
  {
    title: "World Bank — Opportunities",
    url: "https://www.worldbank.org/en/opportunities",
    snippet: "Portal seed: World Bank opportunities / procurement / funding.",
  },
  {
    title: "UNDP — Funding",
    url: "https://www.undp.org/funding",
    snippet: "Portal seed: UNDP funding and partnership opportunities.",
  },
];

const REGION_SEEDS: Record<Exclude<GrantRegionId, "global">, GrantPortalSeed[]> = {
  au: [
    {
      title: "GrantConnect — open grant list",
      url: "https://www.grants.gov.au/Go/List",
      snippet: "Portal seed: Australian Government open grant listings (deep list).",
    },
    {
      title: "Community Grants Hub (AU)",
      url: "https://www.communitygrants.gov.au/grants",
      snippet: "Portal seed: Australian Community Grants Hub listings.",
    },
    {
      title: "business.gov.au — Grants and programs",
      url: "https://business.gov.au/grants-and-programs",
      snippet: "Portal seed: Australian business / community grant programs.",
    },
    {
      title: "FRRR — funding programs",
      url: "https://frrr.org.au/funding/",
      snippet: "Portal seed: FRRR community funding programs.",
    },
    {
      title: "Philanthropy Australia — funding",
      url: "https://www.philanthropy.org.au/seek-funding/",
      snippet: "Portal seed: Philanthropy Australia funding directory.",
    },
    {
      title: "Grantly (AU) — open grants",
      url: "https://www.grantly.au/",
      snippet: "Portal seed: Grantly community grant portal.",
    },
  ],
  nz: [
    {
      title: "Community Matters (NZ)",
      url: "https://www.communitymatters.govt.nz/",
      snippet: "Portal seed: NZ community funding.",
    },
    {
      title: "New Zealand Government — Funding",
      url: "https://www.govt.nz/browse/engaging-with-government/funding/",
      snippet: "Portal seed: NZ government funding browse.",
    },
  ],
  eu: [
    {
      title: "EU Funding & Tenders Portal",
      url: "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/home",
      snippet: "Portal seed: EU Funding & Tenders.",
    },
    {
      title: "CORDIS — EU research results / calls",
      url: "https://cordis.europa.eu/search",
      snippet: "Portal seed: EU CORDIS opportunities search.",
    },
  ],
  uk: [
    {
      title: "GOV.UK — Government grants",
      url: "https://www.gov.uk/government/collections/government-grants",
      snippet: "Portal seed: UK government grants collection.",
    },
    {
      title: "The National Lottery Community Fund",
      url: "https://www.tnlcommunityfund.org.uk/funding",
      snippet: "Portal seed: UK National Lottery Community Fund.",
    },
    {
      title: "Funding Central (UK)",
      url: "https://www.fundingcentral.org.uk/",
      snippet: "Portal seed: UK Funding Central directory.",
    },
  ],
  us: [
    {
      title: "Grants.gov — Find Grants",
      url: "https://www.grants.gov/search-grants",
      snippet: "Portal seed: US federal grants search.",
    },
    {
      title: "GrantWatch — open grants",
      url: "https://www.grantwatch.com/",
      snippet: "Portal seed: GrantWatch listings.",
    },
    {
      title: "Instrumentl — grants",
      url: "https://www.instrumentl.com/grants",
      snippet: "Portal seed: Instrumentl grant discovery.",
    },
  ],
  ca: [
    {
      title: "Canada.ca — Funding",
      url: "https://www.canada.ca/en/services/business/grants.html",
      snippet: "Portal seed: Canadian government grants.",
    },
    {
      title: "IDRC — Funding",
      url: "https://idrc-crdi.ca/en/funding",
      snippet: "Portal seed: IDRC research funding opportunities.",
    },
    {
      title: "Community Foundations of Canada",
      url: "https://communityfoundations.ca/",
      snippet: "Portal seed: Canadian community foundations network.",
    },
  ],
  es: [
    {
      title: "BOE — Ayudas y subvenciones",
      url: "https://www.boe.es/buscar/ayudas.php",
      snippet: "Portal seed: convocatorias y ayudas BOE.",
    },
    {
      title: "Sede Administración — ayudas",
      url: "https://sede.administracion.gob.es/",
      snippet: "Portal seed: sede electrónica España.",
    },
    {
      title: "CDTI — ayudas",
      url: "https://www.cdti.es/",
      snippet: "Portal seed: CDTI innovación / ayudas España.",
    },
    {
      title: "ENISA — financiación",
      url: "https://www.enisa.es/",
      snippet: "Portal seed: ENISA financiación emprendedores España.",
    },
  ],
  latam: [
    {
      title: "IDB — Opportunities",
      url: "https://www.iadb.org/en/how-we-can-work-together",
      snippet: "Portal seed: Inter-American Development Bank.",
    },
    {
      title: "CEPAL / ECLAC — Projects & events",
      url: "https://www.cepal.org/en/projects",
      snippet: "Portal seed: UN Economic Commission for Latin America and the Caribbean.",
    },
    {
      title: "CAF — News & opportunities",
      url: "https://www.caf.com/en/currently/news/",
      snippet: "Portal seed: CAF Development Bank of Latin America.",
    },
  ],
  asia: [
    {
      title: "Asian Development Bank — Opportunities",
      url: "https://www.adb.org/opportunities",
      snippet: "Portal seed: ADB funding / opportunities.",
    },
  ],
  africa: [
    {
      title: "African Development Bank — Projects & operations",
      url: "https://www.afdb.org/en/projects-and-operations",
      snippet: "Portal seed: AfDB projects and funding operations.",
    },
    {
      title: "African Development Bank — Business opportunities",
      url: "https://www.afdb.org/en/projects-and-operations/business-opportunities",
      snippet: "Portal seed: AfDB procurement / business opportunities.",
    },
    {
      title: "UNECA — Events & news",
      url: "https://www.uneca.org/events",
      snippet: "Portal seed: UN Economic Commission for Africa events.",
    },
    {
      title: "UNECA — News",
      url: "https://www.uneca.org/stories",
      snippet: "Portal seed: UNECA stories and announcements.",
    },
    {
      title: "Funds for NGOs — Africa",
      url: "https://www2.fundsforngos.org/developing-countries-africa/",
      snippet: "Portal seed: Africa-focused NGO funding listings.",
    },
  ],
  mena: [
    {
      title: "Islamic Development Bank — Opportunities",
      url: "https://www.isdb.org/",
      snippet: "Portal seed: IsDB development financing / opportunities.",
    },
    {
      title: "UNESCWA — Events",
      url: "https://www.unescwa.org/events",
      snippet: "Portal seed: UNESCWA events and calls.",
    },
    {
      title: "UNESCWA — News",
      url: "https://www.unescwa.org/news",
      snippet: "Portal seed: UNESCWA news and opportunities.",
    },
    {
      title: "EBRD — Procurement notices",
      url: "https://www.ebrd.com/work-with-us/procurement/notices.html",
      snippet: "Portal seed: EBRD procurement (Europe + MENA overlap).",
    },
    {
      title: "EBRD — News",
      url: "https://www.ebrd.com/news.html",
      snippet: "Portal seed: EBRD news and project announcements.",
    },
    {
      title: "Funds for NGOs — Middle East",
      url: "https://www2.fundsforngos.org/developing-countries-middle-east/",
      snippet: "Portal seed: MENA-focused NGO funding listings.",
    },
  ],
};

/**
 * Deep-link portal seeds so grant agents never finish with zero sources when SERP is blocked.
 * Uses stable https portals (not fragile planner-invented URLs).
 * Global / unspecified prompts load all major regional atlases (exhaustive default).
 */
export function grantPortalDeepLinkSeeds(spec: AgentSpec): GrantPortalSeed[] {
  if (!isGrantTarget(spec) && !isCurationOpportunityTarget(spec)) return [];
  const blob = `${spec.prompt} ${spec.filters.criteria}`;
  const regions = detectGrantRegions(blob);
  const exhaustive = wantsExhaustiveGlobal(regions);

  const seeds: GrantPortalSeed[] = [...GLOBAL_SEEDS];

  // When prompt is AU/NZ-specific (not global), skip unrelated heavy regions.
  const auNzOnly =
    (regions.has("au") || regions.has("nz")) &&
    !regions.has("global") &&
    !regions.has("eu") &&
    !regions.has("us") &&
    !regions.has("uk") &&
    !regions.has("es") &&
    !regions.has("latam") &&
    !regions.has("asia") &&
    !regions.has("africa") &&
    !regions.has("mena") &&
    !regions.has("ca");

  for (const id of Object.keys(REGION_SEEDS) as Exclude<GrantRegionId, "global">[]) {
    if (auNzOnly && id !== "au" && id !== "nz") continue;
    const want =
      exhaustive || regions.has("global") || regions.has(id);
    if (!want) continue;
    seeds.push(...REGION_SEEDS[id]);
  }

  // Dedupe by URL
  const seen = new Set<string>();
  return seeds.filter((s) => {
    const k = s.url.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Portal seeds for specific regions only (gap-fill mid-run).
 * Always includes a couple of global aggregators as fallback.
 */
export function grantPortalSeedsForRegions(
  regions: Iterable<GrantRegionId | string>
): GrantPortalSeed[] {
  const want = new Set(
    [...regions].map((r) => String(r).toLowerCase()).filter(Boolean)
  );
  if (want.size === 0) return [];

  const seeds: GrantPortalSeed[] = [];
  // Always keep 1–2 global aggregators so gap-fill isn't empty if REGION_SEEDS miss.
  if (want.has("global") || want.size > 0) {
    seeds.push(GLOBAL_SEEDS[0], GLOBAL_SEEDS[2] ?? GLOBAL_SEEDS[0]);
  }
  for (const id of Object.keys(REGION_SEEDS) as Exclude<GrantRegionId, "global">[]) {
    if (want.has(id) || want.has("global")) {
      seeds.push(...REGION_SEEDS[id]);
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
