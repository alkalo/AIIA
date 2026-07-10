import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const helperDir = join(root, "apps/desktop/src-tauri/update-helper");
const releaseDir = join(root, "target/release");
const isWindows = platform() === "win32";
const helperBinName = isWindows ? "aiia-update-helper.exe" : "aiia-update-helper";
const helperBuilt = join(releaseDir, helperBinName);

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

console.log("Compilando aiia-update-helper...");
run("cargo build --release -p aiia-update-helper", { cwd: root });

if (!existsSync(helperBuilt)) {
  console.error("No se encontró el binario:", helperBuilt);
  process.exit(1);
}

if (existsSync(helperDir)) {
  rmSync(helperDir, { recursive: true, force: true });
}
mkdirSync(helperDir, { recursive: true });

// Windows MSI updater expects aiia-update-helper.exe in the bundle.
copyFileSync(helperBuilt, join(helperDir, helperBinName));

console.log("Update helper listo en", helperDir);
