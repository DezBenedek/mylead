use crate::crawler::CrawledSiteData;
use crate::models::{AiModelOption, AppSettings, Lead, LocalCliStatus, Offer, Project, SearchJob, SearchJobInput, SearchOptimizationResult, WebsiteAudit};
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
    pub employee_estimate: String,
    pub company_summary: String,
    pub pain_points: Vec<String>,
    pub how_we_can_help: String,
    pub recommended_pitch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedEmail {
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplyClassification {
    pub intent: String, // interested | booking_request | question | objection | not_interested | out_of_office | unsubscribe
    pub suggested_reply: String,
    pub should_include_booking_link: bool,
    pub summary: String,
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

    let output = tokio::time::timeout(Duration::from_secs(40), child.wait_with_output())
        .await
        .map_err(|_| "Az AI modell (Claude CLI) nem adott választ 40 másodpercen belül (időtúllépés).".to_string())?
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

    let output = tokio::time::timeout(Duration::from_secs(40), cmd.output())
        .await
        .map_err(|_| {
            format!(
                "Az AI modell (OpenCode CLI / {}) nem adott választ 40 másodpercen belül (időtúllépés). Próbálj másik modellt a Beállításokban!",
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
        .unwrap_or("általános digitális, ügyfélszerzési vagy konverziós hiányosságok");

    if has_live_ai(settings) {
        let system = "Te egy B2B lead-minősítő és üzletfejlesztési elemző vagy. Elemezd a célcéget és a weboldal-auditját a saját projektünk és ajánlatunk szemszögéből MAGYAR nyelven. Adj vissza kizárólag JSON-t ezekkel a kulcsokkal: fit_score (0..100 integer), employee_estimate (string, pl. '10-25 fő'), company_summary (string, 2-3 mondat), pain_points (string[]), how_we_can_help (string), recommended_pitch (string).";
        let user = format!(
            "SAJÁT PROJEKT:\nNév: {}\nÉrtékajánlat: {}\nMegoldott problémák: {:?}\nKiválasztott ajánlat: {}\nKeresett specifikus probléma: {}\n\nCÉLCÉG:\nNév: {}\nWeboldal: {}\nIparág: {}\nLokáció: {}\nGoogle értékelés: {:?} ({:?} értékelés)\nWeboldal audit: {}\nWeboldal szövegrészlet:\n{}",
            project.name,
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
            crawled_text.chars().take(5000).collect::<String>()
        );
        if let Ok(json_str) = call_llm_json(settings, system, &user).await {
            if let Ok(mut parsed) = serde_json::from_str::<LeadAiAnalysis>(&json_str) {
                parsed.fit_score = parsed.fit_score.clamp(0, 100);
                return parsed;
            }
        }
    }

    // Deterministic high-signal scoring based on real audit findings
    let mut score = 48i64;
    let mut pain_points = Vec::new();
    let mut employee_estimate = if !lead.employee_estimate.is_empty() {
        lead.employee_estimate.clone()
    } else {
        "5–20 fő (becsült)".to_string()
    };

    if let Some(a) = audit {
        if !a.reachable {
            score += 18;
            pain_points.push("A weboldal jelenleg nem elérhető vagy hibát ad vissza".to_string());
        } else {
            if !a.has_https {
                score += 12;
                pain_points.push("Hiányzó SSL (nem biztonságos HTTP oldal)".to_string());
            }
            if !a.has_mobile_viewport {
                score += 12;
                pain_points.push("Nem mobilbarát kialakítás".to_string());
            }
            if !a.has_booking_system {
                score += 14;
                pain_points.push("Nincs online időpontfoglalási lehetőség a weboldalon".to_string());
            }
            if !a.has_analytics {
                score += 9;
                pain_points.push("Nincs telepített analitika vagy konverziókövetés".to_string());
            }
            if !a.has_chat_widget {
                score += 6;
                pain_points.push("Nincs élő chat / azonnali ügyfélkezelés".to_string());
            }
            if a.load_time_ms > 2500 {
                score += 7;
                pain_points.push(format!("Lassú weboldal betöltés ({} ms)", a.load_time_ms));
            }
            if !a.extracted_emails.is_empty() {
                score += 8; // Reachable contact boosts actionability
            }
            if a.pages_crawled >= 4 || a.tech_stack.len() >= 3 {
                employee_estimate = "15–50 fő (becsült)".to_string();
            }
        }
    } else if lead.website_url.trim().is_empty() {
        score += 16;
        pain_points.push("A cégnek nincs megadott saját weboldala".to_string());
        employee_estimate = "1–10 fő (becsült)".to_string();
    }

    if !target_problem.trim().is_empty() && !pain_points.iter().any(|p| p.to_lowercase().contains(&target_problem.to_lowercase())) {
        pain_points.push(format!("Keresési fókusz szempont: {}", target_problem));
    }
    if pain_points.is_empty() {
        pain_points.push("Konverzió- és ügyfélszerzési optimalizálási lehetőség".to_string());
    }

    let offer_snippet = offer
        .map(|o| format!("A „{}” ({}) ajánlatunkkal alacsony kockázattal elindítható az együttműködés.", o.title, o.discount_value))
        .unwrap_or_else(|| format!("A(z) {} megoldásunk közvetlenül orvosolja a feltárt hiányosságokat.", project.name));

    LeadAiAnalysis {
        fit_score: score.clamp(15, 96),
        employee_estimate,
        company_summary: format!(
            "{} ({}, {}) — {} szektorban aktív vállalkozás. {}",
            lead.company_name,
            if lead.location.is_empty() { "Magyarország" } else { &lead.location },
            if lead.domain.is_empty() { "nincs domain" } else { &lead.domain },
            if lead.industry.is_empty() { "B2B" } else { &lead.industry },
            audit
                .map(|a| format!("Weboldal-audit alapján {} potenciális fejlesztési pont azonosítva.", a.detected_issues.len()))
                .unwrap_or_else(|| "Weboldal-audit még függőben vagy nincs weboldal.".to_string())
        ),
        pain_points: pain_points.clone(),
        how_we_can_help: format!(
            "A(z) {} segítségével megszüntethetők a legfőbb akadályok ({}). {}",
            project.name,
            pain_points.iter().take(2).cloned().collect::<Vec<_>>().join("; "),
            offer_snippet
        ),
        recommended_pitch: format!(
            "Hivatkozz a(z) {} oldalán talált konkrét pontra ({}), majd ajánld fel a(z) {} lehetőséget egy rövid egyeztetéssel.",
            lead.company_name,
            pain_points.first().cloned().unwrap_or_else(|| "online ügyfélszerzés".into()),
            offer.map(|o| o.title.as_str()).unwrap_or(&project.name)
        ),
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
        let system = "Te egy tapasztalt B2B sales szövegíró vagy. Írj egy természetes, emberi, NEM sablonos, nem spammy hideg e-mailt a megadott cégnek a valós weboldal-audit alapján. Ne használj túlzó marketing-kliséket vagy felkiáltójel-áradatot. Kizárólag JSON-t adj vissza: {\"subject\":\"...\",\"body\":\"...\"}";
        let user = format!(
            "Nyelv: {}\nHangnem: {}\nSaját cég/projekt: {} ({})\nÉrtékajánlat: {}\nLanding oldal: {}\nIdőpontfoglaló link: {}\nIdőpontfoglaló beillesztése az első levélbe: {}\nAjánlat / kedvezmény: {}\nExtra utasítás: {}\nAláírás:\n{}\n\nCÉLCÉG:\nNév: {}\nWeboldal: {}\nFeltárt problémák: {:?}\nMiben tudunk segíteni: {}\nJavasolt szög: {}",
            language,
            tone_desc,
            project.name,
            project.website_url,
            project.value_proposition,
            project.landing_url,
            project.booking_url,
            include_booking_link,
            offer.map(|o| format!("{} ({}) - {}", o.title, o.discount_value, o.description)).unwrap_or_else(|| "Nincs kiemelt kedvezmény".into()),
            custom_instructions,
            settings.company_signature,
            lead.company_name,
            lead.website_url,
            lead.pain_points,
            lead.how_we_can_help,
            lead.recommended_pitch
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
        .unwrap_or_else(|| "az online érdeklődőszerzésben még komoly tartalék van".to_string());

    let offer_line = offer
        .map(|o| format!("Jelenleg egy kiemelt ajánlattal is tudunk indulni: {} ({}). {}", o.title, o.discount_value, o.description))
        .unwrap_or_else(|| format!("A(z) {} segítségével gyorsan, mérhetően javítható ez a terület.", project.name));

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
        "\nHa aktuális lehet a téma, elég egy rövid válasz erre a levélre, és szívesen átküldöm a részleteket vagy egyeztetünk 15 percben.".to_string()
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
) -> ReplyClassification {
    if has_live_ai(settings) {
        let system = "Te egy profi B2B értékesítési asszisztens vagy. Elemezd az ügyfél válaszát, osztályozd a szándékát, és írj rá természetes, konverzióra fókuszáló választ MAGYAR nyelven. Ha időpontot, hívást, bemutatót vagy találkozót kér, illeszd be a projekt időpontfoglaló linkjét! Ha kérdez vagy érdeklődik, válaszolj pontosan és csábítsd a weboldalra/ajánlatra. Kizárólag JSON-t adj vissza: {\"intent\":\"interested|booking_request|question|objection|not_interested|out_of_office|unsubscribe\",\"suggested_reply\":\"...\",\"should_include_booking_link\":true|false,\"summary\":\"...\"}";
        let user = format!(
            "Saját projekt: {} ({})\nLanding URL: {}\nIdőpontfoglaló URL: {}\nAjánlat: {}\nÉrtékajánlat: {}\nKifogáskezelés: {:?}\nAláírás:\n{}\n\nÜGYFÉL ({}):\n{}",
            project.name,
            project.website_url,
            project.landing_url,
            project.booking_url,
            offer.map(|o| format!("{} ({}) - {}", o.title, o.discount_value, o.description)).unwrap_or_else(|| "Nincs".into()),
            project.value_proposition,
            project.objection_handlers,
            settings.company_signature,
            lead.company_name,
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
    let question_kw = ["?", "mennyibe", "ár", "ar ", "hogyan", "részletek", "reszletek", "milyen"];

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
                "Nagyon örülök az érdeklődésnek! Szívesen átbeszéljük röviden, hogyan tudunk segíteni a(z) {} számára.\n\n{}\n\nAddig is a részleteket és referenciákat itt találják: {}\n\n{}",
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
                "Köszönöm a kérdést! Röviden összefoglalva: {}\n{}\n\nA teljes leírást és esettanulmányokat ezen az oldalon találják: {}{}\n\n{}",
                project.value_proposition, offer_part, target_url, booking_part, settings.company_signature
            ),
            should_include_booking_link: !project.booking_url.trim().is_empty(),
            summary: "Érdeklődő kérdés érkezett — tájékoztatás + weboldal és foglalási link javasolt.".to_string(),
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
            "Köszönöm a visszajelzést! Örülök, hogy releváns lehet a(z) {} számára a megoldásunk.\n\nA legfontosabb részleteket és a kedvezményes indulási feltételeket itt nézhetik meg: {}{}\n\n{}",
            lead.company_name, target_url, booking_part, settings.company_signature
        ),
        should_include_booking_link: !project.booking_url.trim().is_empty(),
        summary: "Pozitív / érdeklődő válasz érkezett.".to_string(),
    }
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
