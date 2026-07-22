import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { api, type ResultRecord } from "../api";
import { useAgents } from "../hooks/useAgents";
import {
  PlannerAgent,
  formatResultTitle,
  formatResultLocation,
  resolvePostingUrl,
  postingLinkLabel,
  postingHost,
  sanitizeFieldValue,
  getOpportunityDisplayMode,
} from "@aiia/agent-engine/browser";
import { OpportunityCard } from "../components/OpportunityCard";
import { DesktopLlmClient, prepareOllamaForPlanner } from "../ollama-desktop";

export function Inbox() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const { agents } = useAgents();
  const [results, setResults] = useState<ResultRecord[]>([]);
  const [filterAgent, setFilterAgent] = useState<string>(searchParams.get("agent") ?? "");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [hideDismissed, setHideDismissed] = useState(false);

  const lang = i18n.language.startsWith("es") ? "es" : "en";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (filterAgent) {
        try {
          await api.syncLatestRunResults(filterAgent);
        } catch (e) {
          console.warn("Inbox sync failed", e);
        }
      }
      const data = await api.listResults(filterAgent || undefined, 200);
      setResults(data);
    } catch (e) {
      console.warn("Inbox list failed", e);
      // Keep previous results if list fails; only clear when we have no prior data.
      setResults((prev) => prev);
    } finally {
      setLoading(false);
    }
  }, [filterAgent]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    listen<{ agentId?: string }>("agent-run-complete", (event) => {
      const agentId = event.payload.agentId;
      if (agentId) {
        void api
          .syncLatestRunResults(agentId)
          .catch((e) => console.warn("Inbox sync on complete failed", e))
          .finally(() => {
            void refresh();
          });
      } else {
        void refresh();
      }
    }).then((fn) => unsubs.push(fn));
    return () => unsubs.forEach((fn) => fn());
  }, [refresh]);

  const visibleResults = useMemo(() => {
    let list = results;
    if (hideDismissed) {
      list = list.filter((r) => r.feedback !== "not_useful");
    }
    return list;
  }, [results, hideDismissed]);

  const downloadFormats = useMemo<Array<"csv" | "excel" | "json">>(() => {
    const selected = agents.find((a) => a.id === filterAgent);
    const dest = selected?.spec.output.destinations ?? [];
    const formats: Array<"csv" | "excel" | "json"> = ["csv"];
    if (selected && dest.includes("excel")) formats.push("excel");
    formats.push("json");
    return formats;
  }, [agents, filterAgent]);

  const handleDownload = async (format: "csv" | "excel" | "json") => {
    setExporting(true);
    try {
      const { csvPath } = await api.exportResultsAs(format, filterAgent || undefined);
      await api.openPath(csvPath);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (resultId: string) => {
    if (!window.confirm(t("inbox.deleteResultConfirm"))) return;
    setDeleting(resultId);
    try {
      await api.deleteResult(resultId);
      setResults((prev) => prev.filter((r) => r.id !== resultId));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm(t("inbox.clearAllConfirm"))) return;
    setClearing(true);
    try {
      await api.clearResults(filterAgent || undefined);
      setResults([]);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setClearing(false);
    }
  };

  const handleFeedback = async (resultId: string, feedback: "useful" | "not_useful") => {
    const result = results.find((r) => r.id === resultId);
    setResults((prev) =>
      prev.map((r) => (r.id === resultId ? { ...r, feedback } : r))
    );
    try {
      await api.setResultFeedback(resultId, feedback);
    } catch (e) {
      setResults((prev) =>
        prev.map((r) => (r.id === resultId ? { ...r, feedback: result?.feedback } : r))
      );
      window.alert(e instanceof Error ? e.message : String(e));
      return;
    }

    if (result && feedback === "not_useful") {
      void autoImproveAgent(result);
    }
  };

  const autoImproveAgent = async (result: ResultRecord) => {
    try {
      const agent = agents.find((a) => a.id === result.agentId);
      if (!agent) return;
      const hw = await api.getHardwareInfo();
      await prepareOllamaForPlanner(hw.profile).catch(() => undefined);
      const planner = new PlannerAgent(new DesktopLlmClient(), hw.profile);
      const suggestions = await planner.suggestImprovements(agent.spec, {
        useful: [],
        notUseful: [JSON.stringify(result.data)],
      });
      if (Object.keys(suggestions).length > 0) {
        const improved = { ...agent.spec, ...suggestions, version: agent.spec.version + 1 };
        await api.saveAgent(improved);
      }
    } catch {
      /* best-effort */
    }
  };

  const selectedAgent = agents.find((a) => a.id === filterAgent);
  const cardView = selectedAgent
    ? getOpportunityDisplayMode(selectedAgent.spec) === "card"
    : false;

  if (loading) return <p>{t("common.loading")}</p>;

  return (
    <div>
      <div className="page-header">
        <h2>{t("inbox.title")}</h2>
        <div className="inbox-toolbar">
          <select
            className="input"
            value={filterAgent}
            onChange={(e) => setFilterAgent(e.target.value)}
            style={{ width: 200 }}
          >
            <option value="">{t("inbox.allAgents")}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.spec.name}
              </option>
            ))}
          </select>
          <span className="hint-text">{t("inbox.count", { count: visibleResults.length })}</span>
          <label className="inbox-toggle">
            <input
              type="checkbox"
              checked={hideDismissed}
              onChange={(e) => setHideDismissed(e.target.checked)}
            />
            {t("inbox.hideDismissed")}
          </label>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => refresh()}>
            {t("inbox.refresh")}
          </button>
          {results.length > 0 && (
            <>
              {downloadFormats.map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  className="btn btn-sm"
                  disabled={exporting}
                  onClick={() => handleDownload(fmt)}
                >
                  {exporting
                    ? t("common.loading")
                    : t("inbox.download", { format: fmt.toUpperCase() })}
                </button>
              ))}
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={clearing}
                onClick={handleClearAll}
              >
                {clearing ? t("common.loading") : t("inbox.clearAll")}
              </button>
            </>
          )}
        </div>
      </div>

      {visibleResults.length === 0 ? (
        <p>{t("inbox.noResults")}</p>
      ) : cardView ? (
        <div className="opportunity-card-list">
          {visibleResults.map((r) => {
            const agent = agents.find((a) => a.id === r.agentId);
            return (
              <OpportunityCard
                key={r.id}
                result={r}
                agentName={agent?.spec.name}
                lang={lang}
                deleting={deleting === r.id}
                onOpenUrl={(url) => api.openUrl(url)}
                onFeedback={(feedback) => handleFeedback(r.id, feedback)}
                onDelete={() => handleDelete(r.id)}
              />
            );
          })}
        </div>
      ) : (
        <div className="results-table-wrap">
          <table className="results-table inbox-table">
            <thead>
              <tr>
                <th>{t("inbox.colAgent")}</th>
                <th>{t("inbox.colTitle")}</th>
                <th>{t("inbox.colCompany")}</th>
                <th>{t("inbox.colLocation")}</th>
                <th>{t("inbox.score")}</th>
                <th>{t("inbox.colUrl")}</th>
                <th>{t("inbox.runAt")}</th>
                <th>{t("inbox.colActions")}</th>
              </tr>
            </thead>
            <tbody>
              {visibleResults.map((r) => {
                const agent = agents.find((a) => a.id === r.agentId);
                const link = resolvePostingUrl(r.data);
                const company = sanitizeFieldValue(
                  r.data.company_name ?? r.data.companyName,
                  50
                );
                const postingDate = sanitizeFieldValue(
                  r.data.posting_date ?? r.data.postingDate,
                  30
                );
                return (
                  <tr
                    key={r.id}
                    className={`${r.isNew ? "row-new" : ""} ${
                      r.feedback === "not_useful" ? "row-dismissed" : ""
                    }`}
                  >
                    <td className="cell-agent">{agent?.spec.name ?? r.agentId.slice(0, 8)}</td>
                    <td className="cell-title">
                      <span className="result-title">{formatResultTitle(r.data)}</span>
                      {postingDate && (
                        <span className="hint-text result-meta">{postingDate}</span>
                      )}
                    </td>
                    <td>{company || "—"}</td>
                    <td>{formatResultLocation(r.data) || "—"}</td>
                    <td>{String(r.score ?? r.data.score ?? "—")}</td>
                    <td className="cell-link">
                      {link ? (
                        <button
                          type="button"
                          className="btn-link"
                          title={link}
                          onClick={() => api.openUrl(link)}
                        >
                          {postingLinkLabel(link, lang)}
                        </button>
                      ) : (
                        "—"
                      )}
                      {link && (
                        <span className="hint-text result-host">{postingHost(link)}</span>
                      )}
                    </td>
                    <td className="cell-date">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="cell-actions">
                      <button
                        type="button"
                        className={`btn btn-sm ${r.feedback === "useful" ? "btn-primary" : ""}`}
                        onClick={() => handleFeedback(r.id, "useful")}
                      >
                        {t("inbox.useful")}
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm btn-outline ${
                          r.feedback === "not_useful" ? "btn-danger" : ""
                        }`}
                        onClick={() => handleFeedback(r.id, "not_useful")}
                      >
                        {t("inbox.notUseful")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        disabled={deleting === r.id}
                        onClick={() => handleDelete(r.id)}
                      >
                        {deleting === r.id ? t("common.loading") : t("inbox.deleteResult")}
                      </button>
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
