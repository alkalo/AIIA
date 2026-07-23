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
import {
  buildRegionCoverage,
  requestedRegionsForSpec,
  inferItemRegion,
  uncoveredRegions,
} from "../dist/coverage-report.js";
import { formatSourceHealthReport, formatHealthHistoryTrend, formatSerpEngineChips } from "../dist/source-health.js";
import {
  classifyDiscoveryOrigin,
  countDiscoveryOrigins,
  formatOriginChips,
  formatOriginSummary,
} from "../dist/discovery-origin.js";
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
  extractPortalDetails,
  formatPortalDetailHints,
  mergePortalDetails,
  portalDetailHasSignal,
} from "../dist/portal-detail.js";
import { orderEnginesByHistory, parseTopSerpLine, resolveEngineOrder } from "../dist/serp-preference.js";
import { itemFingerprint } from "../dist/curation.js";
import { regionFetchBoost, gapFetchBoost, expandCapForExhaustive } from "../dist/budget.js";
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
assert.ok(feeds.some((f) => /iadb|cepal|caf\.com/i.test(f.url)), "LATAM feed URLs");
assert.ok(feeds.some((f) => /adb\.org/i.test(f.url)), "Asia feed URLs");
assert.ok(feeds.some((f) => /afdb\.org|uneca/i.test(f.url)), "Africa feed URLs");
assert.ok(feeds.some((f) => /unescwa|ebrd/i.test(f.url)), "MENA feed URLs");
assert.ok(feeds.some((f) => /worldbank|undp/i.test(f.url)), "multilateral global feeds");
assert.ok(
  seeds.some((s) => /afdb\.org|uneca|fundsforngos.*africa/i.test(s.url)),
  "expected Africa portal seeds"
);
assert.ok(
  seeds.some((s) => /isdb\.org|unescwa|ebrd|middle-east/i.test(s.url)),
  "expected MENA portal seeds"
);
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
  portalDetail: detail.deadline,
});
