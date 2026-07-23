import type { BrowserContext } from "playwright";
import { getBrowser, closeBrowser, USER_AGENT } from "./search-engines.js";

export type {
  WebSearchResult,
  SearchEngineId,
  RunnableSearchEngineId,
  SearchWebOptions,
  SearchWebResponse,
} from "./search-engines.js";
export {
  getBrowser,
  closeBrowser,
  USER_AGENT,
  searchWeb,
  searchDuckDuckGo,
  enginesForEffort,
  isHardBlockSearchError,
  resetSearchEngineHealth,
  msUntilEnginesReady,
  ENGINE_COOLDOWN_MS,
} from "./search-engines.js";

export interface ScraperOptions {
  headless?: boolean;
  sessionDir?: string;
  credentials?: { username: string; password: string };
  loginUrl?: string;
  /** BCP-47 locale for Playwright context (defaults to es-ES). */
  locale?: string;
  /** Append synthetic <a href> markup so listing expand can harvest links. Default true. */
  includeLinkMarkup?: boolean;
}

export interface DuckDuckGoResult {
  title: string;
  url: string;
  snippet: string;
}

const BLOCKED_PAGE_RE =
  /captcha|cloudflare|access denied|unusual traffic|are you a robot|cf-browser-verification|challenge-platform|datadome|perimeterx|just a moment|enable javascript|403 forbidden|request blocked|verifica que eres|comprobar que no eres un robot|pardon our interruption|checking your browser|attention required|enable cookies/i;

/** Marker prepended before harvested anchors (listing-expand / deep crawl). */
export const AIIA_ANCHORS_MARKER = "__AIIA_ANCHORS__";

/** True when Playwright landed on an anti-bot / empty challenge page. */
export function isBlockedPageText(text: string, title = ""): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 80) return true;
  const head = `${title}\n${trimmed.slice(0, 2500)}`;
  return BLOCKED_PAGE_RE.test(head);
}

/** Strip harvested anchor block before sending page text to an LLM. */
export function stripLinkMarkup(content: string): string {
  const idx = content.indexOf(AIIA_ANCHORS_MARKER);
  if (idx < 0) return content;
  return content.slice(0, idx).trimEnd();
}

async function extractPagePayload(
  page: import("playwright").Page,
  maxAnchors: number
): Promise<{ title: string; text: string; linksHtml: string }> {
  const title = await page.title().catch(() => "");
  const { text, linksHtml } = await page.evaluate((cap) => {
    const bodyText = document.body?.innerText ?? "";
    const anchors = Array.from(document.querySelectorAll("a[href]"))
      .slice(0, cap as number)
      .map((el) => {
        const a = el as HTMLAnchorElement;
        const href = a.href || "";
        if (!href || href.startsWith("javascript:") || href.startsWith("mailto:")) return "";
        const label = (a.getAttribute("title") || a.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120)
          .replace(/"/g, "'");
        return `<a href="${href}" title="${label}">${label.slice(0, 80)}</a>`;
      })
      .filter(Boolean)
      .join("\n");
    return { text: bodyText, linksHtml: anchors };
  }, maxAnchors);
  return { title, text, linksHtml };
}

function acceptLanguageFor(locale: string): string {
  if (locale.toLowerCase().startsWith("es")) return "es-ES,es;q=0.9,en;q=0.8";
  if (locale.toLowerCase().startsWith("en-au")) return "en-AU,en;q=0.9";
  if (locale.toLowerCase().startsWith("en-gb")) return "en-GB,en;q=0.9";
  return "en-US,en;q=0.9";
}

function timezoneFor(locale: string): string {
  if (locale.toLowerCase().startsWith("es")) return "Europe/Madrid";
  if (locale.toLowerCase().startsWith("en-au")) return "Australia/Sydney";
  if (locale.toLowerCase().startsWith("en-nz")) return "Pacific/Auckland";
  if (locale.toLowerCase().startsWith("en-gb")) return "Europe/London";
  return "America/New_York";
}

/** Soft stealth: hide webdriver flag; does not bypass hard Cloudflare challenges. */
async function applyStealth(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    } catch {
      /* ignore */
    }
    try {
      const w = window as unknown as { chrome?: { runtime: object } };
      w.chrome = w.chrome || { runtime: {} };
    } catch {
      /* ignore */
    }
  });
}

