//! Google Gemini API client (user-provided API key). Streaming + sync chat.

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::ollama::{is_stream_cancelled, ChatStreamEvent};

pub const GEMINI_SITE_ID: &str = "aiia.gemini";
pub const AI_PROVIDER_SETTING: &str = "ai_provider";
pub const DEFAULT_GEMINI_FLASH: &str = "gemini-3.6-flash";
pub const DEFAULT_GEMINI_PRO: &str = "gemini-3.1-pro-preview";

const GEMINI_API: &str = "https://generativelanguage.googleapis.com/v1beta";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiProvider {
    Local,
    Gemini,
}

impl AiProvider {
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
            Some("gemini") => Self::Gemini,
            _ => Self::Local,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Gemini => "gemini",
        }
    }
}

pub fn gemini_model_for_mode(mode: &str) -> &'static str {
    match mode {
        "pro" | "max" | "high" | "super_high" | "ultra_high" => DEFAULT_GEMINI_PRO,
        _ => DEFAULT_GEMINI_FLASH,
    }
}

fn map_gemini_http_error(status: u16, body: &str) -> String {
    let lower = body.to_ascii_lowercase();
    if status == 400 && (lower.contains("api key") || lower.contains("api_key")) {
        return "Gemini API key inválida. Revisa la clave en Ajustes.".to_string();
    }
    if status == 401 || status == 403 {
        return "Gemini rechazó la API key (no autorizada). Revisa la clave en Ajustes.".to_string();
    }
    if status == 429 {
        return "Cuota de Gemini agotada o demasiadas peticiones. Espera un momento o revisa tu plan en Google AI Studio.".to_string();
    }
    if status >= 500 {
        return format!("Gemini no está disponible temporalmente (HTTP {status}). Inténtalo de nuevo.");
    }
    if body.is_empty() {
        format!("Gemini rechazó la petición (HTTP {status})")
    } else {
        let truncated: String = body.chars().take(280).collect();
        format!("Gemini rechazó la petición: {truncated}")
    }
}

/// Convert Ollama-style messages to Gemini `systemInstruction` + `contents`.
pub fn build_gemini_body(
    messages: &[serde_json::Value],
    temperature: Option<f64>,
    response_json: bool,
) -> Result<serde_json::Value, String> {
    let mut system_parts: Vec<String> = Vec::new();
    let mut contents: Vec<serde_json::Value> = Vec::new();

    for msg in messages {
        let role = msg
            .get("role")
            .and_then(|r| r.as_str())
            .unwrap_or("user");
        let content = msg
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        let images = msg
            .get("images")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        if role == "system" {
            if !content.trim().is_empty() {
                system_parts.push(content);
            }
            continue;
        }

        let gemini_role = if role == "assistant" { "model" } else { "user" };
        let mut parts: Vec<serde_json::Value> = Vec::new();
        if !content.is_empty() {
            parts.push(serde_json::json!({ "text": content }));
        }
        for img in images {
            let Some(b64) = img.as_str() else { continue };
            let (mime, data) = split_data_url(b64);
            parts.push(serde_json::json!({
                "inlineData": {
                    "mimeType": mime,
                    "data": data,
                }
            }));
        }
        if parts.is_empty() {
            continue;
        }

        // Merge consecutive same-role turns (Gemini requirement).
        if let Some(last) = contents.last_mut() {
            if last.get("role").and_then(|r| r.as_str()) == Some(gemini_role) {
                if let Some(arr) = last.get_mut("parts").and_then(|p| p.as_array_mut()) {
                    arr.extend(parts);
                    continue;
                }
            }
        }

        contents.push(serde_json::json!({
            "role": gemini_role,
            "parts": parts,
        }));
    }

    if contents.is_empty() {
        return Err("No hay mensajes para enviar a Gemini".to_string());
    }

    let mut body = serde_json::json!({
        "contents": contents,
        "generationConfig": {
            "temperature": temperature.unwrap_or(0.7),
        }
    });

    if !system_parts.is_empty() {
        body["systemInstruction"] = serde_json::json!({
            "parts": [{ "text": system_parts.join("\n\n") }]
        });
    }

    if response_json {
        body["generationConfig"]["responseMimeType"] = serde_json::json!("application/json");
    }

    Ok(body)
}

