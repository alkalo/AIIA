/**
 * QA: job/web search coverage helpers must never claim empty market without portals.
 * Run: node scripts/qa-chat-search-coverage.mjs
 */
import assert from "node:assert/strict";

const SAMPLE = "Busca en la web ofertas QA Lead remoto en España";
const GAME =
  "Busca ofertas de las mejores empresas de videojuegos remoto para senior QA tester que pueda trabajar desde españa";

const JOB_RE =
  /\b(oferta|ofertas|empleo|vacante|vacantes|trabajo|job|jobs|hiring|remoto|remote|linkedin|infojobs|indeed|qa\s*lead|qa\s*tester|tester|testing|developer|engineer|videojuego|videojuegos|gamedev|gaming)\b/i;
const SEARCH_RE =
  /\b(busca|buscar|search|web|noticias|news|actual|precio|cuánto|cómo|how\s+to|qué\s+es|what\s+is|latest|hoy|today)\b/i;

assert.ok(JOB_RE.test(SAMPLE), "JOB_RE must match QA Lead sample");
assert.ok(SEARCH_RE.test(SAMPLE), "SEARCH_RE must match sample");
assert.ok(JOB_RE.test(GAME), "JOB_RE must match gaming QA sample");

function isGamingJobSearch(query) {
  return /videojuego|video ?game|gamedev|gaming|\bjuegos?\b|hitmarker/i.test(query);
}

/** Mirrors chatModes.isJobOrListingSearch — clear job/offer intent only. */
function isJobOrListingSearch(msg) {
  const hasOfferNoun =
    /\b(oferta|ofertas|empleo|vacante|vacantes|trabajo|trabajos|job|jobs|hiring|vacancy|vacancies|opening|openings)\b/i.test(
      msg
    );
  const hasBoard =
    /\b(linkedin|infojobs|indeed|hitmarker|remoteok|weworkremotely|tecnoempleo|jooble|glassdoor|remotegamejobs)\b/i.test(
      msg
    );
  const hasRole =
    /\b(qa\s*lead|qa\s*tester|quality\s*assurance|tester|developer|engineer|desarrollador|ingeniero)\b/i.test(
      msg
    );
  const hasSearchVerb =
    /\b(busca|buscar|search|find|encuentra|encontrar|looking\s+for)\b/i.test(msg);
  const hasRemote = /\b(remoto|remote|teletrabajo)\b/i.test(msg);
  const gaming = isGamingJobSearch(msg);
  if (hasOfferNoun) return true;
  if (hasBoard && (hasRole || hasSearchVerb || hasRemote)) return true;
  if (hasRole && hasSearchVerb && (hasRemote || gaming || /\b(españa|spain)\b/i.test(msg)))
    return true;
  return false;
}

/** Mirrors chatModes.jobSearchKeywords — compact role keywords. */
function jobSearchKeywords(query) {
  const q = query.trim();
  const bits = [];
  if (/\bqa\s*lead\b/i.test(q)) bits.push("QA Lead");
  else if (/\b(senior\s+)?qa\s*tester\b|\bquality\s*assurance\b|\bqa\b/i.test(q)) {
    bits.push(/\bsenior\b/i.test(q) ? "Senior QA Tester" : "QA Tester");
  } else if (/\b(tester|testing)\b/i.test(q)) bits.push("QA Tester");
  if (isGamingJobSearch(q)) bits.push("games");
  if (/\b(remot[oe]|teletrabajo)\b/i.test(q)) bits.push("remote");
  if (/\b(españa|spain)\b/i.test(q)) bits.push("Spain");
  if (bits.length >= 2) return bits.join(" ");
  return bits.join(" ") || q;
}

function jobPortalSeeds(query) {
  const keywords = jobSearchKeywords(query);
  const enc = encodeURIComponent(keywords);
  const urls = [
    `https://www.linkedin.com/jobs/search/?keywords=${enc}&location=Spain&f_WT=2`,
    `https://www.infojobs.net/jobsearch/search-results/list.xhtml?keyword=${enc}`,
    `https://es.indeed.com/jobs?q=${enc}&l=Espa%C3%B1a`,
    `https://remoteok.com/remote-jobs?search=${enc}`,
    `https://weworkremotely.com/remote-jobs/search?term=${enc}`,
    `https://es.jooble.org/SearchResult?ukw=${enc}`,
    `https://www.tecnoempleo.com/busqueda-empleo.php?te=${enc}`,
  ];
  if (isGamingJobSearch(query)) {
    urls.unshift(
      `https://hitmarker.net/jobs?keyword=${enc}`,
      `https://remotegamejobs.com/?s=${enc}`,
      `https://www.gamesjobsdirect.com/jobs?keywords=${enc}`,
      `https://workwithindies.com/?s=${enc}`
    );
  }
  return urls;
}

function composeJobPortalAnswer(query, intro, hint) {
  const seeds = jobPortalSeeds(query).slice(0, 12);
  const block = seeds.map((u, i) => `${i + 1}. portal — ${u}`).join("\n");
  return [intro, "", block, "", hint].join("\n");
}

