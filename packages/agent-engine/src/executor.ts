import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fetchPageContent,
  fetchFeed,
  fetchUrlAsSnippet,
  searchWeb,
  enginesForEffort,
  isHardBlockSearchError,
  resetSearchEngineHealth,
  msUntilEnginesReady,
  ENGINE_COOLDOWN_MS,
  stripLinkMarkup,
  type ScraperOptions,
  type SearchEngineId,
  type RunnableSearchEngineId,
} from "@aiia/scraper";
import {
  OllamaClient,
  detectHardware,
  EFFORT_CONFIGS,
  getResearchProfile,
  resolveModels,
  budgetPhase,
  budgetElapsedSec,
  shouldStopWaves,
  geminiModelsForEffort,
  GeminiClient,
  defaultLlmTimeoutMs,
  type EffortConfig,
  type EffortLevel,
  type ResearchProfile,
  type LlmClient,
  type BudgetPhase,
} from "@aiia/ollama-client";
import type { AgentSpec, ExtractedItem, ProgressEvent, SearchResult, LoginRequirement } from "./types.js";
import { resolveSearchLimits, perQueryLimit, type SearchLimits } from "./search-limits.js";
import { exportResults } from "./export.js";
import { buildContextBlock } from "./attachments.js";
import {
  broadenQueries,
  effectiveMinScore,
  heuristicItemScore,
} from "./search-quality.js";
import { serpToExtractedItems } from "./query-replan.js";
import { buildSearchPlan, analyzeCoverage, queriesFromPlan, type SearchPlan } from "./search-plan.js";
import { rankSources, sourcesToFetchDiverse, type RankedSource } from "./source-ranker.js";
import { fetchLimitForBudget, extractLimitForBudget, regionFetchBoost, gapFetchBoost, expandCapForExhaustive } from "./budget.js";
import { mapPool } from "./parallel.js";
import {
  LogAction,
  formatBulletList,
  truncate,
  truncateUrl,
  type ActionLogger,
} from "./run-logger.js";
import { coerceJsonArray, coerceJsonObject } from "./json-utils.js";

/** Prefer content window around price/m² markers on property pages (chrome-heavy portals). */
function sliceContentForExtract(
  content: string,
  maxChars: number,
  _url: string,
  spec: AgentSpec
): string {
  const cleaned = stripLinkMarkup(content);
  if (cleaned.length <= maxChars) return cleaned;
  if (!isRealEstateTarget(spec) && !isGrantTarget(spec) && !isCurationOpportunityTarget(spec)) {
    return cleaned.slice(0, maxChars);
  }
  const markers =
    /€|euros?|precio|m²|m2|habitaciones?|deadline|convocatoria|funding|subvenci|grant|fellowship|award/i;
  const idx = cleaned.search(markers);
  if (idx < 0) return cleaned.slice(0, maxChars);
  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, idx - half);
  return cleaned.slice(start, start + maxChars);
}
import {
  normalizeExtractedItem,
  validateOpportunityResult,
  isDirectGrantUrl,
  isLowQualityGrantUrl,
  resolveOpportunityUrl,
} from "./result-quality.js";
import { sectorExpansionQueries, jobPortalDeepLinkSeeds } from "./sector-sources.js";
import {
  grantExpansionQueries,
  grantSeedQueries,
  grantPortalDeepLinkSeeds,
  grantPortalSeedsForRegions,
} from "./grant-sources.js";
import { opportunityFeedsForSpec, prioritizeFeedsByRegions } from "./opportunity-feeds.js";
import {
  buildRegionCoverage,
  requestedRegionsForSpec,
  uncoveredRegions,
  inferItemRegion,
} from "./coverage-report.js";
import { isNewsletterWrapTarget } from "./newsletter.js";
import { flattenWrapLaneQueries } from "./wrap-lanes.js";
import { sectorNewsQueryPack, sectorNewsPortalSeeds } from "./news-sources.js";
import { opportunityDiscoveryQueries } from "./opportunity-lanes.js";
import { applyCurationPipeline, collectKnownFingerprints } from "./curation.js";
import {
  extractOpportunityDeepLinks,
  isExpandableListingPage,
  discoverListingPageUrls,
} from "./listing-expand.js";
import { hasCoverageProvenance } from "./coverage-markers.js";
import { canonicalUrl, opportunityContentKey } from "./canonical-url.js";
import {
  appendHealthHistory,
  formatHealthHistoryTrend,
  formatSourceHealthReport,
  readHealthHistory,
} from "./source-health.js";
import { countDiscoveryOrigins } from "./discovery-origin.js";
import {
  extractPortalDetails,
  formatPortalDetailHints,
  mergePortalDetails,
  portalDetailHasSignal,
} from "./portal-detail.js";
import { resolveEngineOrder } from "./serp-preference.js";
import {
  filterHealthyFeeds,
  formatFeedHealthSummary,
  noteFeedFailure,
  noteFeedSuccess,
  readFeedHealth,
} from "./feed-health.js";
import {
  applyHostHealthBoost,
  formatHostHealthBoostSummary,
  hostBoostMapFromHealth,
  normalizeHost,
  readHostHealth,
  updateHostHealth,
} from "./host-health.js";
import { readdir } from "node:fs/promises";
import {
  realEstateExpansionQueries,
  realEstateSeedQueries,
  realEstatePortalDeepLinkSeeds,
  sanitizeSiteQueries,
  sanitizePortalsList,
  REAL_ESTATE_ALLOWED_HOSTS,
  filterRealEstateHits,
  isBarePortalHomepage,
  isRelevantRealEstateHit,
} from "./real-estate-sources.js";
import {
  isGrantTarget,
  isJobTarget,
  isRealEstateTarget,
  isSectorNewsTarget,
  isCurationOpportunityTarget,
  isProgramsTarget,
  isAwardsTarget,
  isExposureTarget,
  resolveContentMode,
} from "./opportunity-subtype.js";
import { sortByDeadlineAsc } from "./deadline.js";

async function loadPriorFingerprints(dataDir: string, agentId: string): Promise<Set<string>> {
  const dir = join(dataDir, "inbox", agentId);
  const prior: ExtractedItem[] = [];
  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".json") || f.includes("-report")) continue;
      try {
        const raw = JSON.parse(await readFile(join(dir, f), "utf-8")) as {
          results?: ExtractedItem[];
        };
        if (Array.isArray(raw.results)) prior.push(...raw.results);
      } catch {
        /* skip bad file */
      }
    }
  } catch {
    /* no prior inbox */
  }
  return collectKnownFingerprints(prior, true);
}

const GRANT_WAVE_FALLBACKS = [
  "community grant australia open deadline",
  "frrr funding grant application australia",
  "new zealand community wellbeing grant",
  "global community wellbeing grant application",
  "site:communitygrants.gov.au grant open",
  "site:frrr.org.au funding grant",
  "site:grants.gov.au open grant community",
  "site:business.gov.au grants community wellbeing",
  "philanthropy australia community grant open",
  "new zealand lottery grants board community",
];

function heuristicCoverageQueries(
  spec: AgentSpec,
  usedQueries: Set<string>,
  count: number
): string[] {
  const fromGrant = grantExpansionQueries(spec, usedQueries, count);
  if (fromGrant.length > 0) return fromGrant;
  const fromRe = realEstateExpansionQueries(spec, usedQueries, count);
  if (fromRe.length > 0) return fromRe;
  if (isGrantTarget(spec)) {
    return GRANT_WAVE_FALLBACKS.filter((q) => !usedQueries.has(q.trim().toLowerCase())).slice(0, count);
  }
  return broadenQueries(
    spec.search.queries.length > 0 ? spec.search.queries : [spec.prompt.slice(0, 80)],
    spec.prompt,
    spec
  )
    .filter((q) => !usedQueries.has(q.trim().toLowerCase()))
    .slice(0, count);
}

function resolveWaveQueries(
  spec: AgentSpec,
  wave: number,
  queries: string[],
  pendingNewQueries: string[],
  usedQueries: Set<string>,
  perWaveTarget: number,
  longMode: boolean
): string[] {
  if (wave === 0) return queries;

  const fromCoverage = pendingNewQueries.filter((q) => !usedQueries.has(q.trim().toLowerCase()));
  const need = Math.max(0, perWaveTarget - fromCoverage.length);
  const sector = [
    ...sectorExpansionQueries(spec, usedQueries, need),
    ...grantExpansionQueries(spec, usedQueries, need),
    ...realEstateExpansionQueries(spec, usedQueries, need),
  ];
  let waveQueries = [...new Set([...fromCoverage, ...sector])];

  if (waveQueries.length === 0 && longMode) {
    waveQueries = broadenQueries(queries, spec.prompt, spec).filter(
      (q) => !usedQueries.has(q.trim().toLowerCase())
    );
  }
  if (waveQueries.length === 0 && isGrantTarget(spec)) {
    waveQueries = GRANT_WAVE_FALLBACKS.filter((q) => !usedQueries.has(q.trim().toLowerCase())).slice(
      0,
      perWaveTarget
    );
  }
  return waveQueries;
}

function shouldStopForEmptyWaves(
  longMode: boolean,
  emptyWaves: number,
  _startTime: number,
  _profile: ResearchProfile,
  rankedCount: number,
  _maxSources: number,
  serpExhausted = false,
  emptySerpWaves = 0
): boolean {
  // SERP blocked → stop immediately. Burning more waves while engines cool
  // finishes in milliseconds and looks like a "fast Max" with empty coverage.
  if (serpExhausted) return true;
  // Soft-dead SERP: allow more empty waves when we already have seeded coverage.
  const softDeadThreshold = rankedCount > 0 ? (longMode ? 8 : 3) : longMode ? 5 : 2;
  if (emptySerpWaves >= softDeadThreshold) return true;
  const threshold = rankedCount > 0 ? (longMode ? 10 : 3) : longMode ? 6 : 2;
  if (emptyWaves < threshold) return false;
  return true;
}

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Keep concrete opportunities that multipass wrongly scored near zero. */
function applyOpportunityScoreFloor(items: ExtractedItem[], spec: AgentSpec): ExtractedItem[] {
  if (!isGrantTarget(spec) && !isCurationOpportunityTarget(spec)) return items;
  return items.map((item) => {
    const program = String(item.program_name ?? item.title ?? "").trim();
    const org = String(item.organization ?? "").trim();
    const url = String(item.url ?? "").trim();
    const coverage = hasCoverageProvenance(
      item.reason,
      item.summary,
      item.description,
      item.snippet
    );
    const rich =
      Boolean(program) &&
      Boolean(
        org ||
          item.deadline ||
          item.max_funding ||
          item.value_or_benefit ||
          item.eligibility
      );
    if ((!rich && !coverage) || !url) return item;
    const score = Number(item.score ?? 0);
    const floor = coverage
      ? 55
      : isDirectGrantUrl(url)
        ? 58
        : isLowQualityGrantUrl(url)
          ? 42
          : 52;
    if (score >= floor) return item;
    return {
      ...item,
      score: floor,
      reason: item.reason
        ? `${item.reason} (floor ${floor})`
        : coverage
          ? `Coverage seed — score floor ${floor}`
          : `Concrete opportunity — score floor ${floor}`,
    };
  });
}

export type ProgressCallback = (event: ProgressEvent) => void;

export class Executor {
  private ollama: LlmClient;
  private plannerModel = "qwen2.5:7b";
  private extractorModel = "qwen2.5:3b";
  private criticModel?: string;
  private runLog?: ActionLogger;
  private searchLocale = "en-US";
  /** Optional Brave Search API key (from AIIA_BRAVE_SEARCH_API_KEY). */
  private braveApiKey = process.env.AIIA_BRAVE_SEARCH_API_KEY?.trim() || undefined;
  private runHealth = {
    seedCount: 0,
    feedItemCount: 0,
    listingExpandCount: 0,
    depth2Count: 0,
    pageFetchOk: 0,
    pageFetchFail: 0,
    gapFillCount: 0,
    portalParserCount: 0,
    portalDetailCount: 0,
    feedSkippedCount: 0,
    feedFailCount: 0,
  };

  constructor(ollama?: LlmClient) {
    this.ollama = ollama ?? new OllamaClient();
  }

  private initModels(effort: EffortLevel): EffortConfig {
    return EFFORT_CONFIGS[effort];
  }

