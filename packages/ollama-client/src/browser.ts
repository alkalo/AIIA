export type HardwareProfile = "low" | "medium" | "high" | "super";

export type EffortLevel = "low" | "medium" | "high" | "super_high" | "ultra_high";

import {
  RESEARCH_PROFILES,
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
    maxSources: 8,
    maxResultsPerQuery: 8,
    queryExpansion: 1,
    refinePasses: 0,
    temperature: 0.3,
    numCtx: 2048,
    extractContentChars: 4000,
    filterBatchSize: 15,
    estimatedMinutes: [1, 2],
  },
  medium: {
    steps: 2,
    maxSources: 18,
    maxResultsPerQuery: 8,
    queryExpansion: 2,
    refinePasses: 0,
    temperature: 0.45,
    numCtx: 4096,
    extractContentChars: 6000,
    filterBatchSize: 25,
    estimatedMinutes: [3, 8],
  },
  high: {
    steps: 3,
    maxSources: 80,
    maxResultsPerQuery: 15,
    queryExpansion: 6,
    refinePasses: 1,
    temperature: 0.35,
    numCtx: 8192,
    extractContentChars: 10000,
    filterBatchSize: 35,
    estimatedMinutes: [30, 60],
  },
  super_high: {
    steps: 5,
    maxSources: 160,
    maxResultsPerQuery: 18,
    queryExpansion: 10,
    refinePasses: 2,
    temperature: 0.3,
    numCtx: 8192,
    extractContentChars: 14000,
    filterBatchSize: 50,
    estimatedMinutes: [60, 120],
  },
  ultra_high: {
    steps: 7,
    maxSources: 280,
    maxResultsPerQuery: 20,
    queryExpansion: 14,
    refinePasses: 3,
    temperature: 0.25,
    numCtx: 12288,
    extractContentChars: 20000,
    filterBatchSize: 60,
    estimatedMinutes: [120, 240],
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

export interface OllamaClientOptions {
  baseUrl?: string;
}

export class OllamaClient {
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
  const profile = RESEARCH_PROFILES[effort as EffortLevel];
  if (!profile) return "—";
  const [lo, hi] = profile.estimatedMinutes;
  if (hi >= 60) {
    const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
    return `${fmt(lo / 60)}–${fmt(hi / 60)} h`;
  }
  const fmtMin = (n: number) => (n < 1 ? "<1" : String(Math.round(n)));
  return `${fmtMin(lo)}–${fmtMin(hi)} min`;
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