export async function fetchPageContent(
  url: string,
  options?: ScraperOptions
): Promise<string> {
  const b = await getBrowser(options?.headless ?? true);
  let context: BrowserContext;
  const locale = options?.locale ?? "es-ES";
  const includeLinks = options?.includeLinkMarkup !== false;
  const maxAnchors = 400;
  const acceptLang = acceptLanguageFor(locale);

  const contextOpts = {
    userAgent: USER_AGENT,
    locale,
    timezoneId: timezoneFor(locale),
    colorScheme: "light" as const,
    viewport: { width: 1365 + Math.floor(Math.random() * 40), height: 900 },
    extraHTTPHeaders: {
      "Accept-Language": acceptLang,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
    },
  };

  if (options?.sessionDir) {
    context = await b.newContext({
      ...contextOpts,
      storageState: options.sessionDir,
    });
  } else {
    context = await b.newContext(contextOpts);
  }
  await applyStealth(context);

  const page = await context.newPage();

  try {
    if (options?.credentials && options.loginUrl) {
      await loginToSite(page, options.loginUrl, options.credentials);
    }

    let lastError: Error | null = null;
    // Three attempts: domcontentloaded → load → networkidle (listing hubs).
    const waits: Array<"domcontentloaded" | "load" | "networkidle"> = [
      "domcontentloaded",
      "load",
      "networkidle",
    ];
    for (let attempt = 0; attempt < waits.length; attempt++) {
      try {
        const response = await page.goto(url, {
          waitUntil: waits[attempt],
          timeout: attempt === 0 ? 60000 : attempt === 1 ? 75000 : 90000,
        });
        const status = response?.status() ?? 0;
        if (status === 403 || status === 429 || status === 503) {
          throw new Error(`URL fetch blocked (HTTP ${status}): ${url}`);
        }
        await page.waitForTimeout(attempt === 0 ? 1800 : attempt === 1 ? 3200 : 4500);
        await page.waitForSelector("a[href], main, article, table", { timeout: 6000 }).catch(() => {});

        // Scroll once to trigger lazy listing rows.
        await page
          .evaluate(() => {
            window.scrollTo(0, Math.min(1200, document.body.scrollHeight / 2));
          })
          .catch(() => {});
        await page.waitForTimeout(400);

        const { title, text, linksHtml } = await extractPagePayload(page, maxAnchors);
        if (isBlockedPageText(text, title)) {
          throw new Error(`URL fetch challenge/captcha: ${url}`);
        }
        if (text.trim().length < 120 && (linksHtml?.length ?? 0) < 80) {
          throw new Error(`URL fetch empty/thin page: ${url}`);
        }
        const body = text.slice(0, 45000);
        if (includeLinks && linksHtml) {
          return `${body}\n\n${AIIA_ANCHORS_MARKER}\n${linksHtml}`.slice(0, 100000);
        }
        return body;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const retryable =
          /challenge|captcha|empty\/thin|Timeout|net::|Navigation|networkidle/i.test(
            lastError.message
          ) && !/HTTP 403|HTTP 429|HTTP 503/i.test(lastError.message);
        if (!retryable || attempt === waits.length - 1) break;
        await page.waitForTimeout(1200 + attempt * 800);
      }
    }
    throw lastError ?? new Error(`URL fetch failed: ${url}`);
  } finally {
    await context.close();
  }
}

async function loginToSite(
  page: import("playwright").Page,
  loginUrl: string,
  credentials: { username: string; password: string }
): Promise<void> {
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  const userInput = page.locator('input[type="email"], input[type="text"], input[name="username"]').first();
  const passInput = page.locator('input[type="password"]').first();
  if (await userInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await userInput.fill(credentials.username);
    await passInput.fill(credentials.password);
    await page.locator('button[type="submit"], input[type="submit"]').first().click();
    await page.waitForTimeout(3000);
  }
}

export { connectAndSaveSession } from "./login.js";
export type { ConnectSessionOptions, ConnectSessionResult } from "./login.js";
export { fetchFeed, fetchUrlAsSnippet } from "./feed.js";
export type { FeedItem } from "./feed.js";
