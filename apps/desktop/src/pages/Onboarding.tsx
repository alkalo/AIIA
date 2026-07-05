import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";

interface Props {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [ollamaOk, setOllamaOk] = useState(false);
  const [hw, setHw] = useState<string>("");

  useEffect(() => {
    const run = async () => {
      setStep(1);
      try {
        const ok = await api.checkOllama();
        setOllamaOk(ok);
      } catch {
        setOllamaOk(false);
      }
      setStep(2);
      try {
        const info = await api.getHardwareInfo();
        setHw(`${info.profile} (${info.total_ram_gb} GB)`);
      } catch {
        setHw("—");
      }
      setStep(3);
    };
    run();
  }, []);

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <h1>{t("onboarding.title")}</h1>
        <p>{t("onboarding.subtitle")}</p>
        <ul className="onboarding-steps">
          <li className={step >= 1 ? "done" : ""}>
            {t("onboarding.checkOllama")} {step >= 1 && (ollamaOk ? "✓" : "✗")}
          </li>
          <li className={step >= 2 ? "done" : ""}>
            {t("onboarding.checkHw")} {hw && `— ${hw}`}
          </li>
        </ul>
        {step >= 3 && (
          <button type="button" className="btn btn-primary" onClick={onComplete}>
            {t("onboarding.continue")}
          </button>
        )}
      </div>
    </div>
  );
}
