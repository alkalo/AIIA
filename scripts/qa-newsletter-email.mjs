/**
 * QA: newsletter wrap + .eml draft export
 * Run: node scripts/qa-newsletter-email.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
    publication_date: "2026-06-20",
    url: "https://example.org/news",
    score: 75,
  },
];

const body = news.composeNewsletterWrap(items, spec, { monthLabel: "July 2026" });
assert.match(body, /FRRR Strengthening Rural Communities/);
assert.match(body, /Minderoo invests in Startmate/);
assert.match(body, /Open grants/);
assert.match(body, /Business for good news/);

const eml = news.buildEmlDraft({
  subject: "July wrap-up: Grants & impact news",
  body,
  to: "team@bfgn.example",
});
assert.match(eml, /To: team@bfgn.example/);
assert.match(eml, /Subject:/);
assert.match(eml, /Content-Type: text\/plain/);

const dir = await mkdtemp(join(tmpdir(), "aiia-news-"));
try {
  const paths = await exp.exportResults(items, spec, dir, "run-test");
  assert.ok(paths.newsletterPath);
  assert.ok(paths.emailPath);
  const emlDisk = await readFile(paths.emailPath, "utf8");
  assert.match(emlDisk, /team@bfgn.example/);
  const txt = await readFile(paths.newsletterPath, "utf8");
  assert.match(txt, /FRRR/);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log("qa-newsletter-email: OK");
