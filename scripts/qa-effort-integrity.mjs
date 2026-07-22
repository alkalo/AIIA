import {
  RESEARCH_PROFILES,
  EFFORT_CONFIGS,
  getEffortEstimate,
  defaultLlmTimeoutMs,
  geminiModelsForEffort,
  GEMINI_PRO,
  GEMINI_FLASH,
} from "../packages/ollama-client/dist/index.js";
import { EFFORT_CONFIGS as B } from "../packages/ollama-client/dist/browser.js";
import { readFileSync } from "fs";

const chat = readFileSync("apps/desktop/src/chatModes.ts", "utf8");
const i18n = readFileSync("apps/desktop/src/i18n.ts", "utf8");
const chatTsx = readFileSync("apps/desktop/src/pages/Chat.tsx", "utf8");
const bugs = [];

for (const e of Object.keys(EFFORT_CONFIGS)) {
  if (JSON.stringify(EFFORT_CONFIGS[e]) !== JSON.stringify(B[e])) bugs.push(`cfg ${e}`);
}
if (RESEARCH_PROFILES.ultra_high.wallClockBudgetSec !== 14400) bugs.push("ultra budget");
if (RESEARCH_PROFILES.medium.estimatedMinutes[0] < 5) bugs.push("medium floor");
if (!chat.includes("wallClockBudgetSec: 14400")) bugs.push("chat max budget");
if (!chat.includes("geminiModelForChatMode")) bugs.push("gemini helper");
if (!i18n.includes('max: "Max"')) bugs.push("i18n en max");
if (!i18n.includes('max: "Máx"')) bugs.push("i18n es max");
if (!chatTsx.includes("chatModel, provider)")) bugs.push("provider lock");
if (!chatTsx.includes("Mode time budget reached")) bugs.push("budget stop");
if (geminiModelsForEffort("ultra_high").plannerModel !== GEMINI_PRO) bugs.push("ultra gemini");
if (geminiModelsForEffort("ultra_high").extractorModel !== GEMINI_PRO) bugs.push("ultra gemini extract");
if (geminiModelsForEffort("low").plannerModel !== GEMINI_PRO) bugs.push("low gemini planner");
if (geminiModelsForEffort("medium").extractorModel !== GEMINI_PRO) bugs.push("medium extract pro");
if (geminiModelsForEffort("low").extractorModel !== GEMINI_FLASH) bugs.push("low extract flash");
if (defaultLlmTimeoutMs(GEMINI_PRO) !== 480000) bugs.push("pro timeout");
if (!String(GEMINI_FLASH).includes("3.6")) bugs.push("flash model id");
if (!String(GEMINI_PRO).includes("3.1-pro")) bugs.push("pro model id");
if (!chat.includes("hard ceiling 4 hours")) bugs.push("chat max text 4h");
if (RESEARCH_PROFILES.ultra_high.searchWaves < 48) bugs.push("ultra waves");

console.log(bugs.length ? `BUGS: ${bugs.join("; ")}` : "NO_BUGS_FOUND");
for (const e of ["low", "medium", "high", "super_high", "ultra_high"]) {
  console.log(e, getEffortEstimate(e));
}