  /** Descarga los modelos necesarios si no están presentes (auto-pull). */
  private async ensureModels(
    progress: (phase: ProgressEvent["phase"], percent: number, message: string, extra?: Partial<ProgressEvent>) => void,
    log: ActionLogger
  ): Promise<void> {
    const needed = [...new Set([this.plannerModel, this.extractorModel, this.criticModel].filter(Boolean) as string[])];
    let available: string[] = [];
    try {
      available = await this.ollama.listModels();
    } catch {
      return; // Ollama no disponible: el error se reportará al primer chat.
    }
    for (const model of needed) {
      const present = available.some((m) => m === model || m.startsWith(`${model}:`) || m === `${model}:latest`);
      if (present) continue;
      progress("planning", 2, `Descargando modelo ${model}… (una sola vez)`, { action: LogAction.INFO });
      log(LogAction.INFO, `Descargando modelo ${model} (una sola vez)`, "Puede tardar varios minutos la primera vez.", "planning");
      try {
        let lastPct = -1;
        await this.ollama.pullModel(model, (status) => {
          const pctMatch = /(\d+)%/.exec(status);
          const pct = pctMatch ? Number(pctMatch[1]) : -1;
          if (pct >= 0 && pct !== lastPct && pct % 10 === 0) {
            lastPct = pct;
            progress("planning", 2, `Descargando ${model}: ${pct}%`, { action: LogAction.INFO });
          }
        });
        log(LogAction.INFO, `Modelo ${model} listo`, undefined, "planning");
      } catch (err) {
        log(
          LogAction.INFO,
          `No se pudo descargar ${model}`,
          err instanceof Error ? err.message : String(err),
          "planning"
        );
      }
    }
  }

