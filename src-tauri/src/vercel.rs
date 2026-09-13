use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeployState {
    pub provider: String,
    pub status: String,
    pub live_url: Option<String>,
    pub preview_url: Option<String>,
    pub domain: Option<String>,
    pub last_error: Option<String>,
    pub last_deployed_at: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VercelDeployResult {
    pub ok: bool,
    pub url: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub message: String,
    pub state: ProjectDeployState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VercelSetupStatus {
    pub cli_available: bool,
    pub cli_path: Option<String>,
    pub logged_in_hint: String,
    pub token_configured: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewOpenResult {
    pub ok: bool,
    pub url: String,
    pub message: String,
}

fn deploy_state_dir(project_path: &Path) -> PathBuf {
    project_path.join(".ship-desk")
}

fn deploy_state_path(project_path: &Path) -> PathBuf {
    deploy_state_dir(project_path).join("deploy.json")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn read_deploy_state(project_path: &str) -> Result<ProjectDeployState, String> {
    let path = Path::new(project_path.trim());
    if path.as_os_str().is_empty() || !path.is_dir() {
        return Err("Project folder is not set or does not exist.".to_string());
    }
    let state_path = deploy_state_path(path);
    if !state_path.exists() {
        return Ok(ProjectDeployState {
            provider: "Vercel".to_string(),
            status: "Not deployed".to_string(),
            live_url: None,
            preview_url: None,
            domain: None,
            last_error: None,
            last_deployed_at: None,
        });
    }
    let content = fs::read_to_string(&state_path)
        .map_err(|e| format!("Failed to read deploy state: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse deploy state: {}", e))
}

fn write_deploy_state(project_path: &Path, state: &ProjectDeployState) -> Result<(), String> {
    let dir = deploy_state_dir(project_path);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create .ship-desk: {}", e))?;
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize deploy state: {}", e))?;
    fs::write(deploy_state_path(project_path), json)
        .map_err(|e| format!("Failed to write deploy state: {}", e))
}

fn resolve_vercel_binary() -> Option<String> {
    which::which("vercel")
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

fn extract_https_url(text: &str) -> Option<String> {
    for token in text.split_whitespace() {
        let cleaned = token.trim_matches(|c: char| c == '"' || c == '\'' || c == '`' || c == ',');
        if cleaned.starts_with("https://") {
            return Some(cleaned.to_string());
        }
    }
    None
}

fn pick_production_url(stdout: &str, stderr: &str) -> Option<String> {
    let combined = format!("{}\n{}", stdout, stderr);
    for line in combined.lines() {
        let lower = line.to_lowercase();
        if lower.contains("production:") || lower.contains("ready!") || lower.contains("deployed to") {
            if let Some(url) = extract_https_url(line) {
                return Some(url);
            }
        }
    }
    extract_https_url(&combined)
}

fn run_vercel_deploy(
    project_path: &Path,
    vercel_token: Option<&str>,
) -> Result<(bool, String, String, Option<String>), String> {
    let vercel = resolve_vercel_binary().ok_or_else(|| {
        "Vercel CLI not found. Install it with: npm install -g vercel — then run `vercel login` in Terminal, or add a Vercel token in Ship Desk Settings.".to_string()
    })?;

    let mut cmd = Command::new(&vercel);
    cmd.arg("deploy")
        .arg("--prod")
        .arg("--yes")
        .current_dir(project_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(token) = vercel_token {
        let trimmed = token.trim();
        if !trimmed.is_empty() {
            cmd.env("VERCEL_TOKEN", trimmed);
        }
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run vercel deploy: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        let hint = if stderr.to_lowercase().contains("not logged in")
            || stderr.to_lowercase().contains("no credentials")
            || stdout.to_lowercase().contains("not logged in")
        {
            " Run `vercel login` in Terminal or set a Vercel token in Ship Desk Settings (General → Vercel token)."
        } else {
            ""
        };
        return Err(format!(
            "vercel deploy failed (exit {}).{}{}",
            output.status.code().unwrap_or(-1),
            if stderr.trim().is_empty() {
                String::new()
            } else {
                format!(" {}", stderr.trim())
            },
            hint
        ));
    }

    let url = pick_production_url(&stdout, &stderr);
    Ok((true, stdout, stderr, url))
}

fn open_url_in_browser(url: &str) -> Result<(), String> {
    let target = url.trim();
    if target.is_empty() {
        return Err("No URL to open.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open").arg(target).output();
        return match output {
            Ok(o) if o.status.success() => Ok(()),
            Ok(o) => Err(format!(
                "open failed (exit {})",
                o.status.code().unwrap_or(-1)
            )),
            Err(e) => Err(format!("Failed to launch open: {}", e)),
        };
    }

    #[cfg(target_os = "linux")]
    {
        let output = Command::new("xdg-open").arg(target).output();
        return match output {
            Ok(o) if o.status.success() => Ok(()),
            Ok(o) => Err(format!(
                "xdg-open failed (exit {})",
                o.status.code().unwrap_or(-1)
            )),
            Err(e) => Err(format!("Failed to launch xdg-open: {}", e)),
        };
    }

    #[cfg(target_os = "windows")]
    {
        let output = Command::new("cmd")
            .args(["/C", "start", "", target])
            .output();
        return match output {
            Ok(o) if o.status.success() => Ok(()),
            Ok(o) => Err(format!(
                "start failed (exit {})",
                o.status.code().unwrap_or(-1)
            )),
            Err(e) => Err(format!("Failed to launch browser: {}", e)),
        };
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

fn local_preview_url(project_path: &Path) -> Result<String, String> {
    let index = project_path.join("index.html");
    let has_index = index.is_file();
    let has_pkg = project_path.join("package.json").is_file();

    if has_pkg {
        // Prefer a one-shot production preview when a Node project exists.
        let npx = which::which("npx").map_err(|_| {
            "Node.js/npx is required for preview. Install Node.js 22+, or deploy with Ship first.".to_string()
        })?;
        let mut cmd = Command::new(&npx);
        cmd.args(["--yes", "serve", "-l", "3456", "-s", "."])
            .current_dir(project_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        let _child = cmd.spawn().map_err(|e| format!("Failed to start preview server: {}", e))?;
        return Ok("http://localhost:3456".to_string());
    }

    if has_index {
        let python = which::which("python3")
            .or_else(|_| which::which("python"))
            .map_err(|_| "Python 3 is required to preview static files.".to_string())?;
        let mut cmd = Command::new(&python);
        cmd.args(["-m", "http.server", "3456"])
            .current_dir(project_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }

        let _child = cmd.spawn().map_err(|e| format!("Failed to start preview server: {}", e))?;
        return Ok("http://localhost:3456".to_string());
    }

    Err(
        "No preview target found. Ask the agent to add index.html or a package.json, then try Preview again."
            .to_string(),
    )
}

#[tauri::command]
pub async fn get_project_deploy_state(project_path: String) -> Result<ProjectDeployState, String> {
    tokio::task::spawn_blocking(move || read_deploy_state(&project_path))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn get_vercel_setup_status(vercel_token: Option<String>) -> Result<VercelSetupStatus, String> {
    let token_configured = vercel_token
        .as_deref()
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);
    let cli_path = resolve_vercel_binary();
    Ok(VercelSetupStatus {
        cli_available: cli_path.is_some(),
        cli_path,
        logged_in_hint: "Run `vercel login` in Terminal, or save a token from vercel.com/account/tokens in Settings.".to_string(),
        token_configured,
    })
}

#[tauri::command]
pub async fn vercel_ship_project(
    project_path: String,
    vercel_token: Option<String>,
) -> Result<VercelDeployResult, String> {
    tokio::task::spawn_blocking(move || {
        let path = Path::new(project_path.trim());
        if path.as_os_str().is_empty() || !path.is_dir() {
            return Err("Open a project folder before shipping.".to_string());
        }

        let token = vercel_token.as_deref().filter(|t| !t.trim().is_empty());
        let (ok, stdout, stderr, url) = run_vercel_deploy(path, token)?;

        let mut state = read_deploy_state(project_path.trim()).unwrap_or_default();
        state.provider = "Vercel".to_string();
        if let Some(live) = url.clone() {
            state.status = "Ready".to_string();
            state.live_url = Some(live.clone());
            state.preview_url = Some(live);
            state.last_error = None;
            state.last_deployed_at = Some(now_ms());
        } else {
            state.status = "Deployed".to_string();
            state.last_error = Some(
                "Deploy finished but no URL was parsed from Vercel output. Check vercel.com dashboard."
                    .to_string(),
            );
        }
        write_deploy_state(path, &state)?;

        Ok(VercelDeployResult {
            ok,
            url,
            stdout,
            stderr,
            message: if state.live_url.is_some() {
                "Shipped to Vercel.".to_string()
            } else {
                state
                    .last_error
                    .clone()
                    .unwrap_or_else(|| "Deploy finished.".to_string())
            },
            state,
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn open_project_preview(
    project_path: String,
    prefer_live: Option<bool>,
) -> Result<PreviewOpenResult, String> {
    tokio::task::spawn_blocking(move || {
        let path = Path::new(project_path.trim());
        if path.as_os_str().is_empty() || !path.is_dir() {
            return Err("Open a project folder before previewing.".to_string());
        }

        let state = read_deploy_state(project_path.trim()).unwrap_or_default();
        let use_live = prefer_live.unwrap_or(true);
        if use_live {
            if let Some(url) = state.live_url.or(state.preview_url) {
                open_url_in_browser(&url)?;
                return Ok(PreviewOpenResult {
                    ok: true,
                    url,
                    message: "Opened live preview.".to_string(),
                });
            }
        }

        let url = local_preview_url(path)?;
        open_url_in_browser(&url)?;
        Ok(PreviewOpenResult {
            ok: true,
            url,
            message: "Opened local preview (localhost:3456).".to_string(),
        })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || open_url_in_browser(&url))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}
