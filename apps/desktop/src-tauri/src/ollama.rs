use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
const OLLAMA_DOWNLOAD_PAGE: &str = "https://ollama.com/download";
const OLLAMA_API: &str = "http://127.0.0.1:11434";

pub const OLLAMA_NOT_INSTALLED: &str = "Ollama no está instalado. Descárgalo desde https://ollama.com/download, instálalo y vuelve a intentarlo desde Ajustes.";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OllamaSetupProgress {
    pub phase: String,
    pub percent: u32,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaStatus {
    pub installed: bool,
    pub running: bool,
    pub models: Vec<String>,
    pub recommended_model: String,
}

fn emit_progress(app: &AppHandle, phase: &str, percent: u32, message: &str) {
    let _ = app.emit(
        "ollama-setup-progress",
        OllamaSetupProgress {
            phase: phase.to_string(),
            percent,
            message: message.to_string(),
        },
    );
}

pub fn ollama_exe_path() -> Option<PathBuf> {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let exe = PathBuf::from(&local)
            .join("Programs")
            .join("Ollama")
            .join("ollama.exe");
        if exe.exists() {
            return Some(exe);
        }
    }

    #[cfg(windows)]
    {
        let output = Command::new("where").arg("ollama").output().ok()?;
        if output.status.success() {
            let line = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()?
                .trim()
                .to_string();
            if !line.is_empty() {
                return Some(PathBuf::from(line));
            }
        }
    }

    None
}

pub fn ollama_app_path() -> Option<PathBuf> {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let app = PathBuf::from(&local)
            .join("Programs")
            .join("Ollama")
            .join("Ollama.exe");
        if app.exists() {
            return Some(app);
        }
    }
    None
}

pub fn recommended_model(total_ram_gb: u64) -> String {
    if total_ram_gb >= 32 {
        "qwen2.5:14b".to_string()
    } else if total_ram_gb >= 16 {
        "qwen2.5:7b".to_string()
    } else if total_ram_gb >= 8 {
        "qwen2.5:3b".to_string()
    } else {
        "llama3.2:1b".to_string()
    }
}

fn map_io_error(err: &std::io::Error) -> String {
    let raw = err.to_string();
    if err.raw_os_error() == Some(5)
        || raw.contains("Acceso denegado")
        || raw.contains("Access is denied")
        || raw.contains("0x80070005")
    {
        return "Windows Defender o permisos bloquearon la operación. Instala Ollama manualmente desde https://ollama.com/download.".to_string();
    }
    raw
}

pub fn planner_model_for_hw(total_ram_gb: u64, avail_ram_gb: u64, profile: &str) -> String {
    let by_profile = planner_model_for_profile(profile);
    let by_total = recommended_model(total_ram_gb);
    let mut model = if model_size_rank(&by_total) < model_size_rank(&by_profile) {
        by_total
    } else {
        by_profile
    };
    if avail_ram_gb < 6 {
        model = "qwen2.5:3b".to_string();
    } else if avail_ram_gb < 10 && model_size_rank(&model) > model_size_rank("qwen2.5:7b") {
        model = "qwen2.5:7b".to_string();
    }
    model
}

pub fn planner_model_for_profile(profile: &str) -> String {
    match profile {
        "super" => "qwen2.5:14b".to_string(),
        "low" => "qwen2.5:3b".to_string(),
        "high" | "medium" => "qwen2.5:7b".to_string(),
        _ => "qwen2.5:7b".to_string(),
    }
}

fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            while let Some(&next) = chars.peek() {
                chars.next();
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
        } else if c == '\r' {
            continue;
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}

fn format_pull_progress(
    model: &str,
    status: &str,
    completed: Option<u64>,
    total: Option<u64>,
) -> (u32, String) {
    let pct = match (completed, total) {
        (Some(c), Some(t)) if t > 0 => ((c * 100) / t) as u32,
        _ => 0,
    };
    let message = match (completed, total) {
        (Some(c), Some(t)) if t > 0 => {
            let gb = |n: u64| n as f64 / 1_000_000_000.0;
            format!(
                "Descargando {model}… {pct}% ({:.1}/{:.1} GB)",
                gb(c),
                gb(t)
            )
        }
        _ => {
            let clean = strip_ansi(status);
            if clean.is_empty() {
                format!("Descargando {model}…")
            } else if clean.len() > 120 {
                format!("Descargando {model}… {}", &clean[..120])
            } else {
                format!("Descargando {model}… {clean}")
            }
        }
    };
    (pct, message)
}

