use std::time::Duration;

use aiia_core::models::{
    AgentSpec, AgentStatus, DedupeConfig, EffortLevel, ExcelMode, FilterConfig, OutputConfig,
    ScheduleConfig, SearchConfig, SearchSource,
};
use regex::Regex;
use serde::Serialize;
use uuid::Uuid;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

pub async fn web_search(query: &str, limit: usize) -> Result<Vec<WebSearchHit>, String> {
    web_search_with_depth(query, limit, "eficaz").await
}

/// depth: `instant` (DDG only) | `eficaz` (DDG+Bing) | `pro` (multi-engine + query variants)
pub async fn web_search_with_depth(
    query: &str,
    limit: usize,
    depth: &str,
) -> Result<Vec<WebSearchHit>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        )
        .build()
        .map_err(|e| e.to_string())?;

    let queries: Vec<String> = match depth {
        "instant" => vec![query.to_string()],
        "pro" => {
            let mut qs = vec![query.to_string()];
            qs.push(format!("{query} 2025 OR 2026"));
            qs.push(format!("{query} overview analysis"));
            qs
        }
        _ => vec![query.to_string(), format!("{query} details")],
    };

    let mut all = Vec::new();
    for q in &queries {
        match depth {
            "instant" => {
                if let Ok(hits) = search_ddg(&client, q, limit).await {
                    all.extend(hits);
                }
            }
            "pro" => {
                let (a, b, c) = tokio::join!(
                    search_ddg(&client, q, limit),
                    search_bing(&client, q, limit),
                    search_brave(&client, q, limit),
                );
                for r in [a, b, c] {
                    if let Ok(hits) = r {
                        all.extend(hits);
                    }
                }
            }
            _ => {
                let (a, b) = tokio::join!(search_ddg(&client, q, limit), search_bing(&client, q, limit));
                for r in [a, b] {
                    if let Ok(hits) = r {
                        all.extend(hits);
                    }
                }
            }
        }
        if depth == "instant" {
            break;
        }
    }

    Ok(dedupe_hits(all, limit.max(1)))
}

async fn search_ddg(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
) -> Result<Vec<WebSearchHit>, String> {
    let url = format!(
        "https://html.duckduckgo.com/html/?q={}",
        urlencoding_encode(query)
    );
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Search failed HTTP {}", res.status().as_u16()));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    Ok(parse_ddg_html(&html, limit))
}

async fn search_bing(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
) -> Result<Vec<WebSearchHit>, String> {
    let url = format!(
        "https://www.bing.com/search?q={}",
        urlencoding_encode(query)
    );
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Bing HTTP {}", res.status().as_u16()));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    Ok(parse_bing_html(&html, limit))
}

async fn search_brave(
    client: &reqwest::Client,
    query: &str,
    limit: usize,
) -> Result<Vec<WebSearchHit>, String> {
    let url = format!(
        "https://search.brave.com/search?q={}",
        urlencoding_encode(query)
    );
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Brave HTTP {}", res.status().as_u16()));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    Ok(parse_brave_html(&html, limit))
}

fn dedupe_hits(hits: Vec<WebSearchHit>, limit: usize) -> Vec<WebSearchHit> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for h in hits {
        let key = h.url.trim().trim_end_matches('/').to_lowercase();
        if key.is_empty() || !seen.insert(key) {
            continue;
        }
        out.push(h);
        if out.len() >= limit {
            break;
        }
    }
    out
}

pub async fn fetch_url_text(url: &str, max_chars: usize) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .user_agent("Mozilla/5.0 (compatible; AIIA/1.0; +local)")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Fetch failed HTTP {}", res.status().as_u16()));
    }
    let html = res.text().await.map_err(|e| e.to_string())?;
    let text = strip_html(&html);
    if text.len() > max_chars {
        Ok(format!("{}…", &text[..max_chars]))
    } else {
        Ok(text)
    }
}

