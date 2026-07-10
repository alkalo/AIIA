import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import {
  PlannerAgent,
  normalizeAgentSpec,
  type AgentSpec,
  type PromptAttachment,
  type TemplateId,
  type EffortLevel,
} from "@aiia/agent-engine/browser";
import { api, type OllamaSetupProgress } from "../api";
import {
  DesktopOllamaClient,
  formatOllamaError,
  isOllamaNotInstalledError,
  prepareOllamaForPlanner,
  sanitizeOllamaProgressMessage,
} from "../ollama-desktop";

export interface GenerateAgentParams {
  prompt: string;
  templateId: TemplateId;
  effort: EffortLevel;
  attachments: PromptAttachment[];
  lang: "en" | "es";
}

interface AgentGenerationState {
  isGenerating: boolean;
  ollamaSetup: { message: string; percent: number } | null;
  error: string;
  ollamaNeedsInstall: boolean;
  generatedSpec: AgentSpec | null;
  consumeGeneratedSpec: () => AgentSpec | null;
  generateAgent: (params: GenerateAgentParams) => Promise<AgentSpec | null>;
  clearError: () => void;
}

const AgentGenerationContext = createContext<AgentGenerationState | null>(null);

export function AgentGenerationProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [isGenerating, setIsGenerating] = useState(false);
  const [ollamaSetup, setOllamaSetup] = useState<{ message: string; percent: number } | null>(
    null
  );
  const [error, setError] = useState("");
  const [ollamaNeedsInstall, setOllamaNeedsInstall] = useState(false);
  const [generatedSpec, setGeneratedSpec] = useState<AgentSpec | null>(null);
  const inFlightRef = useRef<Promise<AgentSpec | null> | null>(null);

  useEffect(() => {
    if (!isGenerating) return;
    let unlisten: (() => void) | undefined;
    listen<OllamaSetupProgress>("ollama-setup-progress", (event) => {
      setOllamaSetup({
        message: sanitizeOllamaProgressMessage(event.payload.message),
        percent: event.payload.percent,
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [isGenerating]);

  const consumeGeneratedSpec = useCallback(() => {
    const spec = generatedSpec;
    setGeneratedSpec(null);
    return spec;
  }, [generatedSpec]);

  const clearError = useCallback(() => {
    setError("");
    setOllamaNeedsInstall(false);
  }, []);

  const generateAgent = useCallback(
    async (params: GenerateAgentParams): Promise<AgentSpec | null> => {
      if (inFlightRef.current) return inFlightRef.current;

      setIsGenerating(true);
      setError("");
      setOllamaNeedsInstall(false);
      setGeneratedSpec(null);
      setOllamaSetup({ message: t("create.ollamaPreparing"), percent: 0 });

      const task = (async () => {
        try {
          const hw = await api.getHardwareInfo();
          await prepareOllamaForPlanner(hw.profile);

          setOllamaSetup({ message: t("create.ollamaGenerating"), percent: 100 });
          const planner = new PlannerAgent(new DesktopOllamaClient(), hw.profile);
          const generated = await planner.plan(
            params.prompt,
            params.templateId,
            params.lang,
            params.attachments
          );
          const normalized = normalizeAgentSpec({
            ...generated,
            effort: params.effort,
            contextAttachments:
              params.attachments.length > 0 ? params.attachments : generated.contextAttachments,
          });
          setGeneratedSpec(normalized);
          return normalized;
        } catch (e) {
          if (isOllamaNotInstalledError(e)) {
            setOllamaNeedsInstall(true);
            setError(t("create.ollamaNotInstalled"));
          } else {
            setError(formatOllamaError(e));
          }
          return null;
        } finally {
          setOllamaSetup(null);
          setIsGenerating(false);
          inFlightRef.current = null;
        }
      })();

      inFlightRef.current = task;
      return task;
    },
    [t]
  );

  return (
    <AgentGenerationContext.Provider
      value={{
        isGenerating,
        ollamaSetup,
        error,
        ollamaNeedsInstall,
        generatedSpec,
        consumeGeneratedSpec,
        generateAgent,
        clearError,
      }}
    >
      {children}
    </AgentGenerationContext.Provider>
  );
}

export function useAgentGeneration(): AgentGenerationState {
  const ctx = useContext(AgentGenerationContext);
  if (!ctx) {
    throw new Error("useAgentGeneration must be used within AgentGenerationProvider");
  }
  return ctx;
}
