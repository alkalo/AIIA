/**
 * Host-specific portal parsers for high-signal opportunity listing pages.
 * Prefer these over generic href harvesting when the page matches a known portal.
 */
import { canonicalUrl } from "./canonical-url.js";

export type PortalParserId =
  | "grantconnect-au"
  | "grants-gov-us"
  | "eu-funding-tenders"
  | "govuk-grants"
  | "adb-asia"
  | "idb-latam"
  | "fundsforngos"
  | "afdb-africa"
  | "worldbank-global"
  | "undp-global"
  | "isdb-mena";

export interface PortalDeepLink {
  title: string;
  url: string;
  snippet: string;
  parser: PortalParserId;
}

export interface PortalParseResult {
  parserId: PortalParserId;
  links: PortalDeepLink[];
}

function titleNear(html: string, needle: string): string {
  const idx = html.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return "";
  const window = html.slice(Math.max(0, idx - 140), idx + needle.length + 200);
  const aria = /(?:title|aria-label)\s*=\s*["']([^"']{6,160})["']/i.exec(window);
  if (aria?.[1]) return aria[1].replace(/\s+/g, " ").trim();
  return window
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function pushUnique(
  out: PortalDeepLink[],
  seen: Set<string>,
  item: PortalDeepLink,
  max: number
): void {
  if (out.length >= max) return;
  const key = canonicalUrl(item.url) || item.url.split("#")[0].toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ ...item, url: item.url.split("#")[0] });
}

/** Detect which dedicated parser applies to this page (if any). */
export function matchPortalParser(pageUrl: string): PortalParserId | null {
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./i, "").toLowerCase();
    const path = new URL(pageUrl).pathname.toLowerCase();
    if (/grants\.gov\.au$/i.test(host) || /grantconnect/i.test(pageUrl)) {
      return "grantconnect-au";
    }
    if (/grants\.gov$/i.test(host) || host.endsWith(".grants.gov")) {
      return "grants-gov-us";
    }
    if (/europa\.eu$/i.test(host) && /funding-tenders|cordis|ec\.europa/i.test(pageUrl)) {
      return "eu-funding-tenders";
    }
    if (
      (/gov\.uk$/i.test(host) || /tnlcommunityfund\.org\.uk$/i.test(host)) &&
      /grant|funding|find-government-grants|programme|fund/i.test(path + pageUrl)
    ) {
      return "govuk-grants";
    }
    // IDB before ADB — host `iadb.org` ends with the substring `adb.org`.
    // AfDB (`afdb.org`) before ADB (`adb.org`) for the same reason.
    if (/(^|\.)iadb\.org$/i.test(host) || /(^|\.)bid\.org$/i.test(host)) {
      return "idb-latam";
    }
    if (/(^|\.)afdb\.org$/i.test(host)) {
      return "afdb-africa";
    }
    if (/(^|\.)adb\.org$/i.test(host) && !/iadb\.org$/i.test(host) && !/afdb\.org$/i.test(host)) {
      return "adb-asia";
    }
    if (/(^|\.)worldbank\.org$/i.test(host) || /(^|\.)worldbankgroup\.org$/i.test(host)) {
      return "worldbank-global";
    }
    if (/(^|\.)undp\.org$/i.test(host)) {
      return "undp-global";
    }
    if (/(^|\.)isdb\.org$/i.test(host)) {
      return "isdb-mena";
    }
    if (/fundsforngos\.org$/i.test(host) || /candid\.org$/i.test(host)) {
      return "fundsforngos";
    }
  } catch {
    /* keep */
  }
  return null;
}

