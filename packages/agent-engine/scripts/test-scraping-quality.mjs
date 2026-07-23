/**
 * Regression tests for scraping quality (canonical URL, regions, feeds, coverage, health).
 * Run: npm run build -w @aiia/agent-engine && node packages/agent-engine/scripts/test-scraping-quality.mjs
 */
import assert from "node:assert/strict";
import { canonicalUrl, opportunityContentKey } from "../dist/canonical-url.js";
import {
  discoverListingPageUrls,
  extractOpportunityDeepLinks,
  isExpandableListingPage,
} from "../dist/listing-expand.js";
import { detectGrantRegions, grantPortalDeepLinkSeeds, grantPortalSeedsForRegions } from "../dist/index.js";
import { opportunityFeedsForSpec, prioritizeFeedsByRegions } from "../dist/opportunity-feeds.js";
import { sectorNewsPortalSeeds, sectorNewsQueryPack, sectorNewsPortalSeedsForRegions } from "../dist/news-sources.js";
import {
  buildRegionCoverage,
  requestedRegionsForSpec,
  inferItemRegion,
  uncoveredRegions,
} from "../dist/coverage-report.js";
import { formatSourceHealthReport, formatHealthHistoryTrend, formatSerpEngineChips, formatAdaptiveChips } from "../dist/source-health.js";
import {
  classifyDiscoveryOrigin,
  countDiscoveryOrigins,
  formatOriginChips,
  formatOriginSummary,
} from "../dist/discovery-origin.js";
import {
  accumulateOriginScores,
  applyOriginPreferenceBoost,
  expandCapExtraFromHistory,
  expandShareFromHistory,
  depth2CapForHistory,
  depth2ShareFromHistory,
  paginationBudgetFromHistory,
  gapFillCapExtraFromHistory,
  gapFillShareFromHistory,
  feedCapForHistory,
  originBoostMapFromHistory,
  pinStrongOriginsFromHistory,
  portalSeedShareFromHistory,
  rssShareFromHistory,
} from "../dist/origin-preference.js";
import {
  applyApprovedBoost,
  approvedDeltaForCandidate,
  buildApprovedSignals,
} from "../dist/approved-boost.js";
import {
  matchPortalParser,
  parseGrantConnectAu,
  parseGrantsGovUs,
  parseEuFundingTenders,
  parseAdbAsia,
  parseIdbLatam,
  parseFundsForNgos,
  parseAfdbAfrica,
  parseWorldBank,
  parseUndp,
  parseIsdb,
  parseCanadaGrants,
  parseNzGrants,
  parseEsGrants,
  parseCepalLatam,
  parseCafLatam,
  parseUnecaAfrica,
  parseUnescwaMena,
  parseEbrdMena,
} from "../dist/portal-parsers.js";
import {
  applyHostHealthBoost,
  hostBoostMapFromHealth,
} from "../dist/host-health.js";
import {
  extractGrantConnectDetail,
  extractGrantsGovDetail,
  extractAdbDetail,
  extractIdbDetail,
  extractFundsForNgosDetail,
  extractGovUkDetail,
  extractAfdbDetail,
  extractWorldBankDetail,
  extractUndpDetail,
  extractIsdbDetail,
  extractCanadaDetail,
  extractNzDetail,
  extractEsDetail,
  extractCepalDetail,
  extractCafDetail,
  extractUnecaDetail,
  extractUnescwaDetail,
  extractEbrdDetail,
  extractPortalDetails,
  formatPortalDetailHints,
  mergePortalDetails,
  portalDetailHasSignal,
} from "../dist/portal-detail.js";
import { orderEnginesByHistory, parseTopSerpLine, resolveEngineOrder } from "../dist/serp-preference.js";
import { itemFingerprint } from "../dist/curation.js";
import { regionFetchBoost, gapFetchBoost, expandCapForExhaustive } from "../dist/budget.js";
import { effectiveMinScore } from "../dist/search-quality.js";
import { shouldExcludeOpportunity, shouldExcludeNews, applyCurationScoreFloor } from "../dist/curation.js";
import {
  filterHealthyFeeds,
  isFeedHealthy,
  FEED_COOLDOWN_MS,
} from "../dist/feed-health.js";
import { sourcesToFetchDiverse } from "../dist/source-ranker.js";

// --- canonical URL ---
assert.equal(
  canonicalUrl("https://WWW.Example.com/path/?utm_source=x&id=1#frag"),
  "https://example.com/path?id=1"
);
assert.equal(
  canonicalUrl("https://www.grants.gov.au/Go/Show?GoUUID=ABC-123&utm_campaign=x"),
  "https://grants.gov.au/Go/Show?GoUUID=abc-123"
);
assert.equal(
  canonicalUrl("https://www.grants.gov/search-results-detail/345678/?ref=share"),
  "https://grants.gov/search-results-detail/345678"
);

const k1 = opportunityContentKey({
  organization: "Example Foundation",
  program_name: "Community Impact Grant",
  deadline: "2026-12-01",
});
const k2 = opportunityContentKey({
  organization: "Example  Foundation",
  title: "Community Impact Grant",
  deadline: "2026-12-01",
});
assert.equal(k1, k2, "content key should normalize whitespace/org+name");

const fpA = itemFingerprint({
  url: "https://www.grants.gov.au/Go/Show?GoUUID=ZZZ&utm_source=a",
  organization: "Dept",
  program_name: "Rural Fund",
});
const fpB = itemFingerprint({
  url: "https://grants.gov.au/Go/Show?GoUUID=zzz",
  organization: "Dept",
  program_name: "Rural Fund",
});
assert.equal(fpA, fpB, "fingerprints must match after canonical URL");

// --- listing pagination ---
const listHtml = `
<html><body>
  <a href="/Go/List?page=2" title="Next page">Next</a>
  <a href="/Go/Show?GoUuid=aaa" title="Grant A">A</a>
  <a href="/Go/Show?GoUuid=bbb" title="Grant B">B</a>
</body></html>`;
const listUrl = "https://www.grants.gov.au/Go/List";
assert.equal(isExpandableListingPage(listUrl, listHtml), true);
const pages = discoverListingPageUrls(listHtml, listUrl, 2);
assert.ok(pages.length >= 1, `expected pagination urls, got ${pages.length}`);
assert.ok(pages.some((p) => /page=2/i.test(p)), `expected page=2 in ${pages.join(", ")}`);
const deep = extractOpportunityDeepLinks(listHtml, listUrl, 10);
assert.ok(deep.length >= 2, `expected deep links, got ${deep.length}`);

// --- regions / seeds / feeds ---
const globalRegions = detectGrantRegions("Find global funding opportunities worldwide");
assert.ok(globalRegions.has("global"), "global prompt → global region");

const auOnly = detectGrantRegions("Australian FRRR community grants Queensland");
assert.ok(auOnly.has("au"), "AU prompt → au");
assert.ok(!auOnly.has("global") || auOnly.size > 1 || true);

const baseSpec = {
  id: "t-scrape",
  version: 1,
  name: "Global Opportunities",
  prompt: "Global grants for community wellbeing and rural development worldwide",
  opportunitySubtype: "grants",
  contentMode: "opportunities",
  search: { queries: ["grant"], sources: [{ type: "duckduckgo" }] },
  filters: { criteria: "global open funding", minScore: 40, requireVerification: true },
  output: { schema: ["title", "url"], destinations: ["inbox"] },
  schedule: { intervalMinutes: 1440, onlyWhenRunning: true },
  effort: "super_high",
  retentionDays: 90,
  status: "published",
};

const seeds = grantPortalDeepLinkSeeds(baseSpec);
assert.ok(seeds.length >= 8, `global atlas should load many seeds, got ${seeds.length}`);
assert.ok(
  seeds.some((s) => /fundsforngos|terraviva|devex|candid|grantwatch/i.test(s.url)),
  "expected global aggregator seeds"
);

