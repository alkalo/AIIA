import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperDir = join(root, "apps/desktop/src-tauri/update-helper");
const releaseDir = join(root, "target/release");
const helperExe = join(releaseDir, "aiia-update-helper.exe");

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

console.log("Compilando aiia-update-helper...");
run("cargo build --release -p aiia-update-helper", { cwd: root });

if (!existsSync(helperExe)) {
  console.error("No se encontró el binario:", helperExe);
  process.exit(1);
}

if (existsSync(helperDir)) {
  rmSync(helperDir, { recursive: true, force: true });
}
mkdirSync(helperDir, { recursive: true });
copyFileSync(helperExe, join(helperDir, "aiia-update-helper.exe"));

console.log("Update helper listo en", helperDir);
