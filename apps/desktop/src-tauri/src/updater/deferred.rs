//! Instalación diferida tras cerrar la app (patrón QALab).

use std::path::{Path, PathBuf};
use std::process::Command;

use super::config::{update_helper_dir, update_install_log_path, UPDATE_HELPER_MARK};

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

fn write_script(filename: &str, content: &str) -> PathBuf {
    let dir = update_helper_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join(filename);
    std::fs::write(&path, content.trim()).unwrap_or_default();
    path
}

fn resolve_powershell() -> String {
    if let Ok(path) = std::env::var("ProgramFiles") {
        let pwsh = PathBuf::from(&path)
            .join("PowerShell")
            .join("7")
            .join("pwsh.exe");
        if pwsh.exists() {
            return pwsh.to_string_lossy().to_string();
        }
    }
    "powershell.exe".to_string()
}

fn resolve_wscript() -> PathBuf {
    let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
    PathBuf::from(windir).join("System32").join("wscript.exe")
}

fn build_stop_aiia_ps() -> &'static str {
    r#"
function Get-AIIARootCandidates {
  param([string]$RootDir)
  $roots = @()
  if ($RootDir) { $roots += $RootDir }
  $roots += (Join-Path $env:LOCALAPPDATA 'AIIA')
  $roots += (Join-Path $env:LOCALAPPDATA 'Programs\AIIA')
  $roots += '/Applications/AIIA.app'
  return @($roots | Where-Object { $_ } | Select-Object -Unique)
}

function Test-AIIAProcessMatch {
  param(
    [int]$ProcessId = 0,
    [string]$Name,
    [string]$Path,
    [string]$CommandLine,
    [string[]]$RootDirs,
    [int[]]$ExcludeProcessIds = @()
  )
  if ($ProcessId -gt 0 -and $ExcludeProcessIds -contains $ProcessId) { return $false }
  $procName = ($Name -replace '\.exe$','')
  if ($procName -ieq 'powershell' -or $procName -ieq 'pwsh' -or $procName -ieq 'cmd') {
    if ($CommandLine -match 'run-msi-after-quit\.ps1|AIIAUpdateHelper|aiia-upd-') { return $false }
  }
  if ($procName -ieq 'wscript' -or $procName -ieq 'cscript') {
    if ($CommandLine -match 'AIIAUpdateHelper|launch-update-helper\.vbs|aiia-upd-') { return $false }
  }
  if ($procName -ieq 'AIIA' -or $procName -ieq 'aiia-desktop') { return $true }
  foreach ($root in $RootDirs) {
    if ($Path -and $Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    if ($CommandLine -and ($CommandLine -like "*$root*")) { return $true }
  }
  if ($Path -and ($Path -match '[\\/]AIIA[\\/]' -or $Path -match 'runner-bundle')) { return $true }
  if ($CommandLine -and ($CommandLine -match 'AIIA|aiia-desktop|agent-runner|credential-runner|@aiia')) { return $true }
  $childNames = @('node','cmd','conhost')
  if ($childNames -contains $procName) {
    if ($Path -and ($Path -match 'AIIA|runner-bundle|@aiia')) { return $true }
    if ($CommandLine -and ($CommandLine -match 'AIIA|agent-runner|credential-runner|@aiia')) { return $true }
  }
  return $false
}

function Get-AIIARelatedProcessIds {
  param([string]$RootDir, [int[]]$ExcludeProcessIds = @())
  $ids = @()
  $roots = Get-AIIARootCandidates -RootDir $RootDir
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    if (Test-AIIAProcessMatch -ProcessId $_.ProcessId -Name $_.Name -Path $_.ExecutablePath -CommandLine $_.CommandLine -RootDirs $roots -ExcludeProcessIds $ExcludeProcessIds) {
      $ids += $_.ProcessId
    }
  }
  return @($ids | Select-Object -Unique)
}

function Stop-AIIAProcessId {
  param([int]$ProcessId)
  if ($ProcessId -le 0) { return }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  $null = Start-Process -FilePath "$env:WINDIR\System32\taskkill.exe" -ArgumentList @('/PID', $ProcessId, '/T', '/F') -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue
}

function Stop-AIIATree {
  param([string]$RootDir, [int[]]$ExcludeProcessIds = @())
  foreach ($procId in (Get-AIIARelatedProcessIds -RootDir $RootDir -ExcludeProcessIds $ExcludeProcessIds)) {
    Stop-AIIAProcessId -ProcessId $procId
  }
  Get-Process -Name AIIA -ErrorAction SilentlyContinue | ForEach-Object {
    if ($ExcludeProcessIds -notcontains $_.Id) { Stop-AIIAProcessId -ProcessId $_.Id }
  }
}