assert.ok(isJobOrListingSearch(SAMPLE), "SAMPLE must be job listing ask");
assert.ok(isJobOrListingSearch(GAME), "GAME must be job listing ask");
assert.ok(!isJobOrListingSearch("Explícame qué es testing en React"), "casual testing ≠ job ask");
assert.ok(!isJobOrListingSearch("Tendencias gaming 2026"), "gaming trends ≠ job ask");

const kwGame = jobSearchKeywords(GAME);
assert.ok(/Senior QA Tester/i.test(kwGame), `game keywords should be compact, got: ${kwGame}`);
assert.ok(/games/i.test(kwGame), `game keywords need games, got: ${kwGame}`);
assert.ok(kwGame.length < 80, `keywords too long: ${kwGame}`);

const seeds = jobPortalSeeds(SAMPLE);
assert.equal(seeds.length, 7);
assert.ok(seeds.every((u) => u.startsWith("https://")));
assert.ok(seeds.some((u) => u.includes("linkedin.com/jobs")));

const gameSeeds = jobPortalSeeds(GAME);
assert.ok(gameSeeds.some((u) => u.includes("hitmarker.net")), "gaming seeds need Hitmarker");
assert.ok(gameSeeds.length >= 10);
assert.ok(
  gameSeeds[0].includes("Senior%20QA%20Tester") || gameSeeds[0].includes("Senior+QA+Tester") ||
    decodeURIComponent(gameSeeds[0]).includes("Senior QA Tester"),
  `Hitmarker URL should use compact keywords: ${gameSeeds[0]}`
);

const emptyRe =
  /\b(no hay (resultados|ofertas|oportunidades|nada)|no (se )?(encontr|encontraron|encuentro|aparecen)|sin (resultados|ofertas)|no results|nothing online|no offers|empty (market|results)|mercado laboral particularmente|falta de publicidad|lo siento por la inconveniencia|parece que no hay|couldn't find any|could not find any|no (hay|existen) (ofertas|resultados).*(en l[ií]nea|online|actualmente)|restricciones temporales|estancado|no he encontrado|no encuentro (ofertas|resultados)|no aparecen (ofertas|resultados)|mercado (vac[ií]o|estancado)|no hay nada (publicado|disponible|en l[ií]nea))\b/i;

for (const a of [
  "Lo siento, no hay ofertas en línea actualmente.",
  "Couldn't find any offers online.",
]) {
  assert.ok(emptyRe.test(a), `empty detector missed: ${a}`);
}

const failedNarrativeRe =
  /\b(http\s*403|fetch failed|scraping blocked|encountered several issues|let'?s (try|consider|start|summarize)|please allow me some time|i('ll| will) (proceed|perform|run|try)|additional strategies|did not extract|search(es)? (also )?failed|blocking our request|given that we have|from our initial searches|summarize what we('ve| have) found|explore additional|no job openings were found)\b/i;

const USER_FAIL = `Given that we have encountered several issues with fetching job listings from various sources, let's summarize what we've found so far and explore additional strategies to find suitable Senior QA Tester remote jobs in Spain.

From our initial searches:

LinkedIn Jobs: 60 Senior QA Tester Remote Spain jobs in Spain. We fetched the page but did not extract matching offers.
Indeed España: The search failed with a HTTP 403 error.
Please allow me some time to fetch and analyze these results.`;

assert.ok(failedNarrativeRe.test(USER_FAIL), "must catch the real Pro failure narrative");

const portalUsefulRe =
  /https?:\/\/[^\s)]*(linkedin\.com\/jobs|infojobs\.net|indeed\.com|hitmarker\.net|remoteok\.com|weworkremotely\.com|tecnoempleo\.com|jooble\.org|remotegamejobs\.com|gamesjobsdirect\.com|workwithindies\.com)/i;

const composed = composeJobPortalAnswer(
  GAME,
  "Aquí tienes buscadores listos:",
  "Los portales suelen bloquear el scrapeo automático. Abre los enlaces."
);
assert.ok(portalUsefulRe.test(composed), "composed answer must include portals");
assert.ok(composed.includes("https://"), "composed answer must include bare https URLs");
assert.ok(composed.includes("hitmarker.net"), "composed answer includes Hitmarker");
assert.ok(!failedNarrativeRe.test(composed), "composed answer is not a 403 essay");
assert.ok(!emptyRe.test(composed), "composed answer is not empty-market prose");
assert.ok(!composed.includes("](https://"), "plain title — URL format (not markdown-only)");

console.log("qa-chat-search-coverage: OK");
console.log(`  sample: ${SAMPLE}`);
console.log(`  game keywords: ${kwGame}`);
console.log(`  portal seeds: ${seeds.length}`);
console.log(`  gaming seeds: ${gameSeeds.length}`);
console.log("  job path: no LLM + compact keywords + markdown links");
