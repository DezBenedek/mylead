use crate::crawler::CrawledSiteData;
use crate::models::{AiModelOption, AppSettings, EmailMessage, Lead, LocalCliStatus, Offer, Project, SearchJob, SearchJobInput, SearchOptimizationResult, WebsiteAudit};
use chrono::{Datelike, Duration as ChronoDuration, Local, TimeZone, Timelike, Utc};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectAiProfile {
    pub value_proposition: String,
    pub target_audience: String,
    pub pain_points_solved: Vec<String>,
    pub pitch_angles: Vec<String>,
    pub objection_handlers: Vec<String>,
    pub crawled_summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeadAiAnalysis {
    pub fit_score: i64,
    #[serde(default)]
    pub employee_estimate: String,
    #[serde(default)]
    pub company_summary: String,
    #[serde(default)]
    pub pain_points: Vec<String>,
    #[serde(default)]
    pub how_we_can_help: String,
    #[serde(default)]
    pub recommended_pitch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedEmail {
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplyClassification {
    pub intent: String, // interested | booking_request | question | objection | not_interested | out_of_office | unsubscribe
    #[serde(default)]
    pub suggested_reply: String,
    #[serde(default)]
    pub should_include_booking_link: bool,
    #[serde(default)]
    pub summary: String,
}

/// Computes a human-like randomized send timestamp strictly inside configured business hours
/// (default: Monday–Saturday 08:00–18:00 local time, 20–120 minutes after receipt).
/// Returns UTC RFC3339 string.
pub fn compute_random_business_send_time(settings: &AppSettings) -> String {
    let min_delay = settings.auto_reply_min_delay_min.clamp(1, 720);
    let max_delay = settings.auto_reply_max_delay_min.max(min_delay).clamp(min_delay, 1440);
    let start_h = settings.auto_reply_start_hour.min(22) as u32;
    let end_h = settings.auto_reply_end_hour.max((start_h as u8) + 1).min(24) as u32;
    let workdays: Vec<u8> = if settings.auto_reply_workdays.is_empty() {
        vec![1, 2, 3, 4, 5, 6]
    } else {
        settings.auto_reply_workdays.clone()
    };

    // Uniform random offset in [min_delay, max_delay] using UUID v4 randomness
    let bytes = *Uuid::new_v4().as_bytes();
    let rnd_u64 = u64::from_le_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ]);
    let span = (max_delay - min_delay + 1).max(1) as u64;
    let delay_mins = min_delay + (rnd_u64 % span) as i64;
    let extra_secs = (bytes[8] as i64) % 60;

    let now_local = Local::now();
    let candidate = now_local + ChronoDuration::minutes(delay_mins) + ChronoDuration::seconds(extra_secs);

    let is_valid = |dt: chrono::DateTime<Local>| -> bool {
        let wd = dt.weekday().number_from_monday() as u8;
        if !workdays.contains(&wd) {
            return false;
        }
        let h = dt.hour();
        h >= start_h && h < end_h
    };

    if is_valid(candidate) {
        return candidate.with_timezone(&Utc).to_rfc3339();
    }

    // Roll forward to the next valid business day opening + random offset in [min_delay, max_delay]
    let window_mins = ((end_h - start_h) as i64 * 60).max(30);
    let morning_offset = delay_mins.min(window_mins - 5).max(5);

    let mut date = now_local.date_naive();
    // If today is a workday and we haven't reached start_h yet, today is the next business window; otherwise tomorrow.
    let today_wd = date.weekday().number_from_monday() as u8;
    let can_use_today_morning = workdays.contains(&today_wd) && now_local.hour() < start_h;
    if !can_use_today_morning {
        date = date.succ_opt().unwrap_or(date);
    }

    for _ in 0..14 {
        let wd = date.weekday().number_from_monday() as u8;
        if workdays.contains(&wd) {
            if let Some(naive_open) = date.and_hms_opt(start_h, 0, 0) {
                if let Some(open_local) = Local.from_local_datetime(&naive_open).earliest() {
                    let scheduled = open_local
                        + ChronoDuration::minutes(morning_offset)
                        + ChronoDuration::seconds(extra_secs);
                    return scheduled.with_timezone(&Utc).to_rfc3339();
                }
            }
        }
        date = date.succ_opt().unwrap_or(date);
    }

    candidate.with_timezone(&Utc).to_rfc3339()
}

fn enriched_path_env() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let current = std::env::var("PATH").unwrap_or_default();
    let mut parts = vec![
        format!("{}/.opencode/bin", home),
        format!("{}/.local/bin", home),
        format!("{}/.cargo/bin", home),
        format!("{}/.bun/bin", home),
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
    ];
    if !current.is_empty() {
        parts.push(current);
    }
    parts.join(":")
}

pub fn resolve_cli_binary(binary: &str, custom_path: &str) -> Option<PathBuf> {
    let trimmed = custom_path.trim();
    if !trimmed.is_empty() {
        let p = PathBuf::from(trimmed);
        if p.exists() {
            return Some(p);
        }
    }

    let home = std::env::var("HOME").unwrap_or_default();
    let mut candidates = vec![
        PathBuf::from(format!("{}/.opencode/bin/{}", home, binary)),
        PathBuf::from(format!("{}/.local/bin/{}", home, binary)),
        PathBuf::from(format!("/opt/homebrew/bin/{}", binary)),
        PathBuf::from(format!("/usr/local/bin/{}", binary)),
        PathBuf::from(format!("{}/.bun/bin/{}", home, binary)),
        PathBuf::from(format!("{}/.npm-global/bin/{}", home, binary)),
    ];

    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(':') {
            if !dir.is_empty() {
                candidates.push(PathBuf::from(dir).join(binary));
            }
        }
    }

    candidates.into_iter().find(|p| p.exists() && p.is_file())
}

async fn probe_cli(id: &str, name: &str, binary: &str) -> LocalCliStatus {
    match resolve_cli_binary(binary, "") {
        Some(path) => {
            let output = tokio::time::timeout(
                Duration::from_secs(4),
                Command::new(&path)
                    .arg("--version")
                    .env("PATH", enriched_path_env())
                    .output(),
            )
            .await;

            let version = match output {
                Ok(Ok(out)) => {
                    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                    let combined = if !stdout.is_empty() { stdout } else { stderr };
                    combined
                        .lines()
                        .find(|l| !l.trim().is_empty() && !l.to_lowercase().contains("warning"))
                        .unwrap_or("Telepítve")
                        .trim()
                        .to_string()
                }
                _ => "Telepítve".to_string(),
            };

            LocalCliStatus {
                id: id.to_string(),
                name: name.to_string(),
                binary: binary.to_string(),
                installed: true,
                path: path.to_string_lossy().to_string(),
                version,
            }
        }
        None => LocalCliStatus {
            id: id.to_string(),
            name: name.to_string(),
            binary: binary.to_string(),
            installed: false,
            path: String::new(),
            version: "Nem található".to_string(),
        },
    }
}

pub async fn detect_local_clis() -> Vec<LocalCliStatus> {
    let (claude, codex, opencode, ollama) = tokio::join!(
        probe_cli("claude_cli", "Claude Code CLI (Anthropic)", "claude"),
        probe_cli("codex_cli", "Codex CLI (OpenAI)", "codex"),
        probe_cli("opencode_cli", "OpenCode CLI", "opencode"),
        probe_cli("ollama", "Ollama (Lokális)", "ollama"),
    );
    vec![claude, codex, opencode, ollama]
}