/** GrantConnect / grants.gov.au — /Go/Show?GoUUID=… */
export function parseGrantConnectAu(
  html: string,
  pageUrl: string,
  max = 60
): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];

  const hrefRe =
    /href\s*=\s*["']([^"']*Go\/Show[^"']*GoUUID=([a-f0-9-]{8,36})[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    const href = m[1];
    const uuid = m[2];
    let abs = "";
    try {
      abs = new URL(href, pageUrl).href;
    } catch {
      abs = `https://www.grants.gov.au/Go/Show?GoUUID=${uuid}`;
    }
    pushUnique(
      out,
      seen,
      {
        title:
          titleNear(html, href) ||
          titleNear(html, uuid) ||
          `GrantConnect — ${uuid.slice(0, 8)}`,
        url: abs,
        snippet: "portal-parser:grantconnect-au",
        parser: "grantconnect-au",
      },
      max
    );
  }

  const uuidRe =
    /GoUUID["\s:=]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/gi;
  while ((m = uuidRe.exec(html)) !== null && out.length < max) {
    const uuid = m[1];
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, uuid) || `GrantConnect — ${uuid.slice(0, 8)}`,
        url: `https://www.grants.gov.au/Go/Show?GoUUID=${uuid}`,
        snippet: "portal-parser:grantconnect-au",
        parser: "grantconnect-au",
      },
      max
    );
  }

  return out;
}

/** Grants.gov US — /search-results-detail/{id} + OpportunityID */
export function parseGrantsGovUs(
  html: string,
  pageUrl: string,
  max = 60
): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];

  const detailRe =
    /href\s*=\s*["']([^"']*search-results-detail\/([0-9A-Za-z_-]{4,})[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = detailRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      abs = `https://www.grants.gov/search-results-detail/${m[2]}`;
    }
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || `Grants.gov — ${m[2]}`,
        url: abs,
        snippet: "portal-parser:grants-gov-us",
        parser: "grants-gov-us",
      },
      max
    );
  }

  const idRe = /OpportunityID["\s:>]+([0-9]{4,12})/gi;
  while ((m = idRe.exec(html)) !== null && out.length < max) {
    const id = m[1];
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, id) || `Grants.gov — ${id}`,
        url: `https://www.grants.gov/search-results-detail/${id}`,
        snippet: "portal-parser:grants-gov-us",
        parser: "grants-gov-us",
      },
      max
    );
  }

  const foaRe =
    /href\s*=\s*["']([^"']*(?:view-opportunity|opportunity-details|foa)[^"']+)["']/gi;
  while ((m = foaRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], "https://www.grants.gov").href;
    } catch {
      continue;
    }
    if (!/grants\.gov/i.test(abs)) continue;
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "Grants.gov opportunity",
        url: abs,
        snippet: "portal-parser:grants-gov-us",
        parser: "grants-gov-us",
      },
      max
    );
  }

  return out;
}

/** EU Funding & Tenders / CORDIS topic detail links */
export function parseEuFundingTenders(
  html: string,
  pageUrl: string,
  max = 60
): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];

  const topicRe =
    /href\s*=\s*["']([^"']*(?:topic-details|opportunity-details|\/calls\/|\/programme\/)[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = topicRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/europa\.eu/i.test(abs)) continue;
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "EU funding opportunity",
        url: abs,
        snippet: "portal-parser:eu-funding-tenders",
        parser: "eu-funding-tenders",
      },
      max
    );
  }

  const callRe =
    /(?:topicId|callIdentifier|callId)["\s:=]+["']?([A-Z0-9][\w.-]{4,80})/gi;
  while ((m = callRe.exec(html)) !== null && out.length < max) {
    const id = m[1];
    if (/^(true|false|null|undefined)$/i.test(id)) continue;
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, id) || `EU topic — ${id.slice(0, 40)}`,
        url: `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${encodeURIComponent(id)}`,
        snippet: "portal-parser:eu-funding-tenders",
        parser: "eu-funding-tenders",
      },
      max
    );
  }

  return out;
}

