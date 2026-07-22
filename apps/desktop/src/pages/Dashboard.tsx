import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { EFFORT_LEVELS, getEffortEstimate } from "@aiia/ollama-client/browser";
import type { EffortLevel } from "@aiia/agent-engine/browser";
import { useAgents, useRunProgress } from "../hooks/useAgents";
import { api } from "../api";
import { ProgressBar } from "../components/ProgressBar";
import { AiProviderSelect } from "../components/AiProviderSelect";
import { useAiProvider } from "../hooks/useAiProvider";

export function Dashboard() {
  const { t } = useTranslation();
  const { agents, loading, refresh } = useAgents();
  const { provider } = useAiProvider();
  const [agentLimits, setAgentLimits] = useState({ published: 0, max: 5 });
  const [trackedAgentId, setTrackedAgentId] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [runInProgress, setRunInProgress] = useState(false);
  const [queueHint, setQueueHint] = useState("");
  const [runEffortOverrides, setRunEffortOverrides] = useState<Record<string, EffortLevel>>({});
  const [zeroResultAgents, setZeroResultAgents] = useState<Set<string>>(new Set());
  const [lastRunComplete, setLastRunComplete] = useState<{
    agentId?: string;
    count?: number;
    summary?: string;
  } | null>(null);
  const { progress, isFinished } = useRunProgress(trackedAgentId, showProgress);
  const [cancellingRun, setCancellingRun] = useState(false);

  const dismissProgress = useCallback(() => {
    setShowProgress(false);
    setTrackedAgentId(null);
    setRunInProgress(false);
  }, []);

  const handleCancelRun = useCallback(async () => {
    const runId = progress?.runId;
    if (!runId) return;
    if (!window.confirm(t("runs.cancelConfirm"))) return;
    setCancellingRun(true);
    try {
      await api.cancelRun(runId);
      setRunInProgress(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCancellingRun(false);
    }
  }, [progress?.runId, t]);

  useEffect(() => {
    api.getAgentLimits().then(setAgentLimits).catch(() => {});
  }, [agents]);

  useEffect(() => {
    if (agents.length === 0) return;
    const check = async () => {
      const zero = new Set<string>();
      await Promise.all(
        agents
          .filter((a) => a.last_run_at)
          .map(async (a) => {
            try {
              const results = await api.listResults(a.id, 1);
              if (results.length === 0) zero.add(a.id);
            } catch {
              /* ignore */
            }
          })
      );
      setZeroResultAgents(zero);
    };
    check();
  }, [agents]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    listen<{ agentId?: string; count?: number; summary?: string }>("agent-run-complete", (event) => {
      setRunInProgress(false);
      setLastRunComplete(event.payload);
      const agentId = event.payload.agentId;
      if (agentId) {
        void api.syncLatestRunResults(agentId).catch(() => undefined);
      }
      refresh({ silent: true });
      api.getAgentLimits().then(setAgentLimits).catch(() => {});
    }).then((fn) => unsubs.push(fn));

    listen<string>("agent-run-error", () => {
      setRunInProgress(false);
      refresh({ silent: true });
    }).then((fn) => unsubs.push(fn));

    listen<{ agentId?: string }>("agent-run-started", (event) => {
      const id = event.payload.agentId;
      if (!id) return;
      setTrackedAgentId(id);
      setShowProgress(true);
      setRunInProgress(true);
      setQueueHint("");
    }).then((fn) => unsubs.push(fn));

    listen("agent-run-cancelled", () => {
      setRunInProgress(false);
      refresh({ silent: true });
    }).then((fn) => unsubs.push(fn));

    return () => unsubs.forEach((fn) => fn());
  }, [refresh]);

  useEffect(() => {
    if (isFinished) setRunInProgress(false);
  }, [isFinished]);

  const handleDelete = async (id: string, name: string) => {
    const running = runInProgress && trackedAgentId === id;
    const msg = running
      ? t("dashboard.deleteRunningConfirm", { name })
      : t("dashboard.deleteConfirm", { name });
    if (!window.confirm(msg)) return;
    try {
      await api.deleteAgent(id);
      if (trackedAgentId === id) dismissProgress();
      setZeroResultAgents((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      refresh({ silent: true });
      api.getAgentLimits().then(setAgentLimits).catch(() => {});
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRun = async (id: string, effort: string) => {
    setLastRunComplete(null);
    setTrackedAgentId(id);
    setShowProgress(true);
    setRunInProgress(true);
    setQueueHint("");
    try {
      const res = await api.runAgent(id, effort);
      if (res.queued) {
        setQueueHint(t("dashboard.runQueued", { position: res.queuePosition }));
        setRunInProgress(false);
      }
    } catch {
      dismissProgress();
    }
    refresh({ silent: true });
    api.getAgentLimits().then(setAgentLimits).catch(() => {});
  };

  const handleDownloadCsv = async (agentId?: string) => {
    try {
      const { csvPath } = await api.exportResultsCsv(agentId);
      await api.openPath(csvPath);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  const initialLoading = loading && agents.length === 0;

  return (
    <div>
      <div className="page-header">
        <h2>{t("dashboard.title")}</h2>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <AiProviderSelect compact disabled={runInProgress} />
          <Link to="/" className="btn btn-sm btn-outline">
            {t("nav.chat")}
          </Link>
          <span className="badge">
            {t("dashboard.slots", { count: agentLimits.published, max: agentLimits.max })}
          </span>
        </div>
      </div>
      <p className="hint-text" style={{ marginTop: "-0.5rem", marginBottom: "1rem" }}>
        {t("dashboard.providerHint", {
          provider: provider === "gemini" ? t("aiProvider.gemini") : t("aiProvider.local"),
        })}
      </p>

      {queueHint && <p className="hint-text">{queueHint}</p>}

      {runInProgress && (
        <p className="hint-text">
          <Link to="/runs">{t("nav.runs")}</Link>
        </p>
      )}

      {lastRunComplete && lastRunComplete.count != null && lastRunComplete.count > 0 && (
        <div className="card run-complete-banner">
          <p>
            <strong>{t("dashboard.runComplete", { count: lastRunComplete.count })}</strong>
            {lastRunComplete.summary && (
              <span className="hint-text"> — {lastRunComplete.summary}</span>
            )}
          </p>
          <div className="run-complete-actions">
            <Link to="/inbox" className="btn btn-sm btn-primary">
              {t("dashboard.viewInbox")}
            </Link>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => handleDownloadCsv(lastRunComplete.agentId)}
            >
              {t("dashboard.downloadCsv")}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => setLastRunComplete(null)}
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      )}

      {showProgress && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <ProgressBar
            phase={progress?.phase ?? "searching"}
            percent={progress?.percent ?? 0}
            message={progress?.message ?? t("common.loading")}
            thinkingStep={progress?.thinkingStep}
            budgetUsedSec={progress?.budgetUsedSec}
            onDismiss={dismissProgress}
            onCancel={progress?.runId ? handleCancelRun : undefined}
            cancelling={cancellingRun}
          />
          {progress?.phase === "cancelled" && (
            <p className="hint-text" style={{ marginTop: "0.5rem" }}>
              <Link to="/runs">{t("dashboard.openRunsToDelete")}</Link>
            </p>
          )}
        </div>
      )}

      {initialLoading ? (
        <p>{t("common.loading")}</p>
      ) : agents.length === 0 ? (
        <div className="empty-state">
          <p>{t("dashboard.empty")}</p>
          <Link to="/create" className="btn btn-primary">
            {t("nav.create")}
          </Link>
        </div>
      ) : (
        <div className="agent-grid">
          {agents.map((agent) => (
            <div key={agent.id} className="card agent-card">
              <div className="agent-header">
                <h3>{agent.spec.name}</h3>
                <span className={`status status-${agent.spec.status}`}>
                  {t(`status.${agent.spec.status}`)}
                </span>
              </div>
              <p className="agent-prompt">{agent.spec.prompt.slice(0, 120)}...</p>
              <div className="agent-meta">
                <span>
                  {t("effort." + agent.spec.effort)} · v{agent.spec.version}
                </span>
                {agent.last_run_at && (
                  <span>
                    {t("dashboard.lastRun")}: {new Date(agent.last_run_at).toLocaleString()}
                  </span>
                )}
              </div>
              {zeroResultAgents.has(agent.id) && (
                <p className="hint-text">
                  {t("dashboard.zeroResultsHint")}{" "}
                  <Link to={`/create?edit=${agent.id}`}>{t("dashboard.editToFix")}</Link>
                </p>
              )}
              {agent.error_message && (
                <p className="error-text">{agent.error_message}</p>
              )}
              {agent.spec.status === "published" && (
                <div className="run-mode-row">
                  <label className="hint-text" htmlFor={`run-effort-${agent.id}`}>
                    {t("dashboard.runMode")}
                  </label>
                  <select
                    id={`run-effort-${agent.id}`}
                    className="input input-sm"
                    value={runEffortOverrides[agent.id] ?? agent.spec.effort}
                    onChange={(e) =>
                      setRunEffortOverrides((prev) => ({
                        ...prev,
                        [agent.id]: e.target.value as EffortLevel,
                      }))
                    }
                    disabled={runInProgress && trackedAgentId === agent.id}
                  >
                    {EFFORT_LEVELS.map((e) => (
                      <option key={e} value={e}>
                        {t(`effort.${e}`)} ({getEffortEstimate(e)})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="agent-actions">
                {agent.spec.status === "published" && (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={runInProgress && trackedAgentId === agent.id}
                      onClick={() =>
                        handleRun(agent.id, runEffortOverrides[agent.id] ?? agent.spec.effort)
                      }
                    >
                      {runInProgress && trackedAgentId === agent.id
                        ? t("common.loading")
                        : t("dashboard.run")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => api.pauseAgent(agent.id).then(() => refresh({ silent: true }))}
                    >
                      {t("dashboard.pause")}
                    </button>
                  </>
                )}
                {(agent.spec.status === "paused" || agent.spec.status === "error") && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => api.resumeAgent(agent.id).then(() => refresh({ silent: true }))}
                  >
                    {t("dashboard.resume")}
                  </button>
                )}
                {agent.spec.status === "pending_review" && (
                  <Link to={`/review/${agent.id}`} className="btn btn-sm btn-primary">
                    {t("dashboard.review")}
                  </Link>
                )}
                <Link to={`/create?edit=${agent.id}`} className="btn btn-sm btn-outline">
                  {t("dashboard.edit")}
                </Link>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={runInProgress && trackedAgentId === agent.id}
                  onClick={() => handleDelete(agent.id, agent.spec.name)}
                >
                  {t("dashboard.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