pub async fn fetch_provider_models(settings: &AppSettings) -> Result<Vec<AiModelOption>, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    match settings.ai_provider.as_str() {
        "openrouter" => {
            let mut req = client.get("https://openrouter.ai/api/v1/models");
            if !settings.ai_api_key.trim().is_empty() {
                req = req.bearer_auth(settings.ai_api_key.trim());
            }
            let resp = req
                .send()
                .await
                .map_err(|e| format!("OpenRouter modellek lekérési hiba: {}", e))?;
            if !resp.status().is_success() {
                return Err(format!("OpenRouter hiba ({})", resp.status()));
            }
            let v: Value = resp.json().await.map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            if let Some(arr) = v["data"].as_array() {
                for item in arr {
                    if let Some(id) = item["id"].as_str() {
                        let name = item["name"].as_str().unwrap_or(id);
                        out.push(AiModelOption {
                            id: id.to_string(),
                            label: format!("{} ({})", name, id),
                        });
                    }
                }
            }
            out.sort_by(|a, b| a.id.cmp(&b.id));
            Ok(out)
        }
        "opencode_go" => {
            let base = if settings.ai_base_url.trim().is_empty() {
                "https://opencode.ai/zen/go/v1"
            } else {
                settings.ai_base_url.trim().trim_end_matches('/')
            };
            let mut req = client.get(format!("{}/models", base));
            if !settings.ai_api_key.trim().is_empty() {
                req = req.bearer_auth(settings.ai_api_key.trim());
            }
            if let Ok(resp) = req.send().await {
                if resp.status().is_success() {
                    if let Ok(v) = resp.json::<Value>().await {
                        if let Some(arr) = v["data"].as_array() {
                            let models: Vec<AiModelOption> = arr
                                .iter()
                                .filter_map(|m| m["id"].as_str())
                                .map(|id| AiModelOption {
                                    id: id.to_string(),
                                    label: id.to_string(),
                                })
                                .collect();
                            if !models.is_empty() {
                                return Ok(models);
                            }
                        }
                    }
                }
            }
            // Curated OpenCode Go fallback list
            Ok(vec![
                AiModelOption { id: "glm-5".into(), label: "GLM-5 (OpenCode Go)".into() },
                AiModelOption { id: "kimi-k2.5".into(), label: "Kimi K2.5 (OpenCode Go)".into() },
                AiModelOption { id: "deepseek-chat".into(), label: "DeepSeek Chat (OpenCode Go)".into() },
                AiModelOption { id: "minimax-m2.5".into(), label: "MiniMax M2.5 (OpenCode Go)".into() },
                AiModelOption { id: "qwen3-coder".into(), label: "Qwen 3 Coder (OpenCode Go)".into() },
            ])
        }
        "opencode_cli" => {
            if let Some(bin) = resolve_cli_binary("opencode", &settings.ai_cli_path) {
                if let Ok(Ok(out)) = tokio::time::timeout(
                    Duration::from_secs(10),
                    Command::new(&bin)
                        .arg("models")
                        .env("PATH", enriched_path_env())
                        .output(),
                )
                .await
                {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let models: Vec<AiModelOption> = stdout
                        .lines()
                        .map(|l| l.trim())
                        .filter(|l| !l.is_empty() && l.contains('/') && !l.starts_with(' '))
                        .map(|id| AiModelOption {
                            id: id.to_string(),
                            label: id.to_string(),
                        })
                        .collect();
                    if !models.is_empty() {
                        return Ok(models);
                    }
                }
            }
            Ok(vec![
                AiModelOption { id: "".into(), label: "OpenCode alapértelmezett modell (configból)".into() },
                AiModelOption { id: "opencode-go/glm-5".into(), label: "opencode-go/glm-5".into() },
                AiModelOption { id: "opencode-go/kimi-k2.5".into(), label: "opencode-go/kimi-k2.5".into() },
            ])
        }
        "claude_cli" => Ok(vec![
            AiModelOption { id: "".into(), label: "Claude Code alapértelmezett".into() },
            AiModelOption { id: "sonnet".into(), label: "Claude Sonnet (gyors, ajánlott)".into() },
            AiModelOption { id: "opus".into(), label: "Claude Opus (legokosabb)".into() },
            AiModelOption { id: "haiku".into(), label: "Claude Haiku (leggyorsabb)".into() },
        ]),
        "codex_cli" => Ok(vec![
            AiModelOption { id: "".into(), label: "Codex alapértelmezett (~/.codex/config.toml)".into() },
            AiModelOption { id: "gpt-5.4".into(), label: "GPT-5.4".into() },
            AiModelOption { id: "gpt-5.3-codex".into(), label: "GPT-5.3 Codex".into() },
            AiModelOption { id: "gpt-5-mini".into(), label: "GPT-5 Mini".into() },
            AiModelOption { id: "o3".into(), label: "o3".into() },
        ]),
        "ollama" => {
            let base = if settings.ai_base_url.trim().is_empty() {
                "http://127.0.0.1:11434"
            } else {
                settings.ai_base_url.trim().trim_end_matches('/')
            };
            let resp = client
                .get(format!("{}/api/tags", base))
                .send()
                .await
                .map_err(|e| format!("Ollama nem elérhető ({}): {}", base, e))?;
            let v: Value = resp.json().await.map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            if let Some(arr) = v["models"].as_array() {
                for m in arr {
                    if let Some(name) = m["name"].as_str() {
                        out.push(AiModelOption {
                            id: name.to_string(),
                            label: name.to_string(),
                        });
                    }
                }
            }
            Ok(out)
        }
        "openai" => Ok(vec![
            AiModelOption { id: "gpt-4o-mini".into(), label: "GPT-4o mini".into() },
            AiModelOption { id: "gpt-4o".into(), label: "GPT-4o".into() },
            AiModelOption { id: "gpt-4.1-mini".into(), label: "GPT-4.1 mini".into() },
            AiModelOption { id: "gpt-4.1".into(), label: "GPT-4.1".into() },
        ]),
        "anthropic" => Ok(vec![
            AiModelOption { id: "claude-sonnet-4-5".into(), label: "Claude Sonnet 4.5".into() },
            AiModelOption { id: "claude-3-5-sonnet-latest".into(), label: "Claude 3.5 Sonnet".into() },
            AiModelOption { id: "claude-3-5-haiku-latest".into(), label: "Claude 3.5 Haiku".into() },
        ]),
        "gemini" => Ok(vec![
            AiModelOption { id: "gemini-2.5-flash".into(), label: "Gemini 2.5 Flash".into() },
            AiModelOption { id: "gemini-2.5-pro".into(), label: "Gemini 2.5 Pro".into() },
            AiModelOption { id: "gemini-2.0-flash".into(), label: "Gemini 2.0 Flash".into() },
        ]),
        _ => Ok(vec![]),
    }
}

pub(crate) fn has_live_ai(settings: &AppSettings) -> bool {
    match settings.ai_provider.as_str() {
        "local_heuristic" => false,
        "claude_cli" => resolve_cli_binary("claude", &settings.ai_cli_path).is_some(),
        "codex_cli" => resolve_cli_binary("codex", &settings.ai_cli_path).is_some(),
        "opencode_cli" => resolve_cli_binary("opencode", &settings.ai_cli_path).is_some(),
        "ollama" => !settings.ai_model.trim().is_empty(),
        _ => !settings.ai_api_key.trim().is_empty(),
    }
}

fn strip_ansi(s: &str) -> String {
    let re = regex::Regex::new(r"\x1B\[[0-9;?]*[ -/]*[@-~]").unwrap();
    re.replace_all(s, "").to_string()
}

async fn call_claude_cli(settings: &AppSettings, system_prompt: &str, user_prompt: &str) -> Result<String, String> {
    let bin = resolve_cli_binary("claude", &settings.ai_cli_path)
        .ok_or_else(|| "A 'claude' (Claude Code CLI) nem található a gépen.".to_string())?;

    let mut cmd = Command::new(&bin);
    cmd.env("PATH", enriched_path_env())
        .current_dir(std::env::temp_dir())
        .kill_on_drop(true)
        .arg("-p")
        .arg("--output-format")
        .arg("text")
        .arg("--no-session-persistence")
        .arg("--tools")
        .arg("")
        .arg("--system-prompt")
        .arg(system_prompt);

    if !settings.ai_model.trim().is_empty() {
        cmd.arg("--model").arg(settings.ai_model.trim());
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Claude CLI indítási hiba: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(user_prompt.as_bytes()).await;
    }

    let output = tokio::time::timeout(Duration::from_secs(55), child.wait_with_output())
        .await
        .map_err(|_| "Az AI modell (Claude CLI) nem adott választ 55 másodpercen belül (időtúllépés).".to_string())?
        .map_err(|e| format!("Claude CLI futtatási hiba: {}", e))?;

    let stdout = strip_ansi(&String::from_utf8_lossy(&output.stdout)).trim().to_string();
    let stderr = strip_ansi(&String::from_utf8_lossy(&output.stderr)).trim().to_string();

    if !output.status.success() {
        return Err(format!("Claude CLI hiba: {}", if !stderr.is_empty() { stderr } else { stdout }));
    }
    if stdout.is_empty() {
        return Err(format!(
            "Az AI modell (Claude CLI) üres választ adott vissza.{}",
            if stderr.is_empty() { String::new() } else { format!(" Részletek: {}", stderr) }
        ));
    }

    Ok(stdout)
}

