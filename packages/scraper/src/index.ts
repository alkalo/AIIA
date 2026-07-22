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

export async function fetchPageContent(
  url: string,
  options?: ScraperOptions
): Promise<string> {
  const b = await getBrowser(options?.headless ?? true);
  let context: BrowserContext;

  if (options?.sessionDir) {
    context = await b.newContext({ storageState: options.sessionDir, userAgent: USER_AGENT });
  } else {
    context = await b.newContext({ userAgent: USER_AGENT });
  }

  const page = await context.newPage();

  try {
    if (options?.credentials && options.loginUrl) {
      await loginToSite(page, options.loginUrl, options.credentials);
    }

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);
    const text = await page.evaluate(() => document.body.innerText);
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