pub fn draft_agent_from_prompt(name: &str, prompt: &str) -> AgentSpec {
    let id = Uuid::new_v4().to_string();
    AgentSpec {
        id,
        version: 1,
        name: if name.trim().is_empty() {
            "Agent from chat".to_string()
        } else {
            name.trim().to_string()
        },
        prompt: prompt.to_string(),
        template_id: Some("custom".to_string()),
        opportunity_subtype: None,
        context_attachments: None,
        search: SearchConfig {
            queries: vec![prompt.chars().take(120).collect()],
            sources: vec![SearchSource::Duckduckgo],
            requires_login: vec![],
            max_sources: None,
            max_results_per_query: Some(20),
        },
        filters: FilterConfig {
            criteria: prompt.to_string(),
            min_score: 50.0,
            dedupe: DedupeConfig {
                enabled: true,
                fields: vec!["title".to_string(), "url".to_string()],
            },
        },
        output: OutputConfig {
            schema: vec![
                "title".to_string(),
                "url".to_string(),
                "summary".to_string(),
            ],
            destinations: vec!["inbox".to_string(), "excel".to_string()],
            excel_path: None,
            excel_mode: ExcelMode::UpdateSame,
            notify: true,
        },
        schedule: ScheduleConfig {
            interval_minutes: 1440,
            only_when_running: true,
            timezone: "UTC".to_string(),
        },
        effort: EffortLevel::Medium,
        retention_days: 90,
        status: AgentStatus::Draft,
    }
}

pub const CHAT_SYSTEM_PROMPT: &str = r#"You are AIIA Chat, the local assistant inside the AIIA desktop app.
You run on the user's PC via Ollama (free, no paid cloud APIs). Reply in the same language as the user's latest message.
Be helpful, clear, and concise. You can see images the user attaches.

You can use tools by emitting exactly one of these tags when needed (no other text inside the tag):
<tool name="web_search">{"query":"..."}</tool>
<tool name="fetch_url">{"url":"..."}</tool>
<tool name="create_agent">{"name":"...","prompt":"..."}</tool>
<tool name="generate_image">{"prompt":"..."}</tool>
<tool name="run_python">{"code":"..."}</tool>

Use web_search / fetch_url for fresh internet information.
Use create_agent when the user wants a recurring search/collection agent.
Use generate_image when the user asks to create/draw an image (requires local Automatic1111/Forge on port 7860).
Use run_python for short calculations or data transforms (local, timed out; no network assumptions).
After a tool result is provided, continue the answer for the user.
Do not invent tool results."#;

pub fn system_prompt_with_mode(mode_addon: Option<&str>) -> String {
    match mode_addon {
        Some(addon) if !addon.trim().is_empty() => {
            format!("{}\n\n{}", CHAT_SYSTEM_PROMPT, addon.trim())
        }
        _ => CHAT_SYSTEM_PROMPT.to_string(),
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImage {
    pub path: String,
    pub prompt: String,
}

/// Local txt2img via Automatic1111 / Forge / compatible API on localhost:7860.
pub async fn generate_image(prompt: &str, out_dir: &std::path::Path) -> Result<GeneratedImage, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;

    let endpoints = [
        "http://127.0.0.1:7860/sdapi/v1/txt2img",
        "http://127.0.0.1:7861/sdapi/v1/txt2img",
    ];

    let body = serde_json::json!({
        "prompt": prompt,
        "negative_prompt": "blurry, low quality, watermark, text",
        "steps": 20,
        "width": 512,
        "height": 512,
        "cfg_scale": 7,
    });

    let mut last_err = "No local image API found on :7860/:7861 (start Automatic1111 or Forge).".to_string();
    for url in endpoints {
        match client.post(url).json(&body).send().await {
            Ok(res) if res.status().is_success() => {
                let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
                let b64 = data
                    .pointer("/images/0")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "Image API returned no image data".to_string())?;
                let bytes = b64_decode(b64)?;
                std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
                let name = format!("gen-{}.png", &Uuid::new_v4().to_string()[..8]);
                let path = out_dir.join(&name);
                std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
                return Ok(GeneratedImage {
                    path: path.to_string_lossy().to_string(),
                    prompt: prompt.to_string(),
                });
            }
            Ok(res) => {
                last_err = format!("Image API HTTP {}", res.status().as_u16());
            }
            Err(e) => {
                last_err = format!("Image API unreachable ({e}). Start Automatic1111/Forge with --api.");
            }
        }
    }
    Err(last_err)
}

