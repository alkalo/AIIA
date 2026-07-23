//! Waits for the parent AIIA process, installs an MSI (elevated), then relaunches the app.
//! Bundled with AIIA to avoid PowerShell-based update scripts (AV-friendly).
//! Must be copied out of Program Files before running so msiexec can replace files there.
//!
//! Important: never pass INSTALLDIR=C:\Program Files\... as a bare argv token — msiexec
//! re-parses its command line and treats the space as a separator, which drops `/i` and
//! shows the Windows Installer help screen instead of installing.

use std::env;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, SystemTime};

fn usage() -> ! {
    eprintln!(
        "Usage: aiia-update-helper --parent-pid PID --msi PATH --exe PATH [--install-dir PATH] [--log PATH] [--wait-secs SECS]"
    );
    std::process::exit(2);
}

fn parse_args() -> (u32, String, String, Option<String>, Option<PathBuf>, u64) {
    let mut parent_pid: Option<u32> = None;
    let mut msi = None;
    let mut exe = None;
    let mut install_dir = None;
    let mut log_path = None;
    let mut wait_secs: u64 = 180;
    let args: Vec<String> = env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--parent-pid" => {
                i += 1;
                parent_pid = Some(args.get(i).and_then(|s| s.parse().ok()).unwrap_or(0));
            }
            "--msi" => {
                i += 1;
                msi = args.get(i).cloned();
            }
            "--exe" => {
                i += 1;
                exe = args.get(i).cloned();
            }
            "--install-dir" => {
                i += 1;
                install_dir = args.get(i).cloned();
            }
            "--log" => {
                i += 1;
                log_path = args.get(i).map(PathBuf::from);
            }
            "--wait-secs" => {
                i += 1;
                wait_secs = args.get(i).and_then(|s| s.parse().ok()).unwrap_or(180);
            }
            _ => {}
        }
        i += 1;
    }
    let parent = parent_pid.filter(|p| *p > 0).unwrap_or_else(|| usage());
    let msi = msi.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| usage());
    let exe = exe.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| usage());
    (parent, msi, exe, install_dir, log_path, wait_secs)
}

fn now_stamp() -> String {
    let secs = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("unix:{secs}")
}

fn append_log(log_path: &Option<PathBuf>, line: &str) {
    let Some(path) = log_path else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

#[cfg(windows)]
fn is_process_running(pid: u32) -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| {
            let out = String::from_utf8_lossy(&o.stdout);
            out.contains(&pid.to_string())
        })
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_process_running(_pid: u32) -> bool {
    false
}

fn wait_for_parent(pid: u32, max_secs: u64, log_path: &Option<PathBuf>) {
    append_log(
        log_path,
        &format!(
            "{} [helper] waiting for parent pid={pid} (max {max_secs}s)",
            now_stamp()
        ),
    );
    let deadline = Duration::from_secs(max_secs);
    let start = std::time::Instant::now();
    while start.elapsed() < deadline && is_process_running(pid) {
        thread::sleep(Duration::from_millis(400));
    }
    thread::sleep(Duration::from_secs(3));
    append_log(
        log_path,
        &format!("{} [helper] parent exited (or wait timed out)", now_stamp()),
    );
}

/// Escape a path for embedding inside double quotes on a Windows command line.
fn quote_win(path: &str) -> String {
    format!("\"{}\"", path.replace('"', ""))
}