/** GOV.UK / National Lottery style grant detail links */
export function parseGovUkGrants(
  html: string,
  pageUrl: string,
  max = 60
): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];

  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/grants\/|\/funding\/|\/programme\/|\/fund\/|find-government-grants)[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/\.gov\.uk|tnlcommunityfund/i.test(abs)) continue;
    try {
      const path = new URL(abs).pathname.replace(/\/$/, "") || "/";
      if (path === "/" || /\/search\/?$/i.test(path)) continue;
      if (path.split("/").filter(Boolean).length < 2) continue;
    } catch {
      continue;
    }
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "UK funding opportunity",
        url: abs,
        snippet: "portal-parser:govuk-grants",
        parser: "govuk-grants",
      },
      max
    );
  }

  return out;
}

/** Asian Development Bank — projects / opportunities / news deep links */
export function parseAdbAsia(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/projects\/|\/news\/|\/tenders\/|\/business\/opportunities)[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/adb\.org/i.test(abs)) continue;
    try {
      const path = new URL(abs).pathname.replace(/\/$/, "") || "/";
      if (path === "/" || path.split("/").filter(Boolean).length < 2) continue;
    } catch {
      continue;
    }
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "ADB opportunity",
        url: abs,
        snippet: "portal-parser:adb-asia",
        parser: "adb-asia",
      },
      max
    );
  }
  return out;
}

/** Inter-American Development Bank — news / projects / opportunities */
export function parseIdbLatam(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/news\/|\/projects\/|\/en\/projects|\/opportunities|\/calls)[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/iadb\.org|bid\.org/i.test(abs)) continue;
    try {
      const path = new URL(abs).pathname.replace(/\/$/, "") || "/";
      if (path === "/" || path.split("/").filter(Boolean).length < 2) continue;
    } catch {
      continue;
    }
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "IDB opportunity",
        url: abs,
        snippet: "portal-parser:idb-latam",
        parser: "idb-latam",
      },
      max
    );
  }
  return out;
}

/** Funds for NGOs / Candid — article & funding listing deep links */
export function parseFundsForNgos(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']+(?:\/category\/|\/grants?\/|\/funding|\/find-funding|\/rfps?\/|\/[0-9]{4}\/)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/fundsforngos\.org|candid\.org/i.test(abs)) continue;
    try {
      const path = new URL(abs).pathname.replace(/\/$/, "") || "/";
      if (path === "/" || path.split("/").filter(Boolean).length < 2) continue;
      if (/\/(login|tag|author|page)(\/|$)/i.test(path)) continue;
    } catch {
      continue;
    }
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "Funding listing",
        url: abs,
        snippet: "portal-parser:fundsforngos",
        parser: "fundsforngos",
      },
      max
    );
  }

  // WordPress-style post links on fundsforngos
  const postRe = /href\s*=\s*["'](https?:\/\/[^"']*fundsforngos\.org\/[^"']{12,})["']/gi;
  while ((m = postRe.exec(html)) !== null && out.length < max) {
    const abs = m[1].split("#")[0];
    if (/\/(feed|wp-|tag|author|page\/)/i.test(abs)) continue;
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, abs) || "Funds for NGOs listing",
        url: abs,
        snippet: "portal-parser:fundsforngos",
        parser: "fundsforngos",
      },
      max
    );
  }

  return out;
}

/** African Development Bank — projects / news / business opportunities */
export function parseAfdbAfrica(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/projects-and-operations\/|\/projects\/|\/news-and-events\/|\/news\/|\/documents\/|\/procurement|\/business-opportunities)[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/afdb\.org/i.test(abs)) continue;
    try {
      const path = new URL(abs).pathname.replace(/\/$/, "") || "/";
      if (path === "/" || path.split("/").filter(Boolean).length < 2) continue;
      if (/\/(login|search|tag|category)(\/|$)/i.test(path)) continue;
    } catch {
      continue;
    }
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "AfDB opportunity",
        url: abs,
        snippet: "portal-parser:afdb-africa",
        parser: "afdb-africa",
      },
      max
    );
  }
  return out;
}