function Test-AIIAProcessesRemaining {
  param([string]$RootDir, [int[]]$ExcludeProcessIds = @())
  return (Get-AIIARelatedProcessIds -RootDir $RootDir -ExcludeProcessIds $ExcludeProcessIds).Count -gt 0
}

function Wait-AIIAExit {
  param([string]$RootDir, [int]$TimeoutSec = 90, [int[]]$ExcludeProcessIds = @())
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    Stop-AIIATree -RootDir $RootDir -ExcludeProcessIds $ExcludeProcessIds
    if (-not (Test-AIIAProcessesRemaining -RootDir $RootDir -ExcludeProcessIds $ExcludeProcessIds)) {
      Start-Sleep -Milliseconds 800
      if (-not (Test-AIIAProcessesRemaining -RootDir $RootDir -ExcludeProcessIds $ExcludeProcessIds)) { return $true }
    }
    Start-Sleep -Milliseconds 500
  }
  Stop-AIIATree -RootDir $RootDir -ExcludeProcessIds $ExcludeProcessIds
  return -not (Test-AIIAProcessesRemaining -RootDir $RootDir -ExcludeProcessIds $ExcludeProcessIds)
}

function Resolve-AIIAExe {
  param([string]$InstallDir)
  $candidates = @()
  if ($InstallDir) { $candidates += (Join-Path $InstallDir 'AIIA.exe') }
  $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\AIIA\AIIA.exe')
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Test-AIIAMainProcessRunning {
  foreach ($proc in (Get-CimInstance Win32_Process -Filter "Name='AIIA.exe'" -ErrorAction SilentlyContinue)) {
    return $true
  }
  return $false
}

function Start-AIIAApp {
  param([string]$ExePath, [int]$Retries = 8, [int[]]$ExcludeProcessIds = @())
  if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath)) { return $false }
  $dir = Split-Path -Parent $ExePath
  for ($i = 0; $i -lt $Retries; $i++) {
    if ($i -gt 0) {
      Stop-AIIATree -RootDir $dir -ExcludeProcessIds $ExcludeProcessIds
      Start-Sleep -Milliseconds 800
    }
    Start-Process -FilePath $ExePath -WorkingDirectory $dir -WindowStyle Normal
    Start-Sleep -Seconds 6
    if (Test-AIIAMainProcessRunning) { return $true }
  }
  return $false
}

function Show-AIIARestartFailure {
  param([string]$ExePath)
  try {
    $ws = New-Object -ComObject WScript.Shell
    $null = $ws.Popup("Update installed, but AIIA could not restart automatically. Open AIIA manually from: $ExePath", 0, "AIIA update", 48)
  } catch {}
}

function Start-AIIARelaunchWatchdog {
  param([string]$ExePath, [int]$DelaySec = 12, [int]$MaxWaitSec = 180)
  if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath)) { return $false }
  $vbsPath = Join-Path $env:TEMP ("aiia-watch-" + [Guid]::NewGuid().ToString('N').Substring(0, 10) + ".vbs")
  $escapedExe = $ExePath.Replace('"', '""')
  $content = @"
' AIIAUpdateHelper relaunch watchdog
Function TestMainRunning()
  TestMainRunning = False
  Set procs = GetObject("winmgmts:").ExecQuery("SELECT Name FROM Win32_Process WHERE Name='AIIA.exe'")
  If procs.Count > 0 Then TestMainRunning = True
End Function
WScript.Sleep $($DelaySec * 1000)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
exe = "$escapedExe"
deadline = DateAdd("s", $MaxWaitSec, Now)
Do While Now < deadline
  If Not fso.FileExists(exe) Then Exit Do
  If TestMainRunning() Then Exit Do
  WScript.Sleep 3000
Loop
If fso.FileExists(exe) Then
  If Not TestMainRunning() Then sh.Run Chr(34) & exe & Chr(34), 1, False
End If
On Error Resume Next
fso.DeleteFile WScript.ScriptFullName, True
"@
  Set-Content -LiteralPath $vbsPath -Value $content -Encoding ASCII
  Start-Process -FilePath "$env:WINDIR\System32\wscript.exe" -ArgumentList @('//B','//Nologo',$vbsPath) -WindowStyle Hidden
  return $true
}

