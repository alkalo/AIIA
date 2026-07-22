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
  /** True when attempted engines failed with rate-limit/captcha and yielded 0 hits. */
  serpBlocked?: boolean;
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

/** Cross-query engine health: skip rate-limited/captcha engines for a cooldown window. */
const ENGINE_FAIL_THRESHOLD = 2;
const ENGINE_COOLDOWN_MS = 90_000;
type EngineHealth = { fails: number; cooldownUntil: number; successes: number };
const engineHealth = new Map<SearchEngineId, EngineHealth>();

function healthOf(id: SearchEngineId): EngineHealth {
  let h = engineHealth.get(id);
  if (!h) {
    h = { fails: 0, cooldownUntil: 0, successes: 0 };
    engineHealth.set(id, h);
  }
  return h;
}

function isEngineCooling(id: SearchEngineId): boolean {
  return Date.now() < healthOf(id).cooldownUntil;
}

function noteEngineSuccess(id: SearchEngineId): void {
  const h = healthOf(id);
  h.fails = 0;
  h.cooldownUntil = 0;
  h.successes += 1;
}

function noteEngineFailure(id: SearchEngineId): void {
  const h = healthOf(id);
  h.fails += 1;
  if (h.fails >= ENGINE_FAIL_THRESHOLD) {
    h.cooldownUntil = Date.now() + ENGINE_COOLDOWN_MS;
    h.fails = 0;
  }
}

export function isHardBlockSearchError(message: string): boolean {
  if (/cooling down|skipped/i.test(message)) return false;
  return /rate limit|captcha|bot check|\b403\b|\b429\b/i.test(message);
}

/** Test helper / run reset. */
export function resetSearchEngineHealth(): void {
  engineHealth.clear();
}
// ---------------------------------------------------------------------------
// Browser (solo se usa para leer páginas, no para buscar).
// ---------------------------------------------------------------------------

let browser: Browser | null = null;

