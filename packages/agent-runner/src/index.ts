#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Executor, formatRunLogLine, type ProgressEvent } from "@aiia/agent-engine";
import type { AgentSpec, EffortLevel } from "@aiia/agent-engine";
import { closeBrowser } from "@aiia/scraper";
import { v4 as uuidv4 } from "uuid";

function parseArgs(): {
  agentId: string;
  effort: EffortLevel;
  dataDir: string;
  runId: string;
} {
  const args = process.argv.slice(2);
  let agentId = "";
  let effort: EffortLevel = "medium";
  let dataDir = join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "AIIA");
  let runId = uuidv4();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent-id") agentId = args[++i];
    else if (args[i] === "--effort") effort = args[++i] as EffortLevel;
    else if (args[i] === "--data-dir") dataDir = args[++i];
    else if (args[i] === "--run-id") runId = args[++i];
  }

  if (!agentId) {
    console.error(
      "Usage: node index.js --agent-id <id> [--effort low|medium|high|super_high|ultra_high] [--data-dir path] [--run-id uuid]"
    );
    process.exit(1);
  }

  return { agentId, effort, dataDir, runId };
}

async function loadAgentSpec(dataDir: string, agentId: string): Promise<AgentSpec> {
  const specPath = join(dataDir, "agents", `${agentId}.json`);
  const content = await readFile(specPath, "utf-8");
  return JSON.parse(content) as AgentSpec;
}

async function saveRunResult(
  dataDir: string,
  agentId: string,
  runId: string,
  results: unknown[],
  summary: string
): Promise<void> {
  const runsDir = join(dataDir, "runs");
  await mkdir(runsDir, { recursive: true });
  await writeFile(
    join(runsDir, `${runId}.json`),
    JSON.stringify({ agentId, runId, results, summary, finishedAt: new Date().toISOString() }, null, 2)
  );
}

async function main(): Promise<void> {
  const { agentId, effort, dataDir, runId } = parseArgs();
  process.env.AIIA_DATA_DIR = dataDir;

  const logPath = join(dataDir, "runs", `${runId}.log`);
  await mkdir(join(dataDir, "runs"), { recursive: true });
  const logLines: string[] = [`Run ${runId} agent=${agentId} effort=${effort}`];

  const flushLog = async () => {
    await writeFile(logPath, logLines.join("\n"), "utf-8");
  };
  await flushLog();

  const spec = await loadAgentSpec(dataDir, agentId);
  process.env.AIIA_RUN_ID = runId;
  const { OllamaClient, createLlmClientFromEnv } = await import("@aiia/ollama-client");
  const executor = new Executor(createLlmClientFromEnv(new OllamaClient()));

  const progressFile = join(dataDir, "progress", `${agentId}.json`);
  await mkdir(join(dataDir, "progress"), { recursive: true });

  const onProgress = async (event: ProgressEvent) => {
    logLines.push(formatRunLogLine(event));
    await flushLog();
    await writeFile(
      progressFile,
      JSON.stringify({ ...event, runId, updatedAt: new Date().toISOString() })
    );
    const consoleExtra = [
      event.action ? `[${event.action}]` : "",
      event.thinkingStep ? event.thinkingStep : "",
      event.budgetUsedSec != null ? `${event.budgetUsedSec}s` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    console.error(
      `[${event.phase}] ${event.percent}% - ${event.message}${consoleExtra ? ` (${consoleExtra})` : ""}`
    );
    if (event.detail) {
      for (const line of event.detail.split("\n")) {
        console.error(`  ${line}`);
      }
    }
  };

  try {
    const { results, summary } = await executor.run(spec, effort, onProgress);
    logLines.push(`Results: ${results.length}`);
    logLines.push(`Summary: ${summary}`);
    await saveRunResult(dataDir, agentId, runId, results, summary);
    await writeFile(logPath, logLines.join("\n"), "utf-8");
    console.log(JSON.stringify({ success: true, runId, count: results.length, summary }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logLines.push(`ERROR: ${message}`);
    await writeFile(logPath, logLines.join("\n"), "utf-8");
    await writeFile(
      join(dataDir, "progress", `${agentId}.json`),
      JSON.stringify({ phase: "error", percent: 0, message, runId })
    );
    console.log(JSON.stringify({ success: false, error: message }));
    process.exit(1);
  } finally {
    try {
      await closeBrowser();
    } catch {
      /* ignore browser cleanup errors */
    }
  }
}

main();