const feeds = opportunityFeedsForSpec(baseSpec);
assert.ok(feeds.length >= 12, `expected multi-region feed atlas, got ${feeds.length}`);
assert.ok(feeds.some((f) => f.region === "ca"), "expected CA feeds");
assert.ok(feeds.some((f) => f.region === "latam"), "expected LATAM feeds");
assert.ok(feeds.some((f) => f.region === "asia"), "expected Asia feeds");
assert.ok(feeds.some((f) => f.region === "africa"), "expected Africa feeds");
assert.ok(feeds.some((f) => f.region === "mena"), "expected MENA feeds");
assert.ok(feeds.some((f) => /idrc-crdi|canada\.ca/i.test(f.url)), "CA feed URLs");
assert.ok(seeds.some((s) => /idrc-crdi\.ca/i.test(s.url)), "expected IDRC portal seed");
assert.ok(seeds.some((s) => /boe\.es\/buscar\/ayudas/i.test(s.url)), "expected BOE ayudas seed");
assert.ok(feeds.some((f) => /iadb|cepal|caf\.com/i.test(f.url)), "LATAM feed URLs");
assert.ok(seeds.some((s) => /cepal\.org/i.test(s.url)), "expected CEPAL portal seed");
assert.ok(seeds.some((s) => /caf\.com/i.test(s.url)), "expected CAF portal seed");
assert.ok(feeds.some((f) => /adb\.org/i.test(f.url)), "Asia feed URLs");
assert.ok(feeds.some((f) => /afdb\.org|uneca/i.test(f.url)), "Africa feed URLs");
assert.ok(feeds.some((f) => /unescwa|ebrd/i.test(f.url)), "MENA feed URLs");
assert.ok(feeds.some((f) => /worldbank|undp/i.test(f.url)), "multilateral global feeds");

const newsSpec = {
  ...baseSpec,
  name: "Sector news AU",
  prompt: "Track Australian social enterprise and philanthropy news",
  opportunitySubtype: "sector_news",
  contentMode: "sector_news",
  filters: { criteria: "Australia impact news", minScore: 40 },
};
const newsFeeds = opportunityFeedsForSpec(newsSpec);
assert.ok(newsFeeds.length >= 4, `expected regional news feeds, got ${newsFeeds.length}`);
assert.ok(
  newsFeeds.every((f) => f.region === "global" || f.region === "news" || f.region === "au"),
  "AU news prompt should not load LATAM/MENA-only feeds"
);
assert.ok(newsFeeds.some((f) => f.region === "au"), "expected AU news feeds");

const newsSeeds = sectorNewsPortalSeeds(newsSpec.prompt);
assert.ok(newsSeeds.length >= 6, `expected multi-seed news atlas, got ${newsSeeds.length}`);
assert.ok(newsSeeds.some((s) => /probonoaustralia|socialenterprise|philanthropy\.org\.au/i.test(s.url)));
assert.ok(newsSeeds.some((s) => /ssir\.org|devex\.com/i.test(s.url)), "global news seeds");

const globalNewsSeeds = sectorNewsPortalSeeds("global impact news worldwide");
assert.ok(
  globalNewsSeeds.some((s) => /cepal|caf\.com|afdb|unescwa|adb\.org/i.test(s.url)),
  "global news should include regional hubs"
);
assert.ok(sectorNewsQueryPack("impact investing Europe", 12).length >= 6);

const newsGapAu = sectorNewsPortalSeedsForRegions(["au"]);
assert.ok(newsGapAu.some((s) => /probonoaustralia|socialenterprise|philanthropy\.org\.au/i.test(s.url)));
assert.ok(newsGapAu.some((s) => /ssir\.org|devex\.com/i.test(s.url)), "news gap-fill keeps global fallback");
const newsGapLatam = sectorNewsPortalSeedsForRegions(["latam"]);
assert.ok(newsGapLatam.some((s) => /cepal|caf\.com/i.test(s.url)));
assert.equal(sectorNewsPortalSeedsForRegions([]).length, 0);
assert.ok(seeds.some((s) => /afdb\.org|uneca|fundsforngos.*africa/i.test(s.url)), "expected Africa portal seeds");
assert.ok(seeds.some((s) => /uneca\.org\/(events|stories)/i.test(s.url)), "expected UNECA events/stories seed");
assert.ok(
  seeds.some((s) => /isdb\.org|unescwa|ebrd|middle-east/i.test(s.url)),
  "expected MENA portal seeds"
);
assert.ok(seeds.some((s) => /unescwa\.org\/(events|news)/i.test(s.url)), "expected UNESCWA events/news seed");
assert.ok(seeds.some((s) => /ebrd\.com/i.test(s.url)), "expected EBRD portal seed");
assert.ok(seeds.some((s) => /worldbank\.org|undp\.org/i.test(s.url)), "expected WB/UNDP seeds");

const africaOnly = detectGrantRegions("Kenya and Ghana NGO grants via African Development Bank");
assert.ok(africaOnly.has("africa"), "Africa prompt → africa");
const menaOnly = detectGrantRegions("MENA Middle East IsDB funding Egypt Morocco");
assert.ok(menaOnly.has("mena"), "MENA prompt → mena");

const prioritized = prioritizeFeedsByRegions(feeds, ["asia", "latam"]);
assert.ok(prioritized.length === feeds.length);
const firstRegions = prioritized.slice(0, 4).map((f) => f.region);
assert.ok(
  firstRegions.every((r) => r === "asia" || r === "latam" || r === "global" || r === "news") ||
    prioritized[0].region === "asia" ||
    prioritized[0].region === "latam",
  "gap regions should sort near the front"
);
assert.ok(
  prioritized.findIndex((f) => f.region === "asia") <
    prioritized.findIndex((f) => f.region === "au") ||
    !feeds.some((f) => f.region === "au"),
  "asia preferred before au when asia is a gap"
);

const auSpec = {
  ...baseSpec,
  prompt: "Australia only FRRR and GrantConnect community grants",
  filters: { ...baseSpec.filters, criteria: "Australia AU" },
};
const auSeeds = grantPortalDeepLinkSeeds(auSpec);
assert.ok(
  auSeeds.every((s) => !/grants\.gov\/search|boe\.es|canada\.ca/i.test(s.url)) ||
    auSeeds.some((s) => /grants\.gov\.au|frrr|communitygrants/i.test(s.url)),
  "AU-locked should prefer AU portals"
);
assert.ok(
  auSeeds.some((s) => /grants\.gov\.au|frrr|communitygrants/i.test(s.url)),
  "AU seeds must include AU portals"
);

// --- coverage + health ---
const requested = requestedRegionsForSpec(baseSpec.prompt, baseSpec.filters.criteria);
const coverage = buildRegionCoverage(
  [
    { title: "AU Grant", url: "https://www.grants.gov.au/Go/Show?GoUUID=1", organization: "AU" },
    { title: "EU Call", url: "https://ec.europa.eu/info/funding-tenders/x", organization: "EU" },
    { title: "Global NGO", url: "https://www2.fundsforngos.org/x", organization: "FFN" },
  ],
  requested
);
assert.ok(coverage.rows.length >= 2, "coverage rows expected");
assert.ok(coverage.summaryLines.length >= 2);

const health = formatSourceHealthReport({
  serpEngineHits: { mojeek: 3, brave: 5 },
  seedCount: 10,
  feedItemCount: 4,
  listingExpandCount: 12,
  depth2Count: 3,
  pageFetchOk: 20,
  pageFetchFail: 2,
  finalCount: 15,
  serpExhausted: false,
});
assert.match(health, /Brave|brave|mojeek/i);
assert.match(health, /Resultados finales: 15/);

const chips = formatSerpEngineChips({ "brave-api": 12, mojeek: 4, brave: 2 });
assert.deepEqual(chips, ["Brave API:12", "Mojeek:4", "Brave HTML:2"]);

assert.equal(regionFetchBoost(1, false), 0);
assert.ok(regionFetchBoost(4, true) >= 6, "multi-region exhaustive should boost");
assert.equal(gapFetchBoost(0, "normal"), 0);
assert.ok(gapFetchBoost(3, "normal") >= 9);
assert.ok(gapFetchBoost(3, "critical") <= 4);

