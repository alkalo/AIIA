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

export type OpportunitySubtype = "jobs" | "grants" | "tenders" | "events" | "deals" | "custom";

export interface AgentSpec {
  id: string;
  version: number;
  name: string;
  prompt: string;
  templateId?: TemplateId;
  opportunitySubtype?: OpportunitySubtype;
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
}

export interface OutputConfig {
  schema: string[];
  destinations: ("inbox" | "excel" | "csv")[];
  excelPath?: string;
  excelMode?: "new_file" | "update_same";
  notify?: boolean;
}

export interface ScheduleConfig {
  intervalMinutes: number;
  onlyWhenRunning: boolean;
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
