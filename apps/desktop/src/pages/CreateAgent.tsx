import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import {
  TEMPLATE_OPTIONS,
  getTemplate,
  queriesAreStale,
  readFileAsAttachment,
  MAX_ATTACHMENTS,
  normalizeAgentSpec,
  type AgentSpec,
  type TemplateId,
  type EffortLevel,
  type PromptAttachment,
} from "@aiia/agent-engine/browser";
import { getEffortEstimate, EFFORT_LEVELS } from "@aiia/ollama-client/browser";
import { api } from "../api";
import { ProgressBar } from "../components/ProgressBar";
import { AgentSpecEditor } from "../components/AgentSpecEditor";
import { useRunProgress } from "../hooks/useAgents";
import { useAgentGeneration } from "../contexts/AgentGenerationContext";
import { AiProviderSelect } from "../components/AiProviderSelect";

const PREVIEW_AGENT_KEY = "aiia-create-preview-agent-id";
const TERMINAL_PHASES = new Set(["done", "error", "cancelled"]);

export function CreateAgent() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("edit");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewAgentIdRef = useRef<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [templateId, setTemplateId] = useState<TemplateId>("web-research");
  const [effort, setEffort] = useState<EffortLevel>("medium");
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [spec, setSpec] = useState<AgentSpec | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const {
    isGenerating,
    ollamaSetup,
    error: generationError,
    ollamaNeedsInstall,
    generatedSpec,
    consumeGeneratedSpec,
    generateAgent,
    clearError,
  } = useAgentGeneration();
  const [error, setError] = useState("");

  const [previewRunning, setPreviewRunning] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  const { progress, isFinished } = useRunProgress(runningId, Boolean(runningId));
  const [cancellingRun, setCancellingRun] = useState(false);

  const displayError = error || generationError;

  const dismissProgress = useCallback(() => {
    setShowProgress(false);
    setPreviewRunning(false);
    setRunningId(null);
    previewAgentIdRef.current = null;
    sessionStorage.removeItem(PREVIEW_AGENT_KEY);
  }, []);

  const handleCancelRun = useCallback(async () => {
    const runId = progress?.runId;
    if (!runId) return;
    if (!window.confirm(t("runs.cancelConfirm"))) return;
    setCancellingRun(true);
    try {
      await api.cancelRun(runId);
      setPreviewRunning(false);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setCancellingRun(false);
    }
  }, [progress?.runId, t]);

  useEffect(() => {
    if (!generatedSpec) return;
    setSpec(generatedSpec);
    consumeGeneratedSpec();
  }, [generatedSpec, consumeGeneratedSpec]);

  useEffect(() => {
    const storedId = sessionStorage.getItem(PREVIEW_AGENT_KEY);
    if (!storedId) return;

    let cancelled = false;
    api
      .getRunProgress(storedId)
      .then((p) => {
        if (cancelled || !p || TERMINAL_PHASES.has(p.phase)) {
          sessionStorage.removeItem(PREVIEW_AGENT_KEY);
          return;
        }
        previewAgentIdRef.current = storedId;
        setRunningId(storedId);
        setShowProgress(true);
        setPreviewRunning(true);
      })
      .catch(() => {
        sessionStorage.removeItem(PREVIEW_AGENT_KEY);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (editId) {
      api
        .getAgent(editId)
        .then((record) => {
          const normalized = normalizeAgentSpec(record.spec);
          setSpec(normalized);
          setPrompt(normalized.prompt);
          setTemplateId(normalized.templateId ?? "custom");
          setEffort(normalized.effort);
          setAttachments(normalized.contextAttachments ?? []);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }
  }, [editId]);

  useEffect(() => {
    if (!previewRunning) return;

    const unsubs: Array<() => void> = [];

    listen<{ agentId?: string }>("agent-run-complete", (event) => {
      const aid = event.payload.agentId ?? previewAgentIdRef.current;
      if (!aid || aid === previewAgentIdRef.current) {
        setPreviewRunning(false);
        sessionStorage.removeItem(PREVIEW_AGENT_KEY);
      }
    }).then((fn) => unsubs.push(fn));

    listen<string>("agent-run-error", () => {
      setPreviewRunning(false);
      sessionStorage.removeItem(PREVIEW_AGENT_KEY);
    }).then((fn) => unsubs.push(fn));

    listen("agent-run-cancelled", () => {
      setPreviewRunning(false);
      sessionStorage.removeItem(PREVIEW_AGENT_KEY);
    }).then((fn) => unsubs.push(fn));

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [previewRunning]);

  useEffect(() => {
    if (isFinished) {
      setPreviewRunning(false);
      sessionStorage.removeItem(PREVIEW_AGENT_KEY);
    }
  }, [isFinished]);

  const buildSpecForSave = (status: AgentSpec["status"] = "draft"): AgentSpec | null => {
    if (!spec) return null;
    return normalizeAgentSpec({
      ...spec,
      effort,
      status,
      contextAttachments: attachments.length > 0 ? attachments : spec.contextAttachments,
    });
  };

  const handleDeleteAgent = async () => {
    if (!editId || !spec) return;
    const msg = previewRunning
      ? t("dashboard.deleteRunningConfirm", { name: spec.name })
      : t("dashboard.deleteConfirm", { name: spec.name });
    if (!window.confirm(msg)) return;
    setError("");
    try {
      await api.deleteAgent(editId);
      navigate("/agents");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setError("");

    const remaining = MAX_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      setError(t("create.attachmentsMax", { count: MAX_ATTACHMENTS }));
      return;
    }

    const toAdd = files.slice(0, remaining);
    try {
      const parsed = await Promise.all(toAdd.map((f) => readFileAsAttachment(f)));
      setAttachments((prev) => [...prev, ...parsed]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setError("");
    clearError();
    const lang = i18n.language.startsWith("es") ? "es" : "en";
    await generateAgent({ prompt, templateId, effort, attachments, lang });
  };

  const handleSaveDraft = async () => {
    const toSave = buildSpecForSave("draft");
    if (!toSave) return;
    setError("");
    try {
      const saved = await api.saveAgent(toSave);
      const normalized = normalizeAgentSpec(saved.spec);
      setSpec(normalized);
      setAttachments(normalized.contextAttachments ?? []);
      navigate(`/create?edit=${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePreview = async () => {
    const toSave = buildSpecForSave("draft");
    if (!toSave) return;

    setPreviewRunning(true);
    setShowProgress(true);
    setError("");

    try {
      const saved = await api.saveAgent(toSave);
      previewAgentIdRef.current = saved.id;
      setRunningId(saved.id);
      sessionStorage.setItem(PREVIEW_AGENT_KEY, saved.id);
      await api.runAgent(saved.id, "low");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      dismissProgress();
    }
  };

  const handleRequestReview = async () => {
    const toSave = buildSpecForSave("pending_review");
    if (!toSave) return;
    setLoading(true);
    setError("");
    try {
      const saved = await api.saveAgent(toSave);
      navigate(`/review/${saved.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>{t("create.title")}</h2>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <label>{t("create.template")}</label>
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value as TemplateId)}
          className="input"
        >
          {TEMPLATE_OPTIONS.map((tmpl) => (
            <option key={tmpl.id} value={tmpl.id}>
              {t(tmpl.nameKey)}
            </option>
          ))}
        </select>
        <p className="hint-text">{t(getTemplate(templateId).descriptionKey)}</p>
        {spec && queriesAreStale(spec) && (
          <p className="hint-text" style={{ color: "var(--warning, #b8860b)" }}>
            {t("create.staleQueries")}
          </p>
        )}

        <label>{t("create.prompt")}</label>
        <textarea
          className="input textarea"
          rows={4}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(getTemplate(templateId).placeholderKey)}
        />

        <label>{t("create.attachments")}</label>
        <p className="hint-text">{t("create.attachmentsHint")}</p>
        <div className="file-picker">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.csv,.json,.xml,.html,.htm,.log,.yaml,.yml,.tsv,text/*,application/json"
            className="file-input-hidden"
            onChange={handleFilesSelected}
            disabled={attachments.length >= MAX_ATTACHMENTS}
          />
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={attachments.length >= MAX_ATTACHMENTS}
          >
            {t("create.addFiles")}
          </button>
        </div>
        {attachments.length > 0 && (
          <ul className="attachment-list">
            {attachments.map((a) => (
              <li key={a.id} className="attachment-item">
                <span>
                  {a.name}{" "}
                  <span className="attachment-meta">({Math.round(a.sizeBytes / 1024)} KB)</span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => removeAttachment(a.id)}
                >
                  {t("create.removeAttachment")}
                </button>
              </li>
            ))}
          </ul>
        )}

        <label>{t("aiProvider.label")}</label>
        <p className="hint-text">{t("aiProvider.agentsHint")}</p>
        <AiProviderSelect disabled={isGenerating || loading} />

        <label>{t("create.effort")}</label>
        <p className="hint-text">{t("create.effortHint")}</p>
        <div className="effort-options">
          {EFFORT_LEVELS.map((e) => (
            <label key={e} className="effort-option">
              <input
                type="radio"
                name="effort"
                value={e}
                checked={effort === e}
                onChange={() => setEffort(e)}
              />
              {t(`effort.${e}`)} ({getEffortEstimate(e)})
              <span className="hint-text effort-desc">{t(`create.effortDesc.${e}`)}</span>
            </label>
          ))}
        </div>

        <div className="btn-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
          >
            {isGenerating ? t("common.loading") : t("create.generate")}
          </button>
        </div>
      </div>

      {displayError && (
        <div>
          <p className="error-text">{displayError}</p>
          {ollamaNeedsInstall && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => navigate("/settings")}
              style={{ marginTop: "0.5rem" }}
            >
              {t("create.goToSettings")}
            </button>
          )}
        </div>
      )}

      {(ollamaSetup || isGenerating || showProgress) && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          {(ollamaSetup || isGenerating) && (
            <>
              <p>{ollamaSetup?.message ?? t("create.ollamaGenerating")}</p>
              <ProgressBar
                phase="setup"
                message={ollamaSetup?.message ?? t("create.ollamaGenerating")}
                percent={ollamaSetup?.percent ?? 0}
              />
            </>
          )}
          {showProgress && (
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
          )}
        </div>
      )}

      {spec && (
        <div className="card">
          <div className="page-header" style={{ marginBottom: "1rem" }}>
            <h3 style={{ margin: 0 }}>{t("review.spec")}</h3>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? t("spec.hideJson") : t("spec.showJson")}
            </button>
          </div>

          {showAdvanced ? (
            <textarea
              className="input textarea code"
              rows={16}
              value={JSON.stringify(spec, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value) as Partial<AgentSpec> & { id: string };
                  if (parsed.id) setSpec(normalizeAgentSpec(parsed));
                } catch {
                  /* ignore invalid json while typing */
                }
              }}
            />
          ) : (
            <AgentSpecEditor spec={spec} onChange={(next) => setSpec(normalizeAgentSpec(next))} />
          )}

          <div className="btn-row">
            <button type="button" className="btn" onClick={handleSaveDraft} disabled={loading}>
              {t("create.saveDraft")}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={handlePreview}
              disabled={previewRunning || loading}
            >
              {previewRunning ? t("common.loading") : t("create.preview")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleRequestReview}
              disabled={loading || previewRunning}
            >
              {loading ? t("common.loading") : t("create.requestReview")}
            </button>
            {editId && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDeleteAgent}
                disabled={loading || previewRunning}
              >
                {t("dashboard.delete")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
