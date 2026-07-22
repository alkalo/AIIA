import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RESEARCH_PROFILES,
  budgetPhase,
  shouldStopWaves,
  resolveModels,
  getEffortEstimateFromProfile,
} from "../packages/ollama-client/dist/index.js";
import {
  fetchLimitForBudget,
  extractLimitForBudget,
} from "../packages/agent-engine/dist/budget.js";
import {
  queriesFromPlan,
  fallbackSearchPlan,
} from "../packages/agent-engine/dist/search-plan.js";
import { sourcesToFetch } from "../packages/agent-engine/dist/source-ranker.js";

const mockSpec = {
  id: "test",
  version: 1,
  name: "QA Lead",
  prompt: "Buscar ofertas QA Lead remotas en España",
  filters: { criteria: "QA Lead, remote, Spain", minScore: 60 },
  search: { queries: [], sources: [{ type: "duckduckgo" }] },
  output: { schema: ["title", "url"], destinations: ["inbox"] },
  schedule: { intervalMinutes: 60, onlyWhenRunning: true },
  effort: "medium",
  retentionDays: 30,
  status: "published",
};

describe("ResearchProfile configs", () => {
  it("Rápido uses serp_only and no fetch", () => {
    const p = RESEARCH_PROFILES.low;
    assert.equal(p.fetchPolicy, "none");
    assert.equal(p.extractPolicy, "serp_only");
    assert.equal(p.llmRank, false);
    assert.equal(p.wallClockBudgetSec, 120);
  });

  it("Estándar enables LLM rank and top fetch", () => {
    const p = RESEARCH_PROFILES.medium;
    assert.equal(p.llmRank, true);
    assert.equal(p.fetchPolicy, "top");
    assert.equal(p.extractTopK, 20);
  });

  it("Profundo has gap analysis and many waves", () => {
    const p = RESEARCH_PROFILES.high;
    assert.equal(p.gapAnalysis, true);
    assert.ok(p.searchWaves >= 8);
    // ~30–75 min de presupuesto.
    assert.ok(p.wallClockBudgetSec >= 3600);
  });

  it("Pro uses critic and deep fetch", () => {
    const p = RESEARCH_PROFILES.ultra_high;
    assert.equal(p.useCritic, true);
    assert.equal(p.fetchPolicy, "deep");
    assert.equal(p.reasoningDepth, 3);
    assert.equal(p.wallClockBudgetSec, 14400);
    assert.equal(p.estimatedMinutes[1], 240);
  });

  it("ladder is strictly stronger on budget", () => {
    const order = ["low", "medium", "high", "super_high", "ultra_high"];
    for (let i = 1; i < order.length; i++) {
      assert.ok(
        RESEARCH_PROFILES[order[i]].wallClockBudgetSec >
          RESEARCH_PROFILES[order[i - 1]].wallClockBudgetSec
      );
    }
  });
});

describe("Budget enforcement", () => {
  it("fetchLimit shrinks in tight/critical phases", () => {
    const profile = RESEARCH_PROFILES.medium;
    const normal = fetchLimitForBudget(20, profile, "normal");
    const tight = fetchLimitForBudget(20, profile, "tight");
    const critical = fetchLimitForBudget(20, profile, "critical");
    assert.ok(normal >= tight);
    assert.ok(tight >= critical);
  });

  it("extractLimit is 0 for serp_only", () => {
    assert.equal(extractLimitForBudget(10, RESEARCH_PROFILES.low, "normal"), 0);
  });

  it("shouldStopWaves respects wave count and budget", () => {
    const profile = RESEARCH_PROFILES.high;
    const start = Date.now() - profile.wallClockBudgetSec * 1000 * 0.96;
    assert.equal(shouldStopWaves(start, profile, 0), true);
    assert.equal(shouldStopWaves(Date.now(), profile, 0), false);
    assert.equal(shouldStopWaves(Date.now(), profile, profile.searchWaves), true);
  });
});

describe("Search plan", () => {
  it("fallbackSearchPlan produces queries from prompt", () => {
    const plan = fallbackSearchPlan(mockSpec);
    assert.ok(plan.queries.length > 0);
  });

  it("queriesFromPlan sorts by priority", () => {
    const plan = fallbackSearchPlan(mockSpec);
    plan.queries = [
      { query: "low priority", priority: 1 },
      { query: "high priority QA", priority: 10 },
    ];
    const q = queriesFromPlan(plan);
    assert.equal(q[0], "high priority QA");
  });
});

describe("Source ranker", () => {
  it("sourcesToFetch skips skip-priority items", () => {
    const ranked = [
      { title: "a", url: "https://a.com", snippet: "", relevance: 90, fetchPriority: "high" },
      { title: "b", url: "https://b.com", snippet: "", relevance: 10, fetchPriority: "skip" },
    ];
    assert.equal(sourcesToFetch(ranked, 5).length, 1);
  });
});

describe("Model routing", () => {
  it("Pro prefers 14b planner on high hardware", () => {
    const hw = {
      profile: "high",
      totalRamGb: 32,
      vramGb: 8,
      cpuCores: 8,
      plannerModel: "qwen2.5:7b",
      extractorModel: "qwen2.5:3b",
    };
    const models = resolveModels(hw, "ultra_high");
    assert.equal(models.plannerModel, "qwen2.5:14b");
  });
});

describe("Effort estimates", () => {
  it("formats minutes and hours", () => {
    assert.match(getEffortEstimateFromProfile("low"), /min|≤/);
    assert.match(getEffortEstimateFromProfile("ultra_high"), /h/);
  });
});