#[cfg(windows)]
fn run_msi(msi: &Path, install_dir: Option<&str>, log_path: &Option<PathBuf>) -> i32 {
    let windir = env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
    let msiexec = Path::new(&windir).join("System32").join("msiexec.exe");

    if !msi.is_file() {
        append_log(
            log_path,
            &format!(
                "{} [helper] MSI missing or not a file: {}",
                now_stamp(),
                msi.display()
            ),
        );
        return -2;
    }
    let size = msi.metadata().map(|m| m.len()).unwrap_or(0);
    if size < 1_000_000 {
        append_log(
            log_path,
            &format!(
                "{} [helper] MSI suspiciously small ({size} bytes): {}",
                now_stamp(),
                msi.display()
            ),
        );
        return -3;
    }

    let msi_str = msi.to_string_lossy().replace('"', "");
    let msi_log = log_path
        .as_ref()
        .and_then(|p| p.parent().map(|d| d.join("msiexec-update.log")))
        .unwrap_or_else(|| {
            env::temp_dir()
                .join("AIIA-update")
                .join("msiexec-update.log")
        });
    if let Some(parent) = msi_log.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let msi_log_str = msi_log.to_string_lossy().replace('"', "");

    // Single command-line string so spaces in paths stay inside quotes.
    // Do NOT pass INSTALLDIR=C:\Program Files\... as separate argv — msiexec shows /help.
    // Major-upgrade MSI already targets the existing product install location.
    let mut params = format!(
        "/i {} /qb /norestart REBOOT=ReallySuppress /L*v {}",
        quote_win(&msi_str),
        quote_win(&msi_log_str)
    );
    if let Some(dir) = install_dir {
        let dir = dir.replace('"', "");
        // Property value quotes required by MSI when path has spaces.
        params.push_str(&format!(" INSTALLDIR={}", quote_win(&dir)));
    }

    append_log(
        log_path,
        &format!(
            "{} [helper] msiexec {} {}",
            now_stamp(),
            msiexec.display(),
            params
        ),
    );

    use std::os::windows::process::CommandExt;
    // raw_arg: pass the parameter string as msiexec expects (quoted paths intact).
    let code = Command::new(&msiexec)
        .raw_arg(&params)
        .status()
        .map(|s| s.code().unwrap_or(-1))
        .unwrap_or(-1);
    append_log(
        log_path,
        &format!("{} [helper] msiexec exit={code}", now_stamp()),
    );
    code
}

#[cfg(not(windows))]
fn run_msi(_msi: &Path, _install_dir: Option<&str>, _log_path: &Option<PathBuf>) -> i32 {
    -1
}

fn msi_ok(code: i32) -> bool {
    code == 0 || code == 3010
}

fn relaunch(exe: &Path, log_path: &Option<PathBuf>) -> bool {
    if !exe.exists() {
        append_log(
            log_path,
            &format!(
                "{} [helper] exe missing after install: {}",
                now_stamp(),
                exe.display()
            ),
        );
        return false;
    }
    let dir = exe.parent().unwrap_or_else(|| Path::new("."));
    for attempt in 0..10 {
        if attempt > 0 {
            thread::sleep(Duration::from_secs(2));
        }
        append_log(
            log_path,
            &format!(
                "{} [helper] relaunch attempt {} -> {}",
                now_stamp(),
                attempt + 1,
                exe.display()
            ),
        );
        #[cfg(windows)]
        {
            let ok = Command::new("cmd")
                .args(["/C", "start", "", &exe.to_string_lossy()])
                .current_dir(dir)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .is_ok();
            if ok {
                thread::sleep(Duration::from_secs(2));
                append_log(log_path, &format!("{} [helper] relaunch ok", now_stamp()));
                return true;
            }
        }
        #[cfg(not(windows))]
        {
            if Command::new(exe)
                .current_dir(dir)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .is_ok()
            {
                return true;
            }
        }
    }
    append_log(log_path, &format!("{} [helper] relaunch failed", now_stamp()));
    false
}

fn popup_fail(code: i32) {
    #[cfg(windows)]
    {
        let detail = match code {
            -2 => "MSI file missing after download.".to_string(),
            -3 => "MSI download looks incomplete.".to_string(),
            _ => format!("msiexec exit {code}"),
        };
        let msg = format!(
            "javascript:var s=new ActiveXObject('WScript.Shell');s.Popup('AIIA update failed ({detail}). Install manually from GitHub Releases v0.1.26+.',16,'AIIA Update',16);close();",
        );
        let _ = Command::new("mshta").arg(msg).spawn();
    }
    #[cfg(not(windows))]
    {
        let _ = code;
    }
}

fn main() {
    let (parent_pid, msi, exe, install_dir, log_path, wait_secs) = parse_args();
    append_log(
        &log_path,
        &format!(
            "{} [helper] start parent={parent_pid} msi={msi} exe={exe}",
            now_stamp()
        ),
    );
    wait_for_parent(parent_pid, wait_secs, &log_path);
    let code = run_msi(Path::new(&msi), install_dir.as_deref(), &log_path);
    if !msi_ok(code) {
        append_log(
            &log_path,
            &format!(
                "{} [helper] install FAILED exit={code} — not relaunching",
                now_stamp()
            ),
        );
        popup_fail(code);
        std::process::exit(1);
    }
    thread::sleep(Duration::from_secs(2));
    if !relaunch(Path::new(&exe), &log_path) {
        std::process::exit(1);
    }
}
