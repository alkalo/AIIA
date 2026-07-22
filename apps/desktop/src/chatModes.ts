import { GEMINI_FLASH, GEMINI_PRO } from "@aiia/ollama-client/browser";

/** Chat thinking / research modes (local parity with ChatGPT-style effort).
 *
 * Ladder (each stronger than the previous; Local Ollama or Gemini):
 * - instant: seconds — answer now, almost no web
 * - eficaz: solid search + reading (budget ~5–20 min)
 * - pro: deep multi-query research (budget ~30–75 min)
 * - max: maximum search power (hard ceiling 3 h of tool loops)
 */

export type ChatModeId = "auto" | "instant" | "eficaz" | "pro" | "max";

export type ChatModeConfig = {
  id: Exclude<ChatModeId, "auto">;
  /** Ollama / Gemini sampling */
  temperature: number;
  numCtx: number;
  /** Tool loop */
  maxToolHops: number;
  /** Wall-clock budget for the tool loop (seconds). Hard stop when exceeded. */
  wallClockBudgetSec: number;
  searchLimit: number;
  /** Backend search depth: engines + query expansion */
  searchDepth: "instant" | "eficaz" | "pro" | "max";
  /** After web_search, fetch this many top URLs into the tool result */
  autoFetchTop: number;
  fetchChars: number;
  /** Extra system instructions (EN; model replies in user language) */
  systemAddon: string;
};

export const CHAT_MODE_STORAGE_KEY = "aiia-chat-mode";

const SEARCH_COVERAGE_RULES = `Coverage rules:
- Never say there are no online results after one thin/empty search.
- Never narrate HTTP 403 / fetch failures / "I'll search again" essays — give portal URLs instead.
- Keep issuing web_search with alternate queries (ES↔EN, synonyms, site:linkedin.com/jobs, site:hitmarker.net for games, remote vs remoto).
- Job boards often block bots; surfacing the search URL is a valid final answer.
- Answer with concrete titles + URLs. Do not invent offers. Reply in the user's language.`;

export const CHAT_MODES: Record<Exclude<ChatModeId, "auto">, ChatModeConfig> = {
  instant: {
    id: "instant",
    temperature: 0.55,
    numCtx: 4096,
    maxToolHops: 1,
    wallClockBudgetSec: 120,
    searchLimit: 4,
    searchDepth: "instant",
    autoFetchTop: 0,
    fetchChars: 4000,
    systemAddon: `MODE: Instant.
Answer in seconds. Be brief.
Prefer your knowledge when enough.
At most one web_search, and only if the user needs a fresh fact you clearly lack.
Do not fetch pages. No long essays.
If the user explicitly asks to search the web for jobs/listings, prefer Effective/Pro behavior instead of Instant.`,
  },
  eficaz: {
    id: "eficaz",
    temperature: 0.35,
    numCtx: 8192,
    maxToolHops: 12,
    wallClockBudgetSec: 1200,
    searchLimit: 16,
    searchDepth: "eficaz",
    autoFetchTop: 5,
    fetchChars: 12000,
    systemAddon: `MODE: Effective (eficaz) — spend several minutes researching when facts matter.
When the web is needed:
1) web_search with a clear query.
2) At least 2–3 complementary follow-up searches (different portals / languages / phrasings).
3) fetch_url on the most relevant pages before concluding.
Cite sources (title + URL).
${SEARCH_COVERAGE_RULES}`,
  },
  pro: {
    id: "pro",
    temperature: 0.25,
    numCtx: 16384,
    maxToolHops: 20,
    wallClockBudgetSec: 4500,
    searchLimit: 24,
    searchDepth: "pro",
    autoFetchTop: 8,
    fetchChars: 18000,
    systemAddon: `MODE: Pro (deep research).
Quality over speed. For any non-trivial or factual question:
1) Plan briefly what to verify / which portals to cover.
2) Run several complementary web_search queries (angles, synonyms, site: filters, locales).
3) fetch_url only on article/docs pages that are not anti-bot job boards. Job boards often return HTTP 403 — do NOT fetch them and do NOT narrate that failure.
4) Cross-check conflicting claims; say what is uncertain.
5) Deliver a structured answer with clear conclusions and a Sources section (title + URL). For job/offer searches, the deliverable is portal deep-links the user can open.
${SEARCH_COVERAGE_RULES}`,
  },
  max: {
    id: "max",
    temperature: 0.15,
    numCtx: 16384,
    maxToolHops: 40,
    wallClockBudgetSec: 14400,
    searchLimit: 36,
    searchDepth: "max",
    autoFetchTop: 14,
    fetchChars: 24000,
    systemAddon: `MODE: Max (maximum search power — hard ceiling 3 hours of tool work).
You are a relentless research agent. Exhaust relevant coverage before answering:
1) Break the goal into sub-questions and coverage criteria (portals, geographies, synonyms).
2) Run many complementary web_search queries across engines/angles.
3) fetch_url on article/docs pages only — never on anti-bot job boards (LinkedIn/Indeed/Hitmarker/etc.). Do not narrate HTTP 403.
4) Keep searching until gaps are closed or diminishing returns are clear.
5) Cross-check claims; note conflicts and confidence.
6) Produce a structured report with Sources (title + URL). For job/offer searches, portal deep-links are the deliverable.
${SEARCH_COVERAGE_RULES}`,
  },
};

