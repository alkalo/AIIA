#!/usr/bin/env node
/**
 * Integration smoke test for research modes (Rápido / Estándar / Profundo).
 * Creates a temp QA Lead agent spec and runs the executor for each mode.
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Executor } from "../packages/agent-engine/dist/executor.js";
import { RESEARCH_PROFILES } from "../packages/ollama-client/dist/index.js";
import { closeBrowser } from "../packages/scraper/dist/index.js";

const AGENT_ID = "validate-qa-lead";
const spec = {
  id: AGENT_ID,
  version: 1,
  name: "QA Lead Validation",
  prompt: "Buscar ofertas de QA Lead remotas en España",
  templateId: "job-search",
  filters: {
    criteria: "QA Lead, quality assurance lead, remote, España, Spain",
    minScore: 50,
  },
  search: {
    queries: ["QA Lead remote Spain", "empleo QA Lead remoto España"],
    sources: [{ type: "duckduckgo" }],
  },
  output: {
    schema: ["title", "url", "company", "location"],
    destinations: ["inbox"],
  },
  schedule: { intervalMinutes: 1440, onlyWhenRunning: true },
  effort: "medium",
  retentionDays: 7,
  status: "published",
};

const modes = [
  { effort: "low", label: "Rápido", maxSec: RESEARCH_PROFILES.low.wallClockBudgetSec },
  { effort: "medium", label: "Estándar", maxSec: RESEARCH_PROFILES.medium.wallClockBudgetSec },
  { effort: "high", label: "Profundo", maxSec: RESEARCH_PROFILES.high.wallClockBudgetSec },
];

async function main() {
  const dataDir = join(tmpdir(), "aiia-mode-validation");
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(join(dataDir, "agents"), { recursive: true });
  await mkdir(join(dataDir, "logs", "search-debug"), { recursive: true });
  await writeFile(join(dataDir, "agents", `${AGENT_ID}.json`), JSON.stringify(spec, null, 2));
  process.env.AIIA_DATA_DIR = dataDir;

  const results = [];

  for (const { effort, label, maxSec } of modes) {
    const start = Date.now();
    const phases = [];
    const executor = new Executor();
    try {
      const { results: items, summary } = await executor.run(spec, effort, (ev) => {
        phases.push(`${ev.phase}:${ev.percent}%`);
        process.stderr.write(`  [${label}] ${ev.phase} ${ev.percent}% — ${ev.message}\n`);
      });
      const elapsed = Math.round((Date.now() - start) / 1000);
      results.push({
        mode: label,
        effort,
        elapsedSec: elapsed,
        budgetSec: maxSec,
        withinBudget: elapsed <= maxSec * 1.1,
        count: items.length,
        summary: summary.slice(0, 120),
        ok: items.length >= (effort === "low" ? 1 : 3),
      });
    } catch (err) {
      results.push({
        mode: label,
        effort,
        error: err instanceof Error ? err.message : String(err),
        ok: false,
      });
    }
  }

  await closeBrowser();

  console.log("\n=== Research mode validation ===");
  for (const r of results) {
    if (r.error) {
      console.log(`✗ ${r.mode}: ERROR — ${r.error}`);
    } else {
      const budget = r.withinBudget ? "✓ budget" : "⚠ over budget";
      console.log(
        `${r.ok ? "✓" : "✗"} ${r.mode}: ${r.count} results in ${r.elapsedSec}s (${budget}, cap ${r.budgetSec}s)`
      );
      console.log(`  ${r.summary}`);
    }
  }

  const allOk = results.every((r) => r.ok && !r.error);
  await rm(dataDir, { recursive: true, force: true });
  process.exit(allOk ? 0 : 1);
}

main();
