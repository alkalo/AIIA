import { invoke } from "@tauri-apps/api/core";
import type { AgentSpec } from "@aiia/agent-engine/browser";

export interface AgentRecord {
  id: string;
  spec: AgentSpec;
  created_at: string;
  updated_at: string;
  last_run_at?: string;
  next_run_at?: string;
  error_message?: string;
}

export interface ResultRecord {
  id: string;
  agentId: string;
  runId: string;
  data: Record<string, unknown>;
  score?: number;
  isNew: boolean;
  feedback?: string;
  createdAt: string;
}

export interface HardwareInfo {
  total_ram_gb: number;
  cpu_cores: number;
  profile: string;
}

export interface CredentialSummary {
  id: string;
  siteId: string;
  label: string;
  createdAt: string;
  loginUrl?: string;
  hasSession: boolean;
}

export interface RunExecution {
  runId: string;
  agentId: string;
  agentName: string;
  effort: string;
  status: string;
  phase: string;
  percent: number;
  message: string;
  resultsCount: number;
  queuePosition?: number;
  startedAt: string;
  finishedAt?: string;
  summary: string;
  cancellable?: boolean;
}

export interface RunLog {
  runId: string;
  content: string;
  isLive: boolean;
  lineCount: number;
}

export const api = {
  getHardwareInfo: () => invoke<HardwareInfo>("get_hardware_info"),
  checkOllama: () => invoke<boolean>("check_ollama"),
  listAgents: () => invoke<AgentRecord[]>("list_agents"),
  getAgent: (id: string) => invoke<AgentRecord>("get_agent", { id }),
  saveAgent: (spec: AgentSpec) => invoke<AgentRecord>("save_agent", { spec }),
  deleteAgent: (id: string) => invoke("delete_agent", { id }),
  requestReview: (id: string) => invoke<AgentRecord>("request_review", { id }),
  publishAgent: (id: string) => invoke<AgentRecord>("publish_agent", { id }),
  pauseAgent: (id: string) => invoke<AgentRecord>("pause_agent", { id }),
  resumeAgent: (id: string) => invoke<AgentRecord>("resume_agent", { id }),
  getAgentVersions: (agentId: string) =>
    invoke<{ version: number; spec_json: string; created_at: string }[]>("get_agent_versions", {
      agentId,
    }),
  listResults: (agentId?: string, limit?: number) =>
    invoke<ResultRecord[]>("list_results", { agentId, limit }),
  setResultFeedback: (resultId: string, feedback: string) =>
    invoke("set_result_feedback", { resultId, feedback }),
  deleteResult: (resultId: string) => invoke("delete_result", { resultId }),
  clearResults: (agentId?: string) => invoke<number>("clear_results", { agentId }),
  runAgent: (agentId: string, effort: string) =>
    invoke<{ runId: string; queued: boolean; queuePosition: number }>("run_agent", {
      req: { agent_id: agentId, effort },
    }),
  getRunProgress: (agentId: string) =>
    invoke<{
      phase: string;
      percent: number;
      message: string;
      runId?: string;
      thinkingStep?: string;
      budgetUsedSec?: number;
    } | null>("get_run_progress", { agentId }),
  getAgentLimits: () => invoke<{ published: number; max: number }>("get_agent_limits"),
  getPublishedCount: () => invoke<number>("get_published_count"),
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => invoke("set_setting", { key, value }),
  getDataDir: () => invoke<string>("get_data_dir"),
  saveCredential: (siteId: string, label: string, username: string, password: string) =>
    invoke("save_credential", {
      req: { site_id: siteId, label, username, password },
    }),
  connectSite: (params: {
    siteId: string;
    label: string;
    loginUrl: string;
    username: string;
    password: string;
  }) =>
    invoke<CredentialSummary>("connect_site", {
      req: {
        siteId: params.siteId,
        label: params.label,
        loginUrl: params.loginUrl,
        username: params.username,
        password: params.password,
      },
    }),
  listCredentials: () => invoke<CredentialSummary[]>("list_credentials"),
  deleteCredential: (id: string) => invoke("delete_credential", { id }),
  cleanupRetention: (agentId: string) => invoke<number>("cleanup_retention", { agentId }),
  exportResultsCsv: (agentId?: string) =>
    invoke<{ csvPath: string; count: number }>("export_results_csv", { agentId }),
  exportResultsAs: (format: "csv" | "json" | "excel", agentId?: string) =>
    invoke<{ csvPath: string; count: number }>("export_results_as", { agentId, format }),
  openPath: (path: string) => invoke("open_path", { path }),
  openUrl: (url: string) => invoke("open_url", { url }),
  syncLatestRunResults: (agentId: string) =>
    invoke<number>("sync_latest_run_results", { agentId }),
  listRuns: (agentId?: string, limit?: number) =>
    invoke<RunExecution[]>("list_runs", { agentId, limit }),
  cancelRun: (runId: string) => invoke("cancel_run", { runId }),
  deleteRun: (runId: string) => invoke("delete_run", { runId }),
  getRunLog: (runId: string, agentId?: string) =>
    invoke<RunLog>("get_run_log", { runId, agentId }),
};
