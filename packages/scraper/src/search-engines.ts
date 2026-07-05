import type { Browser } from "playwright";
import { chromium } from "playwright";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: SearchEngineId;
}

export type SearchEngineId =
  | "mojeek"
  | "duckduckgo-html"
  | "duckduckgo-lite"
  | "bing"
  | "brave"
  | "ecosia";

export interface SearchWebOptions {
  engines?: SearchEngineId[];
  debugDir?: string;
  locale?: string;
}

export interface SearchWebResponse {
  results: WebSearchResult[];
  errors: { engine: SearchEngineId; message: string }[];
  counts: Partial<Record<SearchEngineId, number>>;
}

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const ALL_ENGINES: SearchEngineId[] = [
  "mojeek",
  "duckduckgo-html",
  "duckduckgo-lite",
  "bing",
  "brave",
  "ecosia",
];

// ---------------------------------------------------------------------------
// Browser (solo se usa para leer páginas, no para buscar).
// ---------------------------------------------------------------------------

let browser: Browser | null = null;

export async function getBrowser(headless = true): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(href: string): string {
  let url = href;
  const uddg = href.match(/uddg=([^&]+)/);
  if (uddg) {
    try {
      url = decodeURIComponent(uddg[1]);
    } catch {
      /* keep */
    }
  }
  const braveWrap = href.match(/[?&]u=([^&]+)/);
  if (!uddg && /bing\.com\/ck\//i.test(href) && braveWrap) {
    try {
      url = decodeURIComponent(braveWrap[1]);
    } catch {
      /* keep */
    }
  }
  if (url.startsWith("//")) url = `https:${url}`;
  return url;
}

function isValidResultUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  // Descartar enlaces internos del propio buscador y utilidades.
  return !/(duckduckgo\.com\/(?!l\/)|mojeek\.com\/search|bing\.com\/search|search\.brave\.com\/search|ecosia\.org\/search|microsoft\.com\/|go\.microsoft\.com)/i.test(
    url
  );
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Serializa peticiones por host para no disparar rate limits. */
const hostChains = new Map<string, { chain: Promise<unknown>; last: number }>();

function throttleHost<T>(host: string, minIntervalMs: number, task: () => Promise<T>): Promise<T> {
  const entry = hostChains.get(host) ?? { chain: Promise.resolve(), last: 0 };
  const run = entry.chain.then(async () => {
    const wait = minIntervalMs - (Date.now() - entry.last);
    if (wait > 0) await sleep(wait);
    try {
      return await task();
    } finally {
      entry.last = Date.now();
    }
  });
  entry.chain = run.catch(() => {});
  hostChains.set(host, entry);
  return run;
}

type EngineOutcome = { results: WebSearchResult[]; error?: string; retryable?: boolean };

// ---------------------------------------------------------------------------
// Parsers (regex, ejecutados en Node sobre el HTML descargado)
// ---------------------------------------------------------------------------

function parseMojeek(html: string, max: number): WebSearchResult[] {
  const items: WebSearchResult[] = [];
  const blockRe = /<a class="title"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?:<p class="s">([\s\S]*?)<\/p>)?/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null && items.length < max) {
    const url = normalizeUrl(m[1]);
    const title = stripHtml(m[2]);
    const snippet = m[4] ? stripHtml(m[4]) : "";
    if (title && isValidResultUrl(url)) items.push({ title, url, snippet, engine: "mojeek" });
  }
  return items;
}

