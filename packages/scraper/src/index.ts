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
} from "./search-engines.js";

export interface ScraperOptions {
  headless?: boolean;
  sessionDir?: string;
  credentials?: { username: string; password: string };
  loginUrl?: string;
}

export interface DuckDuckGoResult {
  title: string;
  url: string;
  snippet: string;
}

const BLOCKED_PAGE_RE =
  /captcha|cloudflare|access denied|unusual traffic|are you a robot|cf-browser-verification|challenge-platform|datadome|perimeterx|just a moment|enable javascript|403 forbidden|request blocked|verifica que eres|comprobar que no eres un robot|pardon our interruption/i;

/** True when Playwright landed on an anti-bot / empty challenge page. */
export function isBlockedPageText(text: string, title = ""): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 80) return true;
  const head = `${title}\n${trimmed.slice(0, 2500)}`;
  return BLOCKED_PAGE_RE.test(head);
}

export async function fetchPageContent(
  url: string,
  options?: ScraperOptions
): Promise<string> {
  const b = await getBrowser(options?.headless ?? true);
  let context: BrowserContext;

  if (options?.sessionDir) {
    context = await b.newContext({
      storageState: options.sessionDir,
      userAgent: USER_AGENT,
      locale: "es-ES",
      viewport: { width: 1365, height: 900 },
    });
  } else {
    context = await b.newContext({
      userAgent: USER_AGENT,
      locale: "es-ES",
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
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    if (isBlockedPageText(text, title)) {
      throw new Error(`URL fetch challenge/captcha: ${url}`);
    }
    return text.slice(0, 50000);
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
