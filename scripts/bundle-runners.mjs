import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundleDir = join(root, "apps/desktop/src-tauri/runner-bundle");

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

console.log("Compilando paquetes npm...");
run("npm run build:packages", { cwd: root });

if (existsSync(bundleDir)) {
  rmSync(bundleDir, { recursive: true, force: true });
}
mkdirSync(bundleDir, { recursive: true });

const packageJson = {
  name: "aiia-runner-bundle",
  private: true,
  type: "module",
  dependencies: {
    "@aiia/agent-runner": "file:../../../../packages/agent-runner",
    "@aiia/credential-runner": "file:../../../../packages/credential-runner",
    "@aiia/agent-engine": "file:../../../../packages/agent-engine",
    "@aiia/ollama-client": "file:../../../../packages/ollama-client",
    "@aiia/scraper": "file:../../../../packages/scraper",
    exceljs: "^4.4.0",
    playwright: "^1.49.0",
    uuid: "^11.0.0",
  },
};

writeFileSync(join(bundleDir, "package.json"), JSON.stringify(packageJson, null, 2));

console.log("Instalando dependencias de producción en runner-bundle...");
run("npm install --omit=dev --install-links", { cwd: bundleDir });

const pwDest = join(bundleDir, "ms-playwright");
const scraperDir = join(bundleDir, "node_modules/@aiia/scraper");
process.env.PLAYWRIGHT_BROWSERS_PATH = pwDest;

console.log("Instalando Chromium de Playwright en el bundle...");
run("npm exec playwright install chromium", {
  cwd: scraperDir,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: pwDest },
});

rmSync(join(bundleDir, "package.json"), { force: true });
rmSync(join(bundleDir, "package-lock.json"), { force: true });

const runnerJs = join(bundleDir, "node_modules/@aiia/agent-runner/dist/index.js");
const engineJs = join(bundleDir, "node_modules/@aiia/agent-engine/dist/index.js");
if (!existsSync(runnerJs) || !existsSync(engineJs)) {
  console.error("Bundle incompleto:", runnerJs, engineJs);
  process.exit(1);
}

console.log("Runner bundle listo en", bundleDir);