  async run(
    spec: AgentSpec,
    effort: EffortLevel,
    onProgress?: ProgressCallback,
    scraperOptions?: ScraperOptions
  ): Promise<{ results: ExtractedItem[]; summary: string }> {
    const hw = await detectHardware();
    const listed = await this.ollama.listModels().catch(() => [] as string[]);
    const usingGemini =
      this.ollama instanceof GeminiClient || listed.some((m) => m.startsWith("gemini"));
    if (usingGemini) {
      const models = geminiModelsForEffort(effort);
      this.plannerModel = models.plannerModel;
      this.extractorModel = models.extractorModel;
      this.criticModel = models.criticModel;
    } else {
      const models = resolveModels(hw, effort);
      this.plannerModel = models.plannerModel;
      this.extractorModel = models.extractorModel;
      this.criticModel = models.criticModel;
    }

    const cfg = this.initModels(effort);
    const profile = getResearchProfile(effort);
    const searchLimits = resolveSearchLimits(spec, effort);
    const maxSources = searchLimits.maxSources;
    const startTime = Date.now();
    let lastPercent = 0;
    // Fresh engine health per run so a prior blocked run does not poison this one.
    resetSearchEngineHealth();

    const progress = (
      phase: ProgressEvent["phase"],
      percent: number,
      message: string,
      extra?: Partial<ProgressEvent>
    ) => {
      lastPercent = Math.round(percent);
      const elapsed = budgetElapsedSec(startTime);
      const estimatedTotal = percent > 0 ? (elapsed / percent) * 100 : 0;
      onProgress?.({
        phase,
        percent: lastPercent,
        message,
        estimatedRemainingSec: Math.max(0, estimatedTotal - elapsed),
        budgetUsedSec: elapsed,
        ...extra,
      });
    };

    const log = (action: string, message: string, detail?: string, phase: ProgressEvent["phase"] = "thinking") => {
      const elapsed = budgetElapsedSec(startTime);
      onProgress?.({
        phase,
        percent: lastPercent,
        message,
        action,
        detail,
        budgetUsedSec: elapsed,
      });
    };
    this.runLog = log;

    const dataDir = process.env.AIIA_DATA_DIR ?? `${process.env.USERPROFILE ?? process.env.HOME}/AIIA`;
    const debugDir = join(dataDir, "logs", "search-debug");
    const sessions = await loadCredentialSessions(dataDir);
    this.runHealth = {
      seedCount: 0,
      feedItemCount: 0,
      listingExpandCount: 0,
      depth2Count: 0,
      pageFetchOk: 0,
      pageFetchFail: 0,
      gapFillCount: 0,
      portalParserCount: 0,
      portalDetailCount: 0,
      feedSkippedCount: 0,
      feedFailCount: 0,
    };
    let webEngines: RunnableSearchEngineId[] = enginesForEffort(effort);
    try {
      const hist = await readHealthHistory(dataDir, spec.id, 12);
      webEngines = resolveEngineOrder(webEngines, hist, {
        braveApiKey: this.braveApiKey,
      });
      if (hist.length > 0) {
        log(
          LogAction.INFO,
          "SERP: orden por historial del agente",
          webEngines.join(" → "),
          "planning"
        );
      }
    } catch {
      if (this.braveApiKey) {
        webEngines = ["brave", ...webEngines.filter((e) => e !== "brave")];
      }
    }
    if (this.braveApiKey && webEngines[0] !== "brave") {
      webEngines = ["brave", ...webEngines.filter((e) => e !== "brave")];
    }
    const engineTotals: Partial<Record<SearchEngineId, number>> = {};

    log(
      LogAction.INIT,
      "Configuración del agente",
      [
        `Agente: ${spec.name}`,
        `Modo: ${effort} · provider=${usingGemini ? "gemini" : "local"} · perfil ${hw.profile} · ${hw.cpuCores} núcleos · ${hw.totalRamGb} GB RAM`,
        `Modelos: plan=${this.plannerModel}, extract=${this.extractorModel}${this.criticModel ? `, critic=${this.criticModel}` : ""}`,
        `Estrategia: olas=${profile.searchWaves}, rank IA=${profile.llmRank ? "sí" : "no"}, fetch=${profile.fetchPolicy}, extract=${profile.extractPolicy}`,
        `Límite de enlaces: ${maxSources}${searchLimits.fromAgentConfig ? " (configurado en agente)" : ` (modo ${effort})`}`,
        `Motores web: ${webEngines.join(", ")}${this.braveApiKey ? " · Brave Search API activa" : ""}`,
        `Locale búsqueda: ${resolveSearchLocale(spec)}`,
        `Objetivo: ${truncate(spec.prompt, 200)}`,
      ].join("\n"),
      "planning"
    );

    await this.ensureModels(progress, log);

    progress("planning", 3, "Planificando estrategia de investigación…", {
      thinkingStep: profile.llmPlan ? "Analizando objetivo y tipos de fuente" : "Modo rápido — búsqueda directa",
      action: LogAction.LLM_PLAN,
    });

    let plan: SearchPlan = await buildSearchPlan(spec, profile, this.ollama, this.plannerModel, cfg.numCtx);
    if (isRealEstateTarget(spec)) {
      plan = {
        ...plan,
        portals: sanitizePortalsList(
          plan.portals.length > 0 ? plan.portals : [...REAL_ESTATE_ALLOWED_HOSTS],
          REAL_ESTATE_ALLOWED_HOSTS
        ),
      };
      if (plan.portals.length === 0) {
        plan = { ...plan, portals: [...REAL_ESTATE_ALLOWED_HOSTS] };
      }
    }
    let queries = queriesFromPlan(plan);
    if (isGrantTarget(spec)) {
      const grantSeeds = grantSeedQueries(spec, Math.max(10, cfg.queryExpansion + 4));
      queries = [...new Set([...grantSeeds, ...queries])].slice(0, Math.max(14, grantSeeds.length + 4));
    }
    if (isRealEstateTarget(spec)) {
      // Deterministic zone queries only — LLM mega-queries ("4 comarcas in one string")
      // make Bing return Madrid noise / unrelated pages.
      const reSeeds = realEstateSeedQueries(spec, Math.max(12, cfg.queryExpansion + 6));
      queries = sanitizeSiteQueries(reSeeds, REAL_ESTATE_ALLOWED_HOSTS);
    }
    if (isNewsletterWrapTarget(spec)) {
      // Studio-style lanes: grants/policy, social enterprise, NGO/philanthropy, ESG.
      const lanes = flattenWrapLaneQueries(spec.prompt, Math.max(20, cfg.queryExpansion + 12));
      queries = [...new Set([...lanes, ...queries])].slice(0, Math.max(24, lanes.length));
      log(
        LogAction.INFO,
        `Wrap multi-lane: ${lanes.length} consultas (grants / SE / NGO / ESG)`,
        undefined,
        "planning"
      );
    }
    if (isSectorNewsTarget(spec) && !isNewsletterWrapTarget(spec)) {
      const newsQ = sectorNewsQueryPack(spec.prompt, Math.max(16, cfg.queryExpansion + 8));
      queries = [...new Set([...newsQ, ...queries])].slice(0, Math.max(20, newsQ.length));
      log(LogAction.INFO, `Sector news: ${newsQ.length} consultas`, undefined, "planning");
    }
    if (isCurationOpportunityTarget(spec) && !isNewsletterWrapTarget(spec)) {
      const cat = isProgramsTarget(spec)
        ? "program_fellowship"
        : isAwardsTarget(spec)
          ? "award_competition"
          : isExposureTarget(spec)
            ? "exposure"
            : resolveContentMode(spec) === "opportunities"
              ? "all"
              : "funding";
      const oppQ = opportunityDiscoveryQueries(spec.prompt, cat, Math.max(18, cfg.queryExpansion + 10));
      queries = [...new Set([...oppQ, ...queries])].slice(0, Math.max(24, oppQ.length));
      log(
        LogAction.INFO,
        `Opportunity discovery (${cat}): ${oppQ.length} consultas`,
        undefined,
        "planning"
      );
    }

    const searchLocale = resolveSearchLocale(spec);
    this.searchLocale = searchLocale;

    const seedSources = await this.collectSeedSources(spec, log);
    // Always inject portal deep-links for jobs/grants/real-estate so a dead SERP cannot yield zero coverage.
    if (isJobTarget(spec) && !isGrantTarget(spec) && !isRealEstateTarget(spec)) {
      const portals = jobPortalDeepLinkSeeds(spec);
      for (const s of portals) {
        seedSources.push({ title: s.title, url: s.url, snippet: s.snippet });
      }
      if (portals.length > 0) {
        log(
          LogAction.WEB_SEARCH,
          `Semillas de portales de empleo: ${portals.length}`,
          undefined,
          "searching"
        );
      }
    }
    if (isGrantTarget(spec) || isCurationOpportunityTarget(spec)) {
      const portals = grantPortalDeepLinkSeeds(spec);
      for (const s of portals) {
        seedSources.push({ title: s.title, url: s.url, snippet: s.snippet });
      }
      this.runHealth.seedCount += portals.length;
      if (portals.length > 0) {
        log(
          LogAction.WEB_SEARCH,
          `Semillas de portales de grants/oportunidades: ${portals.length}`,
          portals.map((p) => `  → ${p.title} (${truncateUrl(p.url)})`).join("\n"),
          "searching"
        );
      }
    }
    if (isSectorNewsTarget(spec)) {
      const portals = sectorNewsPortalSeeds(spec.prompt || "");
      for (const s of portals) {
        seedSources.push({ title: s.title, url: s.url, snippet: s.snippet });
      }
      log(
        LogAction.WEB_SEARCH,
        `Semillas de portales de news: ${portals.length}`,
        portals.map((p) => `  → ${p.title} (${truncateUrl(p.url)})`).join("\n"),
        "searching"
      );
    }
    if (isRealEstateTarget(spec)) {
      const portals = realEstatePortalDeepLinkSeeds(spec);
      for (const s of portals) {
        seedSources.push({ title: s.title, url: s.url, snippet: s.snippet });
      }
      if (portals.length > 0) {
        log(
          LogAction.WEB_SEARCH,
          `Semillas de portales inmobiliarios: ${portals.length}`,
          portals.map((p) => `  → ${p.title} (${truncateUrl(p.url)})`).join("\n"),
          "searching"
        );
      }
    }

    // Official RSS/Atom feeds (soft-fail per feed) for grants / opportunities / news.
    if (
      isGrantTarget(spec) ||
      isCurationOpportunityTarget(spec) ||
      isSectorNewsTarget(spec)
    ) {
      let allFeeds = opportunityFeedsForSpec(spec);
      // Prefer feeds for regions that were gaps in recent runs.
      try {
        const hist = await readHealthHistory(dataDir, spec.id, 5);
        const preferGaps = new Set<string>();
        for (const e of hist) {
          for (const g of e.regionGaps ?? []) preferGaps.add(g);
        }
        if (preferGaps.size > 0) {
          allFeeds = prioritizeFeedsByRegions(allFeeds, preferGaps);
          log(
            LogAction.INFO,
            `Feeds priorizados por huecos históricos: ${[...preferGaps].slice(0, 6).join(", ")}`,
            undefined,
            "searching"
          );
        }
      } catch {
        /* soft-fail */
      }

      const feedHealth = await readFeedHealth(dataDir, spec.id).catch(() => null);
      const { active: feeds, skipped: skippedFeeds } = feedHealth
        ? filterHealthyFeeds(allFeeds, feedHealth)
        : { active: allFeeds, skipped: [] as typeof allFeeds };
      this.runHealth.feedSkippedCount = skippedFeeds.length;
      if (skippedFeeds.length > 0) {
        log(
          LogAction.INFO,
          `Feeds en cooldown: ${skippedFeeds.length} omitidos`,
          skippedFeeds.map((f) => `  → ${f.title}`).join("\n"),
          "searching"
        );
      }

      // Cap feeds per run; parallel fetch so more regions complete within wall-clock.
      const feedCap = Math.min(
        feeds.length,
        isGrantTarget(spec) || isCurationOpportunityTarget(spec) ? 28 : 16
      );
      const feedsToFetch = feeds.slice(0, feedCap);
      let feedHits = 0;
      const seenFeedUrls = new Set<string>();
      const feedResults = await mapPool(feedsToFetch, 4, async (feed) => {
        try {
          const items = await fetchFeed(feed.url, 25);
          await noteFeedSuccess(dataDir, spec.id, feed.url).catch(() => undefined);
          return { feed, items, error: null as string | null };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await noteFeedFailure(dataDir, spec.id, feed.url, msg).catch(() => undefined);
          return { feed, items: [] as Awaited<ReturnType<typeof fetchFeed>>, error: msg };
        }
      });

      for (const { feed, items, error } of feedResults) {
        if (error) {
          this.runHealth.feedFailCount += 1;
          log(
            LogAction.INFO,
            `Feed omitido: ${feed.title}`,
            truncate(error, 160),
            "searching"
          );
          continue;
        }
        for (const it of items) {
          if (!it.url || !/^https?:\/\//i.test(it.url)) continue;
          const key = canonicalUrl(it.url) || it.url.split("#")[0].toLowerCase();
          if (seenFeedUrls.has(key)) continue;
          seenFeedUrls.add(key);
          seedSources.push({
            title: it.title || feed.title,
            url: it.url,
            snippet: `RSS feed (${feed.region}): ${it.snippet || feed.title}`,
          });
          feedHits += 1;
        }
      }
      this.runHealth.feedItemCount += feedHits;
      if (feedHits > 0) {
        log(
          LogAction.WEB_SEARCH,
          `Feeds RSS/Atom: ${feedHits} items de ${feedsToFetch.length}/${feeds.length} feeds (paralelo×4)`,
          feedsToFetch
            .slice(0, 12)
            .map((f) => `  → [${f.region}] ${f.title}`)
            .join("\n"),
          "searching"
        );
      }
    }
    let rankedSources: RankedSource[] = seedSources.length
      ? await rankSources(
          dedupeHits(seedSources),
          spec,
          { ...profile, llmRank: false },
          maxSources,
          this.ollama,
          this.plannerModel,
          cfg.numCtx
        )
      : [];

    // Historical host productivity: boost portals that produced finals in prior runs.
    try {
      const hostFile = await readHostHealth(dataDir, spec.id);
      const hostBoosts = hostBoostMapFromHealth(hostFile);
      if (hostBoosts.size > 0 && rankedSources.length > 0) {
        rankedSources = applyHostHealthBoost(rankedSources, hostBoosts);
        log(
          LogAction.INFO,
          `Host-health: boost histórico (${hostBoosts.size} hosts)`,
          formatHostHealthBoostSummary(hostBoosts),
          "planning"
        );
      }
    } catch {
      /* soft-fail */
    }

    log(
      LogAction.LLM_PLAN,
      profile.llmPlan ? "Plan de búsqueda generado por IA" : "Plan heurístico (modo rápido)",
      [
        `Intención: ${plan.intent}`,
        `Tipos de fuente: ${plan.sourceTypes.join(", ") || "web"}`,
        plan.portals.length > 0 ? `Portales: ${plan.portals.join(", ")}` : "",
        plan.avoid.length > 0 ? `Evitar: ${plan.avoid.join(", ")}` : "",
        `Criterio de cobertura: ${truncate(plan.coverageCriteria, 160)}`,
        `Consultas (${queries.length}):`,
        formatBulletList(queries),
      ]
        .filter(Boolean)
        .join("\n"),
      "planning"
    );

    if (cfg.queryExpansion > 0 && profile.reasoningDepth >= 1) {
      if (isRealEstateTarget(spec)) {
        // Skip LLM expand — it invents "chalets renovables" / packs wrong cities.
        const more = realEstateExpansionQueries(
          spec,
          new Set(queries.map((q) => q.toLowerCase())),
          cfg.queryExpansion
        );
        if (more.length > 0) {
          log(
            LogAction.LLM_EXPAND,
            `${more.length} consultas inmobiliarias (deterministas)`,
            formatBulletList(more),
            "thinking"
          );
          queries = [...new Set([...queries, ...more])].slice(0, queries.length + cfg.queryExpansion);
        } else {
          log(LogAction.LLM_EXPAND, "Sin consultas adicionales (modo inmobiliario)", undefined, "thinking");
        }
      } else {
      progress("thinking", 6, "Ampliando consultas con IA…", { action: LogAction.LLM_EXPAND });
      const expanded = await this.expandQueries(spec, cfg, queries);
      const cleanedExpanded = expanded;
      if (cleanedExpanded.length > 0) {
        log(
          LogAction.LLM_EXPAND,
          `${cleanedExpanded.length} consultas nuevas generadas`,
          formatBulletList(cleanedExpanded),
          "thinking"
        );
      } else {
        log(LogAction.LLM_EXPAND, "Sin consultas adicionales", undefined, "thinking");
      }
      queries = [...new Set([...queries, ...cleanedExpanded])].slice(0, queries.length + cfg.queryExpansion);
      }
    }

    progress("planning", 8, `${queries.length} consultas · ${plan.sourceTypes.slice(0, 3).join(", ") || "web"}`);

    let wave = 0;
    const usedQueries = new Set<string>();
    let pendingNewQueries: string[] = [];
    let emptyWaves = 0;
    let emptySerpWaves = 0;
    let runSerpExhausted = false;
    let didSerpCooldownRecovery = false;
    // En modos largos buscamos muchas más consultas por ola y no paramos aunque
    // la cobertura se considere "suficiente": el objetivo es recorrer todas las
    // fuentes del sector hasta agotar el presupuesto de tiempo.
    const longMode = profile.searchWaves >= 8;
    const perWaveTarget = Math.max(cfg.queryExpansion, longMode ? 8 : 4);
    const registerUsed = (qs: string[]) =>
      qs.forEach((q) => usedQueries.add(q.trim().toLowerCase()));

    while (!shouldStopWaves(startTime, profile, wave)) {
      if (rankedSources.length >= maxSources) {
        progress("searching", 21, `Límite de ${maxSources} fuentes alcanzado`);
        break;
      }

      let waveQueries: string[];
      if (wave === 0) {
        waveQueries = queries;
      } else {
        waveQueries = resolveWaveQueries(
          spec,
          wave,
          queries,
          pendingNewQueries,
          usedQueries,
          perWaveTarget,
          longMode
        );
        pendingNewQueries = [];
      }

      if (waveQueries.length === 0) {
        if (longMode && !shouldStopWaves(startTime, profile, wave)) {
          log(
            LogAction.INFO,
            "Sin consultas nuevas — ampliando con fallback",
            undefined,
            "searching"
          );
          waveQueries = broadenQueries(queries, spec.prompt, spec)
            .filter((q) => !usedQueries.has(q.trim().toLowerCase()))
            .slice(0, perWaveTarget);
        }
        if (waveQueries.length === 0 && isGrantTarget(spec)) {
          waveQueries = GRANT_WAVE_FALLBACKS.filter(
            (q) => !usedQueries.has(q.trim().toLowerCase())
          ).slice(0, perWaveTarget);
        }
        if (waveQueries.length === 0) break;
      }
      registerUsed(waveQueries);

      if (wave > 0) {
        log(
          LogAction.WEB_SEARCH,
          `Ola ${wave + 1} — ${waveQueries.length} consultas (${rankedSources.length}/${maxSources} fuentes)`,
          formatBulletList(waveQueries),
          "searching"
        );
      }

      progress(
        "searching",
        Math.min(21, 10 + wave),
        wave === 0
          ? "Buscando fuentes…"
          : `Ola ${wave + 1}: ${rankedSources.length}/${maxSources} fuentes…`
      );

      const beforeCount = rankedSources.length;
      const collected = await this.collectSourcesParallel(
        spec,
        waveQueries,
        maxSources,
        cfg,
        sessions,
        scraperOptions,
        webEngines,
        debugDir,
        engineTotals,
        profile,
        progress,
        log,
        rankedSources,
        searchLimits
      );
      let raw = filterRealEstateHits(collected.results, spec);
      let serpExhausted = collected.serpExhausted;
      if (serpExhausted) runSerpExhausted = true;
      emptySerpWaves = raw.length === 0 ? emptySerpWaves + 1 : 0;

      if (raw.length === 0 && wave === 0 && !serpExhausted) {
        progress("searching", 12, "0 fuentes — reintentando consultas ampliadas…");
        const broader = broadenQueries(queries, spec.prompt, spec);
        registerUsed(broader);
        log(LogAction.WEB_SEARCH, "Reintento con consultas ampliadas", formatBulletList(broader), "searching");
        const retry = await this.collectSourcesParallel(
          spec,
          broader,
          maxSources,
          cfg,
          sessions,
          scraperOptions,
          webEngines,
          debugDir,
          engineTotals,
          profile,
          progress,
          log,
          [],
          searchLimits
        );
        if (retry.serpExhausted) {
          serpExhausted = true;
          runSerpExhausted = true;
        }
        raw = filterRealEstateHits(retry.results, spec);
        if (retry.results.length === 0 && raw.length === 0) {
          emptySerpWaves = Math.max(emptySerpWaves, 1);
        } else if (raw.length > 0) {
          emptySerpWaves = 0;
        }
        if (raw.length > 0) {
          rankedSources = await rankSources(
            dedupeHits([...rankedSources, ...raw]),
            spec,
            profile,
            maxSources,
            this.ollama,
            this.plannerModel,
            cfg.numCtx
          );
          this.logRankedSources(rankedSources, profile, "Reintento con consultas ampliadas");
        } else {
          log(LogAction.INFO, "Reintento sin hits web — se mantienen semillas", undefined, "searching");
        }
      } else if (raw.length > 0) {
        progress("evaluating", Math.min(21, 12 + wave), `Priorizando ${raw.length + rankedSources.length}/${maxSources} enlaces…`, {
          sourcesEvaluated: raw.length,
          thinkingStep: profile.llmRank ? "IA evaluando relevancia" : "Ranking heurístico",
          action: LogAction.LLM_RANK,
        });
        rankedSources = await rankSources(
          dedupeHits([...rankedSources, ...raw]),
          spec,
          profile,
          maxSources,
          this.ollama,
          this.plannerModel,
          cfg.numCtx
        );
        this.logRankedSources(
          rankedSources,
          profile,
          wave === 0 ? "Ranking inicial" : `Ranking ola ${wave + 1}`
        );
      } else {
        log(
          LogAction.INFO,
          `Ola ${wave + 1} sin hits web — se omite ranking IA`,
          `${rankedSources.length}/${maxSources} fuentes acumuladas`,
          "searching"
        );
      }

      const gained = rankedSources.length - beforeCount;
      emptyWaves = gained > 0 ? 0 : emptyWaves + 1;
      log(
        LogAction.INFO,
        `Ola ${wave + 1} — +${gained} fuentes (${rankedSources.length}/${maxSources} total, ${budgetElapsedSec(startTime)}s)`,
        `Consultas: ${waveQueries.length} · sin progreso: ${emptyWaves} olas seguidas${serpExhausted ? " · SERP bloqueado" : ""}`,
        "searching"
      );

      // One real cooldown wait + retry when SERP dies mid-run (instead of burning empty waves).
      if ((serpExhausted || runSerpExhausted) && !didSerpCooldownRecovery) {
        didSerpCooldownRecovery = true;
        const waitMs = Math.max(
          8_000,
          Math.min(
            Math.max(msUntilEnginesReady(webEngines), ENGINE_COOLDOWN_MS) + 1500,
            95_000
          )
        );
        log(
          LogAction.INFO,
          `SERP bloqueado — esperando ${Math.round(waitMs / 1000)}s de cooldown antes de un reintento`,
          undefined,
          "searching"
        );
        progress(
          "searching",
          Math.min(21, 14 + wave),
          `Esperando cooldown SERP (${Math.round(waitMs / 1000)}s)…`
        );
        await sleepMs(waitMs);
        resetSearchEngineHealth();
        runSerpExhausted = false;
        emptySerpWaves = 0;
        wave += 1;
        continue;
      }

      if (
        shouldStopForEmptyWaves(
          longMode,
          emptyWaves,
          startTime,
          profile,
          rankedSources.length,
          maxSources,
          serpExhausted || runSerpExhausted,
          emptySerpWaves
        )
      ) {
        log(
          LogAction.INFO,
          serpExhausted || runSerpExhausted
            ? "Motores web bloqueados (captcha/rate-limit) — fin de búsqueda SERP; se usan semillas/portales y hits previos"
            : emptySerpWaves >= 2
              ? `SERP sin hits en ${emptySerpWaves} olas — fin de búsqueda; se usan semillas/portales`
              : `Sin fuentes nuevas en ${emptyWaves} olas — fin de búsqueda`,
          undefined,
          "searching"
        );
        break;
      }

      if (profile.gapAnalysis && gained > 0) {
        progress("thinking", Math.min(21, 13 + wave), "Evaluando cobertura…", { action: LogAction.LLM_COVERAGE });
        const coverage = await analyzeCoverage(
          spec,
          plan,
          rankedSources,
          this.ollama,
          this.plannerModel,
          cfg.numCtx
        );
        log(
          LogAction.LLM_COVERAGE,
          coverage.sufficient ? "Cobertura suficiente" : "Cobertura incompleta — se ampliará búsqueda",
          [
            coverage.gaps.length > 0 ? `Huecos detectados:\n${formatBulletList(coverage.gaps)}` : "",
            coverage.newQueries.length > 0
              ? `Nuevas consultas propuestas:\n${formatBulletList(coverage.newQueries)}`
              : "",
          ]
            .filter(Boolean)
            .join("\n") || undefined,
          "thinking"
        );
        pendingNewQueries = coverage.newQueries;
        // Solo cortamos por "cobertura suficiente" en modos cortos; en modos
        // largos seguimos recorriendo fuentes del sector hasta el presupuesto.
        if (coverage.sufficient && !longMode) {
          progress("thinking", 19, "Cobertura suficiente");
          break;
        }
      } else if (profile.gapAnalysis && gained === 0) {
        // Sin fuentes nuevas: no gastar minutos en coverage LLM; rotar consultas heurísticas.
        pendingNewQueries = heuristicCoverageQueries(spec, usedQueries, perWaveTarget);
        log(
          LogAction.INFO,
          "Sin progreso — consultas heurísticas (sin coverage IA)",
          formatBulletList(pendingNewQueries),
          "thinking"
        );
      }

      wave++;
    }

    const statsMsg = formatEngineStats(engineTotals, rankedSources.length);
    progress("searching", 22, statsMsg);

    if (rankedSources.length === 0) {
      const emergencyPortals =
        isGrantTarget(spec) || isCurationOpportunityTarget(spec)
          ? grantPortalDeepLinkSeeds(spec)
          : isRealEstateTarget(spec)
            ? realEstatePortalDeepLinkSeeds(spec)
            : isJobTarget(spec)
              ? jobPortalDeepLinkSeeds(spec)
              : [];
      if (emergencyPortals.length > 0) {
        rankedSources = emergencyPortals.map((s) => {
          const fetchable = !isBarePortalHomepage(s.url);
          return {
            title: s.title,
            url: s.url,
            snippet: s.snippet,
            relevance: 92,
            fetchPriority: fetchable ? ("high" as const) : ("skip" as const),
            rankReason: fetchable
              ? "Emergency portal zone seed — fetch"
              : "Emergency portal homepage",
          };
        });
        log(
          LogAction.WEB_SEARCH,
          `Sin SERP — se usan ${emergencyPortals.length} portales de cobertura`,
          emergencyPortals.map((p) => `  → ${p.title}`).join("\n"),
          "searching"
        );
      } else {
        log(LogAction.INFO, "Sin fuentes encontradas — fin de ejecución", statsMsg, "done");
        progress("done", 100, "No se encontraron páginas. Comprueba Playwright o regenera el agente.");
        this.runLog = undefined;
        return {
          results: [],
          summary: "No se encontraron fuentes web.",
        };
      }
    }

    const bPhase = budgetPhase(startTime, profile);
    // Re-apply host-health after SERP waves (rank may have overwritten boosts).
    try {
      const hostFile = await readHostHealth(dataDir, spec.id);
      const hostBoosts = hostBoostMapFromHealth(hostFile);
      if (hostBoosts.size > 0) {
        rankedSources = applyHostHealthBoost(rankedSources, hostBoosts);
      }
    } catch {
      /* soft-fail */
    }
    const pinnedHigh = rankedSources.filter((r) => r.fetchPriority === "high").length;
    const requestedRegions = requestedRegionsForSpec(spec.prompt || "", spec.filters.criteria || "");
    const exhaustiveGlobal =
      requestedRegions.has("global") &&
      (isGrantTarget(spec) || isCurationOpportunityTarget(spec));
    const earlyGaps =
      isGrantTarget(spec) || isCurationOpportunityTarget(spec)
        ? uncoveredRegions(
            rankedSources.map((r) => r.url),
            requestedRegions
          )
        : [];
    const regionBoostBase =
      isGrantTarget(spec) || isCurationOpportunityTarget(spec) || isSectorNewsTarget(spec)
        ? regionFetchBoost(requestedRegions.size, exhaustiveGlobal)
        : 0;
    const regionBoost =
      regionBoostBase + gapFetchBoost(earlyGaps.length, bPhase);
    const fetchLimit = fetchLimitForBudget(
      rankedSources.length,
      profile,
      bPhase,
      pinnedHigh,
      regionBoost
    );
    const toFetch = sourcesToFetchDiverse(rankedSources, fetchLimit, (url) =>
      inferItemRegion({ url })
    );

    if (profile.fetchPolicy !== "none" && toFetch.length > 0) {
      log(
        LogAction.PAGE_FETCH,
        `${toFetch.length} páginas a leer (prioridad alta/media)${
          regionBoost ? ` · boost regional +${regionBoost}` : ""
        }${earlyGaps.length ? ` · huecos prev: ${earlyGaps.slice(0, 4).join(",")}` : ""}`,
        toFetch
          .slice(0, 8)
          .map((r, i) => `  ${i + 1}. [${r.fetchPriority}] ${truncateUrl(r.url)}`)
          .join("\n"),
        "searching"
      );
      progress("searching", 24, `Leyendo ${toFetch.length} páginas prioritarias…`);
      rankedSources = await this.enrichRanked(
        rankedSources,
        toFetch,
        spec,
        sessions,
        scraperOptions,
        progress,
        log
      );

      // Expand listing / portal pages into concrete opportunity deep links, then fetch them.
      if (
        isGrantTarget(spec) ||
        isCurationOpportunityTarget(spec) ||
        isProgramsTarget(spec) ||
        isAwardsTarget(spec) ||
        isExposureTarget(spec)
      ) {
        rankedSources = await this.expandListingPages(
          rankedSources,
          maxSources,
          spec,
          sessions,
          scraperOptions,
          progress,
          log,
          { exhaustive: exhaustiveGlobal, gapCount: earlyGaps.length }
        );
        rankedSources = await this.expandDepth2Related(
          rankedSources,
          maxSources,
          spec,
          sessions,
          scraperOptions,
          progress,
          log
        );
        rankedSources = await this.gapFillUncoveredRegions(
          rankedSources,
          maxSources,
          spec,
          sessions,
          scraperOptions,
          progress,
          log,
          { exhaustive: exhaustiveGlobal, phase: bPhase }
        );
      }
    }

    let extracted: ExtractedItem[] = [];

    if (profile.extractPolicy === "serp_only") {
      progress("extracting", 35, "Resultados desde snippets (modo rápido)…");
      extracted = serpToExtractedItems(rankedSources, spec);
      log(
        LogAction.INFO,
        `${extracted.length} resultados desde snippets SERP (sin extracción IA)`,
        undefined,
        "extracting"
      );
    } else {
      const extractLimit = extractLimitForBudget(rankedSources.length, profile, bPhase);
      const toExtract = rankedSources.slice(0, extractLimit);
      progress("extracting", 30, `Extrayendo ${toExtract.length} fuentes…`, { action: LogAction.LLM_EXTRACT });

      extracted = await mapPool(toExtract, profile.parallelExtract, async (result, i) => {
        const content = result.rawHtml ?? result.snippet;
        let item = await this.extractItem(content, result, spec, cfg);
        if (!item.title && !item.url) {
          item = serpToExtractedItems([result], spec)[0] ?? item;
        } else if (!item.score) {
          item = {
            ...item,
            score: result.relevance ?? heuristicItemScore(item, result, spec),
            reason: item.reason ?? result.rankReason ?? "Extracted",
          };
        }
        log(
          LogAction.LLM_EXTRACT,
          `Extracción ${i + 1}/${toExtract.length}: ${truncate(String(item.title ?? result.title), 70)}`,
          [
            `URL: ${truncateUrl(result.url)}`,
            `Modelo: ${this.extractorModel}`,
            `Campos: ${spec.output.schema.join(", ")}`,
            item.score != null ? `Score: ${item.score}` : "",
            item.reason ? `Motivo: ${truncate(String(item.reason), 120)}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          "extracting"
        );
        progress(
          "extracting",
          30 + (35 * (i + 1)) / Math.max(1, toExtract.length),
          `Extraído ${i + 1}/${toExtract.length}`
        );
        return normalizeExtractedItem(item);
      });
    }

    extracted = extracted.filter((item) => validateOpportunityResult(item, spec));
    if (extracted.length === 0) {
      progress("filtering", 72, "Sin resultados válidos tras validación");
    }

    progress("filtering", 72, "Filtrando y ordenando…", { action: LogAction.LLM_SCORE });
    let filtered = await this.filterItems(extracted, spec, cfg, rankedSources);
    filtered = applyOpportunityScoreFloor(filtered, spec);

    if (profile.useCritic && this.criticModel && filtered.length > 0) {
      const deepTarget =
        isRealEstateTarget(spec) ||
        isGrantTarget(spec) ||
        isCurationOpportunityTarget(spec) ||
        isJobTarget(spec);
      const allHeuristic = filtered.every(
        (i) =>
          !i.reason ||
          /heuristic|serp fallback|extracted/i.test(String(i.reason))
      );
      // Never skip critic on deep opportunity runs — heuristic seeds need LLM re-score.
      if (!deepTarget && allHeuristic && filtered.length <= 5) {
        log(
          LogAction.INFO,
          "Revisión Pro omitida — resultados heurísticos/SERP",
          undefined,
          "evaluating"
        );
      } else {
        progress("evaluating", 78, "Revisión crítica Pro…", {
          thinkingStep: "Modelo superior re-evaluando",
          action: LogAction.LLM_CRITIC,
        });
        const beforeTop = filtered.slice(0, 5).map((i) => `${truncate(String(i.title ?? i.url), 40)} (${i.score ?? "?"})`);
        filtered = await this.criticPass(filtered, spec, cfg);
        filtered = applyOpportunityScoreFloor(filtered, spec);
        log(
          LogAction.LLM_CRITIC,
          `Revisión Pro con ${this.criticModel}`,
          [
            "Antes (top 5):",
            formatBulletList(beforeTop),
            "Después (top 5):",
            formatBulletList(
              filtered.slice(0, 5).map((i) => `${truncate(String(i.title ?? i.url), 40)} (${i.score ?? "?"}) — ${truncate(String(i.reason ?? ""), 60)}`)
            ),
          ].join("\n"),
          "evaluating"
        );
      }
    }

    const minScore = effectiveMinScore(effort, spec.filters.minScore ?? 70);
    let finalItems = filtered
      .map((item) => normalizeExtractedItem(item))
      .filter((item) => validateOpportunityResult(item, spec))
      .filter((item) => (item.score ?? 0) >= minScore)
      .filter((item) => {
        if (!isRealEstateTarget(spec)) return true;
        return isRelevantRealEstateHit(
          {
            title: String(item.title ?? ""),
            url: String(item.url ?? ""),
            snippet: String(item.description ?? item.summary ?? item.reason ?? ""),
          },
          spec
        );
      });

    if (finalItems.length === 0 && rankedSources.length > 0) {
      finalItems = serpToExtractedItems(rankedSources, spec)
        .map((item) => normalizeExtractedItem(item))
        .filter((item) => {
          const url = String(item.url ?? "");
          const snippet = String(item.description ?? item.summary ?? item.reason ?? "");
          // Portal deep-link seeds must survive when SERP is dead (homepages are intentional).
          if (/portal seed|listing deep-link/i.test(snippet)) return Boolean(url);
          if (!isGrantTarget(spec) && !isCurationOpportunityTarget(spec)) {
            return validateOpportunityResult(item, spec);
          }
          if (!validateOpportunityResult(item, spec)) return false;
          return (
            isDirectGrantUrl(url) ||
            (!isLowQualityGrantUrl(url) &&
              /\b(grant|funding|deadline|closing|opportunity)\b/i.test(
                `${item.title ?? ""} ${item.description ?? ""} ${item.summary ?? ""}`
              ))
          );
        })
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, Math.max(3, Math.ceil(rankedSources.length * 0.5)));
      // Force portal deep-links from generators (not rankedSources) so coverage never evaporates.
      if (finalItems.length === 0 && (isGrantTarget(spec) || isCurationOpportunityTarget(spec))) {
        finalItems = grantPortalDeepLinkSeeds(spec)
          .map((s) => {
            const item = normalizeExtractedItem({
              title: s.title,
              url: s.url,
              description: s.snippet,
              summary: s.snippet,
              score: 60,
              reason: "Portal grant seed (SERP blocked / no deep listings)",
            });
            return { ...item, url: item.url ?? s.url, title: item.title ?? s.title };
          })
          .filter((item) => Boolean(item.url))
          .slice(0, 12);
      }
      if (finalItems.length === 0 && isJobTarget(spec) && !isGrantTarget(spec) && !isRealEstateTarget(spec)) {
        finalItems = jobPortalDeepLinkSeeds(spec)
          .map((s) => {
            const item = normalizeExtractedItem({
              title: s.title,
              url: s.url,
              description: s.snippet,
              summary: s.snippet,
              score: 60,
              reason: "Portal job seed (SERP blocked / no deep listings)",
            });
            return { ...item, url: item.url ?? s.url, title: item.title ?? s.title };
          })
          .filter((item) => Boolean(item.url))
          .slice(0, 12);
      }
      if (finalItems.length === 0 && isRealEstateTarget(spec)) {
        finalItems = realEstatePortalDeepLinkSeeds(spec)
          .map((s) => {
            const item = normalizeExtractedItem({
              title: s.title,
              url: s.url,
              description: s.snippet,
              summary: s.snippet,
              score: 60,
              reason: "Portal real-estate seed (SERP blocked / no deep listings)",
            });
            return { ...item, url: item.url ?? s.url, title: item.title ?? s.title };
          })
          .filter((item) => Boolean(item.url))
          .slice(0, 12);
      }
      progress("filtering", 78, `Fallback SERP — ${finalItems.length} enlaces`);
    }

    // Last resort / coverage merge: ensure portal seeds are present for grant/job/real-estate
    // even when a weak SERP item already filled finalItems, or SERP was exhausted.
    if (
      isGrantTarget(spec) ||
      isCurationOpportunityTarget(spec) ||
      isJobTarget(spec) ||
      isRealEstateTarget(spec)
    ) {
      const portals =
        isGrantTarget(spec) || isCurationOpportunityTarget(spec)
          ? grantPortalDeepLinkSeeds(spec)
          : isRealEstateTarget(spec)
            ? realEstatePortalDeepLinkSeeds(spec)
            : jobPortalDeepLinkSeeds(spec);
      if (
        portals.length > 0 &&
        (finalItems.length < 3 || runSerpExhausted || emptySerpWaves >= 2)
      ) {
        const seen = new Set(
          finalItems.map((i) => String(i.url ?? "").toLowerCase()).filter(Boolean)
        );
        for (const s of portals) {
          const key = s.url.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const item = normalizeExtractedItem({
            title: s.title,
            url: s.url,
            description: s.snippet,
            summary: s.snippet,
            score: 58,
            reason: runSerpExhausted
              ? "Portal coverage seed (SERP blocked)"
              : "Portal coverage seed",
          });
          if (item.url) finalItems.push(item);
          if (finalItems.length >= 12) break;
        }
        if (finalItems.length > 0) {
          progress("filtering", 79, `Cobertura por portales — ${finalItems.length} enlaces`);
        }
      }
    }

    if (finalItems.length === 0 && filtered.length > 0) {
      finalItems = [...filtered]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, Math.max(3, Math.ceil(filtered.length * 0.4)));
    }

    if (spec.filters.dedupe?.enabled) {
      const before = finalItems.length;
      finalItems = dedupeItems(finalItems, spec.filters.dedupe.fields);
      if (finalItems.length < before) {
        log(
          LogAction.DEDUPE,
          `Deduplicación: ${before} → ${finalItems.length} resultados`,
          `Campos: ${spec.filters.dedupe.fields.join(", ")}`,
          "filtering"
        );
      }
    }

    // Quality curation: verify dates/URLs, freshness for news, editorial boost, cross-run dedupe
    if (
      isCurationOpportunityTarget(spec) ||
      isSectorNewsTarget(spec) ||
      isNewsletterWrapTarget(spec) ||
      spec.filters.requireVerification
    ) {
      const known = await loadPriorFingerprints(dataDir, spec.id);
      const beforeCur = finalItems.length;
      const { kept, dropped } = applyCurationPipeline(finalItems, spec, {
        knownFingerprints: known,
        minDaysRemaining: spec.filters.minDaysRemaining,
        maxNewsAgeDays: spec.filters.maxAgeDays,
      });
      finalItems = kept;
      const reasons = new Map<string, number>();
      for (const d of dropped) {
        reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
      }
      log(
        LogAction.FILTER,
        `Curation: ${beforeCur} → ${finalItems.length} (dropped ${dropped.length})`,
        formatBulletList(
          [...reasons.entries()].map(([r, n]) => `${r}: ${n}`)
        ),
        "filtering"
      );

      // If curation wiped everything after a thin SERP run, reinject portal coverage seeds.
      if (
        finalItems.length === 0 &&
        (isGrantTarget(spec) || isCurationOpportunityTarget(spec)) &&
        (runSerpExhausted || emptySerpWaves >= 2 || rankedSources.length > 0)
      ) {
        finalItems = grantPortalDeepLinkSeeds(spec)
          .map((s) =>
            normalizeExtractedItem({
              title: s.title,
              url: s.url,
              description: s.snippet,
              summary: s.snippet,
              score: 55,
              reason: "Portal coverage seed (post-curation rescue)",
            })
          )
          .filter((item) => Boolean(item.url))
          .slice(0, 12);
        if (finalItems.length > 0) {
          log(
            LogAction.INFO,
            `Curation vacía — rescate ${finalItems.length} semillas de portal`,
            undefined,
            "filtering"
          );
        }
      }
    }

    finalItems.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (isGrantTarget(spec) || isCurationOpportunityTarget(spec)) {
      finalItems = sortByDeadlineAsc(finalItems);
    }

    let lastCoverage: ReturnType<typeof buildRegionCoverage> | undefined;
    if (
      isGrantTarget(spec) ||
      isCurationOpportunityTarget(spec) ||
      isSectorNewsTarget(spec)
    ) {
      const requested = requestedRegionsForSpec(spec.prompt || "", spec.filters.criteria || "");
      lastCoverage = buildRegionCoverage(finalItems, requested);
      log(
        LogAction.LLM_COVERAGE,
        `Coverage regional: ${finalItems.length} items · ${lastCoverage.rows.length} regiones · huecos ${lastCoverage.gaps.length}`,
        lastCoverage.summaryLines.join("\n"),
        "filtering"
      );
      if (lastCoverage.gaps.length > 0) {
        progress(
          "filtering",
          88,
          `Coverage: huecos en ${lastCoverage.gaps.slice(0, 4).join(", ")}`,
          { action: LogAction.LLM_COVERAGE }
        );
      }
    }

    const originCounts = countDiscoveryOrigins(finalItems);

    const healthText = formatSourceHealthReport({
      serpEngineHits: Object.fromEntries(
        Object.entries(engineTotals).map(([k, v]) => [k, v ?? 0])
      ),
      seedCount: this.runHealth.seedCount,
      feedItemCount: this.runHealth.feedItemCount,
      listingExpandCount: this.runHealth.listingExpandCount,
      depth2Count: this.runHealth.depth2Count,
      pageFetchOk: this.runHealth.pageFetchOk,
      pageFetchFail: this.runHealth.pageFetchFail,
      finalCount: finalItems.length,
      serpExhausted: runSerpExhausted,
      gapFillCount: this.runHealth.gapFillCount,
      portalParserCount: this.runHealth.portalParserCount,
      portalDetailCount: this.runHealth.portalDetailCount,
      feedSkippedCount: this.runHealth.feedSkippedCount,
      feedFailCount: this.runHealth.feedFailCount,
      feedCooldownLines: await readFeedHealth(dataDir, spec.id)
        .then((fh) => formatFeedHealthSummary(fh).lines)
        .catch(() => [] as string[]),
      originCounts,
    });

    log(LogAction.INFO, "Salud de fuentes del run", healthText, "filtering");

    log(
      LogAction.FILTER,
      `${finalItems.length} resultados finales (umbral ≥ ${minScore})`,
      formatBulletList(
        finalItems.slice(0, 10).map(
          (i, n) => `${n + 1}. [${i.score ?? "?"}] ${truncate(String(i.title ?? i.url), 55)} — ${truncate(String(i.reason ?? ""), 50)}`
        )
      ),
      "filtering"
    );

    const budgetMsg =
      bPhase === "critical"
        ? `Presupuesto de tiempo alcanzado (${budgetElapsedSec(startTime)}s)`
        : `Completed with ${finalItems.length} results`;

    progress("exporting", 90, "Exportando resultados…", { action: LogAction.EXPORT });
    const runId = process.env.AIIA_RUN_ID;
    const exportPaths = await exportResults(finalItems, spec, dataDir, runId, {
      sourceHealth: healthText,
      regionCoverage: lastCoverage?.summaryLines,
      regionGaps: lastCoverage?.gaps,
      serpExhausted: runSerpExhausted,
      listingExpandCount: this.runHealth.listingExpandCount,
      depth2Count: this.runHealth.depth2Count,
      feedItemCount: this.runHealth.feedItemCount,
      seedCount: this.runHealth.seedCount,
      gapFillCount: this.runHealth.gapFillCount,
      portalParserCount: this.runHealth.portalParserCount,
      portalDetailCount: this.runHealth.portalDetailCount,
      feedSkippedCount: this.runHealth.feedSkippedCount,
      feedFailCount: this.runHealth.feedFailCount,
      serpEngineHits: Object.fromEntries(
        Object.entries(engineTotals).map(([k, v]) => [k, v ?? 0])
      ),
      originCounts,
    });

    try {
      await appendHealthHistory(dataDir, spec.id, {
        at: new Date().toISOString(),
        runId: runId || undefined,
        finalCount: finalItems.length,
        serpExhausted: runSerpExhausted,
        seedCount: this.runHealth.seedCount,
        feedItemCount: this.runHealth.feedItemCount,
        listingExpandCount: this.runHealth.listingExpandCount,
        depth2Count: this.runHealth.depth2Count,
        pageFetchOk: this.runHealth.pageFetchOk,
        pageFetchFail: this.runHealth.pageFetchFail,
        regionGaps: lastCoverage?.gaps,
        gapFillCount: this.runHealth.gapFillCount,
        topSerp: Object.entries(engineTotals)
          .filter(([, n]) => (n ?? 0) > 0)
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
          .slice(0, 3)
          .map(([e, n]) => `${engineLabel(e as SearchEngineId)}:${n}`)
          .join(", "),
        serpEngineHits: Object.fromEntries(
          Object.entries(engineTotals).map(([k, v]) => [k, v ?? 0])
        ),
        originCounts,
      });
      const candidateHosts = rankedSources
        .slice(0, 40)
        .map((r) => normalizeHost(r.url))
        .filter(Boolean);
      await updateHostHealth(
        dataDir,
        spec.id,
        finalItems.map((i) => String(i.url ?? "")).filter(Boolean),
        candidateHosts
      );
      const hist = await readHealthHistory(dataDir, spec.id, 8);
      const trend = formatHealthHistoryTrend(hist);
      if (trend) {
        log(LogAction.INFO, "Tendencia health (últimos runs)", trend, "exporting");
      }
    } catch {
      /* soft-fail history */
    }

    log(
      LogAction.EXPORT,
      "Resultados exportados",
      [
        exportPaths.inboxPath ? `Bandeja: ${exportPaths.inboxPath}` : "",
        exportPaths.csvPath ? `CSV: ${exportPaths.csvPath}` : "",
        exportPaths.excelPath ? `Excel: ${exportPaths.excelPath}` : "",
        exportPaths.newsletterPath ? `Newsletter (copy-paste): ${exportPaths.newsletterPath}` : "",
        exportPaths.reportPath ? `Informe: ${exportPaths.reportPath}` : "",
      ]
        .filter(Boolean)
        .join("\n") || undefined,
      "exporting"
    );
    const exportHint = exportPaths.csvPath
      ? ` · CSV exportado`
      : exportPaths.inboxPath
        ? ` · guardado en bandeja`
        : "";
    progress("done", 100, `${budgetMsg}${exportHint}`);

    const summary = await this.summarize(finalItems, spec, cfg);
    log(LogAction.LLM_SUMMARIZE, "Resumen generado", truncate(summary, 500), "done");
    this.runLog = undefined;
    return { results: finalItems, summary };
  }

  private logRankedSources(sources: RankedSource[], profile: ResearchProfile, label: string): void {
    if (!this.runLog || sources.length === 0) return;
    const top = sources.slice(0, 12);
    const lines = top.map((s, i) => {
      const prio = s.fetchPriority !== "skip" ? s.fetchPriority : "skip";
      return `  ${i + 1}. [${s.relevance}] ${prio} · ${truncate(s.title, 55)} — ${truncateUrl(s.url)}${s.rankReason ? `\n      ↳ ${truncate(s.rankReason, 100)}` : ""}`;
    });
    const rest = sources.length - top.length;
    if (rest > 0) lines.push(`  … +${rest} más`);
    this.runLog(
      LogAction.LLM_RANK,
      `${label}: ${sources.length} fuentes (${profile.llmRank ? "ranking IA" : "heurístico"})`,
      lines.join("\n"),
      "evaluating"
    );
  }

  private async collectSourcesParallel(
    spec: AgentSpec,
    queries: string[],
    limit: number,
    cfg: EffortConfig,
    sessions: CredentialIndex,
    scraperOptions: ScraperOptions | undefined,
    webEngines: SearchEngineId[],
    debugDir: string,
    engineTotals: Partial<Record<SearchEngineId, number>>,
    profile: ResearchProfile,
    progress: (phase: ProgressEvent["phase"], percent: number, message: string, extra?: Partial<ProgressEvent>) => void,
    log: ActionLogger,
    existing: RankedSource[],
    searchLimits: SearchLimits
  ): Promise<{ results: SearchResult[]; serpExhausted: boolean }> {
    const collected: SearchResult[] = [];
    const seen = new Set(existing.map((r) => normalizeUrl(r.url)));
    const pending = queries.filter(Boolean);
    const perQuery = perQueryLimit(limit, searchLimits.maxResultsPerQuery, pending.length);

    // Sequential SERP: avoids rate-limit bursts and makes blocked-streak counting correct.
    const searchConcurrency = 1;

    let consecutiveBlocked = 0;
    let serpExhausted = false;
    let stopSerp = false;

    const batches = await mapPool(pending, searchConcurrency, async (query) => {
      if (stopSerp) return [] as SearchResult[];
      const batch: SearchResult[] = [];
      for (const source of spec.search.sources) {
        if (source.type !== "duckduckgo") continue;
        if (stopSerp) break;
        const { results, counts, errors, serpBlocked } = await searchWeb(query, perQuery, {
          engines: webEngines,
          debugDir: collected.length === 0 && existing.length === 0 ? debugDir : undefined,
          locale: this.searchLocale,
          braveApiKey: this.braveApiKey,
        });
        for (const [eng, n] of Object.entries(counts)) {
          engineTotals[eng as SearchEngineId] = (engineTotals[eng as SearchEngineId] ?? 0) + (n ?? 0);
        }
        if (errors.length > 0 && collected.length === 0) {
          console.error("[search]", query, errors.map((e) => `${e.engine}: ${e.message}`).join("; "));
        }
        const hardErrors = errors.filter((e) => isHardBlockSearchError(e.message));
        const blocked =
          Boolean(serpBlocked) ||
          (results.length === 0 &&
            hardErrors.length > 0 &&
            hardErrors.length >= Math.min(2, Math.max(1, errors.filter((e) => !/skipped/i.test(e.message)).length)));
        if (blocked) {
          consecutiveBlocked += 1;
          // Always require 2 blocked queries — one flaky site: query must not kill the wave.
          if (consecutiveBlocked >= 2) {
            stopSerp = true;
            serpExhausted = true;
          }
        } else if (results.length > 0) {
          consecutiveBlocked = 0;
        }
        const countParts = Object.entries(counts)
          .filter(([, n]) => (n ?? 0) > 0)
          .map(([eng, n]) => `${engineLabel(eng as SearchEngineId)}: ${n}`);
        const topHits = results
          .slice(0, 4)
          .map((r) => `  → ${truncate(r.title, 55)} (${truncateUrl(r.url)})`)
          .join("\n");
        log(
          LogAction.WEB_SEARCH,
          `Consulta: ${truncate(query, 120)}`,
          [
            `Motores: ${webEngines.join(", ")}`,
            `Límite: ${perQuery} resultados/consulta · máx. ${limit} total`,
            countParts.length > 0 ? `Hits: ${countParts.join(", ")}` : "Sin hits",
            errors.length > 0 ? `Errores: ${errors.map((e) => `${e.engine}: ${e.message}`).join("; ")}` : "",
            blocked ? "SERP degradado (rate-limit/captcha)" : "",
            topHits || undefined,
          ]
            .filter(Boolean)
            .join("\n"),
          "searching"
        );
        batch.push(...results);
      }
      return batch;
    });

    for (const batch of batches) {
      if (collected.length >= limit) break;
      for (const r of batch) {
        const url = normalizeUrl(r.url);
        if (seen.has(url)) continue;
        seen.add(url);
        collected.push(r);
        if (collected.length >= limit) break;
      }
    }

    if (serpExhausted) {
      log(
        LogAction.INFO,
        "Corte anticipado de SERP: motores bloqueados — se continúa con portales/semillas y hits previos",
        undefined,
        "searching"
      );
    }

    progress("searching", 14, `${existing.length + collected.length}/${limit} fuentes encontradas`);
    return { results: collected, serpExhausted };
  }

  private async enrichRanked(
    all: RankedSource[],
    toFetch: RankedSource[],
    spec: AgentSpec,
    sessions: CredentialIndex,
    scraperOptions: ScraperOptions | undefined,
    progress: (phase: ProgressEvent["phase"], percent: number, message: string) => void,
    log: ActionLogger
  ): Promise<RankedSource[]> {
    const fetchUrls = new Set(toFetch.map((r) => normalizeUrl(r.url)));
    const enriched = [...all];

    await mapPool(toFetch, 3, async (result, i) => {
      const idx = enriched.findIndex((r) => normalizeUrl(r.url) === normalizeUrl(result.url));
      if (idx < 0) return;
      if (result.rawHtml && result.rawHtml.length > 800) return;

      try {
        const urlOptions = {
          ...resolveSessionOptions(result.url, spec.search.requiresLogin, sessions, scraperOptions),
          locale: this.searchLocale || scraperOptions?.locale,
          includeLinkMarkup: true,
        };
        const content = await fetchPageContent(result.url, urlOptions);
        if (content.length > 200) {
          enriched[idx] = { ...enriched[idx], rawHtml: content };
          this.runHealth.pageFetchOk += 1;
          log(
            LogAction.PAGE_FETCH,
            `Página ${i + 1}/${toFetch.length} leída (${content.length} caracteres)`,
            truncateUrl(result.url),
            "searching"
          );
        } else {
          this.runHealth.pageFetchFail += 1;
          log(
            LogAction.PAGE_FETCH,
            `Página ${i + 1}/${toFetch.length} — contenido insuficiente, se usa snippet`,
            truncateUrl(result.url),
            "searching"
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const blocked = /challenge|captcha|blocked \(HTTP/i.test(msg);
        this.runHealth.pageFetchFail += 1;
        log(
          LogAction.PAGE_FETCH,
          blocked
            ? `Página ${i + 1}/${toFetch.length} — anti-bot/403, se conserva deep-link`
            : `Página ${i + 1}/${toFetch.length} — error al leer, se usa snippet`,
          truncateUrl(result.url),
          "searching"
        );
      }
      progress("searching", 24 + (2 * (i + 1)) / Math.max(1, toFetch.length), `Página ${i + 1}/${toFetch.length}`);
    });

    return enriched;
  }

  /**
   * From fetched listing/portal HTML, harvest concrete opportunity URLs and fetch them.
   * Also follows up to 2 pagination pages per expandable listing (bounded).
   */
  private async expandListingPages(
    ranked: RankedSource[],
    maxSources: number,
    spec: AgentSpec,
    sessions: CredentialIndex,
    scraperOptions: ScraperOptions | undefined,
    progress: (phase: ProgressEvent["phase"], percent: number, message: string) => void,
    log: ActionLogger,
    opts?: { exhaustive?: boolean; gapCount?: number }
  ): Promise<RankedSource[]> {
    const seen = new Set(ranked.map((r) => normalizeUrl(r.url)));
    const candidates: RankedSource[] = [];
    const expandCap = expandCapForExhaustive(maxSources, {
      exhaustive: opts?.exhaustive,
      gapCount: opts?.gapCount,
    });
    const listingPages: { url: string; html: string }[] = [];

    for (const src of ranked) {
      if (!src.rawHtml || !isExpandableListingPage(src.url, src.rawHtml)) continue;
      listingPages.push({ url: src.url, html: src.rawHtml });
    }

    // Bounded pagination: fetch up to 2 extra pages per listing hub (max 4 hubs).
    const extraListingUrls: string[] = [];
    for (const hub of listingPages.slice(0, 4)) {
      for (const next of discoverListingPageUrls(hub.html, hub.url, 2)) {
        const key = normalizeUrl(next);
        if (seen.has(key)) continue;
        if (extraListingUrls.includes(next)) continue;
        extraListingUrls.push(next);
      }
    }

    if (extraListingUrls.length > 0) {
      log(
        LogAction.WEB_SEARCH,
        `Paginación de listados: ${extraListingUrls.length} páginas extra`,
        extraListingUrls.map((u) => `  → ${truncateUrl(u)}`).join("\n"),
        "searching"
      );
      progress("searching", 25, `Leyendo ${extraListingUrls.length} páginas de listado…`);
      const pageSources: RankedSource[] = extraListingUrls.map((url) => ({
        title: `Listing page — ${url}`,
        url,
        snippet: "Listing pagination expand",
        relevance: 70,
        fetchPriority: "high" as const,
        rankReason: "Listing pagination",
      }));
      const fetchedPages = await this.enrichRanked(
        pageSources,
        pageSources,
        spec,
        sessions,
        scraperOptions,
        progress,
        log
      );
      for (const p of fetchedPages) {
        if (p.rawHtml && isExpandableListingPage(p.url, p.rawHtml)) {
          listingPages.push({ url: p.url, html: p.rawHtml });
        }
      }
    }

    for (const src of listingPages) {
      const links = extractOpportunityDeepLinks(src.html, src.url, expandCap);
      for (const link of links) {
        const key = normalizeUrl(link.url);
        if (seen.has(key)) continue;
        seen.add(key);
        if (link.parser) this.runHealth.portalParserCount += 1;
        candidates.push({
          title: link.title,
          url: link.url,
          snippet: link.snippet,
          relevance: link.parser ? 86 : 78,
          fetchPriority: "high",
          rankReason: link.parser
            ? `Portal parser (${link.parser})`
            : "Listing deep-link expand",
        });
        if (candidates.length >= expandCap) break;
      }
      if (candidates.length >= expandCap) break;
    }

    if (candidates.length === 0) return ranked;

    this.runHealth.listingExpandCount += candidates.length;
    const portalHits = this.runHealth.portalParserCount;
    log(
      LogAction.WEB_SEARCH,
      `Crawl profundo: ${candidates.length} oportunidades desde listados${
        portalHits > 0 ? ` · parsers portal: ${portalHits}` : ""
      }`,
      candidates
        .slice(0, 10)
        .map((c, i) => `  ${i + 1}. ${truncate(c.title, 60)}\n     ${truncateUrl(c.url)}`)
        .join("\n"),
      "searching"
    );
    progress("searching", 26, `Leyendo ${candidates.length} deep-links de listados…`);

    const fetched = await this.enrichRanked(
      candidates,
      candidates,
      spec,
      sessions,
      scraperOptions,
      progress,
      log
    );

    const merged = [...fetched, ...ranked];
    const out: RankedSource[] = [];
    const seenMerged = new Set<string>();
    for (const c of merged) {
      if (out.length >= maxSources) break;
      const key = normalizeUrl(c.url);
      if (seenMerged.has(key)) continue;
      seenMerged.add(key);
      out.push(c);
    }
    return out;
  }

  /**
   * Depth-2: from already-fetched opportunity pages, harvest a few related deep links
   * (bounded — max 16 new URLs) when the page still looks like a mini-listing or hub.
   */
  private async expandDepth2Related(
    ranked: RankedSource[],
    maxSources: number,
    spec: AgentSpec,
    sessions: CredentialIndex,
    scraperOptions: ScraperOptions | undefined,
    progress: (phase: ProgressEvent["phase"], percent: number, message: string) => void,
    log: ActionLogger
  ): Promise<RankedSource[]> {
    if (ranked.length >= maxSources) return ranked;
    const seen = new Set(ranked.map((r) => normalizeUrl(r.url)));
    const depth2Cap = Math.min(16, Math.max(6, Math.floor(maxSources / 8)));
    const candidates: RankedSource[] = [];

    // Prefer pages that already have HTML and look expandable (related calls, hub crumbs).
    const seeds = ranked
      .filter(
        (r) =>
          r.rawHtml &&
          r.rawHtml.length > 1500 &&
          (isExpandableListingPage(r.url, r.rawHtml) ||
            /listing deep-link|pagination|portal seed|rss feed/i.test(r.rankReason || r.snippet || ""))
      )
      .slice(0, 8);

    for (const src of seeds) {
      if (!src.rawHtml) continue;
      const links = extractOpportunityDeepLinks(src.rawHtml, src.url, 12);
      for (const link of links) {
        const key = normalizeUrl(link.url);
        if (seen.has(key)) continue;
        // Skip same-page anchors / near-identical paths
        if (key === normalizeUrl(src.url)) continue;
        seen.add(key);
        candidates.push({
          title: link.title,
          url: link.url,
          snippet: `Depth-2 related from: ${src.url}`,
          relevance: 72,
          fetchPriority: "medium",
          rankReason: "Depth-2 related opportunity",
        });
        if (candidates.length >= depth2Cap) break;
      }
      if (candidates.length >= depth2Cap) break;
    }

    if (candidates.length === 0) return ranked;

    this.runHealth.depth2Count += candidates.length;
    log(
      LogAction.WEB_SEARCH,
      `Profundidad-2: ${candidates.length} enlaces relacionados`,
      candidates
        .slice(0, 8)
        .map((c, i) => `  ${i + 1}. ${truncate(c.title, 55)}\n     ${truncateUrl(c.url)}`)
        .join("\n"),
      "searching"
    );
    progress("searching", 28, `Profundidad-2: ${candidates.length} páginas…`);

    const toFetch = candidates.slice(0, Math.min(candidates.length, depth2Cap));
    const fetched = await this.enrichRanked(
      toFetch,
      toFetch,
      spec,
      sessions,
      scraperOptions,
      progress,
      log
    );

    const merged = [...fetched, ...ranked];
    const out: RankedSource[] = [];
    const seenMerged = new Set<string>();
    for (const c of merged) {
      if (out.length >= maxSources) break;
      const key = normalizeUrl(c.url);
      if (seenMerged.has(key)) continue;
      seenMerged.add(key);
      out.push(c);
    }
    return out;
  }

  /**
   * Mid-run gap-fill: if requested regions have zero URLs after expand, inject
   * region portal seeds, fetch them, and expand listings once more (bounded).
   * Exhaustive runs get a larger seed pick + optional second pass if gaps remain.
   */
  private async gapFillUncoveredRegions(
    ranked: RankedSource[],
    maxSources: number,
    spec: AgentSpec,
    sessions: CredentialIndex,
    scraperOptions: ScraperOptions | undefined,
    progress: (phase: ProgressEvent["phase"], percent: number, message: string) => void,
    log: ActionLogger,
    opts?: { exhaustive?: boolean; phase?: BudgetPhase }
  ): Promise<RankedSource[]> {
    if (!isGrantTarget(spec) && !isCurationOpportunityTarget(spec)) return ranked;

    const requested = requestedRegionsForSpec(spec.prompt || "", spec.filters.criteria || "");
    let gaps = uncoveredRegions(
      ranked.map((r) => r.url),
      requested
    );
    if (gaps.length === 0) return ranked;

    const runPass = async (
      current: RankedSource[],
      passGaps: string[],
      pickCap: number
    ): Promise<RankedSource[]> => {
      const seen = new Set(current.map((r) => normalizeUrl(r.url)));
      const seeds = grantPortalSeedsForRegions(passGaps).filter(
        (s) => !seen.has(normalizeUrl(s.url))
      );
      const pick = seeds.slice(0, pickCap);
      if (pick.length === 0) return current;

      this.runHealth.gapFillCount += pick.length;
      this.runHealth.seedCount += pick.length;
      log(
        LogAction.WEB_SEARCH,
        `Gap-fill regional: ${passGaps.join(", ")} → ${pick.length} portales`,
        pick.map((p) => `  → ${p.title} (${truncateUrl(p.url)})`).join("\n"),
        "searching"
      );
      progress(
        "searching",
        29,
        `Gap-fill: cubriendo ${passGaps.slice(0, 4).join(", ")}…`
      );

      const candidates: RankedSource[] = pick.map((s) => ({
        title: s.title,
        url: s.url,
        snippet: s.snippet || `Gap-fill portal (${passGaps.join(",")})`,
        relevance: 88,
        fetchPriority: "high" as const,
        rankReason: `Gap-fill region: ${passGaps.join(",")}`,
      }));

      let next = await this.enrichRanked(
        [...candidates, ...current],
        candidates,
        spec,
        sessions,
        scraperOptions,
        progress,
        log
      );
      next = await this.expandListingPages(
        next,
        maxSources,
        spec,
        sessions,
        scraperOptions,
        progress,
        log,
        { exhaustive: opts?.exhaustive, gapCount: passGaps.length }
      );
      return next;
    };

    const baseCap = opts?.exhaustive
      ? Math.min(24, Math.max(10, gaps.length * 4))
      : Math.min(16, Math.max(6, gaps.length * 3));
    let next = await runPass(ranked, gaps, baseCap);

    // Second pass when exhaustive and still missing regions (bounded).
    if (opts?.exhaustive && opts.phase !== "critical") {
      gaps = uncoveredRegions(
        next.map((r) => r.url),
        requested
      );
      if (gaps.length > 0) {
        log(
          LogAction.INFO,
          `Gap-fill 2ª pasada (exhaustivo): ${gaps.join(", ")}`,
          undefined,
          "searching"
        );
        next = await runPass(next, gaps, Math.min(12, gaps.length * 3));
      }
    }

    return next;
  }

  private async criticPass(
    items: ExtractedItem[],
    spec: AgentSpec,
    cfg: EffortConfig
  ): Promise<ExtractedItem[]> {
    const top = items.slice(0, isRealEstateTarget(spec) ? 40 : 20);
    try {
      const reHint = isRealEstateTarget(spec)
        ? " Strict geography: demote anything outside the goal comarcas; demote food/dictionary pages; promote Idealista/Fotocasa listings in those zones with renovation potential."
        : "";
      const oppHint =
        isGrantTarget(spec) || isCurationOpportunityTarget(spec)
          ? " For opportunities: score 0–25 only for bare hubs with no named program. Named open calls with org/deadline/funding/deep URL must stay ≥55."
          : "";
      const response = await this.ollama.chat(
        [
          {
            role: "system",
            content: `You are a senior research critic. Re-score each item 0-100 for relevance to the goal. Be strict.${reHint}${oppHint} Return JSON array with url, score, reason.`,
          },
          {
            role: "user",
            content: `Goal: ${spec.prompt}\nCriteria: ${spec.filters.criteria}\nItems:\n${JSON.stringify(top)}`,
          },
        ],
        {
          model: this.criticModel ?? this.plannerModel,
          temperature: 0.2,
          format: "json",
          numCtx: cfg.numCtx,
          timeoutMs: defaultLlmTimeoutMs(this.criticModel ?? this.plannerModel),
        }
      );
      const scored = coerceJsonArray<ExtractedItem>(response);
      if (scored.length === 0) return items;
      return items.map((item) => {
        const s = scored.find((x) => x.url === item.url);
        if (!s || typeof s.score !== "number") return item;
        return { ...item, score: s.score, reason: s.reason ?? item.reason ?? "Pro critic" };
      });
    } catch {
      return items;
    }
  }

  private async expandQueries(spec: AgentSpec, cfg: EffortConfig, current: string[]): Promise<string[]> {
    try {
      const response = await this.ollama.chat(
        [
          {
            role: "system",
            content: `Generate ${cfg.queryExpansion} diverse web search queries. Return ONLY JSON array of strings.`,
          },
          {
            role: "user",
            content: `Goal: ${spec.prompt}\nExisting: ${JSON.stringify(current)}\nCriteria: ${spec.filters.criteria}`,
          },
        ],
        { model: this.plannerModel, temperature: cfg.temperature, format: "json", numCtx: cfg.numCtx, timeoutMs: defaultLlmTimeoutMs(this.plannerModel) }
      );
      const parsed = coerceJsonArray<unknown>(response);
      return parsed.filter((q): q is string => typeof q === "string" && q.trim().length > 0);
    } catch {
      /* fallback */
    }
    return [];
  }

  private async collectSeedSources(
    spec: AgentSpec,
    log: ActionLogger
  ): Promise<SearchResult[]> {
    const seeds: SearchResult[] = [];
    for (const source of spec.search.sources) {
      if (source.type === "rss") {
        try {
          const items = await fetchFeed(source.url, 40);
          for (const item of items) {
            seeds.push({
              title: item.title,
              url: item.url,
              snippet: item.snippet || item.publishedAt || "",
            });
          }
          log(LogAction.WEB_SEARCH, `Feed RSS: ${source.url}`, `${items.length} entradas`, "searching");
        } catch (err) {
          log(
            LogAction.WEB_SEARCH,
            `Feed RSS falló: ${source.url}`,
            err instanceof Error ? err.message : String(err),
            "searching"
          );
        }
      } else if (source.type === "url") {
        if (isRealEstateTarget(spec) && isBarePortalHomepage(source.url)) {
          log(
            LogAction.WEB_SEARCH,
            `Homepage portal omitida (usar deep-links de zona): ${source.url}`,
            undefined,
            "searching"
          );
          continue;
        }
        try {
          const item = await fetchUrlAsSnippet(source.url);
          seeds.push({ title: item.title, url: item.url, snippet: item.snippet });
          log(LogAction.WEB_SEARCH, `Fuente URL semilla: ${source.url}`, truncate(item.title, 80), "searching");
        } catch (err) {
          log(
            LogAction.WEB_SEARCH,
            `Fuente URL falló: ${source.url}`,
            err instanceof Error ? err.message : String(err),
            "searching"
          );
        }
      }
    }
    return seeds;
  }

  private async extractItem(
    content: string,
    result: SearchResult,
    spec: AgentSpec,
    cfg: EffortConfig
  ): Promise<ExtractedItem> {
    const schema = spec.output.schema;
    const truncated = sliceContentForExtract(content, cfg.extractContentChars, result.url, spec);
    const grant = isGrantTarget(spec) || isCurationOpportunityTarget(spec);
    const realEstate = isRealEstateTarget(spec);
    const portalPrefill = grant ? extractPortalDetails(content, result.url) : null;
    const portalHints = formatPortalDetailHints(portalPrefill);
    const systemPrompt = grant
      ? `Extract an OPEN opportunity (grant/funding, fellowship/program, award/competition, or exposure call) from this page. Return JSON: ${schema.join(", ")}.
Rules:
- Prefer a CONCRETE named program with eligibility, deadline, or funding/benefit. Reject pure navigation hubs without a named call — set score below 40 for those.
- If the page lists MANY opportunities, extract the single best open call matching the goal (not the portal title).
- scope: geographic scope like NATIONAL, GLOBAL, AU & NZ, EU, ES — infer from content
- organization: funding body or host organisation
- program_name: official program / grant / award name (not the website title)
- description: 1-3 sentence summary of who it supports and what it offers
- max_funding or value_or_benefit: amount or benefit as written
- deadline: closing date as written (e.g. Closing 30 July) or "rolling" if ongoing
- url: direct link to apply or official call page (deep link, not bare homepage)
- category: Funding | Programs & Fellowships | Awards & Competitions | Exposure when clear
- If not a specific open opportunity, set score below 40
- When "Structured fields already parsed" are provided, use them for matching keys unless the page clearly contradicts them.
Source URL: ${result.url}`
      : realEstate
        ? `Extract a Spanish real-estate listing (casa/chalet/masía/piso) from this page. Return JSON: ${schema.join(", ")}.
Rules:
- This is PROPERTY search, NOT jobs. Never mention job postings.
- title: property headline; location: comarca/municipio/province matching the user goal; price: asking price if shown.
- summary: 1-2 sentences on condition / renovation potential.
- If the page is off-topic (recipes, dictionaries, other cities outside the goal zones), set score below 20.
- If the listing is clearly outside the requested geographic area, set score below 30.
- Prefer deep listing URLs over city-wide search hubs.
Source URL: ${result.url}`
      : `Extract relevant fields from this job posting page. Return JSON: ${schema.join(", ")}.
Rules:
- application_link MUST be the direct URL to view or apply to THIS specific job (not company homepage, search results, or reviews).
- job_title: single role title only (not a list of roles).
- location: city/region only (not "Select location" placeholders).
- If the page is not a job posting (reviews, company profile, article), set score below 40.
Source URL: ${result.url}`;
    try {
      const response = await this.ollama.chat(
        [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: `Title: ${result.title}\nSnippet: ${result.snippet}${
              portalHints ? `\n\n${portalHints}` : ""
            }\n\nContent:\n${truncated}`,
          },
        ],
        {
          model: this.extractorModel,
          temperature: Math.min(0.3, cfg.temperature),
          format: "json",
          numCtx: cfg.numCtx,
          timeoutMs: defaultLlmTimeoutMs(this.extractorModel),
        }
      );
      const parsed = normalizeExtractedItem(
        (coerceJsonObject<ExtractedItem>(response) ?? {}) as ExtractedItem
      );
      const llmUrl = resolveOpportunityUrl(parsed as Record<string, unknown>);
      if (
        llmUrl &&
        /^https?:\/\//i.test(llmUrl) &&
        llmUrl !== result.url &&
        (!isLowQualityGrantUrl(llmUrl) || isDirectGrantUrl(llmUrl))
      ) {
        parsed.url = llmUrl;
      } else {
        parsed.url = result.url;
      }
      const title = parsed.title;
      parsed.title =
        (typeof title === "string" ? title.trim() : title != null ? String(title) : "") || result.title;

      // Preserve coverage provenance so validate/curation/floor still recognize seeds & expands.
      const ranked = result as SearchResult & { rankReason?: string };
      const provenance = `${result.snippet ?? ""} ${ranked.rankReason ?? ""}`;
      if (hasCoverageProvenance(provenance) || hasCoverageProvenance(parsed.reason)) {
        const tag = ranked.rankReason || result.snippet || "coverage seed";
        parsed.reason = parsed.reason ? `${parsed.reason} | ${tag}` : tag;
        if (!parsed.description && result.snippet) parsed.description = result.snippet;
        if (!parsed.summary && result.snippet) parsed.summary = result.snippet;
      }

      if (grant && portalDetailHasSignal(portalPrefill)) {
        this.runHealth.portalDetailCount += 1;
        return mergePortalDetails(parsed as Record<string, unknown>, portalPrefill) as ExtractedItem;
      }
      return parsed;
    } catch {
      const ranked = result as SearchResult & { rankReason?: string };
      const fallback: ExtractedItem = {
        title: result.title,
        url: result.url,
        description: result.snippet,
        summary: result.snippet,
        reason: ranked.rankReason || result.snippet || "Extraction fallback",
      };
      if (grant && portalDetailHasSignal(portalPrefill)) {
        this.runHealth.portalDetailCount += 1;
        return mergePortalDetails(fallback as Record<string, unknown>, portalPrefill) as ExtractedItem;
      }
      return fallback;
    }
  }

  private async filterItems(
    items: ExtractedItem[],
    spec: AgentSpec,
    cfg: EffortConfig,
    sources: SearchResult[]
  ): Promise<ExtractedItem[]> {
    if (items.length === 0) return [];
    if (cfg.steps <= 1) {
      return items.map((item, i) => ({
        ...item,
        score: item.score ?? heuristicItemScore(item, sources[i] ?? { title: "", url: "", snippet: "" }, spec),
      }));
    }

    let current = items;
    for (let pass = 0; pass < cfg.steps; pass++) {
      const batchSize = cfg.filterBatchSize;
      const scored: ExtractedItem[] = [];
      for (let i = 0; i < current.length; i += batchSize) {
        const batch = current.slice(i, i + batchSize);
        scored.push(...(await this.scoreBatch(batch, spec, cfg, pass, cfg.steps)));
      }
      scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      current = scored;
      if (pass < cfg.steps - 1 && current.length > 15) {
        current = current.slice(0, Math.max(15, Math.ceil(current.length * 0.7)));
      }
    }
    return current;
  }

  private async scoreBatch(
    items: ExtractedItem[],
    spec: AgentSpec,
    cfg: EffortConfig,
    pass: number,
    totalPasses: number
  ): Promise<ExtractedItem[]> {
    try {
      const reHint = isRealEstateTarget(spec)
        ? ` REAL ESTATE SCORING: reward listings in the exact comarcas/zones from the goal; reward renovation/reform potential and clear price; score <25 if outside those zones (Madrid/Fuenlabrada/etc.), recipes, dictionaries, or bare portal homepages; score 70+ only for on-zone property listings or deep Idealista/Fotocasa search pages for those zones.`
        : "";
      const grantHint =
        isGrantTarget(spec) || isCurationOpportunityTarget(spec)
          ? ` OPPORTUNITY SCORING: score 0–25 ONLY for bare navigational hubs with no named program. If the item has a program/org name plus deadline, funding, eligibility, or a deep official URL, score ≥55. Do not zero valid open calls just because the page also lists other grants.`
          : "";
      const response = await this.ollama.chat(
        [
          {
            role: "system",
            content: `Score each item 0-100. Criteria: ${spec.filters.criteria}.${reHint}${grantHint} Return JSON array with score and reason.`,
          },
          {
            role: "user",
            content: `${buildContextBlock(spec.contextAttachments ?? [])}\nPass ${pass + 1}/${totalPasses}\n${JSON.stringify(items)}`,
          },
        ],
        {
          model: this.plannerModel,
          temperature: cfg.temperature,
          format: "json",
          numCtx: cfg.numCtx,
          timeoutMs: defaultLlmTimeoutMs(this.plannerModel),
        }
      );
      const scored = coerceJsonArray<ExtractedItem>(response);
      if (scored.length > 0) {
        const result: ExtractedItem[] = items.map((item, i) => {
          const s: Partial<ExtractedItem> = scored[i] ?? scored.find((x) => x.url === item.url) ?? {};
          return {
            ...item,
            score: typeof s.score === "number" ? s.score : item.score,
            reason: s.reason ?? item.reason,
          };
        });
        this.runLog?.(
          LogAction.LLM_SCORE,
          `Puntuación IA paso ${pass + 1}/${totalPasses} — ${items.length} ítems`,
          formatBulletList(
            result
              .slice(0, 8)
              .map(
                (item) =>
                  `[${item.score ?? "?"}] ${truncate(String(item.title ?? item.url), 50)}${item.reason ? ` — ${truncate(String(item.reason), 40)}` : ""}`
              )
          ),
          "filtering"
        );
        return result;
      }
    } catch {
      /* fallback */
    }
    // La puntuación IA falló: conservar la puntuación real de extracción en vez
    // de sobrescribir todo con un valor fijo (que dejaba todos los ítems iguales).
    return items.map((item) => ({
      ...item,
      score: typeof item.score === "number" ? item.score : 50,
      reason: item.reason ?? "Extraction score",
    }));
  }

  private async summarize(items: ExtractedItem[], spec: AgentSpec, cfg: EffortConfig): Promise<string> {
    const top = items
      .slice(0, 5)
      .map((i) => `${i.title ?? i.url} (score: ${i.score ?? "?"})`)
      .join("\n");
    try {
      return await this.ollama.chat(
        [
          { role: "system", content: "Summarize top search results in 3-5 sentences." },
          { role: "user", content: `Agent: ${spec.name}\nTotal: ${items.length}\nTop:\n${top}` },
        ],
        { model: this.extractorModel, temperature: 0.4, numCtx: Math.min(cfg.numCtx, 8192), timeoutMs: defaultLlmTimeoutMs(this.extractorModel) }
      );
    } catch {
      return `Found ${items.length} results for ${spec.name}`;
    }
  }
}

function dedupeHits(hits: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return hits.filter((r) => {
    const key = normalizeUrl(r.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatEngineStats(totals: Partial<Record<SearchEngineId, number>>, unique: number): string {
  const parts = Object.entries(totals)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([e, n]) => `${engineLabel(e as SearchEngineId)}: ${n}`);
  return parts.length > 0 ? `${parts.join(" | ")} — únicos: ${unique}` : `únicos: ${unique}`;
}

function engineLabel(id: SearchEngineId): string {
  if (id === "mojeek") return "Mojeek";
  if (id === "duckduckgo-html") return "DDG";
  if (id === "duckduckgo-lite") return "DDG-Lite";
  if (id === "brave-api") return "Brave API";
  if (id === "brave") return "Brave HTML";
  if (id === "ecosia") return "Ecosia";
  if (id === "bing") return "Bing";
  return id;
}

function resolveSearchLocale(spec: AgentSpec): string {
  const blob = `${spec.prompt} ${spec.filters.criteria} ${spec.search.queries.join(" ")} ${spec.name ?? ""}`;
  if (/australia|australian|\bau\b|new zealand|\bnz\b/i.test(blob)) return "en-AU";
  // Spain / Catalonia / property portals — prefer Spanish SERP even without the word "España".
  if (
    /spain|españa|español|catalu[nñ]a|catalunya|tarragona|barcelona|madrid|valencia|valència|girona|lleida|andaluc|galicia|pened[eè]s|baix\s*camp|alt\s*camp|priorat|comarca|idealista|fotocasa|habitaclia|subvenci[oó]n|convocatoria/i.test(
      blob
    ) && !/australia|new zealand/i.test(blob)
  ) {
    return "es-ES";
  }
  if (/\buk\b|united kingdom|england/i.test(blob)) return "en-GB";
  if (isRealEstateTarget(spec)) return "es-ES";
  return "en-US";
}

function normalizeUrl(url: string): string {
  return canonicalUrl(url) || url.trim().toLowerCase();
}

function dedupeItems(items: ExtractedItem[], fields: string[]): ExtractedItem[] {
  const seenUrl = new Set<string>();
  const seenContent = new Set<string>();
  return items.filter((item) => {
    const urlKey = normalizeUrl(String(item.url ?? item.link ?? ""));
    const contentKey = opportunityContentKey(item);

    // Primary: canonical URL
    if (urlKey) {
      if (seenUrl.has(urlKey)) return false;
      seenUrl.add(urlKey);
    }

    // Secondary: same org+program(+deadline) across different portals
    if (contentKey && contentKey.split("|").filter(Boolean).length >= 2) {
      if (seenContent.has(contentKey)) return false;
      seenContent.add(contentKey);
    }

    // Fallback to configured fields when URL/content keys are weak
    if (!urlKey && !contentKey) {
      const values = fields.map((f) => String(item[f] ?? "").trim());
      const key = values.map((v) => v.toLowerCase()).join("|");
      if (!key || seenUrl.has(`f:${key}`)) return false;
      seenUrl.add(`f:${key}`);
    }
    return true;
  });
}

type CredentialIndex = Record<string, { sessionPath: string; loginUrl: string }>;

async function loadCredentialSessions(dataDir: string): Promise<CredentialIndex> {
  try {
    const content = await readFile(join(dataDir, "credential-index.json"), "utf-8");
    return JSON.parse(content) as CredentialIndex;
  } catch {
    return {};
  }
}

function resolveSessionOptions(
  url: string,
  requiresLogin: LoginRequirement[] | undefined,
  sessions: CredentialIndex,
  base?: ScraperOptions
): ScraperOptions | undefined {
  if (!requiresLogin?.length) return base;
  for (const req of requiresLogin) {
    const session = sessions[req.siteId];
    if (!session) continue;
    try {
      const host = new URL(session.loginUrl).hostname;
      if (url.includes(req.siteId) || url.includes(host)) {
        return { ...base, sessionDir: session.sessionPath, headless: true };
      }
    } catch {
      if (url.includes(req.siteId)) {
        return { ...base, sessionDir: session.sessionPath, headless: true };
      }
    }
  }
  if (requiresLogin.length === 1) {
    const session = sessions[requiresLogin[0].siteId];
    if (session) return { ...base, sessionDir: session.sessionPath, headless: true };
  }
  return base;
}

export function diffSpecs(oldSpec: AgentSpec, newSpec: AgentSpec): Record<string, { old: unknown; new: unknown }> {
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  const keys = new Set([...Object.keys(oldSpec), ...Object.keys(newSpec)] as (keyof AgentSpec)[]);
  for (const key of keys) {
    const o = JSON.stringify(oldSpec[key as keyof AgentSpec]);
    const n = JSON.stringify(newSpec[key as keyof AgentSpec]);
    if (o !== n) diff[key as string] = { old: oldSpec[key as keyof AgentSpec], new: newSpec[key as keyof AgentSpec] };
  }
  return diff;
}
