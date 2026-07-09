import type { AgentSpec } from "./types.js";
import { isGrantTarget } from "./opportunity-subtype.js";

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
    ],
  },
  {
    match: /spain|españa|español|es\b|madrid|barcelona|subvenc|convocatoria/i,
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
  for (const region of GRANT_BOARDS_BY_REGION) {
    if (region.match.test(blob)) boards.push(...region.boards);
  }
  return [...new Set(boards)];
}

function isSpanish(spec: AgentSpec): boolean {
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
        `${core} community grant closing`,
        `${core} foundation grant apply`,
      ];
  for (const v of variants) {
    push(v);
    if (out.length >= count) break;
  }

  return out.slice(0, count);
}
