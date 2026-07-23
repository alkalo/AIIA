import type { AgentSpec, ContentMode, OpportunitySubtype } from "./types.js";

const GRANT_KEYWORDS = [
  "grant",
  "grants",
  "subvenc",
  "subsid",
  "convocatoria",
  "funding",
  "fondos",
  "beca",
  "ayuda",
  "financiación",
  "financiacion",
  "donation",
  "philanthrop",
  "foundation",
  "fundación",
  "fundacion",
  "horizon europe",
  "cordis",
];

const PROGRAM_KEYWORDS = [
  "fellowship",
  "fellowships",
  "accelerator",
  "incubator",
  "cohort",
  "bootcamp",
  "mentoring program",
  "programa de",
  "residenc",
];

const AWARD_KEYWORDS = [
  "award",
  "awards",
  "premio",
  "premios",
  "competition",
  "pitch competition",
  "challenge prize",
  "nominations open",
];

const EXPOSURE_KEYWORDS = [
  "speaking opportunity",
  "call for speakers",
  "call for contributors",
  "media feature",
  "showcase",
  "directory listing",
  "exposure opportunity",
];

const NEWS_KEYWORDS = [
  "sector news",
  "impact news",
  "news aggregator",
  "news wrap",
  "noticias del sector",
  "business for good news",
  "grants & impact news",
  "news only",
  "agregador de noticias",
];

const TENDER_KEYWORDS = [
  "tender",
  "tenders",
  "licitaci",
  "contrataci",
  "procurement",
  "rfp",
  "rfq",
  "bidding",
];

const EVENT_KEYWORDS = [
  "event",
  "events",
  "evento",
  "eventos",
  "conference",
  "summit",
  "hackathon",
  "webinar",
];

const DEAL_KEYWORDS = [
  "deal",
  "deals",
  "discount",
  "descuento",
  "promo",
  "coupon",
  "cupón",
  "cupon",
  "rebaja",
];

const REAL_ESTATE_KEYWORDS = [
  "casa",
  "casas",
  "piso",
  "pisos",
  "chalet",
  "chalets",
  "masía",
  "masia",
  "vivienda",
  "viviendas",
  "inmueble",
  "inmobiliari",
  "idealista",
  "fotocasa",
  "habitaclia",
  "milanuncios",
  "reformar",
  "reforma",
  "rehabilit",
  "a reformar",
  "para reformar",
  "real estate",
  "property for sale",
  "house for sale",
  "houses for sale",
  "houses-for-renovation",
  "fixer-upper",
  "terreno",
  "parcela",
];

const JOB_KEYWORDS = [
  "empleo",
  "vacante",
  "puesto",
  "contrat",
  "hiring",
  "job",
  "jobs",
  "vacancy",
  "position",
  "career",
  "trabajo",
  "trabajos",
  "oferta",
  "ofertas",
  "offer",
  "salario",
  "salary",
  "apply",
  "aplicar",
  "remote role",
  "job opening",
  "qa ",
  "developer",
  "engineer",
];

const CURATION_OPP_KEYWORDS = [
  "prime opportunities",
  "opportunity discovery",
  "opportunity curation",
  "buscador de oportunidades",
  "selector de oportunidades",
  "opportunities system",
];

function specBlob(spec: AgentSpec): string {
  return `${spec.prompt} ${spec.filters?.criteria ?? ""} ${spec.search?.queries?.join(" ") ?? ""} ${spec.name ?? ""} ${spec.contentMode ?? ""}`.toLowerCase();
}

function matchesAny(blob: string, keywords: string[]): boolean {
  return keywords.some((k) => blob.includes(k));
}

function inferSubtype(spec: AgentSpec): OpportunitySubtype {
  if (spec.contentMode === "sector_news") return "sector_news";
  if (spec.contentMode === "opportunities") return "grants";

  const tpl = (spec.templateId ?? "").toLowerCase();
  if (tpl.includes("job")) return "jobs";

  const blob = specBlob(spec);
  if (matchesAny(blob, NEWS_KEYWORDS)) return "sector_news";
  if (matchesAny(blob, PROGRAM_KEYWORDS)) return "programs";
  if (matchesAny(blob, AWARD_KEYWORDS)) return "awards";
  if (matchesAny(blob, EXPOSURE_KEYWORDS)) return "exposure";
  if (matchesAny(blob, GRANT_KEYWORDS) || matchesAny(blob, CURATION_OPP_KEYWORDS)) return "grants";
  if (matchesAny(blob, TENDER_KEYWORDS)) return "tenders";
  if (matchesAny(blob, EVENT_KEYWORDS)) return "events";
  // Property before jobs: "ofertas de casas" must not become employment.
  if (matchesAny(blob, REAL_ESTATE_KEYWORDS)) return "real_estate";
  // Jobs before deals: "oferta/offer" alone used to mis-classify employment as deals.
  if (matchesAny(blob, JOB_KEYWORDS)) return "jobs";
  if (matchesAny(blob, DEAL_KEYWORDS)) return "deals";

  if (tpl === "opportunities" || tpl === "monitoring") return "custom";
  return "custom";
}

