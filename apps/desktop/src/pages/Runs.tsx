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

type RunReport = {
  path: string;
  agentId: string;
  runId?: string;
  count?: number;
  sourceHealth?: string;
  regionCoverage?: string[];
  regionGaps?: string[];
  serpExhausted?: boolean;
  listingExpandCount?: number;
  depth2Count?: number;
  feedItemCount?: number;
  seedCount?: number;
  gapFillCount?: number;
  serpEngineHits?: Record<string, number>;
  feedSkippedCount?: number;
  feedFailCount?: number;
  originCounts?: Record<string, number>;
  updatedAtMs: number;
};

export function Runs() {
  const { t } = useTranslation();
  const { agents } = useAgents();
  const [runs, setRuns] = useState<RunExecution[]>([]);
  const [filterAgent, setFilterAgent] = useState("");
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [logViewer, setLogViewer] = useState<RunExecution | null>(null);
  const [agentReport, setAgentReport] = useState<RunReport | null>(null);
  const [healthTrend, setHealthTrend] = useState("");
  const [healthRun, setHealthRun] = useState<RunExecution | null>(null);
  const [healthReport, setHealthReport] = useState<RunReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

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

  const loadAgentReport = useCallback(async () => {
    if (!filterAgent) {
      setAgentReport(null);
      setHealthTrend("");
      return;
    }
    try {
      const [report, hist] = await Promise.all([
        api.getLatestRunReport(filterAgent),
        api.getHealthHistory(filterAgent, 8),
      ]);
      setAgentReport(report);
      setHealthTrend(hist.trend || "");
    } catch {
      setAgentReport(null);
      setHealthTrend("");
    }
  }, [filterAgent]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    void loadAgentReport();
  }, [loadAgentReport]);

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
      listen(ev, () => {
        void refresh();
        void loadAgentReport();
      }).then((fn) => unsubs.push(fn));
    }
    return () => unsubs.forEach((fn) => fn());
  }, [refresh, loadAgentReport]);

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
    const active = run.cancellable || ACTIVE_STATUSES.has(run.status);
    if (active && run.status !== "cancelled") {
      window.alert(t("runs.deleteRunning"));
      return;
    }
    if (!window.confirm(t("runs.deleteConfirm"))) return;
    setDeleting(run.runId);
    try {
      await api.deleteRun(run.runId);
      if (logViewer?.runId === run.runId) setLogViewer(null);
      if (healthRun?.runId === run.runId) {
        setHealthRun(null);
        setHealthReport(null);
      }
      await refresh();
      void loadAgentReport();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  };

  const openLog = (run: RunExecution) => {
    setLogViewer(run);
  };

  const openHealth = async (run: RunExecution) => {
    setHealthRun(run);
    setHealthLoading(true);
    setHealthReport(null);
    try {
      const report = await api.getLatestRunReport(run.agentId, run.runId);
      setHealthReport(report);
    } catch {
      setHealthReport(null);
    } finally {
      setHealthLoading(false);
    }
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

      {filterAgent && (agentReport || healthTrend) && (
        <section
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            border: "1px solid var(--border, #ddd)",
            borderRadius: 8,
            background: "var(--surface-2, #f7f7f5)",
          }}
        >
          <h3 style={{ margin: "0 0 0.35rem", fontSize: "0.95rem" }}>{t("runs.healthLatest")}</h3>
          {agentReport && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem 1rem", fontSize: "0.88rem" }}>
              {typeof agentReport.count === "number" && <span>{agentReport.count} results</span>}
              {typeof agentReport.seedCount === "number" && <span>Seeds: {agentReport.seedCount}</span>}
              {typeof agentReport.feedItemCount === "number" && <span>RSS: {agentReport.feedItemCount}</span>}
              {typeof agentReport.feedSkippedCount === "number" && agentReport.feedSkippedCount > 0 && (
                <span>
                  {t("runs.healthFeedCooldown")}: {agentReport.feedSkippedCount}
                </span>
              )}
              {typeof agentReport.feedFailCount === "number" && agentReport.feedFailCount > 0 && (
                <span>
                  {t("runs.healthFeedFail")}: {agentReport.feedFailCount}
                </span>
              )}
              {typeof agentReport.listingExpandCount === "number" && (
                <span>Expand: {agentReport.listingExpandCount}</span>
              )}
              {typeof agentReport.gapFillCount === "number" && agentReport.gapFillCount > 0 && (
                <span>
                  {t("runs.healthGapFill")}: {agentReport.gapFillCount}
                </span>
              )}
              {agentReport.serpEngineHits &&
                Object.keys(agentReport.serpEngineHits).length > 0 && (
                  <span>
                    {t("runs.healthSerp")}:{" "}
                    {Object.entries(agentReport.serpEngineHits)
                      .filter(([, n]) => n > 0)
                      .sort((a, b) => b[1] - a[1])
                      .map(([e, n]) => {
                        const label =
                          e === "brave-api"
                            ? "Brave API"
                            : e === "brave"
                              ? "Brave HTML"
                              : e === "duckduckgo-html"
                                ? "DDG"
                                : e === "duckduckgo-lite"
                                  ? "DDG-Lite"
                                  : e;
                        return `${label}:${n}`;
                      })
                      .join(" · ")}
                  </span>
                )}
              {agentReport.originCounts &&
                Object.keys(agentReport.originCounts).length > 0 && (
                  <span>
                    {t("runs.healthOrigin")}:{" "}
                    {Object.entries(agentReport.originCounts)
                      .filter(([, n]) => n > 0)
                      .sort((a, b) => b[1] - a[1])
                      .map(([e, n]) => {
                        const label =
                          e === "portal-seed"
                            ? "Seeds"
                            : e === "listing-expand"
                              ? "Expand"
                              : e === "gap-fill"
                                ? "Gap-fill"
                                : e === "depth-2"
                                  ? "Depth-2"
                                  : e === "rss"
                                    ? "RSS"
                                    : e === "serp"
                                      ? "SERP"
                                      : e === "other"
                                        ? "Other"
                                        : e;
                        return `${label}:${n}`;
                      })
                      .join(" · ")}
                  </span>
                )}
              {agentReport.serpExhausted && (
                <span style={{ color: "var(--danger, #b42318)", fontWeight: 600 }}>
                  {t("runs.healthSerpBlocked")}
                </span>
              )}
              {agentReport.regionGaps && agentReport.regionGaps.length > 0 && (
                <span>
                  {t("runs.healthGaps")}: {agentReport.regionGaps.join(", ")}
                </span>
              )}
            </div>
          )}
          {healthTrend && (
            <p className="hint-text" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
              {t("runs.healthTrend")}: {healthTrend}
            </p>
          )}
          <Link to={`/inbox?agent=${filterAgent}`} className="btn btn-sm btn-outline" style={{ marginTop: "0.5rem" }}>
            {t("runs.viewResults")}
          </Link>
        </section>
      )}

      {healthRun && (
        <section
          style={{
            marginBottom: "1rem",
            padding: "0.85rem 1rem",
            border: "1px solid var(--border, #ddd)",
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "0.95rem" }}>
              {t("runs.healthForRun")} — {healthRun.agentName}
            </h3>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setHealthRun(null)}>
              {t("common.close", { defaultValue: "Close" })}
            </button>
          </div>
          {healthLoading ? (
            <p>{t("common.loading")}</p>
          ) : healthReport ? (
            <>
              {healthReport.serpExhausted && (
                <p style={{ color: "var(--danger, #b42318)", fontWeight: 600 }}>
                  {t("runs.healthSerpBlocked")}
                </p>
              )}
              {healthReport.sourceHealth ? (
                <pre
                  style={{
                    marginTop: "0.5rem",
                    padding: "0.6rem 0.75rem",
                    fontSize: "0.8rem",
                    whiteSpace: "pre-wrap",
                    maxHeight: 180,
                    overflow: "auto",
                    background: "var(--surface-2, #f7f7f5)",
                    borderRadius: 6,
                  }}
                >
                  {healthReport.sourceHealth}
                </pre>
              ) : (
                <p className="hint-text">{t("runs.healthNone")}</p>
              )}
              {healthReport.path && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  style={{ marginTop: "0.5rem" }}
                  onClick={() => void api.openPath(healthReport.path)}
                >
                  {t("runs.healthOpenReport")}
                </button>
              )}
            </>
          ) : (
            <p className="hint-text">{t("runs.healthNone")}</p>
          )}
        </section>
      )}

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
                const canCancel = run.cancellable === true && run.status !== "cancelled";
                const canDelete =
                  run.status === "cancelled" ||
                  (!canCancel && !ACTIVE_STATUSES.has(run.status));
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
                      {!ACTIVE_STATUSES.has(run.status) && run.status !== "queued" && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => void openHealth(run)}
                        >
                          {t("runs.viewHealth")}
                        </button>
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
