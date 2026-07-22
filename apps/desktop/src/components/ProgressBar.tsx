import { useTranslation } from "react-i18next";
import "./ProgressBar.css";

interface Props {
  phase: string;
  percent: number;
  message: string;
  estimatedSec?: number;
  thinkingStep?: string;
  budgetUsedSec?: number;
  onDismiss?: () => void;
  /** Cancel the in-flight agent run (requires runId on the caller). */
  onCancel?: () => void;
  cancelling?: boolean;
}

export function ProgressBar({
  phase,
  percent,
  message,
  estimatedSec,
  thinkingStep,
  budgetUsedSec,
  onDismiss,
  onCancel,
  cancelling,
}: Props) {
  const { t } = useTranslation();
  const phaseLabel = t(`progress.${phase}`, phase);
  const finished = phase === "done" || phase === "error" || phase === "cancelled";
  const canCancel = Boolean(onCancel) && !finished;

  return (
    <div className="progress-container">
      <div className="progress-label">
        <span>
          {phaseLabel} — {message}
          {thinkingStep && (
            <span className="progress-thinking"> · {thinkingStep}</span>
          )}
        </span>
        <span className="progress-label-actions">
          {Math.round(percent)}%
          {budgetUsedSec != null && budgetUsedSec > 0 && ` · ${budgetUsedSec}s`}
          {estimatedSec != null && estimatedSec > 0 && ` · ~${Math.ceil(estimatedSec)}s`}
          {canCancel && (
            <button
              type="button"
              className="btn btn-sm btn-danger progress-cancel"
              disabled={cancelling}
              onClick={onCancel}
            >
              {cancelling ? t("common.loading") : t("progress.cancel")}
            </button>
          )}
          {finished && onDismiss && (
            <button type="button" className="btn btn-sm btn-outline progress-dismiss" onClick={onDismiss}>
              {t("progress.dismiss")}
            </button>
          )}
        </span>
      </div>
      <div className="progress-bar">
        <div
          className={`progress-fill${finished ? " progress-fill-done" : ""}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
