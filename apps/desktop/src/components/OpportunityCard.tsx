import { useTranslation } from "react-i18next";
import type { ResultRecord } from "../api";
import {
  formatOpportunityHeadline,
  formatOpportunityProgram,
  formatOpportunityScope,
  formatOpportunityFunding,
  formatOpportunityDeadline,
  resolveOpportunityUrl,
  sanitizeFieldValue,
  isClosingSoon,
} from "@aiia/agent-engine/browser";

interface Props {
  result: ResultRecord;
  agentName?: string;
  lang: "es" | "en";
  deleting: boolean;
  onOpenUrl: (url: string) => void;
  onFeedback: (feedback: "useful" | "not_useful") => void;
  onDelete: () => void;
}

export function OpportunityCard({
  result,
  agentName,
  lang,
  deleting,
  onOpenUrl,
  onFeedback,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const data = result.data;
  const scope = formatOpportunityScope(data);
  const headline = formatOpportunityHeadline(data);
  const program = formatOpportunityProgram(data);
  const description = sanitizeFieldValue(data.description ?? data.summary, 280);
  const funding = formatOpportunityFunding(data);
  const deadline = formatOpportunityDeadline(data);
  const url = resolveOpportunityUrl(data);
  const closingSoon = isClosingSoon(deadline);

  return (
    <article
      className={`opportunity-card ${result.isNew ? "opportunity-card-new" : ""} ${
        result.feedback === "not_useful" ? "opportunity-card-dismissed" : ""
      }`}
    >
      <div className="opportunity-card-header">
        {scope && <span className="opportunity-scope-badge">{scope}</span>}
        {agentName && <span className="opportunity-agent-name">{agentName}</span>}
        {result.isNew && <span className="opportunity-new-badge">{t("inbox.new")}</span>}
      </div>

      <h3 className="opportunity-headline">
        {url ? (
          <button type="button" className="btn-link opportunity-org-link" onClick={() => onOpenUrl(url)}>
            {headline}
          </button>
        ) : (
          headline
        )}
      </h3>

      {program && program !== headline && (
        <p className="opportunity-program">{program}</p>
      )}

      {description && <p className="opportunity-description">{description}</p>}

      <div className="opportunity-card-footer">
        {funding && (
          <span className="opportunity-funding">
            {t("inbox.maxFunding")}: {funding}
          </span>
        )}
        {deadline && (
          <span className={`opportunity-deadline ${closingSoon ? "opportunity-deadline-soon" : ""}`}>
            {closingSoon ? t("inbox.closesSoon") : t("inbox.deadline")}: {deadline}
          </span>
        )}
        <span className="opportunity-score">
          {t("inbox.score")}: {String(result.score ?? data.score ?? "—")}
        </span>
      </div>

      <div className="opportunity-card-actions">
        {url && (
          <button type="button" className="btn btn-sm" onClick={() => onOpenUrl(url)}>
            {lang === "es" ? "Ver convocatoria" : "View grant"}
          </button>
        )}
        <button
          type="button"
          className={`btn btn-sm ${result.feedback === "useful" ? "btn-primary" : ""}`}
          onClick={() => onFeedback("useful")}
        >
          {t("inbox.useful")}
        </button>
        <button
          type="button"
          className={`btn btn-sm btn-outline ${result.feedback === "not_useful" ? "btn-danger" : ""}`}
          onClick={() => onFeedback("not_useful")}
        >
          {t("inbox.notUseful")}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={deleting}
          onClick={onDelete}
        >
          {deleting ? t("common.loading") : t("inbox.deleteResult")}
        </button>
      </div>
    </article>
  );
}
