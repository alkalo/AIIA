import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { SiteConnectorAgent, type SiteConnectionPlan } from "@aiia/agent-engine/browser";
import { api, type CredentialSummary, type OllamaSetupProgress } from "../api";

type WizardStep = "idle" | "plan" | "connect";

export function Settings() {
  const { t, i18n } = useTranslation();
  const [ollamaOk, setOllamaOk] = useState(false);
  const [ollamaInstalled, setOllamaInstalled] = useState(false);
  const [recommendedModel, setRecommendedModel] = useState("");
  const [setupProgress, setSetupProgress] = useState<OllamaSetupProgress | null>(null);
  const [settingUpOllama, setSettingUpOllama] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [hw, setHw] = useState<{ total_ram_gb: number; cpu_cores: number; profile: string } | null>(
    null
  );
  const [dataDir, setDataDir] = useState("");
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [retention, setRetention] = useState("90");

  const [siteName, setSiteName] = useState("");
  const [wizardStep, setWizardStep] = useState<WizardStep>("idle");
  const [plan, setPlan] = useState<SiteConnectionPlan | null>(null);
  const [loginUrl, setLoginUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  const refreshCredentials = () => api.listCredentials().then(setCredentials);

  useEffect(() => {
    api.getOllamaStatus().then((status) => {
      setOllamaOk(status.running);
      setOllamaInstalled(status.installed);
      setRecommendedModel(status.recommendedModel);
    });
    api.getHardwareInfo().then(setHw);
    api.getDataDir().then(setDataDir);
    api.getSetting("retention_days").then((v) => v && setRetention(v));
    refreshCredentials();

    let unlisten: (() => void) | undefined;
    listen<OllamaSetupProgress>("ollama-setup-progress", (event) => {
      setSetupProgress(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      unlisten?.();
    };
  }, []);

  const resetWizard = () => {
    setWizardStep("idle");
    setPlan(null);
    setSiteName("");
    setLoginUrl("");
    setUsername("");
    setPassword("");
    setError("");
  };

  const handleSetupOllama = async () => {
    setSettingUpOllama(true);
    setSetupError("");
    setSetupProgress({ phase: "downloading", percent: 0, message: t("settings.ollamaSetupStarting") });
    try {
      const status = await api.setupOllama(true);
      setOllamaOk(status.running);
      setOllamaInstalled(status.installed);
      setRecommendedModel(status.recommendedModel);
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettingUpOllama(false);
      setSetupProgress(null);
    }
  };

  const handleSaveRetention = async () => {
    await api.setSetting("retention_days", retention);
  };

  const handleAnalyze = async () => {
    if (!siteName.trim()) return;
    if (!ollamaOk) {
      setError(t("settings.ollamaRequired"));
      return;
    }
    setAnalyzing(true);
    setError("");
    try {
      const profile = hw?.profile ?? "medium";
      const connector = new SiteConnectorAgent(profile);
      const lang = i18n.language.startsWith("es") ? "es" : "en";
      const result = await connector.analyzeSite(siteName.trim(), lang);
      setPlan(result);
      setLoginUrl(result.loginUrl);
      setWizardStep("plan");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleConnect = async () => {
    if (!plan || !username.trim()) return;
    setConnecting(true);
    setError("");
    try {
      await api.connectSite({
        siteId: plan.siteId,
        label: plan.label,
        loginUrl: loginUrl.trim() || plan.loginUrl,
        username,
        password,
      });
      await refreshCredentials();
      resetWizard();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await api.deleteCredential(id);
    await refreshCredentials();
  };

  return (
    <div>
      <h2>{t("settings.title")}</h2>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3>{t("settings.ollama")}</h3>
        <p className={ollamaOk ? "status-ok" : "error-text"}>
          {ollamaOk ? t("settings.ollamaOk") : t("settings.ollamaFail")}
        </p>
        {!ollamaOk && (
          <div style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleSetupOllama}
              disabled={settingUpOllama}
            >
              {settingUpOllama
                ? t("settings.ollamaSettingUp")
                : ollamaInstalled
                  ? t("settings.ollamaStart")
                  : t("settings.ollamaInstall")}
            </button>
            {recommendedModel && (
              <p className="hint-text" style={{ marginTop: "0.5rem" }}>
                {t("settings.ollamaModel")}: {recommendedModel}
              </p>
            )}
            {setupProgress && (
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
            {setupError && <p className="error-text">{setupError}</p>}
          </div>
        )}
        {hw && (
          <p>
            {t("settings.hardware")}: {hw.profile} ({hw.total_ram_gb} GB RAM, {hw.cpu_cores} cores)
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3>{t("settings.dataDir")}</h3>
        <code>{dataDir}</code>
        <label>{t("settings.retention")}</label>
        <input
          type="number"
          className="input"
          value={retention}
          onChange={(e) => setRetention(e.target.value)}
          style={{ width: 100 }}
        />
        <button type="button" className="btn btn-sm" onClick={handleSaveRetention}>
          {t("common.save")}
        </button>
      </div>

      <div className="card">
        <h3>{t("settings.credentials")}</h3>
        <p className="hint-text">{t("settings.credentialsHint")}</p>

        {credentials.length > 0 && (
          <div className="credential-list">
            {credentials.map((c) => (
              <div key={c.id} className="credential-item credential-item-row">
                <div>
                  <strong>{c.label}</strong>
                  <span className="muted"> ({c.siteId})</span>
                  {c.hasSession && (
                    <span className="badge badge-ok">{t("settings.connected")}</span>
                  )}
                  {c.loginUrl && <div className="muted small">{c.loginUrl}</div>}
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDelete(c.id)}
                >
                  {t("common.delete")}
                </button>
              </div>
            ))}
          </div>
        )}

        {wizardStep === "idle" && (
          <div className="credential-wizard">
            <label>{t("settings.siteName")}</label>
            <input
              className="input"
              placeholder={t("settings.siteNamePlaceholder")}
              value={siteName}
              onChange={(e) => setSiteName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAnalyze}
              disabled={analyzing || !siteName.trim()}
            >
              {analyzing ? t("settings.analyzing") : t("settings.analyzeWithAi")}
            </button>
          </div>
        )}

        {wizardStep === "plan" && plan && (
          <div className="credential-wizard">
            <div className="plan-summary">
              <p>
                <strong>{plan.label}</strong> — <code>{plan.siteId}</code>
              </p>
              <p className="hint-text">{plan.hints}</p>
            </div>
            <label>{t("settings.loginUrl")}</label>
            <input
              className="input"
              value={loginUrl}
              onChange={(e) => setLoginUrl(e.target.value)}
            />
            <label>{t("settings.username")}</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
            <label>{t("settings.password")}</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <p className="hint-text">{t("settings.connectHint")}</p>
            <div className="wizard-actions">
              <button type="button" className="btn" onClick={resetWizard}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setWizardStep("connect")}
                disabled={!username.trim()}
              >
                {t("settings.continueConnect")}
              </button>
            </div>
          </div>
        )}

        {wizardStep === "connect" && plan && (
          <div className="credential-wizard">
            <p>{t("settings.browserOpening")}</p>
            <div className="wizard-actions">
              <button type="button" className="btn" onClick={() => setWizardStep("plan")}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={connecting}
              >
                {connecting ? t("settings.connecting") : t("settings.connectSite")}
              </button>
            </div>
          </div>
        )}

        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
