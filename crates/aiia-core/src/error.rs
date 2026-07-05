use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Crypto error: {0}")]
    Crypto(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Limit exceeded: {0}")]
    LimitExceeded(String),
    #[error("Invalid state: {0}")]
    InvalidState(String),
    #[error("Scheduler error: {0}")]
    Scheduler(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;
