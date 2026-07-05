import type { ExecutionPhase, ProgressEvent } from "./types.js";

export const LogAction = {
  INIT: "init",
  LLM_PLAN: "llm_plan",
  LLM_EXPAND: "llm_expand",
  LLM_RANK: "llm_rank",
  LLM_COVERAGE: "llm_coverage",
  LLM_EXTRACT: "llm_extract",
  LLM_SCORE: "llm_score",
  LLM_CRITIC: "llm_critic",
  LLM_SUMMARIZE: "llm_summarize",
  WEB_SEARCH: "web_search",
  PAGE_FETCH: "page_fetch",
  DEDUPE: "dedupe",
  FILTER: "filter",
  EXPORT: "export",
  INFO: "info",
} as const;

export type LogActionId = (typeof LogAction)[keyof typeof LogAction];

export function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function truncateUrl(url: string, max = 72): string {
  try {
    const u = new URL(url);
    const compact = `${u.hostname}${u.pathname}`;
    return truncate(compact, max);
  } catch {
    return truncate(url, max);
  }
}

export function formatBulletList(items: string[], max = 10): string {
  if (items.length === 0) return "  (ninguno)";
  const shown = items.slice(0, max);
  const lines = shown.map((item) => `  • ${item}`);
  const rest = items.length - shown.length;
  if (rest > 0) lines.push(`  … +${rest} más`);
  return lines.join("\n");
}

/** Formato de una línea de log para el visor de ejecuciones. */
export function formatRunLogLine(event: ProgressEvent): string {
  const ts = new Date().toISOString().slice(11, 23);
  const action = event.action ? `[${event.action}] ` : "";
  const budget = event.budgetUsedSec != null ? ` · ${event.budgetUsedSec}s` : "";
  const thinking = event.thinkingStep ? ` · ${event.thinkingStep}` : "";
  const percent = event.percent > 0 ? ` ${event.percent}%` : "";

  let line = `${ts} [${event.phase}]${percent} ${action}${event.message}${budget}${thinking}`;

  if (event.detail?.trim()) {
    line += `\n${event.detail
      .split("\n")
      .map((l) => (l.startsWith("  ") ? l : `    ${l}`))
      .join("\n")}`;
  }

  return line;
}

export type ActionLogger = (
  action: LogActionId | string,
  message: string,
  detail?: string,
  phase?: ExecutionPhase
) => void;