async fn call_codex_cli(settings: &AppSettings, system_prompt: &str, user_prompt: &str) -> Result<String, String> {
    let bin = resolve_cli_binary("codex", &settings.ai_cli_path)
        .ok_or_else(|| "A 'codex' (OpenAI Codex CLI) nem található a gépen.".to_string())?;

    let out_file = std::env::temp_dir().join(format!("mylead-codex-{}.txt", Uuid::new_v4()));
    let combined_prompt = format!(
        "SYSTEM INSTRUCTIONS:\n{}\n\nUSER REQUEST:\n{}\n\nIMPORTANT: Do NOT run shell tools or edit files. Reply ONLY with the requested JSON object.",
        system_prompt, user_prompt
    );

    let mut cmd = Command::new(&bin);
    cmd.env("PATH", enriched_path_env())
        .current_dir(std::env::temp_dir())
        .kill_on_drop(true)
        .arg("exec")
        .arg("--skip-git-repo-check")
        .arg("--ephemeral")
        .arg("--sandbox")
        .arg("read-only")
        .arg("--color")
        .arg("never")
        .arg("-o")
        .arg(&out_file);

    if !settings.ai_model.trim().is_empty() {
        cmd.arg("-m").arg(settings.ai_model.trim());
    }

    cmd.arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Codex CLI indítási hiba: {}", e))?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(combined_prompt.as_bytes()).await;
    }

    let output = tokio::time::timeout(Duration::from_secs(45), child.wait_with_output())
        .await
        .map_err(|_| {
            let _ = std::fs::remove_file(&out_file);
            "Az AI modell (Codex CLI) nem adott választ 45 másodpercen belül (időtúllépés).".to_string()
        })?
        .map_err(|e| {
            let _ = std::fs::remove_file(&out_file);
            format!("Codex CLI futtatási hiba: {}", e)
        })?;

    let file_text = std::fs::read_to_string(&out_file).ok().map(|s| strip_ansi(&s).trim().to_string());
    let _ = std::fs::remove_file(&out_file);
    let stdout = strip_ansi(&String::from_utf8_lossy(&output.stdout)).trim().to_string();
    let stderr = strip_ansi(&String::from_utf8_lossy(&output.stderr)).trim().to_string();

    if !output.status.success() && file_text.as_deref().unwrap_or("").is_empty() {
        return Err(format!("Codex CLI hiba: {}", if !stderr.is_empty() { stderr } else { stdout }));
    }

    let result = file_text
        .filter(|s| !s.is_empty())
        .unwrap_or(stdout);

    if result.trim().is_empty() {
        return Err(format!(
            "Az AI modell (Codex CLI) üres választ adott vissza.{}",
            if stderr.is_empty() { String::new() } else { format!(" Részletek: {}", stderr) }
        ));
    }
    Ok(result)
}

async fn call_opencode_cli(settings: &AppSettings, system_prompt: &str, user_prompt: &str) -> Result<String, String> {
    let bin = resolve_cli_binary("opencode", &settings.ai_cli_path)
        .ok_or_else(|| "Az 'opencode' CLI nem található a gépen (~/.opencode/bin/opencode).".to_string())?;

    let combined_prompt = format!(
        "SYSTEM INSTRUCTIONS:\n{}\n\nUSER REQUEST:\n{}\n\nIMPORTANT: Do NOT call any tools or read any files. Respond ONLY with the requested JSON object.",
        system_prompt, user_prompt
    );

    let mut cmd = Command::new(&bin);
    cmd.env("PATH", enriched_path_env())
        .current_dir(std::env::temp_dir())
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .arg("run")
        .arg("--archived")
        .arg("--format")
        .arg("default");

    if !settings.ai_model.trim().is_empty() {
        cmd.arg("--model").arg(settings.ai_model.trim());
    }

    cmd.arg(&combined_prompt);

    let output = tokio::time::timeout(Duration::from_secs(55), cmd.output())
        .await
        .map_err(|_| {
            format!(
                "Az AI modell (OpenCode CLI / {}) nem adott választ 55 másodpercen belül (időtúllépés). Próbálj másik modellt a Beállításokban!",
                if settings.ai_model.is_empty() { "alapértelmezett" } else { &settings.ai_model }
            )
        })?
        .map_err(|e| format!("OpenCode CLI futtatási hiba: {}", e))?;

    let stdout = strip_ansi(&String::from_utf8_lossy(&output.stdout)).trim().to_string();
    let stderr = strip_ansi(&String::from_utf8_lossy(&output.stderr)).trim().to_string();

    if !output.status.success() {
        return Err(format!(
            "OpenCode CLI hiba: {}",
            if !stderr.is_empty() { stderr } else if !stdout.is_empty() { stdout } else { "Ismeretlen kilépési hiba".into() }
        ));
    }

    if stdout.is_empty() {
        return Err(format!(
            "Az AI modell (OpenCode CLI / {}) nem adott választ (üres kimenet).{}",
            if settings.ai_model.is_empty() { "alapértelmezett" } else { &settings.ai_model },
            if stderr.is_empty() { String::new() } else { format!(" Napló: {}", stderr) }
        ));
    }

    Ok(stdout)
}

pub(crate) async fn call_llm_json(
    settings: &AppSettings,
    system_prompt: &str,
    user_prompt: &str,
) -> Result<String, String> {
    let provider = settings.ai_provider.as_str();

    // Local installed CLI providers (use user's local logins, no API key required!)
    match provider {
        "claude_cli" => {
            let raw = call_claude_cli(settings, system_prompt, user_prompt).await?;
            return Ok(extract_json_block(&raw));
        }
        "codex_cli" => {
            let raw = call_codex_cli(settings, system_prompt, user_prompt).await?;
            return Ok(extract_json_block(&raw));
        }
        "opencode_cli" => {
            let raw = call_opencode_cli(settings, system_prompt, user_prompt).await?;
            return Ok(extract_json_block(&raw));
        }
        _ => {}
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(35))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let model = if settings.ai_model.trim().is_empty() {
        match provider {
            "anthropic" => "claude-sonnet-4-5",
            "gemini" => "gemini-2.5-flash",
            "ollama" => "llama3.1",
            "opencode_go" => "glm-5",
            "openrouter" => "openai/gpt-4o-mini",
            _ => "gpt-4o-mini",
        }
    } else {
        settings.ai_model.trim()
    };

    let raw_text = match provider {
        "anthropic" => {
            let url = if settings.ai_base_url.trim().is_empty() {
                "https://api.anthropic.com/v1/messages".to_string()
            } else {
                settings.ai_base_url.trim().to_string()
            };
            let resp = client
                .post(&url)
                .header("x-api-key", settings.ai_api_key.trim())
                .header("anthropic-version", "2023-06-01")
                .json(&json!({
                    "model": model,
                    "max_tokens": 1800,
                    "system": system_prompt,
                    "messages": [{ "role": "user", "content": user_prompt }]
                }))
                .send()
                .await
                .map_err(|e| format!("Anthropic hálózati hiba: {}", e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let txt = resp.text().await.unwrap_or_default();
                return Err(format!("Anthropic hiba ({}): {}", status, txt));
            }
            let v: Value = resp.json().await.map_err(|e| e.to_string())?;
            v["content"][0]["text"].as_str().unwrap_or_default().to_string()
        }
        "gemini" => {
            let url = if settings.ai_base_url.trim().is_empty() {
                format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                    model,
                    settings.ai_api_key.trim()
                )
            } else {
                settings.ai_base_url.trim().to_string()
            };
            let resp = client
                .post(&url)
                .json(&json!({
                    "systemInstruction": { "parts": [{ "text": system_prompt }] },
                    "contents": [{ "role": "user", "parts": [{ "text": user_prompt }] }],
                    "generationConfig": { "responseMimeType": "application/json", "temperature": 0.4 }
                }))
                .send()
                .await
                .map_err(|e| format!("Gemini hálózati hiba: {}", e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let txt = resp.text().await.unwrap_or_default();
                return Err(format!("Gemini hiba ({}): {}", status, txt));
            }
            let v: Value = resp.json().await.map_err(|e| e.to_string())?;
            v["candidates"][0]["content"]["parts"][0]["text"]
                .as_str()
                .unwrap_or_default()
                .to_string()
        }
        "ollama" => {
            let base = if settings.ai_base_url.trim().is_empty() {
                "http://127.0.0.1:11434"
            } else {
                settings.ai_base_url.trim().trim_end_matches('/')
            };
            let resp = client
                .post(format!("{}/api/chat", base))
                .json(&json!({
                    "model": model,
                    "stream": false,
                    "format": "json",
                    "messages": [
                        { "role": "system", "content": system_prompt },
                        { "role": "user", "content": user_prompt }
                    ]
                }))
                .send()
                .await
                .map_err(|e| format!("Ollama hálózati hiba: {}", e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let txt = resp.text().await.unwrap_or_default();
                return Err(format!("Ollama hiba ({}): {}", status, txt));
            }
            let v: Value = resp.json().await.map_err(|e| e.to_string())?;
            v["message"]["content"].as_str().unwrap_or_default().to_string()
        }
        _ => {
            // OpenRouter, OpenCode Go, and OpenAI (all OpenAI-compatible Chat Completions)
            let url = if !settings.ai_base_url.trim().is_empty() {
                let b = settings.ai_base_url.trim().trim_end_matches('/');
                if b.ends_with("/chat/completions") {
                    b.to_string()
                } else {
                    format!("{}/chat/completions", b)
                }
            } else if provider == "openrouter" {
                "https://openrouter.ai/api/v1/chat/completions".to_string()
            } else if provider == "opencode_go" {
                "https://opencode.ai/zen/go/v1/chat/completions".to_string()
            } else {
                "https://api.openai.com/v1/chat/completions".to_string()
            };

            let mut req = client
                .post(&url)
                .bearer_auth(settings.ai_api_key.trim());

            if provider == "openrouter" {
                req = req
                    .header("HTTP-Referer", "https://mylead.app")
                    .header("X-Title", "MyLead Desktop");
            } else if provider == "opencode_go" {
                req = req.header("x-opencode-session", "mylead-desktop-session");
            }

            let mut body = json!({
                "model": model,
                "temperature": 0.4,
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": user_prompt }
                ]
            });

            // Only attach response_format for providers known to universally support it
            if provider == "openai" {
                body["response_format"] = json!({ "type": "json_object" });
            }

            let resp = req
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("AI API hálózati hiba ({}): {}", provider, e))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let txt = resp.text().await.unwrap_or_default();
                return Err(format!("AI API hiba ({} / {}): {}", provider, status, txt));
            }
            let v: Value = resp.json().await.map_err(|e| e.to_string())?;
            v["choices"][0]["message"]["content"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .or_else(|| v["choices"][0]["message"]["reasoning_content"].as_str())
                .or_else(|| v["choices"][0]["message"]["reasoning"].as_str())
                .unwrap_or_default()
                .to_string()
        }
    };

    if raw_text.trim().is_empty() {
        return Err(format!(
            "Az AI modell ({} / {}) üres választ adott vissza. Próbálj másik modellt vagy ellenőrizd a kvótát!",
            provider, model
        ));
    }

    Ok(extract_json_block(&raw_text))
}

