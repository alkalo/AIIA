import type { EffortLevel, LlmClient } from "@aiia/ollama-client";
import type { AgentSpec, TemplateId } from "./types.js";
import { isGrantTarget, isJobTarget, resolveOpportunitySubtype } from "./opportunity-subtype.js";
import { resolveTemplateId } from "./templates.js";
import { coerceJsonArray } from "./json-utils.js";

const GENERIC_QUERY_PATTERNS = [
  /^empleo$/i,
  /^jobs?$/i,
  /^jobs?\s+remote$/i,
  /^search$/i,
  /^candidato$/i,
  /^remote$/i,
  /^buscar$/i,
];

const STOP_WORDS = new Set([
  "de", "la", "el", "en", "un", "una", "del", "los", "las", "por", "con",
  "the", "and", "for", "que", "para",
]);

const ACTION_WORDS = new Set([
  "buscar", "search", "find", "ofertas", "empleo", "jobs", "trabajo", "oportunidades",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function keywordCore(spec: AgentSpec): string {
  const tokens = tokenize(`${spec.prompt} ${spec.filters.criteria}`);
  const keywords = tokens.filter((t) => !ACTION_WORDS.has(t));
  return (keywords.length > 0 ? keywords : tokens).slice(0, 8).join(" ");
}

function overlapRatio(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const hits = a.filter((t) => setB.has(t)).length;
  return hits / a.length;
}

export function queriesAreStale(spec: AgentSpec): boolean {
  const promptTokens = tokenize(`${spec.prompt} ${spec.filters.criteria}`);
  if (promptTokens.length === 0) return false;

  const queries = spec.search.queries.filter(Boolean);
  if (queries.length === 0) return true;

  const allGeneric = queries.every((q) =>
    GENERIC_QUERY_PATTERNS.some((p) => p.test(q.trim()))
  );
  if (allGeneric) return true;

  const queryTokens = tokenize(queries.join(" "));
  return overlapRatio(promptTokens, queryTokens) < 0.3;
}

function isSpanish(text: string): boolean {
  if (/australia|australian|au\b|nz\b|new zealand|global|international/i.test(text)) {
    return false;
  }
  return /(?:ción|empleo|ofertas|buscar|remoto|españa|subvenc)/i.test(text);
}

/** Consultas concretas sin IA a partir del prompt */
export function buildQueriesFromPrompt(spec: AgentSpec): string[] {
  const prompt = `${spec.prompt} ${spec.filters.criteria}`.trim();
  const core = keywordCore(spec);
  const es = isSpanish(prompt);
  const canonical = resolveTemplateId((spec.templateId ?? "custom") as TemplateId);
  const out = new Set<string>();

  if (core) out.add(core);
  if (core) out.add(es ? `${core} ofertas` : `${core} opportunities`);

  const subtype = resolveOpportunitySubtype(spec);

  if (subtype === "grants") {
    out.add(es ? `${core} convocatoria abierta` : `${core} grant application deadline`);
    out.add(`site:fundsforngos.org ${core}`);
    out.add(`site:ec.europa.eu ${core} funding`);
    if (/australia|au\b|nz\b/i.test(prompt)) {
      out.add(`site:business.gov.au ${core} grant`);
      out.add(`site:philanthropy.org.au ${core}`);
    }
  } else if (subtype === "jobs" || spec.templateId === "job-search") {
    out.add(es ? `${core} empleo remoto` : `${core} remote jobs`);
    out.add(`site:linkedin.com/jobs ${core}`);
    out.add(`site:indeed.com ${core}`);
    out.add(es ? `site:infojobs.net ${core}` : `site:glassdoor.com ${core}`);
    if (es) out.add(`site:computrabajo.com ${core}`);
  } else if (canonical === "people-orgs") {
    out.add(`site:linkedin.com ${core}`);
    out.add(`${core} company contact`);
  } else {
    out.add(es ? `${core} noticias` : `${core} news`);
    out.add(`${core} ${es ? "información" : "overview"}`);
  }

  return [...out].filter((q) => q.trim().length > 3).slice(0, 8);
}

export async function replanSearchQueries(
  spec: AgentSpec,
  effort: EffortLevel,
  ollama: LlmClient,
  plannerModel: string,
  cfgQueryExpansion: number
): Promise<string[]> {
  const built = buildQueriesFromPrompt(spec);
  if (!queriesAreStale(spec) && !built.length) {
    return [...spec.search.queries];
  }

  if (cfgQueryExpansion > 0) {
    try {
      const response = await ollama.chat(
        [
          {
            role: "system",
            content: `Generate ${Math.max(2, cfgQueryExpansion + 1)} specific web search queries for DuckDuckGo/Bing. Each query MUST include key terms from the user goal. Use site: operators for relevant portals. Prefer English queries for Australia/New Zealand/global grant portals even if the goal is written in Spanish. Return ONLY a JSON array of strings.`,
          },
          {
            role: "user",
            content: `Goal: ${spec.prompt}\nCriteria: ${spec.filters.criteria}\nTemplate: ${resolveTemplateId((spec.templateId ?? "custom") as TemplateId)}\nAvoid generic queries like "empleo" or "jobs remote" alone.`,
          },
        ],
        { model: plannerModel, temperature: 0.35, format: "json", numCtx: 4096, timeoutMs: 90_000 }
      );
      const parsed = coerceJsonArray<unknown>(response);
      const ai = parsed.filter((q): q is string => typeof q === "string" && q.trim().length > 3);
      if (ai.length > 0) {
        return [...new Set([...built, ...ai])].slice(0, spec.search.queries.length + cfgQueryExpansion + 4);
      }
    } catch {
      /* fallback to built */
    }
  }

  if (queriesAreStale(spec)) return built;
  return [...new Set([...spec.search.queries, ...built])].slice(0, 8);
}

export function serpToExtractedItems(
  hits: { title: string; url: string; snippet: string }[],
  spec: AgentSpec
): import("./types.js").ExtractedItem[] {
  return hits.map((h) => ({
    title: h.title,
    url: h.url,
    description: h.snippet,
    summary: h.snippet,
    score: 50 + Math.min(25, tokenize(`${spec.prompt} ${spec.filters.criteria}`).filter((t) =>
      `${h.title} ${h.snippet}`.toLowerCase().includes(t)
    ).length * 5),
    reason: "SERP fallback",
  }));
}
