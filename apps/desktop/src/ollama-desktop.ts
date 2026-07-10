import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, ChatOptions } from "@aiia/ollama-client/browser";
import { modelForProfile, modelIsAvailable } from "@aiia/ollama-client/browser";
import { api } from "./api";

export const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";

/** Ollama client that routes all calls through Tauri (no webview fetch). */
export class DesktopOllamaClient {
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
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : String(err);
  if (/failed to fetch|networkerror|network error/i.test(raw)) {
    return "No se pudo conectar con Ollama. Ve a Ajustes, inicia Ollama o espera a que termine la descarga del modelo.";
  }
  return raw;
}

/** Start Ollama and pull the planner model for this hardware profile (no silent installer). */
export async function prepareOllamaForPlanner(profile: string): Promise<void> {
  await api.ensureOllamaForPlanner(profile);
}

export function plannerModelForProfile(profile: string): string {
  return modelForProfile(profile, "planner");
}

export { modelIsAvailable };
