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
  | "isdb-mena"
  | "canada-grants"
  | "nz-grants"
  | "es-grants"
  | "cepal-latam"
  | "caf-latam"
  | "uneca-africa"
  | "unescwa-mena"
  | "ebrd-mena";

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
    if (
      (/canada\.ca$/i.test(host) && /grant|funding|fund|subsid|benefit|financement/i.test(path + pageUrl)) ||
      /communityfoundations\.ca$/i.test(host) ||
      /idrc-crdi\.ca$/i.test(host)
    ) {
      return "canada-grants";
    }
    if (
      /communitymatters\.govt\.nz$/i.test(host) ||
      (/govt\.nz$/i.test(host) && /funding|grant|fund|subsid/i.test(path + pageUrl))
    ) {
      return "nz-grants";
    }
    if (
      /boe\.es$/i.test(host) ||
      (/administracion\.gob\.es$/i.test(host) && /ayuda|subvenci|convocatoria|financi/i.test(path + pageUrl)) ||
      (/cdti\.es$/i.test(host) && /ayuda|convocatoria|financi/i.test(path + pageUrl))
    ) {
      return "es-grants";
    }
    if (/(^|\.)cepal\.org$/i.test(host) || /(^|\.)eclac\.org$/i.test(host)) {
      return "cepal-latam";
    }
    if (/(^|\.)caf\.com$/i.test(host)) {
      return "caf-latam";
    }
    if (/(^|\.)uneca\.org$/i.test(host)) {
      return "uneca-africa";
    }
    if (/(^|\.)unescwa\.org$/i.test(host)) {
      return "unescwa-mena";
    }
    if (/(^|\.)ebrd\.com$/i.test(host)) {
      return "ebrd-mena";
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

/** Canada.ca / Community Foundations / IDRC — funding & grant deep links */
export function parseCanadaGrants(
  html: string,
  pageUrl: string,
  max = 60
): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/funding|\/grants?|\/funds?|\/financement|\/programs?\/|\/opportunities|\/calls?)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/canada\.ca|communityfoundations\.ca|idrc-crdi\.ca/i.test(abs)) continue;
    try {
      const path = new URL(abs).pathname.replace(/\/$/, "") || "/";
      if (path === "/" || path.split("/").filter(Boolean).length < 2) continue;
      if (/\/(login|search|tag|author|page)(\/|$)/i.test(path)) continue;
    } catch {
      continue;
    }
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "Canadian funding opportunity",
        url: abs,
        snippet: "portal-parser:canada-grants",
        parser: "canada-grants",
      },
      max
    );
  }
  return out;
}

/** NZ Community Matters / govt.nz funding browse */
export function parseNzGrants(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/funding|\/grants?|\/funds?|\/fund|\/schemes?|\/apply)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/govt\.nz|communitymatters/i.test(abs)) continue;
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
        title: titleNear(html, m[1]) || "NZ funding opportunity",
        url: abs,
        snippet: "portal-parser:nz-grants",
        parser: "nz-grants",
      },
      max
    );
  }
  return out;
}

/** BOE / sede / CDTI — convocatorias y subvenciones ES */
export function parseEsGrants(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];

  // BOE document / ayuda links
  const boeRe =
    /href\s*=\s*["']([^"']*(?:\/diario_boe\/|\/buscar\/(?:doc|ayudas|actos)|txt\.php\?id=BOE)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = boeRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/boe\.es/i.test(abs)) continue;
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "Convocatoria BOE",
        url: abs,
        snippet: "portal-parser:es-grants",
        parser: "es-grants",
      },
      max
    );
  }

  const hrefRe =
    /href\s*=\s*["']([^"']*(?:subvenci|convocatoria|ayuda|financiaci[oó]n|\/ayudas\/|\/convocatorias)[^"']*)["']/gi;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/boe\.es|administracion\.gob\.es|cdti\.es/i.test(abs)) continue;
    try {
      const path = new URL(abs).pathname.replace(/\/$/, "") || "/";
      if (path === "/" || path.split("/").filter(Boolean).length < 1) continue;
    } catch {
      continue;
    }
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "Ayuda / convocatoria ES",
        url: abs,
        snippet: "portal-parser:es-grants",
        parser: "es-grants",
      },
      max
    );
  }
  return out;
}

