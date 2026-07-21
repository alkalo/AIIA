import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { diffSpecs, normalizeAgentSpec, type AgentSpec } from "@aiia/agent-engine/browser";
import { api } from "../api";
import {
  AgentSpecEditor,
  specFieldLabel,
  formatSpecValue,
} from "../components/AgentSpecEditor";

export function ReviewAgent() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [spec, setSpec] = useState<AgentSpec | null>(null);
  const [diff, setDiff] = useState<Record<string, { old: unknown; new: unknown }>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError(t("common.error"));
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const record = await api.getAgent(id);
        if (cancelled) return;
        const normalized = normalizeAgentSpec(record.spec);
        setSpec(normalized);

        try {
          const versions = await api.getAgentVersions(id);
          if (!cancelled && versions.length > 1) {
            const prev = JSON.parse(versions[1].spec_json) as Partial<AgentSpec> & { id: string };
            setDiff(diffSpecs(normalizeAgentSpec({ ...prev, id: prev.id ?? id }), normalized));
          }
        } catch {
          /* diff is optional */
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, t]);

  const handleApprove = async () => {
    if (!id) return;
    setError("");
    try {
      await api.publishAgent(id);
      navigate("/agents");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleReject = () => {
    navigate(`/create?edit=${id}`);
  };

  if (loading) return <p>{t("common.loading")}</p>;
  if (!spec) {
    return (
      <div>
        <p className="error-text">{error || t("common.error")}</p>
        <button type="button" className="btn" onClick={() => navigate("/create")}>
          {t("nav.create")}
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2>
        {t("review.title")}: {spec.name}
      </h2>

      {error && <p className="error-text">{error}</p>}

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3>
          {t("review.spec")} (v{spec.version})
        </h3>
        <AgentSpecEditor spec={spec} readOnly />
      </div>

      {Object.keys(diff).length > 0 && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h3>{t("review.diff")}</h3>
          {Object.entries(diff).map(([key, val]) => (
            <div key={key} className="spec-diff-block">
              <span className="spec-diff-label">{specFieldLabel(key, t)}</span>
              <span className="spec-diff-old">{formatSpecValue(key, val.old, t)}</span>
              <span className="spec-diff-new">{formatSpecValue(key, val.new, t)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="btn-row">
        <button type="button" className="btn btn-outline" onClick={handleReject}>
          {t("review.reject")}
        </button>
        <button type="button" className="btn btn-primary" onClick={handleApprove}>
          {t("review.approve")}
        </button>
      </div>
    </div>
  );
}
