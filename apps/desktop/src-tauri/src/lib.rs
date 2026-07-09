use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use aiia_core::crypto::encrypt_string;
use aiia_core::db::Database;
use aiia_core::models::{
    AgentRecord, AgentSpec, AgentStatus, CredentialRecord, EffortLevel, ResultRecord, RunLog,
    MAX_PUBLISHED_AGENTS,
};
use aiia_core::scheduler::{
    resolve_node_executable, spawn_agent_runner, spawn_credential_runner, RunnerSpawnConfig,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

mod ollama;
mod updater;

pub struct AppState {
    pub db: Arc<Database>,
    pub data_dir: PathBuf,
    pub runner_path: PathBuf,
    pub credential_runner_path: PathBuf,
    pub runner_spawn: RunnerSpawnConfig,
    pub(crate) run_queue: Arc<Mutex<RunQueue>>,
}

struct QueuedRun {
    agent_id: String,
    effort: String,
    run_id: String,
}

pub(crate) struct RunQueue {
    active_agent_id: Option<String>,
    active_run_id: Option<String>,
    active_effort: Option<String>,
    active_pid: Option<u32>,
    active_started_at: Option<String>,
    pending: VecDeque<QueuedRun>,
    cancelled_run_ids: HashSet<String>,
}

impl Default for RunQueue {
    fn default() -> Self {
        Self {
            active_agent_id: None,
            active_run_id: None,
            active_effort: None,
            active_pid: None,
            active_started_at: None,
            pending: VecDeque::new(),
            cancelled_run_ids: HashSet::new(),
        }
    }
}

fn data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AIIA")
}