fn split_data_url(raw: &str) -> (&str, &str) {
    if let Some(rest) = raw.strip_prefix("data:") {
        if let Some((meta, data)) = rest.split_once(",") {
            let mime = meta.split(';').next().unwrap_or("image/jpeg");
            return (mime, data);
        }
    }
    ("image/jpeg", raw)
}

fn extract_text_delta(value: &serde_json::Value) -> String {
    value
        .get("candidates")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|cand| cand.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

async fn sleep_backoff(attempt: u32) {
    let ms = match attempt {
        0 => 400,
        1 => 1200,
        _ => 3000,
    };
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

pub async fn gemini_chat(
    api_key: &str,
    model: String,
    messages: Vec<serde_json::Value>,
    temperature: Option<f64>,
    format: Option<String>,
) -> Result<String, String> {
    let response_json = format.as_deref() == Some("json");
    let body = build_gemini_body(&messages, temperature, response_json)?;
    let url = format!("{GEMINI_API}/models/{model}:generateContent");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(if model.to_lowercase().contains("pro") {
            300
        } else {
            180
        }))
        .build()
        .map_err(|e| e.to_string())?;

    let mut last_err = String::new();
    for attempt in 0..3u32 {
        let res = client
            .post(&url)
            .header("x-goog-api-key", api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("No se pudo conectar con Gemini: {e}"))?;

        let status = res.status().as_u16();
        let text = res.text().await.unwrap_or_default();
        if status == 429 || status >= 500 {
            last_err = map_gemini_http_error(status, &text);
            if attempt < 2 {
                sleep_backoff(attempt).await;
                continue;
            }
            return Err(last_err);
        }
        if !(200..300).contains(&status) {
            return Err(map_gemini_http_error(status, &text));
        }

        let data: serde_json::Value =
            serde_json::from_str(&text).map_err(|e| format!("Respuesta Gemini inválida: {e}"))?;
        let out = extract_text_delta(&data);
        if out.is_empty() {
            return Err("Gemini devolvió una respuesta vacía".to_string());
        }
        return Ok(out);
    }
    Err(last_err)
}

pub async fn gemini_chat_stream(
    app: AppHandle,
    api_key: String,
    stream_id: String,
    model: String,
    messages: Vec<serde_json::Value>,
    temperature: Option<f64>,
    cancel_set: std::sync::Arc<std::sync::Mutex<std::collections::HashSet<String>>>,
) -> Result<(), String> {
    let emit_done = |delta: String, cancelled: bool, error: Option<String>| {
        let _ = app.emit(
            "chat-stream",
            ChatStreamEvent {
                stream_id: stream_id.clone(),
                delta,
                done: true,
                cancelled,
                error,
            },
        );
    };

    let body = match build_gemini_body(&messages, temperature, false) {
        Ok(b) => b,
        Err(e) => {
            emit_done(String::new(), false, Some(e.clone()));
            return Err(e);
        }
    };

    let url = format!("{GEMINI_API}/models/{model}:streamGenerateContent?alt=sse");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|e| e.to_string())?;

    let mut last_err = String::new();
    let mut res_opt = None;
    for attempt in 0..3u32 {
        if is_stream_cancelled(&cancel_set, &stream_id) {
            let _ = cancel_set.lock().map(|mut set| set.remove(&stream_id));
            emit_done(String::new(), true, None);
            return Ok(());
        }

        let res = match client
            .post(&url)
            .header("x-goog-api-key", &api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("No se pudo conectar con Gemini: {e}");
                if attempt < 2 {
                    sleep_backoff(attempt).await;
                    continue;
                }
                emit_done(String::new(), false, Some(last_err.clone()));
                return Err(last_err);
            }
        };

        let status = res.status().as_u16();
        if status == 429 || status >= 500 {
            let text = res.text().await.unwrap_or_default();
            last_err = map_gemini_http_error(status, &text);
            if attempt < 2 {
                sleep_backoff(attempt).await;
                continue;
            }
            emit_done(String::new(), false, Some(last_err.clone()));
            return Err(last_err);
        }
        if !(200..300).contains(&status) {
            let text = res.text().await.unwrap_or_default();
            let err = map_gemini_http_error(status, &text);
            emit_done(String::new(), false, Some(err.clone()));
            return Err(err);
        }
        res_opt = Some(res);
        break;
    }

    let Some(res) = res_opt else {
        emit_done(String::new(), false, Some(last_err.clone()));
        return Err(last_err);
    };

    use futures_util::StreamExt;
    let mut stream = res.bytes_stream();
    let mut buffer = Vec::new();

    while let Some(chunk) = stream.next().await {
        if is_stream_cancelled(&cancel_set, &stream_id) {
            let _ = cancel_set.lock().map(|mut set| set.remove(&stream_id));
            emit_done(String::new(), true, None);
            return Ok(());
        }

        let chunk = chunk.map_err(|e| {
            let err = format!("Error de red Gemini: {e}");
            emit_done(String::new(), false, Some(err.clone()));
            err
        })?;
        buffer.extend_from_slice(&chunk);

        while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buffer.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes).trim().to_string();
            if line.is_empty() || line.starts_with(':') {
                continue;
            }
            let payload = if let Some(rest) = line.strip_prefix("data:") {
                rest.trim()
            } else {
                continue;
            };
            if payload.is_empty() || payload == "[DONE]" {
                continue;
            }
            let Ok(parsed) = serde_json::from_str::<serde_json::Value>(payload) else {
                continue;
            };
            let delta = extract_text_delta(&parsed);
            if !delta.is_empty() {
                let _ = app.emit(
                    "chat-stream",
                    ChatStreamEvent {
                        stream_id: stream_id.clone(),
                        delta,
                        done: false,
                        cancelled: false,
                        error: None,
                    },
                );
            }
        }
    }

    emit_done(String::new(), false, None);
    Ok(())
}

