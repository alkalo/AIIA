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
  available_ram_gb: number;
  cpu_cores: number;
  profile: string;
}

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  models: string[];
  recommendedModel: string;
}

export interface OllamaSetupProgress {
  phase: string;
  percent: number;
  message: string;
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

export interface UpdateStatus {
  phase: string;
  version?: string;
  percent?: number;
  message: string;
  releaseNotes?: string;
  currentVersion?: string;
  upToDate?: boolean;
}

export interface AppInfo {
  version: string;
  isPackaged: boolean;
  updateSupported: boolean;
  platform: string;
}

export interface ChatRecord {
  id: string;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageRecord {
  id: string;
  chatId: string;
  role: string;
  content: string;
  artifactId?: string;
  images?: string[];
  createdAt: string;
}

export interface ChatArtifactRecord {
  id: string;
  chatId: string;
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ChatStreamEvent {
  streamId: string;
  delta: string;
  done: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface UpdateCheckResult {
  upToDate: boolean;
  available?: boolean;
  version?: string;
  currentVersion?: string;
  releaseNotes?: string;
  installing?: boolean;
  declined?: boolean;
  dev?: boolean;
  busy?: boolean;
  error?: string;
  noReleases?: boolean;
}

export interface UpdatePrefs {
  autoUpdateOnStartup: boolean;
}

export type AiProviderId = "local" | "gemini";

export interface AiProviderStatus {
  provider: AiProviderId | string;
  hasGeminiKey: boolean;
}

export const api = {
  getHardwareInfo: () => invoke<HardwareInfo>("get_hardware_info"),
  checkOllama: () => invoke<boolean>("check_ollama"),
  getOllamaStatus: () => invoke<OllamaStatus>("get_ollama_status"),
  setupOllama: (pullModel = true) =>
    invoke<OllamaStatus>("setup_ollama", { pullModel }),
  ensureOllamaForPlanner: (profile: string) =>
    invoke<OllamaStatus>("ensure_ollama_for_planner", { profile }),
  ensureOllamaModel: (model: string) =>
    invoke<OllamaStatus>("ensure_ollama_model", { model }),
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
  getAppInfo: () => invoke<AppInfo>("get_app_info"),
  checkForUpdates: (autoInstall = false, manual = true) =>
    invoke<UpdateCheckResult>("check_for_updates", { autoInstall, manual }),
  getUpdatePrefs: () => invoke<UpdatePrefs>("get_update_prefs"),
  setUpdatePrefs: (autoUpdateOnStartup: boolean) =>
    invoke<UpdatePrefs>("set_update_prefs", { autoUpdateOnStartup }),
  createChat: (title?: string) => invoke<ChatRecord>("create_chat", { title }),
  listChats: (archivedOnly = false) =>
    invoke<ChatRecord[]>("list_chats", { archivedOnly }),
  getChat: (id: string) => invoke<ChatRecord>("get_chat", { id }),
  renameChat: (id: string, title: string) =>
    invoke<ChatRecord>("rename_chat", { id, title }),
  archiveChat: (id: string, archived: boolean) =>
    invoke<ChatRecord>("archive_chat", { id, archived }),
  deleteChat: (id: string) => invoke("delete_chat", { id }),
  listChatMessages: (chatId: string) =>
    invoke<ChatMessageRecord[]>("list_chat_messages", { chatId }),
  addChatMessage: (
    chatId: string,
    role: string,
    content: string,
    artifactId?: string,
    images?: string[]
  ) =>
    invoke<ChatMessageRecord>("add_chat_message", {
      chatId,
      role,
      content,
      artifactId: artifactId ?? null,
      images: images ?? null,
    }),
  listChatArtifacts: (chatId: string) =>
    invoke<ChatArtifactRecord[]>("list_chat_artifacts", { chatId }),
  getChatSystemPrompt: (modeAddon?: string) =>
    invoke<string>("get_chat_system_prompt", { modeAddon: modeAddon ?? null }),
  chatWebSearch: (query: string, limit = 8, depth = "eficaz") =>
    invoke<WebSearchHit[]>("chat_web_search", { query, limit, depth }),
  chatFetchUrl: (url: string, maxChars = 12000) =>
    invoke<string>("chat_fetch_url", { url, maxChars }),
  chatCreateAgentDraft: (name: string, prompt: string) =>
    invoke<AgentRecord>("chat_create_agent_draft", { name, prompt }),
  chatGenerateImage: (chatId: string, prompt: string) =>
    invoke<{ path: string; prompt: string }>("chat_generate_image", { chatId, prompt }),
  chatRunPython: (code: string, timeoutSecs = 12) =>
    invoke<string>("chat_run_python", { code, timeoutSecs }),
  exportChatMarkdown: (chatId: string) =>
    invoke<string>("export_chat_markdown", { chatId }),
  saveChatImage: (chatId: string, fileName: string, bytesBase64: string) =>
    invoke<string>("save_chat_image", { chatId, fileName, bytesBase64 }),
  readFileBase64: (path: string) => invoke<string>("read_file_base64", { path }),
  pickVisionModel: (models: string[], fallback: string) =>
    invoke<string>("pick_vision_model", { models, fallback }),
  ollamaChatStream: (
    streamId: string,
    model: string,
    messages: { role: string; content: string; images?: string[] }[],
    temperature?: number,
    numCtx?: number
  ) =>
    invoke("ollama_chat_stream", {
      streamId,
      model,
      messages,
      temperature,
      numCtx,
    }),
  llmChat: (
    model: string,
    messages: { role: string; content: string; images?: string[] }[],
    temperature?: number,
    numCtx?: number,
    format?: string,
    provider?: string
  ) =>
    invoke<string>("llm_chat", {
      model,
      messages,
      temperature,
      numCtx,
      format: format ?? null,
      provider: provider ?? null,
    }),
  llmChatStream: (
    streamId: string,
    model: string,
    messages: { role: string; content: string; images?: string[] }[],
    temperature?: number,
    numCtx?: number,
    provider?: string
  ) =>
    invoke("llm_chat_stream", {
      streamId,
      model,
      messages,
      temperature,
      numCtx,
      provider: provider ?? null,
    }),
  getAiProviderStatus: () => invoke<AiProviderStatus>("get_ai_provider_status"),
  setAiProvider: (provider: AiProviderId | string) =>
    invoke<AiProviderStatus>("set_ai_provider", { provider }),
  setGeminiApiKey: (apiKey: string) =>
    invoke<AiProviderStatus>("set_gemini_api_key", { apiKey }),
  clearGeminiApiKey: () => invoke<AiProviderStatus>("clear_gemini_api_key"),
  testGeminiApiKey: (apiKey?: string) =>
    invoke("test_gemini_api_key", { apiKey: apiKey ?? null }),
  cancelChatStream: (streamId: string) =>
    invoke("cancel_chat_stream", { streamId }),
};
