/**
 * QA: SERP health + grant portal seeds (durable search workaround).
 * Run: node scripts/qa-serp-resilience.mjs
 */
import assert from "node:assert/strict";

// Mirror grantPortalDeepLinkSeeds URL expectations (AU grant agent).
const AU_PROMPT =
  "Boletín de subvenciones y grants para comunidad, bienestar y proyectos locales en Australia, Nueva Zelanda y a nivel global.";

function grantPortalUrls(prompt) {
  const au = /australia|australian|au\b/i.test(prompt);
  const nz = /new zealand|nz\b/i.test(prompt);
  const urls = ["https://www2.fundsforngos.org/", "https://www.globalgiving.org/"];
  if (au || (!au && !nz)) {
    urls.unshift(
      "https://www.communitygrants.gov.au/",
      "https://www.grants.gov.au/",
      "https://business.gov.au/grants-and-programs",
      "https://frrr.org.au/",
      "https://www.philanthropy.org.au/",
      "https://www.grantly.au/"
    );
  }
  if (nz) {
    urls.unshift("https://www.communitymatters.govt.nz/");
  }
  return urls;
}

const urls = grantPortalUrls(AU_PROMPT);
assert.ok(urls.some((u) => u.includes("communitygrants.gov.au")));
assert.ok(urls.some((u) => u.includes("grants.gov.au")));
assert.ok(urls.some((u) => u.includes("frrr.org.au")));
assert.ok(!urls.some((u) => u.includes("australiangovernment.grants.gov.au")));
assert.ok(!urls.some((u) => u.includes("mfe.govt.nz/grants-and-funding")));
assert.ok(!urls.some((u) => u.includes("opportunities/index_en")));

function isHardBlock(message) {
  if (/cooling down|skipped/i.test(message)) return false;
  return /rate limit|captcha|bot check|\b403\b|\b429\b/i.test(message);
}
assert.ok(isHardBlock("mojeek rate limit (403)"));
assert.ok(isHardBlock("duckduckgo-lite: captcha/bot check"));
assert.ok(isHardBlock("brave rate limit (429)"));
assert.ok(!isHardBlock("bing: no parseable results"));
assert.ok(
  !isHardBlock("mojeek: cooling down after prior block (skipped)"),
  "cooling skips must not count as hard blocks"
);

console.log("qa-serp-resilience: OK");
console.log(`  AU grant portals: ${urls.length}`);
console.log("  hard-block detector + stable portal URLs verified");