export async function getBrowser(headless = true): Promise<Browser> {
  if (browser && !browser.isConnected()) {
    browser = null;
  }
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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

function decodeTrackingParam(raw: string): string | null {
  if (raw.startsWith("a1")) {
    try {
      return Buffer.from(raw.slice(2), "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  return null;
}

function normalizeUrl(href: string): string {
  let url = decodeHtmlEntities(href);
  const uddg = url.match(/uddg=([^&]+)/);
  if (uddg) {
    try {
      url = decodeURIComponent(uddg[1]);
    } catch {
      /* keep */
    }
  }
  const tracking = url.match(/[?&]u=([^&]+)/);
  if (!uddg && tracking && /bing\.com\/ck\/|search\.brave\.com/i.test(url)) {
    try {
      const decoded = decodeURIComponent(tracking[1]);
      const resolved = decodeTrackingParam(decoded);
      if (resolved) url = resolved;
    } catch {
      /* keep */
    }
  }
  if (url.startsWith("//")) url = `https:${url}`;
  return url;
}

function isBlockedHtml(html: string): boolean {
  if (html.length > 12_000 && /b_algo|result__a|class="title"/i.test(html)) return false;
  return /captcha|cf-turnstile|challenge-platform|unusual traffic|anomaly-modal|bots use DuckDuckGo|<title>\s*Captcha\s*<\/title>/i.test(
    html
  );
}

function isValidResultUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/bing\.com\/ck\/|duckduckgo\.com\/l\//i.test(url)) return false;
  return !/(duckduckgo\.com\/(?!l\/)|mojeek\.com\/search|bing\.com\/search|search\.brave\.com\/search|ecosia\.org\/search|microsoft\.com\/|go\.microsoft\.com)/i.test(
    url
  );
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
  acceptLanguage = "en-US,en;q=0.9"
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
        "Accept-Language": acceptLanguage,
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
  const blocks = html.split(/<li[^>]*class="[^"]*b_algo[^"]*"/i).slice(1);
  for (const block of blocks) {
    if (items.length >= max) break;
    const titleMatch =
      block.match(/<h2>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ??
      block.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;
    const url = normalizeUrl(titleMatch[1]);
    const title = stripHtml(titleMatch[2]);
    if (!title || title.length < 3 || /https?:\/\//i.test(title)) continue;
    if (!isValidResultUrl(url) || seen.has(url)) continue;
    // Discard SEO spam / bot-bait pages that often appear when Bing blocks scrapers.
    if (/testquery|encyclopedia.?backstage|positioniseverything|solmusical/i.test(url + title)) {
      continue;
    }
    seen.add(url);
    const snipMatch =
      block.match(/<p class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ??
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
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
  run: (query: string, max: number, locale: string) => Promise<EngineOutcome>;
}

function acceptLanguageFor(locale: string): string {
  if (locale.toLowerCase().startsWith("es")) return "es-ES,es;q=0.9,en;q=0.8";
  if (locale.toLowerCase().startsWith("en-au")) return "en-AU,en;q=0.9";
  if (locale.toLowerCase().startsWith("en-nz")) return "en-NZ,en;q=0.9";
  return "en-US,en;q=0.9";
}

function ddgKlFor(locale: string): string {
  const l = locale.toLowerCase();
  if (l.startsWith("es")) return "es-es";
  if (l.startsWith("en-au")) return "au-en";
  if (l.startsWith("en-nz")) return "nz-en";
  if (l.startsWith("en-gb")) return "uk-en";
  return "us-en";
}

function bingLangParams(locale: string): { setlang: string; cc: string } {
  const l = locale.toLowerCase();
  if (l.startsWith("es")) return { setlang: "es", cc: "ES" };
  if (l.startsWith("en-au")) return { setlang: "en", cc: "AU" };
  if (l.startsWith("en-nz")) return { setlang: "en", cc: "NZ" };
  if (l.startsWith("en-gb")) return { setlang: "en", cc: "GB" };
  return { setlang: "en", cc: "US" };
}

async function genericFetchEngine(
  engine: SearchEngineId,
  url: string,
  parse: (html: string, max: number) => WebSearchResult[],
  max: number,
  init?: RequestInit,
  locale = "en-US"
): Promise<EngineOutcome> {
  try {
    const res = await fetchWithTimeout(url, 12000, init, acceptLanguageFor(locale));
    if (res.status === 403 || res.status === 429) {
      return { results: [], error: `${engine} rate limit (${res.status})`, retryable: true };
    }
    if (!res.ok) {
      return { results: [], error: `${engine} HTTP ${res.status}`, retryable: res.status >= 500 };
    }
    const html = await res.text();
    if (isBlockedHtml(html)) {
      return { results: [], error: `${engine}: captcha/bot check`, retryable: true };
    }
    const results = parse(html, max);
    if (results.length === 0) {
      return { results: [], error: `${engine}: no parseable results`, retryable: true };
    }
    return { results };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { results: [], error: `${engine}: ${msg}`, retryable: true };
  }
}

function resultsLookRelevant(query: string, results: WebSearchResult[]): boolean {
  if (results.length === 0) return false;
  const stop = new Set([
    "site", "https", "http", "www", "open", "with", "from", "that", "this", "into", "for", "and", "the",
  ]);
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 3 && !stop.has(t));
  if (tokens.length === 0) return true;
  let matched = 0;
  for (const r of results) {
    const hay = `${r.title} ${r.snippet} ${r.url}`.toLowerCase();
    if (tokens.some((t) => hay.includes(t))) matched++;
  }
  return matched / results.length >= 0.4 || matched >= 2;
}

async function searchBingHttp(query: string, max: number, locale: string): Promise<EngineOutcome> {
  const { setlang, cc } = bingLangParams(locale);
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=${setlang}&cc=${cc}&count=${Math.min(30, max + 5)}`;
  const outcome = await genericFetchEngine("bing", url, parseBing, max, undefined, locale);
  if (outcome.results.length === 0) {
    return { results: [], error: outcome.error ?? "bing: http sin resultados", retryable: true };
  }
  if (!resultsLookRelevant(query, outcome.results)) {
    return { results: [], error: "bing: http resultados irrelevantes", retryable: true };
  }
  return outcome;
}

/** Bing: HTTP primero; Playwright solo si falla o 0 resultados. */
async function searchBing(query: string, max: number, locale: string): Promise<EngineOutcome> {
  const http = await searchBingHttp(query, max, locale);
  if (http.results.length > 0) return http;
  const browser = await searchBingWithBrowser(query, max, locale);
  if (browser.results.length > 0) {
    if (!resultsLookRelevant(query, browser.results)) {
      return { results: [], error: "bing: browser resultados irrelevantes", retryable: true };
    }
    return browser;
  }
  return {
    results: [],
    error: http.error ?? browser.error ?? "bing: no results",
    retryable: true,
  };
}

const ENGINES: Record<SearchEngineId, EngineDef> = {
  mojeek: {
    host: "mojeek.com",
    minIntervalMs: 1200,
    run: (q, max, locale) =>
      genericFetchEngine(
        "mojeek",
        `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`,
        parseMojeek,
        max,
        undefined,
        locale
      ),
  },
  "duckduckgo-html": {
    host: "duckduckgo.com",
    minIntervalMs: 900,
    run: (q, max, locale) =>
      genericFetchEngine(
        "duckduckgo-html",
        "https://html.duckduckgo.com/html/",
        (html, m) => parseDuckDuckGo(html, m, "duckduckgo-html"),
        max,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `q=${encodeURIComponent(q)}&kl=${ddgKlFor(locale)}`,
        },
        locale
      ),
  },
  "duckduckgo-lite": {
    host: "duckduckgo.com",
    minIntervalMs: 900,
    run: (q, max, locale) =>
      genericFetchEngine(
        "duckduckgo-lite",
        "https://lite.duckduckgo.com/lite/",
        (html, m) => parseDuckDuckGo(html, m, "duckduckgo-lite"),
        max,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `q=${encodeURIComponent(q)}&kl=${ddgKlFor(locale)}`,
        },
        locale
      ),
  },
  bing: {
    host: "bing.com",
    minIntervalMs: 1500,
    run: (q, max, locale) => searchBing(q, max, locale),
  },
  brave: {
    host: "search.brave.com",
    minIntervalMs: 1200,
    run: (q, max, locale) =>
      genericFetchEngine(
        "brave",
        `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`,
        parseBrave,
        max,
        undefined,
        locale
      ),
  },
  ecosia: {
    host: "ecosia.org",
    minIntervalMs: 1000,
    run: (q, max, locale) =>
      genericFetchEngine(
        "ecosia",
        `https://www.ecosia.org/search?method=index&q=${encodeURIComponent(q)}`,
        parseEcosia,
        max,
        undefined,
        locale
      ),
  },
};

async function runEngine(
  engineId: SearchEngineId,
  query: string,
  max: number,
  locale: string
): Promise<EngineOutcome> {
  const def = ENGINES[engineId];
  if (!def) return { results: [], error: `Unknown engine ${engineId}` };
  return throttleHost(def.host, def.minIntervalMs, async () => {
    let last: EngineOutcome = { results: [], error: `${engineId} not attempted` };
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await sleep(700 * attempt);
      last = await def.run(query, max, locale);
      if (last.results.length > 0 || !last.retryable) break;
    }
    return last;
  });
}

/** Serializa búsquedas Playwright (un solo contexto Bing a la vez). */
let browserSearchChain: Promise<unknown> = Promise.resolve();

function withBrowserSearchLock<T>(task: () => Promise<T>): Promise<T> {
  const run = browserSearchChain.then(() => task());
  browserSearchChain = run.catch(() => {});
  return run;
}

/** Bing vía Playwright cuando el fetch HTTP devuelve HTML sin resultados o bloqueos. */
async function searchBingWithBrowser(
  query: string,
  max: number,
  locale = "en-AU"
): Promise<EngineOutcome> {
  return withBrowserSearchLock(async () => {
    try {
      const { setlang, cc } = bingLangParams(locale);
      const browser = await getBrowser(true);
      const context = await browser.newContext({
        userAgent: USER_AGENT,
        locale: locale.startsWith("es") ? "es-ES" : locale,
      });
      const page = await context.newPage();
      try {
        const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=${setlang}&cc=${cc}&count=${Math.min(30, max + 5)}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForSelector("li.b_algo h2 a", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);

        const raw = await page.locator("li.b_algo").evaluateAll((items, maxN) => {
          const out: { title: string; url: string; snippet: string }[] = [];
          for (const li of items.slice(0, maxN as number)) {
            const a = li.querySelector("h2 a");
            if (!a) continue;
            const p = li.querySelector("p");
            const title = a.textContent?.trim() ?? "";
            const href = (a as HTMLAnchorElement).href ?? "";
            if (!title || !href) continue;
            out.push({
              title,
              url: href,
              snippet: p?.textContent?.trim()?.slice(0, 500) ?? "",
            });
          }
          return out;
        }, max);

        const results = raw
          .map((r) => ({
            title: r.title,
            url: normalizeUrl(r.url),
            snippet: r.snippet,
            engine: "bing" as const,
          }))
          .filter((r) => r.title && isValidResultUrl(r.url));

        if (results.length === 0) {
          return { results: [], error: "bing: browser fallback sin resultados", retryable: true };
        }
        return { results };
      } finally {
        await context.close();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { results: [], error: `bing: browser fallback — ${msg}`, retryable: true };
    }
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
  // Mojeek first: Bing HTTP is often bot-poisoned; keep Bing for Playwright fallback later.
  switch (effort) {
    case "low":
      return ["mojeek", "duckduckgo-lite"];
    case "medium":
      return ["mojeek", "duckduckgo-html", "duckduckgo-lite", "bing"];
    case "high":
      return ["mojeek", "duckduckgo-html", "duckduckgo-lite", "brave", "bing"];
    case "super_high":
      return ["mojeek", "duckduckgo-html", "duckduckgo-lite", "brave", "ecosia", "bing"];
    case "ultra_high":
      // Same engines as super, but Brave/Ecosia earlier for diversity when Mojeek fills first.
      return ["brave", "ecosia", "mojeek", "duckduckgo-html", "duckduckgo-lite", "bing"];
  }
}

export async function searchWeb(
  query: string,
  maxResults = 10,
  options: SearchWebOptions = {}
): Promise<SearchWebResponse> {
  const engines = (options.engines ?? ALL_ENGINES).filter((e) => ENGINES[e]);
  const locale = options.locale ?? "en-US";
  const errors: SearchWebResponse["errors"] = [];
  const counts: Partial<Record<SearchEngineId, number>> = {};
  let merged: WebSearchResult[] = [];

  const live = engines.filter((e) => !isEngineCooling(e));
  const allCooling = engines.length > 0 && live.length === 0;

  // Prefer recently successful engines; skip those in cooldown.
  const ordered = [...engines].sort((a, b) => {
    const coolA = isEngineCooling(a) ? 1 : 0;
    const coolB = isEngineCooling(b) ? 1 : 0;
    if (coolA !== coolB) return coolA - coolB;
    return healthOf(b).successes - healthOf(a).successes;
  });

  let attempted = 0;
  let hardBlockFails = 0;

  // Secuencial: en high+ no cortar al primer motor que llena el cupo — diversificar.
  const minEnginesBeforeFill =
    engines.length >= 5 ? 3 : engines.length >= 4 ? 2 : 1;
  for (const engineId of ordered) {
    if (merged.length >= maxResults && attempted >= minEnginesBeforeFill) break;
    if (isEngineCooling(engineId)) {
      errors.push({
        engine: engineId,
        message: `${engineId}: cooling down after prior block (skipped)`,
      });
      continue;
    }
    attempted += 1;
    const need = Math.max(3, maxResults - merged.length);
    const outcome = await runEngine(engineId, query, need, locale);
    counts[engineId] = (counts[engineId] ?? 0) + outcome.results.length;
    if (outcome.results.length > 0) {
      noteEngineSuccess(engineId);
    } else if (outcome.error) {
      errors.push({ engine: engineId, message: outcome.error });
      // Only hard blocks (403/429/captcha) cool the engine — empty/irrelevant parses do not.
      if (outcome.retryable && isHardBlockSearchError(outcome.error)) {
        noteEngineFailure(engineId);
        hardBlockFails += 1;
      }
    }
    merged = dedupeResults([...merged, ...outcome.results]);
  }

  // Blocked = hard failures on attempted engines, OR every engine already cooling.
  const serpBlocked =
    merged.length === 0 &&
    (allCooling ||
      (attempted > 0 && hardBlockFails >= Math.min(2, attempted)) ||
      (attempted > 0 && hardBlockFails === attempted && attempted >= 1));

  // External Bing Playwright when Bing was NOT already in the engine list
  // (searchBing already does HTTP→browser). Allow even if other engines hard-blocked
  // so low-effort runs still get a last-resort browser attempt.
  const minBeforeBrowser = Math.min(3, maxResults);
  const bingAlreadyTried = engines.includes("bing");
  if (merged.length < minBeforeBrowser && !bingAlreadyTried && !isEngineCooling("bing")) {
    const browserOutcome = await throttleHost("bing.com", 1500, () =>
      searchBingWithBrowser(query, maxResults - merged.length, locale)
    );
    if (browserOutcome.results.length > 0) {
      noteEngineSuccess("bing");
      counts.bing = (counts.bing ?? 0) + browserOutcome.results.length;
      merged = dedupeResults([...merged, ...browserOutcome.results]);
    } else if (browserOutcome.error) {
      if (isHardBlockSearchError(browserOutcome.error)) {
        noteEngineFailure("bing");
      }
      if (!errors.some((e) => e.engine === "bing")) {
        errors.push({ engine: "bing", message: browserOutcome.error });
      }
    }
  }

  return {
    results: merged.slice(0, maxResults),
    errors,
    counts,
    serpBlocked: merged.length === 0 && serpBlocked,
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
