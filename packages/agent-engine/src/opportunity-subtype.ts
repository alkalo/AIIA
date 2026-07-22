import type { AgentSpec, OpportunitySubtype } from "./types.js";

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

function specBlob(spec: AgentSpec): string {
  return `${spec.prompt} ${spec.filters?.criteria ?? ""} ${spec.search?.queries?.join(" ") ?? ""} ${spec.name ?? ""}`.toLowerCase();
}

function matchesAny(blob: string, keywords: string[]): boolean {
  return keywords.some((k) => blob.includes(k));
}

function inferSubtype(spec: AgentSpec): OpportunitySubtype {
  const tpl = (spec.templateId ?? "").toLowerCase();
  if (tpl.includes("job")) return "jobs";

  const blob = specBlob(spec);
  if (matchesAny(blob, GRANT_KEYWORDS)) return "grants";
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

export function isJobTarget(spec: AgentSpec): boolean {
  const tpl = (spec.templateId ?? "").toLowerCase();
  if (tpl.includes("job")) return true;
  return resolveOpportunitySubtype(spec) === "jobs";
}

export function isGrantTarget(spec: AgentSpec): boolean {
  return resolveOpportunitySubtype(spec) === "grants";
}

export function isRealEstateTarget(spec: AgentSpec): boolean {
  return resolveOpportunitySubtype(spec) === "real_estate";
}

export function isTenderTarget(spec: AgentSpec): boolean {
  return resolveOpportunitySubtype(spec) === "tenders";
}

export function isOpportunityCardView(spec: AgentSpec): boolean {
  const sub = resolveOpportunitySubtype(spec);
  return sub === "grants" || sub === "tenders" || sub === "events";
}

export function defaultDedupeFields(spec: AgentSpec): string[] {
  const sub = resolveOpportunitySubtype(spec);
  if (sub === "grants" || sub === "tenders") {
    return ["organization", "program_name"];
  }
  if (sub === "events" || sub === "real_estate") {
    return ["title", "url"];
  }
  return ["title", "url"];
}

export function defaultOutputSchema(spec: AgentSpec): string[] {
  const sub = resolveOpportunitySubtype(spec);
  if (sub === "grants" || sub === "tenders") {
    return [
      "scope",
      "organization",
      "program_name",
      "description",
      "max_funding",
      "currency",
      "deadline",
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
