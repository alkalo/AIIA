import { useTranslation } from "react-i18next";
import type { AiProviderId } from "../api";
import { useAiProvider } from "../hooks/useAiProvider";

type Props = {
  disabled?: boolean;
  className?: string;
  /** Compact label for sidebars / headers */
  compact?: boolean;
  onChanged?: (provider: AiProviderId) => void;
};

export function AiProviderSelect({ disabled, className, compact, onChanged }: Props) {
  const { t } = useTranslation();
  const { provider, hasGeminiKey, error, loading, setProvider } = useAiProvider();

  const handleChange = async (next: AiProviderId) => {
    const ok = await setProvider(next);
    if (ok) onChanged?.(next);
  };

  const errMsg =
    error === "geminiNeedKey" ? t("aiProvider.needKey") : error ? error : "";

  return (
    <div className={className ?? "ai-provider-select"}>
      <label className="ai-provider-label">
        <span>{compact ? t("aiProvider.labelShort") : t("aiProvider.label")}</span>
        <select
          className="input input-sm"
          value={provider}
          disabled={disabled || loading}
          title={t("aiProvider.hint")}
          onChange={(e) => void handleChange(e.target.value as AiProviderId)}
        >
          <option value="local">{t("aiProvider.local")}</option>
          <option value="gemini" disabled={!hasGeminiKey}>
            {t("aiProvider.gemini")}
          </option>
        </select>
      </label>
      {!hasGeminiKey && (
        <p className="hint-text ai-provider-hint">{t("aiProvider.needKeyHint")}</p>
      )}
      {errMsg && <p className="error-text">{errMsg}</p>}
    </div>
  );
}
