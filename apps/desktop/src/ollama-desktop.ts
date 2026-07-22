import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, ChatOptions, LlmClient } from "@aiia/ollama-client/browser";
import {
  modelForProfile,
  modelIsAvailable,
  GEMINI_FLASH,
  GEMINI_PRO,
} from "@aiia/ollama-client/browser";
import { api, type AiProviderStatus } from "./api";

export const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

/** Ollama client that routes all calls through Tauri (no webview fetch). */
export class DesktopOllamaClient implements LlmClient {
  async isAvailable(): Promise<boolean> {
    return api.checkOllama().catch(() => false);
  }

  async listModels(): Promise<string[]> {
    const status = await api.getOllamaStatus();
    return status.models;
  }

  async pullModel(model: string): Promise<void> {
    await api.ensureOllamaModel(model);
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    try {
      return await invoke<string>("ollama_chat", {
        model: options.model,
        messages,
        temperature: options.temperature,
        numCtx: options.numCtx,
        format: options.format,
      });
    } catch (err) {
      throw new Error(formatOllamaError(err));
    }
  }
}

/** Routes chat through local Ollama or Gemini according to Settings. */
export class DesktopLlmClient implements LlmClient {
  private local = new DesktopOllamaClient();
  private status: AiProviderStatus | null = null;

  async refreshStatus(): Promise<AiProviderStatus> {
    this.status = await api.getAiProviderStatus();
    return this.status;
  }

  private async provider(): Promise<"local" | "gemini"> {
    await this.refreshStatus();
    return this.status?.provider === "gemini" ? "gemini" : "local";
  }

  async isAvailable(): Promise<boolean> {
    const p = await this.provider();
    if (p === "gemini") return Boolean(this.status?.hasGeminiKey);
    return this.local.isAvailable();
  }

  async listModels(): Promise<string[]> {
    const p = await this.provider();
    if (p === "gemini") return [GEMINI_FLASH, GEMINI_PRO];
    return this.local.listModels();
  }

  async pullModel(model: string): Promise<void> {
    const p = await this.provider();
    if (p === "gemini") return;
    await this.local.pullModel(model);
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    try {
      const p = await this.provider();
      return await api.llmChat(
        options.model,
        messages,
        options.temperature,
        options.numCtx,
        options.format,
        p
      );
    } catch (err) {
      const p = await this.provider().catch(() => "local" as const);
      throw new Error(formatLlmError(err, p));
    }
  }
}

export function sanitizeOllamaProgressMessage(message: string): string {
  return message
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\].*?\x07/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isOllamaNotInstalledError(err: unknown): boolean {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  return (
    /ollama no está instalado/i.test(raw) ||
    /ollama is not installed/i.test(raw) ||
    /ollama\.com\/download/i.test(raw)
  );
}

export function formatOllamaError(err: unknown): string {
  return formatLlmError(err, "local");
}

export function formatLlmError(err: unknown, provider: "local" | "gemini" | string = "local"): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  if (/failed to fetch|networkerror|network error/i.test(raw)) {
    if (provider === "gemini") {
      return "No se pudo conectar con Gemini. Comprueba tu conexión a internet y la API key en Ajustes.";
    }
    return "No se pudo conectar con Ollama. Ve a Ajustes, inicia Ollama o espera a que termine la descarga del modelo.";
  }
  return raw;
}

/** Start Ollama and pull the planner model for this hardware profile (no silent installer). */
export async function prepareOllamaForPlanner(profile: string): Promise<void> {
  const status = await api.getAiProviderStatus();
  if (status.provider === "gemini") {
    if (!status.hasGeminiKey) {
      throw new Error("Gemini seleccionado pero no hay API key. Configúrala en Ajustes.");
    }
    return;
  }
  await api.ensureOllamaForPlanner(profile);
}

export function plannerModelForProfile(profile: string): string {
  return modelForProfile(profile, "planner");
}

export { modelIsAvailable, GEMINI_FLASH, GEMINI_PRO };
