/** Shared LLM types and Gemini client for agents (Node). */

export type AiProviderId = "local" | "gemini";

/** Default / medium effort — agentic loops, speed + intelligence. */
export const GEMINI_FLASH = "gemini-3.6-flash";
/** High+ effort — strongest Gemini for complex agent planning/critique. */
export const GEMINI_PRO = "gemini-3.1-pro-preview";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  numCtx?: number;
  format?: "json";
  /** Abort chat if the provider does not respond in time (default 90s). */
  timeoutMs?: number;
}

export interface LlmClient {
  chat(messages: ChatMessage[], options: ChatOptions): Promise<string>;
  isAvailable(): Promise<boolean>;
  listModels(): Promise<string[]>;
  pullModel(model: string, onProgress?: (status: string) => void): Promise<void>;
}

export function geminiModelsForEffort(effort: string): {
  plannerModel: string;
  extractorModel: string;
  criticModel?: string;
} {
  const heavy =
    effort === "high" ||
    effort === "super_high" ||
    effort === "ultra_high" ||
    effort === "pro" ||
    effort === "max";
  // Quality-first: Pro for plan + extract + critic on heavy runs; Flash only for light extract.
  return {
    plannerModel: GEMINI_PRO,
    extractorModel: heavy ? GEMINI_PRO : GEMINI_FLASH,
    criticModel: heavy ? GEMINI_PRO : undefined,
  };
}

/** Per-call timeout: larger models need longer; Flash/Ollama small = 3 min. */
export function defaultLlmTimeoutMs(model: string): number {
  const m = model.toLowerCase();
  if (m.includes("gemini") && m.includes("pro")) return 360_000;
  if (m.includes("gemini")) return 240_000;
  if (/\b(70b|72b|32b)\b/.test(m)) return 600_000;
  if (/\b(14b|13b|15b)\b/.test(m)) return 420_000;
  if (/\b(7b|8b|9b)\b/.test(m)) return 300_000;
  return 180_000;
}

function buildGeminiBody(
  messages: ChatMessage[],
  temperature: number | undefined,
  responseJson: boolean
): Record<string, unknown> {
  const systemParts: string[] = [];
  const contents: { role: string; parts: { text: string }[] }[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (msg.content.trim()) systemParts.push(msg.content);
      continue;
    }
    const role = msg.role === "assistant" ? "model" : "user";
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text: msg.content });
    } else {
      contents.push({ role, parts: [{ text: msg.content }] });
    }
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: temperature ?? 0.5,
    },
  };
  if (systemParts.length) {
    body.systemInstruction = { parts: [{ text: systemParts.join("\n\n") }] };
  }
  if (responseJson) {
    (body.generationConfig as Record<string, unknown>).responseMimeType = "application/json";
  }
  return body;
}

function mapGeminiError(status: number, body: string): string {
  const lower = body.toLowerCase();
  if (status === 400 && (lower.includes("api key") || lower.includes("api_key"))) {
    return "Gemini API key inválida. Revisa la clave en Ajustes.";
  }
  if (status === 401 || status === 403) {
    return "Gemini rechazó la API key (no autorizada). Revisa la clave en Ajustes.";
  }
  if (status === 429) {
    return "Cuota de Gemini agotada o demasiadas peticiones. Espera un momento o revisa tu plan.";
  }
  if (status >= 500) {
    return `Gemini no está disponible temporalmente (HTTP ${status}).`;
  }
  const truncated = body.slice(0, 280);
  return truncated
    ? `Gemini rechazó la petición: ${truncated}`
    : `Gemini rechazó la petición (HTTP ${status})`;
}

export class GeminiClient implements LlmClient {
  private apiKey: string;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  constructor(apiKey: string) {
    this.apiKey = apiKey.trim();
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async listModels(): Promise<string[]> {
    return [GEMINI_FLASH, GEMINI_PRO];
  }

  async pullModel(_model: string, _onProgress?: (status: string) => void): Promise<void> {
    // Cloud models — nothing to pull.
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const model = options.model.startsWith("gemini") ? options.model : GEMINI_FLASH;
    const timeoutMs = options.timeoutMs ?? defaultLlmTimeoutMs(model);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const body = buildGeminiBody(messages, options.temperature, options.format === "json");
    const url = `${this.baseUrl}/models/${model}:generateContent`;

    try {
      let lastErr = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          signal: controller.signal,
          body: JSON.stringify(body),
        });
        const text = await res.text();
        if (res.status === 429 || res.status >= 500) {
          lastErr = mapGeminiError(res.status, text);
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1) ** 2));
            continue;
          }
          throw new Error(lastErr);
        }
        if (!res.ok) {
          throw new Error(mapGeminiError(res.status, text));
        }
        const data = JSON.parse(text) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const out =
          data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (!out) throw new Error("Gemini devolvió una respuesta vacía");
        return out;
      }
      throw new Error(lastErr || "Gemini falló");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Gemini chat timed out after ${timeoutMs}ms (${model})`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

export type CreateLlmClientOptions = {
  provider?: AiProviderId | string;
  apiKey?: string;
  /** Existing Ollama-compatible client for local mode. */
  localClient?: LlmClient;
};

export function createLlmClient(options: CreateLlmClientOptions = {}): LlmClient {
  const provider = (options.provider ?? "local").toLowerCase();
  if (provider === "gemini") {
    const key = options.apiKey?.trim();
    if (!key) {
      throw new Error("Gemini seleccionado pero no hay API key. Configúrala en Ajustes.");
    }
    return new GeminiClient(key);
  }
  if (options.localClient) return options.localClient;
  throw new Error("Local LLM client required (pass localClient)");
}

export function createLlmClientFromEnv(localClient: LlmClient): LlmClient {
  const env =
    typeof process !== "undefined" && process.env ? process.env : ({} as NodeJS.ProcessEnv);
  const provider = (env.AIIA_LLM_PROVIDER ?? "local").toLowerCase();
  const apiKey = env.AIIA_GEMINI_API_KEY;
  if (provider === "gemini") {
    return createLlmClient({ provider: "gemini", apiKey });
  }
  return localClient;
}
