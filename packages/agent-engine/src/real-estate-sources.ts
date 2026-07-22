import type { AgentSpec } from "./types.js";
import { isRealEstateTarget } from "./opportunity-subtype.js";

/** Stable Spanish / EU property portals — never invent hosts. */
export const REAL_ESTATE_ALLOWED_HOSTS = [
  "idealista.com",
  "fotocasa.es",
  "habitaclia.com",
  "milanuncios.com",
  "pisos.com",
  "yaencontre.com",
  "indomio.es",
  "kyero.com",
  "fotocasa.com",
  "enalquiler.com",
] as const;

type ZoneDef = {
  match: RegExp;
  label: string;
  idealistaSlug: string;
  provinceHint: string;
  /** Comarca / specific area — preferred over province when both appear in the prompt. */
  specific?: boolean;
};

const ZONE_DEFS: ZoneDef[] = [
  { match: /alt\s*camp/i, label: "Alt Camp", idealistaSlug: "alt-camp-tarragona", provinceHint: "tarragona", specific: true },
  { match: /baix\s*camp/i, label: "Baix Camp", idealistaSlug: "baix-camp-tarragona", provinceHint: "tarragona", specific: true },
  { match: /alt\s*pened[eè]s/i, label: "Alt Penedès", idealistaSlug: "alt-penedes-barcelona", provinceHint: "barcelona", specific: true },
  { match: /baix\s*pened[eè]s/i, label: "Baix Penedès", idealistaSlug: "baix-penedes-tarragona", provinceHint: "tarragona", specific: true },
  { match: /priorat/i, label: "Priorat", idealistaSlug: "priorat-tarragona", provinceHint: "tarragona", specific: true },
  { match: /tarragona/i, label: "Tarragona", idealistaSlug: "tarragona-tarragona", provinceHint: "tarragona" },
  { match: /barcelona/i, label: "Barcelona", idealistaSlug: "barcelona-barcelona", provinceHint: "barcelona" },
  { match: /girona/i, label: "Girona", idealistaSlug: "girona-girona", provinceHint: "girona" },
  { match: /lleida/i, label: "Lleida", idealistaSlug: "lleida-lleida", provinceHint: "lleida" },
  { match: /madrid/i, label: "Madrid", idealistaSlug: "madrid-madrid", provinceHint: "madrid" },
  { match: /valencia|valència/i, label: "Valencia", idealistaSlug: "valencia-valencia", provinceHint: "valencia" },
];

/** Cities/areas that must NOT appear unless they are an explicit target zone. */
const FOREIGN_GEO_RE =
  /\b(fuenlabrada|alcal[aá]\s*de\s*henares|mostoles|m[oó]stoles|getafe|legan[eé]s|madrid|valencia|val[eè]ncia|sevilla|zaragoza|bilbao|murcia|alicante|m[aá]laga)\b/i;

const OFFTOPIC_RE =
  /\b(receta|recetas|comida|cocin[ao]|mexicana|wiktionary|wordreference|spanishdict|pinterest\.com\/pin|elgourmet|clara\.es\/bienestar)\b/i;

function blobOf(spec: AgentSpec): string {
  return `${spec.prompt} ${spec.filters?.criteria ?? ""} ${spec.search?.queries?.join(" ") ?? ""}`;
}

/** Parse max price in euros from prompt (50mil, 50.000, 50000, 50k). */
export function extractMaxPriceEuros(text: string): number | null {
  const t = text.toLowerCase().replace(/\./g, "").replace(/,/g, "");
  const m =
    t.match(/(?:máximo|maximo|hasta|max|under|upto|up to)\s*(?:de\s*)?(\d+)\s*(?:mil|k)\b/) ||
    t.match(/(\d+)\s*(?:mil|k)\s*(?:euros?|€)/) ||
    t.match(/(?:máximo|maximo|hasta|max|precio)\s*(?:de\s*)?(\d{4,7})\s*(?:euros?|€)?/) ||
    t.match(/(\d{4,7})\s*(?:euros?|€)/);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (/mil|\bk\b/i.test(m[0]) && n < 1000) n *= 1000;
  if (n < 1000 || n > 5_000_000) return null;
  return Math.round(n);
}