const MAX_RE =
  /\b(exhaustiv|máxim[oa]|maximo|maximum|a\s+fondo|en\s+profundidad|deep\s+dive|todo\s+lo\s+posible|leave\s+no\s+stone)\b/i;
const RESEARCH_RE =
  /\b(investiga|investigación|research|compara|comparar|analiza|análisis|analysis|profund|fuentes|sources|informe|report|vs\.?|versus)\b/i;
const SEARCH_RE =
  /\b(busca|buscar|search|web|noticias|news|actual|precio|cuánto|cómo|how\s+to|qué\s+es|what\s+is|latest|hoy|today)\b/i;
const JOB_RE =
  /\b(oferta|ofertas|empleo|vacante|vacantes|trabajo|job|jobs|hiring|remoto|remote|linkedin|infojobs|indeed|qa\s*lead|qa\s*tester|tester|testing|developer|engineer|videojuego|videojuegos|gamedev|gaming)\b/i;

/** Resolve Auto → concrete mode from the user message. */
export function resolveChatMode(selected: ChatModeId, userMessage: string): ChatModeConfig {
  if (selected !== "auto") return CHAT_MODES[selected];

  const msg = userMessage.trim();
  if (MAX_RE.test(msg) || msg.length > 600) return CHAT_MODES.max;
  // Job / listing searches need deep multi-portal coverage by default.
  if (JOB_RE.test(msg) && SEARCH_RE.test(msg)) return CHAT_MODES.pro;
  if (JOB_RE.test(msg)) return CHAT_MODES.pro;
  if (RESEARCH_RE.test(msg) || msg.length > 380) return CHAT_MODES.pro;
  if (SEARCH_RE.test(msg) || msg.length > 100 || /\?/.test(msg)) return CHAT_MODES.eficaz;
  return CHAT_MODES.instant;
}

/**
 * Force solid web coverage for job/listing/search asks even if the user left Instant selected.
 * Max stays Max; otherwise upgrade Instant/Eficaz → Pro.
 */
export function ensureSearchCoverageMode(selected: ChatModeId, userMessage: string): ChatModeConfig {
  const msg = userMessage.trim();
  const needsCoverage =
    JOB_RE.test(msg) || SEARCH_RE.test(msg) || isRealEstateListingSearch(msg);
  const resolved = resolveChatMode(selected, msg);
  if (!needsCoverage) return resolved;
  if (selected === "max" || resolved.id === "max") return CHAT_MODES.max;
  if (resolved.id === "pro") return CHAT_MODES.pro;
  // Property searches benefit from Max-level time when Auto/Instant.
  if (isRealEstateListingSearch(msg) && selected === "auto") return CHAT_MODES.max;
  return CHAT_MODES.pro;
}

