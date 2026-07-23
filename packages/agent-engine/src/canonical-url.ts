/**
 * Canonical URL normalization for dedupe across SERP, expand, curation, and inbox.
 */

const TRACKING_PARAM_RE =
  /^(utm_|fbclid|gclid|msclkid|mc_|ref|referrer|source|campaign|cid|yclid|dclid|_ga|_gl|spm|si|share|feature|ved|usg|sa|ei|oq|gs_l|client|hl|ie|oe)/i;

/** Params that are often noise on grant/news portals but change every share. */
const DROP_ALWAYS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "ref",
  "referrer",
]);

/**
 * Normalize a URL for dedupe / fingerprinting.
 * - lowercase host, strip www
 * - strip hash + tracking params
 * - trailing slash collapse
 * - grants.gov.au Go/Show → stable gouuid/id query when present
 * - grants.gov search-results-detail → path id only
 */
export function canonicalUrl(url: string): string {
  const raw = (url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./i, "").toLowerCase();
    u.protocol = u.protocol.toLowerCase();

    // Prefer stable id query on GrantConnect Show pages.
    if (/grants\.gov\.au$/i.test(u.hostname) && /\/go\/show/i.test(u.pathname)) {
      const id =
        u.searchParams.get("GoUUID") ||
        u.searchParams.get("gouuid") ||
        u.searchParams.get("FOID") ||
        u.searchParams.get("foid");
      if (id) {
        return `https://grants.gov.au/Go/Show?GoUUID=${id.toLowerCase()}`;
      }
    }

    // US Grants.gov detail pages: keep opportunity id path segment only.
    if (/grants\.gov$/i.test(u.hostname)) {
      const m = u.pathname.match(/\/search-results-detail\/([^/?#]+)/i);
      if (m?.[1]) {
        return `https://grants.gov/search-results-detail/${decodeURIComponent(m[1]).toLowerCase()}`;
      }
    }

    for (const key of [...u.searchParams.keys()]) {
      if (DROP_ALWAYS.has(key.toLowerCase()) || TRACKING_PARAM_RE.test(key)) {
        u.searchParams.delete(key);
      }
    }

    // Sort remaining params for stable keys.
    const entries = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    u.search = "";
    for (const [k, v] of entries) u.searchParams.append(k, v);

    let path = u.pathname.replace(/\/{2,}/g, "/");
    if (path.length > 1) path = path.replace(/\/+$/, "");
    const search = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${path || "/"}${search ? `?${search}` : ""}`;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
}

/** Soft content key: org + program/title (for cross-portal duplicates). */
export function opportunityContentKey(fields: object): string {
  const f = fields as Record<string, unknown>;
  const org = String(f.organization ?? f.organisation ?? f.source ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 48);
  const name = String(f.program_name ?? f.title ?? f.headline ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 80);
  const deadline = String(f.deadline ?? f.closing_date ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .slice(0, 20);
  if (!org && !name) return "";
  return `${org}|${name}|${deadline}`;
}
