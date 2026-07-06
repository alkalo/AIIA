import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { api, type OllamaSetupProgress } from "../api";

interface Props {
  onComplete: () => void;
}

type SetupPhase = "idle" | "checking" | "setup" | "ready" | "error";

export function Onboarding({ onComplete }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<SetupPhase>("checking");
  const [ollamaOk, setOllamaOk] = useState(false);
  const [hw, setHw] = useState<string>("");
  const [recommendedModel, setRecommendedModel] = useState("");
  const [setupProgress, setSetupProgress] = useState<OllamaSetupProgress | null>(null);
  const [error, setError] = useState("");
  const setupStarted = useRef(false);

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
      let hwInfo: { total_ram_gb: number; profile: string } | null = null;

      try {
        hwInfo = await api.getHardwareInfo();
        setHw(`${hwInfo.profile} (${hwInfo.total_ram_gb} GB)`);
      } catch {
        setHw("—");
      }

      try {
        const status = await api.getOllamaStatus();
        setRecommendedModel(status.recommendedModel);
        const hasModel = status.models.some((m) =>
          m.startsWith(status.recommendedModel)
        );
        if (status.running && hasModel) {
          setOllamaOk(true);
          setPhase("ready");
          return;
        }
      } catch {
        /* fall through to setup */
      }

      if (!setupStarted.current) {
        setupStarted.current = true;
        await startSetup();
      }
    };

    run();
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSetup = async () => {
    setPhase("setup");
    setError("");
    setSetupProgress({ phase: "downloading", percent: 0, message: t("onboarding.setupStarting") });
    try {
      const status = await api.setupOllama(true);
      setOllamaOk(status.running);
      setRecommendedModel(status.recommendedModel);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
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
          <button type="button" className="btn btn-primary" onClick={startSetup}>
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
