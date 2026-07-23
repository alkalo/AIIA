import assert from "node:assert/strict";
import {
  applyCurationPipeline,
  itemFingerprint,
  shouldExcludeOpportunity,
  shouldExcludeNews,
} from "../dist/curation.js";

const baseSpec = {
  id: "t1",
  version: 1,
  name: "Opp",
  prompt: "Australia social enterprise opportunities",
  opportunitySubtype: "grants",
  contentMode: "opportunities",
  search: { queries: ["grant"], sources: [{ type: "duckduckgo" }] },
  filters: { criteria: "AU", minScore: 50, requireVerification: true, minDaysRemaining: 7 },
  output: { schema: ["title"], destinations: ["inbox"] },
  schedule: { intervalMinutes: 1440, onlyWhenRunning: true },
  effort: "high",
  retentionDays: 90,
  status: "published",
};

const future = new Date();
future.setDate(future.getDate() + 30);
const deadline = future.toISOString().slice(0, 10);

const good = {
  title: "Community Impact Grant",
  organization: "Example Foundation",
  program_name: "Community Impact Grant",
  url: "https://example.org/grants/community-impact-2026",
  deadline,
  max_funding: "50000",
  score: 70,
};

const expired = {
  ...good,
  program_name: "Old Grant",
  url: "https://example.org/grants/old",
  deadline: "2020-01-01",
};

const jobby = {
  title: "We're hiring a developer",
  url: "https://example.org/jobs/dev",
  description: "Full-time role salary range apply for this job",
  score: 80,
};

assert.equal(shouldExcludeOpportunity(expired, baseSpec), "expired");
assert.equal(shouldExcludeOpportunity(jobby, baseSpec), "looks_like_job");
assert.equal(shouldExcludeOpportunity(good, baseSpec), null);

const staleNews = {
  title: "Old sector story about impact",
  url: "https://news.example/article",
  publication_date: "2020-01-01",
  item_kind: "news",
};
assert.equal(shouldExcludeNews(staleNews, { ...baseSpec, opportunitySubtype: "sector_news" }), "stale_news");

const { kept, dropped } = applyCurationPipeline(
  [good, expired, jobby, { ...good, url: good.url + "?utm_source=x" }],
  baseSpec
);
assert.ok(kept.length >= 1);
assert.ok(dropped.some((d) => d.reason === "expired" || d.reason === "duplicate" || d.reason === "looks_like_job"));
assert.ok(itemFingerprint(good).includes("example.org"));

console.log("curation tests OK", { kept: kept.length, dropped: dropped.length });
