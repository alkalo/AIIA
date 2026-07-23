import assert from "node:assert/strict";
import { isNewsletterWrapTarget } from "../dist/newsletter.js";
import {
  extractOpportunityDeepLinks,
  isExpandableListingPage,
} from "../dist/listing-expand.js";
import { shouldExcludeOpportunity } from "../dist/curation.js";
import { validateOpportunityResult } from "../dist/result-quality.js";
import { hasCoverageProvenance } from "../dist/coverage-markers.js";

const oppSpec = {
  id: "t1",
  version: 1,
  name: "Impact Opportunities Curator (AU)",
  prompt:
    "Discover and curate high-quality OPEN opportunities (Funding, Programs) for purpose-led / impact organisations in Australia. BFGN style quality.",
  opportunitySubtype: "grants",
  contentMode: "opportunities",
  search: { queries: ["grant"], sources: [{ type: "duckduckgo" }] },
  filters: { criteria: "AU impact", minScore: 50, requireVerification: true, minDaysRemaining: 7 },
  output: { schema: ["title"], destinations: ["inbox"] },
  schedule: { intervalMinutes: 1440, onlyWhenRunning: true },
  effort: "ultra_high",
  retentionDays: 90,
  status: "published",
};

assert.equal(isNewsletterWrapTarget(oppSpec), false, "opp curator must not be wrap");

const impactNewsOnly = {
  ...oppSpec,
  contentMode: "auto",
  name: "Sector watcher",
  prompt: "Track impact news about social enterprise in Australia",
  opportunitySubtype: "sector_news",
};
assert.equal(
  isNewsletterWrapTarget(impactNewsOnly),
  false,
  "impact news alone must not be wrap"
);

const wrapSpec = {
  ...oppSpec,
  contentMode: "wrap",
  name: "Monthly wrap-up",
  prompt: "Write a newsletter wrap-up with grants and impact news",
  output: { schema: ["title"], destinations: ["email", "inbox"] },
};
assert.equal(isNewsletterWrapTarget(wrapSpec), true, "explicit wrap must match");

const html = [
  "<html><body>",
  '<a href="/Go/Show?GoUuid=abc-123" title="Community Wellbeing Grant 2026">Wellbeing</a>',
  '<a href="https://www.grants.gov.au/Go/Show?GoUuid=def-456">Regional Fund</a>',
  '<a href="/about">About</a>',
  '<a href="/">Home</a>',
  "</body></html>",
  "",
  "__AIIA_ANCHORS__",
  '<a href="https://www.grants.gov.au/Go/Show?GoUuid=from-fetch" title="From Playwright">From Playwright</a>',
].join("\n");
const page = "https://www.grants.gov.au/Go/List";
assert.equal(isExpandableListingPage(page, html), true);
const links = extractOpportunityDeepLinks(html, page, 10);
assert.ok(links.length >= 3, `expected deep links incl. fetch markup, got ${links.length}`);
assert.ok(links.every((l) => /GoUuid|Go\/Show/i.test(l.url)));

assert.equal(
  isExpandableListingPage("https://probonoaustralia.com.au/news/", "<html>" + "x".repeat(2500)),
  true,
  "news hub should be expandable"
);
const newsHtml = [
  "<html><body>",
  '<a href="/news/social-enterprise-wins-grant-2026">Article one</a>',
  '<a href="/news/impact-investing-update">Article two</a>',
  '<a href="/about">About</a>',
  "</body></html>",
].join("\n");
const newsLinks = extractOpportunityDeepLinks(
  newsHtml,
  "https://probonoaustralia.com.au/news/",
  10
);
assert.ok(newsLinks.length >= 2, `expected news article deep links, got ${newsLinks.length}`);

const richNoDeadline = {
  title: "Community Impact Grant",
  organization: "Example Foundation",
  program_name: "Community Impact Grant",
  url: "https://www.grants.gov.au/Go/Show?GoUuid=abc-123",
  max_funding: "50000",
  score: 70,
};
assert.equal(
  shouldExcludeOpportunity(richNoDeadline, oppSpec),
  null,
  "rich official opp without deadline should keep"
);

const undatedDeep = {
  title: "Open Grant GoUuid",
  url: "https://www.grants.gov.au/Go/Show?GoUuid=abc-123",
  score: 60,
};
assert.equal(
  shouldExcludeOpportunity(undatedDeep, oppSpec),
  null,
  "direct grant URL without deadline must keep"
);

const portalSeed = {
  title: "GrantConnect list",
  url: "https://www.communitygrants.gov.au/grants",
  reason: "Portal coverage seed (SERP blocked)",
  description: "Portal seed: Australian Community Grants Hub listings.",
  score: 15,
};
assert.equal(shouldExcludeOpportunity(portalSeed, oppSpec), null, "portal seed must not weak_url");
assert.ok(hasCoverageProvenance(portalSeed.reason, portalSeed.description));
assert.equal(validateOpportunityResult(portalSeed, oppSpec), true, "portal seed validates");

const expandItem = {
  title: "Expanded GoShow",
  url: "https://www.grants.gov.au/Go/Show?GoUuid=zzz",
  reason: "Listing deep-link expand",
  description: "Listing deep-link expand from: https://www.grants.gov.au/Go/List",
  score: 78,
};
assert.equal(shouldExcludeOpportunity(expandItem, oppSpec), null, "expand undated must keep");
assert.equal(validateOpportunityResult(expandItem, oppSpec), true, "expand validates");

console.log("listing/wrap/curation soft tests OK", { links: links.length });