export function extractRealEstateZones(text: string): { label: string; idealistaSlug: string; provinceHint: string }[] {
  const matched = ZONE_DEFS.filter((z) => z.match.test(text));
  const specific = matched.filter((z) => z.specific);
  const use = specific.length > 0 ? specific : matched;
  const out: { label: string; idealistaSlug: string; provinceHint: string }[] = [];
  const seen = new Set<string>();
  for (const z of use) {
    if (seen.has(z.idealistaSlug)) continue;
    seen.add(z.idealistaSlug);
    out.push({ label: z.label, idealistaSlug: z.idealistaSlug, provinceHint: z.provinceHint });
  }
  return out;
}

/** Tokens that must appear in a hit (url/title/snippet) for geo relevance when zones are known. */
export function realEstateTargetGeoTokens(spec: AgentSpec): string[] {
  const zones = extractRealEstateZones(blobOf(spec));
  const tokens = new Set<string>();
  for (const z of zones) {
    tokens.add(z.label.toLowerCase());
    tokens.add(z.idealistaSlug.toLowerCase());
    tokens.add(z.provinceHint.toLowerCase());
    // Slug pieces: "alt-camp-tarragona" → alt-camp, alt camp
    const parts = z.idealistaSlug.split("-");
    if (parts.length >= 2) tokens.add(`${parts[0]}-${parts[1]}`);
    tokens.add(z.label.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""));
  }
  return [...tokens];
}

export function isBarePortalHomepage(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (!hostAllowed(host, REAL_ESTATE_ALLOWED_HOSTS)) return false;
    const path = u.pathname.replace(/\/$/, "") || "/";
    return path === "/";
  } catch {
    return false;
  }
}

/**
 * Drop SERP noise: recipes/dictionaries and listings outside the requested comarcas
 * (e.g. Fuenlabrada/Madrid when the goal is Alt Camp / Penedès).
 */