export function resolveOpportunitySubtype(spec: AgentSpec): OpportunitySubtype {
  // Explicit subtypes win; bare "custom" falls through so keyword inference can upgrade
  // legacy agents (e.g. houses saved as custom before real_estate existed).
  if (spec.opportunitySubtype && spec.opportunitySubtype !== "custom") {
    return spec.opportunitySubtype;
  }
  return inferSubtype(spec);
}

export function resolveContentMode(spec: AgentSpec): ContentMode {
  if (spec.contentMode && spec.contentMode !== "auto") return spec.contentMode;
  const sub = resolveOpportunitySubtype(spec);
  if (sub === "sector_news") return "sector_news";
  const blob = specBlob(spec);
  if (/\b(wrap-?up|newsletter|bolet[ií]n|impact news.*grant|grant.*impact news)\b/i.test(blob)) {
    return "wrap";
  }
  if (
    sub === "grants" ||
    sub === "programs" ||
    sub === "awards" ||
    sub === "exposure" ||
    matchesAny(blob, CURATION_OPP_KEYWORDS)
  ) {
    return "opportunities";
  }
  return "auto";
}

export function isJobTarget(spec: AgentSpec): boolean {
  const tpl = (spec.templateId ?? "").toLowerCase();
  if (tpl.includes("job")) return true;
  return resolveOpportunitySubtype(spec) === "jobs";
}

/** Funding / grants (includes legacy "grants" subtype). */
export function isGrantTarget(spec: AgentSpec): boolean {
  const sub = resolveOpportunitySubtype(spec);
  return sub === "grants";
}

export function isProgramsTarget(spec: AgentSpec): boolean {
  return resolveOpportunitySubtype(spec) === "programs";
}

export function isAwardsTarget(spec: AgentSpec): boolean {
  return resolveOpportunitySubtype(spec) === "awards";
}

export function isExposureTarget(spec: AgentSpec): boolean {
  return resolveOpportunitySubtype(spec) === "exposure";
}

export function isSectorNewsTarget(spec: AgentSpec): boolean {
  return (
    resolveOpportunitySubtype(spec) === "sector_news" ||
    resolveContentMode(spec) === "sector_news"
  );
}

/** Any curated opportunity lane (funding / programs / awards / exposure). */
export function isCurationOpportunityTarget(spec: AgentSpec): boolean {
  const mode = resolveContentMode(spec);
  if (mode === "opportunities" || mode === "wrap") return true;
  const sub = resolveOpportunitySubtype(spec);
  return (
    sub === "grants" ||
    sub === "programs" ||
    sub === "awards" ||
    sub === "exposure" ||
    matchesAny(specBlob(spec), CURATION_OPP_KEYWORDS)
  );
}

export function isRealEstateTarget(spec: AgentSpec): boolean {
  return resolveOpportunitySubtype(spec) === "real_estate";
}

export function isTenderTarget(spec: AgentSpec): boolean {
  return resolveOpportunitySubtype(spec) === "tenders";
}

export function isOpportunityCardView(spec: AgentSpec): boolean {
  const sub = resolveOpportunitySubtype(spec);
  return (
    sub === "grants" ||
    sub === "programs" ||
    sub === "awards" ||
    sub === "exposure" ||
    sub === "tenders" ||
    sub === "events"
  );
}

export function defaultDedupeFields(spec: AgentSpec): string[] {
  const sub = resolveOpportunitySubtype(spec);
  if (sub === "sector_news") {
    return ["title", "url"];
  }
  if (sub === "grants" || sub === "programs" || sub === "awards" || sub === "exposure" || sub === "tenders") {
    return ["organization", "program_name", "url"];
  }
  if (sub === "events" || sub === "real_estate") {
    return ["title", "url"];
  }
  return ["title", "url"];
}

export function defaultOutputSchema(spec: AgentSpec): string[] {
  const sub = resolveOpportunitySubtype(spec);
  if (sub === "sector_news") {
    return [
      "title",
      "summary",
      "source",
      "publication_date",
      "url",
      "why_it_may_matter",
      "score",
      "reason",
    ];
  }
  if (sub === "grants" || sub === "programs" || sub === "awards" || sub === "exposure" || sub === "tenders") {
    return [
      "category",
      "scope",
      "organization",
      "program_name",
      "description",
      "eligibility",
      "primary_audience",
      "max_funding",
      "value_or_benefit",
      "currency",
      "deadline",
      "status",
      "url",
      "score",
      "reason",
    ];
  }
  if (sub === "real_estate") {
    return ["title", "location", "price", "summary", "url", "score", "reason"];
  }
  return ["title", "summary", "source", "url", "score", "reason"];
}