/** CEPAL / ECLAC — projects, events, news, funding deep links */
export function parseCepalLatam(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/projects?\/|\/proyectos\/|\/events?\/|\/eventos\/|\/news\/|\/noticias\/|\/pressreleases?\/|\/funding\/|\/financiamient|\/calls?\/|\/convocatorias?)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/cepal\.org|eclac\.org/i.test(abs)) continue;
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
        title: titleNear(html, m[1]) || "CEPAL opportunity",
        url: abs,
        snippet: "portal-parser:cepal-latam",
        parser: "cepal-latam",
      },
      max
    );
  }
  return out;
}

/** CAF — Development Bank of Latin America news / funding / opportunities */
export function parseCafLatam(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/currently\/|\/actualidad\/|\/what-we-do\/|\/que-hacemos\/|\/news\/|\/noticias\/|\/topics\/|\/proyectos\/|\/projects\/|\/funding|\/financiamient|\/opportunities|\/calls?)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/caf\.com/i.test(abs)) continue;
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
        title: titleNear(html, m[1]) || "CAF opportunity",
        url: abs,
        snippet: "portal-parser:caf-latam",
        parser: "caf-latam",
      },
      max
    );
  }
  return out;
}

/** UNECA — UN Economic Commission for Africa events / news / publications */
export function parseUnecaAfrica(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/events?\/|\/news\/|\/stories\/|\/publications?\/|\/funding|\/opportunities|\/procurement|\/calls?\/|\/projects?\/)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/uneca\.org/i.test(abs)) continue;
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
        title: titleNear(html, m[1]) || "UNECA opportunity",
        url: abs,
        snippet: "portal-parser:uneca-africa",
        parser: "uneca-africa",
      },
      max
    );
  }
  return out;
}

/** UNESCWA — Western Asia events / news / funding / opportunities */
export function parseUnescwaMena(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/events?\/|\/news\/|\/publications?\/|\/funding|\/opportunities|\/procurement|\/calls?\/|\/projects?\/|\/sites\/default\/files)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/unescwa\.org/i.test(abs)) continue;
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
        title: titleNear(html, m[1]) || "UNESCWA opportunity",
        url: abs,
        snippet: "portal-parser:unescwa-mena",
        parser: "unescwa-mena",
      },
      max
    );
  }
  return out;
}

/** EBRD — procurement notices / news / project opportunities */
export function parseEbrdMena(html: string, pageUrl: string, max = 60): PortalDeepLink[] {
  const seen = new Set<string>();
  const out: PortalDeepLink[] = [];
  const hrefRe =
    /href\s*=\s*["']([^"']*(?:\/procurement\/|\/work-with-us\/|\/news\/|\/projects\/|\/project\/|\/tenders?\/|\/notices?\/|\/opportunities)[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null && out.length < max) {
    let abs = "";
    try {
      abs = new URL(m[1], pageUrl).href;
    } catch {
      continue;
    }
    if (!/ebrd\.com/i.test(abs)) continue;
    try {
      const path = new URL(abs).pathname.replace(/\/$/, "") || "/";
      if (path === "/" || path.split("/").filter(Boolean).length < 2) continue;
      if (/\/(login|search|tag|careers|privacy)(\/|$)/i.test(path)) continue;
    } catch {
      continue;
    }
    pushUnique(
      out,
      seen,
      {
        title: titleNear(html, m[1]) || "EBRD opportunity",
        url: abs,
        snippet: "portal-parser:ebrd-mena",
        parser: "ebrd-mena",
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
    case "canada-grants":
      links = parseCanadaGrants(html, pageUrl, max);
      break;
    case "nz-grants":
      links = parseNzGrants(html, pageUrl, max);
      break;
    case "es-grants":
      links = parseEsGrants(html, pageUrl, max);
      break;
    case "cepal-latam":
      links = parseCepalLatam(html, pageUrl, max);
      break;
    case "caf-latam":
      links = parseCafLatam(html, pageUrl, max);
      break;
    case "uneca-africa":
      links = parseUnecaAfrica(html, pageUrl, max);
      break;
    case "unescwa-mena":
      links = parseUnescwaMena(html, pageUrl, max);
      break;
    case "ebrd-mena":
      links = parseEbrdMena(html, pageUrl, max);
      break;
  }

  return { parserId, links };
}