fn extract_json_block(raw: &str) -> String {
    let trimmed = raw.trim();
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            if end >= start {
                return trimmed[start..=end].to_string();
            }
        }
    }
    trimmed.to_string()
}

pub async fn test_ai_connection(settings: &AppSettings) -> Result<String, String> {
    if !has_live_ai(settings) {
        return Ok("Lokális heurisztikus mód aktív (API kulcs nélkül is működik az elemzés és sablonozás, de teljes AI generáláshoz adj meg API kulcsot vagy Ollama modellt).".to_string());
    }
    let out = call_llm_json(
        settings,
        "Válaszolj pontosan ezzel a JSON objektummal: {\"status\":\"ok\",\"message\":\"Kapcsolat sikeres\"}",
        "Teszt kérés",
    )
    .await?;
    Ok(format!("AI kapcsolat sikeres ({}): {}", settings.ai_provider, out))
}

pub async fn analyze_project_website(
    settings: &AppSettings,
    project: &Project,
    crawled: &CrawledSiteData,
) -> ProjectAiProfile {
    let offers_text = project
        .offers
        .iter()
        .map(|o| format!("- {} ({}): {} | CTA: {}", o.title, o.discount_value, o.description, o.cta_text))
        .collect::<Vec<_>>()
        .join("\n");

    if has_live_ai(settings) {
        let system = "Te egy senior B2B marketing- és értékesítési stratéga vagy. Elemezd a kapott weboldal-tartalmat és ajánlatokat, majd készíts pontos, reklámozáshoz és hideg e-mail outreachhez használható profilt MAGYAR nyelven. Kizárólag érvényes JSON-t adj vissza ezekkel a kulcsokkal: value_proposition (string), target_audience (string), pain_points_solved (string[]), pitch_angles (string[]), objection_handlers (string[]), crawled_summary (string).";
        let user = format!(
            "Projekt neve: {}\nWeboldal: {}\nIparág: {}\nMegadott leírás: {}\nAjánlatok / kedvezmények:\n{}\n\nFeltérképezett oldalcímek: {:?}\nFőcímek: {:?}\nMeta leírás: {}\nOldal szövegrészlet:\n{}",
            project.name,
            crawled.final_url,
            project.industry,
            project.description,
            offers_text,
            crawled.titles,
            crawled.headings,
            crawled.meta_description,
            crawled.combined_text.chars().take(7000).collect::<String>()
        );
        if let Ok(json_str) = call_llm_json(settings, system, &user).await {
            if let Ok(parsed) = serde_json::from_str::<ProjectAiProfile>(&json_str) {
                return parsed;
            }
        }
    }

    // Smart deterministic fallback using actual crawled content
    let headline_summary = if !crawled.headings.is_empty() {
        crawled.headings.iter().take(4).cloned().collect::<Vec<_>>().join(" • ")
    } else if !crawled.meta_description.is_empty() {
        crawled.meta_description.clone()
    } else {
        project.description.clone()
    };

    let mut pitch_angles = vec![
        format!("Konkrét weboldal-audit alapján bemutatni, hogyan növeli a(z) {} a beérkező érdeklődők számát.", project.name),
        format!("Gyors, alacsony kockázatú bevezetés {} fókuszú cégeknek.", if project.industry.is_empty() { "KKV" } else { &project.industry }),
    ];
    if let Some(first_offer) = project.offers.first() {
        pitch_angles.insert(
            0,
            format!("Kiemelt ajánlat: {} ({}) — azonnali értékadás az első levélben.", first_offer.title, first_offer.discount_value),
        );
    }

    ProjectAiProfile {
        value_proposition: format!(
            "{} — {}",
            project.name,
            if !crawled.meta_description.is_empty() {
                crawled.meta_description.clone()
            } else if !project.description.is_empty() {
                project.description.clone()
            } else {
                headline_summary.clone()
            }
        ),
        target_audience: format!(
            "{} szektorban működő kis- és középvállalkozások, döntéshozók (ügyvezető, marketing vagy értékesítési vezető).",
            if project.industry.is_empty() { "B2B szolgáltató" } else { &project.industry }
        ),
        pain_points_solved: vec![
            "Kevés minőségi, kiszámíthatóan érkező online érdeklődő és időpontfoglalás".to_string(),
            "Elavult vagy nem konverzióra optimalizált ügyfélszerzési és webes folyamatok".to_string(),
            "Manuális adminisztráció és lassú reakcióidő az érdeklődők felé".to_string(),
        ],
        pitch_angles,
        objection_handlers: vec![
            "„Most nincs rá időnk” → Rövid, 15 perces bemutató, minimális ügyféloldali ráfordítással indulunk.".to_string(),
            "„Már van meglévő megoldásunk” → Díjmentes összehasonlító auditot adunk, csak ott lépünk be, ahol mérhető többletet hozunk.".to_string(),
        ],
        crawled_summary: format!(
            "Feltérképezve {} oldal ({}). Fő üzenetek: {}. Észlelt technológiák: {}.",
            crawled.pages_crawled,
            crawled.final_url,
            headline_summary,
            if crawled.audit.tech_stack.is_empty() {
                "egyedi / nem azonosított".to_string()
            } else {
                crawled.audit.tech_stack.join(", ")
            }
        ),
    }
}

