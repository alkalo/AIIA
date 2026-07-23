//! Cloud Gemini cron sync — desktop ↔ services/cloud-scheduler

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::gemini::AiProvider;
use crate::{read_ai_provider, read_gemini_api_key, sync_run_results_from_disk, AppState};

const CLOUD_URL_KEY: &str = "cloud_base_url";
const CLOUD_TOKEN_KEY: &str = "cloud_token";
const CLOUD_SYNCED_KEY: &str = "cloud_last_sync_at";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub configured: bool,
    pub base_url: String,
    pub last_sync_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncResult {
    pub imported: u32,
    pub message: String,
}

fn cloud_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())
}

fn read_cloud_status(state: &AppState) -> Result<CloudStatus, String> {
    let base = state
        .db
        .get_setting(CLOUD_URL_KEY)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let last = state
        .db
        .get_setting(CLOUD_SYNCED_KEY)
        .map_err(|e| e.to_string())?;
    Ok(CloudStatus {
        configured: !base.trim().is_empty(),
        base_url: base,
        last_sync_at: last,
    })
}

#[tauri::command]
pub fn get_cloud_status(state: State<'_, AppState>) -> Result<CloudStatus, String> {
    read_cloud_status(&state)
}

#[tauri::command]
pub fn set_cloud_config(
    state: State<'_, AppState>,
    base_url: String,
    token: String,
) -> Result<CloudStatus, String> {
    state
        .db
        .set_setting(CLOUD_URL_KEY, base_url.trim())
        .map_err(|e| e.to_string())?;
    state
        .db
        .set_setting(CLOUD_TOKEN_KEY, token.trim())
        .map_err(|e| e.to_string())?;
    read_cloud_status(&state)
}

#[tauri::command]
pub fn push_agent_to_cloud(state: State<'_, AppState>, agent_id: String) -> Result<String, String> {
    let status = read_cloud_status(&state)?;
    if !status.configured {
        return Err("Cloud URL not configured (Settings)".into());
    }
    let token = state
        .db
        .get_setting(CLOUD_TOKEN_KEY)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let record = state.db.get_agent(&agent_id).map_err(|e| e.to_string())?;
    if !record.spec.schedule.cloud_enabled {
        return Err("Enable cloud schedule on this agent first".into());
    }
    if read_ai_provider(&state.db) != AiProvider::Gemini {
        return Err("Cloud runs require Gemini provider".into());
    }
    let gemini_key = read_gemini_api_key(&state.db)?.unwrap_or_default();
    if gemini_key.is_empty() {
        return Err("Gemini API key missing".into());
    }

    let url = format!(
        "{}/v1/agents/{}",
        status.base_url.trim_end_matches('/'),
        agent_id
    );
    let body = serde_json::json!({
        "spec": record.spec,
        "geminiApiKey": gemini_key,
    });
    let client = cloud_client()?;
    let mut req = client.put(&url).json(&body);
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    let res = req.send().map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let t = res.text().unwrap_or_default();
        return Err(format!("Cloud push failed: {t}"));
    }
    Ok("Agent registered on AIIA Cloud".into())
}

#[tauri::command]
pub fn pull_cloud_runs(state: State<'_, AppState>) -> Result<CloudSyncResult, String> {
    let status = read_cloud_status(&state)?;
    if !status.configured {
        return Ok(CloudSyncResult {
            imported: 0,
            message: "Cloud not configured".into(),
        });
    }
    let token = state
        .db
        .get_setting(CLOUD_TOKEN_KEY)
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    let since = state
        .db
        .get_setting(CLOUD_SYNCED_KEY)
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".into());

    let url = format!(
        "{}/v1/sync?since={}",
        status.base_url.trim_end_matches('/'),
        since.replace(':', "%3A")
    );
    let client = cloud_client()?;
    let mut req = client.get(&url);
    if !token.is_empty() {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    let res = req.send().map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let t = res.text().unwrap_or_default();
        return Err(format!("Cloud sync failed: {t}"));
    }
    let payload: serde_json::Value = res.json().map_err(|e| e.to_string())?;
    let runs = payload
        .get("runs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut touched_agents: Vec<String> = Vec::new();
    for run in &runs {
        let agent_id = run
            .get("agentId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let run_id = run
            .get("runId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if agent_id.is_empty() || run_id.is_empty() {
            continue;
        }
        let runs_dir = state.data_dir.join("runs");
        let _ = std::fs::create_dir_all(&runs_dir);
        let _ = std::fs::write(
            runs_dir.join(format!("{run_id}.json")),
            serde_json::to_vec_pretty(run).unwrap_or_default(),
        );

        if let Some(inbox) = run.get("inbox") {
            let inbox_dir = state.data_dir.join("inbox").join(&agent_id);
            let _ = std::fs::create_dir_all(&inbox_dir);
            let _ = std::fs::write(
                inbox_dir.join(format!("{run_id}.json")),
                serde_json::to_vec_pretty(inbox).unwrap_or_default(),
            );
        }
        if !touched_agents.iter().any(|a| a == &agent_id) {
            touched_agents.push(agent_id);
        }
    }

    let mut imported: i32 = 0;
    for agent_id in &touched_agents {
        let n = sync_run_results_from_disk(&state.db, &state.data_dir, Some(agent_id.as_str()))?;
        imported += n;
    }

    let now = chrono::Utc::now().to_rfc3339();
    let _ = state.db.set_setting(CLOUD_SYNCED_KEY, &now);

    Ok(CloudSyncResult {
        imported: imported.max(0) as u32,
        message: format!("Synced cloud runs ({imported} rows)"),
    })
}
