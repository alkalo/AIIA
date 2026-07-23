export type AgentStatus = "draft" | "pending_review" | "published" | "paused" | "error";
export type EffortLevel = "low" | "medium" | "high" | "super_high" | "ultra_high";
export type TemplateId =
  | "web-research"
  | "opportunities"
  | "people-orgs"
  | "monitoring"
  | "custom"
  | "job-search"
  | "candidate-search"
  | "supplier-search";

export interface PromptAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  extractedText: string;
}

export type OpportunitySubtype =
  | "jobs"
  | "grants"
  | "programs"
  | "awards"
  | "exposure"
  | "sector_news"
  | "tenders"
  | "events"
  | "deals"
  | "real_estate"
  | "custom";

/** High-level content mode for curation agents (optional; inferred when omitted). */
export type ContentMode = "auto" | "opportunities" | "sector_news" | "wrap";

export interface AgentSpec {
  id: string;
  version: number;
  name: string;
  prompt: string;
  templateId?: TemplateId;
  opportunitySubtype?: OpportunitySubtype;
  /** Prefer opportunities curation, sector news, or BFGN-style wrap. */
  contentMode?: ContentMode;
  contextAttachments?: PromptAttachment[];
  search: SearchConfig;
  filters: FilterConfig;
  output: OutputConfig;
  schedule: ScheduleConfig;
  effort: EffortLevel;
  retentionDays: number;
  status: AgentStatus;
}

export interface SearchConfig {
  queries: string[];
  sources: SearchSource[];
  requiresLogin?: LoginRequirement[];
  /** Máximo de enlaces a recopilar y priorizar. Si se omite, usa el límite del modo de esfuerzo. */
  maxSources?: number;
  /** Resultados por consulta en motores web (opcional). */
  maxResultsPerQuery?: number;
}

export type SearchSource =
  | { type: "duckduckgo" }
  | { type: "url"; url: string }
  | { type: "rss"; url: string };

export interface LoginRequirement {
  siteId: string;
  credentialRef: string;
}

export interface FilterConfig {
  criteria: string;
  minScore: number;
  dedupe?: { enabled: boolean; fields: string[] };
  /** Drop news older than N days (sector news / wrap). Default ~35 when applicable. */
  maxAgeDays?: number;
  /** Opportunities must have at least this many days until deadline (default 7). */
  minDaysRemaining?: number;
  /** Prefer stricter verification (official URL, clear dates, no invented facts). */
  requireVerification?: boolean;
}

export interface OutputConfig {
  schema: string[];
  destinations: ("inbox" | "excel" | "csv" | "email")[];
  excelPath?: string;
  excelMode?: "new_file" | "update_same";
  notify?: boolean;
  /** Optional To: for .eml drafts when destination includes email */
  emailTo?: string;
}

export interface ScheduleConfig {
  intervalMinutes: number;
  /** If true, local scheduler only fires while the desktop app is open. */
  onlyWhenRunning: boolean;
  /**
   * If true (Gemini only), runs are executed by AIIA Cloud when due —
   * PC does not need to be on. Results sync when the app opens.
   */
  cloudEnabled?: boolean;
  timezone?: string;
}

export type ExecutionPhase =
  | "planning"
  | "thinking"
  | "searching"
  | "evaluating"
  | "extracting"
  | "filtering"
  | "exporting"
  | "done";

export interface ProgressEvent {
  phase: ExecutionPhase;
  percent: number;
  message: string;
  /** Identificador de la acción concreta (p. ej. llm_plan, web_search). */
  action?: string;
  /** Texto multilínea con detalle de la acción. */
  detail?: string;
  estimatedRemainingSec?: number;
  thinkingStep?: string;
  sourcesEvaluated?: number;
  budgetUsedSec?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  rawHtml?: string;
}

export interface ExtractedItem {
  [key: string]: string | number | undefined;
  score?: number;
  reason?: string;
}