export function messageRequiresWebSearch(userMessage: string): boolean {
  const msg = userMessage.trim();
  return JOB_RE.test(msg) || SEARCH_RE.test(msg) || isRealEstateListingSearch(msg);
}

export function loadStoredChatMode(): ChatModeId {
  try {
    const v = localStorage.getItem(CHAT_MODE_STORAGE_KEY);
    if (v === "auto" || v === "instant" || v === "eficaz" || v === "pro" || v === "max") return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

/** Display Gemini model for a selected chat mode (Auto → Flash until send resolves). */
export function geminiModelForChatMode(mode: ChatModeId): string {
  if (mode === "pro" || mode === "max") return GEMINI_PRO;
  return GEMINI_FLASH;
}

/** Alternate queries when the first web_search is empty/thin. */
export function expandWebSearchQueries(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const alts = [
    q,
    `${q} site:linkedin.com/jobs`,
    `${q} site:infojobs.net`,
    `${q} site:indeed.com`,
    q
      .replace(/ofertas?/gi, "jobs")
      .replace(/remoto/gi, "remote")
      .replace(/España/gi, "Spain")
      .replace(/busca(r)? en la web/gi, "")
      .replace(/busca(r)?/gi, "")
      .replace(/mejores empresas/gi, "")
      .trim(),
  ];
  if (/qa/i.test(q)) {
    alts.push('"Senior QA" OR "QA Tester" OR "Quality Assurance" remote Spain');
    alts.push("Senior QA Tester remote Spain games OR video games");
    alts.push("QA tester video games remote Europe Spain");
  }
  if (/videojuego|video ?game|gamedev|gaming|juego/i.test(q)) {
    alts.push("Senior QA tester games remote site:hitmarker.net");
    alts.push("QA tester remote game jobs Spain OR Europe");
    alts.push("site:remotegamejobs.com QA tester");
  }
  const seen = new Set<string>();
  return alts
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => {
      const k = s.toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** Keywords for deep-link job portals (compact role + domain — not the full sentence). */
export function jobSearchKeywords(query: string): string {
  const q = query.trim();
  const bits: string[] = [];

  if (/\bqa\s*lead\b/i.test(q)) bits.push("QA Lead");
  else if (/\b(senior\s+)?qa\s*tester\b|\bquality\s*assurance\b|\bqa\b/i.test(q)) {
    bits.push(/\bsenior\b/i.test(q) ? "Senior QA Tester" : "QA Tester");
  } else if (/\b(tester|testing)\b/i.test(q)) bits.push("QA Tester");

  if (/\b(developer|desarrollador)\b/i.test(q)) bits.push("Developer");
  if (/\b(engineer|ingeniero)\b/i.test(q)) bits.push("Engineer");

  if (isGamingJobSearch(q)) bits.push("games");

  if (/\b(remot[oe]|teletrabajo)\b/i.test(q)) bits.push("remote");
  if (/\b(españa|spain)\b/i.test(q)) bits.push("Spain");

  if (bits.length >= 2) return bits.join(" ");

  // Fallback: strip filler words from the raw query.
  const cleaned = q
    .replace(/busca(r)?(\s+en\s+la\s+web)?/gi, "")
    .replace(/\b(ofertas?|empleo|jobs?|vacantes?|trabajos?|hiring|mejores|empresas|de|las|los|para|que|pueda|trabajar|desde|en|la|el|un|una|find|search|web)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || bits.join(" ") || q;
}

export function isGamingJobSearch(query: string): boolean {
  return /videojuego|video ?game|gamedev|gaming|\bjuegos?\b|hitmarker|unity|unreal/i.test(
    query
  );
}

/**
 * Local portal seeds — last-resort coverage if backend SERP/seeds fail.
 * Includes gaming boards when the query is game-industry related.
 */
export function jobPortalSeeds(
  query: string
): { title: string; url: string; snippet: string }[] {
  const keywords = jobSearchKeywords(query);
  const enc = encodeURIComponent(keywords);
  const encQa = encodeURIComponent(
    /qa|tester|test/i.test(keywords) ? keywords : `${keywords} QA tester`
  );
  const encEs = encodeURIComponent(
    keywords.replace(/\bremote\b/gi, "remoto").replace(/\bSpain\b/gi, "España")
  );
  const seeds: { title: string; url: string; snippet: string }[] = [
    {
      title: `LinkedIn Jobs — ${keywords} (Spain · Remote)`,
      url: `https://www.linkedin.com/jobs/search/?keywords=${enc}&location=Spain&f_WT=2`,
      snippet: "Portal LinkedIn: open this search in your browser (login if needed).",
    },
    {
      title: `InfoJobs — ${keywords}`,
      url: `https://www.infojobs.net/jobsearch/search-results/list.xhtml?keyword=${encEs}`,
      snippet: "Portal InfoJobs España.",
    },
    {
      title: `Indeed España — ${keywords}`,
      url: `https://es.indeed.com/jobs?q=${enc}&l=Espa%C3%B1a`,
      snippet: "Portal Indeed España.",
    },
    {
      title: `Remote OK — ${keywords}`,
      url: `https://remoteok.com/remote-jobs?search=${enc}`,
      snippet: "Portal Remote OK (global remote).",
    },
    {
      title: `We Work Remotely — ${keywords}`,
      url: `https://weworkremotely.com/remote-jobs/search?term=${enc}`,
      snippet: "Portal We Work Remotely.",
    },
    {
      title: `Jooble España — ${keywords}`,
      url: `https://es.jooble.org/SearchResult?ukw=${enc}`,
      snippet: "Portal Jooble España.",
    },
    {
      title: `Tecnoempleo — ${keywords}`,
      url: `https://www.tecnoempleo.com/busqueda-empleo.php?te=${encEs}`,
      snippet: "Portal Tecnoempleo (IT Spain).",
    },
  ];
  if (isGamingJobSearch(query)) {
    seeds.unshift(
      {
        title: `Hitmarker — ${keywords}`,
        url: `https://hitmarker.net/jobs?keyword=${encQa}`,
        snippet: "Portal Hitmarker (games industry jobs).",
      },
      {
        title: `Remote Game Jobs — ${keywords}`,
        url: `https://remotegamejobs.com/?s=${encQa}`,
        snippet: "Portal Remote Game Jobs.",
      },
      {
        title: `Games Jobs Direct — ${keywords}`,
        url: `https://www.gamesjobsdirect.com/jobs?keywords=${encQa}`,
        snippet: "Portal Games Jobs Direct.",
      },
      {
        title: `Work With Indies — ${keywords}`,
        url: `https://workwithindies.com/?s=${encQa}`,
        snippet: "Portal Work With Indies.",
      }
    );
  }
  return seeds;
}

/**
 * True when the user is clearly looking for job/offer listings.
 * Narrower than JOB_RE (used for mode upgrades) so we don't skip the LLM
 * on casual mentions of "testing" / "gaming" / "remote".
 */
export function isJobOrListingSearch(userMessage: string): boolean {
  const msg = userMessage.trim();
  if (!msg) return false;
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

/** Detect false "empty market" answers that must be overridden with portal links. */
export function looksLikeEmptyMarketAnswer(text: string): boolean {
  return /\b(no hay (resultados|ofertas|oportunidades|nada)|no (se )?(encontr|encontraron|encuentro|aparecen)|sin (resultados|ofertas)|no results|nothing online|no offers|empty (market|results)|mercado laboral particularmente|falta de publicidad|lo siento por la inconveniencia|parece que no hay|couldn't find any|could not find any|no (hay|existen) (ofertas|resultados).*(en l[ií]nea|online|actualmente)|restricciones temporales|estancado|no he encontrado|no encuentro (ofertas|resultados)|no aparecen (ofertas|resultados)|mercado (vac[ií]o|estancado)|no hay nada (publicado|disponible|en l[ií]nea))\b/i.test(
    text
  );
}

/**
 * Detect meta "search failed / 403 / I'll try again" answers that never deliver usable portals.
 * These must be replaced with portal deep-links.
 */
export function looksLikeFailedSearchNarrative(text: string): boolean {
  return /\b(http\s*403|fetch failed|scraping blocked|encountered several issues|let'?s (try|consider|start|summarize)|please allow me some time|i('ll| will) (proceed|perform|run|try)|additional strategies|did not extract|search(es)? (also )?failed|blocking our request|given that we have|from our initial searches|summarize what we('ve| have) found|explore additional|no job openings were found|veamos (otras|estrategias)|hemos (encontrado|tenido) (varios|problemas)|permit(e|ame).{0,40}tiempo|estrategias (adicionales|siguientes)|voy a (realizar|hacer|probar)|otra (búsqueda|busqueda)|varios (problemas|errores|fallos) (al|con)|no (pude|pudimos) (extraer|obtener|scrapear))\b/i.test(
    text
  );
}

/** True if the answer already lists real job-board / portal deep links. */
export function hasUsefulPortalLinks(text: string): boolean {
  return /https?:\/\/[^\s)]*(linkedin\.com\/jobs|infojobs\.net|indeed\.com|hitmarker\.net|remoteok\.com|weworkremotely\.com|tecnoempleo\.com|jooble\.org|remotegamejobs\.com|gamesjobsdirect\.com|workwithindies\.com|glassdoor\.com)/i.test(
    text
  );
}

/** Job boards that almost always block headless fetch — never auto-fetch these. */
export function isAntiBotJobBoard(url: string): boolean {
  return /linkedin\.com|indeed\.com|infojobs\.net|remoteok\.com|weworkremotely\.com|jooble\.org|tecnoempleo\.com|glassdoor\.com|hitmarker\.net|remotegamejobs\.com|gamesjobsdirect\.com|workwithindies\.com/i.test(
    url
  );
}

/** Property portals that often block headless fetch. */
export function isAntiBotPropertyPortal(url: string): boolean {
  return /idealista\.com|fotocasa\.es|habitaclia\.com|milanuncios\.com|pisos\.com|yaencontre\.com|indomio\.es/i.test(
    url
  );
}

export function isRealEstateListingSearch(userMessage: string): boolean {
  const msg = userMessage.trim();
  if (!msg) return false;
  const hasProperty =
    /\b(casa|casas|piso|pisos|chalet|chalets|mas[ií]a|masias|vivienda|viviendas|inmueble|inmobiliari|reformar|reforma|rehabilit)\b/i.test(
      msg
    );
  const hasPortal = /\b(idealista|fotocasa|habitaclia|milanuncios|pisos\.com|yaencontre)\b/i.test(msg);
  const hasZone =
    /\b(alt\s*camp|baix\s*camp|pened[eè]s|tarragona|barcelona|catalu[nñ]a|comarca|madrid|valencia)\b/i.test(
      msg
    );
  return (hasProperty && (hasZone || /busca|buscar|anuncio|listado|venta|comprar/i.test(msg))) || hasPortal;
}

export function realEstatePortalSeeds(
  query: string
): { title: string; url: string; snippet: string }[] {
  const enc = encodeURIComponent(query.slice(0, 80));
  const zones = [
    { label: "Alt Camp", slug: "alt-camp-tarragona" },
    { label: "Baix Camp", slug: "baix-camp-tarragona" },
    { label: "Alt Penedès", slug: "alt-penedes-barcelona" },
    { label: "Baix Penedès", slug: "baix-penedes-tarragona" },
  ].filter((z) => new RegExp(z.label.replace(/\s+/g, "\\s*"), "i").test(query));
  const use = zones.length > 0 ? zones : [{ label: "España", slug: "" }];
  const seeds: { title: string; url: string; snippet: string }[] = [];
  for (const z of use.slice(0, 4)) {
    if (z.slug) {
      seeds.push({
        title: `Idealista — ${z.label}`,
        url: `https://www.idealista.com/venta-viviendas/${z.slug}/`,
        snippet: "Portal Idealista zone search.",
      });
      seeds.push({
        title: `Fotocasa — ${z.label}`,
        url: `https://www.fotocasa.es/es/comprar/viviendas/${encodeURIComponent(z.label.toLowerCase())}/todas-las-zonas/l`,
        snippet: "Portal Fotocasa zone search.",
      });
    }
  }
  seeds.push(
    {
      title: `Idealista — buscar: ${query.slice(0, 40)}`,
      url: `https://www.idealista.com/buscar/venta-viviendas/${enc}/`,
      snippet: "Portal Idealista keyword search.",
    },
    {
      title: "Habitaclia",
      url: `https://www.habitaclia.com/viviendas.htm?texto=${enc}`,
      snippet: "Portal Habitaclia.",
    },
    {
      title: "Milanuncios inmobiliaria",
      url: `https://www.milanuncios.com/inmobiliaria/?q=${enc}`,
      snippet: "Portal Milanuncios.",
    }
  );
  return seeds;
}

export function composeRealEstatePortalAnswer(
  query: string,
  intro: string,
  hint: string,
  limit = 12
): string {
  const seeds = realEstatePortalSeeds(query).slice(0, limit);
  const block = seeds.map((h, i) => `${i + 1}. ${h.title} — ${h.url}`).join("\n");
  return [intro, "", block, "", hint].join("\n");
}

/** Merge portal seeds into a hit list (deduped by URL). */
export function mergeJobPortalSeeds(
  hits: { title: string; url: string; snippet: string }[],
  query: string
): { title: string; url: string; snippet: string }[] {
  if (!query.trim() || !isJobOrListingSearch(query)) return hits;
  const out = [...hits];
  const seen = new Set(out.map((h) => h.url.toLowerCase()));
  for (const s of jobPortalSeeds(query)) {
    const key = s.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * Deterministic job-search answer: portal deep-links only.
 * Never depends on the LLM (avoids HTTP 403 / "strategies" essays).
 * Plain "title + URL" lines (not only markdown) so links always render/copy.
 */
export function composeJobPortalAnswer(
  query: string,
  intro: string,
  hint: string,
  extraHits: { title: string; url: string; snippet: string }[] = [],
  limit = 12
): string {
  const hits = preferPortalUrls(mergeJobPortalSeeds(extraHits, query)).slice(0, limit);
  const seeds = hits.length ? hits : jobPortalSeeds(query).slice(0, limit);
  const block = seeds
    .map((h, i) => `${i + 1}. ${h.title} — ${h.url}`)
    .join("\n");
  return [intro, "", block, "", hint].join("\n");
}

function preferPortalUrls<T extends { url: string }>(hits: T[]): T[] {
  const score = (u: string) =>
    /hitmarker\.net|remotegamejobs\.com|gamesjobsdirect\.com|workwithindies\.com|linkedin\.com\/jobs|infojobs\.net|indeed\.com|remoteok\.com|weworkremotely\.com|jooble\.org|tecnoempleo\.com|glassdoor\.com/i.test(
      u
    )
      ? 0
      : 1;
  return [...hits].sort((a, b) => score(a.url) - score(b.url));
}
