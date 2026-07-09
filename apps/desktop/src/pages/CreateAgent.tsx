import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import {
  PlannerAgent,
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
import { api, type OllamaSetupProgress } from "../api";
import { ProgressBar } from "../components/ProgressBar";
import { AgentSpecEditor } from "../components/AgentSpecEditor";
import { useRunProgress } from "../hooks/useAgents";
import {
  DesktopOllamaClient,
  formatOllamaError,
  prepareOllamaForPlanner,
  sanitizeOllamaProgressMessage,
} from "../ollama-desktop";

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
  const [error, setError] = useState("");
  const [ollamaSetup, setOllamaSetup] = useState<{ message: string; percent: number } | null>(
    null
  );

  const [previewRunning, setPreviewRunning] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  const { progress, isFinished } = useRunProgress(runningId, showProgress);

  const dismissProgress = useCallback(() => {
    setShowProgress(false);
    setPreviewRunning(false);
    setRunningId(null);
    previewAgentIdRef.current = null;
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
      if (!aid || aid === previewAgentIdRef.current) setPreviewRunning(false);
    }).then((fn) => unsubs.push(fn));

    listen<string>("agent-run-error", () => {
      setPreviewRunning(false);
    }).then((fn) => unsubs.push(fn));

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [previewRunning]);

  useEffect(() => {
    if (isFinished) setPreviewRunning(false);
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
    if (previewRunning) {
      window.alert(t("dashboard.deleteRunning"));
      return;
    }
    if (!window.confirm(t("dashboard.deleteConfirm", { name: spec.name }))) return;
    setError("");
    try {
      await api.deleteAgent(editId);
      navigate("/");
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
    if (!prompt.trim()) return;
    setLoading(true);
    setError("");
    setOllamaSetup(null);
    let unlisten: (() => void) | undefined;
    try {
      const hw = await api.getHardwareInfo();
      unlisten = await listen<OllamaSetupProgress>("ollama-setup-progress", (event) => {
        setOllamaSetup({
          message: sanitizeOllamaProgressMessage(event.payload.message),
          percent: event.payload.percent,
        });
      });
      setOllamaSetup({ message: t("create.ollamaPreparing"), percent: 0 });
      await prepareOllamaForPlanner(hw.profile);

      setOllamaSetup({ message: t("create.ollamaGenerating"), percent: 100 });
      const planner = new PlannerAgent(new DesktopOllamaClient(), hw.profile);
      const lang = i18n.language.startsWith("es") ? "es" : "en";
      const generated = await planner.plan(prompt, templateId, lang, attachments);
      const normalized = normalizeAgentSpec({
        ...generated,
        effort,
        contextAttachments: attachments.length > 0 ? attachments : generated.contextAttachments,
      });
      setSpec(normalized);
    } catch (e) {
      setError(formatOllamaError(e));
    } finally {
      unlisten?.();
      setOllamaSetup(null);
      setLoading(false);
    }
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
            disabled={loading || !prompt.trim()}
          >
            {loading ? t("common.loading") : t("create.generate")}
          </button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      {ollamaSetup && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <p>{ollamaSetup.message}</p>
          <ProgressBar phase="setup" message={ollamaSetup.message} percent={ollamaSetup.percent} />
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
          />
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
