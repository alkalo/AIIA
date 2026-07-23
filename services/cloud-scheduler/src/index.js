/**
 * AIIA Cloud Scheduler — Gemini-only cron + result sync.
 *
 * Env:
 *   PORT                 — HTTP port (default 8787)
 *   AIIA_CLOUD_TOKEN     — shared bearer token (desktop Settings)
 *   AIIA_CLOUD_DATA_DIR  — persistent data dir (agents, runs, keys)
 *   AIIA_GEMINI_API_KEY  — optional self-host fallback only; product path = key per user via Push
 *   AIIA_LLM_PROVIDER    — "gemini" on this worker
 *   AIIA_RUNNER_JS       — path to agent-runner dist/index.js
 *
 * Desktop flow:
 *   1. Settings → Cloud URL + token + user's Gemini API key (local)
 *   2. Agent schedule.cloudEnabled = true (Gemini provider)
 *   3. App pushes agent + geminiApiKey on publish / sync_cloud_agent
 *   4. This service runs due agents every minute
 *   5. App pull_cloud_runs on open → local inbox
 */
import { createServer } from "node:http";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import cron from "node-cron";

const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.AIIA_CLOUD_TOKEN || "";
const DATA = process.env.AIIA_CLOUD_DATA_DIR || join(process.cwd(), "cloud-data");
const RUNNER =
  process.env.AIIA_RUNNER_JS ||
  join(process.cwd(), "../../packages/agent-runner/dist/index.js");

async function ensureDirs() {
  for (const d of ["agents", "runs", "inbox", "meta"]) {
    await mkdir(join(DATA, d), { recursive: true });
  }
}

function auth(req) {
  if (!TOKEN) return true; // dev only
  const h = req.headers.authorization || "";
  return h === `Bearer ${TOKEN}`;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2), "utf8");
}

async function listDueAgents() {
  const dir = join(DATA, "agents");
  const files = await readdir(dir).catch(() => []);
  const now = Date.now();
  const due = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const spec = await readJson(join(dir, f), null);
    if (!spec?.id || !spec.schedule?.cloudEnabled) continue;
    if (spec.status !== "published") continue;
    const meta = await readJson(join(DATA, "meta", `${spec.id}.json`), {});
    const intervalMs = Math.max(1, Number(spec.schedule.intervalMinutes || 1440)) * 60_000;
    const next = meta.nextRunAt ? Date.parse(meta.nextRunAt) : 0;
    if (!next || next <= now) due.push({ spec, meta });
  }
  return due;
}

async function runAgent(spec, geminiKey) {
  const runId = randomUUID();
  const agentPath = join(DATA, "agents", `${spec.id}.json`);
  await writeJson(agentPath, spec);

  const env = {
    ...process.env,
    AIIA_LLM_PROVIDER: "gemini",
    AIIA_GEMINI_API_KEY: geminiKey || process.env.AIIA_GEMINI_API_KEY || "",
    AIIA_DATA_DIR: DATA,
    AIIA_RUN_ID: runId,
  };
  if (!env.AIIA_GEMINI_API_KEY) {
    throw new Error("Missing Gemini API key for cloud run");
  }

  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [RUNNER, "--agent-id", spec.id, "--effort", spec.effort || "high", "--data-dir", DATA, "--run-id", runId],
      { env, stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`runner exit ${code}: ${stderr.slice(-500)}`));
    });
  });

  const intervalMin = Math.max(1, Number(spec.schedule?.intervalMinutes || 1440));
  await writeJson(join(DATA, "meta", `${spec.id}.json`), {
    lastRunAt: new Date().toISOString(),
    nextRunAt: new Date(Date.now() + intervalMin * 60_000).toISOString(),
    lastRunId: runId,
  });
  return runId;
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const due = await listDueAgents();
    for (const { spec, meta } of due) {
      // Per-user key from desktop Push (meta); optional env only for self-host ops.
      const key = meta.geminiApiKey || process.env.AIIA_GEMINI_API_KEY || "";
      try {
        console.log(`[cloud] running ${spec.id}`);
        await runAgent(spec, key);
      } catch (e) {
        console.error(`[cloud] fail ${spec.id}`, e);
        await writeJson(join(DATA, "meta", `${spec.id}.json`), {
          ...meta,
          lastError: String(e?.message || e),
          nextRunAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        });
      }
    }
  } finally {
    ticking = false;
  }
}

function send(res, status, body) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  });
  res.end(data);
}

async function handler(req, res) {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    send(res, 200, {
      ok: true,
      service: "aiia-cloud-scheduler",
      uptimeSec: Math.floor(process.uptime()),
      // Free Render: ping this every ~10 min so the instance does not spin down.
    });
    return;
  }

  if (!auth(req)) {
    send(res, 401, { error: "unauthorized" });
    return;
  }

  if (req.method === "PUT" && url.pathname.startsWith("/v1/agents/")) {
    const id = url.pathname.split("/").pop();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const spec = body.spec;
    if (!spec?.id || spec.id !== id) {
      send(res, 400, { error: "invalid spec" });
      return;
    }
    if (!spec.schedule) spec.schedule = {};
    spec.schedule.cloudEnabled = true;
    spec.schedule.onlyWhenRunning = false;
    await writeJson(join(DATA, "agents", `${id}.json`), spec);
    const prev = await readJson(join(DATA, "meta", `${id}.json`), {});
    await writeJson(join(DATA, "meta", `${id}.json`), {
      ...prev,
      geminiApiKey: body.geminiApiKey || prev.geminiApiKey || "",
      updatedAt: new Date().toISOString(),
      nextRunAt: prev.nextRunAt || new Date().toISOString(),
    });
    send(res, 200, { ok: true, id });
    return;
  }

  if (req.method === "GET" && url.pathname === "/v1/sync") {
    const since = Date.parse(url.searchParams.get("since") || "0") || 0;
    const runsDir = join(DATA, "runs");
    const files = await readdir(runsDir).catch(() => []);
    const runs = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const full = join(runsDir, f);
      const raw = await readFile(full, "utf8");
      const parsed = JSON.parse(raw);
      const finished = Date.parse(parsed.finishedAt || 0) || 0;
      if (finished >= since) {
        runs.push({
          file: f,
          ...parsed,
          inboxPath: join(DATA, "inbox", parsed.agentId || "", `${parsed.runId}.json`),
        });
      }
    }
    // Also attach inbox payloads when present
    for (const r of runs) {
      try {
        const inbox = await readFile(
          join(DATA, "inbox", r.agentId, `${r.runId}.json`),
          "utf8"
        );
        r.inbox = JSON.parse(inbox);
      } catch {
        /* optional */
      }
    }
    send(res, 200, { runs });
    return;
  }

  if (req.method === "POST" && url.pathname === "/v1/tick") {
    await tick();
    send(res, 200, { ok: true });
    return;
  }

  send(res, 404, { error: "not found" });
}

await ensureDirs();
if (!TOKEN) {
  console.warn("[aiia-cloud] AIIA_CLOUD_TOKEN empty — auth disabled (dev only)");
}
cron.schedule("* * * * *", () => {
  void tick();
});
createServer(handler).listen(PORT, "0.0.0.0", () => {
  console.log(`[aiia-cloud] listening on 0.0.0.0:${PORT} data=${DATA} runner=${RUNNER}`);
});