pub async fn audit_and_score_lead(
    settings: &AppSettings,
    project: &Project,
    offer: Option<&Offer>,
    search: Option<&SearchJob>,
    lead: &Lead,
    audit: Option<&WebsiteAudit>,
    crawled_text: &str,
) -> LeadAiAnalysis {
    let target_problem = search
        .map(|s| s.target_problem.as_str())
        .unwrap_or("statikus vagy hiányzó ajánlatkérő / időpontfoglaló / okosűrlap folyamatok");

    let analysis_focus = if settings.ai_analysis_focus.trim().is_empty() {
        "Fókuszálj konkrétan arra, mit tehet egy okosűrlap (intelligens, többlépcsős ajánlatkérő / előszűrő / kalkulátor / időpontfoglaló űrlap) ennek a cégnek a saját szolgáltatásai alapján."
    } else {
        settings.ai_analysis_focus.trim()
    };

    if has_live_ai(settings) {
        let system = "Te egy B2B üzletfejlesztési és konverzió-optimalizálási elemző vagy. Elemezd a célcéget és a weboldal-auditját a saját projektünk / okosűrlap-megoldásunk szemszögéből MAGYAR nyelven.\n\
FONTOS SZABÁLYOK:\n\
1. A 'how_we_can_help' mező legyen egy tömör, lényegre törő NAGYSÁGRENDI ÁTTEKINTÉS (2-4 rövid pont, soremeléssel elválasztva), amely KIFEJEZETTEN a cég valós szolgáltatásaira szabva mutatja meg, mit tehet az okosűrlap / megoldásunk értük (pl. milyen adatokat szűr előre az űrlap, milyen azonnali kalkulációt/előminősítést vagy foglalást ad, hány felesleges kört/telefont spórol, milyen nagyságrendű plusz érdeklődőt/időmegtakarítást hozhat).\n\
2. NE írj megszólítási szöveget, pitch-et vagy levéltervezetet — a 'recommended_pitch' mező mindig legyen üres string \"\".\n\
3. A 'fit_score' (0..100) őszintén tükrözze, mennyire hasznos az okosűrlap / megoldásunk ennek a cégnek (ha már profi interaktív rendszerük van vagy teljesen irreleváns a profiljuk, kapjon alacsony pontot; ha egyedi árajánlatot / konzultációt / időpontot igénylő szolgáltató csak sima kapcsolat-űrlappal vagy telefonszámmal, kapjon magas pontot).\n\
Kizárólag érvényes JSON-t adj vissza ezekkel a kulcsokkal: fit_score (0..100 integer), employee_estimate (string, pl. '10-25 fő'), company_summary (string, tömör 1-2 mondat a cég fő tevékenységéről), pain_points (string[], 2-4 konkrét hiányosság), how_we_can_help (string, nagyságrendi áttekintés az okosűrlap konkrét értékéről ehhez a céghez), recommended_pitch (\"\").";

        let user = format!(
            "ELEMZÉSI FÓKUSZ (KIEMELTEN FIGYELJ RÁ):\n{}\n\nSAJÁT PROJEKT / MEGOLDÁS:\nNév: {}\nLeírás: {}\nÉrtékajánlat: {}\nMegoldott problémák: {:?}\nKiválasztott ajánlat: {}\nKeresett specifikus probléma: {}\n\nCÉLCÉG:\nNév: {}\nWeboldal: {}\nIparág: {}\nLokáció: {}\nGoogle értékelés: {:?} ({:?} értékelés)\nWeboldal audit: {}\nWeboldal szövegrészlet:\n{}",
            analysis_focus,
            project.name,
            project.description,
            project.value_proposition,
            project.pain_points_solved,
            offer.map(|o| format!("{} ({}) - {}", o.title, o.discount_value, o.description)).unwrap_or_else(|| "Nincs megadva".into()),
            target_problem,
            lead.company_name,
            lead.website_url,
            lead.industry,
            lead.location,
            lead.google_rating,
            lead.google_reviews,
            audit.map(|a| serde_json::to_string(a).unwrap_or_default()).unwrap_or_else(|| "Nincs weboldal / nem elérhető".into()),
            crawled_text.chars().take(6000).collect::<String>()
        );
        if let Ok(json_str) = call_llm_json(settings, system, &user).await {
            if let Ok(mut parsed) = serde_json::from_str::<LeadAiAnalysis>(&json_str) {
                parsed.fit_score = parsed.fit_score.clamp(0, 100);
                parsed.recommended_pitch = String::new();
                return parsed;
            }
        }
    }

    // Deterministic high-signal scoring focused on smart form (okosűrlap) & conversion potential
    let mut score = 46i64;
    let mut pain_points = Vec::new();
    let mut okosurlap_points = Vec::new();
    let mut employee_estimate = if !lead.employee_estimate.is_empty() {
        lead.employee_estimate.clone()
    } else {
        "5–20 fő (becsült)".to_string()
    };

    if let Some(a) = audit {
        if !a.reachable {
            score += 14;
            pain_points.push("A weboldal jelenleg nem elérhető vagy hibát ad vissza".to_string());
            okosurlap_points.push("• Önálló linkként is megosztható okosűrlap (Google profilból, Facebookról) azonnali érdeklődő-fogadáshoz.".to_string());
        } else {
            if !a.has_booking_system {
                score += 16;
                pain_points.push("Nincs interaktív online időpontfoglaló vagy előszűrő folyamat".to_string());
                okosurlap_points.push(format!(
                    "• 0–24 órás okosűrlap a(z) {} szolgáltatásaira: automatikusan bekéri az igény paramétereit, és előszűrve adja át a leadeket.",
                    if lead.industry.is_empty() { &lead.company_name } else { &lead.industry }
                ));
            }
            if !a.has_contact_form {
                score += 12;
                pain_points.push("Nincs beépített ajánlatkérő / kapcsolatfelvételi űrlap az oldalon".to_string());
                okosurlap_points.push("• Kötetlen e-mailezés / telefonálgatás kiváltása: 1 perces irányított okosűrlap + azonnali visszaigazolás.".to_string());
            } else {
                score += 6;
                okosurlap_points.push("• A meglévő statikus kapcsolat-űrlap kiváltása intelligens, elágazó okosűrlappal (kevesebb hiányos megkeresés, +20–40% kitöltési arány).".to_string());
            }
            if !a.has_mobile_viewport {
                score += 10;
                pain_points.push("Nem mobilbarát kialakítás — mobilos érdeklődők elvesztése".to_string());
                okosurlap_points.push("• Mobilra optimalizált, kártyás kitöltésű okosűrlap, amivel telefonról is fél perc az ajánlatkérés.".to_string());
            }
            if !a.has_analytics {
                score += 8;
                pain_points.push("Nincs konverziókövetés az érdeklődéseken".to_string());
            }
            if !a.has_chat_widget {
                score += 5;
                pain_points.push("Nincs azonnali interaktív ügyfél-irányítás az oldalon".to_string());
            }
            if a.load_time_ms > 2500 {
                score += 5;
                pain_points.push(format!("Lassú weboldal betöltés ({} ms)", a.load_time_ms));
            }
            if !a.extracted_emails.is_empty() {
                score += 7;
            }
            if a.pages_crawled >= 4 || a.tech_stack.len() >= 3 {
                employee_estimate = "15–50 fő (becsült)".to_string();
            }
        }
    } else if lead.website_url.trim().is_empty() {
        score += 12;
        pain_points.push("A cégnek nincs megadott saját weboldala".to_string());
        okosurlap_points.push("• Önállóan megosztható okosűrlap landing (Google Maps / közösségi média mellé), weboldal-fejlesztés nélkül is azonnali lead-gyűjtés.".to_string());
        employee_estimate = "1–10 fő (becsült)".to_string();
    }

    if okosurlap_points.is_empty() {
        okosurlap_points.push(format!(
            "• A(z) {} megkereséseinek előszűrése és automatikus árajánlat-/konzultáció-előkészítés okosűrlappal.",
            lead.company_name
        ));
    }
    okosurlap_points.push("• Nagyságrendi hatás: kevesebb oda-vissza egyeztetés, gyorsabb reakcióidő, jobb minőségű beérkező ajánlatkérések.".to_string());

    if pain_points.is_empty() {
        pain_points.push("Statikus érdeklődőkezelés — okosűrlappal növelhető a konverzió".to_string());
    }

    LeadAiAnalysis {
        fit_score: score.clamp(15, 96),
        employee_estimate,
        company_summary: format!(
            "{} ({}, {}) — {} területen működő vállalkozás.",
            lead.company_name,
            if lead.location.is_empty() { "Magyarország" } else { &lead.location },
            if lead.domain.is_empty() { "nincs domain" } else { &lead.domain },
            if lead.industry.is_empty() { "B2B szolgáltató" } else { &lead.industry },
        ),
        pain_points,
        how_we_can_help: okosurlap_points.join("\n"),
        recommended_pitch: String::new(),
    }
}