function parseDuckDuckGo(
  html: string,
  max: number,
  engine: "duckduckgo-html" | "duckduckgo-lite"
): WebSearchResult[] {
  const items: WebSearchResult[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a[^>]*class="[^"]*result(?:__a|-link)[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const altRe = /<a[^>]*href="([^"]+)"[^>]*class="[^"]*result(?:__a|-link)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  for (const re of [anchorRe, altRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && items.length < max) {
      const url = normalizeUrl(m[1]);
      const title = stripHtml(m[2]);
      if (!title || !isValidResultUrl(url) || seen.has(url)) continue;
      seen.add(url);
      items.push({ title, url, snippet: "", engine });
    }
    if (items.length > 0) break;
  }
  // Snippets (best-effort, en el mismo orden).
  const snippets: string[] = [];
  const snipRe = /class="[^"]*result(?:__snippet|-snippet)[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/g;
  let s: RegExpExecArray | null;
  while ((s = snipRe.exec(html)) !== null) snippets.push(stripHtml(s[1]));
  items.forEach((it, i) => {
    if (snippets[i]) it.snippet = snippets[i].slice(0, 500);
  });
  return items;
}

function parseBing(html: string, max: number): WebSearchResult[] {
  const items: WebSearchResult[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<li class="b_algo"/).slice(1);
  for (const block of blocks) {
    if (items.length >= max) break;
    const titleMatch = block.match(/<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const url = normalizeUrl(titleMatch[1]);
    const title = stripHtml(titleMatch[2]);
    if (!title || !isValidResultUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const snipMatch =
      block.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/) ??
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    items.push({ title, url, snippet: snipMatch ? stripHtml(snipMatch[1]) : "", engine: "bing" });
  }
  return items;
}

function parseBrave(html: string, max: number): WebSearchResult[] {
  const items: WebSearchResult[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*(?:h|result-header|svelte)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && items.length < max) {
    const url = normalizeUrl(m[1]);
    const title = stripHtml(m[2]);
    if (!title || title.length < 3 || !isValidResultUrl(url) || seen.has(url)) continue;
    seen.add(url);
    items.push({ title, url, snippet: "", engine: "brave" });
  }
  return items;
}

function parseEcosia(html: string, max: number): WebSearchResult[] {
  const items: WebSearchResult[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]*(?:data-test-id="result-link"|class="[^"]*result__link[^"]*")[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && items.length < max) {
    const url = normalizeUrl(m[1]);
    const title = stripHtml(m[2]);
    if (!title || !isValidResultUrl(url) || seen.has(url)) continue;
    seen.add(url);
    items.push({ title, url, snippet: "", engine: "ecosia" });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Motores (fetch)
// ---------------------------------------------------------------------------

interface EngineDef {
  host: string;
  minIntervalMs: number;
  run: (query: string, max: number) => Promise<EngineOutcome>;
}

async function genericFetchEngine(
  engine: SearchEngineId,
  url: string,
  parse: (html: string, max: number) => WebSearchResult[],
  max: number,
  init?: RequestInit
): Promise<EngineOutcome> {
  try {
    const res = await fetchWithTimeout(url, 12000, init);
    if (res.status === 403 || res.status === 429) {
      return { results: [], error: `${engine} rate limit (${res.status})`, retryable: true };
    }
    if (!res.ok) {
      return { results: [], error: `${engine} HTTP ${res.status}`, retryable: res.status >= 500 };
    }
    const html = await res.text();
    if (/captcha|cf-turnstile|challenge-platform|unusual traffic/i.test(html) && html.length < 4000) {
      return { results: [], error: `${engine}: captcha/bot check`, retryable: false };
    }
    const results = parse(html, max);
    if (results.length === 0) {
      return { results: [], error: `${engine}: no parseable results`, retryable: false };
    }
    return { results };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { results: [], error: `${engine}: ${msg}`, retryable: true };
  }
}

const ENGINES: Record<SearchEngineId, EngineDef> = {
  mojeek: {
    host: "mojeek.com",
    minIntervalMs: 1200,
    run: (q, max) =>
      genericFetchEngine(
        "mojeek",
        `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`,
        parseMojeek,
        max
      ),
  },
  "duckduckgo-html": {
    host: "duckduckgo.com",
    minIntervalMs: 900,
    run: (q, max) =>
      genericFetchEngine(
        "duckduckgo-html",
        "https://html.duckduckgo.com/html/",
        (html, m) => parseDuckDuckGo(html, m, "duckduckgo-html"),
        max,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `q=${encodeURIComponent(q)}&kl=es-es`,
        }
      ),
  },
  "duckduckgo-lite": {
    host: "duckduckgo.com",
    minIntervalMs: 900,
    run: (q, max) =>
      genericFetchEngine(
        "duckduckgo-lite",
        "https://lite.duckduckgo.com/lite/",
        (html, m) => parseDuckDuckGo(html, m, "duckduckgo-lite"),
        max,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `q=${encodeURIComponent(q)}&kl=es-es`,
        }
      ),
  },
  bing: {
    host: "bing.com",
    minIntervalMs: 700,
    run: (q, max) =>
      genericFetchEngine(
        "bing",
        `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=es&count=${Math.min(30, max + 5)}`,
        parseBing,
        max
      ),
  },
  brave: {
    host: "search.brave.com",
    minIntervalMs: 1200,
    run: (q, max) =>
      genericFetchEngine(
        "brave",
        `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`,
        parseBrave,
        max
      ),
  },
  ecosia: {
    host: "ecosia.org",
    minIntervalMs: 1000,
    run: (q, max) =>
      genericFetchEngine(
        "ecosia",
        `https://www.ecosia.org/search?method=index&q=${encodeURIComponent(q)}`,
        parseEcosia,
        max
      ),
  },
};

async function runEngine(engineId: SearchEngineId, query: string, max: number): Promise<EngineOutcome> {
  const def = ENGINES[engineId];
  if (!def) return { results: [], error: `Unknown engine ${engineId}` };
  return throttleHost(def.host, def.minIntervalMs, async () => {
    let last: EngineOutcome = { results: [], error: `${engineId} not attempted` };
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(700 * attempt);
      last = await def.run(query, max);
      if (last.results.length > 0 || !last.retryable) break;
    }
    return last;
  });
}