function Wait-AIIARunning {
  param([int]$TimeoutSec = 60, [int]$StableChecks = 3)
  $stable = 0
  for ($w = 0; $w -lt $TimeoutSec; $w++) {
    if (Test-AIIAMainProcessRunning) {
      $stable++
      if ($stable -ge $StableChecks) { return $true }
    } else { $stable = 0 }
    Start-Sleep -Seconds 1
  }
  return $false
}
"#
}

#[cfg(windows)]
pub fn launch_msi_install_after_quit(
    installer_path: &Path,
    install_dir: &Path,
    parent_pid: u32,
) -> Result<(), String> {
    let installer = installer_path.to_string_lossy().replace('\'', "''");
    let install_dir = install_dir.to_string_lossy().replace('\'', "''");
    let script = format!(
        r#"
param()
{stop_fn}
$updaterPid = $PID
$installer = '{installer}'
$installDir = '{install_dir}'
$parentPid = {parent_pid}
$log = Join-Path (Join-Path $env:APPDATA 'AIIA') 'update-install.log'
"$(Get-Date -Format o) [{mark}] MSI deferred pid=$PID parent=$parentPid" | Out-File -LiteralPath $log -Append -Encoding utf8
if ($parentPid -gt 0) {{
  $deadline = (Get-Date).AddSeconds(180)
  while ((Get-Date) -lt $deadline -and (Get-Process -Id $parentPid -ErrorAction SilentlyContinue)) {{ Start-Sleep -Milliseconds 400 }}
}}
$ready = Wait-AIIAExit -RootDir $installDir -TimeoutSec 90 -ExcludeProcessIds @($updaterPid)
"$(Get-Date -Format o) AIIA exited=$ready; MSI: $installer" | Out-File -LiteralPath $log -Append -Encoding utf8
$exe = Resolve-AIIAExe -InstallDir $installDir
if ($exe) {{ Start-AIIARelaunchWatchdog -ExePath $exe -DelaySec 12 -MaxWaitSec 180 }}
$proc = Start-Process -FilePath "$env:WINDIR\System32\msiexec.exe" -ArgumentList @('/i', $installer, '/qn', '/norestart') -PassThru -Wait
$exitCode = if ($proc) {{ $proc.ExitCode }} else {{ -1 }}
"$(Get-Date -Format o) MSI exit: $exitCode" | Out-File -LiteralPath $log -Append -Encoding utf8
if (Wait-AIIARunning -TimeoutSec 60 -StableChecks 3) {{
  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
  exit 0
}}
if ($exe) {{
  $started = Start-AIIAApp -ExePath $exe -ExcludeProcessIds @($updaterPid)
  if (-not $started) {{ Show-AIIARestartFailure -ExePath $exe }}
}}
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
"#,
        stop_fn = build_stop_aiia_ps(),
        mark = UPDATE_HELPER_MARK,
    );

    let script_path = write_script("run-msi-after-quit.ps1", &script);
    launch_deferred_powershell(&script_path)
}

#[cfg(windows)]
fn launch_deferred_powershell(script_path: &Path) -> Result<(), String> {
    let ps = resolve_powershell();
    let args = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
        &script_path.to_string_lossy(),
    ];

    let command = format!(
        "\"{}\" {}",
        ps,
        args.iter()
            .map(|a| format!("\"{}\"", a.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" ")
    );

    let vbs = format!(
        r#"' {UPDATE_HELPER_MARK} deferred launcher
Set sh = CreateObject("WScript.Shell")
sh.Run "{cmd}", 0, False
On Error Resume Next
Set fso = CreateObject("Scripting.FileSystemObject")
fso.DeleteFile WScript.ScriptFullName, True
"#,
        cmd = command.replace('"', "\"\""),
    );

    let vbs_path = write_script("launch-update-helper.vbs", &vbs);
    append_log(&format!(
        "{} [rust] launching deferred update vbs={}",
        chrono::Utc::now().to_rfc3339(),
        vbs_path.display()
    ));

    let wscript = resolve_wscript();
    let status = Command::new(&wscript)
        .args(["//B", "//Nologo", &vbs_path.to_string_lossy()])
        .spawn()
        .map_err(|e| format!("Could not launch update helper: {e}"))?;

    drop(status);
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
echo "$(date -Iseconds) [AIIAUpdateHelper] DMG deferred pid=$$ parent={parent_pid}" >> "$LOG"
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
open -a "{app}"
echo "$(date -Iseconds) DMG install complete" >> "$LOG"
rm -f "$0"
"#,
    );

    let script_path = write_script("run-dmg-after-quit.sh", &script);
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
