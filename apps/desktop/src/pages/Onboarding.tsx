import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { modelIsAvailable } from "@aiia/ollama-client/browser";
import { api, type OllamaSetupProgress } from "../api";
import { OLLAMA_DOWNLOAD_URL } from "../ollama-desktop";

interface Props {
  onComplete: () => void;
}

type SetupPhase = "idle" | "checking" | "needs_install" | "needs_prepare" | "setup" | "ready" | "error";

export function Onboarding({ onComplete }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<SetupPhase>("checking");
  const [ollamaOk, setOllamaOk] = useState(false);
  const [ollamaInstalled, setOllamaInstalled] = useState(false);
  const [hw, setHw] = useState<string>("");
  const [recommendedModel, setRecommendedModel] = useState("");
  const [setupProgress, setSetupProgress] = useState<OllamaSetupProgress | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const run = async () => {
      try {
        unlisten = await listen<OllamaSetupProgress>("ollama-setup-progress", (event) => {
          setSetupProgress(event.payload);
        });
      } catch {
        /* browser dev without Tauri */
      }

      setPhase("checking");

      try {
        const hwInfo = await api.getHardwareInfo();
        setHw(`${hwInfo.profile} (${hwInfo.total_ram_gb} GB)`);
      } catch {
        setHw("—");
      }

      try {
        const status = await api.getOllamaStatus();
        setRecommendedModel(status.recommendedModel);
        setOllamaInstalled(status.installed);

        const hasModel = modelIsAvailable(status.models, status.recommendedModel);
        if (status.installed && status.running && hasModel) {
          setOllamaOk(true);
          setPhase("ready");
          return;
        }

        if (!status.installed) {
          setPhase("needs_install");
          return;
        }

        setPhase("needs_prepare");
      } catch {
        setPhase("needs_install");
      }
    };

    run();
    return () => {
      unlisten?.();
    };
  }, []);

  const startPrepare = async () => {
    setPhase("setup");
    setError("");
    setSetupProgress({ phase: "starting", percent: 0, message: t("onboarding.setupStarting") });
    try {
      const status = await api.setupOllama(true);
      setOllamaOk(status.running && modelIsAvailable(status.models, status.recommendedModel));
      setOllamaInstalled(status.installed);
      setRecommendedModel(status.recommendedModel);
      setPhase(status.running ? "ready" : "needs_prepare");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const openOllamaDownload = () => {
    void api.openUrl(OLLAMA_DOWNLOAD_URL);
  };

  const canContinue = phase === "ready" && ollamaOk;

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <h1>{t("onboarding.title")}</h1>
        <p>{t("onboarding.subtitle")}</p>
        <ul className="onboarding-steps">
          <li className={phase !== "checking" ? "done" : ""}>
            {t("onboarding.checkOllama")}{" "}
            {phase !== "checking" && (ollamaOk ? "✓" : phase === "setup" ? "…" : "✗")}
          </li>
          <li className={hw ? "done" : ""}>
            {t("onboarding.checkHw")} {hw && `— ${hw}`}
          </li>
          {recommendedModel && (
            <li className={ollamaOk ? "done" : ""}>
              {t("onboarding.model")}: {recommendedModel}
            </li>
          )}
        </ul>

        {(phase === "needs_install" || phase === "needs_prepare") && (
          <div className="onboarding-manual">
            <p className="hint-text">{t("onboarding.manualHint")}</p>
            <p className="hint-text">{t("onboarding.defenderHint")}</p>
            {!ollamaInstalled && (
              <button type="button" className="btn btn-outline" onClick={openOllamaDownload}>
                {t("onboarding.openOllamaDownload")}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={startPrepare}>
              {ollamaInstalled ? t("onboarding.prepareModels") : t("onboarding.checkInstalled")}
            </button>
          </div>
        )}

        {phase === "setup" && setupProgress && (
          <div className="onboarding-progress">
            <p className="hint-text">{setupProgress.message}</p>
            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{ width: `${Math.max(setupProgress.percent, 4)}%` }}
              />
            </div>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}

        {phase === "error" && (
          <button type="button" className="btn btn-primary" onClick={startPrepare}>
            {t("onboarding.retrySetup")}
          </button>
        )}

        {canContinue && (
          <button type="button" className="btn btn-primary" onClick={onComplete}>
            {t("onboarding.continue")}
          </button>
        )}
      </div>
    </div>
  );
}