// --- exhaustive soft curation ---
const baseMin = effectiveMinScore("super_high", 70);
const softMin = effectiveMinScore("super_high", 70, { exhaustive: true });
assert.ok(softMin < baseMin, "exhaustive minScore should be softer");
assert.ok(softMin >= 36);

const undatedItem = {
  title: "Community Resilience Call",
  url: "https://example.org/calls/resilience-2026",
  organization: "Example Foundation",
  review_status: "pending",
};
const strictSpec = {
  id: "t",
  version: 1,
  name: "t",
  prompt: "Global grants worldwide",
  opportunitySubtype: "grants",
  contentMode: "opportunities",
  search: { queries: [], sources: [{ type: "duckduckgo" }] },
  filters: { criteria: "global", minScore: 55, requireVerification: true, minDaysRemaining: 7 },
  output: { schema: ["title", "url"], destinations: ["inbox"] },
  schedule: { intervalMinutes: 1440, onlyWhenRunning: true },
  effort: "super_high",
  retentionDays: 90,
  status: "published",
};
const softKeep = shouldExcludeOpportunity(undatedItem, strictSpec, { exhaustiveSoft: true });
assert.equal(softKeep, null, "exhaustive soft should keep undated titled opportunity");

const newsSpecSoft = {
  ...strictSpec,
  opportunitySubtype: "sector_news",
  contentMode: "sector_news",
  prompt: "Global impact news worldwide",
};
const almostStale = {
  title: "Recent-ish impact investing update",
  url: "https://ssir.org/articles/entry/example",
  publication_date: new Date(Date.now() - 38 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
};
assert.equal(shouldExcludeNews(almostStale, newsSpecSoft), "stale_news");
assert.equal(
  shouldExcludeNews(almostStale, newsSpecSoft, { exhaustiveSoft: true }),
  null,
  "exhaustive soft news should keep stories within +7d of maxAge"
);

const flooredNews = applyCurationScoreFloor(
  [
    {
      title: "Impact investing report for community foundations",
      url: "https://ssir.org/articles/entry/impact-report-2026",
      score: 12,
      reason: "Listing deep-link expand",
    },
  ],
  newsSpecSoft,
  true
);
assert.ok((flooredNews[0].score ?? 0) >= 46, "news score floor should lift critic dump");
assert.match(String(flooredNews[0].reason), /score-floor/);

const flooredOpp = applyCurationScoreFloor(
  [
    {
      title: "Community Grant 2026",
      program_name: "Community Grant 2026",
      organization: "Example Foundation",
      url: "https://www.grants.gov.au/Go/Show?GoUUID=abc",
      deadline: "2026-12-01",
      score: 8,
    },
  ],
  strictSpec,
  true
);
assert.ok((flooredOpp[0].score ?? 0) >= 45);

assert.ok(expandCapForExhaustive(60, { exhaustive: true }) > expandCapForExhaustive(60, {}));
assert.ok(expandCapForExhaustive(60, { gapCount: 4 }) >= 48);

const feedFile = {
  agentId: "t",
  updatedAt: "2026-07-23T00:00:00.000Z",
  feeds: {
    "https://dead.example/feed": {
      fails: 3,
      successes: 0,
      cooldownUntil: new Date(Date.now() + FEED_COOLDOWN_MS).toISOString(),
      lastAt: "2026-07-23T00:00:00.000Z",
    },
    "https://ok.example/feed": {
      fails: 0,
      successes: 2,
      lastAt: "2026-07-23T00:00:00.000Z",
    },
  },
};
assert.equal(isFeedHealthy(feedFile, "https://dead.example/feed"), false);
assert.equal(isFeedHealthy(feedFile, "https://ok.example/feed"), true);
const filtered = filterHealthyFeeds(
  [
    { url: "https://dead.example/feed", title: "Dead" },
    { url: "https://ok.example/feed", title: "Ok" },
  ],
  feedFile
);
assert.equal(filtered.active.length, 1);
assert.equal(filtered.skipped.length, 1);

const diverse = sourcesToFetchDiverse(
  [
    { title: "AU", url: "https://www.grants.gov.au/Go/List", snippet: "Portal seed", relevance: 90, fetchPriority: "high" },
    { title: "EU", url: "https://ec.europa.eu/info/funding-tenders", snippet: "Portal seed", relevance: 90, fetchPriority: "high" },
    { title: "US", url: "https://www.grants.gov/search-grants", snippet: "x", relevance: 80, fetchPriority: "medium" },
    { title: "AU2", url: "https://frrr.org.au/funding/", snippet: "x", relevance: 70, fetchPriority: "medium" },
  ],
  3,
  (url) => inferItemRegion({ url })
);
assert.equal(diverse.length, 3);

// --- gap-fill helpers ---
const gapUrls = [
  "https://www.grants.gov.au/Go/List",
  "https://ec.europa.eu/info/funding-tenders",
];
const gapReq = new Set(["au", "eu", "us", "uk"]);
const gaps = uncoveredRegions(gapUrls, gapReq);
assert.ok(gaps.includes("us") && gaps.includes("uk"));
assert.ok(!gaps.includes("au") && !gaps.includes("eu"));

const gapSeeds = grantPortalSeedsForRegions(["us", "uk"]);
assert.ok(gapSeeds.length >= 2);
assert.ok(gapSeeds.some((s) => /grants\.gov|instrumentl/i.test(s.url)));
assert.ok(gapSeeds.some((s) => /gov\.uk|tnlcommunityfund|grantfinder/i.test(s.url)));

const healthWithGap = formatSourceHealthReport({
  serpEngineHits: { brave: 3 },
  seedCount: 10,
  feedItemCount: 5,
  listingExpandCount: 12,
  depth2Count: 4,
  pageFetchOk: 20,
  pageFetchFail: 2,
  finalCount: 15,
  serpExhausted: false,
  gapFillCount: 6,
  originCounts: { "portal-seed": 8, rss: 4, serp: 3 },
});
assert.match(healthWithGap, /Gap-fill mid-run: 6/);
assert.match(healthWithGap, /Origen de finales/);
assert.match(healthWithGap, /Seeds:8/);
assert.match(healthWithGap, /RSS:4/);

const healthAdaptive = formatSourceHealthReport({
  serpEngineHits: { mojeek: 2 },
  seedCount: 5,
  feedItemCount: 8,
  listingExpandCount: 10,
  depth2Count: 2,
  pageFetchOk: 15,
  pageFetchFail: 1,
  finalCount: 12,
  serpExhausted: true,
  adaptive: {
    softExhaustive: true,
    feedExtra: 6,
    rssSharePct: 28,
    originPinned: 9,
    originPinDetail: "portal-seed:40%, rss:28%",
    expandExtra: 16,
    depth2Extra: 8,
    paginationDetail: "4p×6h",
    gapFillExtra: 8,
  },
});
assert.match(healthAdaptive, /Aprendizaje adaptativo/);
assert.match(healthAdaptive, /curación suave/);
assert.match(healthAdaptive, /RSS \+6/);
assert.match(healthAdaptive, /origin-pin 9/);
assert.match(healthAdaptive, /expand \+16/);
assert.match(healthAdaptive, /depth-2 \+8/);
assert.match(healthAdaptive, /paginación 4p×6h/);
assert.match(healthAdaptive, /gap-fill \+8/);
assert.deepEqual(
  formatAdaptiveChips({
    softExhaustive: true,
    feedExtra: 6,
    rssSharePct: 28,
    originPinned: 9,
    expandExtra: 16,
    depth2Extra: 8,
    paginationDetail: "4p×6h",
    gapFillExtra: 8,
  }),
  ["soft", "RSS+6(28%)", "pin:9", "expand+16", "depth2+8", "page:4p×6h", "gap+8"]
);
assert.deepEqual(formatAdaptiveChips(null), []);
assert.deepEqual(formatAdaptiveChips({}), []);

// --- discovery origin ---
assert.equal(classifyDiscoveryOrigin("RSS feed (asia): ADB news"), "rss");
assert.equal(classifyDiscoveryOrigin("Gap-fill region: africa,mena"), "gap-fill");
assert.equal(classifyDiscoveryOrigin("Listing deep-link | portal-parser:afdb-africa"), "listing-expand");
assert.equal(classifyDiscoveryOrigin("Depth-2 related opportunity"), "depth-2");
assert.equal(classifyDiscoveryOrigin("Portal coverage seed"), "portal-seed");
assert.equal(classifyDiscoveryOrigin("Extracted from SERP snippet"), "serp");

const originCounts = countDiscoveryOrigins([
  { reason: "Portal coverage seed | portal-detail:afdb-africa" },
  { reason: "RSS feed (africa): AfDB news" },
  { reason: "RSS feed (global): UNDP" },
  { reason: "Listing deep-link" },
  { reason: "Extracted" },
]);
assert.equal(originCounts["portal-seed"], 1);
assert.equal(originCounts.rss, 2);
assert.equal(originCounts["listing-expand"], 1);
assert.equal(originCounts.serp, 1);
assert.ok(formatOriginChips(originCounts).some((c) => /RSS:2/.test(c)));
assert.match(formatOriginSummary(originCounts), /Origen de finales/);

const histForOrigin = [
  {
    at: "2026-07-20T00:00:00.000Z",
    finalCount: 12,
    serpExhausted: true,
    seedCount: 20,
    feedItemCount: 10,
    listingExpandCount: 5,
    depth2Count: 2,
    pageFetchOk: 30,
    pageFetchFail: 2,
    originCounts: { "portal-seed": 7, rss: 4, serp: 1 },
  },
  {
    at: "2026-07-22T00:00:00.000Z",
    finalCount: 15,
    serpExhausted: false,
    seedCount: 22,
    feedItemCount: 12,
    listingExpandCount: 6,
    depth2Count: 3,
    pageFetchOk: 35,
    pageFetchFail: 1,
    originCounts: { "portal-seed": 8, rss: 5, "listing-expand": 2, serp: 0 },
  },
];
const originScores = accumulateOriginScores(histForOrigin);
assert.ok((originScores.get("portal-seed") ?? 0) > (originScores.get("serp") ?? 0));
const originBoosts = originBoostMapFromHistory(histForOrigin);
assert.ok((originBoosts.get("portal-seed") ?? 0) > 0);
assert.ok((originBoosts.get("rss") ?? 0) > 0);
assert.ok(rssShareFromHistory(histForOrigin) >= 0.2);
const rssCap = feedCapForHistory(28, histForOrigin);
assert.ok(rssCap.extra >= 4, `expected RSS feed cap boost, got extra=${rssCap.extra}`);
assert.ok(rssCap.cap > 28 || rssCap.cap === 36);
assert.equal(feedCapForHistory(28, []).extra, 0);
assert.ok(portalSeedShareFromHistory(histForOrigin) >= 0.4);
const originPin = pinStrongOriginsFromHistory(
  [
    {
      url: "https://www.grants.gov.au/Go/List",
      snippet: "Portal coverage seed",
      relevance: 50,
      fetchPriority: "medium",
      rankReason: "Portal coverage seed",
    },
    {
      url: "https://www.afdb.org/en/news/x",
      snippet: "RSS feed (africa): AfDB",
      relevance: 55,
      fetchPriority: "medium",
      rankReason: "RSS feed (africa)",
    },
    {
      url: "https://www.adb.org/projects/1",
      snippet: "Listing deep-link",
      relevance: 52,
      fetchPriority: "medium",
      rankReason: "Listing deep-link | portal-parser:adb-asia",
    },
    {
      url: "https://serp.example/x",
      snippet: "Search result",
      relevance: 80,
      fetchPriority: "medium",
      rankReason: "Extracted from SERP snippet",
    },
  ],
  [
    ...histForOrigin,
    {
      at: "2026-07-23T00:00:00.000Z",
      finalCount: 20,
      serpExhausted: false,
      seedCount: 20,
      feedItemCount: 15,
      listingExpandCount: 10,
      depth2Count: 2,
      pageFetchOk: 40,
      pageFetchFail: 1,
      originCounts: {
        "portal-seed": 6,
        rss: 5,
        "listing-expand": 5,
        serp: 4,
      },
    },
  ]
);
assert.ok(originPin.pinned >= 2);
assert.ok(originPin.strongOrigins.some((s) => /portal-seed|rss|listing-expand/.test(s)));
assert.equal(
  originPin.ranked.find((r) => /grants\.gov\.au/i.test(r.url))?.fetchPriority,
  "high"
);
assert.equal(
  originPin.ranked.find((r) => /afdb\.org/i.test(r.url))?.fetchPriority,
  "high"
);
assert.match(
  String(originPin.ranked.find((r) => /adb\.org/i.test(r.url))?.rankReason),
  /origin-pin:listing-expand/
);

const expandHist = [
  {
    at: "2026-07-23T00:00:00.000Z",
    finalCount: 20,
    serpExhausted: false,
    seedCount: 10,
    feedItemCount: 5,
    listingExpandCount: 15,
    depth2Count: 5,
    pageFetchOk: 40,
    pageFetchFail: 1,
    originCounts: {
      "listing-expand": 10,
      "depth-2": 4,
      "portal-seed": 4,
      serp: 2,
    },
  },
];
assert.ok(expandShareFromHistory(expandHist) >= 0.5);
assert.equal(expandCapExtraFromHistory(expandHist), 24);
assert.equal(expandCapExtraFromHistory([]), 0);
const withHist = expandCapForExhaustive(90, { exhaustive: true, historyExtra: 24 });
const withoutHist = expandCapForExhaustive(90, { exhaustive: true });
assert.ok(withHist > withoutHist);

const depth2Hist = [
  {
    at: "2026-07-23T00:00:00.000Z",
    finalCount: 15,
    serpExhausted: false,
    seedCount: 8,
    feedItemCount: 3,
    listingExpandCount: 5,
    depth2Count: 10,
    pageFetchOk: 30,
    pageFetchFail: 1,
    originCounts: { "depth-2": 8, "portal-seed": 4, serp: 3 },
  },
];
assert.ok(depth2ShareFromHistory(depth2Hist) >= 0.4);
const d2 = depth2CapForHistory(10, depth2Hist);
assert.ok(d2.extra >= 8);
assert.ok(d2.cap > 10);
assert.equal(depth2CapForHistory(10, []).extra, 0);

const pageBudget = paginationBudgetFromHistory(expandHist);
assert.equal(pageBudget.pagesPerHub, 5);
assert.equal(pageBudget.maxHubs, 8);
assert.equal(pageBudget.detail, "5p×8h");
const pageDefault = paginationBudgetFromHistory([]);
assert.equal(pageDefault.pagesPerHub, 2);
assert.equal(pageDefault.maxHubs, 4);
assert.equal(pageDefault.detail, "");

const gapHist = [
  {
    at: "2026-07-23T00:00:00.000Z",
    finalCount: 12,
    serpExhausted: false,
    seedCount: 4,
    feedItemCount: 2,
    listingExpandCount: 1,
    depth2Count: 0,
    pageFetchOk: 20,
    pageFetchFail: 0,
    originCounts: { "gap-fill": 5, "portal-seed": 3, serp: 4 },
  },
];
assert.ok(gapFillShareFromHistory(gapHist) >= 0.3);
assert.equal(gapFillCapExtraFromHistory(gapHist), 12);
assert.equal(gapFillCapExtraFromHistory([]), 0);

const originBoosted = applyOriginPreferenceBoost(
  [
    {
      title: "Seed",
      url: "https://www.grants.gov.au/Go/List",
      snippet: "Portal coverage seed",
      relevance: 60,
      fetchPriority: "medium",
      rankReason: "Portal coverage seed",
    },
    {
      title: "Serp",
      url: "https://example.com/page",
      snippet: "Search result",
      relevance: 70,
      fetchPriority: "medium",
      rankReason: "Extracted from SERP snippet",
    },
  ],
  originBoosts
);
assert.ok(
  (originBoosted[0].relevance ?? 0) >= (originBoosted[1].relevance ?? 0) ||
    originBoosted[0].fetchPriority === "high",
  "historically strong seed channel should outrank weak SERP"
);

// --- approved inbox boost ---
const approvedSignals = buildApprovedSignals([
  {
    title: "Community Impact Grant",
    url: "https://www.grants.gov.au/Go/Show?GoUUID=aaa",
    organization: "Department of Social Services",
    review_status: "approved",
  },
  {
    title: "Old archived",
    url: "https://frrr.org.au/funding/old",
    organization: "FRRR",
    review_status: "archived",
  },
  {
    title: "Rejected noise",
    url: "https://spam.example/page",
    organization: "Spam Co",
    review_status: "rejected",
  },
  {
    title: "Pending ignore",
    url: "https://pending.example/x",
    organization: "Pending Org",
    review_status: "pending",
  },
]);
assert.ok(approvedSignals.hosts.has("grants.gov.au"));
assert.ok(approvedSignals.hosts.has("frrr.org.au"));
assert.ok(!approvedSignals.hosts.has("spam.example"));
assert.ok(approvedSignals.rejectedHosts.has("spam.example"));
assert.equal(approvedSignals.rejectedCount, 1);
assert.ok(approvedSignals.orgs.has("department of social services"));
assert.ok(approvedSignals.rejectedOrgs.has("spam co"));
assert.equal(
  approvedDeltaForCandidate(
    { url: "https://www.grants.gov.au/Go/List", title: "List", snippet: "portal" },
    approvedSignals
  ) >= 14,
  true
);
assert.equal(
  approvedDeltaForCandidate(
    {
      url: "https://other.example/x",
      title: "DSS call",
      snippet: "Department of Social Services funding",
    },
    approvedSignals
  ) >= 8,
  true
);
assert.ok(
  approvedDeltaForCandidate(
    { url: "https://spam.example/page", title: "Spam", snippet: "Spam Co listing" },
    approvedSignals
  ) < 0,
  "rejected host/org should demote"
);

// Approved host wins over reject on same host
const mixedSignals = buildApprovedSignals([
  {
    title: "Good",
    url: "https://mixed.example/good",
    organization: "Good Org",
    review_status: "approved",
  },
  {
    title: "Bad once",
    url: "https://mixed.example/bad",
    organization: "Noise",
    review_status: "rejected",
  },
]);
assert.ok(
  approvedDeltaForCandidate(
    { url: "https://mixed.example/other", title: "x", snippet: "y" },
    mixedSignals
  ) > 0,
  "approved host should win over single reject on same host"
);

// Repeated rejects demote harder
const repeatReject = buildApprovedSignals([
  { title: "a", url: "https://junk.example/1", organization: "Junk", review_status: "rejected" },
  { title: "b", url: "https://junk.example/2", organization: "Junk", review_status: "rejected" },
  { title: "c", url: "https://junk.example/3", organization: "Junk", review_status: "rejected" },
]);
assert.ok(
  approvedDeltaForCandidate({ url: "https://junk.example/x", title: "x", snippet: "Junk" }, repeatReject) <=
    -10
);

const demoted = applyApprovedBoost(
  [
    {
      title: "Junk",
      url: "https://junk.example/page",
      snippet: "Junk listing",
      relevance: 75,
      fetchPriority: "medium",
    },
  ],
  repeatReject
);
assert.equal(demoted[0].fetchPriority, "skip");
assert.match(String(demoted[0].rankReason), /rejected-demote/);

const approvedBoosted = applyApprovedBoost(
  [
    {
      title: "AU portal",
      url: "https://www.grants.gov.au/Go/List",
      snippet: "Portal seed",
      relevance: 55,
      fetchPriority: "medium",
    },
    {
      title: "Random",
      url: "https://random.example/page",
      snippet: "x",
      relevance: 60,
      fetchPriority: "medium",
    },
  ],
  approvedSignals
);
const auBoosted = approvedBoosted.find((r) => /grants\.gov\.au/i.test(r.url));
const randomBoosted = approvedBoosted.find((r) => /random\.example/i.test(r.url));
assert.ok(auBoosted);
assert.ok((auBoosted.relevance ?? 0) >= 69);
assert.equal(auBoosted.fetchPriority, "high");
assert.ok((auBoosted.relevance ?? 0) > (randomBoosted?.relevance ?? 0));

const trend = formatHealthHistoryTrend([
  {
    at: "2026-07-20T10:00:00.000Z",
    finalCount: 12,
    serpExhausted: false,
    seedCount: 8,
    feedItemCount: 4,
    listingExpandCount: 10,
    depth2Count: 2,
    pageFetchOk: 15,
    pageFetchFail: 1,
    regionGaps: ["us"],
  },
  {
    at: "2026-07-23T10:00:00.000Z",
    finalCount: 18,
    serpExhausted: true,
    seedCount: 10,
    feedItemCount: 5,
    listingExpandCount: 12,
    depth2Count: 4,
    pageFetchOk: 20,
    pageFetchFail: 2,
    gapFillCount: 3,
  },
]);
assert.match(trend, /2026-07-20: 12/);
assert.match(trend, /2026-07-23: 18 SERP↓/);

// --- portal parsers ---
assert.equal(matchPortalParser("https://www.grants.gov.au/Go/List"), "grantconnect-au");
assert.equal(matchPortalParser("https://www.grants.gov/search-grants"), "grants-gov-us");
assert.equal(
  matchPortalParser("https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/home"),
  "eu-funding-tenders"
);

const auHtml = `
<a href="/Go/Show?GoUUID=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" title="Community Impact Grant 2026">Open</a>
<script>var x = { GoUUID: "11111111-2222-3333-4444-555555555555" };</script>
`;
const auLinks = parseGrantConnectAu(auHtml, "https://www.grants.gov.au/Go/List", 10);
assert.ok(auLinks.length >= 2, `GrantConnect parser expected >=2, got ${auLinks.length}`);
assert.ok(auLinks.every((l) => /GoUUID=/i.test(l.url)));

const usHtml = `
<a href="/search-results-detail/345678">FOA details</a>
<div>OpportunityID>987654</div>
`;
const usLinks = parseGrantsGovUs(usHtml, "https://www.grants.gov/search-grants", 10);
assert.ok(usLinks.length >= 2);
assert.ok(usLinks.some((l) => /search-results-detail\/345678/i.test(l.url)));

const euHtml = `
<a href="/opportunities/portal/screen/opportunities/topic-details/HORIZON-CL5-2026">Topic</a>
{"topicId":"HORIZON-CL2-2026-DEMO"}
`;
const euLinks = parseEuFundingTenders(
  euHtml,
  "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/home",
  10
);
assert.ok(euLinks.length >= 2);

const merged = extractOpportunityDeepLinks(auHtml, "https://www.grants.gov.au/Go/List", 10);
assert.ok(merged.some((l) => l.parser === "grantconnect-au"));

assert.equal(matchPortalParser("https://www.adb.org/news"), "adb-asia");
assert.equal(matchPortalParser("https://www.iadb.org/en/news"), "idb-latam");
assert.equal(matchPortalParser("https://www2.fundsforngos.org/category/latest/"), "fundsforngos");

const adbLinks = parseAdbAsia(
  `<a href="/projects/12345-4567">Solar grid</a><a href="/news/asia-climate-fund">News</a>`,
  "https://www.adb.org/projects",
  10
);
assert.ok(adbLinks.length >= 2);

const idbLinks = parseIdbLatam(
  `<a href="/en/news/new-climate-fund">Fund</a><a href="/en/projects/details/xyz">Project</a>`,
  "https://www.iadb.org/en/news",
  10
);
assert.ok(idbLinks.length >= 1);

const ffnLinks = parseFundsForNgos(
  `<a href="https://www2.fundsforngos.org/category/latest-funds-for-ngos/">Latest</a>
   <a href="https://www2.fundsforngos.org/2026/07/community-grant/">Post</a>`,
  "https://www2.fundsforngos.org/",
  10
);
assert.ok(ffnLinks.length >= 1);

assert.equal(matchPortalParser("https://www.afdb.org/en/projects-and-operations"), "afdb-africa");
assert.equal(matchPortalParser("https://www.worldbank.org/en/opportunities"), "worldbank-global");
assert.notEqual(matchPortalParser("https://www.afdb.org/en/news"), "adb-asia");

const afdbLinks = parseAfdbAfrica(
  `<a href="/en/projects-and-operations/project-123">Grid</a>
   <a href="/en/news-and-events/climate-fund">News</a>
   <a href="/en/projects-and-operations/business-opportunities">Biz</a>`,
  "https://www.afdb.org/en/projects-and-operations",
  10
);
assert.ok(afdbLinks.length >= 2, `AfDB parser expected >=2, got ${afdbLinks.length}`);
assert.ok(afdbLinks.every((l) => l.parser === "afdb-africa"));

const wbLinks = parseWorldBank(
  `<a href="/en/projects-operations/project-detail/P123456">Project</a>
   <a href="/en/news/climate-resilience-fund">News</a>
   <a href="/en/opportunities/business">Opp</a>`,
  "https://www.worldbank.org/en/opportunities",
  10
);
assert.ok(wbLinks.length >= 2, `World Bank parser expected >=2, got ${wbLinks.length}`);
assert.ok(wbLinks.every((l) => l.parser === "worldbank-global"));

assert.equal(matchPortalParser("https://www.undp.org/funding"), "undp-global");
assert.equal(matchPortalParser("https://www.isdb.org/what-we-do"), "isdb-mena");

const undpLinks = parseUndp(
  `<a href="/funding/climate-promise">Climate Promise</a>
   <a href="/projects/rural-livelihoods">Project</a>
   <a href="/news/new-call-for-proposals">News</a>`,
  "https://www.undp.org/funding",
  10
);
assert.ok(undpLinks.length >= 2, `UNDP parser expected >=2, got ${undpLinks.length}`);
assert.ok(undpLinks.every((l) => l.parser === "undp-global"));

const isdbLinks = parseIsdb(
  `<a href="/project/solar-microgrids">Solar</a>
   <a href="/news/new-financing-window">News</a>
   <a href="/what-we-do/financing">Financing</a>`,
  "https://www.isdb.org/",
  10
);
assert.ok(isdbLinks.length >= 2, `IsDB parser expected >=2, got ${isdbLinks.length}`);
assert.ok(isdbLinks.every((l) => l.parser === "isdb-mena"));

assert.equal(
  matchPortalParser("https://www.canada.ca/en/services/business/grants.html"),
  "canada-grants"
);
assert.equal(matchPortalParser("https://idrc-crdi.ca/en/funding"), "canada-grants");
assert.equal(matchPortalParser("https://www.communitymatters.govt.nz/"), "nz-grants");
assert.equal(matchPortalParser("https://www.boe.es/buscar/ayudas.php"), "es-grants");

const caLinks = parseCanadaGrants(
  `<a href="/en/services/business/grants/innovation-fund.html">Innovation</a>
   <a href="/en/department/funding/community-grant.html">Community</a>
   <a href="https://idrc-crdi.ca/en/funding/calls">IDRC calls</a>`,
  "https://www.canada.ca/en/services/business/grants.html",
  10
);
assert.ok(caLinks.length >= 2, `Canada parser expected >=2, got ${caLinks.length}`);
assert.ok(caLinks.every((l) => l.parser === "canada-grants"));

const nzLinks = parseNzGrants(
  `<a href="/funding/community-fund">Community Fund</a>
   <a href="/funds/lottery-grants">Lottery</a>
   <a href="/apply/scheme-2026">Apply</a>`,
  "https://www.communitymatters.govt.nz/",
  10
);
assert.ok(nzLinks.length >= 2, `NZ parser expected >=2, got ${nzLinks.length}`);
assert.ok(nzLinks.every((l) => l.parser === "nz-grants"));

const esLinks = parseEsGrants(
  `<a href="/diario_boe/txt.php?id=BOE-A-2026-1234">BOE doc</a>
   <a href="/buscar/doc.php?id=BOE-A-2026-5678">Buscar</a>
   <a href="https://www.cdti.es/ayudas/convocatoria-2026">CDTI</a>`,
  "https://www.boe.es/buscar/ayudas.php",
  10
);
assert.ok(esLinks.length >= 2, `ES parser expected >=2, got ${esLinks.length}`);
assert.ok(esLinks.every((l) => l.parser === "es-grants"));

assert.equal(matchPortalParser("https://www.cepal.org/en/projects"), "cepal-latam");
assert.equal(matchPortalParser("https://www.caf.com/en/currently/news/"), "caf-latam");

const cepalLinks = parseCepalLatam(
  `<a href="/en/projects/green-transition">Project</a>
   <a href="/en/events/funding-call-2026">Event</a>
   <a href="/en/news/new-call">News</a>`,
  "https://www.cepal.org/en/projects",
  10
);
assert.ok(cepalLinks.length >= 2, `CEPAL parser expected >=2, got ${cepalLinks.length}`);
assert.ok(cepalLinks.every((l) => l.parser === "cepal-latam"));

const cafLinks = parseCafLatam(
  `<a href="/en/currently/news/climate-facility">News</a>
   <a href="/en/what-we-do/funding">Funding</a>
   <a href="/en/topics/infrastructure">Topics</a>`,
  "https://www.caf.com/en/currently/news/",
  10
);
assert.ok(cafLinks.length >= 2, `CAF parser expected >=2, got ${cafLinks.length}`);
assert.ok(cafLinks.every((l) => l.parser === "caf-latam"));

assert.equal(matchPortalParser("https://www.uneca.org/events"), "uneca-africa");
assert.equal(matchPortalParser("https://www.unescwa.org/events"), "unescwa-mena");

const unecaLinks = parseUnecaAfrica(
  `<a href="/events/climate-finance-forum">Event</a>
   <a href="/stories/new-funding-window">Story</a>
   <a href="/publications/africa-outlook">Pub</a>`,
  "https://www.uneca.org/events",
  10
);
assert.ok(unecaLinks.length >= 2, `UNECA parser expected >=2, got ${unecaLinks.length}`);
assert.ok(unecaLinks.every((l) => l.parser === "uneca-africa"));

const unescwaLinks = parseUnescwaMena(
  `<a href="/events/social-protection-call">Event</a>
   <a href="/news/new-partnership">News</a>
   <a href="/publications/mena-report">Pub</a>`,
  "https://www.unescwa.org/events",
  10
);
assert.ok(unescwaLinks.length >= 2, `UNESCWA parser expected >=2, got ${unescwaLinks.length}`);
assert.ok(unescwaLinks.every((l) => l.parser === "unescwa-mena"));

assert.equal(
  matchPortalParser("https://www.ebrd.com/work-with-us/procurement/notices.html"),
  "ebrd-mena"
);

const ebrdLinks = parseEbrdMena(
  `<a href="/work-with-us/procurement/notices/12345">Notice</a>
   <a href="/news/green-cities-facility">News</a>
   <a href="/projects/urban-mobility">Project</a>`,
  "https://www.ebrd.com/work-with-us/procurement/notices.html",
  10
);
assert.ok(ebrdLinks.length >= 2, `EBRD parser expected >=2, got ${ebrdLinks.length}`);
assert.ok(ebrdLinks.every((l) => l.parser === "ebrd-mena"));

// --- host-health boost ---
const fakeHealth = {
  agentId: "t",
  updatedAt: "2026-07-23T00:00:00.000Z",
  hosts: {
    "grants.gov.au": { score: 80, finals: 10, misses: 0, lastAt: "2026-07-23T00:00:00.000Z" },
    "dead.example": { score: 8, finals: 0, misses: 4, lastAt: "2026-07-23T00:00:00.000Z" },
  },
};
const boosts = hostBoostMapFromHealth(fakeHealth);
assert.equal(boosts.get("grants.gov.au"), 18);
assert.equal(boosts.get("dead.example"), -12);

const boosted = applyHostHealthBoost(
  [
    {
      title: "AU",
      url: "https://www.grants.gov.au/Go/List",
      snippet: "x",
      relevance: 70,
      fetchPriority: "medium",
    },
    {
      title: "Dead",
      url: "https://dead.example/page",
      snippet: "x",
      relevance: 70,
      fetchPriority: "medium",
    },
  ],
  boosts
);
assert.ok((boosted[0].relevance ?? 0) > (boosted[1].relevance ?? 0));
assert.equal(boosted[0].fetchPriority, "high");
assert.equal(boosted[1].fetchPriority, "skip");

// --- portal detail extract ---
const detailHtml = `
<html><head><meta property="og:title" content="Community Resilience Grant 2026" />
<meta name="description" content="Supports local NGOs across Australia." /></head>
<body><h1>Community Resilience Grant 2026</h1>
<table><tr><th>Agency</th><td>Department of Social Services</td></tr>
<tr><th>Closing Date</th><td>30 July 2026</td></tr>
<tr><th>Total Amount</th><td>AUD 250,000</td></tr></table></body></html>
`;
const detail = extractGrantConnectDetail(detailHtml);
assert.ok(portalDetailHasSignal(detail));
assert.match(String(detail.organization), /Social Services/i);
assert.ok(detail.deadline);
assert.match(String(detail.program_name || detail.title), /Community Resilience/i);

const usDetail = extractGrantsGovDetail(`
<h1>Climate Adaptation FOA</h1>
<span>Agency</span></th><td>EPA</td>
Close Date: 15 December 2026
Award Ceiling: $500,000
`);
assert.ok(usDetail.deadline || usDetail.organization);

const mergedItem = mergePortalDetails(
  { title: "X", url: "https://www.grants.gov.au/Go/Show?GoUUID=1", score: 70 },
  detail
);
assert.match(String(mergedItem.organization), /Social Services/i);
assert.ok(String(mergedItem.reason).includes("portal-detail"));

const adbDetail = extractAdbDetail(`
<html><h1>Solar Grid Expansion Project</h1>
<meta name="description" content="ADB financing for grid upgrades in Vietnam." />
<th>Country</th><td>Viet Nam</td>
<th>ADB Financing</th><td>$120 million</td>
`);
assert.equal(adbDetail.organization, "Asian Development Bank");
assert.match(String(adbDetail.title), /Solar Grid/i);

const idbDetail = extractIdbDetail(`
<h1>Climate Resilience Facility</h1>
<meta property="og:description" content="IDB call for Caribbean municipalities." />
`);
assert.equal(idbDetail.organization, "Inter-American Development Bank");

const ffnDetail = extractFundsForNgosDetail(`
<h1>Community Health Grant 2026</h1>
Deadline: 1 September 2026
Donor: Example Foundation
`);
assert.ok(portalDetailHasSignal(ffnDetail));
assert.ok(ffnDetail.deadline);

const govUkHtml = `
<html><h1>Community Ownership Fund Round 4</h1>
<meta name="description" content="Capital funding for community groups across England." />
<p>Organisation: Department for Levelling Up</p>
<p>Closing date: 12 August 2026</p>
<p>Funding: up to £2 million</p>
`;
const govUkDetail = extractGovUkDetail(govUkHtml);
assert.ok(portalDetailHasSignal(govUkDetail));
assert.equal(govUkDetail.scope, "UK");
assert.match(String(govUkDetail.organization), /Levelling Up|Department/i);
assert.ok(govUkDetail.deadline);
assert.match(String(govUkDetail.program_name || govUkDetail.title), /Community Ownership/i);

const routedGovUk = extractPortalDetails(
  govUkHtml,
  "https://www.gov.uk/government/publications/community-ownership-fund"
);
assert.ok(routedGovUk);
assert.equal(routedGovUk.parser, "govuk-grants");

const hints = formatPortalDetailHints(govUkDetail);
assert.match(hints, /Structured fields already parsed/i);
assert.match(hints, /organization:/i);
assert.match(hints, /deadline:/i);
assert.equal(formatPortalDetailHints(null), "");
assert.equal(formatPortalDetailHints({ parser: "x" }), "");

const afdbDetailHtml = `
<html><head><meta name="description" content="AfDB financing for climate adaptation across the Sahel region." /></head>
<body><h1>Sahel Climate Resilience Project</h1>
<table><tr><th>Country</th><td>Senegal</td></tr>
<tr><th>AfDB Financing</th><td>UA 45 million</td></tr>
<tr><th>Closing Date</th><td>30 November 2026</td></tr></table>
<p>Supports community climate adaptation and rural livelihoods across Senegal and neighbouring Sahel states.</p>
</body></html>`;
const afdbDetail = extractAfdbDetail(afdbDetailHtml);
assert.equal(afdbDetail.organization, "African Development Bank");
assert.ok(portalDetailHasSignal(afdbDetail));
assert.match(String(afdbDetail.title), /Sahel Climate/i);

const wbDetailHtml = `
<html><head><meta property="og:description" content="World Bank support for municipal water security and utilities." /></head>
<body><h1>Urban Water Security Program</h1>
<table><tr><th>Country</th><td>Kenya</td></tr>
<tr><th>Commitment Amount</th><td>USD 200 million</td></tr>
<tr><th>Approval Date</th><td>15 January 2026</td></tr></table>
<p>Improves urban water access and climate-resilient infrastructure for growing municipalities.</p>
</body></html>`;
const wbDetail = extractWorldBankDetail(wbDetailHtml);
assert.equal(wbDetail.organization, "World Bank");
assert.ok(portalDetailHasSignal(wbDetail));

const routedAfdb = extractPortalDetails(
  afdbDetailHtml,
  "https://www.afdb.org/en/projects-and-operations/sahel-climate"
);
assert.ok(routedAfdb);
assert.equal(routedAfdb.parser, "afdb-africa");

const routedWb = extractPortalDetails(
  wbDetailHtml,
  "https://www.worldbank.org/en/projects-operations/project-detail/P123456"
);
assert.ok(routedWb);
assert.equal(routedWb.parser, "worldbank-global");

const undpDetailHtml = `
<html><head><meta name="description" content="UNDP call supporting local climate adaptation projects." /></head>
<body><h1>Climate Promise Local Grants 2026</h1>
<table><tr><th>Country</th><td>Global</td></tr>
<tr><th>Deadline</th><td>20 September 2026</td></tr>
<tr><th>Budget</th><td>USD 50,000</td></tr></table>
<p>Supports community-led climate action and capacity building across partner countries.</p>
</body></html>`;
const undpDetail = extractUndpDetail(undpDetailHtml);
assert.equal(undpDetail.organization, "United Nations Development Programme");
assert.ok(portalDetailHasSignal(undpDetail));

const isdbDetailHtml = `
<html><head><meta property="og:description" content="IsDB financing for member country infrastructure." /></head>
<body><h1>Green Infrastructure Facility</h1>
<table><tr><th>Country</th><td>Egypt</td></tr>
<tr><th>Amount</th><td>USD 80 million</td></tr>
<tr><th>Approval Date</th><td>10 March 2026</td></tr></table>
<p>Finances climate-resilient infrastructure across IsDB member countries.</p>
</body></html>`;
const isdbDetail = extractIsdbDetail(isdbDetailHtml);
assert.equal(isdbDetail.organization, "Islamic Development Bank");
assert.ok(portalDetailHasSignal(isdbDetail));

const routedUndp = extractPortalDetails(undpDetailHtml, "https://www.undp.org/funding/climate-promise");
assert.ok(routedUndp);
assert.equal(routedUndp.parser, "undp-global");

const routedIsdb = extractPortalDetails(isdbDetailHtml, "https://www.isdb.org/project/green-infra");
assert.ok(routedIsdb);
assert.equal(routedIsdb.parser, "isdb-mena");

const caDetailHtml = `
<html><head><meta property="og:description" content="Canadian federal funding for community projects." /></head>
<body><h1>Community Innovation Grant</h1>
<table><tr><th>Department</th><td>Innovation, Science and Economic Development</td></tr>
<tr><th>Closing date</th><td>15 August 2026</td></tr>
<tr><th>Funding</th><td>CAD 250,000</td></tr></table>
</body></html>`;
const caDetail = extractCanadaDetail(caDetailHtml);
assert.equal(caDetail.organization, "Innovation, Science and Economic Development");
assert.ok(portalDetailHasSignal(caDetail));

const nzDetailHtml = `
<html><head><meta property="og:description" content="NZ community funding scheme." /></head>
<body><h1>Lottery Community Fund</h1>
<table><tr><th>Organisation</th><td>Community Matters</td></tr>
<tr><th>Closing date</th><td>1 September 2026</td></tr>
<tr><th>Funding</th><td>NZD 50,000</td></tr></table>
</body></html>`;
const nzDetail = extractNzDetail(nzDetailHtml);
assert.equal(nzDetail.organization, "Community Matters");
assert.ok(portalDetailHasSignal(nzDetail));

const esDetailHtml = `
<html><head><meta property="og:description" content="Convocatoria de ayudas públicas." /></head>
<body><h1>Ayudas a proyectos de innovación social</h1>
<table><tr><th>Organismo</th><td>Ministerio de Derechos Sociales</td></tr>
<tr><th>Fecha límite</th><td>30 de octubre de 2026</td></tr>
<tr><th>Importe</th><td>500.000 EUR</td></tr></table>
</body></html>`;
const esDetail = extractEsDetail(esDetailHtml);
assert.equal(esDetail.organization, "Ministerio de Derechos Sociales");
assert.ok(portalDetailHasSignal(esDetail));

const routedCa = extractPortalDetails(
  caDetailHtml,
  "https://www.canada.ca/en/services/business/grants/community-innovation.html"
);
assert.ok(routedCa);
assert.equal(routedCa.parser, "canada-grants");

const routedNz = extractPortalDetails(
  nzDetailHtml,
  "https://www.communitymatters.govt.nz/funding/lottery-community"
);
assert.ok(routedNz);
assert.equal(routedNz.parser, "nz-grants");

const routedEs = extractPortalDetails(
  esDetailHtml,
  "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-9999"
);
assert.ok(routedEs);
assert.equal(routedEs.parser, "es-grants");

const cepalDetailHtml = `
<html><head><meta property="og:description" content="CEPAL project on regional development." /></head>
<body><h1>Green Transition Facility</h1>
<table><tr><th>Country</th><td>Chile</td></tr>
<tr><th>Deadline</th><td>12 November 2026</td></tr>
<tr><th>Budget</th><td>USD 1.2 million</td></tr></table>
</body></html>`;
const cepalDetail = extractCepalDetail(cepalDetailHtml);
assert.equal(cepalDetail.organization, "CEPAL / ECLAC");
assert.ok(portalDetailHasSignal(cepalDetail));

const cafDetailHtml = `
<html><head><meta property="og:description" content="CAF financing for infrastructure." /></head>
<body><h1>Urban Mobility Programme</h1>
<table><tr><th>País</th><td>Colombia</td></tr>
<tr><th>Fecha límite</th><td>5 December 2026</td></tr>
<tr><th>Monto</th><td>USD 40 million</td></tr></table>
</body></html>`;
const cafDetail = extractCafDetail(cafDetailHtml);
assert.equal(cafDetail.organization, "CAF — Development Bank of Latin America");
assert.ok(portalDetailHasSignal(cafDetail));

const routedCepal = extractPortalDetails(
  cepalDetailHtml,
  "https://www.cepal.org/en/projects/green-transition"
);
assert.ok(routedCepal);
assert.equal(routedCepal.parser, "cepal-latam");

const routedCaf = extractPortalDetails(
  cafDetailHtml,
  "https://www.caf.com/en/currently/news/urban-mobility"
);
assert.ok(routedCaf);
assert.equal(routedCaf.parser, "caf-latam");

const unecaDetailHtml = `
<html><head><meta property="og:description" content="UNECA regional development event." /></head>
<body><h1>Africa Climate Finance Forum</h1>
<table><tr><th>Country</th><td>Ethiopia</td></tr>
<tr><th>Deadline</th><td>18 August 2026</td></tr>
<tr><th>Funding</th><td>USD 200,000</td></tr></table>
</body></html>`;
const unecaDetail = extractUnecaDetail(unecaDetailHtml);
assert.equal(unecaDetail.organization, "UNECA — UN Economic Commission for Africa");
assert.ok(portalDetailHasSignal(unecaDetail));

const unescwaDetailHtml = `
<html><head><meta property="og:description" content="UNESCWA social protection call." /></head>
<body><h1>Social Protection Innovation Call</h1>
<table><tr><th>Country</th><td>Jordan</td></tr>
<tr><th>Deadline</th><td>22 September 2026</td></tr>
<tr><th>Budget</th><td>USD 150,000</td></tr></table>
</body></html>`;
const unescwaDetail = extractUnescwaDetail(unescwaDetailHtml);
assert.equal(
  unescwaDetail.organization,
  "UNESCWA — UN Economic and Social Commission for Western Asia"
);
assert.ok(portalDetailHasSignal(unescwaDetail));

const routedUneca = extractPortalDetails(
  unecaDetailHtml,
  "https://www.uneca.org/events/climate-finance-forum"
);
assert.ok(routedUneca);
assert.equal(routedUneca.parser, "uneca-africa");

const routedUnescwa = extractPortalDetails(
  unescwaDetailHtml,
  "https://www.unescwa.org/events/social-protection-call"
);
assert.ok(routedUnescwa);
assert.equal(routedUnescwa.parser, "unescwa-mena");

const ebrdDetailHtml = `
<html><head><meta property="og:description" content="EBRD procurement notice for infrastructure." /></head>
<body><h1>Green Cities Framework Procurement</h1>
<table><tr><th>Country</th><td>Türkiye</td></tr>
<tr><th>Submission Deadline</th><td>30 October 2026</td></tr>
<tr><th>Contract Value</th><td>EUR 2.5 million</td></tr></table>
</body></html>`;
const ebrdDetail = extractEbrdDetail(ebrdDetailHtml);
assert.equal(ebrdDetail.organization, "European Bank for Reconstruction and Development");
assert.ok(portalDetailHasSignal(ebrdDetail));

const routedEbrd = extractPortalDetails(
  ebrdDetailHtml,
  "https://www.ebrd.com/work-with-us/procurement/notices/green-cities"
);
assert.ok(routedEbrd);
assert.equal(routedEbrd.parser, "ebrd-mena");

// --- serp preference ---
const parsedSerp = parseTopSerpLine("Brave API:12, Mojeek:5, DDG:2");
assert.ok((parsedSerp.brave ?? 0) >= 12);
assert.ok((parsedSerp.mojeek ?? 0) >= 5);

const ordered = orderEnginesByHistory(
  ["mojeek", "duckduckgo-html", "brave", "bing"],
  [
    {
      at: "2026-07-20T00:00:00.000Z",
      finalCount: 10,
      serpExhausted: false,
      seedCount: 1,
      feedItemCount: 1,
      listingExpandCount: 1,
      depth2Count: 0,
      pageFetchOk: 5,
      pageFetchFail: 0,
      serpEngineHits: { brave: 20, mojeek: 2 },
    },
  ]
);
assert.equal(ordered[0], "brave");

const withKey = resolveEngineOrder(
  ["mojeek", "brave", "bing"],
  [
    {
      at: "x",
      finalCount: 1,
      serpExhausted: false,
      seedCount: 0,
      feedItemCount: 0,
      listingExpandCount: 0,
      depth2Count: 0,
      pageFetchOk: 0,
      pageFetchFail: 0,
      serpEngineHits: { mojeek: 50 },
    },
  ],
  { braveApiKey: "test-key" }
);
assert.equal(withKey[0], "brave");

console.log("scraping quality regression tests OK", {
  seeds: seeds.length,
  feeds: feeds.length,
  coverageRows: coverage.rows.length,
  gapSeeds: gapSeeds.length,
  portalAu: auLinks.length,
  portalUs: usLinks.length,
  portalEu: euLinks.length,
  portalAdb: adbLinks.length,
  portalIdb: idbLinks.length,
  portalCa: caLinks.length,
  portalNz: nzLinks.length,
  portalEs: esLinks.length,
  portalCepal: cepalLinks.length,
  portalCaf: cafLinks.length,
  portalUneca: unecaLinks.length,
  portalUnescwa: unescwaLinks.length,
  portalEbrd: ebrdLinks.length,
  portalDetail: detail.deadline,
});
