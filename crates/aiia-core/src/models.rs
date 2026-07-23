use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Draft,
    PendingReview,
    Published,
    Paused,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EffortLevel {
    Low,
    Medium,
    High,
    #[serde(rename = "super_high")]
    SuperHigh,
    #[serde(rename = "ultra_high")]
    UltraHigh,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAttachment {
    pub id: String,
    pub name: String,
    #[serde(alias = "mime_type")]
    pub mime_type: String,
    #[serde(alias = "size_bytes")]
    pub size_bytes: i64,
    #[serde(alias = "extracted_text")]
    pub extracted_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSpec {
    pub id: String,
    pub version: i32,
    pub name: String,
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "template_id")]
    pub template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "opportunity_subtype")]
    pub opportunity_subtype: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "content_mode")]
    pub content_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "context_attachments")]
    pub context_attachments: Option<Vec<PromptAttachment>>,
    pub search: SearchConfig,
    pub filters: FilterConfig,
    pub output: OutputConfig,
    pub schedule: ScheduleConfig,
    #[serde(default = "default_effort")]
    pub effort: EffortLevel,
    #[serde(default = "default_retention", alias = "retention_days")]
    pub retention_days: i32,
    pub status: AgentStatus,
}

fn default_retention() -> i32 {
    90
}

fn default_effort() -> EffortLevel {
    EffortLevel::Medium
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchConfig {
    #[serde(default)]
    pub queries: Vec<String>,
    #[serde(default)]
    pub sources: Vec<SearchSource>,
    #[serde(default, alias = "requires_login")]
    pub requires_login: Vec<LoginRequirement>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_sources: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "maxResultsPerQuery")]
    pub max_results_per_query: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SearchSource {
    Duckduckgo,
    Url { url: String },
    Rss { url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequirement {
    #[serde(alias = "site_id")]
    pub site_id: String,
    #[serde(alias = "credential_ref")]
    pub credential_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterConfig {
    #[serde(default)]
    pub criteria: String,
    #[serde(default = "default_min_score", alias = "min_score")]
    pub min_score: f64,
    #[serde(default)]
    pub dedupe: DedupeConfig,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "max_age_days")]
    pub max_age_days: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "min_days_remaining")]
    pub min_days_remaining: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "require_verification")]
    pub require_verification: Option<bool>,
}

fn default_min_score() -> f64 {
    70.0
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DedupeConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputConfig {
    #[serde(default)]
    pub schema: Vec<String>,
    #[serde(default)]
    pub destinations: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "excel_path")]
    pub excel_path: Option<String>,
    #[serde(default, alias = "excel_mode")]
    pub excel_mode: ExcelMode,
    #[serde(default)]
    pub notify: bool,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "email_to")]
    pub email_to: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ExcelMode {
    #[default]
    NewFile,
    UpdateSame,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleConfig {
    #[serde(default = "default_interval", alias = "interval_minutes")]
    pub interval_minutes: i32,
    #[serde(default = "default_true", alias = "only_when_running")]
    pub only_when_running: bool,
    /// When true, AIIA Cloud runs the agent on a schedule (Gemini only); desktop syncs later.
    #[serde(default, alias = "cloud_enabled")]
    pub cloud_enabled: bool,
    #[serde(default = "default_timezone")]
    pub timezone: String,
}

fn default_interval() -> i32 {
    1440
}

fn default_true() -> bool {
    true
}

fn default_timezone() -> String {
    "Europe/Madrid".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRecord {
    pub id: String,
    pub spec: AgentSpec,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_run_at: Option<DateTime<Utc>>,
    pub next_run_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultRecord {
    pub id: String,
    pub agent_id: String,
    pub run_id: String,
    pub data: serde_json::Value,
    pub score: Option<f64>,
    pub is_new: bool,
    pub feedback: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunLog {
    pub id: String,
    pub agent_id: String,
    pub effort: EffortLevel,
    pub phase: String,
    pub status: String,
    pub summary: String,
    pub results_count: i32,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialRecord {
    pub id: String,
    pub site_id: String,
    pub label: String,
    #[serde(skip)]
    pub encrypted_data: Vec<u8>,
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub login_url: Option<String>,
    #[serde(default)]
    pub has_session: bool,
}

pub const MAX_PUBLISHED_AGENTS: usize = 5;

/// Soft limit for in-thread chat context before older turns become artifacts.
pub const CHAT_CONTEXT_CHAR_LIMIT: usize = 100_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRecord {
    pub id: String,
    pub title: String,
    pub archived: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRecord {
    pub id: String,
    pub chat_id: String,
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
    /// Absolute paths to attached/generated images for this message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatArtifactRecord {
    pub id: String,
    pub chat_id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: i64,
    pub created_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_SPEC: &str = r#"{
        "id": "test-id",
        "version": 1,
        "name": "QA Lead Jobs",
        "prompt": "Buscar ofertas QA lead",
        "templateId": "job-search",
        "search": {
            "queries": ["QA lead remote"],
            "sources": [{"type": "duckduckgo"}],
            "requiresLogin": []
        },
        "filters": {
            "criteria": "Senior QA lead",
            "minScore": 70,
            "dedupe": { "enabled": true, "fields": ["title", "url"] }
        },
        "output": {
            "schema": ["title", "company", "url"],
            "destinations": ["inbox", "excel"],
            "excelPath": "%USERPROFILE%/AIIA/exports/qa.xlsx",
            "excelMode": "update_same",
            "notify": true
        },
        "schedule": {
            "intervalMinutes": 1440,
            "onlyWhenRunning": true,
            "timezone": "Europe/Madrid"
        },
        "effort": "low",
        "retentionDays": 90,
        "status": "pending_review"
    }"#;

    #[test]
    fn deserializes_frontend_camel_case_spec() {
        let spec: AgentSpec = serde_json::from_str(SAMPLE_SPEC).expect("spec should parse");
        assert_eq!(spec.filters.min_score, 70.0);
        assert_eq!(spec.schedule.interval_minutes, 1440);
        assert_eq!(spec.status, AgentStatus::PendingReview);
        assert_eq!(spec.template_id.as_deref(), Some("job-search"));
    }

    #[test]
    fn roundtrip_spec_json() {
        let spec: AgentSpec = serde_json::from_str(SAMPLE_SPEC).unwrap();
        let json = serde_json::to_string(&spec).unwrap();
        let again: AgentSpec = serde_json::from_str(&json).unwrap();
        assert_eq!(spec.filters.min_score, again.filters.min_score);
        assert_eq!(spec.name, again.name);
    }

    #[test]
    fn deserializes_legacy_snake_case_spec() {
        let json = r#"{
            "id": "legacy",
            "version": 1,
            "name": "Legacy",
            "prompt": "test",
            "search": { "queries": ["q"], "sources": [{"type": "duckduckgo"}] },
            "filters": { "criteria": "c", "min_score": 80 },
            "output": { "schema": ["title"], "destinations": ["inbox"] },
            "schedule": { "interval_minutes": 60, "only_when_running": true },
            "effort": "medium",
            "retention_days": 30,
            "status": "draft"
        }"#;
        let spec: AgentSpec = serde_json::from_str(json).unwrap();
        assert_eq!(spec.filters.min_score, 80.0);
        assert_eq!(spec.schedule.interval_minutes, 60);
    }
}
