use std::path::Path;

use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::config::{github_owner, github_repo, MANIFEST_FILE_NAME};
use super::utils::truncate_release_notes;

#[derive(Debug, Deserialize)]
pub struct GhAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Debug, Deserialize)]
pub struct GhRelease {
    pub tag_name: String,
    pub body: Option<String>,
    pub assets: Vec<GhAsset>,
}

fn gh_client() -> Client {
    Client::builder()
        .user_agent("AIIA-Updater")
        .build()
        .unwrap_or_else(|_| Client::new())
}

pub async fn fetch_latest_release() -> Result<GhRelease, String> {
    let owner = github_owner();
    let repo = github_repo();
    let url = format!("https://api.github.com/repos/{owner}/{repo}/releases/latest");
    gh_client()
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<GhRelease>()
        .await
        .map_err(|e| e.to_string())
}

pub async fn fetch_release_manifest(tag: &str) -> Option<Value> {
    let owner = github_owner();
    let repo = github_repo();
    let url = format!(
        "https://github.com/{owner}/{repo}/releases/download/{tag}/{MANIFEST_FILE_NAME}"
    );
    gh_client()
        .get(&url)
        .send()
        .await
        .ok()?
        .json::<Value>()
        .await
        .ok()
}

pub fn find_windows_msi_asset(release: &GhRelease) -> Option<&GhAsset> {
    release
        .assets
        .iter()
        .find(|a| a.name.to_ascii_lowercase().ends_with(".msi") && a.name.contains("AIIA"))
}

pub fn find_macos_dmg_asset(release: &GhRelease) -> Option<&GhAsset> {
    release
        .assets
        .iter()
        .find(|a| a.name.to_ascii_lowercase().ends_with(".dmg") && a.name.contains("AIIA"))
}

pub fn resolve_expected_sha256(
    manifest: &Option<serde_json::Value>,
    release_body: &str,
    asset_name: &str,
    kind: &str,
) -> Option<String> {
    if let Some(m) = manifest {
        if let Some(entry) = m
            .get("assets")
            .and_then(|a| a.get(kind))
            .or_else(|| m.get(kind))
        {
            if let Some(hash) = entry.get("sha256").and_then(|v| v.as_str()) {
                return Some(hash.to_lowercase());
            }
        }
    }
    parse_sha256_from_body(release_body, asset_name)
}

fn parse_sha256_from_body(body: &str, file_name: &str) -> Option<String> {
    let normalized = file_name.replace('\\', "/");
    let base = normalized.rsplit('/').next().unwrap_or(file_name);
    for line in body.lines() {
        let lower = line.to_lowercase();
        if lower.contains(&base.to_lowercase()) {
            for word in line.split_whitespace() {
                if word.len() == 64 && word.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Some(word.to_lowercase());
                }
            }
        }
    }
    None
}

pub fn release_notes_text(body: Option<&str>) -> String {
    truncate_release_notes(body.unwrap_or(""), 500)
}

pub fn compute_file_sha256(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex::encode(hasher.finalize()))
}

pub async fn download_file(
    url: &str,
    dest: &Path,
    on_progress: impl Fn(u32),
) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    std::fs::create_dir_all(dest.parent().unwrap_or(Path::new("."))).map_err(|e| e.to_string())?;

    let response = gh_client()
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;

    let total = response.content_length().unwrap_or(0);
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut last_pct: u32 = 255;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        if total > 0 {
            let pct = ((received * 100) / total) as u32;
            if pct != last_pct && (pct == 0 || pct == 100 || pct >= last_pct.saturating_add(10)) {
                last_pct = pct;
                on_progress(pct);
            }
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    on_progress(100);
    Ok(())
}

pub fn verify_downloaded_file(path: &Path, expected: Option<&str>, asset_name: &str) -> Result<(), String> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let actual = compute_file_sha256(path)?;
    if actual != expected.to_lowercase() {
        let _ = std::fs::remove_file(path);
        return Err(format!("Checksum mismatch for {asset_name}"));
    }
    Ok(())
}