pub async fn generate_cold_email(
    settings: &AppSettings,
    project: &Project,
    offer: Option<&Offer>,
    lead: &Lead,
    tone: &str,
    language: &str,
    include_booking_link: bool,
    custom_instructions: &str,
) -> GeneratedEmail {
    let tone_desc = match tone {
        "friendly_direct" => "közvetlen, barátságos, tegeződő, mégis szakmai",
        "concise_executive" => "nagyon tömör, vezetői szintű, max 5 mondat, lényegre törő",
        _ => "udvarias, szakmai, magázódó B2B stílus",
    };

    if has_live_ai(settings) {
        let system = "Te egy tapasztalt B2B sales szövegíró vagy. Írj egy természetes, emberi, NEM sablonos, nem spammy hideg e-mailt a megadott cégnek a valós weboldal-audit és az okosűrlap / ajánlat konkrét haszna alapján. Ne használj túlzó marketing-kliséket vagy felkiáltójel-áradatot. Kizárólag JSON-t adj vissza: {\"subject\":\"...\",\"body\":\"...\"}";
        let user = format!(
            "Nyelv: {}\nHangnem: {}\nSaját megoldás: {} ({})\nÉrtékajánlat: {}\nLanding oldal: {}\nIdőpontfoglaló link: {}\nIdőpontfoglaló beillesztése az első levélbe: {}\nKiemelt ajánlat: {}\nTermék/Okosűrlap fókusz: {}\nExtra utasítás: {}\nAláírás:\n{}\n\nCÉLCÉG:\nNév: {}\nWeboldal: {}\nIparág: {}\nFeltárt problémák: {:?}\nMiben segíthet az okosűrlap / megoldásunk:\n{}",
            language,
            tone_desc,
            project.name,
            project.website_url,
            project.value_proposition,
            project.landing_url,
            project.booking_url,
            include_booking_link,
            offer.map(|o| format!("{} ({}) — {} | CTA: {}", o.title, o.discount_value, o.description, o.cta_text)).unwrap_or_else(|| "Nincs kiemelt kedvezmény".into()),
            settings.ai_analysis_focus,
            custom_instructions,
            settings.company_signature,
            lead.company_name,
            lead.website_url,
            lead.industry,
            lead.pain_points,
            lead.how_we_can_help,
        );
        if let Ok(json_str) = call_llm_json(settings, system, &user).await {
            if let Ok(parsed) = serde_json::from_str::<GeneratedEmail>(&json_str) {
                if !parsed.subject.trim().is_empty() && !parsed.body.trim().is_empty() {
                    return parsed;
                }
            }
        }
    }

    let first_issue = lead
        .pain_points
        .first()
        .cloned()
        .unwrap_or_else(|| "az online ajánlatkérési / érdeklődőkezelési folyamatban még komoly tartalék van".to_string());

    let offer_line = offer
        .map(|o| format!("Jelenlegi ajánlatunk: {} ({}). {}", o.title, o.discount_value, o.description))
        .unwrap_or_else(|| format!("A(z) {} megoldásunk gyorsan, mérhetően segít ezen a területen.", project.name));

    let landing_line = if !project.landing_url.trim().is_empty() {
        format!("\nRészletek és példák itt láthatók: {}", project.landing_url)
    } else if !project.website_url.trim().is_empty() {
        format!("\nBővebben a megoldásunkról: {}", project.website_url)
    } else {
        String::new()
    };

    let booking_line = if include_booking_link && !project.booking_url.trim().is_empty() {
        format!("\nHa nyitottak egy rövid, 15 perces egyeztetésre, itt tudnak közvetlenül időpontot választani: {}", project.booking_url)
    } else {
        "\nHa aktuális lehet a téma, elég egy rövid válasz erre a levélre, és szívesen megmutatom 10 percben, hogyan működne Önöknél.".to_string()
    };

    let greeting = if tone == "friendly_direct" {
        format!("Szia {} csapat,", lead.company_name)
    } else {
        format!("Tisztelt {} Vezetőség!", lead.company_name)
    };

    GeneratedEmail {
        subject: format!("{} — rövid észrevétel a weboldaluk kapcsán", lead.company_name),
        body: format!(
            "{}\n\nÁtnéztem a(z) {} online jelenlétét ({}), és egy konkrét dolog rögtön feltűnt: {}.\n\n{}\n{}\n{}\n{}\n\n{}",
            greeting,
            lead.company_name,
            if lead.domain.is_empty() { "webes profil" } else { &lead.domain },
            first_issue,
            if lead.how_we_can_help.is_empty() { project.value_proposition.clone() } else { lead.how_we_can_help.clone() },
            offer_line,
            landing_line,
            booking_line,
            settings.company_signature
        ),
    }
}

