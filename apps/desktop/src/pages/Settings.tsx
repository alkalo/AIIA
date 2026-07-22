import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { SiteConnectorAgent, type SiteConnectionPlan } from "@aiia/agent-engine/browser";
import {
  DesktopLlmClient,
  formatOllamaError,
  OLLAMA_DOWNLOAD_URL,
  prepareOllamaForPlanner,
} from "../ollama-desktop";
import { api, type CredentialSummary, type OllamaSetupProgress, type UpdateStatus, type AppInfo, type AiProviderId } from "../api";

type WizardStep = "idle" | "plan" | "connect";

export function Settings() {
  const { t, i18n } = useTranslation();
  const [ollamaOk, setOllamaOk] = useState(false);
  const [ollamaInstalled, setOllamaInstalled] = useState(false);
  const [recommendedModel, setRecommendedModel] = useState("");
  const [setupProgress, setSetupProgress] = useState<OllamaSetupProgress | null>(null);
  const [settingUpOllama, setSettingUpOllama] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [hw, setHw] = useState<{ total_ram_gb: number; available_ram_gb?: number; cpu_cores: number; profile: string } | null>(
    null
  );
  const [dataDir, setDataDir] = useState("");
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [retention, setRetention] = useState("90");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [updateError, setUpdateError] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProviderId>("local");
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [geminiMsg, setGeminiMsg] = useState("");
  const [geminiErr, setGeminiErr] = useState("");

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
    api.getAppInfo().then(setAppInfo);
    api.getUpdatePrefs().then((prefs) => setAutoUpdate(prefs.autoUpdateOnStartup));
    api.getAiProviderStatus().then((s) => {
      setAiProvider(s.provider === "gemini" ? "gemini" : "local");
      setHasGeminiKey(s.hasGeminiKey);
    });
    refreshCredentials();

    let unlistenUpdate: (() => void) | undefined;
    listen<UpdateStatus>("update-status", (event) => {
      setUpdateStatus(event.payload);
    })
      .then((fn) => {
        unlistenUpdate = fn;
      })
      .catch(() => undefined);

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
      unlistenUpdate?.();
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
    setSetupProgress({ phase: "starting", percent: 0, message: t("settings.ollamaSetupStarting") });
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

  const handleOpenOllamaDownload = () => {
    void api.openUrl(OLLAMA_DOWNLOAD_URL);
  };

  const handleSaveRetention = async () => {
    await api.setSetting("retention_days", retention);
  };

  const handleCheckUpdates = async () => {
    setUpdateBusy(true);
    setUpdateError("");
    setUpdateStatus({ phase: "checking", message: t("settings.checkingUpdates") });
    try {
      const result = await api.checkForUpdates(true, true);
      if (result.busy) {
        setUpdateError(t("settings.checkingUpdates"));
        return;
      }
      if (result.dev) {
        setUpdateStatus({ phase: "idle", message: t("settings.updateDevMode") });
        return;
      }
      if (result.error) {
        setUpdateError(result.error);
      }
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdateBusy(false);
    }
  };

  const handleAutoUpdateToggle = async (enabled: boolean) => {
    setAutoUpdate(enabled);
    await api.setUpdatePrefs(enabled);
  };

  const applyProviderStatus = (s: { provider: string; hasGeminiKey: boolean }) => {
    setAiProvider(s.provider === "gemini" ? "gemini" : "local");
    setHasGeminiKey(s.hasGeminiKey);
  };

  const handleProviderChange = async (next: AiProviderId) => {
    setGeminiErr("");
    setGeminiMsg("");
    if (next === "gemini" && !hasGeminiKey) {
      setGeminiErr(t("settings.geminiNeedKey"));
      return;
    }
    try {
      const s = await api.setAiProvider(next);
      applyProviderStatus(s);
    } catch (e) {
      setGeminiErr(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveGeminiKey = async () => {
    if (!geminiKeyInput.trim()) return;
    setGeminiBusy(true);
    setGeminiErr("");
    setGeminiMsg("");
    try {
      const s = await api.setGeminiApiKey(geminiKeyInput.trim());
      applyProviderStatus(s);
      setGeminiKeyInput("");
      setGeminiMsg(t("settings.geminiKeySaved"));
    } catch (e) {
      setGeminiErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGeminiBusy(false);
    }
  };

  const handleClearGeminiKey = async () => {
    setGeminiBusy(true);
    setGeminiErr("");
    setGeminiMsg("");
    try {
      const s = await api.clearGeminiApiKey();
      applyProviderStatus(s);
      setGeminiMsg("");
    } catch (e) {
      setGeminiErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGeminiBusy(false);
    }
  };

  const handleTestGeminiKey = async () => {
    setGeminiBusy(true);
    setGeminiErr("");
    setGeminiMsg("");
    try {
      await api.testGeminiApiKey(geminiKeyInput.trim() || undefined);
      setGeminiMsg(t("settings.geminiTestOk"));
    } catch (e) {
      setGeminiErr(e instanceof Error ? e.message : String(e));
    } finally {
      setGeminiBusy(false);
    }
  };

  const updateProgress =
    updateStatus?.phase === "downloading" && updateStatus.percent != null
      ? updateStatus.percent
      : null;

  const handleAnalyze = async () => {
    if (!siteName.trim()) return;
    setAnalyzing(true);
    setError("");
    try {
      const profile = hw?.profile ?? "medium";
      await prepareOllamaForPlanner(profile);
      const connector = new SiteConnectorAgent(profile, new DesktopLlmClient());
      const lang = i18n.language.startsWith("es") ? "es" : "en";
      const result = await connector.analyzeSite(siteName.trim(), lang);
      setPlan(result);
      setLoginUrl(result.loginUrl);
      setWizardStep("plan");
    } catch (e) {
      setError(formatOllamaError(e));
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
        <h3>{t("settings.aiProvider")}</h3>
        <p className="hint-text">{t("settings.aiProviderHint")}</p>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <input
              type="radio"
              name="ai-provider"
              checked={aiProvider === "local"}
              onChange={() => void handleProviderChange("local")}
            />
            {t("settings.providerLocal")}
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              opacity: hasGeminiKey ? 1 : 0.55,
            }}
            title={hasGeminiKey ? undefined : t("settings.geminiNeedKey")}
          >
            <input
              type="radio"
              name="ai-provider"
              checked={aiProvider === "gemini"}
              disabled={!hasGeminiKey}
              onChange={() => void handleProviderChange("gemini")}
            />
            {t("settings.providerGemini")}
          </label>
        </div>
        <label style={{ marginTop: "0.75rem", display: "block" }}>{t("settings.geminiApiKey")}</label>
        <p className="hint-text">
          {hasGeminiKey ? t("settings.geminiKeySaved") : t("settings.geminiKeyMissing")}
        </p>
        <input
          type="password"
          className="input"
          autoComplete="off"
          placeholder={t("settings.geminiApiKeyPlaceholder")}
          value={geminiKeyInput}
          onChange={(e) => setGeminiKeyInput(e.target.value)}
          style={{ maxWidth: 420 }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={geminiBusy || !geminiKeyInput.trim()}
            onClick={() => void handleSaveGeminiKey()}
          >
            {t("settings.geminiSaveKey")}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={geminiBusy || (!geminiKeyInput.trim() && !hasGeminiKey)}
            onClick={() => void handleTestGeminiKey()}
          >
            {geminiBusy ? t("settings.geminiTesting") : t("settings.geminiTestKey")}
          </button>
          {hasGeminiKey && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              disabled={geminiBusy}
              onClick={() => void handleClearGeminiKey()}
            >
              {t("settings.geminiClearKey")}
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => void api.openUrl("https://aistudio.google.com/apikey")}
          >
            {t("settings.geminiGetKey")}
          </button>
        </div>
        {geminiMsg && <p className="status-ok" style={{ marginTop: "0.5rem" }}>{geminiMsg}</p>}
        {geminiErr && <p className="error-text" style={{ marginTop: "0.5rem" }}>{geminiErr}</p>}
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3>{t("settings.ollama")}</h3>
        <p className={ollamaOk ? "status-ok" : "error-text"}>
          {ollamaOk ? t("settings.ollamaOk") : t("settings.ollamaFail")}
        </p>
        {!ollamaOk && (
          <div style={{ marginTop: "0.75rem" }}>
            <p className="hint-text">{t("settings.ollamaManualHint")}</p>
            <p className="hint-text">{t("settings.ollamaDefenderHint")}</p>
            {!ollamaInstalled && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleOpenOllamaDownload}
                style={{ marginTop: "0.5rem", marginRight: "0.5rem" }}
              >
                {t("settings.ollamaOpenDownload")}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleSetupOllama}
              disabled={settingUpOllama}
              style={{ marginTop: "0.5rem" }}
            >
              {settingUpOllama
                ? t("settings.ollamaSettingUp")
                : ollamaInstalled
                  ? t("settings.ollamaStart")
                  : t("settings.ollamaCheckInstalled")}
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
            {t("settings.hardware")}: {hw.profile} ({hw.total_ram_gb} GB RAM
            {hw.available_ram_gb != null ? `, ${hw.available_ram_gb} GB free` : ""}, {hw.cpu_cores}{" "}
            cores)
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

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3>{t("settings.app")}</h3>
        <p>
          {t("settings.appVersion")}: <strong>v{appInfo?.version ?? "…"}</strong>
        </p>
        {appInfo?.updateSupported ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleCheckUpdates}
              disabled={updateBusy}
              style={{ marginTop: "0.5rem" }}
            >
              {updateBusy ? t("settings.checkingUpdates") : t("settings.checkUpdates")}
            </button>
            {updateStatus?.message && (
              <p className="hint-text" style={{ marginTop: "0.5rem" }}>
                {updateStatus.message}
                {updateStatus.version && updateStatus.phase !== "idle"
                  ? ` (v${updateStatus.version})`
                  : ""}
              </p>
            )}
            {updateStatus?.releaseNotes && updateStatus.phase === "available" && (
              <pre
                className="hint-text"
                style={{ marginTop: "0.5rem", whiteSpace: "pre-wrap", fontSize: "0.85rem" }}
              >
                {updateStatus.releaseNotes}
              </pre>
            )}
            {updateProgress != null && (
              <div className="onboarding-progress" style={{ marginTop: "0.5rem" }}>
                <div className="progress-bar-track">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${Math.max(updateProgress, 4)}%` }}
                  />
                </div>
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem" }}>
              <input
                type="checkbox"
                checked={autoUpdate}
                onChange={(e) => void handleAutoUpdateToggle(e.target.checked)}
              />
              {t("settings.autoUpdate")}
            </label>
          </>
        ) : (
          <p className="hint-text">{t("settings.updateDevMode")}</p>
        )}
        {updateError && <p className="error-text">{updateError}</p>}
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginTop: "0.5rem" }}
          onClick={() => void api.openUrl("https://github.com/alkalo/AIIA/releases/latest")}
        >
          {t("settings.openReleases")}
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
