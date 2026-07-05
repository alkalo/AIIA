use std::path::PathBuf;
use std::sync::Arc;

use tokio_cron_scheduler::{Job, JobScheduler};

use crate::db::Database;
use crate::error::{CoreError, Result};

pub type RunCallback = Arc<dyn Fn(String) + Send + Sync>;

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
                if let Ok(agents) = db.get_due_agents() {
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

pub fn spawn_credential_runner(
    runner_path: &PathBuf,
    site_id: &str,
    login_url: &str,
    username: &str,
    password: &str,
    data_dir: &PathBuf,
) -> Result<std::process::Output> {
    let output = std::process::Command::new("node")
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
    agent_id: &str,
    effort: &str,
    data_dir: &PathBuf,
    run_id: &str,
) -> Result<std::process::Child> {
    let child = std::process::Command::new("node")
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
        .stderr(std::process::Stdio::inherit())
        .spawn()?;
    Ok(child)
}
