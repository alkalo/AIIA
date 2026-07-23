/**
 * Fail if package.json / tauri.conf.json / src-tauri Cargo.toml versions diverge.
 * Prevents the "shows v0.1.5 while releasing 0.1.23" updater loop.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const tauri = JSON.parse(
  fs.readFileSync(path.join(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8")
);
const cargo = fs.readFileSync(path.join(root, "apps/desktop/src-tauri/Cargo.toml"), "utf8");
const cargoMatch = cargo.match(/^version\s*=\s*"([^"]+)"/m);
const cargoVer = cargoMatch?.[1];

const versions = {
  "package.json": pkg.version,
  "tauri.conf.json": tauri.version,
  "src-tauri/Cargo.toml": cargoVer,
};

const unique = new Set(Object.values(versions));
if (unique.size !== 1 || [...unique][0] == null) {
  console.error("Version mismatch — keep these equal before release:");
  for (const [k, v] of Object.entries(versions)) console.error(`  ${k}: ${v}`);
  process.exit(1);
}
console.log(`OK versions aligned at ${pkg.version}`);
