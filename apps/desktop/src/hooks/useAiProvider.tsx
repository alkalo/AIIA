import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type AiProviderId } from "../api";

type AiProviderContextValue = {
  provider: AiProviderId;
  hasGeminiKey: boolean;
  hasBraveSearchKey: boolean;
  error: string;
  loading: boolean;
  refresh: () => Promise<void>;
  setProvider: (next: AiProviderId) => Promise<boolean>;
};

const AiProviderContext = createContext<AiProviderContextValue | null>(null);

export function AiProviderProvider({ children }: { children: ReactNode }) {
  const [provider, setProviderState] = useState<AiProviderId>("local");
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [hasBraveSearchKey, setHasBraveSearchKey] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getAiProviderStatus();
      setProviderState(s.provider === "gemini" ? "gemini" : "local");
      setHasGeminiKey(s.hasGeminiKey);
      setHasBraveSearchKey(Boolean(s.hasBraveSearchKey));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setProvider = useCallback(
    async (next: AiProviderId) => {
      setError("");
      if (next === "gemini" && !hasGeminiKey) {
        setError("geminiNeedKey");
        return false;
      }
      try {
        const s = await api.setAiProvider(next);
        setProviderState(s.provider === "gemini" ? "gemini" : "local");
        setHasGeminiKey(s.hasGeminiKey);
        setHasBraveSearchKey(Boolean(s.hasBraveSearchKey));
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [hasGeminiKey]
  );

  const value = useMemo(
    () => ({
      provider,
      hasGeminiKey,
      hasBraveSearchKey,
      error,
      loading,
      refresh,
      setProvider,
    }),
    [provider, hasGeminiKey, hasBraveSearchKey, error, loading, refresh, setProvider]
  );

  return <AiProviderContext.Provider value={value}>{children}</AiProviderContext.Provider>;
}

export function useAiProvider(): AiProviderContextValue {
  const ctx = useContext(AiProviderContext);
  if (!ctx) {
    throw new Error("useAiProvider must be used within AiProviderProvider");
  }
  return ctx;
}
