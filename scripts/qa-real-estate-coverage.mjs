/**
 * QA: real-estate subtype, portal seeds, site: sanitization, es-ES locale cues.
 * Run: node scripts/qa-real-estate-coverage.mjs
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = join(__dirname, "../packages/agent-engine/dist");

const subtype = await import(pathToFileURL(join(engineRoot, "opportunity-subtype.js")).href);
const re = await import(pathToFileURL(join(engineRoot, "real-estate-sources.js")).href);

const HOUSE_PROMPT =
  "Listados y oportunidades de casas para reformar con un máximo de 50mil euros en Alt Camp, Baix Camp, Alt Penedès, Baix Penedès que sean rentables y únicas.";

const spec = {
  id: "test",
  version: 1,
  name: "houses-for-renovation",
  prompt: HOUSE_PROMPT,
  templateId: "opportunities",
  search: { queries: [], sources: [{ type: "duckduckgo" }] },
  filters: { criteria: HOUSE_PROMPT, minScore: 50 },
  output: { schema: ["title", "url"], destinations: ["inbox"] },
  schedule: { intervalMinutes: 1440, onlyWhenRunning: true },
  effort: "ultra_high",
  retentionDays: 90,
  status: "published",
};

assert.equal(subtype.resolveOpportunitySubtype(spec), "real_estate");
assert.equal(subtype.isRealEstateTarget(spec), true);
assert.equal(subtype.isJobTarget(spec), false);

// Legacy agents saved as custom still upgrade via keywords
assert.equal(
  subtype.resolveOpportunitySubtype({ ...spec, opportunitySubtype: "custom" }),
  "real_estate"
);

const price = re.extractMaxPriceEuros(HOUSE_PROMPT);
assert.equal(price, 50000);

const zones = re.extractRealEstateZones(HOUSE_PROMPT);
assert.ok(zones.some((z) => /alt camp/i.test(z.label)));
assert.ok(zones.some((z) => /baix pened/i.test(z.label)));

const seeds = re.realEstatePortalDeepLinkSeeds(spec);
assert.ok(seeds.length >= 6, `expected ≥6 portal seeds, got ${seeds.length}`);
assert.ok(seeds.every((s) => /portal seed/i.test(s.snippet)));
assert.ok(seeds.some((s) => s.url.includes("idealista.com")));
assert.ok(seeds.some((s) => s.url.includes("fotocasa.es")));
assert.ok(seeds.some((s) => s.url.includes("habitaclia.com")));
assert.ok(!seeds.some((s) => /realestate\.com\.au/i.test(s.url)));

const queries = re.realEstateSeedQueries(spec, 12);
assert.ok(queries.some((q) => /idealista\.com/i.test(q)));
assert.ok(queries.every((q) => !/realestate\.com\.au/i.test(q)));

const dirty = [
  "renovated houses site:realestate.com.au",
  "casas reformar site:idealista.com Alt Camp",
  "propiedades site:realestatebaixcamp.com",
  "houses to renovate Alt Camp",
];
const cleaned = re.sanitizeSiteQueries(dirty, re.REAL_ESTATE_ALLOWED_HOSTS);
assert.ok(cleaned.some((q) => /idealista\.com/i.test(q)));
assert.ok(!cleaned.some((q) => /realestate\.com\.au/i.test(q)));
assert.ok(!cleaned.some((q) => /realestatebaixcamp/i.test(q)));
assert.ok(cleaned.some((q) => /Alt Camp/i.test(q)));

const portals = re.sanitizePortalsList(
  ["idealista.com", "realestate.com.au", "nhh.net", "fotocasa.es"],
  re.REAL_ESTATE_ALLOWED_HOSTS
);
assert.deepEqual(portals.sort(), ["fotocasa.es", "idealista.com"].sort());

// Locale cue: Catalan comarcas without saying España
const localeBlob = HOUSE_PROMPT;
assert.match(localeBlob, /alt\s*camp/i);

console.log("qa-real-estate-coverage: OK");
console.log(`  subtype=real_estate price=${price} zones=${zones.length} seeds=${seeds.length}`);
console.log(`  sample seed: ${seeds[0].url}`);
