pub const GITHUB_OWNER: &str = "alkalo";
pub const GITHUB_REPO: &str = "AIIA";
pub const MANIFEST_FILE_NAME: &str = "release-manifest.json";
pub const AUTO_UPDATE_SETTING_KEY: &str = "auto_update_on_startup";
pub const UPDATE_HELPER_MARK: &str = "AIIAUpdateHelper";

pub fn github_owner() -> String {
    std::env::var("AIIA_GITHUB_OWNER").unwrap_or_else(|_| GITHUB_OWNER.to_string())
}

pub fn github_repo() -> String {
    std::env::var("AIIA_GITHUB_REPO").unwrap_or_else(|_| GITHUB_REPO.to_string())
}

pub fn app_data_dir() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("AIIA")
}

pub fn update_cache_dir() -> std::path::PathBuf {
    app_data_dir().join("cache")
}

pub fn update_helper_dir() -> std::path::PathBuf {
    app_data_dir().join("update-helper")
}

pub fn update_install_log_path() -> std::path::PathBuf {
    app_data_dir().join("update-install.log")
}