pub async fn classify_and_draft_reply(
    settings: &AppSettings,
    project: &Project,
    offer: Option<&Offer>,
    lead: &Lead,
    inbound_body: &str,
    thread_history: &[EmailMessage],
) -> ReplyClassification {
    let history_text = thread_history
        .iter()
        .rev()
        .take(6)
        .rev()
        .map(|m| {
            format!(
                "[{} | {}]: {}\n{}",
                if m.direction == "inbound" { "ÜGYFÉL" } else { "MI" },
                m.subject,
                m.body.chars().take(600).collect::<String>(),
                if m.booking_link_sent { "(foglalási link kiküldve)" } else { "" }
            )
        })
        .collect::<Vec<_>>()
        .join("\n---\n");

    if has_live_ai(settings) {
        let system = "Te egy profi, emberi hangvételű B2B értékesítési asszisztens vagy. Elemezd az ügyfél beérkező levelét, osztályozd a szándékát, és MINDEN kérdésre, érdeklődésre, kifogásra vagy időpontkérésre írj pontos, természetes, segítőkész választ MAGYAR nyelven (csak leiratkozás vagy házon kívüli auto-válasz esetén hagyd üresen a suggested_reply mezőt).\n\
Ha időpontot, hívást, bemutatót vagy találkozót kér, illeszd be a projekt időpontfoglaló linkjét! Ha kérdést tesz fel, válaszolj rá közvetlenül, konkrétan, és kapcsold össze az okosűrlap / ajánlat értékével.\n\
Kizárólag JSON-t adj vissza: {\"intent\":\"interested|booking_request|question|objection|not_interested|out_of_office|unsubscribe\",\"suggested_reply\":\"...\",\"should_include_booking_link\":true|false,\"summary\":\"...\"}";
        let user = format!(
            "Saját megoldás: {} ({})\nLanding URL: {}\nIdőpontfoglaló URL: {}\nAjánlat: {}\nÉrtékajánlat: {}\nKifogáskezelés: {:?}\nGlobális válasz-szabályok: {}\nAláírás:\n{}\n\nCÉG ({} — {})\nMiben segíthetünk nekik:\n{}\n\nKORÁBBI LEVÉLVÁLTÁS:\n{}\n\nLEGÚJABB BEÉRKEZŐ ÜZENET:\n{}",
            project.name,
            project.website_url,
            project.landing_url,
            project.booking_url,
            offer.map(|o| format!("{} ({}) - {}", o.title, o.discount_value, o.description)).unwrap_or_else(|| "Nincs".into()),
            project.value_proposition,
            project.objection_handlers,
            settings.ai_reply_instructions,
            settings.company_signature,
            lead.company_name,
            lead.industry,
            lead.how_we_can_help,
            if history_text.is_empty() { "Nincs előzmény".into() } else { history_text },
            inbound_body
        );
        if let Ok(json_str) = call_llm_json(settings, system, &user).await {
            if let Ok(parsed) = serde_json::from_str::<ReplyClassification>(&json_str) {
                return parsed;
            }
        }
    }

    let lower = inbound_body.to_lowercase();
    let booking_kw = ["időpont", "idopont", "hívás", "hivas", "beszéljünk", "beszeljunk", "találkozó", "meeting", "call", "demo", "demó", "mikor ér rá", "mikor er ra", "naptár"];
    let unsub_kw = ["leiratkoz", "unsubscribe", "ne írjanak", "ne irjanak", "törölj", "torolj", "spam", "gdpr"];
    let no_kw = ["nem érdekel", "nem erdekel", "köszönjük nem", "koszonjuk nem", "nincs szükség", "nem aktuális", "nem aktualis"];
    let ooo_kw = ["házon kívül", "hazon kivul", "out of office", "szabadság", "szabadsag", "automatikus válasz"];
    let question_kw = ["?", "mennyibe", "ár", "ar ", "hogyan", "részletek", "reszletek", "milyen", "működik", "mukodik"];

    let target_url = if !project.landing_url.trim().is_empty() {
        project.landing_url.as_str()
    } else {
        project.website_url.as_str()
    };

    if unsub_kw.iter().any(|k| lower.contains(k)) {
        return ReplyClassification {
            intent: "unsubscribe".to_string(),
            suggested_reply: String::new(),
            should_include_booking_link: false,
            summary: "Leiratkozási kérés — automatikusan tiltólistára kerül.".to_string(),
        };
    }

    if ooo_kw.iter().any(|k| lower.contains(k)) {
        return ReplyClassification {
            intent: "out_of_office".to_string(),
            suggested_reply: String::new(),
            should_include_booking_link: false,
            summary: "Automatikus házon kívüli válasz.".to_string(),
        };
    }

    if no_kw.iter().any(|k| lower.contains(k)) {
        return ReplyClassification {
            intent: "not_interested".to_string(),
            suggested_reply: format!(
                "Köszönöm a gyors visszajelzést! Természetesen nem zavarom tovább a témával. Ha a jövőben mégis aktuális lenne, itt bármikor elér minket: {}.\n\n{}",
                target_url, settings.company_signature
            ),
            should_include_booking_link: false,
            summary: "Elutasító válasz — udvarias lezárás javasolt.".to_string(),
        };
    }

    if booking_kw.iter().any(|k| lower.contains(k)) {
        let booking_part = if !project.booking_url.trim().is_empty() {
            format!("Itt tudnak közvetlenül egy Önöknek megfelelő 15 perces időpontot foglalni:\n{}", project.booking_url)
        } else {
            "Kérem írjanak 2-3 Önöknek megfelelő idősávot a következő napokban, és küldöm a meghívót!".to_string()
        };
        return ReplyClassification {
            intent: "booking_request".to_string(),
            suggested_reply: format!(
                "Nagyon örülök az érdeklődésnek! Szívesen átbeszéljük röviden, hogyan tudunk segíteni a(z) {} számára.\n\n{}\n\nAddig is a részleteket itt találják: {}\n\n{}",
                lead.company_name, booking_part, target_url, settings.company_signature
            ),
            should_include_booking_link: !project.booking_url.trim().is_empty(),
            summary: "Az ügyfél időpontot / egyeztetést kér — foglalási link küldése javasolt.".to_string(),
        };
    }

    if question_kw.iter().any(|k| lower.contains(k)) {
        let offer_part = offer
            .map(|o| format!("Jelenlegi ajánlatunk: {} ({}) — {}.", o.title, o.discount_value, o.description))
            .unwrap_or_default();
        let booking_part = if !project.booking_url.trim().is_empty() {
            format!("\n\nHa egyszerűbb szóban, 10 percben megválaszolom minden kérdésüket — itt foglalható időpont: {}", project.booking_url)
        } else {
            String::new()
        };
        return ReplyClassification {
            intent: "question".to_string(),
            suggested_reply: format!(
                "Köszönöm a kérdést! Röviden összefoglalva: {}\n{}\n\nA teljes leírást és példákat ezen az oldalon találják: {}{}\n\n{}",
                project.value_proposition, offer_part, target_url, booking_part, settings.company_signature
            ),
            should_include_booking_link: !project.booking_url.trim().is_empty(),
            summary: "Érdeklődő kérdés érkezett — AI válasz elkészült és időzítésre kész.".to_string(),
        };
    }

    let booking_part = if !project.booking_url.trim().is_empty() {
        format!("\n\nHa megfelel egy rövid 15 perces bemutató, itt választhatnak időpontot: {}", project.booking_url)
    } else {
        String::new()
    };

    ReplyClassification {
        intent: "interested".to_string(),
        suggested_reply: format!(
            "Köszönöm a visszajelzést! Örülök, hogy releváns lehet a(z) {} számára a megoldásunk.\n\nA legfontosabb részleteket és az aktuális ajánlatot itt nézhetik meg: {}{}\n\n{}",
            lead.company_name, target_url, booking_part, settings.company_signature
        ),
        should_include_booking_link: !project.booking_url.trim().is_empty(),
        summary: "Pozitív / érdeklődő válasz érkezett.".to_string(),
    }
}

/// Rewrites an email draft or inbox auto-reply strictly following the user's comment/instruction
pub async fn rewrite_email_with_instruction(
    settings: &AppSettings,
    project: Option<&Project>,
    offer: Option<&Offer>,
    lead: &Lead,
    thread_history: &[EmailMessage],
    current_subject: &str,
    current_body: &str,
    instruction: &str,
) -> Result<GeneratedEmail, String> {
    let history_text = thread_history
        .iter()
        .rev()
        .take(5)
        .rev()
        .map(|m| {
            format!(
                "[{}]: {}",
                if m.direction == "inbound" { "ÜGYFÉL" } else { "MI" },
                m.body.chars().take(500).collect::<String>()
            )
        })
        .collect::<Vec<_>>()
        .join("\n---\n");

    if has_live_ai(settings) {
        let system = "Te egy profi B2B kommunikációs szövegíró vagy. A felhasználó megjegyzése / instrukciója alapján írd át a meglévő e-mail tervezetet MAGYAR nyelven. Tartsd meg a lényegi tényeket (linkek, ajánlat, aláírás, ha a felhasználó mást nem kér), legyen természetes és emberi. Kizárólag JSON-t adj vissza: {\"subject\":\"...\",\"body\":\"...\"}";
        let user = format!(
            "FELHASZNÁLÓ MEGJEGYZÉSE / ÁTÍRÁSI UTASÍTÁS:\n{}\n\nJELENLEGI TÁRGY: {}\nJELENLEGI LEVÉLSZÖVEG:\n{}\n\nCÉG: {} ({})\nMiben segíthetünk:\n{}\nSAJÁT PROJEKT: {}\nAJÁNLAT: {}\nFOGLALÁSI LINK: {}\nLANDING LINK: {}\nALÁÍRÁS:\n{}\n\nELŐZMÉNYEK:\n{}",
            instruction,
            current_subject,
            current_body,
            lead.company_name,
            lead.industry,
            lead.how_we_can_help,
            project.map(|p| format!("{} — {}", p.name, p.value_proposition)).unwrap_or_else(|| "Nincs".into()),
            offer.map(|o| format!("{} ({}) — {}", o.title, o.discount_value, o.description)).unwrap_or_else(|| "Nincs".into()),
            project.map(|p| p.booking_url.as_str()).unwrap_or(""),
            project.map(|p| p.landing_url.as_str()).unwrap_or(""),
            settings.company_signature,
            if history_text.is_empty() { "Nincs".into() } else { history_text },
        );
        let json_str = call_llm_json(settings, system, &user).await?;
        let parsed = serde_json::from_str::<GeneratedEmail>(&json_str)
            .map_err(|_| "Az AI nem érvényes JSON formátumban adta vissza az átírt levelet.".to_string())?;
        if !parsed.body.trim().is_empty() {
            return Ok(GeneratedEmail {
                subject: if parsed.subject.trim().is_empty() {
                    current_subject.to_string()
                } else {
                    parsed.subject
                },
                body: parsed.body,
            });
        }
    }

    // Heuristic fallback if live AI is unavailable
    let lower = instruction.to_lowercase();
    let mut next_body = current_body.to_string();
    if lower.contains("rövid") || lower.contains("rovid") || lower.contains("tömör") {
        let lines: Vec<&str> = current_body.lines().filter(|l| !l.trim().is_empty()).collect();
        next_body = lines.into_iter().take(4).collect::<Vec<_>>().join("\n\n");
        if !settings.company_signature.trim().is_empty() && !next_body.contains(settings.company_signature.trim()) {
            next_body.push_str(&format!("\n\n{}", settings.company_signature));
        }
    } else if lower.contains("foglal") || lower.contains("időpont") || lower.contains("idopont") {
        if let Some(url) = project.map(|p| p.booking_url.as_str()).filter(|u| !u.is_empty()) {
            if !next_body.contains(url) {
                next_body.push_str(&format!("\n\nItt tud közvetlenül időpontot választani: {}", url));
            }
        }
    } else {
        next_body = format!("{}\n\n(Megjegyzés alapján kiegészítve: {})", current_body.trim(), instruction.trim());
    }
    Ok(GeneratedEmail {
        subject: current_subject.to_string(),
        body: next_body,
    })
}

