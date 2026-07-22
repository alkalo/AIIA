export type HardwareProfile = "low" | "medium" | "high" | "super";

export type EffortLevel = "low" | "medium" | "high" | "super_high" | "ultra_high";

import {
  RESEARCH_PROFILES,
  getEffortEstimateFromProfile,
} from "./research-profile.js";

export const EFFORT_LEVELS: EffortLevel[] = [
  "low",
  "medium",
  "high",
  "super_high",
  "ultra_high",
];

export interface EffortConfig {
  steps: number;
  maxSources: number;
  maxResultsPerQuery: number;
  queryExpansion: number;
  refinePasses: number;
  temperature: number;
  numCtx: number;
  extractContentChars: number;
  filterBatchSize: number;
  estimatedMinutes: [number, number];
}

export const EFFORT_CONFIGS: Record<EffortLevel, EffortConfig> = {
  low: {
    steps: 1,
    maxSources: 6,
    maxResultsPerQuery: 6,
    queryExpansion: 0,
    refinePasses: 0,
    temperature: 0.35,
    numCtx: 2048,
    extractContentChars: 3000,
    filterBatchSize: 12,
    estimatedMinutes: [0, 2],
  },
  medium: {
    steps: 2,
    maxSources: 28,
    maxResultsPerQuery: 10,
    queryExpansion: 3,
    refinePasses: 0,
    temperature: 0.4,
    numCtx: 4096,
    extractContentChars: 7000,
    filterBatchSize: 25,
    estimatedMinutes: [5, 20],
  },
  high: {
    steps: 4,
    maxSources: 90,
    maxResultsPerQuery: 15,
    queryExpansion: 7,
    refinePasses: 1,
    temperature: 0.3,
    numCtx: 8192,
    extractContentChars: 12000,
    filterBatchSize: 40,
    estimatedMinutes: [30, 75],
  },
  super_high: {
    steps: 6,
    maxSources: 180,
    maxResultsPerQuery: 18,
    queryExpansion: 12,
    refinePasses: 2,
    temperature: 0.28,
    numCtx: 8192,
    extractContentChars: 16000,
    filterBatchSize: 55,
    estimatedMinutes: [75, 120],
  },
  ultra_high: {
    steps: 10,
    maxSources: 360,
    maxResultsPerQuery: 25,
    queryExpansion: 18,
    refinePasses: 4,
    temperature: 0.2,
    numCtx: 12288,
    extractContentChars: 24000,
    filterBatchSize: 70,
    estimatedMinutes: [120, 180],
  },
};

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  numCtx?: number;
  format?: "json";
  timeoutMs?: number;
}

export interface LlmClient {
  chat(messages: ChatMessage[], options: ChatOptions): Promise<string>;
  isAvailable(): Promise<boolean>;
  listModels(): Promise<string[]>;
  pullModel(model: string, onProgress?: (status: string) => void): Promise<void>;
}

export interface OllamaClientOptions {
  baseUrl?: string;
}

export class OllamaClient implements LlmClient {
  private baseUrl: string;

  constructor(options: OllamaClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new Error("Ollama not available");
    const data = (await res.json()) as { models: { name: string }[] };
    return data.models.map((m) => m.name);
  }

  async pullModel(model: string, onProgress?: (status: string) => void): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`Failed to pull model ${model}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as { status?: string };
          if (parsed.status) onProgress?.(parsed.status);
        } catch {
          /* skip */
        }
      }
    }
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 90_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: options.model,
          messages,
          stream: false,
          format: options.format,
          options: {
            temperature: options.temperature ?? 0.5,
            num_ctx: options.numCtx ?? 4096,
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama chat failed: ${text}`);
      }
      const data = (await res.json()) as { message: { content: string } };
      return data.message.content;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Ollama chat timed out after ${timeoutMs}ms (${options.model})`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function getEffortEstimate(effort: EffortLevel | string | undefined): string {
  return getEffortEstimateFromProfile(effort);
}

export {
  RESEARCH_PROFILES,
  getResearchProfile,
  resolveModels,
  budgetPhase,
  budgetElapsedSec,
  shouldStopWaves,
  getEffortEstimateFromProfile,
} from "./research-profile.js";
export type {
  ResearchProfile,
  FetchPolicy,
  ExtractPolicy,
  ResolvedModels,
  BudgetPhase,
} from "./research-profile.js";

export {
  GeminiClient,
  createLlmClient,
  geminiModelsForEffort,
  defaultLlmTimeoutMs,
  GEMINI_FLASH,
  GEMINI_PRO,
} from "./gemini.js";
export type { AiProviderId, CreateLlmClientOptions } from "./gemini.js";

export function modelForProfile(profile: string, role: "planner" | "extractor"): string {
  const map: Record<string, [string, string]> = {
    super: ["qwen2.5:14b", "qwen2.5:7b"],
    high: ["qwen2.5:7b", "qwen2.5:3b"],
    medium: ["qwen2.5:7b", "qwen2.5:3b"],
    low: ["qwen2.5:3b", "llama3.2:1b"],
  };
  const [planner, extractor] = map[profile] ?? map.medium;
  return role === "planner" ? planner : extractor;
}

/** Exact tag match (ignores :latest suffix). */
export function modelIsAvailable(models: string[], model: string): boolean {
  return models.some(
    (m) => m === model || m === `${model}:latest` || m.replace(/:latest$/, "") === model
  );
}
