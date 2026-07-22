import type { AgentSpec, ExtractedItem } from "./types.js";
import type { EffortConfig, EffortLevel } from "@aiia/ollama-client";
import { isGrantTarget, isJobTarget } from "./opportunity-subtype.js";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** minScore efectivo según esfuerzo — evita 0 resultados en modo bajo */
export function effectiveMinScore(effort: EffortLevel, specMinScore: number): number {
  // Techo de umbral por modo: mantenerlo moderado para no descartar resultados
  // relevantes (el usuario prefiere más cobertura y ordenar por score).
  const caps: Record<EffortLevel, number> = {
    low: 40,
    medium: 50,
    high: 52,
    super_high: 55,
    ultra_high: 48,
  };
  return Math.min(specMinScore, caps[effort] ?? specMinScore);
}

const QUALITY_DOMAIN_PATTERNS = [
  /linkedin\.com/i,
  /indeed\.com/i,
  /glassdoor\.com/i,
  /infojobs\.net/i,
  /computrabajo\.com/i,
  /stackoverflow\.com/i,
  /github\.com/i,
  /wikipedia\.org/i,
  /\.gov\b/i,
  /\.edu\b/i,
];

const LOW_QUALITY_PATTERNS = [
  /pinterest\.com/i,
  /facebook\.com\/login/i,
  /twitter\.com\/intent/i,
  /duckduckgo\.com/i,
  /glassdoor\.[a-z.]+\/Reviews\//i,
  /glassdoor\.[a-z.]+\/Overview\//i,
  /glassdoor\.[a-z.]+\/Salary\//i,
  /indeed\.com\/cmp\//i,
];

export function domainQualityScore(url: string): number {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (LOW_QUALITY_PATTERNS.some((p) => p.test(url))) return -15;
    if (QUALITY_DOMAIN_PATTERNS.some((p) => p.test(host) || p.test(url))) return 20;
    if (host.endsWith(".gov") || host.endsWith(".edu")) return 15;
    return 0;
  } catch {
    return -5;
  }
}

// URLs que son fichas de empresa/perfil genéricas (no una oferta concreta).
const COMPANY_PROFILE_PATTERNS = [
  /linkedin\.com\/company\//i,
  /linkedin\.com\/in\//i,
  /linkedin\.com\/advice\//i,
  /business\.linkedin\.com/i,
  /linkedin\.com\/school\//i,
  /glassdoor\.[a-z.]+\/Overview\//i,
];

// URLs que apuntan a ofertas reales de empleo.
const JOB_POSTING_PATTERNS = [
  /\/jobs?\//i,
  /\/job\//i,
  /\/empleo/i,
  /\/empleos/i,
  /\/vacante/i,
  /\/careers?\//i,
  /\/hiring/i,
  /\/oferta/i,
  /viewjob/i,
  /jobfluent\.com/i,
  /tecnoempleo\.com/i,
];

const GRANT_DOMAIN_PATTERNS = [
  /fundsforngos/i,
  /grantwatch/i,
  /devex\.com/i,
  /funding-tenders/i,
  /ec\.europa\.eu/i,
  /cordis\.europa/i,
  /sede\.administracion/i,
  /boe\.es/i,
  /business\.gov\.au/i,
  /philanthropy\.org\.au/i,
  /communitygrant/i,
  /subvenc/i,
  /convocatoria/i,
  /grant/i,
  /foundation/i,
  /fundaci[oó]n/i,
];

const JOB_BOARD_PATTERNS = [
  /linkedin\.com\/jobs/i,
  /indeed\.com/i,
  /glassdoor\.com/i,
  /infojobs\.net/i,
  /computrabajo\.com/i,
  /tecnoempleo\.com/i,
];

const JOB_KEYWORDS = [
  "empleo", "vacante", "oferta", "puesto", "contrat", "hiring", "job", "vacancy",
  "position", "career", "trabajo", "salario", "salary", "apply", "aplicar",
];

/** ¿El objetivo del agente son ofertas de empleo? */
export { isJobTarget } from "./opportunity-subtype.js";

/**
 * Ajuste de puntuación para objetivos de empleo: penaliza fichas de
 * empresa/perfil genéricas cuyo contenido no menciona el puesto, y prioriza
 * páginas de oferta real.
 */
export function jobTargetAdjustment(url: string, contentBlob: string, spec: AgentSpec): number {
  if (!isJobTarget(spec)) return 0;
  let adj = 0;
  const hay = contentBlob.toLowerCase();
  const mentionsJob = JOB_KEYWORDS.some((k) => hay.includes(k));

  if (COMPANY_PROFILE_PATTERNS.some((p) => p.test(url))) {
    adj -= mentionsJob ? 15 : 35;
  }
  if (JOB_POSTING_PATTERNS.some((p) => p.test(url))) {
    adj += 20;
  }
  return adj;
}

