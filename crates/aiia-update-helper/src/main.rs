//! Waits for the parent AIIA process, installs an MSI, then relaunches the app.
//! Bundled with AIIA to avoid PowerShell-based update scripts (AV-friendly).

use std::env;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

fn usage() -> ! {
    eprintln!(
        "Usage: aiia-update-helper --parent-pid PID --msi PATH --exe PATH [--wait-secs SECS]"
    );
    std::process::exit(2);
}

fn parse_args() -> (u32, String, String, u64) {
    let mut parent_pid: Option<u32> = None;
    let mut msi = None;
    let mut exe = None;
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
            "--wait-secs" => {
                i += 1;
                wait_secs = args.get(i).and_then(|s| s.parse().ok()).unwrap_or(180);
            }
            _ => {}
        }
        i += 1;
    }
    let parent = parent_pid.filter(|p| *p > 0).unwrap_or_else(|| usage());
    let msi = msi.unwrap_or_else(|| usage());
    let exe = exe.unwrap_or_else(|| usage());
    (parent, msi, exe, wait_secs)
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

fn wait_for_parent(pid: u32, max_secs: u64) {
    let deadline = Duration::from_secs(max_secs);
    let start = std::time::Instant::now();
    while start.elapsed() < deadline && is_process_running(pid) {
        thread::sleep(Duration::from_millis(400));
    }
    thread::sleep(Duration::from_secs(2));
}

#[cfg(windows)]
fn run_msi(msi: &Path) -> i32 {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let windir = env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
    let msiexec = Path::new(&windir).join("System32").join("msiexec.exe");
    Command::new(msiexec)
        .args([
            "/i",
            &msi.to_string_lossy(),
            "/passive",
            "/norestart",
            "REBOOT=ReallySuppress",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map(|s| s.code().unwrap_or(-1))
        .unwrap_or(-1)
}

#[cfg(not(windows))]
fn run_msi(_msi: &Path) -> i32 {
    -1
}

fn relaunch(exe: &Path) -> bool {
    if !exe.exists() {
        return false;
    }
    let dir = exe.parent().unwrap_or_else(|| Path::new("."));
    for attempt in 0..8 {
        if attempt > 0 {
            thread::sleep(Duration::from_secs(2));
        }
        if Command::new(exe)
            .current_dir(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .is_ok()
        {
            thread::sleep(Duration::from_secs(3));
            return true;
        }
    }
    false
}

fn main() {
    let (parent_pid, msi, exe, wait_secs) = parse_args();
    wait_for_parent(parent_pid, wait_secs);
    let code = run_msi(Path::new(&msi));
    eprintln!("aiia-update-helper: msiexec exit {code}");
    thread::sleep(Duration::from_secs(3));
    if !relaunch(Path::new(&exe)) {
        eprintln!("aiia-update-helper: failed to relaunch {}", exe);
        std::process::exit(1);
    }
}
