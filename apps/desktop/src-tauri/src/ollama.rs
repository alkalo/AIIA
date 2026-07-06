use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

const OLLAMA_SETUP_URL: &str = "https://ollama.com/download/OllamaSetup.exe";
const OLLAMA_API: &str = "http://127.0.0.1:11434";

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
            .map_err(|e| format!("No se pudo iniciar Ollama: {e}"))?;
        return Ok(());
    }
    if let Some(exe) = ollama_exe_path() {
        Command::new(&exe)
            .arg("serve")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("No se pudo iniciar ollama serve: {e}"))?;
        return Ok(());
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

async fn download_installer(dest: &Path, app: &AppHandle) -> Result<(), String> {
    emit_progress(app, "downloading", 0, "Descargando Ollama…");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(OLLAMA_SETUP_URL)
        .send()
        .await
        .map_err(|e| format!("Error al descargar Ollama: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Descarga fallida (HTTP {})",
            response.status().as_u16()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Error leyendo la descarga: {e}"))?;

    emit_progress(app, "downloading", 100, "Descarga completada");

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(dest, &bytes).map_err(|e| format!("No se pudo guardar el instalador: {e}"))?;
    Ok(())
}

fn run_installer(installer: &Path, app: &AppHandle) -> Result<(), String> {
    emit_progress(app, "installing", 0, "Instalando Ollama…");

    let status = Command::new(installer)
        .args(["/VERYSILENT", "/NORESTART", "/SP-"])
        .status()
        .map_err(|e| format!("No se pudo ejecutar el instalador: {e}"))?;

    if !status.success() {
        return Err(format!(
            "El instalador de Ollama terminó con código {}",
            status.code().unwrap_or(-1)
        ));
    }

    emit_progress(app, "installing", 100, "Instalación completada");
    Ok(())
}

async fn pull_model(app: &AppHandle, model: &str) -> Result<(), String> {
    emit_progress(
        app,
        "pulling",
        0,
        &format!("Descargando modelo {model}…"),
    );

    let exe = ollama_exe_path().ok_or_else(|| "Ollama no está instalado".to_string())?;
    let mut child = AsyncCommand::new(&exe)
        .args(["pull", model])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo ejecutar ollama pull: {e}"))?;

    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(status) = parsed.get("status").and_then(|s| s.as_str()) {
                    let pct = parsed
                        .get("completed")
                        .and_then(|c| c.as_u64())
                        .zip(parsed.get("total").and_then(|t| t.as_u64()))
                        .map(|(c, t)| if t > 0 { ((c * 100) / t) as u32 } else { 0 })
                        .unwrap_or(0);
                    emit_progress(app, "pulling", pct, status);
                }
            } else {
                emit_progress(app, "pulling", 0, line);
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("ollama pull falló: {e}"))?;

    if !status.success() {
        return Err(format!(
            "ollama pull terminó con código {}",
            status.code().unwrap_or(-1)
        ));
    }

    emit_progress(app, "pulling", 100, &format!("Modelo {model} listo"));
    Ok(())
}

fn model_is_available(models: &[String], model: &str) -> bool {
    models
        .iter()
        .any(|m| m == model || m.starts_with(&format!("{model}:")) || m.starts_with(model))
}

pub async fn setup_ollama(
    app: AppHandle,
    data_dir: PathBuf,
    total_ram_gb: u64,
    pull_model_if_missing: bool,
) -> Result<OllamaStatus, String> {
    let model = recommended_model(total_ram_gb);

    if ollama_is_running().await {
        let models = list_models().await;
        if !pull_model_if_missing || model_is_available(&models, &model) {
            emit_progress(&app, "done", 100, "Ollama listo");
            return Ok(OllamaStatus {
                installed: true,
                running: true,
                models,
                recommended_model: model,
            });
        }
        pull_model(&app, &model).await?;
        let models = list_models().await;
        emit_progress(&app, "done", 100, "Ollama listo");
        return Ok(OllamaStatus {
            installed: true,
            running: true,
            models,
            recommended_model: model,
        });
    }

    if ollama_exe_path().is_none() {
        let installer = data_dir.join("installers").join("OllamaSetup.exe");
        download_installer(&installer, &app).await?;
        run_installer(&installer, &app)?;
        let _ = std::fs::remove_file(&installer);
    } else {
        emit_progress(&app, "installing", 100, "Ollama ya instalado");
    }

    if !ollama_is_running().await {
        start_ollama()?;
        wait_for_ollama(&app, Duration::from_secs(90)).await?;
    }

    let mut models = list_models().await;
    if pull_model_if_missing && !model_is_available(&models, &model) {
        pull_model(&app, &model).await?;
        models = list_models().await;
    }

    emit_progress(&app, "done", 100, "Ollama listo");
    Ok(OllamaStatus {
        installed: true,
        running: true,
        models,
        recommended_model: model,
    })
}
