mod config;
mod deferred;
mod release;
mod utils;

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub use config::AUTO_UPDATE_SETTING_KEY;

static CHECKING: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub percent: Option<u32>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub up_to_date: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub is_packaged: bool,
    pub update_supported: bool,
    pub platform: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub up_to_date: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub installing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub declined: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dev: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub busy: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_releases: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePrefs {
    pub auto_update_on_startup: bool,
}

fn emit_status(app: &AppHandle, status: UpdateStatus) {
    let _ = app.emit("update-status", status);
}

pub fn get_app_info() -> AppInfo {
    let packaged = utils::is_packaged();
    AppInfo {
        version: utils::current_app_version(),
        is_packaged: packaged,
        update_supported: packaged,
        platform: std::env::consts::OS.to_string(),
    }
}

pub fn read_auto_update_pref(get_setting: impl Fn(&str) -> Option<String>) -> bool {
    get_setting(AUTO_UPDATE_SETTING_KEY)
        .map(|v| {
            let lower = v.trim().to_lowercase();
            lower == "1" || lower == "true" || lower == "yes" || lower == "on"
        })
        .unwrap_or(false)
}

pub async fn check_for_updates(
    app: AppHandle,
    auto_install: bool,
    _manual: bool,
) -> UpdateCheckResult {
    let current = utils::current_app_version();

    if CHECKING.swap(true, Ordering::SeqCst) {
        return UpdateCheckResult {
            up_to_date: false,
            busy: Some(true),
            current_version: Some(current),
            available: None,
            version: None,
            release_notes: None,
            installing: None,
            declined: None,
            dev: None,
            error: None,
            no_releases: None,
        };
    }

    let result = check_for_updates_inner(&app, auto_install, &current).await;
    CHECKING.store(false, Ordering::SeqCst);
    result
}

async fn check_for_updates_inner(
    app: &AppHandle,
    auto_install: bool,
    current: &str,
) -> UpdateCheckResult {
    if !utils::is_packaged() {
        return UpdateCheckResult {
            up_to_date: true,
            dev: Some(true),
            current_version: Some(current.to_string()),
            available: None,
            version: None,
            release_notes: None,
            installing: None,
            declined: None,
            busy: None,
            error: None,
            no_releases: None,
        };
    }

    emit_status(
        app,
        UpdateStatus {
            phase: "checking".to_string(),
            version: None,
            percent: None,
            message: "Checking for updates…".to_string(),
            release_notes: None,
            current_version: Some(current.to_string()),
            up_to_date: None,
        },
    );

    let release = match release::fetch_latest_release().await {
        Ok(r) => r,
        Err(e) => {
            if utils::is_feed_not_found(&e) {
                emit_status(
                    app,
                    UpdateStatus {
                        phase: "idle".to_string(),
                        version: None,
                        percent: None,
                        message: "No releases published".to_string(),
                        release_notes: None,
                        current_version: Some(current.to_string()),
                        up_to_date: Some(true),
                    },
                );
                return UpdateCheckResult {
                    up_to_date: true,
                    no_releases: Some(true),
                    current_version: Some(current.to_string()),
                    available: None,
                    version: None,
                    release_notes: None,
                    installing: None,
                    declined: None,
                    dev: None,
                    busy: None,
                    error: None,
                };
            }
            emit_status(
                app,
                UpdateStatus {
                    phase: "error".to_string(),
                    version: None,
                    percent: None,
                    message: e.clone(),
                    release_notes: None,
                    current_version: Some(current.to_string()),
                    up_to_date: None,
                },
            );
            return UpdateCheckResult {
                up_to_date: false,
                error: Some(e),
                current_version: Some(current.to_string()),
                available: None,
                version: None,
                release_notes: None,
                installing: None,
                declined: None,
                dev: None,
                busy: None,
                no_releases: None,
            };
        }
    };

    let latest = release.tag_name.trim_start_matches('v').to_string();
    let notes = release::release_notes_text(release.body.as_deref());

    if latest.is_empty() || utils::compare_versions(&latest, current) <= 0 {
        emit_status(
            app,
            UpdateStatus {
                phase: "idle".to_string(),
                version: None,
                percent: None,
                message: "You already have the latest version".to_string(),
                release_notes: None,
                current_version: Some(current.to_string()),
                up_to_date: Some(true),
            },
        );
        return UpdateCheckResult {
            up_to_date: true,
            current_version: Some(current.to_string()),
            available: None,
            version: None,
            release_notes: None,
            installing: None,
            declined: None,
            dev: None,
            busy: None,
            error: None,
            no_releases: None,
        };
    }

    emit_status(
        app,
        UpdateStatus {
            phase: "available".to_string(),
            version: Some(latest.clone()),
            percent: None,
            message: format!("Available: v{latest}"),
            release_notes: Some(notes.clone()),
            current_version: Some(current.to_string()),
            up_to_date: Some(false),
        },
    );

    if !auto_install {
        return UpdateCheckResult {
            up_to_date: false,
            available: Some(true),
            version: Some(latest),
            current_version: Some(current.to_string()),
            release_notes: Some(notes),
            installing: None,
            declined: None,
            dev: None,
            busy: None,
            error: None,
            no_releases: None,
        };
    }

    match download_and_install(app, &release, &latest, &notes).await {
        Ok(()) => UpdateCheckResult {
            up_to_date: false,
            installing: Some(true),
            version: Some(latest),
            current_version: Some(current.to_string()),
            release_notes: Some(notes),
            available: None,
            declined: None,
            dev: None,
            busy: None,
            error: None,
            no_releases: None,
        },
        Err(e) => {
            emit_status(
                app,
                UpdateStatus {
                    phase: "error".to_string(),
                    version: Some(latest.clone()),
                    percent: None,
                    message: e.clone(),
                    release_notes: None,
                    current_version: Some(current.to_string()),
                    up_to_date: None,
                },
            );
            UpdateCheckResult {
                up_to_date: false,
                error: Some(e),
                version: Some(latest),
                current_version: Some(current.to_string()),
                release_notes: Some(notes),
                available: None,
                installing: None,
                declined: None,
                dev: None,
                busy: None,
                no_releases: None,
            }
        }
    }
}

