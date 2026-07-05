export type HardwareProfile = "low" | "medium" | "high" | "super";

export interface HardwareInfo {
  profile: HardwareProfile;
  totalRamGb: number;
  vramGb: number;
  cpuCores: number;
  plannerModel: string;
  extractorModel: string;
}

export type EffortLevel = "low" | "medium" | "high" | "super_high" | "ultra_high";

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
    numCtx: 16384,
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
    numCtx: 32768,
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
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
  }
}

export async function detectHardware(): Promise<HardwareInfo> {
  const os = await import("node:os");
  const totalRamGb = Math.round(os.totalmem() / 1024 ** 3);
  const cpuCores = os.cpus().length;
  let vramGb = 0;

  try {
    const { execSync } = await import("node:child_process");
    const output = execSync(
      "nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits",
      { encoding: "utf-8", timeout: 5000 }
    );
    const mb = parseInt(output.trim().split("\n")[0], 10);
    if (!isNaN(mb)) vramGb = Math.round(mb / 1024);
  } catch {
    vramGb = 0;
  }

  let profile: HardwareProfile;
  let plannerModel: string;
  let extractorModel: string;

  if (totalRamGb >= 32 || vramGb >= 8) {
    profile = "super";
    plannerModel = "qwen2.5:14b";
    extractorModel = "qwen2.5:7b";
  } else if (totalRamGb >= 16) {
    profile = "high";
    plannerModel = "qwen2.5:14b";
    extractorModel = "qwen2.5:7b";
  } else if (totalRamGb >= 8) {
    profile = "medium";
    plannerModel = "qwen2.5:7b";
    extractorModel = "qwen2.5:3b";
  } else {
    profile = "low";
    plannerModel = "qwen2.5:3b";
    extractorModel = "llama3.2:1b";
  }

  return { profile, totalRamGb, vramGb, cpuCores, plannerModel, extractorModel };
}

import { getEffortEstimateFromProfile } from "./research-profile.js";

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
