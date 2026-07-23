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

function coreKeywords(spec: AgentSpec, max = 6): string {
  if (preferEnglishSearch(spec)) {
    // Spanish prompts for AU/NZ still need English SERP terms.
    const en = [
      "community",
      "wellbeing",
      "grant",
      "australia",
      "new zealand",
      "local",
      "nonprofit",
    ];
    const blob = `${spec.prompt} ${spec.filters.criteria}`.toLowerCase();
    const picked = en.filter((w) => blob.includes(w) || blob.includes(w.replace(" ", "")));
    if (/australia|australian|au\b/i.test(blob)) picked.unshift("australia");
    if (/new zealand|nz\b/i.test(blob)) picked.unshift("new zealand");
    if (/wellbeing|bienestar/i.test(blob)) picked.unshift("wellbeing");
    if (/community|comunidad/i.test(blob)) picked.unshift("community");
    return [...new Set(picked)].slice(0, max).join(" ") || "community grant australia";
  }
  const tokens = tokenize(`${spec.prompt} ${spec.filters.criteria}`);
  return [...new Set(tokens)].slice(0, max).join(" ");
}

interface GrantBoards {
  match: RegExp;
  boards: string[];
}

const GLOBAL_GRANT_BOARDS = [
  "fundsforngos.org",
  "grantwatch.com",
  "devex.com/grants",
  "foundationcenter.org",
  "globalgiving.org",
];

const GRANT_BOARDS_BY_REGION: GrantBoards[] = [
  {
    match: /australia|australian|au\b|nz\b|new zealand|frrr|rural|regional renewal/i,
    boards: [
      "communitygrantguru.com.au",
      "business.gov.au/grants",
      "philanthropy.org.au",
      "frrr.org.au",
      "ourcommunity.com.au",
      "grants.gov.au",
      "communitygrants.gov.au",
    ],
  },
  {
    // Require Spain/ES locale signals — do NOT match bare "subvenc" (Spanish prompts for AU/NZ).
    match: /spain|españa|español|\bes\b|madrid|barcelona|gobierno de españa|boe\.es/i,
    boards: [
      "sede.administracion.gob.es",
      "boe.es",
      "cdti.es",
      "enisa.es",
      "fundaciononce.es",
    ],
  },
  {
    match: /europe|eu\b|horizon|cordis|european/i,
    boards: [
      "ec.europa.eu/funding-tenders",
      "cordis.europa.eu",
      "eic.ec.europa.eu",
    ],
  },
  {
    match: /uk\b|united kingdom|british|england/i,
    boards: ["gov.uk/government/collections/government-grants", "grantfinder.co.uk"],
  },
  {
    match: /wellbeing|wellness|community|nonprofit|ngo|foundation/i,
    boards: ["lululemon.com/gives", "globalgiving.org", "candid.org"],
  },
];

export function grantBoards(spec: AgentSpec): string[] {
  const blob = `${spec.prompt} ${spec.filters.criteria} ${spec.search.queries.join(" ")}`;
  const boards = [...GLOBAL_GRANT_BOARDS];
  const isAuNz = /australia|australian|au\b|nz\b|new zealand|frrr/i.test(blob);
  for (const region of GRANT_BOARDS_BY_REGION) {
    // Skip Spain boards when the goal is clearly AU/NZ.
    if (isAuNz && /spain|españa|boe/i.test(region.match.source)) continue;
    if (region.match.test(blob)) boards.push(...region.boards);
  }
  return [...new Set(boards)];
}

/** Prefer English SERP queries for AU/NZ/global portals even if the agent prompt is Spanish. */
function preferEnglishSearch(spec: AgentSpec): boolean {
  const blob = `${spec.prompt} ${spec.filters.criteria}`;
  return /australia|australian|au\b|nz\b|new zealand|global|international|wellbeing/i.test(blob);
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
      ]
    : [
        `${core} grant application deadline`,
        `${core} funding opportunity open`,
        `${core} community grant closing date`,
        `${core} foundation grant apply now`,
        `${core} open round grants`,
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
  const au = /australia|australian|au\b/i.test(blob);
  const nz = /new zealand|nz\b/i.test(blob);

  if (au) {
    push("community grant australia open deadline");
    push("FRRR community grant application open");
    push("site:business.gov.au/grants community wellbeing open");
    push("site:grants.gov.au open grant community");
    push("site:communitygrants.gov.au grant open");
    push("site:frrr.org.au funding grant closing");
    push("site:philanthropy.org.au grant open");
  }
  if (nz) {
    push("new zealand community wellbeing grant open");
    push("site:communitymatters.govt.nz grant open");
    push("new zealand lottery grants board community");
  }
  if (!au && !nz) {
    push("community grant open deadline funding");
    push("global community wellbeing grant application");
  }
  push("global community wellbeing grant application open");
  push("site:fundsforngos.org australia community grant");

  const expanded = grantExpansionQueries(spec, used, Math.max(0, max - out.length));
  for (const q of expanded) push(q);

  return out.slice(0, max);
}

export interface GrantPortalSeed {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Deep-link portal seeds so grant agents never finish with zero sources when SERP is blocked.
 * Uses stable https portals (not fragile planner-invented URLs).
 */
export function grantPortalDeepLinkSeeds(spec: AgentSpec): GrantPortalSeed[] {
  if (!isGrantTarget(spec) && !isCurationOpportunityTarget(spec)) return [];
  const blob = `${spec.prompt} ${spec.filters.criteria}`;
  const au = /australia|australian|au\b/i.test(blob);
  const nz = /new zealand|nz\b/i.test(blob);
  const eu = /europe|eu\b|horizon|european/i.test(blob);
  const es = /spain|españa|boe\.es/i.test(blob) && !au && !nz;

  const seeds: GrantPortalSeed[] = [
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
  ];

  if (au || (!au && !nz && !es)) {
    seeds.unshift(
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
      }
    );
  }

  if (nz) {
    seeds.unshift(
      {
        title: "Community Matters (NZ)",
        url: "https://www.communitymatters.govt.nz/",
        snippet: "Portal seed: NZ community funding.",
      },
      {
        title: "New Zealand Government — Funding",
        url: "https://www.govt.nz/browse/engaging-with-government/funding/",
        snippet: "Portal seed: NZ government funding browse.",
      }
    );
  }

  if (eu) {
    seeds.push({
      title: "EU Funding & Tenders Portal",
      url: "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/home",
      snippet: "Portal seed: EU Funding & Tenders.",
    });
  }

  if (es) {
    seeds.push(
      {
        title: "BOE — Boletín Oficial del Estado",
        url: "https://www.boe.es/",
        snippet: "Portal seed: convocatorias España.",
      },
      {
        title: "Sede Administración — ayudas",
        url: "https://sede.administracion.gob.es/",
        snippet: "Portal seed: sede electrónica España.",
      }
    );
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