/** Ajuste de puntuación para convocatorias y subvenciones. */
export function grantTargetAdjustment(url: string, contentBlob: string, spec: AgentSpec): number {
  if (!isGrantTarget(spec)) return 0;
  // Intentional portal deep-link seeds must stay visible when SERP is blocked.
  if (/portal seed/i.test(contentBlob)) return 15;
  let adj = 0;
  const hay = contentBlob.toLowerCase();
  try {
    const path = new URL(url).pathname.replace(/\/$/, "") || "/";
    if (path === "/" || path === "") adj -= 35;
    else if (/^\/grants?$/i.test(path) || /^\/funding$/i.test(path)) adj -= 20;
    else if (/\/(grant|funding|opportunity|program|apply|call)\b/i.test(path)) adj += 30;
  } catch {
    /* ignore */
  }
  if (GRANT_DOMAIN_PATTERNS.some((p) => p.test(url) || p.test(hay))) {
    // Domain match alone is weak on portal roots; deep paths already got a bonus.
    adj += 10;
  }
  if (/\.gov(\.|\/|$)/i.test(url) || /\.gob\.es/i.test(url)) adj += 15;
  if (JOB_BOARD_PATTERNS.some((p) => p.test(url))) adj -= 30;
  if (/\b(deadline|closing|convocatoria|grant|funding|subvenci|open round)\b/i.test(hay)) adj += 12;
  return adj;
}

export function opportunityTargetAdjustment(
  url: string,
  contentBlob: string,
  spec: AgentSpec
): number {
  return jobTargetAdjustment(url, contentBlob, spec) + grantTargetAdjustment(url, contentBlob, spec);
}

const STOP_WORDS = new Set([
  "de", "la", "el", "en", "un", "una", "del", "los", "las", "por", "con",
  "the", "and", "for", "que", "para",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

export function keywordOverlapScore(text: string, spec: AgentSpec): number {
  const corpus = tokenize(
    `${spec.prompt} ${spec.filters.criteria} ${spec.search.queries.join(" ")}`
  );
  const unique = [...new Set(corpus)].slice(0, 40);
  if (unique.length === 0) return 0;
  const hay = text.toLowerCase();
  let hits = 0;
  for (const word of unique) {
    if (hay.includes(word)) hits++;
  }
  return Math.min(30, Math.round((hits / unique.length) * 45));
}

export function rankSearchResults(
  results: SearchHit[],
  spec: AgentSpec,
  limit: number
): SearchHit[] {
  const scored = results.map((r) => {
    const blob = `${r.title} ${r.snippet} ${r.url}`;
    let score = 50 + domainQualityScore(r.url) + keywordOverlapScore(blob, spec);
    score += opportunityTargetAdjustment(r.url, blob, spec);
    if (r.title.length > 10) score += 5;
    if (r.snippet.length > 40) score += 5;
    if (/portal seed/i.test(r.snippet ?? "")) score += 40;
    return { result: r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const pinned = scored.filter((s) => /portal seed/i.test(s.result.snippet ?? ""));
  const rest = scored.filter((s) => !/portal seed/i.test(s.result.snippet ?? ""));
  const room = Math.max(0, limit - pinned.length);
  return [...pinned.map((s) => s.result), ...rest.slice(0, room).map((s) => s.result)];
}

export function heuristicItemScore(
  item: ExtractedItem,
  source: SearchHit,
  spec: AgentSpec
): number {
  const blob = `${item.title ?? ""} ${item.description ?? ""} ${source.title} ${source.snippet} ${source.url}`;
  let score = 55 + keywordOverlapScore(blob, spec) + domainQualityScore(source.url);
  score += opportunityTargetAdjustment(String(item.url ?? source.url), blob, spec);
  if (item.url) score += 5;
  if (item.title && String(item.title).length > 3) score += 5;
  return Math.min(92, Math.max(25, score));
}

/** Consultas más amplias si la búsqueda inicial no devuelve nada */
export function broadenQueries(queries: string[], prompt: string, spec?: AgentSpec): string[] {
  const out = new Set<string>();
  for (const q of queries) {
    out.add(q.trim());
    const words = tokenize(q);
    if (words.length > 4) {
      out.add(words.slice(0, 4).join(" "));
    }
  }
  const promptWords = tokenize(prompt).join(" ");
  if (promptWords) {
    out.add(promptWords);
    if (spec && isGrantTarget(spec)) {
      out.add(`${promptWords} grant application deadline`);
      out.add(`${promptWords} convocatoria abierta`);
      out.add(`site:fundsforngos.org ${promptWords}`);
      out.add(`site:ec.europa.eu ${promptWords} funding`);
    } else if (!spec || isJobTarget(spec)) {
      out.add(`${promptWords} empleo OR jobs`);
      const short = tokenize(prompt).slice(0, 6).join(" ");
      if (short) {
        out.add(`site:linkedin.com/jobs ${short}`);
        out.add(`site:indeed.com ${short}`);
        out.add(`site:infojobs.net ${short}`);
      }
    }
  }
  return [...out].filter(Boolean).slice(0, 8);
}

export function pagesToFetchCount(cfg: EffortConfig, total: number): number {
  const ratio = cfg.steps <= 1 ? 0.6 : cfg.steps <= 2 ? 0.75 : 0.9;
  return Math.min(total, Math.max(3, Math.ceil(total * ratio)));
}
