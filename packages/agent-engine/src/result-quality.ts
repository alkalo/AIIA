import type { AgentSpec, ExtractedItem } from "./types.js";
import { isJobTarget, isGrantTarget, isOpportunityCardView } from "./opportunity-subtype.js";
import { isExpiredDeadline } from "./deadline.js";

const JOB_POSTING_URL_PATTERNS = [
  /\/jobs?\//i,
  /\/job\//i,
  /\/empleo/i,
  /\/empleos/i,
  /\/vacante/i,
  /\/careers?\//i,
  /\/hiring/i,
  /\/oferta/i,
  /viewjob/i,
  /jobview/i,
  /job-details/i,
  /jobfluent\.com/i,
  /tecnoempleo\.com/i,
  /infojobs\.net\/job\//i,
  /indeed\.com\/viewjob/i,
  /indeed\.com\/rc\/clk/i,
  /glassdoor\.[a-z.]+\/job-listing\//i,
  /linkedin\.com\/jobs\/view\//i,
];

const LOW_QUALITY_JOB_URL_PATTERNS = [
  /glassdoor\.[a-z.]+\/Reviews\//i,
  /glassdoor\.[a-z.]+\/Overview\//i,
  /glassdoor\.[a-z.]+\/Salary\//i,
  /indeed\.com\/cmp\//i,
  /indeed\.com\/q-/i,
  /linkedin\.com\/company\//i,
  /linkedin\.com\/in\//i,
  /linkedin\.com\/advice\//i,
  /business\.linkedin\.com/i,
  /\/reviews?\//i,
  /\/search\?/i,
];

/** Limpia texto extraído: recorta, elimina basura repetida de formularios web. */
export function sanitizeFieldValue(value: unknown, maxLen = 120): string {
  if (value == null) return "";
  let s = String(value).replace(/\s+/g, " ").trim();
  if (!s) return "";

  if (/^(select location,?[\s,]*)+$/i.test(s)) return "";
  if (/select location/i.test(s)) {
    const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
    const meaningful = parts.filter((p) => !/^select location$/i.test(p));
    s = meaningful[0] ?? "";
  }

  const commaParts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (commaParts.length > 6 && commaParts.every((p) => p.length < 50)) {
    s = commaParts[0];
  }

  if (s.length > maxLen) s = `${s.slice(0, maxLen - 1)}…`;
  return s;
}

export function isDirectJobPostingUrl(url: string): boolean {
  return JOB_POSTING_URL_PATTERNS.some((p) => p.test(url));
}

export function isLowQualityJobUrl(url: string): boolean {
  if (!url) return true;
  return LOW_QUALITY_JOB_URL_PATTERNS.some((p) => p.test(url));
}