async fn download_and_install(
    app: &AppHandle,
    release: &release::GhRelease,
    version: &str,
    _notes: &str,
) -> Result<(), String> {
    let manifest = release::fetch_release_manifest(&release.tag_name).await;
    let body = release.body.as_deref().unwrap_or("");

    #[cfg(windows)]
    {
        let asset = release::find_windows_msi_asset(release)
            .ok_or_else(|| "No MSI installer in the latest GitHub release".to_string())?;
        let expected = release::resolve_expected_sha256(
            &manifest,
            body,
            &asset.name,
            "msi",
        );
        install_windows(app, version, asset, expected.as_deref()).await
    }

    #[cfg(target_os = "macos")]
    {
        let asset = release::find_macos_dmg_asset(release)
            .ok_or_else(|| "No DMG installer in the latest GitHub release".to_string())?;
        let expected = release::resolve_expected_sha256(
            &manifest,
            body,
            &asset.name,
            "dmg",
        );
        install_macos(app, version, asset, expected.as_deref()).await
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, release, version, manifest, body);
        Err("Automatic updates are only supported on Windows and macOS".to_string())
    }
}

#[cfg(windows)]
async fn install_windows(
    app: &AppHandle,
    version: &str,
    asset: &release::GhAsset,
    expected_sha256: Option<&str>,
) -> Result<(), String> {
    let cache_dir = config::update_cache_dir();
    let dest = cache_dir.join(&asset.name);
    if dest.exists() {
        std::fs::remove_file(&dest).ok();
    }

    emit_status(
        app,
        UpdateStatus {
            phase: "downloading".to_string(),
            version: Some(version.to_string()),
            percent: Some(0),
            message: format!("Downloading v{version}…"),
            release_notes: None,
            current_version: None,
            up_to_date: None,
        },
    );

    let app_handle = app.clone();
    let version_owned = version.to_string();
    release::download_file(&asset.browser_download_url, &dest, move |pct| {
        emit_status(
            &app_handle,
            UpdateStatus {
                phase: "downloading".to_string(),
                version: Some(version_owned.clone()),
                percent: Some(pct),
                message: format!("Downloading… {pct}%"),
                release_notes: None,
                current_version: None,
                up_to_date: None,
            },
        );
    })
    .await?;

    release::verify_downloaded_file(&dest, expected_sha256, &asset.name)?;

    emit_status(
        app,
        UpdateStatus {
            phase: "installing".to_string(),
            version: Some(version.to_string()),
            percent: None,
            message: "Installing and restarting…".to_string(),
            release_notes: None,
            current_version: None,
            up_to_date: None,
        },
    );

    let install_dir = deferred::resolve_install_dir();
    let parent_pid = std::process::id();
    deferred::launch_msi_install_after_quit(&dest, &install_dir, parent_pid)?;

    tokio::time::sleep(std::time::Duration::from_millis(3500)).await;
    app.exit(0);
    Ok(())
}

#[cfg(target_os = "macos")]
async fn install_macos(
    app: &AppHandle,
    version: &str,
    asset: &release::GhAsset,
    expected_sha256: Option<&str>,
) -> Result<(), String> {
    let cache_dir = config::update_cache_dir();
    let dest = cache_dir.join(&asset.name);
    if dest.exists() {
        std::fs::remove_file(&dest).ok();
    }

    emit_status(
        app,
        UpdateStatus {
            phase: "downloading".to_string(),
            version: Some(version.to_string()),
            percent: Some(0),
            message: format!("Downloading v{version}…"),
            release_notes: None,
            current_version: None,
            up_to_date: None,
        },
    );

    let app_handle = app.clone();
    let version_owned = version.to_string();
    release::download_file(&asset.browser_download_url, &dest, move |pct| {
        emit_status(
            &app_handle,
            UpdateStatus {
                phase: "downloading".to_string(),
                version: Some(version_owned.clone()),
                percent: Some(pct),
                message: format!("Downloading… {pct}%"),
                release_notes: None,
                current_version: None,
                up_to_date: None,
            },
        );
    })
    .await?;

    release::verify_downloaded_file(&dest, expected_sha256, &asset.name)?;

    emit_status(
        app,
        UpdateStatus {
            phase: "installing".to_string(),
            version: Some(version.to_string()),
            percent: None,
            message: "Installing and restarting…".to_string(),
            release_notes: None,
            current_version: None,
            up_to_date: None,
        },
    );

    let app_path = deferred::resolve_macos_app_path();
    let parent_pid = std::process::id();
    deferred::launch_dmg_install_after_quit(&dest, &app_path, parent_pid)?;

    tokio::time::sleep(std::time::Duration::from_millis(3500)).await;
    app.exit(0);
    Ok(())
}

pub fn startup_update_check(app: AppHandle, get_setting: impl Fn(&str) -> Option<String> + Send + 'static) {
    if !read_auto_update_pref(&get_setting) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let _ = check_for_updates(app, true, false).await;
    });
}
