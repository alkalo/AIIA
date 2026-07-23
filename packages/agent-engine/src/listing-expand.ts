/**
 * Expand grant/opportunity listing pages into concrete deep-link URLs.
 * When SERP is blocked, portal homepages alone are useless — this harvests
 * /Go/Show, /grants/…, FOIDs, etc. from fetched HTML.
 */
import { isDirectGrantUrl, isLowQualityGrantUrl } from "./result-quality.js";

export interface ListingDeepLink {
  title: string;
  url: string;
  snippet: string;
}

const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;
const TITLE_HINT_RE =
  /(?:title|aria-label)\s*=\s*["']([^"']{8,160})["']/i;

/** Paths that look like open-call / grant detail pages (AU + global). */
const OPPORTUNITY_PATH_RE =
  /\/go\/show|gouuid=|grantid=|opportunityid=|foid=|\/viewgrant|\/grant-details|\/funding-opportunity|\/grants?\/[a-z0-9][\w-]{2,}|\/funding\/[a-z0-9]|\/opportunit(?:y|ies)\/|\/program(?:me)?s?\/[a-z0-9]|\/apply\/|\/call-for|\/fellowship|\/award[s]?\/|\/competition\//i;

const SKIP_PATH_RE =
  /\/(login|signin|sign-up|register|cart|checkout|privacy|terms|cookie|accessibility|contact|about|news|blog|events?\/calendar)(\/|$)/i;

function absolutize(href: string, baseUrl: string): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("javascript:") || raw.startsWith("mailto:")) {
    return null;
  }
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return null;
  }
}

function looksLikeOpportunityUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (SKIP_PATH_RE.test(path)) return false;
  } catch {
    if (SKIP_PATH_RE.test(url)) return false;
  }
  if (isDirectGrantUrl(url)) return true;
  if (OPPORTUNITY_PATH_RE.test(url)) return true;
  // Same-host deep paths that aren't bare roots / search hubs
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "") || "/";
    if (path === "/" || path.split("/").filter(Boolean).length < 2) return false;
    if (/\/(search|list|browse|find)(\/|$)/i.test(path) && !u.search) return false;
    return !isLowQualityGrantUrl(url);
  } catch {
    return false;
  }
}

function titleNearHref(html: string, href: string): string {
  const idx = html.toLowerCase().indexOf(href.toLowerCase());
  if (idx < 0) return "";
  const window = html.slice(Math.max(0, idx - 120), idx + href.length + 180);
  const m = TITLE_HINT_RE.exec(window);
  if (m?.[1]) return m[1].replace(/\s+/g, " ").trim();
  const text = window
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 100);
}

/**
 * Harvest opportunity deep links from a listing / portal page HTML.
 */
export function extractOpportunityDeepLinks(
  html: string,
  pageUrl: string,
  max = 40
): ListingDeepLink[] {
  if (!html || html.length < 80) return [];
  let baseHost = "";
  try {
    baseHost = new URL(pageUrl).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const out: ListingDeepLink[] = [];

  HREF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HREF_RE.exec(html)) !== null) {
    const abs = absolutize(match[1], pageUrl);
    if (!abs) continue;
    const key = abs.split("#")[0].toLowerCase();
    if (seen.has(key)) continue;
    if (!looksLikeOpportunityUrl(abs)) continue;

    let host = "";
    try {
      host = new URL(abs).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      continue;
    }
    // Prefer same host; allow known grant aggregators linked from seeds
    const sameHost = host === baseHost || host.endsWith(`.${baseHost}`) || baseHost.endsWith(`.${host}`);
    const grantHost =
      /grants\.gov\.au|communitygrants|business\.gov\.au|frrr\.org|fundsforngos|grantwatch|philanthropy\.org|grantly|globalgiving|gov\.uk|europa\.eu/i.test(
        host
      );
    if (!sameHost && !grantHost) continue;

    seen.add(key);
    const title = titleNearHref(html, match[1]) || `Opportunity — ${host}`;
    out.push({
      title: title.slice(0, 140),
      url: abs.split("#")[0],
      snippet: `Listing deep-link expand from: ${pageUrl}`,
    });
    if (out.length >= max) break;
  }

  // Prefer direct grant URLs first
  out.sort((a, b) => Number(isDirectGrantUrl(b.url)) - Number(isDirectGrantUrl(a.url)));
  return out;
}

/** True when a fetched page is worth expanding into child opportunity links. */
export function isExpandableListingPage(url: string, html?: string): boolean {
  if (/\/go\/list|\/grants-and-programs|\/grants?(\/|$)|\/funding(\/|$)|\/search|grantconnect|browse/i.test(url)) {
    return true;
  }
  try {
    const path = new URL(url).pathname.replace(/\/$/, "") || "/";
    if (path === "/" || path.split("/").filter(Boolean).length <= 1) {
      return Boolean(html && html.length > 2000);
    }
  } catch {
    /* keep */
  }
  if (html && (html.match(OPPORTUNITY_PATH_RE) || []).length >= 3) return true;
  return false;
}