/** URL preferida para oportunidades (grants, tenders, jobs). */
export function resolveOpportunityUrl(data: Record<string, unknown>): string {
  const candidates = [
    data.application_url,
    data.applicationUrl,
    data.call_url,
    data.callUrl,
    data.application_link,
    data.applicationLink,
    data.job_url,
    data.jobUrl,
    data.url,
    data.link,
    data.source,
  ];
  return candidates
    .map((c) => (c ? String(c).trim() : ""))
    .find((s) => /^https?:\/\//i.test(s)) ?? "";
}

/** URL preferida para ofertas de empleo. */
export function resolvePostingUrl(data: Record<string, unknown>): string {
  const candidates = [
    data.application_link,
    data.applicationLink,
    data.job_url,
    data.jobUrl,
    data.url,
    data.link,
    data.source,
  ];
  const valid = candidates
    .map((c) => (c ? String(c).trim() : ""))
    .filter((s) => /^https?:\/\//i.test(s));

  const direct = valid.find((u) => isDirectJobPostingUrl(u));
  if (direct) return direct;

  const notLow = valid.find((u) => !isLowQualityJobUrl(u));
  if (notLow) return notLow;

  return valid[0] ?? resolveOpportunityUrl(data);
}

export function isGarbageExtraction(item: ExtractedItem): boolean {
  const title = String(item.job_title ?? item.title ?? "");
  const location = String(item.location ?? "");
  const description = String(item.description ?? item.job_description ?? "");

  if (title.split(",").length > 8) return true;
  if (location.split(",").filter((p) => /select location/i.test(p)).length > 2) return true;
  if (/^(select location,?[\s,]*)+$/i.test(location.trim())) return true;
  if (description.length > 500 && (description.match(/select location/gi)?.length ?? 0) > 3) {
    return true;
  }

  const url = String(item.url ?? item.application_link ?? "");
  if (url && isLowQualityJobUrl(url) && !isDirectJobPostingUrl(url)) {
    if (/Reviews|Overview|Salary|Pros And Cons/i.test(`${title} ${url}`)) return true;
  }

  return false;
}

export function normalizeExtractedItem(item: ExtractedItem): ExtractedItem {
  const out: ExtractedItem = { ...item };
  for (const key of Object.keys(out)) {
    const v = out[key];
    if (typeof v === "string") {
      out[key] = sanitizeFieldValue(v, key.includes("description") ? 400 : 120);
    }
  }

  const postingUrl = resolvePostingUrl(out as Record<string, unknown>);
  if (postingUrl) {
    out.application_link = postingUrl;
    const currentUrl = out.url ? String(out.url) : "";
    if (!currentUrl || isLowQualityJobUrl(currentUrl)) {
      out.url = postingUrl;
    }
  }

  return out;
}

// Páginas que con certeza NO son una oferta (reseñas, salarios, búsquedas).
const DEFINITELY_NOT_JOB = [
  /glassdoor\.[a-z.]+\/Reviews\//i,
  /glassdoor\.[a-z.]+\/Salary\//i,
  /glassdoor\.[a-z.]+\/Overview\//i,
  /indeed\.com\/cmp\//i,
  /\/reviews?\//i,
  /wikipedia\.org/i,
  /youtube\.com/i,
];

function isDefinitelyNonJobUrl(url: string): boolean {
  return DEFINITELY_NOT_JOB.some((p) => p.test(url));
}

export function validateOpportunityResult(item: ExtractedItem, spec: AgentSpec): boolean {
  if (isGarbageExtraction(item)) return false;

  if (isGrantTarget(spec)) {
    const normalized = normalizeExtractedItem(item);
    const org = sanitizeFieldValue(
      normalized.organization ?? normalized.organisation ?? normalized.funder
    );
    const program = sanitizeFieldValue(
      normalized.program_name ?? normalized.programName ?? normalized.title ?? normalized.name
    );
    const url = resolveOpportunityUrl(normalized as Record<string, unknown>);
    if (!program && !org) return false;
    if (!url && !program) return false;
    if (isExpiredDeadline(normalized.deadline ?? normalized.closing_date)) return false;
    return true;
  }

  return validateJobResult(item, spec);
}

/** @deprecated use validateOpportunityResult */
export function validateJobResult(item: ExtractedItem, spec: AgentSpec): boolean {
  if (isGarbageExtraction(item)) return false;
  if (!isJobTarget(spec)) return true;

  const normalized = normalizeExtractedItem(item);
  const url = resolvePostingUrl(normalized as Record<string, unknown>);
  if (!url) return false;

  // Solo descartamos páginas que claramente no son ofertas (reseñas, salarios,
  // wikis…). Las páginas de empresa/portal se conservan y se ordenan por score.
  if (isDefinitelyNonJobUrl(url)) return false;

  const title = sanitizeFieldValue(normalized.job_title ?? normalized.title);
  if (!title || title.length < 3) return false;

  return true;
}

export function getOpportunityDisplayMode(spec: AgentSpec): "card" | "table" {
  return isOpportunityCardView(spec) ? "card" : "table";
}

export function formatOpportunityHeadline(data: Record<string, unknown>): string {
  const org = sanitizeFieldValue(data.organization ?? data.organisation ?? data.funder, 80);
  const program = sanitizeFieldValue(
    data.program_name ?? data.programName ?? data.title ?? data.name,
    80
  );
  if (org && program && !program.toLowerCase().includes(org.toLowerCase())) return org;
  return org || program || formatResultTitle(data);
}

export function formatOpportunityProgram(data: Record<string, unknown>): string {
  return sanitizeFieldValue(
    data.program_name ?? data.programName ?? data.title ?? data.name,
    120
  );
}

export function formatOpportunityScope(data: Record<string, unknown>): string {
  return sanitizeFieldValue(data.scope ?? data.region ?? data.geography, 40);
}

export function formatOpportunityFunding(data: Record<string, unknown>): string {
  const amount = sanitizeFieldValue(data.max_funding ?? data.maxFunding ?? data.amount, 40);
  const currency = sanitizeFieldValue(data.currency, 8);
  if (amount && currency) return `${amount} ${currency}`;
  return amount;
}

export function formatOpportunityDeadline(data: Record<string, unknown>): string {
  return sanitizeFieldValue(data.deadline ?? data.closing_date ?? data.closes, 40);
}

export function formatOpportunityMeta(data: Record<string, unknown>): string {
  const parts = [
    formatOpportunityScope(data),
    formatOpportunityFunding(data),
    formatOpportunityDeadline(data),
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Etiqueta legible para mostrar en UI. */
export function formatResultTitle(data: Record<string, unknown>): string {
  const jobTitle = sanitizeFieldValue(data.job_title ?? data.jobTitle, 80);
  const title = sanitizeFieldValue(data.title ?? data.name, 80);
  const company = sanitizeFieldValue(data.company_name ?? data.companyName, 60);
  if (jobTitle && company) return `${jobTitle} @ ${company}`;
  if (jobTitle) return jobTitle;
  if (title && company && !title.toLowerCase().includes(company.toLowerCase())) {
    return `${title} @ ${company}`;
  }
  if (title) return title;
  if (company) return company;
  return "—";
}

export function formatResultLocation(data: Record<string, unknown>): string {
  return sanitizeFieldValue(data.location ?? data.city ?? data.place, 60);
}

export function postingLinkLabel(url: string, lang: "es" | "en" = "es"): string {
  if (isDirectJobPostingUrl(url)) return lang === "es" ? "Ver anuncio" : "View posting";
  if (isLowQualityJobUrl(url)) return lang === "es" ? "Abrir página" : "Open page";
  return lang === "es" ? "Ver enlace" : "Open link";
}

export function postingHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
