import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  fetchPageContent,
  fetchFeed,
  fetchUrlAsSnippet,
  searchWeb,
  enginesForEffort,
  type ScraperOptions,
  type SearchEngineId,
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
  type EffortConfig,
  type EffortLevel,
  type ResearchProfile,
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
import { rankSources, sourcesToFetch, type RankedSource } from "./source-ranker.js";
import { fetchLimitForBudget, extractLimitForBudget } from "./budget.js";
import { mapPool } from "./parallel.js";
import {
  LogAction,
  formatBulletList,
  truncate,
  truncateUrl,
  type ActionLogger,
} from "./run-logger.js";
import { coerceJsonArray, coerceJsonObject } from "./json-utils.js";
import { normalizeExtractedItem, validateOpportunityResult } from "./result-quality.js";
import { sectorExpansionQueries } from "./sector-sources.js";
import { grantExpansionQueries } from "./grant-sources.js";
import { isGrantTarget } from "./opportunity-subtype.js";
import { sortByDeadlineAsc } from "./deadline.js";

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
  startTime: number,
  profile: ResearchProfile,
  rankedCount: number,
  maxSources: number
): boolean {
  const threshold = longMode ? 8 : 2;
  if (emptyWaves < threshold) return false;
  if (!longMode) return true;
  const elapsed = budgetElapsedSec(startTime);
  const searchBudget = profile.wallClockBudgetSec * 0.85;
  if (elapsed < searchBudget && rankedCount < maxSources && budgetPhase(startTime, profile) !== "critical") {
    return false;
  }
  return true;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export class Executor {
  private ollama: OllamaClient;
  private plannerModel = "qwen2.5:7b";
  private extractorModel = "qwen2.5:3b";
  private criticModel?: string;
  private runLog?: ActionLogger;

  constructor(ollama?: OllamaClient) {
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
    const models = resolveModels(hw, effort);
    this.plannerModel = models.plannerModel;
    this.extractorModel = models.extractorModel;
    this.criticModel = models.criticModel;

    const cfg = this.initModels(effort);
    const profile = getResearchProfile(effort);
    const searchLimits = resolveSearchLimits(spec, effort);
    const maxSources = searchLimits.maxSources;
    const startTime = Date.now();
    let lastPercent = 0;

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
    const webEngines = enginesForEffort(effort);
    const engineTotals: Partial<Record<SearchEngineId, number>> = {};

    log(
      LogAction.INIT,
      "Configuración del agente",
      [
        `Agente: ${spec.name}`,
        `Modo: ${effort} · perfil ${hw.profile} · ${hw.cpuCores} núcleos · ${hw.totalRamGb} GB RAM`,
        `Modelos: plan=${this.plannerModel}, extract=${this.extractorModel}${this.criticModel ? `, critic=${this.criticModel}` : ""}`,
        `Estrategia: olas=${profile.searchWaves}, rank IA=${profile.llmRank ? "sí" : "no"}, fetch=${profile.fetchPolicy}, extract=${profile.extractPolicy}`,
        `Límite de enlaces: ${maxSources}${searchLimits.fromAgentConfig ? " (configurado en agente)" : ` (modo ${effort})`}`,
        `Motores web: ${webEngines.join(", ")}`,
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
    let queries = queriesFromPlan(plan);

    const seedSources = await this.collectSeedSources(spec, log);
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
      progress("thinking", 6, "Ampliando consultas con IA…", { action: LogAction.LLM_EXPAND });
      const expanded = await this.expandQueries(spec, cfg, queries);
      if (expanded.length > 0) {
        log(
          LogAction.LLM_EXPAND,
          `${expanded.length} consultas nuevas generadas`,
          formatBulletList(expanded),
          "thinking"
        );
      } else {
        log(LogAction.LLM_EXPAND, "Sin consultas adicionales", undefined, "thinking");
      }
      queries = [...new Set([...queries, ...expanded])].slice(0, queries.length + cfg.queryExpansion);
    }

    progress("planning", 8, `${queries.length} consultas · ${plan.sourceTypes.slice(0, 3).join(", ") || "web"}`);

    let wave = 0;
    const usedQueries = new Set<string>();
    let pendingNewQueries: string[] = [];
    let emptyWaves = 0;
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
      const raw = await this.collectSourcesParallel(
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

      if (raw.length === 0 && wave === 0) {
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
        if (retry.length > 0) {
          rankedSources = await rankSources(
            dedupeHits([...rankedSources, ...retry]),
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
        `Consultas: ${waveQueries.length} · sin progreso: ${emptyWaves} olas seguidas`,
        "searching"
      );
      if (shouldStopForEmptyWaves(longMode, emptyWaves, startTime, profile, rankedSources.length, maxSources)) {
        log(LogAction.INFO, `Sin fuentes nuevas en ${emptyWaves} olas — fin de búsqueda`, undefined, "searching");
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
      log(LogAction.INFO, "Sin fuentes encontradas — fin de ejecución", statsMsg, "done");
      progress("done", 100, "No se encontraron páginas. Comprueba Playwright o regenera el agente.");
      this.runLog = undefined;
      return {
        results: [],
        summary: "No se encontraron fuentes web.",
      };
    }

    const bPhase = budgetPhase(startTime, profile);
    const fetchLimit = fetchLimitForBudget(rankedSources.length, profile, bPhase);
    const toFetch = sourcesToFetch(rankedSources, fetchLimit);

    if (profile.fetchPolicy !== "none" && toFetch.length > 0) {
      log(
        LogAction.PAGE_FETCH,
        `${toFetch.length} páginas a leer (prioridad alta/media)`,
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

    if (profile.useCritic && this.criticModel && filtered.length > 0) {
      progress("evaluating", 78, "Revisión crítica Pro…", {
        thinkingStep: "Modelo superior re-evaluando",
        action: LogAction.LLM_CRITIC,
      });
      const beforeTop = filtered.slice(0, 5).map((i) => `${truncate(String(i.title ?? i.url), 40)} (${i.score ?? "?"})`);
      filtered = await this.criticPass(filtered, spec, cfg);
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

    const minScore = effectiveMinScore(effort, spec.filters.minScore ?? 70);
    let finalItems = filtered
      .map((item) => normalizeExtractedItem(item))
      .filter((item) => validateOpportunityResult(item, spec))
      .filter((item) => (item.score ?? 0) >= minScore);

    if (finalItems.length === 0 && extracted.length > 0) {
      finalItems = serpToExtractedItems(rankedSources, spec)
        .map((item) => normalizeExtractedItem(item))
        .filter((item) => validateOpportunityResult(item, spec))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, Math.max(3, Math.ceil(rankedSources.length * 0.5)));
      progress("filtering", 78, `Fallback SERP — ${finalItems.length} enlaces`);
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

    finalItems.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (isGrantTarget(spec)) {
      finalItems = sortByDeadlineAsc(finalItems);
    }

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
    const exportPaths = await exportResults(finalItems, spec, dataDir, runId);
    log(
      LogAction.EXPORT,
      "Resultados exportados",
      [
        exportPaths.inboxPath ? `Bandeja: ${exportPaths.inboxPath}` : "",
        exportPaths.csvPath ? `CSV: ${exportPaths.csvPath}` : "",
        exportPaths.excelPath ? `Excel: ${exportPaths.excelPath}` : "",
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
  ): Promise<SearchResult[]> {
    const collected: SearchResult[] = [];
    const seen = new Set(existing.map((r) => normalizeUrl(r.url)));
    const pending = queries.filter(Boolean);
    const perQuery = perQueryLimit(limit, searchLimits.maxResultsPerQuery, pending.length);

    const searchConcurrency =
      profile.searchWaves >= 8 ? 1 : Math.max(1, profile.parallelSearch);

    const batches = await mapPool(pending, searchConcurrency, async (query) => {
      const batch: SearchResult[] = [];
      for (const source of spec.search.sources) {
        if (source.type !== "duckduckgo") continue;
        const { results, counts, errors } = await searchWeb(query, perQuery, {
          engines: webEngines,
          debugDir: collected.length === 0 && existing.length === 0 ? debugDir : undefined,
          locale: "es-ES",
        });
        for (const [eng, n] of Object.entries(counts)) {
          engineTotals[eng as SearchEngineId] = (engineTotals[eng as SearchEngineId] ?? 0) + (n ?? 0);
        }
        if (errors.length > 0 && collected.length === 0) {
          console.error("[search]", query, errors.map((e) => `${e.engine}: ${e.message}`).join("; "));
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

    progress("searching", 14, `${existing.length + collected.length}/${limit} fuentes encontradas`);
    return collected;
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
        const urlOptions = resolveSessionOptions(result.url, spec.search.requiresLogin, sessions, scraperOptions);
        const content = await fetchPageContent(result.url, urlOptions);
        if (content.length > 200) {
          enriched[idx] = { ...enriched[idx], rawHtml: content };
          log(
            LogAction.PAGE_FETCH,
            `Página ${i + 1}/${toFetch.length} leída (${content.length} caracteres)`,
            truncateUrl(result.url),
            "searching"
          );
        } else {
          log(
            LogAction.PAGE_FETCH,
            `Página ${i + 1}/${toFetch.length} — contenido insuficiente, se usa snippet`,
            truncateUrl(result.url),
            "searching"
          );
        }
      } catch {
        log(
          LogAction.PAGE_FETCH,
          `Página ${i + 1}/${toFetch.length} — error al leer, se usa snippet`,
          truncateUrl(result.url),
          "searching"
        );
      }
      progress("searching", 24 + (2 * (i + 1)) / Math.max(1, toFetch.length), `Página ${i + 1}/${toFetch.length}`);
    });

    return enriched;
  }

  private async criticPass(
    items: ExtractedItem[],
    spec: AgentSpec,
    cfg: EffortConfig
  ): Promise<ExtractedItem[]> {
    const top = items.slice(0, 20);
    try {
      const response = await this.ollama.chat(
        [
          {
            role: "system",
            content: `You are a senior research critic. Re-score each item 0-100 for relevance to the goal. Be strict. Return JSON array with url, score, reason.`,
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
        { model: this.plannerModel, temperature: cfg.temperature, format: "json", numCtx: cfg.numCtx }
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
    const truncated = content.slice(0, cfg.extractContentChars);
    const grant = isGrantTarget(spec);
    const systemPrompt = grant
      ? `Extract grant/funding opportunity fields from this page. Return JSON: ${schema.join(", ")}.
Rules:
- scope: geographic scope like NATIONAL, GLOBAL, AU & NZ, EU, ES — infer from content
- organization: funding body or company offering the grant
- program_name: official program or grant name
- description: 1-3 sentence summary of who it supports and what it funds
- max_funding: maximum amount as written (e.g. Up to $15,000)
- currency: ISO or symbol if clear (USD, AUD, EUR)
- deadline: closing date as written (e.g. Closing 30 July)
- url: direct link to apply or official call page
- If not a grant/funding opportunity, set score below 40
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
            content: `Title: ${result.title}\nSnippet: ${result.snippet}\n\nContent:\n${truncated}`,
          },
        ],
        {
          model: this.extractorModel,
          temperature: Math.min(0.3, cfg.temperature),
          format: "json",
          numCtx: cfg.numCtx,
        }
      );
      const parsed = normalizeExtractedItem(
        (coerceJsonObject<ExtractedItem>(response) ?? {}) as ExtractedItem
      );
      parsed.url = result.url;
      const title = parsed.title;
      parsed.title =
        (typeof title === "string" ? title.trim() : title != null ? String(title) : "") || result.title;
      return parsed;
    } catch {
      return { title: result.title, url: result.url, description: result.snippet };
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
      const response = await this.ollama.chat(
        [
          {
            role: "system",
            content: `Score each item 0-100. Criteria: ${spec.filters.criteria}. Return JSON array with score and reason.`,
          },
          {
            role: "user",
            content: `${buildContextBlock(spec.contextAttachments ?? [])}\nPass ${pass + 1}/${totalPasses}\n${JSON.stringify(items)}`,
          },
        ],
        { model: this.plannerModel, temperature: cfg.temperature, format: "json", numCtx: cfg.numCtx }
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
        { model: this.extractorModel, temperature: 0.4, numCtx: Math.min(cfg.numCtx, 8192) }
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
  return "Bing";
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.trim().toLowerCase();
  }
}

function dedupeItems(items: ExtractedItem[], fields: string[]): ExtractedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = fields.map((f) => String(item[f] ?? "")).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
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