/// AI Search Optimizer: fixes, sharpens, and configures a SearchJob based on the Project + user's goal
pub async fn optimize_search_config(
    settings: &AppSettings,
    project: &Project,
    current: &SearchJobInput,
    instruction: &str,
) -> SearchOptimizationResult {
    let offers_json: Vec<Value> = project
        .offers
        .iter()
        .map(|o| json!({ "id": o.id, "title": o.title, "discountValue": o.discount_value, "description": o.description }))
        .collect();

    if has_live_ai(settings) {
        let system = "Te egy senior B2B lead-generálási és keresés-optimalizálási szakértő vagy. A saját projekt adatai, ajánlatai és a felhasználó instrukciója alapján optimalizáld a keresési paramétereket MAGYAR nyelven, hogy maximális relevanciájú, konvertálható cégeket találjon a rendszer. Kizárólag JSON-t adj vissza pontosan ezekkel a kulcsokkal: name, query (tömör, ütős keresőszó város nélkül), industry, location, company_size ('any'|'1-10'|'11-50'|'51-200'|'200+'), target_problem (konkrét, weboldalon ellenőrizhető hiányosság), source ('smart_hybrid'|'duckduckgo'|'gmaps_scraper'|'ai_cli_search'|'osm'), max_results (10..40), auto_enrich_threshold (60..85), offer_id (null vagy a legjobban illő ajánlat ID-ja), reasoning (2-3 mondat magyarul, miért így állítottad be).";
        let user = format!(
            "SAJÁT PROJEKT:\nNév: {}\nÉrtékajánlat: {}\nCélközönség: {}\nMegoldott problémák: {:?}\nAjánlatok: {}\n\nJELENLEGI KERESÉS:\nNév: {}\nKulcsszó: {}\nIparág: {}\nLokáció: {}\nCégméret: {}\nCélprobléma: {}\nForrás: {}\n\nFELHASZNÁLÓ KÉRÉSE / CÉLJA:\n{}",
            project.name,
            project.value_proposition,
            project.target_audience,
            project.pain_points_solved,
            serde_json::to_string(&offers_json).unwrap_or_default(),
            current.name,
            current.query,
            current.industry,
            current.location,
            current.company_size,
            current.target_problem,
            current.source,
            if instruction.trim().is_empty() {
                "Fixáld és optimalizáld ezt a keresést a projektemhez a legjobb találati arányért!"
            } else {
                instruction
            }
        );

        let ai_err: Option<String> = match call_llm_json(settings, system, &user).await {
            Ok(json_str) => {
                if let Ok(v) = serde_json::from_str::<Value>(&json_str) {
                    return SearchOptimizationResult {
                        name: v["name"].as_str().unwrap_or(&current.name).to_string(),
                        query: v["query"].as_str().unwrap_or(&current.query).to_string(),
                        industry: v["industry"].as_str().unwrap_or(&current.industry).to_string(),
                        location: v["location"].as_str().unwrap_or(&current.location).to_string(),
                        company_size: v["company_size"].as_str().unwrap_or(&current.company_size).to_string(),
                        target_problem: v["target_problem"].as_str().unwrap_or(&current.target_problem).to_string(),
                        source: v["source"].as_str().unwrap_or("smart_hybrid").to_string(),
                        max_results: v["max_results"].as_i64().unwrap_or(20).clamp(5, 50),
                        auto_enrich_threshold: v["auto_enrich_threshold"].as_i64().unwrap_or(72).clamp(50, 90),
                        offer_id: v["offer_id"].as_str().map(|s| s.to_string()).filter(|s| !s.is_empty()),
                        reasoning: v["reasoning"]
                            .as_str()
                            .unwrap_or("A keresési paramétereket a projekt célközönségéhez és értékajánlatához igazítottam.")
                            .to_string(),
                        ai_error: None,
                    };
                }
                Some("Az AI modell nem érvényes JSON formátumban válaszolt.".into())
            }
            Err(e) => Some(e),
        };
        // Fall through with explicit ai_error so UI tells the user!
        return SearchOptimizationResult {
            name: if current.name.trim().is_empty() {
                format!("{} — optimalizált keresés", if current.location.is_empty() { "Budapest" } else { &current.location })
            } else {
                current.name.clone()
            },
            query: if current.query.trim().is_empty() { project.industry.clone() } else { current.query.clone() },
            industry: if current.industry.trim().is_empty() { current.query.clone() } else { current.industry.clone() },
            location: if current.location.trim().is_empty() { "Budapest".into() } else { current.location.clone() },
            company_size: if current.company_size == "any" { "11-50".into() } else { current.company_size.clone() },
            target_problem: if !instruction.trim().is_empty() {
                instruction.trim().to_string()
            } else {
                current.target_problem.clone()
            },
            source: "smart_hybrid".into(),
            max_results: current.max_results.max(20).min(40),
            auto_enrich_threshold: 72,
            offer_id: current.offer_id.clone().or_else(|| project.offers.first().map(|o| o.id.clone())),
            reasoning: "Az AI modell nem adott használható választ, ezért az alap optimalizálási szabályokat alkalmaztam.".into(),
            ai_error: ai_err,
        };
    }

    // Smart deterministic optimizer fallback
    let clean_q = if current.query.trim().is_empty() {
        if !project.industry.trim().is_empty() {
            project.industry.clone()
        } else {
            "magánklinika".to_string()
        }
    } else {
        current.query.trim().to_string()
    };
    let loc = if current.location.trim().is_empty() {
        "Budapest".to_string()
    } else {
        current.location.trim().to_string()
    };
    let prob = if !instruction.trim().is_empty() {
        instruction.trim().to_string()
    } else if !current.target_problem.trim().is_empty() {
        current.target_problem.clone()
    } else {
        project
            .pain_points_solved
            .first()
            .cloned()
            .unwrap_or_else(|| "Nincs online időpontfoglaló, elavult mobil nézet vagy hiányzó konverziómérés".to_string())
    };

    SearchOptimizationResult {
        name: if current.name.trim().is_empty() {
            format!("{} {} — optimalizált keresés", loc, clean_q)
        } else {
            current.name.clone()
        },
        query: clean_q.clone(),
        industry: if current.industry.trim().is_empty() { clean_q } else { current.industry.clone() },
        location: loc,
        company_size: if current.company_size == "any" { "11-50".into() } else { current.company_size.clone() },
        target_problem: prob,
        source: "smart_hybrid".to_string(),
        max_results: current.max_results.max(20).min(40),
        auto_enrich_threshold: 72,
        offer_id: current.offer_id.clone().or_else(|| project.offers.first().map(|o| o.id.clone())),
        reasoning: "Átállítottam Okos Hibrid (DDGS + OSM + Scraper) módra a stabil találatokért, beállítottam a 72-es mély-kutatási küszöböt és hozzárendeltem a projekt fő ajánlatát.".to_string(),
        ai_error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_random_business_send_time_respects_workdays_and_hours() {
        let settings = AppSettings::default();
        for _ in 0..50 {
            let iso = compute_random_business_send_time(&settings);
            let utc_dt = chrono::DateTime::parse_from_rfc3339(&iso).expect("valid RFC3339");
            let local_dt = utc_dt.with_timezone(&Local);
            let wd = local_dt.weekday().number_from_monday() as u8;
            assert!(
                settings.auto_reply_workdays.contains(&wd),
                "Expected workday in {:?}, got {} ({})",
                settings.auto_reply_workdays,
                wd,
                local_dt
            );
            assert!(
                local_dt.hour() >= settings.auto_reply_start_hour as u32
                    && local_dt.hour() < settings.auto_reply_end_hour as u32,
                "Expected hour in {}..{}, got {}",
                settings.auto_reply_start_hour,
                settings.auto_reply_end_hour,
                local_dt.hour()
            );
        }
    }
}
