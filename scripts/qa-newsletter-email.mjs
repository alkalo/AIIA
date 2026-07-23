/**
 * QA: newsletter wrap (copy-paste only — no auto-send)
 * Run: node scripts/qa-newsletter-email.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(__dirname, "../packages/agent-engine/dist");

const news = await import(pathToFileURL(join(engineRoot, "newsletter.js")).href);
const exp = await import(pathToFileURL(join(engineRoot, "export.js")).href);

const spec = {
  id: "bfgn-wrap",
  version: 1,
  name: "BFGN Monthly Wrap",
  prompt: "Monthly wrap-up Grants & impact news BFGN Australia",
  opportunitySubtype: "grants",
  search: { queries: ["FRRR grant"], sources: [{ type: "duckduckgo" }] },
  filters: { criteria: "AU grants and impact news", minScore: 50 },
  output: {
    schema: ["title", "program_name", "max_funding", "url", "summary"],
    destinations: ["inbox", "email"],
    emailTo: "team@bfgn.example",
    notify: true,
  },
  schedule: { intervalMinutes: 43200, onlyWhenRunning: true, timezone: "Australia/Brisbane" },
  effort: "ultra_high",
  retentionDays: 90,
  status: "published",
};

assert.equal(news.isNewsletterWrapTarget(spec), true);

const items = [
  {
    program_name: "FRRR Strengthening Rural Communities",
    organization: "FRRR",
    max_funding: "Up to $50k",
    description: "Grassroots rural community initiatives",
    url: "https://frrr.org.au/example",
    score: 80,
  },
  {
    title: "Minderoo invests in Startmate",
    summary: "Up to $8 million over four years announced.",
    why_it_may_matter: "Supports female founders in VC.",
    source: "Minderoo Foundation",
    publication_date: new Date().toISOString().slice(0, 10),
    url: "https://example.org/news",
    score: 75,
  },
  {
    title: "Old news should drop",
    summary: "Stale",
    publication_date: "2020-01-01",
    url: "https://example.org/old",
    score: 40,
  },
];

assert.equal(news.isFreshEnough(items[2], 35), false);

const body = news.composeNewsletterWrap(items, spec, { monthLabel: "July 2026" });
assert.match(body, /FRRR Strengthening Rural Communities/);
assert.match(body, /Minderoo invests in Startmate/);
assert.doesNotMatch(body, /Old news should drop/);
assert.match(body, /DRAFT ONLY/);
assert.match(body, /never emails automatically/i);
assert.match(body, /Suggested To when you paste/);

const dir = await mkdtemp(join(tmpdir(), "aiia-news-"));
try {
  const paths = await exp.exportResults(items, spec, dir, "run-test");
  assert.ok(paths.newsletterPath);
  assert.equal(paths.emailPath, undefined);
  const txt = await readFile(paths.newsletterPath, "utf8");
  assert.match(txt, /FRRR/);
  assert.match(txt, /DRAFT ONLY/);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("qa-newsletter-email: OK");