export function isRelevantRealEstateHit(
  hit: { title: string; url: string; snippet?: string },
  spec: AgentSpec
): boolean {
  if (!isRealEstateTarget(spec)) return true;
  const blob = `${hit.title} ${hit.url} ${hit.snippet ?? ""}`;
  if (/portal seed/i.test(hit.snippet ?? "")) return true;
  if (OFFTOPIC_RE.test(blob)) return false;

  const zones = extractRealEstateZones(blobOf(spec));
  if (zones.length === 0) return !FOREIGN_GEO_RE.test(blob);

  const hay = blob.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  const tokens = realEstateTargetGeoTokens(spec);
  const hasTargetGeo = tokens.some((t) => t.length >= 3 && hay.includes(t));

  // Hard reject well-known wrong metros when they are not target zones.
  const targetHints = new Set(zones.map((z) => z.provinceHint));
  if (FOREIGN_GEO_RE.test(blob)) {
    const foreignOk =
      (/\bmadrid\b/i.test(blob) && targetHints.has("madrid")) ||
      (/\bvalenc/i.test(blob) && targetHints.has("valencia"));
    if (!foreignOk) return false;
  }

  // Prefer hits that mention a requested comarca/slug; allow portal hosts only with geo cue.
  if (hasTargetGeo) return true;

  try {
    const host = new URL(hit.url).hostname.replace(/^www\./, "").toLowerCase();
    if (hostAllowed(host, REAL_ESTATE_ALLOWED_HOSTS)) {
      // Bare portal roots without zone → noise for scoped agents.
      if (isBarePortalHomepage(hit.url)) return false;
      // Listing URL without any target token → reject (stops Madrid Idealista pages).
      return false;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function filterRealEstateHits<T extends { title: string; url: string; snippet?: string }>(
  hits: T[],
  spec: AgentSpec
): T[] {
  if (!isRealEstateTarget(spec)) return hits;
  return hits.filter((h) => isRelevantRealEstateHit(h, spec));
}

function wantsRenovation(text: string): boolean {
  return /reformar|reforma|rehabilit|ruina|restaurar|renovat|fixer|a reformar|para reformar/i.test(
    text
  );
}

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

/**
 * Drop or rewrite `site:` operators that point at invented / off-scope hosts
 * (e.g. site:realestate.com.au for Catalan houses).
 */
export function sanitizeSiteQueries(
  queries: string[],
  allowedHosts: readonly string[]
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of queries) {
    const q = raw.trim();
    if (!q) continue;
    const siteMatch = q.match(/\bsite:([a-z0-9.-]+)/i);
    let cleaned = q;
    if (siteMatch) {
      const host = siteMatch[1];
      if (!hostAllowed(host, allowedHosts)) {
        cleaned = q
          .replace(/\bsite:[a-z0-9.-]+\s*/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
    if (cleaned.length < 4) continue;
    // Reject leftover fake TLD-looking invented brands without site:
    if (
      /\brealestate(?:baix|alt|spain|mallorca|napols|np|pen)\w*\.com\b/i.test(cleaned) ||
      /\bsite:realestate\.com\.au\b/i.test(q)
    ) {
      cleaned = cleaned
        .replace(/\brealestate\w*\.com\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (cleaned.length < 4) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

export function sanitizePortalsList(portals: string[], allowedHosts: readonly string[]): string[] {
  return portals.filter((p) => {
    const host = p
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .toLowerCase()
      .replace(/^www\./, "");
    return hostAllowed(host, allowedHosts);
  });
}

export type RealEstatePortalSeed = { title: string; url: string; snippet: string };

/**
 * Deep-link portal seeds so property agents never finish with zero sources when SERP is blocked.
 */
export function realEstatePortalDeepLinkSeeds(spec: AgentSpec): RealEstatePortalSeed[] {
  if (!isRealEstateTarget(spec)) return [];
  const blob = blobOf(spec);
  const zones = extractRealEstateZones(blob);
  const maxPrice = extractMaxPriceEuros(blob);
  const reno = wantsRenovation(blob);
  const priceSeg = maxPrice ? `con-precio-hasta_${maxPrice}/` : "";
  const keyword = reno ? "casas a reformar" : "casas en venta";
  const enc = encodeURIComponent(
    reno
      ? `${keyword}${maxPrice ? ` hasta ${maxPrice}` : ""} ${zones.map((z) => z.label).join(" ")}`.trim()
      : `${keyword} ${zones.map((z) => z.label).join(" ")}`.trim() || "casas España"
  );

  const seeds: RealEstatePortalSeed[] = [];

  if (zones.length > 0) {
    for (const z of zones.slice(0, 6)) {
      seeds.push({
        title: `Idealista — venta ${z.label}${maxPrice ? ` ≤${maxPrice}€` : ""}`,
        url: `https://www.idealista.com/venta-viviendas/${z.idealistaSlug}/${priceSeg}`,
        snippet: "Portal seed: Idealista zone search.",
      });
      if (reno) {
        seeds.push({
          title: `Idealista — reformar ${z.label}`,
          url: `https://www.idealista.com/buscar/venta-viviendas/${encodeURIComponent(`casas a reformar ${z.label}`)}/`,
          snippet: "Portal seed: Idealista renovation keyword search.",
        });
      }
      seeds.push({
        title: `Fotocasa — ${z.label}${maxPrice ? ` ≤${maxPrice}€` : ""}`,
        url: `https://www.fotocasa.es/es/comprar/viviendas/${encodeURIComponent(z.label.toLowerCase())}/todas-las-zonas/l${maxPrice ? `?maxPrice=${maxPrice}` : ""}${reno ? `&text=${encodeURIComponent("reformar")}` : ""}`,
        snippet: "Portal seed: Fotocasa zone search.",
      });
      seeds.push({
        title: `Habitaclia — ${z.label}`,
        url: `https://www.habitaclia.com/viviendas-${z.idealistaSlug.replace(/-/g, "_")}.htm`,
        snippet: "Portal seed: Habitaclia zone.",
      });
    }
    // Key towns inside Catalan comarcas — better Idealista coverage than province-wide.
    const townSeeds: { label: string; slug: string }[] = [];
    const blobLower = blob.toLowerCase();
    if (/alt\s*camp/i.test(blobLower)) townSeeds.push({ label: "Valls", slug: "valls-tarragona" });
    if (/baix\s*camp/i.test(blobLower)) {
      townSeeds.push({ label: "Reus", slug: "reus-tarragona" });
      townSeeds.push({ label: "Cambrils", slug: "cambrils-tarragona" });
    }
    if (/alt\s*pened/i.test(blobLower)) {
      townSeeds.push({ label: "Vilafranca del Penedès", slug: "vilafranca-del-penedes-barcelona" });
    }
    if (/baix\s*pened/i.test(blobLower)) {
      townSeeds.push({ label: "El Vendrell", slug: "el-vendrell-tarragona" });
      townSeeds.push({ label: "Calafell", slug: "calafell-tarragona" });
    }
    for (const t of townSeeds.slice(0, 8)) {
      seeds.push({
        title: `Idealista — ${t.label}${maxPrice ? ` ≤${maxPrice}€` : ""}`,
        url: `https://www.idealista.com/venta-viviendas/${t.slug}/${priceSeg}`,
        snippet: "Portal seed: Idealista town search.",
      });
    }
  } else {
    seeds.push({
      title: `Idealista — búsqueda ${keyword}`,
      url: `https://www.idealista.com/buscar/venta-viviendas/${enc}/`,
      snippet: "Portal seed: Idealista keyword search.",
    });
    seeds.push({
      title: `Fotocasa — España${maxPrice ? ` ≤${maxPrice}€` : ""}`,
      url: `https://www.fotocasa.es/es/comprar/viviendas/espana/todas-las-zonas/l${maxPrice ? `?maxPrice=${maxPrice}` : ""}${reno ? `&text=${encodeURIComponent("reformar")}` : ""}`,
      snippet: "Portal seed: Fotocasa Spain search.",
    });
  }

  seeds.push(
    {
      title: `Habitaclia — ${keyword}`,
      url: `https://www.habitaclia.com/viviendas.htm?texto=${enc}`,
      snippet: "Portal seed: Habitaclia.",
    },
    {
      title: `Milanuncios — ${keyword}`,
      url: `https://www.milanuncios.com/inmobiliaria/?q=${enc}`,
      snippet: "Portal seed: Milanuncios inmobiliaria.",
    },
    {
      title: `Pisos.com — ${keyword}`,
      url: `https://www.pisos.com/buscar/venta-pisos/${enc}/`,
      snippet: "Portal seed: Pisos.com.",
    },
    {
      title: `Yaencontre — ${keyword}`,
      url: `https://www.yaencontre.com/venta${maxPrice ? `?precio-max=${maxPrice}` : ""}`,
      snippet: "Portal seed: Yaencontre.",
    }
  );

  const seen = new Set<string>();
  return seeds.filter((s) => {
    const k = s.url.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Deterministic SERP queries for property agents (Spanish, real portals only). */
export function realEstateSeedQueries(spec: AgentSpec, max = 12): string[] {
  if (!isRealEstateTarget(spec)) return [];
  const blob = blobOf(spec);
  const zones = extractRealEstateZones(blob);
  const maxPrice = extractMaxPriceEuros(blob);
  const reno = wantsRenovation(blob);
  const priceBit = maxPrice ? `hasta ${maxPrice}` : "barata";
  const verb = reno ? "a reformar" : "en venta";
  const out: string[] = [];
  const push = (q: string) => {
    const t = q.trim();
    if (!t || out.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    out.push(t);
  };

  const zoneLabels = zones.length > 0 ? zones.map((z) => z.label) : ["España"];
  for (const label of zoneLabels) {
    push(`casas ${verb} ${label} ${priceBit} euros`);
    push(`casa ${verb} ${label} ${priceBit}`);
    push(`site:idealista.com casas ${verb} ${label}`);
    push(`site:fotocasa.es casa ${verb} ${label}`);
    if (out.length >= max) break;
  }
  push(`site:habitaclia.com casas ${verb}`);
  push(`site:milanuncios.com casa ${verb} ${priceBit}`);
  push(`site:pisos.com viviendas ${verb}`);
  if (reno) {
    push(`masía o chalet a rehabilitar ${zoneLabels[0]} ${priceBit}`);
    push(`vivienda ruina o a restaurar ${zoneLabels[0]}`);
  }
  return out.slice(0, max);
}

export function realEstateExpansionQueries(
  spec: AgentSpec,
  alreadyUsed: Set<string>,
  count: number
): string[] {
  if (count <= 0 || !isRealEstateTarget(spec)) return [];
  const seeds = realEstateSeedQueries(spec, count + 8);
  const out: string[] = [];
  for (const q of seeds) {
    const norm = q.trim().toLowerCase();
    if (!norm || alreadyUsed.has(norm) || out.some((x) => x.toLowerCase() === norm)) continue;
    out.push(q.trim());
    if (out.length >= count) break;
  }
  return out;
}