// ---------------------------------------------------------------------------
// Dedupe y API pública
// ---------------------------------------------------------------------------

function dedupeResults(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    let key: string;
    try {
      const u = new URL(r.url);
      u.hash = "";
      key = u.toString().replace(/\/$/, "");
    } catch {
      key = r.url.toLowerCase();
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function enginesForEffort(
  effort: "low" | "medium" | "high" | "super_high" | "ultra_high"
): SearchEngineId[] {
  switch (effort) {
    case "low":
      return ["mojeek", "duckduckgo-lite", "bing"];
    case "medium":
      return ["mojeek", "duckduckgo-html", "duckduckgo-lite", "bing"];
    default:
      return ["mojeek", "duckduckgo-html", "duckduckgo-lite", "bing", "brave", "ecosia"];
  }
}

export async function searchWeb(
  query: string,
  maxResults = 10,
  options: SearchWebOptions = {}
): Promise<SearchWebResponse> {
  const engines = (options.engines ?? ALL_ENGINES).filter((e) => ENGINES[e]);
  const errors: SearchWebResponse["errors"] = [];
  const counts: Partial<Record<SearchEngineId, number>> = {};

  // Todos los motores por fetch en paralelo (sin navegador → sin timeouts largos).
  const outcomes = await Promise.all(
    engines.map(async (engineId) => {
      const outcome = await runEngine(engineId, query, maxResults);
      counts[engineId] = outcome.results.length;
      if (outcome.error && outcome.results.length === 0) {
        errors.push({ engine: engineId, message: outcome.error });
      }
      return outcome.results;
    })
  );

  const merged = outcomes.flat();
  return {
    results: dedupeResults(merged).slice(0, maxResults),
    errors,
    counts,
  };
}

/** @deprecated Use searchWeb */
export async function searchDuckDuckGo(
  query: string,
  maxResults = 10
): Promise<{ title: string; url: string; snippet: string }[]> {
  const { results } = await searchWeb(query, maxResults, {
    engines: ["mojeek", "duckduckgo-html", "duckduckgo-lite"],
  });
  return results.map(({ title, url, snippet }) => ({ title, url, snippet }));
}