fn b64_decode(s: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    // A1111 may return raw base64 or data URL
    let raw = s.split(',').next_back().unwrap_or(s);
    base64::engine::general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| format!("Invalid base64 image: {e}"))
}

/// Run a short Python snippet locally with a hard timeout. Not a full sandbox.
pub fn run_python(code: &str, timeout_secs: u64) -> Result<String, String> {
    let forbidden = [
        "subprocess",
        "os.system",
        "socket",
        "urllib",
        "requests",
        "http.client",
        "ctypes",
        "multiprocessing",
        "__import__('os')",
    ];
    let lower = code.to_lowercase();
    for f in forbidden {
        if lower.contains(f) {
            return Err(format!("Blocked for safety: `{f}` is not allowed in run_python."));
        }
    }
    if code.len() > 8_000 {
        return Err("Code too long (max 8000 chars).".to_string());
    }

    let dir = std::env::temp_dir().join(format!("aiia-py-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let script = dir.join("snippet.py");
    std::fs::write(&script, code).map_err(|e| e.to_string())?;

    let py_cmds: &[&[&str]] = &[
        &["py", "-3"],
        &["python3"],
        &["python"],
    ];

    let mut last_err = "Python not found on PATH.".to_string();
    for cmd in py_cmds {
        let mut c = std::process::Command::new(cmd[0]);
        for a in &cmd[1..] {
            c.arg(a);
        }
        c.arg(&script);
        c.current_dir(&dir);
        c.env("PYTHONIOENCODING", "utf-8");
        // Best-effort: no proxy hints
        c.env_remove("HTTP_PROXY");
        c.env_remove("HTTPS_PROXY");

        match run_with_timeout(c, timeout_secs) {
            Ok(out) => {
                let _ = std::fs::remove_dir_all(&dir);
                return Ok(out);
            }
            Err(e) => {
                last_err = e;
                if !last_err.contains("not found") && !last_err.contains("os error 2") {
                    let _ = std::fs::remove_dir_all(&dir);
                    return Err(last_err);
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    Err(last_err)
}

fn run_with_timeout(mut cmd: std::process::Command, timeout_secs: u64) -> Result<String, String> {
    use std::io::Read;
    use std::process::Stdio;

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Python not found on PATH.".to_string()
        } else {
            e.to_string()
        }
    })?;

    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut stdout = String::new();
                let mut stderr = String::new();
                if let Some(mut out) = child.stdout.take() {
                    let _ = out.read_to_string(&mut stdout);
                }
                if let Some(mut err) = child.stderr.take() {
                    let _ = err.read_to_string(&mut stderr);
                }
                let mut combined = stdout;
                if !stderr.trim().is_empty() {
                    if !combined.is_empty() {
                        combined.push_str("\n");
                    }
                    combined.push_str(&stderr);
                }
                if !status.success() && combined.trim().is_empty() {
                    return Err(format!("Python exited with {status}"));
                }
                if combined.len() > 20_000 {
                    combined.truncate(20_000);
                    combined.push_str("\n…(truncated)");
                }
                return Ok(if combined.trim().is_empty() {
                    "(no output)".to_string()
                } else {
                    combined
                });
            }
            Ok(None) => {
                if start.elapsed().as_secs() >= timeout_secs {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!("Python timed out after {timeout_secs}s"));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn parse_bing_html(html: &str, limit: usize) -> Vec<WebSearchHit> {
    let mut hits = Vec::new();
    let Ok(re) = Regex::new(
        r#"(?s)<li class="b_algo".*?<h2[^>]*>\s*<a[^>]+href="(https?://[^"]+)"[^>]*>(.*?)</a>.*?(?:<p[^>]*>(.*?)</p>|<div class="b_caption"[^>]*>.*?<p[^>]*>(.*?)</p>)"#,
    ) else {
        return hits;
    };
    for cap in re.captures_iter(html).take(limit) {
        let url = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        let title = strip_html(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        let snippet = strip_html(
            cap.get(3)
                .or_else(|| cap.get(4))
                .map(|m| m.as_str())
                .unwrap_or(""),
        );
        if url.starts_with("http") {
            hits.push(WebSearchHit {
                title,
                url,
                snippet,
            });
        }
    }
    hits
}

fn parse_brave_html(html: &str, limit: usize) -> Vec<WebSearchHit> {
    let mut hits = Vec::new();
    let Ok(re) = Regex::new(
        r#"<a[^>]+href="(https?://(?!cdn\.|search\.brave)[^"]+)"[^>]*(?:class="[^"]*(?:title|result)[^"]*")?[^>]*>(.*?)</a>"#,
    ) else {
        return hits;
    };
    for cap in re.captures_iter(html).take(limit * 3) {
        let url = cap.get(1).map(|m| m.as_str()).unwrap_or("").to_string();
        let title = strip_html(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        if !url.starts_with("http") || title.len() < 3 {
            continue;
        }
        hits.push(WebSearchHit {
            title,
            url,
            snippet: String::new(),
        });
        if hits.len() >= limit {
            break;
        }
    }
    hits
}

fn parse_ddg_html(html: &str, limit: usize) -> Vec<WebSearchHit> {
    let mut hits = Vec::new();
    let re_result = Regex::new(
        r#"(?s)class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</(?:a|td|div)"#,
    )
    .ok();
    if let Some(re) = re_result {
        for cap in re.captures_iter(html).take(limit) {
            let raw_url = cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let url = decode_ddg_redirect(raw_url);
            let title = strip_html(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
            let snippet = strip_html(cap.get(3).map(|m| m.as_str()).unwrap_or(""));
            if !url.is_empty() {
                hits.push(WebSearchHit {
                    title,
                    url,
                    snippet,
                });
            }
        }
    }
    if hits.is_empty() {
        if let Ok(re) = Regex::new(r#"uddg=([^&"]+)"#) {
            for cap in re.captures_iter(html).take(limit) {
                let enc = cap.get(1).map(|m| m.as_str()).unwrap_or("");
                let url = urlencoding_decode(enc);
                if url.starts_with("http") {
                    hits.push(WebSearchHit {
                        title: url.clone(),
                        url,
                        snippet: String::new(),
                    });
                }
            }
        }
    }
    hits
}

fn decode_ddg_redirect(href: &str) -> String {
    if let Some(idx) = href.find("uddg=") {
        let rest = &href[idx + 5..];
        let enc = rest.split('&').next().unwrap_or(rest);
        return urlencoding_decode(enc);
    }
    if href.starts_with("http") {
        return href.to_string();
    }
    String::new()
}

fn urlencoding_decode(s: &str) -> String {
    let mut out = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = &s[i + 1..i + 3];
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                }
                i += 3;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn strip_html(html: &str) -> String {
    let re = Regex::new(r"<[^>]+>").ok();
    let no_tags = if let Some(re) = re {
        re.replace_all(html, " ").to_string()
    } else {
        html.to_string()
    };
    let decoded = no_tags
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_simple_html() {
        assert_eq!(strip_html("<p>Hola <b>mundo</b></p>"), "Hola mundo");
    }

    #[tokio::test]
    async fn draft_agent_has_expected_status() {
        let spec = draft_agent_from_prompt("Test", "Buscar ofertas QA");
        assert_eq!(spec.status, AgentStatus::Draft);
        assert!(!spec.search.queries.is_empty());
    }
}
