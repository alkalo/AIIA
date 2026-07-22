import { v4 as uuidv4 } from "uuid";
import {
  OllamaClient,
  detectHardware,
  geminiModelsForEffort,
  GeminiClient,
  type EffortLevel,
  type LlmClient,
} from "@aiia/ollama-client";
import { modelIsAvailable } from "@aiia/ollama-client/browser";
import type { AgentSpec, TemplateId, PromptAttachment } from "./types.js";
import {
  applyPlannerDefaults,
  buildPlannerChatMessages,
} from "./planner-prompt.js";
import { buildContextBlock } from "./attachments.js";
import { coerceJsonObject } from "./json-utils.js";

export class PlannerAgent {
  private ollama: LlmClient;
  private plannerModel: string;

  constructor(ollama?: LlmClient) {
    this.ollama = ollama ?? new OllamaClient();
    this.plannerModel = "qwen2.5:7b";
  }

  async init(): Promise<void> {
    if (this.ollama instanceof GeminiClient) {
      this.plannerModel = geminiModelsForEffort("medium").plannerModel;
      return;
    }
    const hw = await detectHardware();
    this.plannerModel = hw.plannerModel;
    const models = await this.ollama.listModels().catch(() => [] as string[]);
    if (!modelIsAvailable(models, this.plannerModel)) {
      await this.ollama.pullModel(this.plannerModel);
    }
  }

  async plan(
    userPrompt: string,
    templateId: TemplateId = "custom",
    lang: "en" | "es" = "es",
    attachments: PromptAttachment[] = []
  ): Promise<AgentSpec> {
    await this.init();
    const attachmentBlock = buildContextBlock(attachments);
    const numCtx = attachments.length > 0 ? 8192 : 4096;

    const response = await this.ollama.chat(
      buildPlannerChatMessages(userPrompt, templateId, lang, attachmentBlock),
      { model: this.plannerModel, temperature: 0.35, format: "json", numCtx }
    );

    const parsed = coerceJsonObject<Partial<AgentSpec>>(response);
    if (!parsed) {
      throw new Error(
        "El planificador no devolvió un JSON válido. Revisa que Ollama esté activo y el modelo descargado, e inténtalo de nuevo."
      );
    }

    const { schema, queries, dedupeFields, resolvedTemplateId, opportunitySubtype } =
      applyPlannerDefaults(parsed, userPrompt, templateId);

    const spec: AgentSpec = {
      id: uuidv4(),
      version: 1,
      name: parsed.name ?? "New Agent",
      prompt: parsed.prompt ?? userPrompt,
      templateId: resolvedTemplateId,
      opportunitySubtype: parsed.opportunitySubtype ?? opportunitySubtype,
      search: {
        queries,
        sources: parsed.search?.sources?.length
          ? parsed.search.sources
          : [{ type: "duckduckgo" }],
        requiresLogin: parsed.search?.requiresLogin ?? [],
        ...(parsed.search?.maxSources != null && parsed.search.maxSources > 0
          ? { maxSources: parsed.search.maxSources }
          : {}),
      },
      filters: {
        criteria: parsed.filters?.criteria ?? userPrompt,
        minScore: parsed.filters?.minScore ?? 70,
        dedupe: parsed.filters?.dedupe ?? {
          enabled: true,
          fields: dedupeFields,
        },
      },
      output: {
        schema,
        destinations: parsed.output?.destinations ?? ["inbox", "excel"],
        excelPath:
          parsed.output?.excelPath ??
          `%USERPROFILE%/AIIA/exports/${(parsed.name ?? "agent").toLowerCase().replace(/\s+/g, "-")}.xlsx`,
        excelMode: parsed.output?.excelMode ?? "update_same",
        notify: parsed.output?.notify ?? true,
      },
      schedule: {
        intervalMinutes: parsed.schedule?.intervalMinutes ?? 1440,
        onlyWhenRunning: parsed.schedule?.onlyWhenRunning ?? true,
        timezone: parsed.schedule?.timezone ?? "Europe/Madrid",
      },
      effort: parsed.effort ?? "medium",
      retentionDays: parsed.retentionDays ?? 90,
      status: "draft",
      contextAttachments: attachments.length > 0 ? attachments : undefined,
    };

    return spec;
  }

  async suggestImprovements(
    spec: AgentSpec,
    feedback: { useful: string[]; notUseful: string[] }
  ): Promise<Partial<AgentSpec>> {
    await this.init();
    const response = await this.ollama.chat(
      [
        { role: "system", content: "Suggest improvements to an AgentSpec based on user feedback. Output JSON with only changed fields." },
        {
          role: "user",
          content: `Current spec:\n${JSON.stringify(spec, null, 2)}\n\nUseful results: ${feedback.useful.join("; ")}\nNot useful: ${feedback.notUseful.join("; ")}`,
        },
      ],
      { model: this.plannerModel, temperature: 0.4, format: "json" }
    );
    try {
      return JSON.parse(response) as Partial<AgentSpec>;
    } catch {
      return {};
    }
  }
}

export function applyEffortOverride(spec: AgentSpec, effort: EffortLevel): AgentSpec {
  return { ...spec, effort };
}
