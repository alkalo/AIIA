/**
 * Unit smoke for Gemini client factory / error paths (no network unless GEMINI_API_KEY).
 * Usage: node scripts/smoke-gemini-client.mjs
 */
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const geminiPath = join(__dirname, "../packages/ollama-client/dist/gemini.js");

async function main() {
  const mod = await import(pathToFileURL(geminiPath).href);
  const {
    createLlmClient,
    createLlmClientFromEnv,
    GeminiClient,
    geminiModelsForEffort,
    GEMINI_FLASH,
    GEMINI_PRO,
  } = mod;

  // Factory rejects gemini without key
  let threw = false;
  try {
    createLlmClient({ provider: "gemini" });
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("expected createLlmClient(gemini) without key to throw");

  // Effort mapping — agents always plan with Pro; Flash for extraction
  const low = geminiModelsForEffort("medium");
  const high = geminiModelsForEffort("super_high");
  if (low.plannerModel !== GEMINI_PRO) throw new Error(`medium planner should use pro, got ${low.plannerModel}`);
  if (low.extractorModel !== GEMINI_FLASH) throw new Error(`extractor should use flash, got ${low.extractorModel}`);
  if (high.plannerModel !== GEMINI_PRO) throw new Error(`super_high should use pro, got ${high.plannerModel}`);
  if (!String(GEMINI_FLASH).includes("3.6")) throw new Error(`unexpected flash id: ${GEMINI_FLASH}`);
  if (!String(GEMINI_PRO).includes("3.1-pro")) throw new Error(`unexpected pro id: ${GEMINI_PRO}`);

  // Env local fallback
  delete process.env.AIIA_LLM_PROVIDER;
  delete process.env.AIIA_GEMINI_API_KEY;
  const stub = {
    async chat() {
      return "ok";
    },
    async isAvailable() {
      return true;
    },
    async listModels() {
      return ["qwen"];
    },
    async pullModel() {},
  };
  const local = createLlmClientFromEnv(stub);
  if (local !== stub) throw new Error("local env should return localClient");

  process.env.AIIA_LLM_PROVIDER = "gemini";
  process.env.AIIA_GEMINI_API_KEY = "test-key-not-real";
  const gem = createLlmClientFromEnv(stub);
  if (!(gem instanceof GeminiClient)) throw new Error("gemini env should return GeminiClient");

  const key = process.env.GEMINI_API_KEY;
  if (key) {
    const client = new GeminiClient(key);
    const out = await client.chat([{ role: "user", content: "Reply with exactly: OK" }], {
      model: GEMINI_FLASH,
      temperature: 0,
      timeoutMs: 60_000,
    });
    if (!out.trim()) throw new Error("empty gemini response");
    console.log(`SMOKE_OK_GEMINI_CLIENT chars=${out.length}`);
  } else {
    console.log("SMOKE_SKIP_GEMINI_LIVE (set GEMINI_API_KEY for live call)");
  }

  console.log("SMOKE_OK_GEMINI_CLIENT_FACTORY");
}

main().catch((err) => {
  console.error("SMOKE_FAIL", err.message || err);
  process.exit(1);
});
