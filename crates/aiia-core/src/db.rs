use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::error::{CoreError, Result};
use crate::models::{
    AgentRecord, AgentSpec, AgentStatus, ChatArtifactRecord, ChatMessageRecord, ChatRecord,
    CredentialRecord, ResultRecord, RunLog, CHAT_CONTEXT_CHAR_LIMIT, MAX_PUBLISHED_AGENTS,
};

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    pub fn default_path() -> Result<PathBuf> {
        let data_dir = dirs::data_dir()
            .ok_or_else(|| CoreError::Io(std::io::Error::other("No data dir")))?;
        Ok(data_dir.join("AIIA").join("aiia.db"))
    }

    pub fn open_default() -> Result<Self> {
        Self::open(&Self::default_path()?)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                spec_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_run_at TEXT,
                next_run_at TEXT,
                error_message TEXT
            );

            CREATE TABLE IF NOT EXISTS agent_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                spec_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
                UNIQUE(agent_id, version)
            );

            CREATE TABLE IF NOT EXISTS results (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                data_json TEXT NOT NULL,
                score REAL,
                is_new INTEGER NOT NULL DEFAULT 1,
                feedback TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS run_logs (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                effort TEXT NOT NULL,
                phase TEXT NOT NULL,
                status TEXT NOT NULL,
                summary TEXT NOT NULL,
                results_count INTEGER NOT NULL DEFAULT 0,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS credentials (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL,
                label TEXT NOT NULL,
                encrypted_data BLOB NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_results_agent ON results(agent_id);
            CREATE INDEX IF NOT EXISTS idx_run_logs_agent ON run_logs(agent_id);

            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                artifact_id TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS chat_artifacts (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_chat_artifacts_chat ON chat_artifacts(chat_id);
            "#,
        )?;
        let _ = conn.execute("ALTER TABLE credentials ADD COLUMN login_url TEXT", []);
        let _ = conn.execute(
            "ALTER TABLE credentials ADD COLUMN has_session INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute("ALTER TABLE chat_messages ADD COLUMN images_json TEXT", []);
        Ok(())
    }

    pub fn count_published(&self) -> Result<usize> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        Self::count_published_conn(&conn)
    }

    fn count_published_conn(conn: &Connection) -> Result<usize> {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM agents WHERE json_extract(spec_json, '$.status') = 'published'",
            [],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    fn parse_agent_row(id: &str, row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRecord> {
        let spec_json: String = row.get(0)?;
        let spec: AgentSpec = serde_json::from_str(&spec_json).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })?;
        Ok(AgentRecord {
            id: id.to_string(),
            spec,
            created_at: row.get::<_, String>(1)?.parse().unwrap_or_else(|_| Utc::now()),
            updated_at: row.get::<_, String>(2)?.parse().unwrap_or_else(|_| Utc::now()),
            last_run_at: row.get::<_, Option<String>>(3)?.and_then(|s| s.parse().ok()),
            next_run_at: row.get::<_, Option<String>>(4)?.and_then(|s| s.parse().ok()),
            error_message: row.get(5)?,
        })
    }

    pub fn save_agent(&self, spec: &AgentSpec) -> Result<AgentRecord> {
        let now = Utc::now();
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let spec_json = serde_json::to_string(spec)?;

        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM agents WHERE id = ?1",
                params![spec.id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if !exists && spec.status == AgentStatus::Published {
            if Self::count_published_conn(&conn)? >= MAX_PUBLISHED_AGENTS {
                return Err(CoreError::LimitExceeded(format!(
                    "Maximum {MAX_PUBLISHED_AGENTS} published agents allowed"
                )));
            }
        }

        if exists {
            let old_status: String = conn.query_row(
                "SELECT json_extract(spec_json, '$.status') FROM agents WHERE id = ?1",
                params![spec.id],
                |row| row.get(0),
            )?;
            if old_status != "published"
                && spec.status == AgentStatus::Published
                && Self::count_published_conn(&conn)? >= MAX_PUBLISHED_AGENTS
            {
                return Err(CoreError::LimitExceeded(format!(
                    "Maximum {MAX_PUBLISHED_AGENTS} published agents allowed"
                )));
            }
            conn.execute(
                "UPDATE agents SET spec_json = ?1, updated_at = ?2, error_message = NULL WHERE id = ?3",
                params![spec_json, now.to_rfc3339(), spec.id],
            )?;
        } else {
            conn.execute(
                "INSERT INTO agents (id, spec_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                params![spec.id, spec_json, now.to_rfc3339(), now.to_rfc3339()],
            )?;
        }

        conn.execute(
            "INSERT OR REPLACE INTO agent_versions (agent_id, version, spec_json, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![spec.id, spec.version, serde_json::to_string(spec)?, now.to_rfc3339()],
        )?;

        conn.query_row(
            "SELECT spec_json, created_at, updated_at, last_run_at, next_run_at, error_message FROM agents WHERE id = ?1",
            params![spec.id],
            |row| Self::parse_agent_row(&spec.id, row),
        )
        .map_err(Into::into)
    }

    pub fn get_agent(&self, id: &str) -> Result<AgentRecord> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.query_row(
            "SELECT spec_json, created_at, updated_at, last_run_at, next_run_at, error_message FROM agents WHERE id = ?1",
            params![id],
            |row| Self::parse_agent_row(id, row),
        )
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("Agent {id}")))
    }

    pub fn list_agents(&self) -> Result<Vec<AgentRecord>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let mut stmt = conn.prepare(
            "SELECT id, spec_json, created_at, updated_at, last_run_at, next_run_at, error_message FROM agents ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let spec_json: String = row.get(1)?;
            let spec: AgentSpec = serde_json::from_str(&spec_json).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(e))
            })?;
            Ok(AgentRecord {
                id,
                spec,
                created_at: row.get::<_, String>(2)?.parse().unwrap_or_else(|_| Utc::now()),
                updated_at: row.get::<_, String>(3)?.parse().unwrap_or_else(|_| Utc::now()),
                last_run_at: row.get::<_, Option<String>>(4)?.and_then(|s| s.parse().ok()),
                next_run_at: row.get::<_, Option<String>>(5)?.and_then(|s| s.parse().ok()),
                error_message: row.get(6)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn delete_agent(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute("DELETE FROM agents WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_agent_versions(&self, agent_id: &str) -> Result<Vec<(i32, String, String)>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let mut stmt = conn.prepare(
            "SELECT version, spec_json, created_at FROM agent_versions WHERE agent_id = ?1 ORDER BY version DESC",
        )?;
        let rows = stmt.query_map(params![agent_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn publish_agent(&self, id: &str) -> Result<AgentRecord> {
        let mut record = self.get_agent(id)?;
        if record.spec.status != AgentStatus::PendingReview {
            return Err(CoreError::InvalidState(
                "Agent must be in pending_review status".to_string(),
            ));
        }
        if self.count_published()? >= MAX_PUBLISHED_AGENTS {
            return Err(CoreError::LimitExceeded(format!(
                "Maximum {MAX_PUBLISHED_AGENTS} published agents allowed"
            )));
        }
        record.spec.status = AgentStatus::Published;
        self.save_agent(&record.spec)
    }

    pub fn set_agent_error(&self, id: &str, message: &str) -> Result<AgentRecord> {
        let mut record = self.get_agent(id)?;
        record.spec.status = AgentStatus::Error;
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute(
            "UPDATE agents SET spec_json = ?1, error_message = ?2, updated_at = ?3 WHERE id = ?4",
            params![
                serde_json::to_string(&record.spec)?,
                message,
                Utc::now().to_rfc3339(),
                id
            ],
        )?;
        drop(conn);
        self.get_agent(id)
    }

    pub fn save_results(&self, agent_id: &str, run_id: &str, results: &[serde_json::Value]) -> Result<i32> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute("DELETE FROM results WHERE run_id = ?1", params![run_id])?;
        let now = Utc::now().to_rfc3339();
        let mut count = 0;
        for data in results {
            let id = Uuid::new_v4().to_string();
            let score = data
                .get("score")
                .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|n| n as f64)));
            conn.execute(
                "INSERT INTO results (id, agent_id, run_id, data_json, score, is_new, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
                params![id, agent_id, run_id, data.to_string(), score, now],
            )?;
            count += 1;
        }
        conn.execute(
            "UPDATE agents SET last_run_at = ?1 WHERE id = ?2",
            params![now, agent_id],
        )?;
        Ok(count)
    }

    pub fn count_results_for_run(&self, run_id: &str) -> Result<i32> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let count: i32 = conn.query_row(
            "SELECT COUNT(1) FROM results WHERE run_id = ?1",
            params![run_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    pub fn list_results(&self, agent_id: Option<&str>, limit: i32) -> Result<Vec<ResultRecord>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let sql = if agent_id.is_some() {
            "SELECT id, agent_id, run_id, data_json, score, is_new, feedback, created_at FROM results WHERE agent_id = ?1 ORDER BY created_at DESC LIMIT ?2"
        } else {
            "SELECT id, agent_id, run_id, data_json, score, is_new, feedback, created_at FROM results ORDER BY created_at DESC LIMIT ?1"
        };
        let mut results = Vec::new();
        if let Some(aid) = agent_id {
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map(params![aid, limit], Self::map_result_row)?;
            for row in rows {
                results.push(row?);
            }
        } else {
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map(params![limit], Self::map_result_row)?;
            for row in rows {
                results.push(row?);
            }
        }
        Ok(results)
    }

    fn map_result_row(row: &rusqlite::Row) -> rusqlite::Result<ResultRecord> {
        let data_json: String = row.get(3)?;
        Ok(ResultRecord {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            run_id: row.get(2)?,
            data: serde_json::from_str(&data_json).unwrap_or(serde_json::Value::Null),
            score: row.get(4)?,
            is_new: row.get::<_, i32>(5)? != 0,
            feedback: row.get(6)?,
            created_at: row.get::<_, String>(7)?.parse().unwrap_or_else(|_| Utc::now()),
        })
    }

    pub fn set_result_feedback(&self, result_id: &str, feedback: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        // Keep review_status inside data_json in sync with feedback for curation queues.
        let review_status = match feedback {
            "useful" | "approved" => "approved",
            "not_useful" | "rejected" => "rejected",
            "archived" => "archived",
            _ => "pending",
        };
        let data_json: Option<String> = conn
            .query_row(
                "SELECT data_json FROM results WHERE id = ?1",
                params![result_id],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(raw) = data_json {
            if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(obj) = v.as_object_mut() {
                    obj.insert(
                        "review_status".into(),
                        serde_json::Value::String(review_status.into()),
                    );
                }
                let _ = conn.execute(
                    "UPDATE results SET feedback = ?1, data_json = ?2 WHERE id = ?3",
                    params![feedback, v.to_string(), result_id],
                )?;
                return Ok(());
            }
        }
        conn.execute(
            "UPDATE results SET feedback = ?1 WHERE id = ?2",
            params![feedback, result_id],
        )?;
        Ok(())
    }

    pub fn delete_result(&self, result_id: &str) -> Result<bool> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let deleted = conn.execute("DELETE FROM results WHERE id = ?1", params![result_id])?;
        Ok(deleted > 0)
    }

    pub fn clear_results(&self, agent_id: Option<&str>) -> Result<i32> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let deleted = if let Some(aid) = agent_id {
            conn.execute("DELETE FROM results WHERE agent_id = ?1", params![aid])?
        } else {
            conn.execute("DELETE FROM results", [])?
        };
        Ok(deleted as i32)
    }

    pub fn mark_results_seen(&self, agent_id: Option<&str>) -> Result<i32> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let updated = if let Some(aid) = agent_id {
            conn.execute(
                "UPDATE results SET is_new = 0 WHERE agent_id = ?1 AND is_new = 1",
                params![aid],
            )?
        } else {
            conn.execute("UPDATE results SET is_new = 0 WHERE is_new = 1", [])?
        };
        Ok(updated as i32)
    }

    pub fn save_run_log(&self, log: &RunLog) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute(
            "INSERT OR REPLACE INTO run_logs (id, agent_id, effort, phase, status, summary, results_count, started_at, finished_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                log.id,
                log.agent_id,
                serde_json::to_string(&log.effort)?.trim_matches('"'),
                log.phase,
                log.status,
                log.summary,
                log.results_count,
                log.started_at.to_rfc3339(),
                log.finished_at.map(|t| t.to_rfc3339()),
            ],
        )?;
        Ok(())
    }

    pub fn list_run_logs(&self, agent_id: &str, limit: i32) -> Result<Vec<RunLog>> {
        self.list_all_run_logs(Some(agent_id), limit)
    }

    pub fn list_all_run_logs(&self, agent_id: Option<&str>, limit: i32) -> Result<Vec<RunLog>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let sql = if agent_id.is_some() {
            "SELECT id, agent_id, effort, phase, status, summary, results_count, started_at, finished_at FROM run_logs WHERE agent_id = ?1 ORDER BY started_at DESC LIMIT ?2"
        } else {
            "SELECT id, agent_id, effort, phase, status, summary, results_count, started_at, finished_at FROM run_logs ORDER BY started_at DESC LIMIT ?1"
        };
        let mut results = Vec::new();
        if let Some(aid) = agent_id {
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map(params![aid, limit], Self::map_run_log_row)?;
            for row in rows {
                results.push(row?);
            }
        } else {
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map(params![limit], Self::map_run_log_row)?;
            for row in rows {
                results.push(row?);
            }
        }
        Ok(results)
    }

    pub fn get_run_log(&self, run_id: &str) -> Result<Option<RunLog>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let mut stmt = conn.prepare(
            "SELECT id, agent_id, effort, phase, status, summary, results_count, started_at, finished_at FROM run_logs WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![run_id], Self::map_run_log_row)?;
        Ok(rows.next().transpose()?)
    }

    /// Elimina una ejecución y sus resultados. Devuelve el `agent_id` si existía.
    pub fn delete_run(&self, run_id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let agent_id: Option<String> = conn
            .query_row(
                "SELECT agent_id FROM run_logs WHERE id = ?1",
                params![run_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(agent_id) = agent_id else {
            return Ok(None);
        };

        conn.execute("DELETE FROM results WHERE run_id = ?1", params![run_id])?;
        conn.execute("DELETE FROM run_logs WHERE id = ?1", params![run_id])?;

        let last_run: Option<String> = conn
            .query_row(
                "SELECT started_at FROM run_logs WHERE agent_id = ?1 ORDER BY started_at DESC LIMIT 1",
                params![agent_id],
                |row| row.get(0),
            )
            .optional()?;

        conn.execute(
            "UPDATE agents SET last_run_at = ?1 WHERE id = ?2",
            params![last_run, agent_id],
        )?;

        Ok(Some(agent_id))
    }

    fn map_run_log_row(row: &rusqlite::Row) -> rusqlite::Result<RunLog> {
        Ok(RunLog {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            effort: match row.get::<_, String>(2)?.as_str() {
                "low" => crate::models::EffortLevel::Low,
                "high" => crate::models::EffortLevel::High,
                "super_high" => crate::models::EffortLevel::SuperHigh,
                "ultra_high" => crate::models::EffortLevel::UltraHigh,
                _ => crate::models::EffortLevel::Medium,
            },
            phase: row.get(3)?,
            status: row.get(4)?,
            summary: row.get(5)?,
            results_count: row.get(6)?,
            started_at: row.get::<_, String>(7)?.parse().unwrap_or_else(|_| Utc::now()),
            finished_at: row.get::<_, Option<String>>(8)?.and_then(|s| s.parse().ok()),
        })
    }

    pub fn save_credential(&self, site_id: &str, label: &str, encrypted: &[u8]) -> Result<CredentialRecord> {
        self.upsert_credential(site_id, label, encrypted, None, false)
    }

    pub fn upsert_credential(
        &self,
        site_id: &str,
        label: &str,
        encrypted: &[u8],
        login_url: Option<&str>,
        has_session: bool,
    ) -> Result<CredentialRecord> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM credentials WHERE site_id = ?1",
                params![site_id],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(id) = existing {
            conn.execute(
                "UPDATE credentials SET label = ?1, encrypted_data = ?2, login_url = ?3, has_session = ?4 WHERE site_id = ?5",
                params![label, encrypted, login_url, has_session as i32, site_id],
            )?;
            let created_at: String = conn.query_row(
                "SELECT created_at FROM credentials WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )?;
            return Ok(CredentialRecord {
                id,
                site_id: site_id.to_string(),
                label: label.to_string(),
                encrypted_data: encrypted.to_vec(),
                created_at: created_at.parse().unwrap_or_else(|_| Utc::now()),
                login_url: login_url.map(str::to_string),
                has_session,
            });
        }

        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        conn.execute(
            "INSERT INTO credentials (id, site_id, label, encrypted_data, created_at, login_url, has_session) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                site_id,
                label,
                encrypted,
                now.to_rfc3339(),
                login_url,
                has_session as i32
            ],
        )?;
        Ok(CredentialRecord {
            id,
            site_id: site_id.to_string(),
            label: label.to_string(),
            encrypted_data: encrypted.to_vec(),
            created_at: now,
            login_url: login_url.map(str::to_string),
            has_session,
        })
    }

    pub fn delete_credential(&self, id: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let site_id: Option<String> = conn
            .query_row(
                "SELECT site_id FROM credentials WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        if site_id.is_some() {
            conn.execute("DELETE FROM credentials WHERE id = ?1", params![id])?;
        }
        Ok(site_id)
    }

    pub fn get_credential_by_site_id(&self, site_id: &str) -> Result<Option<CredentialRecord>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.query_row(
            "SELECT id, site_id, label, encrypted_data, created_at, login_url, has_session FROM credentials WHERE site_id = ?1",
            params![site_id],
            |row| {
                Ok(CredentialRecord {
                    id: row.get(0)?,
                    site_id: row.get(1)?,
                    label: row.get(2)?,
                    encrypted_data: row.get(3)?,
                    created_at: row.get::<_, String>(4)?.parse().unwrap_or_else(|_| Utc::now()),
                    login_url: row.get(5)?,
                    has_session: row.get::<_, i32>(6)? != 0,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn delete_credential_by_site_id(&self, site_id: &str) -> Result<bool> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let n = conn.execute(
            "DELETE FROM credentials WHERE site_id = ?1",
            params![site_id],
        )?;
        Ok(n > 0)
    }

    pub fn list_credentials(&self) -> Result<Vec<CredentialRecord>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let mut stmt = conn.prepare(
            "SELECT id, site_id, label, encrypted_data, created_at, login_url, has_session FROM credentials ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(CredentialRecord {
                id: row.get(0)?,
                site_id: row.get(1)?,
                label: row.get(2)?,
                encrypted_data: row.get(3)?,
                created_at: row.get::<_, String>(4)?.parse().unwrap_or_else(|_| Utc::now()),
                login_url: row.get(5)?,
                has_session: row.get::<_, i32>(6)? != 0,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn cleanup_retention(&self, agent_id: &str, retention_days: i32) -> Result<i32> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let deleted = conn.execute(
            "DELETE FROM results WHERE agent_id = ?1 AND created_at < datetime('now', ?2)",
            params![agent_id, format!("-{retention_days} days")],
        )?;
        Ok(deleted as i32)
    }

    pub fn get_due_agents(&self) -> Result<Vec<AgentRecord>> {
        let agents = self.list_agents()?;
        let now = Utc::now();
        Ok(agents
            .into_iter()
            .filter(|a| {
                a.spec.status == AgentStatus::Published
                    && a.next_run_at.map(|t| t <= now).unwrap_or(true)
            })
            .collect())
    }

    /// Agents due for the *local* desktop scheduler (app is open).
    /// Skips cloud-enabled agents — those run on AIIA Cloud.
    pub fn get_due_local_agents(&self) -> Result<Vec<AgentRecord>> {
        Ok(self
            .get_due_agents()?
            .into_iter()
            .filter(|a| !a.spec.schedule.cloud_enabled)
            .collect())
    }

    pub fn update_next_run(&self, agent_id: &str, minutes: i32) -> Result<()> {
        let next = Utc::now() + chrono::Duration::minutes(minutes as i64);
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute(
            "UPDATE agents SET next_run_at = ?1 WHERE id = ?2",
            params![next.to_rfc3339(), agent_id],
        )?;
        Ok(())
    }

    pub fn create_chat(&self, title: &str) -> Result<ChatRecord> {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute(
            "INSERT INTO chats (id, title, archived, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?4)",
            params![id, title, now.to_rfc3339(), now.to_rfc3339()],
        )?;
        Ok(ChatRecord {
            id,
            title: title.to_string(),
            archived: false,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list_chats(&self, archived_only: bool) -> Result<Vec<ChatRecord>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        // false = active only; true = archived only
        let sql = if archived_only {
            "SELECT id, title, archived, created_at, updated_at FROM chats WHERE archived = 1 ORDER BY updated_at DESC"
        } else {
            "SELECT id, title, archived, created_at, updated_at FROM chats WHERE archived = 0 ORDER BY updated_at DESC"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map([], |row| {
            Ok(ChatRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                archived: row.get::<_, i32>(2)? != 0,
                created_at: row.get::<_, String>(3)?.parse().unwrap_or_else(|_| Utc::now()),
                updated_at: row.get::<_, String>(4)?.parse().unwrap_or_else(|_| Utc::now()),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn get_chat(&self, id: &str) -> Result<ChatRecord> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.query_row(
            "SELECT id, title, archived, created_at, updated_at FROM chats WHERE id = ?1",
            params![id],
            |row| {
                Ok(ChatRecord {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    archived: row.get::<_, i32>(2)? != 0,
                    created_at: row.get::<_, String>(3)?.parse().unwrap_or_else(|_| Utc::now()),
                    updated_at: row.get::<_, String>(4)?.parse().unwrap_or_else(|_| Utc::now()),
                })
            },
        )
        .map_err(Into::into)
    }

    pub fn rename_chat(&self, id: &str, title: &str) -> Result<ChatRecord> {
        let now = Utc::now();
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute(
            "UPDATE chats SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now.to_rfc3339(), id],
        )?;
        drop(conn);
        self.get_chat(id)
    }

    pub fn set_chat_archived(&self, id: &str, archived: bool) -> Result<ChatRecord> {
        let now = Utc::now();
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute(
            "UPDATE chats SET archived = ?1, updated_at = ?2 WHERE id = ?3",
            params![if archived { 1 } else { 0 }, now.to_rfc3339(), id],
        )?;
        drop(conn);
        self.get_chat(id)
    }

    pub fn delete_chat(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute("DELETE FROM chat_messages WHERE chat_id = ?1", params![id])?;
        conn.execute("DELETE FROM chat_artifacts WHERE chat_id = ?1", params![id])?;
        conn.execute("DELETE FROM chats WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn list_chat_messages(&self, chat_id: &str) -> Result<Vec<ChatMessageRecord>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let mut stmt = conn.prepare(
            "SELECT id, chat_id, role, content, artifact_id, images_json, created_at FROM chat_messages WHERE chat_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![chat_id], |row| {
            let images_json: Option<String> = row.get(5)?;
            let images = images_json.and_then(|j| serde_json::from_str(&j).ok());
            Ok(ChatMessageRecord {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                artifact_id: row.get(4)?,
                images,
                created_at: row.get::<_, String>(6)?.parse().unwrap_or_else(|_| Utc::now()),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub fn add_chat_message(
        &self,
        chat_id: &str,
        role: &str,
        content: &str,
        artifact_id: Option<&str>,
        images: Option<&[String]>,
    ) -> Result<ChatMessageRecord> {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let images_json = images
            .filter(|v| !v.is_empty())
            .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()));
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute(
            "INSERT INTO chat_messages (id, chat_id, role, content, artifact_id, images_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, chat_id, role, content, artifact_id, images_json, now.to_rfc3339()],
        )?;
        conn.execute(
            "UPDATE chats SET updated_at = ?1 WHERE id = ?2",
            params![now.to_rfc3339(), chat_id],
        )?;
        Ok(ChatMessageRecord {
            id,
            chat_id: chat_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            artifact_id: artifact_id.map(|s| s.to_string()),
            images: images.map(|v| v.to_vec()),
            created_at: now,
        })
    }

    pub fn add_chat_artifact(
        &self,
        chat_id: &str,
        name: &str,
        path: &str,
        size_bytes: i64,
    ) -> Result<ChatArtifactRecord> {
        let now = Utc::now();
        let id = Uuid::new_v4().to_string();
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        conn.execute(
            "INSERT INTO chat_artifacts (id, chat_id, name, path, size_bytes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, chat_id, name, path, size_bytes, now.to_rfc3339()],
        )?;
        Ok(ChatArtifactRecord {
            id,
            chat_id: chat_id.to_string(),
            name: name.to_string(),
            path: path.to_string(),
            size_bytes,
            created_at: now,
        })
    }

    pub fn list_chat_artifacts(&self, chat_id: &str) -> Result<Vec<ChatArtifactRecord>> {
        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        let mut stmt = conn.prepare(
            "SELECT id, chat_id, name, path, size_bytes, created_at FROM chat_artifacts WHERE chat_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![chat_id], |row| {
            Ok(ChatArtifactRecord {
                id: row.get(0)?,
                chat_id: row.get(1)?,
                name: row.get(2)?,
                path: row.get(3)?,
                size_bytes: row.get(4)?,
                created_at: row.get::<_, String>(5)?.parse().unwrap_or_else(|_| Utc::now()),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    /// If thread exceeds char limit, fold oldest user/assistant pairs into a local artifact.
    pub fn compact_chat_context_if_needed(
        &self,
        chat_id: &str,
        artifacts_dir: &Path,
    ) -> Result<Option<ChatArtifactRecord>> {
        let messages = self.list_chat_messages(chat_id)?;
        let total: usize = messages.iter().map(|m| m.content.len()).sum();
        if total <= CHAT_CONTEXT_CHAR_LIMIT || messages.len() < 6 {
            return Ok(None);
        }

        let keep_from = messages.len().saturating_sub(4);
        let to_archive: Vec<&ChatMessageRecord> = messages.iter().take(keep_from).collect();
        if to_archive.is_empty() {
            return Ok(None);
        }

        let mut body = String::from("# Archived conversation context\n\n");
        for m in &to_archive {
            body.push_str(&format!("## {}\n\n{}\n\n", m.role, m.content));
        }

        std::fs::create_dir_all(artifacts_dir)?;
        let artifact_id = Uuid::new_v4().to_string();
        let name = format!("context-{}.md", &artifact_id[..8]);
        let path = artifacts_dir.join(&name);
        std::fs::write(&path, &body)?;
        let size_bytes = body.len() as i64;

        let artifact = self.add_chat_artifact(
            chat_id,
            &name,
            path.to_string_lossy().as_ref(),
            size_bytes,
        )?;

        let conn = self.conn.lock().map_err(|_| CoreError::Db(rusqlite::Error::InvalidQuery))?;
        for m in &to_archive {
            conn.execute("DELETE FROM chat_messages WHERE id = ?1", params![m.id])?;
        }
        drop(conn);

        let summary = format!(
            "[Previous conversation archived to file: {} ({} bytes). Ask to open it if you need older details.]",
            name, size_bytes
        );
        self.add_chat_message(chat_id, "system", &summary, Some(&artifact.id), None)?;
        Ok(Some(artifact))
    }
}

#[cfg(test)]
mod chat_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn chat_crud_archive_delete() {
        let dir = tempdir().unwrap();
        let db = Database::open(&dir.path().join("t.db")).unwrap();
        let chat = db.create_chat("Hello").unwrap();
        assert_eq!(chat.title, "Hello");
        assert!(!chat.archived);

        db.add_chat_message(&chat.id, "user", "hola", None, None).unwrap();
        db.add_chat_message(&chat.id, "assistant", "¡hola!", None, None)
            .unwrap();
        let msgs = db.list_chat_messages(&chat.id).unwrap();
        assert_eq!(msgs.len(), 2);

        db.set_chat_archived(&chat.id, true).unwrap();
        assert!(db.list_chats(false).unwrap().is_empty());
        assert_eq!(db.list_chats(true).unwrap().len(), 1);

        db.delete_chat(&chat.id).unwrap();
        assert!(db.list_chats(true).unwrap().is_empty());
    }

    #[test]
    fn chat_compacts_long_context() {
        let dir = tempdir().unwrap();
        let db = Database::open(&dir.path().join("t.db")).unwrap();
        let chat = db.create_chat("Long").unwrap();
        let big = "x".repeat(25_000);
        for i in 0..6 {
            db.add_chat_message(&chat.id, "user", &format!("{i}-{big}"), None, None)
                .unwrap();
            db.add_chat_message(&chat.id, "assistant", &format!("a{i}-{big}"), None, None)
                .unwrap();
        }
        let artifacts_dir = dir.path().join("arts");
        let art = db
            .compact_chat_context_if_needed(&chat.id, &artifacts_dir)
            .unwrap();
        assert!(art.is_some());
        let left = db.list_chat_messages(&chat.id).unwrap();
        assert!(left.len() < 12);
        assert!(left.iter().any(|m| m.role == "system"));
    }
}
