import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { api, type RunExecution } from "../api";
import { useAgents } from "../hooks/useAgents";
import { getEffortEstimate } from "@aiia/ollama-client/browser";
import type { EffortLevel } from "@aiia/agent-engine/browser";
import { RunLogViewer } from "../components/RunLogViewer";

const ACTIVE_STATUSES = new Set(["running", "queued", "starting"]);

export function Runs() {
  const { t } = useTranslation();
  const { agents } = useAgents();
  const [runs, setRuns] = useState<RunExecution[]>([]);
  const [filterAgent, setFilterAgent] = useState("");
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [logViewer, setLogViewer] = useState<RunExecution | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listRuns(filterAgent || undefined, 50);
      setRuns(data);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [filterAgent]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    const hasActive = runs.some((r) => ACTIVE_STATUSES.has(r.status));
    if (!hasActive) return;
    const interval = setInterval(refresh, 1000);
    return () => clearInterval(interval);
  }, [runs, refresh]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const events = ["agent-run-started", "agent-run-complete", "agent-run-error", "agent-run-cancelled", "agent-run-queued"];
    for (const ev of events) {
      listen(ev, () => refresh()).then((fn) => unsubs.push(fn));
    }
    return () => unsubs.forEach((fn) => fn());
  }, [refresh]);

  const handleCancel = async (runId: string) => {
    if (!window.confirm(t("runs.cancelConfirm"))) return;
    setCancelling(runId);
    try {
      await api.cancelRun(runId);
      await refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(null);
    }
  };

  const handleDelete = async (run: RunExecution) => {
    if (run.cancellable || ACTIVE_STATUSES.has(run.status)) {
      window.alert(t("runs.deleteRunning"));
      return;
    }
    if (!window.confirm(t("runs.deleteConfirm"))) return;
    setDeleting(run.runId);
    try {
      await api.deleteRun(run.runId);
      if (logViewer?.runId === run.runId) setLogViewer(null);
      await refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  };

  const openLog = (run: RunExecution) => {
    setLogViewer(run);
  };

  if (loading && runs.length === 0) return <p>{t("common.loading")}</p>;

  return (
    <div>
      {logViewer && (
        <RunLogViewer
          runId={logViewer.runId}
          agentId={logViewer.agentId}
          agentName={logViewer.agentName}
          isLive={ACTIVE_STATUSES.has(logViewer.status)}
          onClose={() => setLogViewer(null)}
        />
      )}
      <div className="page-header">
        <h2>{t("runs.title")}</h2>
        <div className="runs-toolbar">
          <select
            className="input"
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            style={{ width: 220 }}
          >
            <option value="">{t("runs.allAgents")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.spec.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => refresh()}>
            {t("runs.refresh")}
          </button>
        </div>
      </div>

      {runs.length === 0 ? (
        <p>{t("runs.empty")}</p>
      ) : (
        <div className="results-table-wrap">
          <table className="results-table runs-table">
            <thead>
              <tr>
                <th>{t("runs.agent")}</th>
                <th>{t("runs.mode")}</th>
                <th>{t("runs.status")}</th>
                <th>{t("runs.progress")}</th>
                <th>{t("runs.results")}</th>
                <th>{t("runs.started")}</th>
                <th>{t("runs.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const canCancel = run.cancellable === true;
                const canDelete = !canCancel && !ACTIVE_STATUSES.has(run.status);
                return (
                  <tr key={run.runId} className={`run-row run-status-${run.status}`}>
                    <td>{run.agentName}</td>
                    <td>
                      {t(`effort.${run.effort as EffortLevel}`, run.effort)} (
                      {getEffortEstimate(run.effort)})
                    </td>
                    <td>
                      <span className={`status-badge status-${run.status}`}>
                        {t(`runs.status_${run.status}`, run.status)}
                      </span>
                      {run.queuePosition != null && (
                        <span className="hint-text"> #{run.queuePosition}</span>
                      )}
                    </td>
                    <td>
                      {ACTIVE_STATUSES.has(run.status) ? (
                        <div className="run-progress-cell">
                          <div className="run-progress-bar">
                            <div className="run-progress-fill" style={{ width: `${Math.min(100, run.percent)}%` }} />
                          </div>
                          <span className="hint-text run-progress-label">
                            <span className="run-live-dot" title={t("runs.logLive")} />
                            {t(`progress.${run.phase}`, { defaultValue: run.phase })} · {run.percent}%
                            {run.message ? ` — ${run.message.slice(0, 80)}` : ""}
                          </span>
                        </div>
                      ) : (
                        <span className="hint-text">{run.summary || run.message || "—"}</span>
                      )}
                    </td>
                    <td>{run.resultsCount > 0 ? run.resultsCount : "—"}</td>
                    <td>{new Date(run.startedAt).toLocaleString()}</td>
                    <td className="runs-actions">
                      {canCancel && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          disabled={cancelling === run.runId}
                          onClick={() => handleCancel(run.runId)}
                        >
                          {cancelling === run.runId ? t("common.loading") : t("runs.cancel")}
                        </button>
                      )}
                      {run.resultsCount > 0 && (
                        <Link
                          to={`/inbox?agent=${run.agentId}`}
                          className="btn btn-sm btn-outline"
                        >
                          {t("runs.viewResults")}
                        </Link>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => openLog(run)}
                      >
                        {t("runs.viewLog")}
                      </button>
                      {canDelete && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          disabled={deleting === run.runId}
                          onClick={() => handleDelete(run)}
                        >
                          {deleting === run.runId ? t("common.loading") : t("runs.delete")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