pub async fn test_gemini_api_key(api_key: &str) -> Result<(), String> {
    let messages = vec![serde_json::json!({
        "role": "user",
        "content": "Reply with exactly: ok"
    })];
    let out = gemini_chat(
        api_key,
        DEFAULT_GEMINI_FLASH.to_string(),
        messages,
        Some(0.0),
        None,
    )
    .await?;
    if out.trim().is_empty() {
        return Err("Gemini respondió vacío".to_string());
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderStatus {
    pub provider: String,
    pub has_gemini_key: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_system_and_roles() {
        let messages = vec![
            serde_json::json!({"role": "system", "content": "Be brief"}),
            serde_json::json!({"role": "user", "content": "Hi"}),
            serde_json::json!({"role": "assistant", "content": "Hello"}),
            serde_json::json!({"role": "user", "content": "Again"}),
        ];
        let body = build_gemini_body(&messages, Some(0.2), false).unwrap();
        assert!(body.get("systemInstruction").is_some());
        let contents = body.get("contents").unwrap().as_array().unwrap();
        assert_eq!(contents.len(), 3);
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(contents[1]["role"], "model");
        assert_eq!(contents[2]["role"], "user");
    }

    #[test]
    fn merges_consecutive_user_turns() {
        let messages = vec![
            serde_json::json!({"role": "user", "content": "A"}),
            serde_json::json!({"role": "user", "content": "B"}),
        ];
        let body = build_gemini_body(&messages, None, false).unwrap();
        let contents = body.get("contents").unwrap().as_array().unwrap();
        assert_eq!(contents.len(), 1);
        assert_eq!(contents[0]["parts"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn maps_images_as_inline_data_camel_case() {
        let messages = vec![serde_json::json!({
            "role": "user",
            "content": "What is this?",
            "images": ["data:image/png;base64,aaa"]
        })];
        let body = build_gemini_body(&messages, None, false).unwrap();
        let parts = body["contents"][0]["parts"].as_array().unwrap();
        assert!(parts.iter().any(|p| p.get("inlineData").is_some()));
        assert!(parts.iter().any(|p| {
            p.get("inlineData")
                .and_then(|d| d.get("mimeType"))
                .and_then(|m| m.as_str())
                == Some("image/png")
        }));
        assert!(parts.iter().all(|p| p.get("inline_data").is_none()));
    }
}
