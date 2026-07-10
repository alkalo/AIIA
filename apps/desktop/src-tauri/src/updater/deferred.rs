//! Instalación diferida tras cerrar la app — helper Rust empaquetado (sin PowerShell).

use std::path::{Path, PathBuf};
use std::process::Command;

use super::config::{update_helper_dir, update_install_log_path};
#[cfg(target_os = "macos")]
use super::config::UPDATE_HELPER_MARK;

fn append_log(line: &str) {
    let log_path = update_install_log_path();
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let _ = writeln!(file, "{line}");
    }
}

fn resolve_update_helper_exe() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for root in [
                dir.join("resources").join("update-helper"),
                dir.join("update-helper"),
            ] {
                let candidate = root.join("aiia-update-helper.exe");
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }
    let bundled = update_helper_dir().join("aiia-update-helper.exe");
    if bundled.exists() {
        return Some(bundled);
    }
    None
}

#[cfg(windows)]
pub fn launch_msi_install_after_quit(
    installer_path: &Path,
    install_dir: &Path,
    parent_pid: u32,
) -> Result<(), String> {
    let helper = resolve_update_helper_exe().ok_or_else(|| {
        "Update helper not found in app bundle. Reinstall AIIA from the latest release.".to_string()
    })?;

    let msi = installer_path.to_string_lossy().to_string();
    let exe = install_dir.join("AIIA.exe");
    let exe_str = exe.to_string_lossy().to_string();

    append_log(&format!(
        "{} [rust] launching update helper={} msi={msi}",
        chrono::Utc::now().to_rfc3339(),
        helper.display()
    ));

    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    Command::new(&helper)
        .args([
            "--parent-pid",
            &parent_pid.to_string(),
            "--msi",
            &msi,
            "--exe",
            &exe_str,
            "--wait-secs",
            "180",
        ])
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|e| format!("Could not launch update helper: {e}"))?;

    Ok(())
}

#[cfg(target_os = "macos")]
pub fn launch_dmg_install_after_quit(
    dmg_path: &Path,
    app_path: &Path,
    parent_pid: u32,
) -> Result<(), String> {
    let dmg = dmg_path.to_string_lossy();
    let app = app_path.to_string_lossy();
    let script = format!(
        r#"#!/bin/bash
set -e
LOG="$HOME/Library/Application Support/AIIA/update-install.log"
echo "$(date -Iseconds) [{mark}] DMG deferred pid=$$ parent={parent_pid}" >> "$LOG"
if [ {parent_pid} -gt 0 ]; then
  for i in $(seq 1 180); do
    kill -0 {parent_pid} 2>/dev/null || break
    sleep 0.4
  done
fi
for i in $(seq 1 90); do
  pgrep -f "AIIA.app/Contents/MacOS" >/dev/null || break
  sleep 0.5
done
MOUNT=$(hdiutil attach -nobrowse -quiet "{dmg}" | tail -1 | awk '{{print $NF}}')
cp -R "$MOUNT/AIIA.app" "{app}" 2>/dev/null || cp -R "$MOUNT/"*.app "{app}/.." 2>/dev/null || true
hdiutil detach "$MOUNT" -quiet || true
sleep 2
open -a "{app}"
sleep 4
if ! pgrep -f "AIIA.app/Contents/MacOS" >/dev/null; then
  open -n -a "{app}"
fi
echo "$(date -Iseconds) DMG install complete" >> "$LOG"
rm -f "$0"
"#,
        mark = UPDATE_HELPER_MARK,
    );

    let dir = update_helper_dir();
    let _ = std::fs::create_dir_all(&dir);
    let script_path = dir.join("run-dmg-after-quit.sh");
    std::fs::write(&script_path, script.trim()).map_err(|e| e.to_string())?;

    #[allow(unused_mut)]
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = std::fs::metadata(&script_path) {
        let mut perms = meta.permissions();
        perms.set_mode(0o755);
        let _ = std::fs::set_permissions(&script_path, perms);
    }

    Command::new("nohup")
        .args(["/bin/bash", &script_path.to_string_lossy()])
        .spawn()
        .map_err(|e| format!("Could not launch update helper: {e}"))?;
    Ok(())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn launch_msi_install_after_quit(
    _installer_path: &Path,
    _install_dir: &Path,
    _parent_pid: u32,
) -> Result<(), String> {
    Err("Updates are not supported on this platform".to_string())
}

pub fn resolve_install_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            return parent.to_path_buf();
        }
    }
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Programs")
        .join("AIIA")
}

#[cfg(target_os = "macos")]
pub fn resolve_macos_app_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        let mut path = exe;
        for _ in 0..5 {
            if path.extension().and_then(|e| e.to_str()) == Some("app") {
                return path;
            }
            if !path.pop() {
                break;
            }
        }
    }
    PathBuf::from("/Applications/AIIA.app")
}
