import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import "./RunLogViewer.css";

interface RunLogViewerProps {
  runId: string;
  agentId: string;
  agentName: string;
  isLive: boolean;
  onClose: () => void;
}

export function RunLogViewer({ runId, agentId, agentName, isLive: initialLive, onClose }: RunLogViewerProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [isLive, setIsLive] = useState(initialLive);
  const [lineCount, setLineCount] = useState(0);
  const preRef = useRef<HTMLPreElement>(null);
  const stickToBottom = useRef(true);

  const fetchLog = useCallback(async () => {
    try {
      const log = await api.getRunLog(runId, agentId);
      setContent(log.content);
      setIsLive(log.isLive);
      setLineCount(log.lineCount);
    } catch {
      /* ignore transient errors while polling */
    }
  }, [runId, agentId]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(fetchLog, 800);
    return () => clearInterval(interval);
  }, [isLive, fetchLog]);

  useEffect(() => {
    const pre = preRef.current;
    if (!pre || !stickToBottom.current) return;
    pre.scrollTop = pre.scrollHeight;
  }, [content]);

  const handleScroll = () => {
    const pre = preRef.current;
    if (!pre) return;
    const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
    stickToBottom.current = atBottom;
  };

  return (
    <div className="run-log-overlay" onClick={onClose} role="presentation">
      <div
        className="run-log-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="run-log-title"
      >
        <div className="run-log-header">
          <div>
            <h3 id="run-log-title">{t("runs.logTitle")}</h3>
            <p className="hint-text">
              {agentName} · <code>{runId.slice(0, 8)}…</code>
              {isLive && <span className="run-log-live"> · {t("runs.logLive")}</span>}
            </p>
          </div>
          <div className="run-log-header-actions">
            <span className="hint-text">{t("runs.logLines", { count: lineCount })}</span>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => fetchLog()}>
              {t("runs.refresh")}
            </button>
            <button type="button" className="btn btn-sm" onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        </div>
        <pre ref={preRef} className="run-log-content" onScroll={handleScroll}>
          {content || t("runs.logEmpty")}
        </pre>
      </div>
    </div>
  );
}