/** World Bank — projects / news / opportunities / procurement */
export function parseWorldBank(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/projects-operations\/|\/project-detail\/|\/en\/news\/|\/en\/opportunities|\/corporate-procurement|\/procurement\/|\/en\/programs\/)[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/worldbank\.org|worldbankgroup\.org/i.test(abs)) continue;
    try {
      const path = new URL(abs).pathname.replace(/\/$/, "") || "/";
      if (path === "/" || path.split("/").filter(Boolean).length < 2) continue;
      if (/\/(login|search|topic|country)(\/|$)/i.test(path) && !/project-detail|opportunities/i.test(path)) {
        continue;
      }
    } catch {
      continue;
    }
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "World Bank opportunity",
        url: abs,
        snippet: "portal-parser:worldbank-global",
        parser: "worldbank-global",
      },
      max
    );
  }

  // Project IDs like P123456 embedded in hrefs
  const pidRe = /href\s*=\s*["']([^"']*P\d{5,8}[^"']*)["']/gi;
  while ((m = pidRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/worldbank\.org|worldbankgroup\.org/i.test(abs)) continue;
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "World Bank project",
        url: abs,
        snippet: "portal-parser:worldbank-global",
        parser: "worldbank-global",
      },
      max
    );
  }

  return out;
}

/** UNDP — funding / projects / news / procurement deep links */
export function parseUndp(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/funding|\/projects\/|\/project\/|\/news\/|\/publications\/|\/procurement|\/calls-for|\/opportunities)[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/undp\.org/i.test(abs)) continue;
    try {
      const path = new URL(abs).pathname.replace(/\/$/, "") || "/";
      if (path === "/" || path.split("/").filter(Boolean).length < 1) continue;
      if (/\/(login|search|tag|taxonomy|user)(\/|$)/i.test(path)) continue;
    } catch {
      continue;
    }
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "UNDP opportunity",
        url: abs,
        snippet: "portal-parser:undp-global",
        parser: "undp-global",
      },
      max
    );
  }
  return out;
}

/** Islamic Development Bank — projects / news / opportunities */
export function parseIsdb(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/project|\/projects\/|\/news\/|\/what-we-do\/|\/opportunities|\/procurement|\/financing)[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/isdb\.org/i.test(abs)) continue;
    try {
      const path = new URL(abs).pathname.replace(/\/$/, "") || "/";
      if (path === "/" || path.split("/").filter(Boolean).length < 1) continue;
      if (/\/(login|search|tag|category)(\/|$)/i.test(path)) continue;
    } catch {
      continue;
    }
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "IsDB opportunity",
        url: abs,
        snippet: "portal-parser:isdb-mena",
        parser: "isdb-mena",
      },
      max
    );
  }
  return out;
}

/**
 * Run the matching portal parser (if any). Returns null when no dedicated parser applies.
 */
export function extractPortalDeepLinks(
  html: string,
  pageUrl: string,
  max = 60
): PortalParseResult | null {
  if (!html || html.length < 80) return null;
  const parserId = matchPortalParser(pageUrl);
  if (!parserId) return null;

  let links: PortalDeepLink[] = [];
  switch (parserId) {
    case "grantconnect-au":
      links = parseGrantConnectAu(html, pageUrl, max);
      break;
    case "grants-gov-us":
      links = parseGrantsGovUs(html, pageUrl, max);
      break;
    case "eu-funding-tenders":
      links = parseEuFundingTenders(html, pageUrl, max);
      break;
    case "govuk-grants":
      links = parseGovUkGrants(html, pageUrl, max);
      break;
    case "adb-asia":
      links = parseAdbAsia(html, pageUrl, max);
      break;
    case "idb-latam":
      links = parseIdbLatam(html, pageUrl, max);
      break;
    case "fundsforngos":
      links = parseFundsForNgos(html, pageUrl, max);
      break;
    case "afdb-africa":
      links = parseAfdbAfrica(html, pageUrl, max);
      break;
    case "worldbank-global":
      links = parseWorldBank(html, pageUrl, max);
      break;
    case "undp-global":
      links = parseUndp(html, pageUrl, max);
      break;
    case "isdb-mena":
      links = parseIsdb(html, pageUrl, max);
      break;
  }

  return { parserId, links };
}