fn map_ollama_fetch_error(err: &reqwest::Error) -> String {
    if err.is_connect() || err.is_timeout() {
        "No se pudo conectar con Ollama. Ve a Ajustes, inicia Ollama o instálalo desde la app.".to_string()
    } else {
        format!("Error de comunicación con Ollama: {err}")
    }
}

pub async fn ollama_is_running() -> bool {
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get(format!("{OLLAMA_API}/api/tags"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

async fn list_models() -> Vec<String> {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
    {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let Ok(res) = client.get(format!("{OLLAMA_API}/api/tags")).send().await else {
        return vec![];
    };
    if !res.status().is_success() {
        return vec![];
    }
    let Ok(body) = res.json::<serde_json::Value>().await else {
        return vec![];
    };
    body.get("models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

pub async fn get_status(total_ram_gb: u64) -> OllamaStatus {
    let installed = ollama_exe_path().is_some();
    let running = ollama_is_running().await;
    let models = if running { list_models().await } else { vec![] };
    OllamaStatus {
        installed,
        running,
        models,
        recommended_model: recommended_model(total_ram_gb),
    }
}

fn start_ollama() -> Result<(), String> {
    if let Some(app) = ollama_app_path() {
        Command::new(&app)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| map_io_error(&e))?;
        return Ok(());
    }
    if let Some(exe) = ollama_exe_path() {
        Command::new(&exe)
            .arg("serve")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| map_io_error(&e))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        if Command::new("ollama")
            .arg("serve")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }
    Err("Ollama no está instalado".to_string())
}

async fn wait_for_ollama(app: &AppHandle, timeout: Duration) -> Result<(), String> {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if ollama_is_running().await {
            emit_progress(app, "starting", 100, "Ollama activo");
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
        let elapsed = start.elapsed().as_secs();
        let pct = ((elapsed as f64 / timeout.as_secs() as f64) * 100.0).min(95.0) as u32;
        emit_progress(
            app,
            "starting",
            pct,
            "Esperando a que Ollama arranque…",
        );
    }
    Err("Ollama no respondió a tiempo. Reinicia la app o inicia Ollama manualmente.".to_string())
}

async fn ensure_ollama_running(app: &AppHandle) -> Result<(), String> {
    if ollama_is_running().await {
        return Ok(());
    }
    if ollama_exe_path().is_none() {
        return Err(OLLAMA_NOT_INSTALLED.to_string());
    }
    start_ollama()?;
    wait_for_ollama(app, Duration::from_secs(90)).await
}

async fn prepare_model_if_needed(
    app: &AppHandle,
    model: &str,
    pull_if_missing: bool,
) -> Result<Vec<String>, String> {
    ensure_ollama_running(app).await?;
    let mut models = list_models().await;
    if pull_if_missing && !model_is_available(&models, model) {
        pull_model(app, model).await?;
        models = list_models().await;
    }
    Ok(models)
}

pub async fn setup_ollama(
    app: AppHandle,
    _data_dir: PathBuf,
    total_ram_gb: u64,
    avail_ram_gb: u64,
    pull_model_if_missing: bool,
) -> Result<OllamaStatus, String> {
    let model = recommended_model(total_ram_gb);
    prepare_ollama(app, total_ram_gb, avail_ram_gb, &model, pull_model_if_missing).await
}

pub async fn prepare_ollama(
    app: AppHandle,
    total_ram_gb: u64,
    avail_ram_gb: u64,
    model: &str,
    pull_if_missing: bool,
) -> Result<OllamaStatus, String> {
    if ollama_exe_path().is_none() {
        return Err(OLLAMA_NOT_INSTALLED.to_string());
    }
    emit_progress(&app, "starting", 0, "Comprobando Ollama…");
    let models = prepare_model_if_needed(&app, model, pull_if_missing).await?;
    emit_progress(&app, "done", 100, "Ollama listo");
    Ok(OllamaStatus {
        installed: true,
        running: true,
        models,
        recommended_model: planner_model_for_hw(total_ram_gb, avail_ram_gb, "medium"),
    })
}

pub async fn setup_ollama_with_model(
    app: AppHandle,
    _data_dir: PathBuf,
    total_ram_gb: u64,
    avail_ram_gb: u64,
    model: &str,
    pull_model_if_missing: bool,
) -> Result<OllamaStatus, String> {
    prepare_ollama(app, total_ram_gb, avail_ram_gb, model, pull_model_if_missing).await
}

pub async fn ensure_ollama_for_planner(
    app: AppHandle,
    _data_dir: PathBuf,
    total_ram_gb: u64,
    avail_ram_gb: u64,
    profile: &str,
) -> Result<OllamaStatus, String> {
    if ollama_exe_path().is_none() {
        return Err(OLLAMA_NOT_INSTALLED.to_string());
    }
    let model = planner_model_for_hw(total_ram_gb, avail_ram_gb, profile);
    emit_progress(&app, "starting", 0, "Preparando IA local…");
    let models = prepare_model_if_needed(&app, &model, true).await?;
    emit_progress(&app, "done", 100, "Listo para generar agente");
    Ok(OllamaStatus {
        installed: true,
        running: true,
        models,
        recommended_model: model,
    })
}

async fn pull_model(app: &AppHandle, model: &str) -> Result<(), String> {
    emit_progress(
        app,
        "pulling",
        0,
        &format!("Descargando {model}…"),
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(format!("{OLLAMA_API}/api/pull"))
        .json(&serde_json::json!({ "name": model, "stream": true }))
        .send()
        .await
        .map_err(|e| map_ollama_fetch_error(&e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        return Err(if text.is_empty() {
            format!("No se pudo descargar el modelo (HTTP {status})")
        } else {
            format!("No se pudo descargar el modelo: {text}")
        });
    }

    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buffer = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| map_ollama_fetch_error(&e))?;
        buffer.extend_from_slice(&chunk);
        while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buffer.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
                let status = parsed
                    .get("status")
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                let completed = parsed.get("completed").and_then(|c| c.as_u64());
                let total = parsed.get("total").and_then(|t| t.as_u64());
                let (pct, message) = format_pull_progress(model, status, completed, total);
                emit_progress(app, "pulling", pct, &message);
            }
        }
    }

    emit_progress(app, "pulling", 100, &format!("Modelo {model} listo"));
    Ok(())
}

fn model_is_available(models: &[String], model: &str) -> bool {
    models.iter().any(|m| {
        m == model
            || m == &format!("{model}:latest")
            || m.strip_suffix(":latest") == Some(model)
    })
}

fn model_size_rank(model: &str) -> u8 {
    if model.contains("14b") {
        3
    } else if model.contains("7b") {
        2
    } else if model.contains("3b") {
        1
    } else {
        0
    }
}

pub fn ollama_download_page() -> &'static str {
    OLLAMA_DOWNLOAD_PAGE
}

pub async fn ollama_chat(
    model: String,
    messages: Vec<serde_json::Value>,
    temperature: Option<f64>,
    num_ctx: Option<u32>,
    format: Option<String>,
) -> Result<String, String> {
    if !ollama_is_running().await {
        return Err(
            "Ollama no está activo. Ve a Ajustes e inicia Ollama antes de continuar.".to_string(),
        );
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false,
        "format": format,
        "options": {
            "temperature": temperature.unwrap_or(0.5),
            "num_ctx": num_ctx.unwrap_or(4096),
        }
    });

    let res = client
        .post(format!("{OLLAMA_API}/api/chat"))
        .json(&body)
        .send()
        .await
        .map_err(|e| map_ollama_fetch_error(&e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(if text.is_empty() {
            format!("Ollama rechazó la petición (HTTP {})", status.as_u16())
        } else {
            format!("Ollama rechazó la petición: {text}")
        });
    }

    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    data.get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Ollama devolvió una respuesta vacía".to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamEvent {
    pub stream_id: String,
    pub delta: String,
    pub done: bool,
    #[serde(default)]
    pub cancelled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub(crate) fn is_stream_cancelled(
    cancel_set: &std::sync::Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
    stream_id: &str,
) -> bool {
    cancel_set
        .lock()
        .map(|set| set.contains(stream_id))
        .unwrap_or(false)
}

pub async fn ollama_chat_stream(
    app: AppHandle,
    stream_id: String,
    model: String,
    messages: Vec<serde_json::Value>,
    temperature: Option<f64>,
    num_ctx: Option<u32>,
    cancel_set: std::sync::Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
) -> Result<(), String> {
    if !ollama_is_running().await {
        let _ = app.emit(
            "chat-stream",
            ChatStreamEvent {
                stream_id: stream_id.clone(),
                delta: String::new(),
                done: true,
                cancelled: false,
                error: Some(
                    "Ollama no está activo. Ve a Ajustes e inicia Ollama antes de continuar."
                        .to_string(),
                ),
            },
        );
        return Err(
            "Ollama no está activo. Ve a Ajustes e inicia Ollama antes de continuar.".to_string(),
        );
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
        "options": {
            "temperature": temperature.unwrap_or(0.7),
            "num_ctx": num_ctx.unwrap_or(8192),
        }
    });

    let res = client
        .post(format!("{OLLAMA_API}/api/chat"))
        .json(&body)
        .send()
        .await
        .map_err(|e| map_ollama_fetch_error(&e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        let err = if text.is_empty() {
            format!("Ollama rechazó la petición (HTTP {})", status.as_u16())
        } else {
            format!("Ollama rechazó la petición: {text}")
        };
        let _ = app.emit(
            "chat-stream",
            ChatStreamEvent {
                stream_id: stream_id.clone(),
                delta: String::new(),
                done: true,
                cancelled: false,
                error: Some(err.clone()),
            },
        );
        return Err(err);
    }

    use futures_util::StreamExt;
    let mut stream = res.bytes_stream();
    let mut buffer = Vec::new();

    while let Some(chunk) = stream.next().await {
        if is_stream_cancelled(&cancel_set, &stream_id) {
            let _ = cancel_set.lock().map(|mut set| set.remove(&stream_id));
            let _ = app.emit(
                "chat-stream",
                ChatStreamEvent {
                    stream_id: stream_id.clone(),
                    delta: String::new(),
                    done: true,
                    cancelled: true,
                    error: None,
                },
            );
            return Ok(());
        }

        let chunk = chunk.map_err(|e| map_ollama_fetch_error(&e))?;
        buffer.extend_from_slice(&chunk);
        while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buffer.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(delta) = parsed
                    .pointer("/message/content")
                    .and_then(|c| c.as_str())
                {
                    if !delta.is_empty() {
                        let _ = app.emit(
                            "chat-stream",
                            ChatStreamEvent {
                                stream_id: stream_id.clone(),
                                delta: delta.to_string(),
                                done: false,
                                cancelled: false,
                                error: None,
                            },
                        );
                    }
                }
                if parsed.get("done").and_then(|d| d.as_bool()).unwrap_or(false) {
                    let _ = cancel_set.lock().map(|mut set| set.remove(&stream_id));
                    let _ = app.emit(
                        "chat-stream",
                        ChatStreamEvent {
                            stream_id: stream_id.clone(),
                            delta: String::new(),
                            done: true,
                            cancelled: false,
                            error: None,
                        },
                    );
                    return Ok(());
                }
            }
        }
    }

    let _ = cancel_set.lock().map(|mut set| set.remove(&stream_id));
    let _ = app.emit(
        "chat-stream",
        ChatStreamEvent {
            stream_id,
            delta: String::new(),
            done: true,
            cancelled: false,
            error: None,
        },
    );
    Ok(())
}
