/**
 * Build AIIA cloud-scheduler for Render (monorepo).
 * Skips Playwright browser download — free tier is too small for Chromium;
 * HTTP search engines still work; page scrape may fail until you upgrade.
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const env = {
  ...process.env,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  npm_config_fund: "false",
};

function run(cmd) {
  console.log(`[render-cloud-build] ${cmd}`);
  execSync(cmd, { stdio: "inherit", env, cwd: root });
}

run("npm install");
run("npm run build -w @aiia/ollama-client");
run("npm run build -w @aiia/scraper");
run("npm run build -w @aiia/agent-engine");
run("npm run build -w @aiia/agent-runner");
run("npm install --prefix services/cloud-scheduler");

const dataDir = process.env.AIIA_CLOUD_DATA_DIR || join(root, "cloud-data");
mkdirSync(join(dataDir, "agents"), { recursive: true });
mkdirSync(join(dataDir, "runs"), { recursive: true });
mkdirSync(join(dataDir, "inbox"), { recursive: true });
mkdirSync(join(dataDir, "meta"), { recursive: true });

console.log("[render-cloud-build] ok");
