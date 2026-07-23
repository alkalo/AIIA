use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio_cron_scheduler::{Job, JobScheduler};

use crate::db::Database;
use crate::error::{CoreError, Result};

pub type RunCallback = Arc<dyn Fn(String) + Send + Sync>;

#[derive(Clone)]
pub struct RunnerSpawnConfig {
    pub node_exe: PathBuf,
    pub cwd: PathBuf,
    pub playwright_browsers_path: Option<PathBuf>,
}

pub struct AgentScheduler {
    scheduler: JobScheduler,
    db: Arc<Database>,
    on_run: RunCallback,
    runner_path: PathBuf,
}

impl AgentScheduler {
    pub async fn new(
        db: Arc<Database>,
        on_run: RunCallback,
        runner_path: PathBuf,
    ) -> Result<Self> {
        let scheduler = JobScheduler::new()
            .await
            .map_err(|e| CoreError::Scheduler(e.to_string()))?;
        Ok(Self {
            scheduler,
            db,
            on_run,
            runner_path,
        })
    }

    pub async fn start(&self) -> Result<()> {
        self.scheduler
            .start()
            .await
            .map_err(|e| CoreError::Scheduler(e.to_string()))?;
        Ok(())
    }

    pub async fn schedule_check(&self) -> Result<()> {
        let db = self.db.clone();
        let on_run = self.on_run.clone();

        let job = Job::new_async("0 */1 * * * *", move |_uuid, _l| {
            let db = db.clone();
            let on_run = on_run.clone();
            Box::pin(async move {
                if let Ok(agents) = db.get_due_local_agents() {
                    for agent in agents {
                        on_run(agent.id.clone());
                    }
                }
            })
        })
        .map_err(|e| CoreError::Scheduler(e.to_string()))?;

        self.scheduler
            .add(job)
            .await
            .map_err(|e| CoreError::Scheduler(e.to_string()))?;
        Ok(())
    }

    pub fn runner_path(&self) -> &PathBuf {
        &self.runner_path
    }
}

pub fn resolve_node_executable() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(output) = std::process::Command::new("where")
            .arg("node")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let candidate = PathBuf::from(line.trim());
                    if candidate.exists() {
                        return candidate;
                    }
                }
            }
        }

        let mut candidates = vec![
            PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
            PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
        ];

        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            candidates.push(local.join("fnm").join("aliases").join("default").join("node.exe"));
            candidates.push(
                local
                    .join("Programs")
                    .join("fnm")
                    .join("aliases")
                    .join("default")
                    .join("node.exe"),
            );
        }

        if let Ok(appdata) = std::env::var("APPDATA") {
            let nvm_home = PathBuf::from(appdata).join("nvm");
            if let Ok(current) = std::env::var("NVM_SYMLINK") {
                candidates.push(PathBuf::from(current).join("node.exe"));
            }
            if let Ok(node_version) = std::fs::read_to_string(nvm_home.join("alias").join("default"))
            {
                let version = node_version.trim();
                candidates.push(nvm_home.join(version).join("node.exe"));
            }
        }

        for candidate in candidates {
            if candidate.exists() {
                return candidate;
            }
        }
    }

    #[cfg(not(windows))]
    {
        if let Ok(output) = std::process::Command::new("which")
            .arg("node")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    let candidate = PathBuf::from(line.trim());
                    if candidate.exists() {
                        return candidate;
                    }
                }
            }
        }

        let mut candidates = vec![
            PathBuf::from("/usr/local/bin/node"),
            PathBuf::from("/opt/homebrew/bin/node"),
        ];

        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            candidates.push(home.join(".fnm").join("aliases").join("default").join("bin").join("node"));
            let nvm_dir = home.join(".nvm");
            if let Ok(node_version) = std::fs::read_to_string(nvm_dir.join("alias").join("default")) {
                let version = node_version.trim();
                candidates.push(nvm_dir.join("versions").join("node").join(version).join("bin").join("node"));
            }
        }

        for candidate in candidates {
            if candidate.exists() {
                return candidate;
            }
        }
    }

    PathBuf::from("node")
}

fn augment_path_with_node(node_exe: &Path) -> Option<String> {
    let node_dir = node_exe.parent()?;
    let node_dir = node_dir.to_string_lossy();
    let separator = if cfg!(windows) { ';' } else { ':' };
    match std::env::var("PATH") {
        Ok(path) if path.split(separator).any(|entry| entry == node_dir) => None,
        Ok(path) => Some(format!("{node_dir}{separator}{path}")),
        Err(_) => Some(node_dir.to_string()),
    }
}

fn configure_runner_command(
    cmd: &mut std::process::Command,
    config: &RunnerSpawnConfig,
) {
    cmd.current_dir(&config.cwd);
    if let Some(path) = augment_path_with_node(&config.node_exe) {
        cmd.env("PATH", path);
    }
    if let Some(pw) = &config.playwright_browsers_path {
        cmd.env("PLAYWRIGHT_BROWSERS_PATH", pw);
    }
}

pub fn spawn_credential_runner(
    runner_path: &PathBuf,
    config: &RunnerSpawnConfig,
    site_id: &str,
    login_url: &str,
    username: &str,
    password: &str,
    data_dir: &PathBuf,
) -> Result<std::process::Output> {
    if !runner_path.exists() {
        return Err(CoreError::InvalidState(format!(
            "Credential runner not found at {}",
            runner_path.display()
        )));
    }

    let mut cmd = std::process::Command::new(&config.node_exe);
    configure_runner_command(&mut cmd, config);
    let output = cmd
        .arg(runner_path)
        .arg("--site-id")
        .arg(site_id)
        .arg("--login-url")
        .arg(login_url)
        .arg("--username")
        .arg(username)
        .arg("--password")
        .arg(password)
        .arg("--data-dir")
        .arg(data_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()?;
    Ok(output)
}

pub fn spawn_agent_runner(
    runner_path: &PathBuf,
    config: &RunnerSpawnConfig,
    agent_id: &str,
    effort: &str,
    data_dir: &PathBuf,
    run_id: &str,
    extra_env: &[(&str, String)],
) -> Result<std::process::Child> {
    if !runner_path.exists() {
        return Err(CoreError::InvalidState(format!(
            "Agent runner not found at {}. Reinstala AIIA o ejecuta desde el repositorio en modo desarrollo.",
            runner_path.display()
        )));
    }

    if config.node_exe != PathBuf::from("node") && !config.node_exe.exists() {
        return Err(CoreError::InvalidState(
            "Node.js no encontrado. Instala Node.js 20+ desde https://nodejs.org y reinicia AIIA."
                .to_string(),
        ));
    }

    let mut cmd = std::process::Command::new(&config.node_exe);
    configure_runner_command(&mut cmd, config);
    for (key, value) in extra_env {
        cmd.env(key, value);
    }
    let child = cmd
        .arg(runner_path)
        .arg("--agent-id")
        .arg(agent_id)
        .arg("--effort")
        .arg(effort)
        .arg("--data-dir")
        .arg(data_dir)
        .arg("--run-id")
        .arg(run_id)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    Ok(child)
}
