/**
 * Smoke: local Ollama streaming + optional Gemini (if GEMINI_API_KEY is set).
 * Usage: node scripts/smoke-chat.mjs
 */
const OLLAMA = "http://127.0.0.1:11434";
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

async function smokeOllama() {
  const tagsRes = await fetch(`${OLLAMA}/api/tags`);
  if (!tagsRes.ok) throw new Error(`Ollama tags HTTP ${tagsRes.status}`);
  const tags = await tagsRes.json();
  const models = (tags.models || []).map((m) => m.name);
  const model =
    models.find((m) => m.startsWith("qwen2.5:7b")) ||
    models.find((m) => m.startsWith("qwen2.5")) ||
    models[0];
  if (!model) throw new Error("No Ollama models installed");

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "Reply in the same language as the user. Be very brief.",
        },
        { role: "user", content: "Di solo la palabra OK" },
      ],
      stream: true,
      options: { temperature: 0.2, num_ctx: 2048 },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`chat HTTP ${res.status}`);

  let full = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      const delta = parsed?.message?.content || "";
      if (delta) {
        full += delta;
        process.stdout.write(delta);
      }
    }
  }
  process.stdout.write("\n");
  if (!full.trim()) throw new Error("Empty stream response");
  console.log(`SMOKE_OK_LOCAL model=${model} chars=${full.length}`);
}

async function smokeGemini() {
  const key = process.env.GEMINI_API_KEY || process.env.AIIA_GEMINI_API_KEY;
  if (!key) {
    console.log("SMOKE_SKIP_GEMINI (set GEMINI_API_KEY to enable)");
    return;
  }
  const model = "gemini-2.5-flash";
  const url = `${GEMINI_API}/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }],
      generationConfig: { temperature: 0 },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  const out =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!out.trim()) throw new Error("Empty Gemini response");
  console.log(`SMOKE_OK_GEMINI model=${model} chars=${out.length}`);
}

async function main() {
  await smokeOllama();
  await smokeGemini();
}

main().catch((err) => {
  console.error("SMOKE_FAIL", err.message || err);
  process.exit(1);
});
