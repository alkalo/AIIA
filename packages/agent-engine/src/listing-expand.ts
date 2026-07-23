/**
 * Expand grant/opportunity listing pages into concrete deep-link URLs.
 * When SERP is blocked, portal homepages alone are useless — this harvests
 * /Go/Show, /grants/…, FOIDs, etc. from fetched HTML.
 */
import { isDirectGrantUrl, isLowQualityGrantUrl } from "./result-quality.js";
import { extractPortalDeepLinks } from "./portal-parsers.js";
import { canonicalUrl } from "./canonical-url.js";

export interface ListingDeepLink {
  title: string;
  url: string;
  snippet: string;
  /** Dedicated portal parser id when harvested via portal-parsers.ts */
  parser?: string;
}

const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;
const TITLE_HINT_RE =
  /(?:title|aria-label)\s*=\s*["']([^"']{8,160})["']/i;

/** Paths that look like open-call / grant detail pages (AU + global). */
const OPPORTUNITY_PATH_RE =
  /\/go\/show|gouuid=|grantid=|opportunityid=|foid=|\/viewgrant|\/grant-details|\/funding-opportunity|\/grants?\/[a-z0-9][\w-]{2,}|\/funding\/[a-z0-9]|\/opportunit(?:y|ies)\/|\/program(?:me)?s?\/[a-z0-9]|\/apply\/|\/call-for|\/fellowship|\/award[s]?\/|\/competition\/|\/tender\/|\/rfp\/|\/solicitud|\/convocatoria|\/subvenc|\/ayuda[s]?\/|\/becas?\/|\/search-grants|\/funding\/opportunit|\/how-to-apply|\/open-call/i;

const SKIP_PATH_RE =
  /\/(login|signin|sign-up|register|cart|checkout|privacy|terms|cookie|accessibility|contact|about|news\/?$|blog\/?$|events?\/calendar)(\/|$)/i;

/** Aggregators / gov portals allowed even when linked cross-host from a seed page. */
const KNOWN_GRANT_HOST_RE =
  /grants\.gov\.au|communitygrants|business\.gov\.au|frrr\.org|fundsforngos|grantwatch|philanthropy\.org|grantly|globalgiving|gov\.uk|europa\.eu|grants\.gov|canada\.ca|govt\.nz|communitymatters|boe\.es|cdti\.es|enisa\.es|devex\.com|terravivagrants|instrumentl|candid\.org|tnlcommunityfund|cordis\.europa|iadb\.org|adb\.org|ourcommunity\.com\.au|grantmaker/i;

const PAGINATION_HINT_RE =
  /(?:next|siguiente|page\s*\d+|página|›|»|older|más resultados|load more|ver más)/i;

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
 * Known portals (GrantConnect, Grants.gov, EU F&T, GOV.UK) use dedicated parsers first.
 */
export function extractOpportunityDeepLinks(
  html: string,
  pageUrl: string,
  max = 60
): ListingDeepLink[] {
  if (!html || html.length < 80) return [];

  const portal = extractPortalDeepLinks(html, pageUrl, max);
  const seen = new Set<string>();
  const out: ListingDeepLink[] = [];

  if (portal?.links.length) {
    for (const link of portal.links) {
      const key = canonicalUrl(link.url) || link.url.split("#")[0].toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        title: link.title.slice(0, 140),
        url: link.url.split("#")[0],
        snippet: link.snippet,
        parser: link.parser,
      });
      if (out.length >= max) {
        out.sort((a, b) => Number(isDirectGrantUrl(b.url)) - Number(isDirectGrantUrl(a.url)));
        return out;
      }
    }
  }

  let baseHost = "";
  try {
    baseHost = new URL(pageUrl).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return out;
  }

  HREF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HREF_RE.exec(html)) !== null) {
    const abs = absolutize(match[1], pageUrl);
    if (!abs) continue;
    const key = canonicalUrl(abs) || abs.split("#")[0].toLowerCase();
    if (seen.has(key)) continue;
    if (!looksLikeOpportunityUrl(abs)) continue;

    let host = "";
    try {
      host = new URL(abs).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      continue;
    }
    const sameHost = host === baseHost || host.endsWith(`.${baseHost}`) || baseHost.endsWith(`.${host}`);
    const grantHost = KNOWN_GRANT_HOST_RE.test(host);
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

  out.sort((a, b) => Number(isDirectGrantUrl(b.url)) - Number(isDirectGrantUrl(a.url)));
  return out;
}

/** True when a fetched page is worth expanding into child opportunity links. */
export function isExpandableListingPage(url: string, html?: string): boolean {
  if (
    /\/go\/list|\/grants-and-programs|\/grants?(\/|$)|\/funding(\/|$)|\/search|grantconnect|browse|\/opportunities|\/funding-tenders|\/seek-funding|\/category\/latest|search-grants|search-results|topic-details|find-government-grants/i.test(
      url
    )
  ) {
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

function looksLikePaginationUrl(url: string, baseUrl: string): boolean {
  try {
    const u = new URL(url);
    const b = new URL(baseUrl);
    if (u.hostname.replace(/^www\./i, "") !== b.hostname.replace(/^www\./i, "")) return false;
    const path = u.pathname.toLowerCase();
    if (SKIP_PATH_RE.test(path)) return false;
    if (/[?&](page|p|pg|start|offset|skiptoken|pagina)=/i.test(u.search)) return true;
    if (/\/page\/\d+|\/p\/\d+|\/go\/list/i.test(path)) return true;
    if (u.pathname === b.pathname && u.search && u.search !== b.search) {
      return /page|start|offset|filter|status|open/i.test(u.search);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Discover same-host listing pagination URLs (page 2+, next, offset).
 * Also synthesizes ?page=2 / page=3 when the current URL looks like a list hub.
 */
export function discoverListingPageUrls(
  html: string,
  pageUrl: string,
  maxExtra = 2
): string[] {
  if (maxExtra <= 0) return [];
  const seen = new Set<string>([pageUrl.split("#")[0].toLowerCase()]);
  const out: string[] = [];

  const push = (raw: string | null) => {
    if (!raw || out.length >= maxExtra) return;
    const key = raw.split("#")[0].toLowerCase();
    if (seen.has(key)) return;
    if (!looksLikePaginationUrl(raw, pageUrl)) return;
    seen.add(key);
    out.push(raw.split("#")[0]);
  };

  HREF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HREF_RE.exec(html)) !== null && out.length < maxExtra) {
    const abs = absolutize(match[1], pageUrl);
    if (!abs) continue;
    const label = titleNearHref(html, match[1]);
    if (PAGINATION_HINT_RE.test(label) || looksLikePaginationUrl(abs, pageUrl)) {
      push(abs);
    }
  }

  if (out.length < maxExtra) {
    try {
      const u = new URL(pageUrl);
      const isList =
        /\/go\/list|\/grants|\/funding|\/search|\/opportunities|\/browse/i.test(u.href);
      if (isList) {
        for (let page = 2; page <= maxExtra + 1 && out.length < maxExtra; page++) {
          const next = new URL(u.href);
          if (next.searchParams.has("page")) {
            next.searchParams.set("page", String(page));
          } else if (next.searchParams.has("Page")) {
            next.searchParams.set("Page", String(page));
          } else if (next.searchParams.has("start")) {
            next.searchParams.set("start", String((page - 1) * 20));
          } else {
            next.searchParams.set("page", String(page));
          }
          push(next.href);
        }
      }
    } catch {
      /* keep */
    }
  }

  return out;
}
