pub fn compare_versions(a: &str, b: &str) -> i32 {
    let parse = |v: &str| -> Vec<u32> {
        v.trim_start_matches('v')
            .split('.')
            .map(|n| n.parse::<u32>().unwrap_or(0))
            .collect()
    };
    let pa = parse(a);
    let pb = parse(b);
    let len = pa.len().max(pb.len());
    for i in 0..len {
        let da = *pa.get(i).unwrap_or(&0);
        let db = *pb.get(i).unwrap_or(&0);
        if da > db {
            return 1;
        }
        if da < db {
            return -1;
        }
    }
    0
}

pub fn truncate_release_notes(body: &str, max_len: usize) -> String {
    let text = body.trim();
    if text.is_empty() {
        return String::new();
    }
    if text.len() <= max_len {
        return text.to_string();
    }
    format!("{}…", text[..max_len].trim())
}

pub fn is_feed_not_found(err: &str) -> bool {
    err.contains("404") || err.to_lowercase().contains("no releases")
}

pub fn is_packaged() -> bool {
    if cfg!(debug_assertions) {
        return false;
    }
    if let Ok(exe) = std::env::current_exe() {
        let path = exe.to_string_lossy().to_lowercase();
        return !path.contains("\\target\\") && !path.contains("/target/");
    }
    true
}

/// Prefer Tauri package version (from tauri.conf.json). Cargo.toml must stay in sync too.
pub fn current_app_version(app: Option<&tauri::AppHandle>) -> String {
    if let Some(app) = app {
        return app.package_info().version.to_string();
    }
    env!("CARGO_PKG_VERSION").to_string()
}
