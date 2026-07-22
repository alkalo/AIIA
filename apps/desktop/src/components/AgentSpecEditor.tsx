import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { AgentSpec, EffortLevel, TemplateId, OpportunitySubtype } from "@aiia/agent-engine/browser";
import { getEffortEstimate, EFFORT_LEVELS } from "@aiia/ollama-client/browser";
import "./AgentSpecEditor.css";

interface Props {
  spec: AgentSpec;
  onChange?: (spec: AgentSpec) => void;
  readOnly?: boolean;
}

function intervalLabel(minutes: number, t: TFunction): string {
  if (minutes < 60) return t("spec.intervalMinutes", { count: minutes });
  if (minutes < 1440) return t("spec.intervalHours", { count: Math.round(minutes / 60) });
  return t("spec.intervalDays", { count: Math.round(minutes / 1440) });
}

export function AgentSpecEditor({ spec, onChange, readOnly = false }: Props) {
  const { t } = useTranslation();
  const editable = !readOnly && !!onChange;
  const safe = spec.search ?? { queries: [], sources: [{ type: "duckduckgo" as const }] };
  const safeFilters = spec.filters ?? { criteria: "", minScore: 70 };
  const safeOutput = spec.output ?? { schema: [], destinations: ["inbox"] as const };
  const safeSchedule = spec.schedule ?? { intervalMinutes: 1440, onlyWhenRunning: true };

  const update = (patch: Partial<AgentSpec>) => {
    onChange?.({ ...spec, ...patch });
  };

  const updateSearch = (patch: Partial<AgentSpec["search"]>) => {
    onChange?.({ ...spec, search: { ...safe, ...patch } });
  };

  const updateFilters = (patch: Partial<AgentSpec["filters"]>) => {
    onChange?.({ ...spec, filters: { ...safeFilters, ...patch } });
  };

  const updateOutput = (patch: Partial<AgentSpec["output"]>) => {
    onChange?.({ ...spec, output: { ...safeOutput, ...patch } });
  };

  const updateSchedule = (patch: Partial<AgentSpec["schedule"]>) => {
    onChange?.({ ...spec, schedule: { ...safeSchedule, ...patch } });
  };

  const queriesText = safe.queries.join("\n");
  const schemaText = safeOutput.schema.join(", ");
  const urlSources = safe.sources
    .filter((s): s is { type: "url"; url: string } => s.type === "url")
    .map((s) => s.url);
  const rssSources = safe.sources
    .filter((s): s is { type: "rss"; url: string } => s.type === "rss")
    .map((s) => `rss:${s.url}`);
  const extraSourcesText = [...urlSources, ...rssSources].join("\n");
  const hasDdg = safe.sources.some((s) => s.type === "duckduckgo");

  const OPPORTUNITY_SUBTYPES: OpportunitySubtype[] = [
    "jobs",
    "grants",
    "tenders",
    "events",
    "deals",
    "real_estate",
    "custom",
  ];

  return (
    <div className="spec-editor">
      <section className="spec-section">
        <h4>{t("spec.sectionGeneral")}</h4>
        <div className="spec-field">
          <label>{t("spec.name")}</label>
          {editable ? (
            <input
              className="input"
              value={spec.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          ) : (
            <p className="spec-value">{spec.name}</p>
          )}
        </div>
        <div className="spec-field">
          <label>{t("spec.prompt")}</label>
          {editable ? (
            <textarea
              className="input textarea"
              rows={3}
              value={spec.prompt}
              onChange={(e) => update({ prompt: e.target.value })}
            />
          ) : (
            <p className="spec-value">{spec.prompt}</p>
          )}
        </div>
        {spec.templateId && (
          <div className="spec-field">
            <label>{t("create.template")}</label>
            <p className="spec-value">{t(`templates.${camelTemplate(spec.templateId)}.name`)}</p>
          </div>
        )}
        {(spec.templateId === "opportunities" || spec.opportunitySubtype) && (
          <div className="spec-field">
            <label>{t("spec.opportunitySubtype")}</label>
            {editable ? (
              <select
                className="input"
                value={spec.opportunitySubtype ?? "custom"}
                onChange={(e) =>
                  update({ opportunitySubtype: e.target.value as OpportunitySubtype })
                }
              >
                {OPPORTUNITY_SUBTYPES.map((sub) => (
                  <option key={sub} value={sub}>
                    {t(`spec.opportunitySubtypes.${sub}`)}
                  </option>
                ))}
              </select>
            ) : (
              <p className="spec-value">
                {t(`spec.opportunitySubtypes.${spec.opportunitySubtype ?? "custom"}`)}
              </p>
            )}
          </div>
        )}
        <div className="spec-field">
          <label>{t("create.effort")}</label>
          {editable ? (
            <select
              className="input"
              value={spec.effort}
              onChange={(e) => update({ effort: e.target.value as EffortLevel })}
            >
              {EFFORT_LEVELS.map((e) => (
                <option key={e} value={e}>
                  {t(`effort.${e}`)} ({getEffortEstimate(e)}) — {t(`create.effortDesc.${e}`)}
                </option>
              ))}
            </select>
          ) : (
            <p className="spec-value">
              {t(`effort.${spec.effort}`)} ({getEffortEstimate(spec.effort)})
            </p>
          )}
        </div>
      </section>

      {spec.contextAttachments && spec.contextAttachments.length > 0 && (
        <section className="spec-section">
          <h4>{t("spec.sectionAttachments")}</h4>
          <ul className="spec-tags">
            {spec.contextAttachments.map((a) => (
              <li key={a.id} className="spec-tag">
                {a.name} ({Math.round(a.sizeBytes / 1024)} KB)
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="spec-section">
        <h4>{t("spec.sectionSearch")}</h4>
        <div className="spec-field">
          <label>{t("spec.queries")}</label>
          {editable ? (
            <textarea
              className="input textarea"
              rows={4}
              value={queriesText}
              placeholder={t("spec.queriesPlaceholder")}
              onChange={(e) =>
                updateSearch({
                  queries: e.target.value
                    .split("\n")
                    .map((q) => q.trim())
                    .filter(Boolean),
                })
              }
            />
          ) : (
            <ul className="spec-list">
              {safe.queries.map((q, i) => (
                <li key={`${q}-${i}`}>{q}</li>
              ))}
            </ul>
          )}
          {!editable && safe.queries.length === 0 && (
            <p className="spec-muted">—</p>
          )}
        </div>
        <div className="spec-field">
          <label>{t("spec.maxSources")}</label>
          {editable ? (
            <>
              <input
                className="input"
                type="number"
                min={1}
                max={500}
                placeholder={t("spec.maxSourcesPlaceholder")}
                value={safe.maxSources ?? ""}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  updateSearch({
                    maxSources: raw === "" ? undefined : Math.max(1, Number(raw) || 1),
                  });
                }}
              />
              <p className="spec-hint">{t("spec.maxSourcesHint")}</p>
            </>
          ) : (
            <p className="spec-value">{safe.maxSources ?? t("spec.maxSourcesDefault", "Modo de ejecución")}</p>
          )}
        </div>
        <div className="spec-field">
          <label>{t("spec.sources")}</label>
          <div className="spec-chips">
            {hasDdg && <span className="spec-chip">DuckDuckGo</span>}
            {urlSources.map((url) => (
              <span key={url} className="spec-chip" title={url}>
                {truncateUrl(url)}
              </span>
            ))}
            {rssSources.map((url) => (
              <span key={url} className="spec-chip" title={url}>
                RSS {truncateUrl(url.replace(/^rss:/, ""))}
              </span>
            ))}
          </div>
          {editable && (
            <textarea
              className="input textarea"
              rows={3}
              value={extraSourcesText}
              placeholder={t("spec.urlsPlaceholder")}
              onChange={(e) => {
                const lines = e.target.value
                  .split("\n")
                  .map((u) => u.trim())
                  .filter(Boolean);
                const sources: AgentSpec["search"]["sources"] = [];
                if (hasDdg || lines.length === 0) sources.push({ type: "duckduckgo" });
                lines.forEach((line) => {
                  if (line.toLowerCase().startsWith("rss:")) {
                    sources.push({ type: "rss", url: line.slice(4).trim() });
                  } else {
                    sources.push({ type: "url", url: line });
                  }
                });
                updateSearch({ sources });
              }}
            />
          )}
        </div>
      </section>

      <section className="spec-section">
        <h4>{t("spec.sectionFilters")}</h4>
        <div className="spec-field">
          <label>{t("spec.criteria")}</label>
          {editable ? (
            <textarea
              className="input textarea"
              rows={2}
              value={safeFilters.criteria}
              onChange={(e) => updateFilters({ criteria: e.target.value })}
            />
          ) : (
            <p className="spec-value">{safeFilters.criteria}</p>
          )}
        </div>
        <div className="spec-field spec-field-inline">
          <label>{t("spec.minScore")}</label>
          {editable ? (
            <input
              type="number"
              className="input input-narrow"
              min={0}
              max={100}
              value={safeFilters.minScore}
              onChange={(e) => updateFilters({ minScore: Number(e.target.value) })}
            />
          ) : (
            <p className="spec-value">{safeFilters.minScore}%</p>
          )}
        </div>
        <div className="spec-field spec-field-inline">
          <label>{t("spec.dedupe")}</label>
          <p className="spec-value">
            {safeFilters.dedupe?.enabled ? t("spec.yes") : t("spec.no")}
            {safeFilters.dedupe?.enabled && safeFilters.dedupe.fields?.length > 0 && (
              <span className="spec-muted"> ({safeFilters.dedupe.fields.join(", ")})</span>
            )}
          </p>
        </div>
      </section>

      <section className="spec-section">
        <h4>{t("spec.sectionOutput")}</h4>
        <div className="spec-field">
          <label>{t("spec.outputFields")}</label>
          {editable ? (
            <input
              className="input"
              value={schemaText}
              placeholder={t("spec.schemaPlaceholder")}
              onChange={(e) =>
                updateOutput({
                  schema: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          ) : (
            <div className="spec-chips">
              {safeOutput.schema.map((f) => (
                <span key={f} className="spec-chip">
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="spec-field">
          <label>{t("spec.destinations")}</label>
          {editable ? (
            <div className="spec-checkboxes">
              {(["inbox", "excel", "csv"] as const).map((dest) => (
                <label key={dest} className="spec-check">
                  <input
                    type="checkbox"
                    checked={safeOutput.destinations.includes(dest)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...safeOutput.destinations, dest]
                        : safeOutput.destinations.filter((d) => d !== dest);
                      updateOutput({ destinations: [...new Set(next)] });
                    }}
                  />
                  {t(`spec.dest.${dest}`)}
                </label>
              ))}
            </div>
          ) : (
            <div className="spec-chips">
              {safeOutput.destinations.map((d) => (
                <span key={d} className="spec-chip">
                  {t(`spec.dest.${d}`)}
                </span>
              ))}
            </div>
          )}
        </div>
        {safeOutput.excelPath && (
          <div className="spec-field">
            <label>{t("spec.excelPath")}</label>
            {editable ? (
              <input
                className="input"
                value={safeOutput.excelPath}
                onChange={(e) => updateOutput({ excelPath: e.target.value })}
              />
            ) : (
              <p className="spec-value spec-mono">{safeOutput.excelPath}</p>
            )}
          </div>
        )}
        <div className="spec-field spec-field-inline">
          <label>{t("spec.notify")}</label>
          {editable ? (
            <input
              type="checkbox"
              checked={safeOutput.notify ?? false}
              onChange={(e) => updateOutput({ notify: e.target.checked })}
            />
          ) : (
            <p className="spec-value">{safeOutput.notify ? t("spec.yes") : t("spec.no")}</p>
          )}
        </div>
      </section>

      <section className="spec-section">
        <h4>{t("spec.sectionSchedule")}</h4>
        <div className="spec-field">
          <label>{t("spec.frequency")}</label>
          {editable ? (
            <div className="spec-schedule-row">
              <input
                type="number"
                className="input input-narrow"
                min={15}
                value={safeSchedule.intervalMinutes}
                onChange={(e) =>
                  updateSchedule({ intervalMinutes: Math.max(15, Number(e.target.value)) })
                }
              />
              <span className="spec-muted">{t("spec.minutes")}</span>
              <span className="spec-hint">≈ {intervalLabel(safeSchedule.intervalMinutes, t)}</span>
            </div>
          ) : (
            <p className="spec-value">{intervalLabel(safeSchedule.intervalMinutes, t)}</p>
          )}
        </div>
        <div className="spec-field spec-field-inline">
          <label>{t("spec.onlyWhenRunning")}</label>
          <p className="spec-value">
            {safeSchedule.onlyWhenRunning ? t("spec.yes") : t("spec.no")}
          </p>
        </div>
        <div className="spec-field spec-field-inline">
          <label>{t("spec.retention")}</label>
          {editable ? (
            <input
              type="number"
              className="input input-narrow"
              min={1}
              value={spec.retentionDays ?? 90}
              onChange={(e) => update({ retentionDays: Number(e.target.value) })}
            />
          ) : (
            <p className="spec-value">
              {t("spec.retentionDays", { count: spec.retentionDays ?? 90 })}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function camelTemplate(id: TemplateId): string {
  const map: Record<TemplateId, string> = {
    "web-research": "webResearch",
    opportunities: "opportunities",
    "people-orgs": "peopleOrgs",
    monitoring: "monitoring",
    custom: "custom",
    "job-search": "jobSearch",
    "candidate-search": "candidateSearch",
    "supplier-search": "supplierSearch",
  };
  return map[id];
}

function truncateUrl(url: string, max = 48): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max)}…`;
}

/** Human-readable labels for diff keys */
export function specFieldLabel(key: string, t: TFunction): string {
  const map: Record<string, string> = {
    name: "spec.name",
    prompt: "spec.prompt",
    search: "spec.sectionSearch",
    filters: "spec.sectionFilters",
    output: "spec.sectionOutput",
    schedule: "spec.sectionSchedule",
    effort: "create.effort",
    retentionDays: "spec.retention",
    contextAttachments: "spec.sectionAttachments",
    templateId: "create.template",
  };
  return t(map[key] ?? key);
}

export function formatSpecValue(key: string, value: unknown, t: TFunction): string {
  if (value == null) return "—";
  if (key === "effort" && typeof value === "string") return t(`effort.${value}`);
  if (key === "retentionDays" && typeof value === "number") return t("spec.retentionDays", { count: value });
  if (key === "search" && typeof value === "object") {
    const s = value as AgentSpec["search"];
    const parts = [
      `${t("spec.queries")}: ${s.queries?.join("; ") ?? "—"}`,
      s.maxSources != null ? `${t("spec.maxSources")}: ${s.maxSources}` : "",
      s.sources?.some((x) => x.type === "duckduckgo") ? "DuckDuckGo" : "",
    ].filter(Boolean);
    return parts.join(" · ");
  }
  if (key === "filters" && typeof value === "object") {
    const f = value as AgentSpec["filters"];
    return `${f.criteria} (${t("spec.minScore")}: ${f.minScore}%)`;
  }
  if (key === "output" && typeof value === "object") {
    const o = value as AgentSpec["output"];
    return `${o.schema?.join(", ")} → ${o.destinations?.map((d) => t(`spec.dest.${d}`)).join(", ")}`;
  }
  if (key === "schedule" && typeof value === "object") {
    const sch = value as AgentSpec["schedule"];
    return intervalLabel(sch.intervalMinutes ?? 1440, t);
  }
  if (key === "contextAttachments" && Array.isArray(value)) {
    return value.map((a: { name: string }) => a.name).join(", ");
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}