fn ensure_agent_file(data_dir: &PathBuf, spec: &AgentSpec) -> Result<(), String> {
    let agents_dir = data_dir.join("agents");
    std::fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;
    let path = agents_dir.join(format!("{}.json", spec.id));
    std::fs::write(&path, serde_json::to_string_pretty(spec).unwrap()).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct HardwareInfoDto {
    pub total_ram_gb: u64,
    pub cpu_cores: usize,
    pub profile: String,
}

#[tauri::command]
fn get_hardware_info() -> HardwareInfoDto {
    let total = sysinfo_mem_gb();
    let cores = std::thread::available_parallelism()
        .map(|p| p.get())
        .unwrap_or(4);
    let profile = if total >= 32 {
        "super"
    } else if total >= 16 {
        "high"
    } else if total >= 8 {
        "medium"
    } else {
        "low"
    };
    HardwareInfoDto {
        total_ram_gb: total,
        cpu_cores: cores,
        profile: profile.to_string(),
    }
}

fn sysinfo_mem_gb() -> u64 {
    #[cfg(windows)]
    {
        use std::mem::MaybeUninit;
        #[repr(C)]
        struct MemoryStatusEx {
            dw_length: u32,
            dw_memory_load: u32,
            ull_total_phys: u64,
            ull_avail_phys: u64,
            ull_total_page_file: u64,
            ull_avail_page_file: u64,
            ull_total_virtual: u64,
            ull_avail_virtual: u64,
            ull_avail_extended_virtual: u64,
        }
        extern "system" {
            fn GlobalMemoryStatusEx(lpBuffer: *mut MemoryStatusEx) -> i32;
        }
        let mut status = MaybeUninit::<MemoryStatusEx>::uninit();
        unsafe {
            let ptr = status.as_mut_ptr();
            (*ptr).dw_length = std::mem::size_of::<MemoryStatusEx>() as u32;
            if GlobalMemoryStatusEx(ptr) != 0 {
                return (*ptr).ull_total_phys / 1024 / 1024 / 1024;
            }
        }
    }
    8
}

#[tauri::command]
async fn check_ollama() -> Result<bool, String> {
    Ok(ollama::ollama_is_running().await)
}

#[tauri::command]
async fn get_ollama_status() -> Result<ollama::OllamaStatus, String> {
    let ram = sysinfo_mem_gb();
    Ok(ollama::get_status(ram).await)
}

#[tauri::command]
async fn setup_ollama(
    app: AppHandle,
    state: State<'_, AppState>,
    pull_model: Option<bool>,
) -> Result<ollama::OllamaStatus, String> {
    let ram = sysinfo_mem_gb();
    ollama::setup_ollama(
        app,
        state.data_dir.clone(),
        ram,
        pull_model.unwrap_or(true),
    )
    .await
}

#[tauri::command]
async fn ensure_ollama_for_planner(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: String,
) -> Result<ollama::OllamaStatus, String> {
    let ram = sysinfo_mem_gb();
    ollama::ensure_ollama_for_planner(app, state.data_dir.clone(), ram, &profile).await
}

#[tauri::command]
async fn ensure_ollama_model(
    app: AppHandle,
    state: State<'_, AppState>,
    model: String,
) -> Result<ollama::OllamaStatus, String> {
    let ram = sysinfo_mem_gb();
    ollama::setup_ollama_with_model(app, state.data_dir.clone(), ram, &model, true).await
}

#[tauri::command]
async fn ollama_chat(
    model: String,
    messages: Vec<serde_json::Value>,
    temperature: Option<f64>,
    num_ctx: Option<u32>,
    format: Option<String>,
) -> Result<String, String> {
    ollama::ollama_chat(model, messages, temperature, num_ctx, format).await
}

#[tauri::command]
fn list_agents(state: State<AppState>) -> Result<Vec<AgentRecord>, String> {
    state.db.list_agents().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_agent(state: State<AppState>, id: String) -> Result<AgentRecord, String> {
    state.db.get_agent(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_agent(state: State<AppState>, spec: AgentSpec) -> Result<AgentRecord, String> {
    ensure_agent_file(&state.data_dir, &spec)?;
    state.db.save_agent(&spec).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_agent(state: State<AppState>, id: String) -> Result<(), String> {
    let path = state.data_dir.join("agents").join(format!("{id}.json"));
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(
        state
            .data_dir
            .join("progress")
            .join(format!("{id}.json")),
    );

    {
        let mut queue = state
            .run_queue
            .lock()
            .map_err(|_| "Run queue lock failed")?;
        queue.pending.retain(|r| r.agent_id != id);
        if queue.active_agent_id.as_deref() == Some(id.as_str()) {
            queue.active_agent_id = None;
        }
    }

    state.db.delete_agent(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn request_review(state: State<AppState>, id: String) -> Result<AgentRecord, String> {
    let mut record = state.db.get_agent(&id).map_err(|e| e.to_string())?;
    record.spec.status = AgentStatus::PendingReview;
    ensure_agent_file(&state.data_dir, &record.spec)?;
    state.db.save_agent(&record.spec).map_err(|e| e.to_string())
}

#[tauri::command]
fn publish_agent(state: State<AppState>, id: String) -> Result<AgentRecord, String> {
    let record = state.db.publish_agent(&id).map_err(|e| e.to_string())?;
    ensure_agent_file(&state.data_dir, &record.spec)?;
    let _ = state.db.update_next_run(&id, record.spec.schedule.interval_minutes);
    Ok(record)
}

#[tauri::command]
fn pause_agent(state: State<AppState>, id: String) -> Result<AgentRecord, String> {
    let mut record = state.db.get_agent(&id).map_err(|e| e.to_string())?;
    record.spec.status = AgentStatus::Paused;
    ensure_agent_file(&state.data_dir, &record.spec)?;
    state.db.save_agent(&record.spec).map_err(|e| e.to_string())
}

#[tauri::command]
fn resume_agent(state: State<AppState>, id: String) -> Result<AgentRecord, String> {
    let mut record = state.db.get_agent(&id).map_err(|e| e.to_string())?;
    if record.spec.status == AgentStatus::Error || record.spec.status == AgentStatus::Paused {
        if state.db.count_published().map_err(|e| e.to_string())? >= MAX_PUBLISHED_AGENTS {
            return Err(format!("Maximum {MAX_PUBLISHED_AGENTS} published agents allowed"));
        }
        record.spec.status = AgentStatus::Published;
        ensure_agent_file(&state.data_dir, &record.spec)?;
        state.db.save_agent(&record.spec).map_err(|e| e.to_string())
    } else {
        Err("Agent is not paused or in error state".to_string())
    }
}

#[tauri::command]
fn get_agent_versions(
    state: State<AppState>,
    agent_id: String,
) -> Result<Vec<AgentVersionDto>, String> {
    let versions = state
        .db
        .get_agent_versions(&agent_id)
        .map_err(|e| e.to_string())?;
    Ok(versions
        .into_iter()
        .map(|(version, spec_json, created_at)| AgentVersionDto {
            version,
            spec_json,
            created_at,
        })
        .collect())
}

#[derive(Serialize)]
pub struct AgentVersionDto {
    pub version: i32,
    pub spec_json: String,
    pub created_at: String,
}

fn sync_run_results_from_disk(
    db: &Arc<Database>,
    data_dir: &PathBuf,
    agent_id: Option<&str>,
) -> Result<i32, String> {
    let mut total = 0i32;

    let runs_dir = data_dir.join("runs");
    if runs_dir.exists() {
        for entry in std::fs::read_dir(&runs_dir).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) else {
                continue;
            };
            let file_agent = parsed
                .get("agentId")
                .and_then(|v| v.as_str())
                .or_else(|| parsed.get("agent_id").and_then(|v| v.as_str()));
            if let Some(filter) = agent_id {
                if file_agent != Some(filter) {
                    continue;
                }
            }
            let Some(aid) = file_agent else { continue };
            let Some(results) = parsed.get("results").and_then(|r| r.as_array()) else {
                continue;
            };
            if results.is_empty() {
                continue;
            }
            let run_id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            if db.count_results_for_run(&run_id).unwrap_or(0) > 0 {
                continue;
            }
            total += db
                .save_results(aid, &run_id, results)
                .map_err(|e| e.to_string())?;
        }
    }

    let inbox_dir = data_dir.join("inbox");
    if inbox_dir.exists() {
        for agent_entry in std::fs::read_dir(&inbox_dir).map_err(|e| e.to_string())?.flatten() {
            if !agent_entry.path().is_dir() {
                continue;
            }
            let aid = agent_entry.file_name().to_string_lossy().to_string();
            if let Some(filter) = agent_id {
                if aid != filter {
                    continue;
                }
            }
            for entry in std::fs::read_dir(agent_entry.path())
                .map_err(|e| e.to_string())?
                .flatten()
            {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                if path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.ends_with("-report.json"))
                {
                    continue;
                }
                let Ok(content) = std::fs::read_to_string(&path) else {
                    continue;
                };
                let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) else {
                    continue;
                };
                let Some(results) = parsed.get("results").and_then(|r| r.as_array()) else {
                    continue;
                };
                if results.is_empty() {
                    continue;
                }
                let run_id = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                if db.count_results_for_run(&run_id).unwrap_or(0) > 0 {
                    continue;
                }
                total += db
                    .save_results(&aid, &run_id, results)
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(total)
}

#[tauri::command]
fn list_results(
    state: State<AppState>,
    agent_id: Option<String>,
    limit: Option<i32>,
) -> Result<Vec<ResultRecord>, String> {
    let limit = limit.unwrap_or(100);
    let mut results = state
        .db
        .list_results(agent_id.as_deref(), limit)
        .map_err(|e| e.to_string())?;
    if results.is_empty() {
        let _ = sync_run_results_from_disk(&state.db, &state.data_dir, agent_id.as_deref());
        results = state
            .db
            .list_results(agent_id.as_deref(), limit)
            .map_err(|e| e.to_string())?;
    }
    Ok(results)
}

#[tauri::command]
fn save_results(
    state: State<AppState>,
    agent_id: String,
    run_id: String,
    results: Vec<serde_json::Value>,
) -> Result<i32, String> {
    state
        .db
        .save_results(&agent_id, &run_id, &results)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_result_feedback(
    state: State<AppState>,
    result_id: String,
    feedback: String,
) -> Result<(), String> {
    state
        .db
        .set_result_feedback(&result_id, &feedback)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_result(state: State<AppState>, result_id: String) -> Result<(), String> {
    state
        .db
        .delete_result(&result_id)
        .map_err(|e| e.to_string())?
        .then_some(())
        .ok_or_else(|| "Result not found".to_string())
}

#[tauri::command]
fn clear_results(state: State<AppState>, agent_id: Option<String>) -> Result<i32, String> {
    state
        .db
        .clear_results(agent_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_run_logs(
    state: State<AppState>,
    agent_id: String,
    limit: Option<i32>,
) -> Result<Vec<RunLog>, String> {
    state
        .db
        .list_run_logs(&agent_id, limit.unwrap_or(20))
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct SaveCredentialRequest {
    pub site_id: String,
    pub label: String,
    pub username: String,
    pub password: String,
}

#[tauri::command]
fn save_credential(
    state: State<AppState>,
    req: SaveCredentialRequest,
) -> Result<CredentialRecord, String> {
    let payload = serde_json::json!({
        "username": req.username,
        "password": req.password,
    });
    let encrypted = encrypt_string(&payload.to_string()).map_err(|e| e.to_string())?;
    state
        .db
        .save_credential(&req.site_id, &req.label, &encrypted)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_credentials(state: State<AppState>) -> Result<Vec<CredentialSummary>, String> {
    let creds = state.db.list_credentials().map_err(|e| e.to_string())?;
    Ok(creds
        .into_iter()
        .map(|c| CredentialSummary {
            id: c.id,
            site_id: c.site_id,
            label: c.label,
            created_at: c.created_at.to_rfc3339(),
            login_url: c.login_url,
            has_session: c.has_session,
        })
        .collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSummary {
    pub id: String,
    pub site_id: String,
    pub label: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login_url: Option<String>,
    pub has_session: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectSiteRequest {
    pub site_id: String,
    pub label: String,
    pub login_url: String,
    pub username: String,
    pub password: String,
}

fn remove_credential_index_entry(data_dir: &PathBuf, site_id: &str) -> Result<(), String> {
    let index_path = data_dir.join("credential-index.json");
    if !index_path.exists() {
        return Ok(());
    }
    let content = std::fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
    let mut index: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&content).unwrap_or_default();
    index.remove(site_id);
    std::fs::write(&index_path, serde_json::to_string_pretty(&index).unwrap())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn connect_site(
    state: State<AppState>,
    req: ConnectSiteRequest,
) -> Result<CredentialSummary, String> {
    std::fs::create_dir_all(state.data_dir.join("sessions")).map_err(|e| e.to_string())?;

    let output = spawn_credential_runner(
        &state.credential_runner_path,
        &state.runner_spawn,
        &req.site_id,
        &req.login_url,
        &req.username,
        &req.password,
        &state.data_dir,
    )
    .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|e| format!("Runner output invalid: {e}"))?;

    if parsed.get("success").and_then(|v| v.as_bool()) != Some(true) {
        let err = parsed
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("Connection failed");
        return Err(err.to_string());
    }

    let session_path = state
        .data_dir
        .join("sessions")
        .join(format!("{}.json", req.site_id));

    let payload = serde_json::json!({
        "username": req.username,
        "password": req.password,
        "loginUrl": req.login_url,
        "sessionPath": session_path.to_string_lossy(),
        "connectedAt": chrono::Utc::now().to_rfc3339(),
    });
    let encrypted = encrypt_string(&payload.to_string()).map_err(|e| e.to_string())?;
    let record = state
        .db
        .upsert_credential(
            &req.site_id,
            &req.label,
            &encrypted,
            Some(&req.login_url),
            true,
        )
        .map_err(|e| e.to_string())?;

    Ok(CredentialSummary {
        id: record.id,
        site_id: record.site_id,
        label: record.label,
        created_at: record.created_at.to_rfc3339(),
        login_url: record.login_url,
        has_session: record.has_session,
    })
}

#[tauri::command]
fn delete_credential(state: State<AppState>, id: String) -> Result<(), String> {
    let site_id = state
        .db
        .delete_credential(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Credential not found".to_string())?;

    let session_path = state
        .data_dir
        .join("sessions")
        .join(format!("{site_id}.json"));
    let _ = std::fs::remove_file(session_path);
    remove_credential_index_entry(&state.data_dir, &site_id)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePrefsDto {
    auto_update_on_startup: bool,
}

#[tauri::command]
fn get_app_info() -> updater::AppInfo {
    updater::get_app_info()
}

#[tauri::command]
async fn check_for_updates(
    app: AppHandle,
    auto_install: Option<bool>,
    manual: Option<bool>,
) -> Result<updater::UpdateCheckResult, String> {
    Ok(updater::check_for_updates(app, auto_install.unwrap_or(false), manual.unwrap_or(false)).await)
}

#[tauri::command]
fn get_update_prefs(state: State<AppState>) -> UpdatePrefsDto {
    let enabled = updater::read_auto_update_pref(|key| {
        state.db.get_setting(key).ok().flatten()
    });
    UpdatePrefsDto {
        auto_update_on_startup: enabled,
    }
}

#[tauri::command]
fn set_update_prefs(state: State<AppState>, auto_update_on_startup: bool) -> Result<UpdatePrefsDto, String> {
    let value = if auto_update_on_startup { "1" } else { "0" };
    state
        .db
        .set_setting(updater::AUTO_UPDATE_SETTING_KEY, value)
        .map_err(|e| e.to_string())?;
    Ok(UpdatePrefsDto {
        auto_update_on_startup,
    })
}

#[tauri::command]
fn get_setting(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    state.db.get_setting(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    state.db.set_setting(&key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_data_dir(state: State<AppState>) -> String {
    state.data_dir.to_string_lossy().to_string()
}

#[derive(Deserialize)]
pub struct RunAgentRequest {
    pub agent_id: String,
    pub effort: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunAgentResponse {
    pub run_id: String,
    pub queued: bool,
    pub queue_position: usize,
}

fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .output();
    }
}

fn effort_to_string(effort: &EffortLevel) -> String {
    match effort {
        EffortLevel::Low => "low".to_string(),
        EffortLevel::Medium => "medium".to_string(),
        EffortLevel::High => "high".to_string(),
        EffortLevel::SuperHigh => "super_high".to_string(),
        EffortLevel::UltraHigh => "ultra_high".to_string(),
    }
}

fn parse_json_percent(value: Option<&serde_json::Value>) -> u32 {
    match value {
        Some(serde_json::Value::Number(n)) => n
            .as_f64()
            .map(|f| f.round().clamp(0.0, 100.0) as u32)
            .unwrap_or(0),
        _ => 0,
    }
}

struct ProgressSnapshot {
    phase: String,
    percent: u32,
    message: String,
    run_id: Option<String>,
}

fn parse_progress_log_line(line: &str) -> Option<ProgressSnapshot> {
    let line = line.trim();
    if !line.starts_with('[') {
        return None;
    }
    let end = line.find(']')?;
    let phase = line[1..end].to_string();
    let rest = line[end + 1..].trim();
    let pct_marker = rest.find('%')?;
    let percent: u32 = rest[..pct_marker].trim().parse().ok()?;
    let mut message = rest[pct_marker + 1..].trim().to_string();
    if let Some(paren) = message.find(" (") {
        message = message[..paren].trim().to_string();
    }
    Some(ProgressSnapshot {
        phase,
        percent,
        message,
        run_id: None,
    })
}

fn read_progress_for_run(
    data_dir: &PathBuf,
    agent_id: &str,
    expected_run_id: &str,
) -> ProgressSnapshot {
    let progress_path = data_dir.join("progress").join(format!("{agent_id}.json"));
    if progress_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&progress_path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                let file_run_id = val.get("runId").and_then(|v| v.as_str());
                if file_run_id.is_none() || file_run_id == Some(expected_run_id) {
                    return ProgressSnapshot {
                        phase: val
                            .get("phase")
                            .and_then(|v| v.as_str())
                            .unwrap_or("starting")
                            .to_string(),
                        percent: parse_json_percent(val.get("percent")),
                        message: val
                            .get("message")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        run_id: file_run_id.map(str::to_string),
                    };
                }
            }
        }
    }

    let log_path = data_dir.join("runs").join(format!("{expected_run_id}.log"));
    if let Ok(content) = std::fs::read_to_string(log_path) {
        for line in content.lines().rev() {
            if let Some(snapshot) = parse_progress_log_line(line) {
                return ProgressSnapshot {
                    run_id: Some(expected_run_id.to_string()),
                    ..snapshot
                };
            }
        }
    }

    ProgressSnapshot {
        phase: "starting".to_string(),
        percent: 0,
        message: "Iniciando agente…".to_string(),
        run_id: Some(expected_run_id.to_string()),
    }
}

fn write_progress_snapshot(
    data_dir: &PathBuf,
    agent_id: &str,
    run_id: &str,
    phase: &str,
    percent: u32,
    message: &str,
) {
    let progress_dir = data_dir.join("progress");
    let _ = std::fs::create_dir_all(&progress_dir);
    let payload = serde_json::json!({
        "phase": phase,
        "percent": percent,
        "message": message,
        "runId": run_id,
        "updatedAt": chrono::Utc::now().to_rfc3339(),
    });
    let _ = std::fs::write(
        progress_dir.join(format!("{agent_id}.json")),
        payload.to_string(),
    );
}

fn status_from_phase(phase: &str, fallback: &str) -> String {
    match phase {
        "done" => "success".to_string(),
        "error" => "failed".to_string(),
        "cancelled" => "cancelled".to_string(),
        "queued" => "queued".to_string(),
        "starting" | "planning" | "thinking" | "searching" | "evaluating" | "extracting"
        | "filtering" | "exporting" => "running".to_string(),
        _ if fallback == "queued" => "queued".to_string(),
        _ => fallback.to_string(),
    }
}

fn write_progress_cancelled(data_dir: &PathBuf, agent_id: &str, run_id: &str) {
    let progress_dir = data_dir.join("progress");
    let _ = std::fs::create_dir_all(&progress_dir);
    let payload = serde_json::json!({
        "phase": "cancelled",
        "percent": 0,
        "message": "Cancelled by user",
        "runId": run_id,
        "updatedAt": chrono::Utc::now().to_rfc3339(),
    });
    let _ = std::fs::write(
        progress_dir.join(format!("{agent_id}.json")),
        payload.to_string(),
    );
}

fn is_cancellable_run_status(status: &str) -> bool {
    matches!(status, "running" | "starting" | "queued")
}

fn is_terminal_progress_phase(phase: &str) -> bool {
    matches!(phase, "done" | "error" | "cancelled")
}

fn emit_run_cancelled(app: &AppHandle, agent_id: &str, run_id: &str) {
    let _ = app.emit(
        "agent-run-cancelled",
        serde_json::json!({
            "agentId": agent_id,
            "runId": run_id,
        }),
    );
}

fn cancel_pending_run(
    app: &AppHandle,
    db: &Arc<Database>,
    data_dir: &PathBuf,
    removed: QueuedRun,
    run_id: &str,
) {
    write_progress_cancelled(data_dir, &removed.agent_id, run_id);
    let _ = db.save_run_log(&RunLog {
        id: run_id.to_string(),
        agent_id: removed.agent_id.clone(),
        effort: parse_effort_level(&removed.effort),
        phase: "cancelled".to_string(),
        status: "cancelled".to_string(),
        summary: "Cancelled by user".to_string(),
        results_count: 0,
        started_at: chrono::Utc::now(),
        finished_at: Some(chrono::Utc::now()),
    });
    emit_run_cancelled(app, &removed.agent_id, run_id);
}

fn handle_cancelled_run(
    app: &AppHandle,
    db: &Arc<Database>,
    agent_id: &str,
    effort: &str,
    run_id: &str,
) {
    let _ = db.save_run_log(&RunLog {
        id: run_id.to_string(),
        agent_id: agent_id.to_string(),
        effort: parse_effort_level(effort),
        phase: "cancelled".to_string(),
        status: "cancelled".to_string(),
        summary: "Cancelled by user".to_string(),
        results_count: 0,
        started_at: chrono::Utc::now(),
        finished_at: Some(chrono::Utc::now()),
    });
    emit_run_cancelled(app, agent_id, run_id);
}

fn spawn_agent_run_worker(
    app: AppHandle,
    db: Arc<Database>,
    data_dir: PathBuf,
    runner_path: PathBuf,
    runner_spawn: RunnerSpawnConfig,
    run_queue: Arc<Mutex<RunQueue>>,
    agent_id: String,
    effort: String,
    run_id: String,
) {
    std::thread::spawn(move || {
        let finish = || {
            finish_run_and_start_next(
                app.clone(),
                db.clone(),
                data_dir.clone(),
                runner_path.clone(),
                runner_spawn.clone(),
                run_queue.clone(),
                &agent_id,
            );
        };

        match spawn_agent_runner(
            &runner_path,
            &runner_spawn,
            &agent_id,
            &effort,
            &data_dir,
            &run_id,
        ) {
            Ok(child) => {
                let pid = child.id();
                {
                    let mut queue = run_queue.lock().expect("run queue lock");
                    queue.active_pid = Some(pid);
                    queue.active_run_id = Some(run_id.clone());
                    queue.active_effort = Some(effort.clone());
                    queue.active_started_at = Some(chrono::Utc::now().to_rfc3339());
                }
                let _ = db.save_run_log(&RunLog {
                    id: run_id.clone(),
                    agent_id: agent_id.clone(),
                    effort: parse_effort_level(&effort),
                    phase: "running".to_string(),
                    status: "running".to_string(),
                    summary: String::new(),
                    results_count: 0,
                    started_at: chrono::Utc::now(),
                    finished_at: None,
                });
                let _ = app.emit(
                    "agent-run-started",
                    serde_json::json!({
                        "agentId": agent_id,
                        "runId": run_id,
                    }),
                );

                let was_cancelled = {
                    let queue = run_queue.lock().expect("run queue lock");
                    queue.cancelled_run_ids.contains(&run_id)
                };

                let output = if was_cancelled {
                    kill_process_tree(pid);
                    child.wait_with_output()
                } else {
                    child.wait_with_output()
                };

                {
                    let mut queue = run_queue.lock().expect("run queue lock");
                    queue.active_pid = None;
                    queue.active_run_id = None;
                    queue.active_effort = None;
                    queue.active_started_at = None;
                }

                let cancelled = run_queue
                    .lock()
                    .expect("run queue lock")
                    .cancelled_run_ids
                    .remove(&run_id);

                match output {
                    Ok(out) => {
                        let stdout = String::from_utf8_lossy(&out.stdout);
                        let stderr = String::from_utf8_lossy(&out.stderr);
                        let _ = std::fs::create_dir_all(data_dir.join("runs"));
                        append_run_process_log(&data_dir, &run_id, &stdout, &stderr);
                        if cancelled {
                            handle_cancelled_run(&app, &db, &agent_id, &effort, &run_id);
                        } else {
                            finalize_agent_run(
                                &app,
                                &db,
                                &data_dir,
                                &agent_id,
                                &effort,
                                &run_id,
                                &stdout,
                                &stderr,
                                out.status.success(),
                            );
                        }
                    }
                    Err(e) => {
                        if cancelled {
                            handle_cancelled_run(&app, &db, &agent_id, &effort, &run_id);
                        } else {
                            let _ = db.set_agent_error(&agent_id, &e.to_string());
                            let _ = app.emit("agent-run-error", e.to_string());
                        }
                    }
                }
            }
            Err(e) => {
                let _ = db.set_agent_error(&agent_id, &e.to_string());
                let _ = app.emit("agent-run-error", e.to_string());
            }
        }
        finish();
    });
}

fn finish_run_and_start_next(
    app: AppHandle,
    db: Arc<Database>,
    data_dir: PathBuf,
    runner_path: PathBuf,
    runner_spawn: RunnerSpawnConfig,
    run_queue: Arc<Mutex<RunQueue>>,
    completed_agent_id: &str,
) {
    let next = {
        let mut queue = run_queue.lock().expect("run queue lock");
        if queue.active_agent_id.as_deref() == Some(completed_agent_id) {
            queue.active_agent_id = None;
        }
        queue.pending.pop_front()
    };

    if let Some(queued) = next {
        {
            let mut queue = run_queue.lock().expect("run queue lock");
            queue.active_agent_id = Some(queued.agent_id.clone());
            queue.active_run_id = Some(queued.run_id.clone());
            queue.active_effort = Some(queued.effort.clone());
            queue.active_started_at = Some(chrono::Utc::now().to_rfc3339());
        }
        let _ = app.emit(
            "agent-run-started",
            serde_json::json!({
                "agentId": queued.agent_id,
                "runId": queued.run_id,
            }),
        );
        spawn_agent_run_worker(
            app,
            db,
            data_dir,
            runner_path,
            runner_spawn,
            run_queue,
            queued.agent_id,
            queued.effort,
            queued.run_id,
        );
    }
}

#[tauri::command]
fn run_agent(
    app: AppHandle,
    state: State<AppState>,
    req: RunAgentRequest,
) -> Result<RunAgentResponse, String> {
    let record = state.db.get_agent(&req.agent_id).map_err(|e| e.to_string())?;
    ensure_agent_file(&state.data_dir, &record.spec)?;

    let run_id = Uuid::new_v4().to_string();
    let queued_run = QueuedRun {
        agent_id: req.agent_id.clone(),
        effort: req.effort.clone(),
        run_id: run_id.clone(),
    };

    let (start_now, queue_position) = {
        let mut queue = state.run_queue.lock().map_err(|_| "Run queue lock failed")?;
        if queue.active_agent_id.is_none() {
            queue.active_agent_id = Some(req.agent_id.clone());
            queue.active_run_id = Some(run_id.clone());
            queue.active_effort = Some(req.effort.clone());
            queue.active_started_at = Some(chrono::Utc::now().to_rfc3339());
            (true, 0)
        } else {
            queue.pending.push_back(queued_run);
            (false, queue.pending.len())
        }
    };

    let _ = state.db.save_run_log(&RunLog {
        id: run_id.clone(),
        agent_id: req.agent_id.clone(),
        effort: parse_effort_level(&req.effort),
        phase: if start_now {
            "starting".to_string()
        } else {
            "queued".to_string()
        },
        status: if start_now {
            "running".to_string()
        } else {
            "queued".to_string()
        },
        summary: String::new(),
        results_count: 0,
        started_at: chrono::Utc::now(),
        finished_at: None,
    });

    if start_now {
        write_progress_snapshot(
            &state.data_dir,
            &req.agent_id,
            &run_id,
            "starting",
            0,
            "Iniciando agente…",
        );
        spawn_agent_run_worker(
            app,
            state.db.clone(),
            state.data_dir.clone(),
            state.runner_path.clone(),
            state.runner_spawn.clone(),
            state.run_queue.clone(),
            req.agent_id,
            req.effort,
            run_id.clone(),
        );
    } else {
        write_progress_snapshot(
            &state.data_dir,
            &req.agent_id,
            &run_id,
            "queued",
            0,
            &format!("En cola (posición {queue_position})"),
        );
        let _ = app.emit(
            "agent-run-queued",
            serde_json::json!({
                "agentId": req.agent_id,
                "runId": run_id,
                "queuePosition": queue_position,
            }),
        );
    }

    Ok(RunAgentResponse {
        run_id,
        queued: !start_now,
        queue_position,
    })
}

fn parse_runner_stdout(stdout: &str) -> Option<serde_json::Value> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(v) = serde_json::from_str(trimmed) {
        return Some(v);
    }
    for line in trimmed.lines().rev() {
        let line = line.trim();
        if line.starts_with('{') {
            if let Ok(v) = serde_json::from_str(line) {
                return Some(v);
            }
        }
    }
    None
}

fn read_run_file(data_dir: &PathBuf, run_id: &str) -> Option<serde_json::Value> {
    let path = data_dir.join("runs").join(format!("{run_id}.json"));
    if !path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn read_run_results(data_dir: &PathBuf, run_id: &str) -> Option<Vec<serde_json::Value>> {
    read_run_file(data_dir, run_id)
        .and_then(|parsed| parsed.get("results").and_then(|r| r.as_array()).cloned())
}

fn read_inbox_run_results(
    data_dir: &PathBuf,
    agent_id: &str,
    run_id: &str,
) -> Option<Vec<serde_json::Value>> {
    let path = data_dir
        .join("inbox")
        .join(agent_id)
        .join(format!("{run_id}.json"));
    if !path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    let parsed = serde_json::from_str::<serde_json::Value>(&content).ok()?;
    parsed.get("results").and_then(|r| r.as_array()).cloned()
}

fn persist_run_results(
    db: &Arc<Database>,
    agent_id: &str,
    run_id: &str,
    data_dir: &PathBuf,
) -> i32 {
    let results = read_run_results(data_dir, run_id)
        .or_else(|| read_inbox_run_results(data_dir, agent_id, run_id))
        .filter(|r| !r.is_empty());
    if let Some(items) = results {
        match db.save_results(agent_id, run_id, &items) {
            Ok(n) => {
                eprintln!("AIIA: saved {n} results for run {run_id}");
                n
            }
            Err(e) => {
                eprintln!("AIIA: save_results failed for {run_id}: {e}");
                0
            }
        }
    } else {
        0
    }
}

fn parse_effort_level(effort: &str) -> EffortLevel {
    match effort {
        "low" => EffortLevel::Low,
        "high" => EffortLevel::High,
        "super_high" => EffortLevel::SuperHigh,
        "ultra_high" => EffortLevel::UltraHigh,
        _ => EffortLevel::Medium,
    }
}

fn finalize_agent_run(
    app: &AppHandle,
    db: &Arc<Database>,
    data_dir: &PathBuf,
    agent_id: &str,
    effort: &str,
    run_id: &str,
    stdout: &str,
    stderr: &str,
    exit_ok: bool,
) {
    let parsed = parse_runner_stdout(stdout);
    let run_file = read_run_file(data_dir, run_id);
    let file_results = read_run_results(data_dir, run_id)
        .or_else(|| read_inbox_run_results(data_dir, agent_id, run_id));
    let count = file_results.as_ref().map(|r| r.len()).unwrap_or(0);
    let summary = parsed
        .as_ref()
        .and_then(|p| p.get("summary").and_then(|v| v.as_str()))
        .or_else(|| {
            run_file
                .as_ref()
                .and_then(|f| f.get("summary").and_then(|v| v.as_str()))
        })
        .unwrap_or("")
        .to_string();
    let parsed_success = parsed
        .as_ref()
        .and_then(|p| p.get("success").and_then(|v| v.as_bool()));
    let runner_success = parsed_success.unwrap_or(count > 0 || exit_ok);

    if runner_success || count > 0 {
        let saved = if count > 0 {
            persist_run_results(db, agent_id, run_id, data_dir)
        } else {
            0
        };
        let effective_count = if saved > 0 { saved as usize } else { count };
        let _ = db.update_next_run(
            agent_id,
            db.get_agent(agent_id)
                .map(|r| r.spec.schedule.interval_minutes)
                .unwrap_or(1440),
        );
        let _ = db.save_run_log(&RunLog {
            id: run_id.to_string(),
            agent_id: agent_id.to_string(),
            effort: parse_effort_level(effort),
            phase: "done".to_string(),
            status: "success".to_string(),
            summary: if summary.is_empty() {
                format!("{effective_count} results")
            } else {
                summary.clone()
            },
            results_count: effective_count as i32,
            started_at: chrono::Utc::now(),
            finished_at: Some(chrono::Utc::now()),
        });
        let notify = db
            .get_agent(agent_id)
            .map(|r| r.spec.output.notify)
            .unwrap_or(true);
        let payload = serde_json::json!({
            "success": true,
            "runId": run_id,
            "agentId": agent_id,
            "count": effective_count,
            "summary": if summary.is_empty() { format!("Completed with {effective_count} results") } else { summary.clone() },
        });
        let _ = app.emit("agent-run-complete", payload);
        if notify {
            let body = if summary.is_empty() {
                format!("{effective_count} results ready in inbox")
            } else {
                format!("{summary} ({effective_count} results)")
            };
            let _ = app
                .notification()
                .builder()
                .title("AIIA")
                .body(body)
                .show();
        }
    } else {
        let err = parsed
            .as_ref()
            .and_then(|p| p.get("error").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .or_else(|| {
                let stderr_line = stderr.trim().lines().last().unwrap_or("").trim();
                if !stderr_line.is_empty() {
                    Some(stderr_line.to_string())
                } else {
                    None
                }
            })
            .unwrap_or_else(|| "Run failed".to_string());
        let _ = db.set_agent_error(agent_id, &err);
        let _ = app.emit("agent-run-error", err);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportResultsResponse {
    csv_path: String,
    count: i32,
}

#[tauri::command]
fn export_results_csv(
    state: State<AppState>,
    agent_id: Option<String>,
) -> Result<ExportResultsResponse, String> {
    let results = state
        .db
        .list_results(agent_id.as_deref(), 10_000)
        .map_err(|e| e.to_string())?;
    if results.is_empty() {
        return Err("No results to export".to_string());
    }
    let exports_dir = state.data_dir.join("exports");
    std::fs::create_dir_all(&exports_dir).map_err(|e| e.to_string())?;
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let file_name = if let Some(ref aid) = agent_id {
        format!("{aid}-{stamp}.csv")
    } else {
        format!("all-results-{stamp}.csv")
    };
    let csv_path = exports_dir.join(&file_name);
    let mut schema = Vec::new();
    for r in &results {
        if let Some(obj) = r.data.as_object() {
            for key in obj.keys() {
                if !schema.contains(key) {
                    schema.push(key.clone());
                }
            }
        }
    }
    if schema.is_empty() {
        schema = vec![
            "title".to_string(),
            "url".to_string(),
            "score".to_string(),
        ];
    }
    let mut lines = vec![schema.join(",")];
    for r in &results {
        let row = schema
            .iter()
            .map(|field| {
                let raw = r
                    .data
                    .get(field)
                    .map(|v| match v {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default();
                format!("\"{}\"", raw.replace('"', "\"\""))
            })
            .collect::<Vec<_>>()
            .join(",");
        lines.push(row);
    }
    std::fs::write(&csv_path, lines.join("\n")).map_err(|e| e.to_string())?;
    Ok(ExportResultsResponse {
        csv_path: csv_path.to_string_lossy().to_string(),
        count: results.len() as i32,
    })
}

fn results_schema(results: &[ResultRecord]) -> Vec<String> {
    let mut schema = Vec::new();
    for r in results {
        if let Some(obj) = r.data.as_object() {
            for key in obj.keys() {
                if !schema.contains(key) {
                    schema.push(key.clone());
                }
            }
        }
    }
    if schema.is_empty() {
        schema = vec!["title".to_string(), "url".to_string(), "score".to_string()];
    }
    schema
}

fn expand_user_path(path: &str) -> String {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    path.replace("%USERPROFILE%", &home)
        .replace("~/", &format!("{home}/"))
}

/// Exporta los resultados (filtrados por agente si se indica) en el formato
/// solicitado: "csv", "json" o "excel". Devuelve la ruta del archivo generado.
#[tauri::command]
fn export_results_as(
    state: State<AppState>,
    agent_id: Option<String>,
    format: String,
) -> Result<ExportResultsResponse, String> {
    let results = state
        .db
        .list_results(agent_id.as_deref(), 10_000)
        .map_err(|e| e.to_string())?;
    if results.is_empty() {
        return Err("No results to export".to_string());
    }

    let fmt = format.to_lowercase();

    // Excel: reutiliza el .xlsx generado por el agente en su última ejecución.
    if fmt == "excel" || fmt == "xlsx" {
        let aid = agent_id
            .as_ref()
            .ok_or_else(|| "Selecciona un agente para descargar en Excel".to_string())?;
        let agent = state.db.get_agent(aid).map_err(|e| e.to_string())?;
        let candidate = agent
            .spec
            .output
            .excel_path
            .as_deref()
            .map(expand_user_path)
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| {
                state
                    .data_dir
                    .join("exports")
                    .join(format!("{}.xlsx", agent.spec.name))
            });
        if candidate.exists() {
            return Ok(ExportResultsResponse {
                csv_path: candidate.to_string_lossy().to_string(),
                count: results.len() as i32,
            });
        }
        return Err(
            "No hay Excel generado todavía. Ejecuta el agente con destino Excel primero.".to_string(),
        );
    }

    let exports_dir = state.data_dir.join("exports");
    std::fs::create_dir_all(&exports_dir).map_err(|e| e.to_string())?;
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let base = agent_id.clone().unwrap_or_else(|| "all-results".to_string());

    if fmt == "json" {
        let items: Vec<&serde_json::Value> = results.iter().map(|r| &r.data).collect();
        let path = exports_dir.join(format!("{base}-{stamp}.json"));
        let json = serde_json::to_string_pretty(&items).map_err(|e| e.to_string())?;
        std::fs::write(&path, json).map_err(|e| e.to_string())?;
        return Ok(ExportResultsResponse {
            csv_path: path.to_string_lossy().to_string(),
            count: results.len() as i32,
        });
    }

    // CSV por defecto.
    let schema = results_schema(&results);
    let mut lines = vec![schema.join(",")];
    for r in &results {
        let row = schema
            .iter()
            .map(|field| {
                let raw = r
                    .data
                    .get(field)
                    .map(|v| match v {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default();
                format!("\"{}\"", raw.replace('"', "\"\""))
            })
            .collect::<Vec<_>>()
            .join(",");
        lines.push(row);
    }
    let path = exports_dir.join(format!("{base}-{stamp}.csv"));
    std::fs::write(&path, lines.join("\n")).map_err(|e| e.to_string())?;
    Ok(ExportResultsResponse {
        csv_path: path.to_string_lossy().to_string(),
        count: results.len() as i32,
    })
}

#[tauri::command]
fn sync_latest_run_results(
    state: State<AppState>,
    agent_id: String,
) -> Result<i32, String> {
    sync_run_results_from_disk(&state.db, &state.data_dir, Some(agent_id.as_str()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunExecutionDto {
    run_id: String,
    agent_id: String,
    agent_name: String,
    effort: String,
    status: String,
    phase: String,
    percent: u32,
    message: String,
    results_count: i32,
    queue_position: Option<usize>,
    started_at: String,
    finished_at: Option<String>,
    summary: String,
    cancellable: bool,
}

#[tauri::command]
fn list_runs(
    state: State<AppState>,
    agent_id: Option<String>,
    limit: Option<i32>,
) -> Result<Vec<RunExecutionDto>, String> {
    let limit = limit.unwrap_or(50);
    let logs = state
        .db
        .list_all_run_logs(agent_id.as_deref(), limit)
        .map_err(|e| e.to_string())?;
    let agents = state.db.list_agents().map_err(|e| e.to_string())?;
    let names: HashMap<String, String> = agents
        .into_iter()
        .map(|a| (a.id, a.spec.name))
        .collect();
    let queue = state
        .run_queue
        .lock()
        .map_err(|_| "Run queue lock failed".to_string())?;

    let runs = logs
        .into_iter()
        .map(|log| {
            let effort = effort_to_string(&log.effort);
            let mut status = log.status.clone();
            let mut phase = log.phase.clone();
            let mut percent = 0u32;
            let mut message = if log.summary.is_empty() {
                String::new()
            } else {
                log.summary.clone()
            };
            let mut queue_position = None;

            let is_queue_active = queue.active_run_id.as_deref() == Some(log.id.as_str());

            if is_queue_active || log.status == "running" || log.status == "starting" {
                let snapshot = read_progress_for_run(&state.data_dir, &log.agent_id, &log.id);
                let progress_for_this_run = snapshot.run_id.as_deref() == Some(log.id.as_str())
                    || is_queue_active
                    || log.status == "running"
                    || log.status == "starting";
                if progress_for_this_run {
                    status = status_from_phase(&snapshot.phase, &status);
                    phase = snapshot.phase;
                    percent = snapshot.percent;
                    if !snapshot.message.is_empty() {
                        message = snapshot.message;
                    }
                }
            }

            for (i, pending) in queue.pending.iter().enumerate() {
                if pending.run_id == log.id {
                    status = "queued".to_string();
                    phase = "queued".to_string();
                    queue_position = Some(i + 1);
                    if message.is_empty() {
                        message = format!("Queued (position {})", i + 1);
                    }
                }
            }

            let in_live_queue = is_queue_active
                || queue.pending.iter().any(|pending| pending.run_id == log.id);
            if !in_live_queue && is_cancellable_run_status(&status) {
                let snapshot = read_progress_for_run(&state.data_dir, &log.agent_id, &log.id);
                if is_terminal_progress_phase(&snapshot.phase) {
                    status = status_from_phase(&snapshot.phase, &status);
                    phase = snapshot.phase;
                } else if log.finished_at.is_some() {
                    // Keep persisted terminal status from DB.
                } else if log.status == "queued" {
                    status = "cancelled".to_string();
                    phase = "cancelled".to_string();
                }
            }

            let cancellable = queue.active_run_id.as_deref() == Some(log.id.as_str())
                || queue.pending.iter().any(|pending| pending.run_id == log.id);

            RunExecutionDto {
                run_id: log.id,
                agent_id: log.agent_id.clone(),
                agent_name: names
                    .get(&log.agent_id)
                    .cloned()
                    .unwrap_or_else(|| log.agent_id.clone()),
                effort,
                status,
                phase,
                percent,
                message,
                results_count: log.results_count,
                queue_position,
                started_at: log.started_at.to_rfc3339(),
                finished_at: log.finished_at.map(|t| t.to_rfc3339()),
                summary: log.summary,
                cancellable,
            }
        })
        .collect();

    Ok(runs)
}

#[tauri::command]
fn cancel_run(app: AppHandle, state: State<AppState>, run_id: String) -> Result<(), String> {
    let (active, agent_id, pid) = {
        let mut queue = state
            .run_queue
            .lock()
            .map_err(|_| "Run queue lock failed".to_string())?;
        if queue.active_run_id.as_deref() == Some(run_id.as_str()) {
            queue.cancelled_run_ids.insert(run_id.clone());
            let agent_id = queue.active_agent_id.clone().unwrap_or_default();
            let pid = queue.active_pid;
            (true, agent_id, pid)
        } else {
            let idx = queue.pending.iter().position(|r| r.run_id == run_id);
            if let Some(i) = idx {
                let removed = queue.pending.remove(i).unwrap();
                drop(queue);
                cancel_pending_run(&app, &state.db, &state.data_dir, removed, &run_id);
                return Ok(());
            }

            if let Ok(Some(log)) = state.db.get_run_log(&run_id) {
                if !is_cancellable_run_status(&log.status) || log.finished_at.is_some() {
                    return Ok(());
                }
                let snapshot = read_progress_for_run(&state.data_dir, &log.agent_id, &run_id);
                if is_terminal_progress_phase(&snapshot.phase) {
                    return Ok(());
                }
                if queue.active_agent_id.as_deref() == Some(log.agent_id.as_str())
                    && queue.active_pid.is_some()
                {
                    queue.cancelled_run_ids.insert(run_id.clone());
                    queue.active_run_id = Some(run_id.clone());
                    let pid = queue.active_pid;
                    drop(queue);
                    write_progress_cancelled(&state.data_dir, &log.agent_id, &run_id);
                    if let Some(pid) = pid {
                        kill_process_tree(pid);
                    }
                    return Ok(());
                }
            }

            return Err("Run not found or already finished".to_string());
        }
    };

    if active {
        write_progress_cancelled(&state.data_dir, &agent_id, &run_id);
        if let Some(pid) = pid {
            kill_process_tree(pid);
        }
        Ok(())
    } else {
        Err("Run not found or already finished".to_string())
    }
}

fn append_run_process_log(data_dir: &PathBuf, run_id: &str, stdout: &str, stderr: &str) {
    let log_path = data_dir.join("runs").join(format!("{run_id}.log"));
    if stdout.trim().is_empty() && stderr.trim().is_empty() {
        return;
    }
    let mut content = std::fs::read_to_string(&log_path).unwrap_or_default();
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str("\n=== PROCESS OUTPUT ===\n");
    if !stdout.trim().is_empty() {
        content.push_str("--- stdout ---\n");
        content.push_str(stdout);
        if !stdout.ends_with('\n') {
            content.push('\n');
        }
    }
    if !stderr.trim().is_empty() {
        content.push_str("--- stderr ---\n");
        content.push_str(stderr);
        if !stderr.ends_with('\n') {
            content.push('\n');
        }
    }
    let _ = std::fs::write(log_path, content);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunLogDto {
    run_id: String,
    content: String,
    is_live: bool,
    line_count: u32,
}

#[tauri::command]
fn get_run_log(
    state: State<AppState>,
    run_id: String,
    agent_id: Option<String>,
) -> Result<RunLogDto, String> {
    let log_path = state.data_dir.join("runs").join(format!("{run_id}.log"));
    let mut content = if log_path.exists() {
        std::fs::read_to_string(&log_path).unwrap_or_default()
    } else {
        String::new()
    };

    let is_live = {
        let queue = state
            .run_queue
            .lock()
            .map_err(|_| "Run queue lock failed".to_string())?;
        queue.active_run_id.as_deref() == Some(run_id.as_str())
            || queue.pending.iter().any(|r| r.run_id == run_id)
    };

    if content.is_empty() {
        if let Some(aid) = agent_id {
            let snapshot = read_progress_for_run(&state.data_dir, &aid, &run_id);
            if !snapshot.message.is_empty() || snapshot.percent > 0 {
                content = format!(
                    "[{}] {}% {}\n",
                    snapshot.phase, snapshot.percent, snapshot.message
                );
            }
        }
    }

    let line_count = content.lines().count() as u32;
    Ok(RunLogDto {
        run_id,
        content,
        is_live,
        line_count,
    })
}

#[tauri::command]
fn delete_run(state: State<AppState>, run_id: String) -> Result<(), String> {
    {
        let queue = state
            .run_queue
            .lock()
            .map_err(|_| "Run queue lock failed".to_string())?;
        if queue.active_run_id.as_deref() == Some(run_id.as_str()) {
            return Err("Cannot delete a running execution".to_string());
        }
        if queue.pending.iter().any(|r| r.run_id == run_id) {
            return Err("Cannot delete a queued execution".to_string());
        }
    }

    let agent_id = state
        .db
        .delete_run(&run_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Run not found".to_string())?;

    let _ = std::fs::remove_file(
        state
            .data_dir
            .join("runs")
            .join(format!("{run_id}.json")),
    );
    let _ = std::fs::remove_file(
        state
            .data_dir
            .join("runs")
            .join(format!("{run_id}.log")),
    );
    let inbox_base = state.data_dir.join("inbox").join(&agent_id);
    let _ = std::fs::remove_file(inbox_base.join(format!("{run_id}.json")));
    let _ = std::fs::remove_file(inbox_base.join(format!("{run_id}-report.json")));

    Ok(())
}

#[tauri::command]
fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunProgressDto {
    phase: String,
    percent: u32,
    message: String,
    run_id: Option<String>,
    thinking_step: Option<String>,
    budget_used_sec: Option<u32>,
}

#[tauri::command]
fn get_run_progress(
    state: State<AppState>,
    agent_id: String,
) -> Result<Option<RunProgressDto>, String> {
    let path = state.data_dir.join("progress").join(format!("{agent_id}.json"));
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let val: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(RunProgressDto {
        phase: val
            .get("phase")
            .and_then(|v| v.as_str())
            .unwrap_or("starting")
            .to_string(),
        percent: parse_json_percent(val.get("percent")),
        message: val
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        run_id: val
            .get("runId")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        thinking_step: val
            .get("thinkingStep")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        budget_used_sec: val
            .get("budgetUsedSec")
            .and_then(|v| v.as_u64())
            .map(|n| n as u32),
    }))
}

#[tauri::command]
fn cleanup_retention(state: State<AppState>, agent_id: String) -> Result<i32, String> {
    let record = state.db.get_agent(&agent_id).map_err(|e| e.to_string())?;
    state
        .db
        .cleanup_retention(&agent_id, record.spec.retention_days)
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLimitsDto {
    pub published: usize,
    pub max: usize,
}

#[tauri::command]
fn get_agent_limits(state: State<AppState>) -> Result<AgentLimitsDto, String> {
    Ok(AgentLimitsDto {
        published: state.db.count_published().map_err(|e| e.to_string())?,
        max: MAX_PUBLISHED_AGENTS,
    })
}

#[tauri::command]
fn get_published_count(state: State<AppState>) -> Result<usize, String> {
    state.db.count_published().map_err(|e| e.to_string())
}

fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let log_dir = data_dir();
        let _ = std::fs::create_dir_all(&log_dir);
        let _ = std::fs::write(log_dir.join("crash.log"), format!("{info}"));
        default(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();

    let db = match Database::open_default() {
        Ok(db) => Arc::new(db),
        Err(e) => {
            eprintln!("AIIA: no se pudo abrir la base de datos: {e}");
            let log_dir = data_dir();
            let _ = std::fs::create_dir_all(&log_dir);
            let _ = std::fs::write(log_dir.join("startup-error.log"), format!("{e}"));
            std::process::exit(1);
        }
    };
    let data_dir_path = data_dir();
    std::fs::create_dir_all(&data_dir_path).ok();
    std::fs::create_dir_all(data_dir_path.join("agents")).ok();
    std::fs::create_dir_all(data_dir_path.join("exports")).ok();

    std::fs::create_dir_all(data_dir_path.join("sessions")).ok();

    let bundle = resolve_runner_bundle();
    let runner_path = bundle.runner_path;
    let credential_runner_path = bundle.credential_runner_path;
    let runner_spawn = bundle.spawn_config;
    let db_for_startup = db.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            let app_handle = app.handle().clone();
            let db = db_for_startup.clone();
            updater::startup_update_check(app_handle, move |key| {
                db.get_setting(key).ok().flatten()
            });

            Ok(())
        })
        .manage(AppState {
            db,
            data_dir: data_dir_path,
            runner_path,
            credential_runner_path,
            runner_spawn,
            run_queue: Arc::new(Mutex::new(RunQueue::default())),
        })
        .invoke_handler(tauri::generate_handler![
            get_hardware_info,
            check_ollama,
            get_ollama_status,
            setup_ollama,
            ensure_ollama_for_planner,
            ensure_ollama_model,
            ollama_chat,
            list_agents,
            get_agent,
            save_agent,
            delete_agent,
            request_review,
            publish_agent,
            pause_agent,
            resume_agent,
            get_agent_versions,
            list_results,
            save_results,
            set_result_feedback,
            delete_result,
            clear_results,
            list_run_logs,
            save_credential,
            list_credentials,
            connect_site,
            delete_credential,
            get_setting,
            set_setting,
            get_data_dir,
            run_agent,
            get_run_progress,
            cleanup_retention,
            get_published_count,
            get_agent_limits,
            export_results_csv,
            export_results_as,
            open_path,
            open_url,
            sync_latest_run_results,
            list_runs,
            cancel_run,
            delete_run,
            get_run_log,
            get_app_info,
            check_for_updates,
            get_update_prefs,
            set_update_prefs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

struct RunnerBundle {
    runner_path: PathBuf,
    credential_runner_path: PathBuf,
    spawn_config: RunnerSpawnConfig,
}

fn resolve_runner_bundle() -> RunnerBundle {
    let node_exe = resolve_node_executable();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let mut bundle_roots = vec![
                exe_dir.join("resources").join("runner-bundle"),
                exe_dir.join("runner-bundle"),
            ];
            if let Some(contents_dir) = exe_dir.parent() {
                bundle_roots.push(contents_dir.join("Resources").join("runner-bundle"));
            }

            for bundle_root in bundle_roots {
                let runner = bundle_root
                    .join("node_modules")
                    .join("@aiia")
                    .join("agent-runner")
                    .join("dist")
                    .join("index.js");
                if runner.exists() {
                    let credential = bundle_root
                        .join("node_modules")
                        .join("@aiia")
                        .join("credential-runner")
                        .join("dist")
                        .join("index.js");
                    let playwright = bundle_root.join("ms-playwright");
                    return RunnerBundle {
                        runner_path: runner,
                        credential_runner_path: credential,
                        spawn_config: RunnerSpawnConfig {
                            node_exe: node_exe.clone(),
                            cwd: bundle_root.clone(),
                            playwright_browsers_path: playwright
                                .exists()
                                .then_some(playwright),
                        },
                    };
                }
            }

            let legacy_runner = exe_dir.join("agent-runner").join("dist").join("index.js");
            if legacy_runner.exists() {
                let legacy_cred = exe_dir
                    .join("credential-runner")
                    .join("dist")
                    .join("index.js");
                return RunnerBundle {
                    runner_path: legacy_runner,
                    credential_runner_path: legacy_cred,
                    spawn_config: RunnerSpawnConfig {
                        node_exe,
                        cwd: exe_dir.to_path_buf(),
                        playwright_browsers_path: None,
                    },
                };
            }
        }
    }

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest.join("../../..");
    RunnerBundle {
        runner_path: repo_root.join("packages/agent-runner/dist/index.js"),
        credential_runner_path: repo_root.join("packages/credential-runner/dist/index.js"),
        spawn_config: RunnerSpawnConfig {
            node_exe,
            cwd: repo_root,
            playwright_browsers_path: None,
        },
    }
}
