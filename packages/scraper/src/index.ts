import type { BrowserContext } from "playwright";
import { getBrowser, closeBrowser, USER_AGENT } from "./search-engines.js";

export type {
  WebSearchResult,
  SearchEngineId,
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
  /captcha|cloudflare|access denied|unusual traffic|are you a robot|cf-browser-verification|challenge-platform|datadome|perimeterx|just a moment|enable javascript|403 forbidden|request blocked|verifica que eres|comprobar que no eres un robot|pardon our interruption/i;

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

export async function fetchPageContent(
  url: string,
  options?: ScraperOptions
): Promise<string> {
  const b = await getBrowser(options?.headless ?? true);
  let context: BrowserContext;
  const locale = options?.locale ?? "es-ES";
  const includeLinks = options?.includeLinkMarkup !== false;

  if (options?.sessionDir) {
    context = await b.newContext({
      storageState: options.sessionDir,
      userAgent: USER_AGENT,
      locale,
      viewport: { width: 1365, height: 900 },
    });
  } else {
    context = await b.newContext({
      userAgent: USER_AGENT,
      locale,
      viewport: { width: 1365, height: 900 },
    });
  }

  const page = await context.newPage();

  try {
    if (options?.credentials && options.loginUrl) {
      await loginToSite(page, options.loginUrl, options.credentials);
    }

    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const status = response?.status() ?? 0;
    if (status === 403 || status === 429 || status === 503) {
      throw new Error(`URL fetch blocked (HTTP ${status}): ${url}`);
    }
    await page.waitForTimeout(2500);
    const title = await page.title().catch(() => "");
    const { text, linksHtml } = await page.evaluate(() => {
      const bodyText = document.body?.innerText ?? "";
      const anchors = Array.from(document.querySelectorAll("a[href]"))
        .slice(0, 250)
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
    });
    if (isBlockedPageText(text, title)) {
      throw new Error(`URL fetch challenge/captcha: ${url}`);
    }
    const body = text.slice(0, 45000);
    if (includeLinks && linksHtml) {
      return `${body}\n\n${AIIA_ANCHORS_MARKER}\n${linksHtml}`.slice(0, 90000);
    }
    return body;
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
