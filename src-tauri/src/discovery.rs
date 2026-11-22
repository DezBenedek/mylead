use crate::ai::resolve_cli_binary;
use crate::crawler::{extract_domain, normalize_url};
use crate::models::{AppSettings, DiscoveryToolStatus, SearchJob};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use url::Url;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct DiscoveredCompany {
    pub company_name: String,
    pub website_url: String,
    pub industry: String,
    pub location: String,
    pub address: String,
    pub phone: String,
    pub email: String,
    pub google_rating: Option<f64>,
    pub google_reviews: Option<i64>,
    pub source: String,
}

/// Aggregators, social networks, news portals, and business directories to exclude from direct B2B company leads
const NOISE_DOMAINS: &[&str] = &[
    "facebook.com",
    "instagram.com",
    "tiktok.com",
    "youtube.com",
    "youtu.be",
    "linkedin.com",
    "x.com",
    "twitter.com",
    "pinterest.com",
    "reddit.com",
    "wikipedia.org",
    "wikimedia.org",
    "google.com",
    "google.hu",
    "maps.google.com",
    "openstreetmap.org",
    "aranyoldalak.hu",
    "ceginformacio.hu",
    "nemzeticegtar.hu",
    "e-cegjegyzek.hu",
    "opten.hu",
    "companywall.hu",
    "cylex.hu",
    "cylex-tudakozo.hu",
    "tudakozo.hu",
    "ittlakunk.hu",
    "profession.hu",
    "indeed.com",
    "glassdoor.com",
    "tripadvisor.com",
    "tripadvisor.co.hu",
    "booking.com",
    "szallas.hu",
    "foglaljorvost.hu",
    "doklist.com",
    "hazipatika.com",
    "webbeteg.hu",
    "yelp.com",
    "yellowpages.com",
    "trustpilot.com",
    "startlap.hu",
    "lap.hu",
    "index.hu",
    "telex.hu",
    "24.hu",
    "hvg.hu",
    "portfolio.hu",
    "origo.hu",
    "blikk.hu",
    "jofogas.hu",
    "vatera.hu",
    "arukereso.hu",
    "emag.hu",
    "amazon.com",
    "wolt.com",
    "foodora.hu",
    "netpincer.hu",
];

fn enriched_path_env() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let current = std::env::var("PATH").unwrap_or_default();
    let mut parts = vec![
        format!("{}/go/bin", home),
        format!("{}/.opencode/bin", home),
        format!("{}/.local/bin", home),
        format!("{}/.cargo/bin", home),
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

pub fn resolve_tool_binary(binary: &str, custom_path: &str) -> Option<PathBuf> {
    if let Some(p) = resolve_cli_binary(binary, custom_path) {
        return Some(p);
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let go_bin = PathBuf::from(format!("{}/go/bin/{}", home, binary));
    if go_bin.exists() && go_bin.is_file() {
        return Some(go_bin);
    }
    None
}

fn is_noise_domain(domain: &str) -> bool {
    let d = domain.trim().to_lowercase();
    if d.is_empty() {
        return false;
    }
    NOISE_DOMAINS
        .iter()
        .any(|noise| d == *noise || d.ends_with(&format!(".{}", noise)))
}

fn to_root_homepage(raw_url: &str) -> String {
    if let Some(norm) = normalize_url(raw_url) {
        if let Ok(parsed) = Url::parse(&norm) {
            if let Some(host) = parsed.host_str() {
                return format!("{}://{}", parsed.scheme(), host);
            }
        }
    }
    raw_url.trim().to_string()
}

fn clean_company_title(raw: &str, domain: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return domain.to_string();
    }
    // Strip common SEO suffixes like " | Fogászat Budapest - Főoldal"
    let separators = [" | ", " — ", " – ", " - ", " :: ", " • "];
    let mut best = trimmed.to_string();
    for sep in separators {
        if let Some((left, right)) = best.split_once(sep) {
            let l = left.trim();
            let r = right.trim();
            // Prefer the shorter brand-like segment unless it's generic like "Főoldal" or "Kezdőlap"
            let generic_left = ["főoldal", "kezdőlap", "home", "kapcsolat", "árak", "szolgáltatások"]
                .iter()
                .any(|g| l.to_lowercase() == *g);
            if generic_left && !r.is_empty() {
                best = r.to_string();
            } else if l.len() >= 3 {
                best = l.to_string();
            }
        }
    }
    if best.len() > 80 {
        best = best.chars().take(80).collect::<String>().trim().to_string();
    }
    best
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(25))
        .user_agent("MyLeadDesktop/0.2 (B2B Lead Discovery)")
        .build()
        .map_err(|e| format!("HTTP kliens hiba: {}", e))
}

/// Detect which open-source search & scraping tools are ready on this machine
pub async fn detect_discovery_tools(settings: &AppSettings) -> Vec<DiscoveryToolStatus> {
    let has_uvx = resolve_tool_binary("uvx", "").is_some();
    let has_go = resolve_tool_binary("go", "").is_some();
    let gmaps_bin = resolve_tool_binary("google-maps-scraper", &settings.gmaps_scraper_path);
    let opencode_bin = resolve_tool_binary("opencode", "");
    let claude_bin = resolve_tool_binary("claude", "");
    let codex_bin = resolve_tool_binary("codex", "");

    let cli_names: Vec<&str> = [
        opencode_bin.as_ref().map(|_| "OpenCode"),
        claude_bin.as_ref().map(|_| "Claude Code"),
        codex_bin.as_ref().map(|_| "Codex"),
    ]
    .into_iter()
    .flatten()
    .collect();

    vec![
        DiscoveryToolStatus {
            id: "duckduckgo".into(),
            name: "DuckDuckGo / DDGS Nyílt Webkereső".into(),
            available: has_uvx,
            detail: if has_uvx {
                "Kész (uvx + ddgs, API kulcs nélkül, több keresőmotor)".into()
            } else {
                "Telepítsd az 'uv' eszközt (brew install uv) a DDGS használatához".into()
            },
            installable: false,
        },
        DiscoveryToolStatus {
            id: "gmaps_scraper".into(),
            name: "Open-Source Google Maps Scraper (gosom)".into(),
            available: gmaps_bin.is_some(),
            detail: match gmaps_bin {
                Some(ref p) => format!("Telepítve: {}", p.to_string_lossy()),
                None if has_go => "Nincs még telepítve — 1 kattintással telepíthető Go-val!".into(),
                None => "Go szükséges (brew install go), utána telepíthető.".into(),
            },
            installable: gmaps_bin.is_none() && has_go,
        },
        DiscoveryToolStatus {
            id: "ai_cli_search".into(),
            name: "CLI Beépített Webkereső (OpenCode / Claude / Codex)".into(),
            available: !cli_names.is_empty(),
            detail: if cli_names.is_empty() {
                "Nincs telepített AI CLI".into()
            } else {
                format!("Elérhető CLI keresők: {}", cli_names.join(", "))
            },
            installable: false,
        },
        DiscoveryToolStatus {
            id: "osm".into(),
            name: "OpenStreetMap (Nominatim + Overpass)".into(),
            available: true,
            detail: "Mindig elérhető, ingyenes (címek, telefonok, térképes POI-k)".into(),
            installable: false,
        },
        DiscoveryToolStatus {
            id: "searxng".into(),
            name: "SearXNG (Nyílt forráskódú Meta-kereső)".into(),
            available: !settings.searxng_url.trim().is_empty(),
            detail: if settings.searxng_url.trim().is_empty() {
                "Opcionális — adj meg egy saját SearXNG JSON URL-t lent".into()
            } else {
                format!("Konfigurálva: {}", settings.searxng_url)
            },
            installable: false,
        },
    ]
}

/// 1-click installer for gosom/google-maps-scraper via Go
pub async fn install_gmaps_scraper() -> Result<String, String> {
    let go_bin = resolve_tool_binary("go", "")
        .ok_or_else(|| "A 'go' fordító nem található (telepítsd: brew install go).".to_string())?;

    let output = tokio::time::timeout(
        Duration::from_secs(180),
        Command::new(&go_bin)
            .args(["install", "github.com/gosom/google-maps-scraper@latest"])
            .env("PATH", enriched_path_env())
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Telepítési időtúllépés (3 perc).".to_string())?
    .map_err(|e| format!("Go futtatási hiba: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("google-maps-scraper telepítési hiba: {}", stderr.trim()));
    }

    let installed_path = resolve_tool_binary("google-maps-scraper", "")
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "~/go/bin/google-maps-scraper".to_string());

    Ok(format!("Sikeresen telepítve: {}", installed_path))
}

/// Deduplicates & merges companies from multiple discovery engines, prioritizing companies with websites + contact details
fn merge_and_rank_companies(raw: Vec<DiscoveredCompany>, limit: usize) -> Vec<DiscoveredCompany> {
    let mut by_key: HashMap<String, DiscoveredCompany> = HashMap::new();

    for mut c in raw {
        let domain = extract_domain(&c.website_url);
        if is_noise_domain(&domain) {
            continue;
        }
        if !c.website_url.trim().is_empty() {
            c.website_url = to_root_homepage(&c.website_url);
        }
        let clean_name = clean_company_title(&c.company_name, &domain);
        if clean_name.trim().len() < 2 {
            continue;
        }
        c.company_name = clean_name;

        let key = if !domain.is_empty() {
            format!("dom:{}", domain)
        } else {
            format!("name:{}", c.company_name.to_lowercase())
        };

        by_key
            .entry(key)
            .and_modify(|existing| {
                if existing.website_url.is_empty() && !c.website_url.is_empty() {
                    existing.website_url = c.website_url.clone();
                }
                if existing.address.is_empty() && !c.address.is_empty() {
                    existing.address = c.address.clone();
                }
                if existing.phone.is_empty() && !c.phone.is_empty() {
                    existing.phone = c.phone.clone();
                }
                if existing.email.is_empty() && !c.email.is_empty() {
                    existing.email = c.email.clone();
                }
                if existing.google_rating.is_none() && c.google_rating.is_some() {
                    existing.google_rating = c.google_rating;
                    existing.google_reviews = c.google_reviews;
                }
                if !existing.source.contains(&c.source) {
                    existing.source = format!("{} + {}", existing.source, c.source);
                }
            })
            .or_insert(c);
    }

    let mut list: Vec<DiscoveredCompany> = by_key.into_values().collect();
    // Rank highest-value leads first: has website + has email/phone/rating + multi-source corroborated
    list.sort_by_key(|c| {
        let mut score = 0i32;
        if !c.website_url.is_empty() {
            score += 40;
        }
        if !c.email.is_empty() {
            score += 20;
        }
        if !c.phone.is_empty() {
            score += 10;
        }
        if !c.address.is_empty() {
            score += 8;
        }
        if c.google_rating.is_some() {
            score += 12;
        }
        if c.source.contains('+') {
            score += 15;
        }
        -score
    });
    list.truncate(limit);
    list
}

#[allow(dead_code)]
pub async fn discover_companies(
    search: &SearchJob,
    settings: &AppSettings,
) -> Result<Vec<DiscoveredCompany>, String> {
    discover_companies_for_round(search, settings, 1).await
}

/// Multi-round discovery for continuous ("run until stopped") searches!
/// Round 1 uses exact query/location; Rounds 2+ intelligently expand modifiers, Hungarian districts/regions, and commercial keywords so each round discovers fresh companies!
pub async fn discover_companies_for_round(
    search: &SearchJob,
    settings: &AppSettings,
    round: usize,
) -> Result<Vec<DiscoveredCompany>, String> {
    let limit = search.max_results.clamp(1, 60) as usize;
    let mut expanded = search.clone();

    if round > 1 {
        let loc_lower = search.location.to_lowercase();
        let bp_districts = [
            "Budapest I. kerület", "Budapest II. kerület", "Budapest III. kerület",
            "Budapest V. kerület", "Budapest VI. kerület", "Budapest VII. kerület",
            "Budapest IX. kerület", "Budapest XI. kerület", "Budapest XII. kerület",
            "Budapest XIII. kerület", "Budapest XIV. kerület", "Pest megye",
        ];
        let hu_cities = [
            "Debrecen", "Győr", "Szeged", "Pécs", "Miskolc", "Székesfehérvár",
            "Kecskemét", "Nyíregyháza", "Szombathely", "Veszprém", "Eger", "Sopron",
        ];
        let modifiers = [
            "szolgáltatások", "árlista", "kapcsolat", "referenciák",
            "Kft", "Bt", "stúdió", "központ", "magán", "szakértő",
        ];

        let modifier = modifiers[(round - 2) % modifiers.len()];
        if loc_lower.contains("budapest") {
            let dist = bp_districts[(round - 2) % bp_districts.len()];
            expanded.location = dist.to_string();
            expanded.query = format!("{} {}", search.query.trim(), modifier);
        } else if search.location.trim().is_empty() || loc_lower.contains("magyar") || loc_lower.contains("országos") {
            let city = hu_cities[(round - 2) % hu_cities.len()];
            expanded.location = city.to_string();
        } else {
            expanded.query = format!("{} {}", search.query.trim(), modifier);
        }
    }

    match expanded.source.as_str() {
        "smart_hybrid" => discover_smart_hybrid(&expanded, settings, limit).await,
        "duckduckgo" => {
            let list = discover_via_ddgs(&expanded, limit).await?;
            Ok(merge_and_rank_companies(list, limit))
        }
        "gmaps_scraper" => {
            let list = discover_via_gmaps_scraper(&expanded, settings, limit).await?;
            Ok(merge_and_rank_companies(list, limit))
        }
        "ai_cli_search" => {
            let list = discover_via_ai_cli(&expanded, settings, limit).await?;
            Ok(merge_and_rank_companies(list, limit))
        }
        "searxng" => {
            let list = discover_via_searxng(&expanded, settings, limit).await?;
            Ok(merge_and_rank_companies(list, limit))
        }
        "google_places" => {
            if settings.google_places_api_key.trim().is_empty() {
                return Err("Google Places API kulcs nincs beállítva a Beállítások menüben. Válts „Okos Hibrid”, „DuckDuckGo” vagy „Open-Source Google Maps Scraper” forrásra!".to_string());
            }
            let list = discover_via_google_places(&expanded, &settings.google_places_api_key, limit).await?;
            Ok(merge_and_rank_companies(list, limit))
        }
        "serper" => {
            if settings.serper_api_key.trim().is_empty() {
                return Err("Serper.dev API kulcs nincs beállítva a Beállítások menüben.".to_string());
            }
            let list = discover_via_serper_maps(&expanded, &settings.serper_api_key, limit).await?;
            Ok(merge_and_rank_companies(list, limit))
        }
        _ => {
            let mut list = discover_via_osm_upgraded(&expanded, limit).await?;
            let with_web = list.iter().filter(|c| !c.website_url.is_empty()).count();
            if with_web < 3 {
                if let Ok(mut ddg_extra) = discover_via_ddgs(&expanded, limit).await {
                    list.append(&mut ddg_extra);
                }
            }
            Ok(merge_and_rank_companies(list, limit))
        }
    }
}

/// Multi-engine parallel hybrid search: DDGS + Upgraded OSM + (optional) gosom Google Maps Scraper + (optional) CLI websearch fallback
async fn discover_smart_hybrid(
    search: &SearchJob,
    settings: &AppSettings,
    limit: usize,
) -> Result<Vec<DiscoveredCompany>, String> {
    let has_gmaps = resolve_tool_binary("google-maps-scraper", &settings.gmaps_scraper_path).is_some();
    let has_searx = !settings.searxng_url.trim().is_empty();

    let (ddg_res, osm_res, gmaps_res, searx_res) = tokio::join!(
        discover_via_ddgs(search, limit),
        discover_via_osm_upgraded(search, limit),
        async {
            if has_gmaps {
                discover_via_gmaps_scraper(search, settings, limit).await
            } else {
                Ok(vec![])
            }
        },
        async {
            if has_searx {
                discover_via_searxng(search, settings, limit).await
            } else {
                Ok(vec![])
            }
        }
    );

    let mut combined = Vec::new();
    let mut errors = Vec::new();

    for (name, res) in [
        ("DDGS", ddg_res),
        ("OSM", osm_res),
        ("GMapsScraper", gmaps_res),
        ("SearXNG", searx_res),
    ] {
        match res {
            Ok(mut items) => combined.append(&mut items),
            Err(e) => errors.push(format!("{}: {}", name, e)),
        }
    }

    // If still below half of desired results and an AI CLI is available, augment with live AI CLI web search!
    if combined.len() < (limit / 2).max(4) {
        if let Ok(mut cli_items) = discover_via_ai_cli(search, settings, limit.min(12)).await {
            combined.append(&mut cli_items);
        }
    }

    let merged = merge_and_rank_companies(combined, limit);
    if merged.is_empty() && !errors.is_empty() {
        return Err(format!("A hibrid keresés nem talált eredményt ({})", errors.join(" | ")));
    }
    Ok(merged)
}

/// Open-source DuckDuckGo / DDGS multi-query web search via uvx (zero API key!)
async fn discover_via_ddgs(search: &SearchJob, limit: usize) -> Result<Vec<DiscoveredCompany>, String> {
    let uvx = resolve_tool_binary("uvx", "")
        .ok_or_else(|| "Az 'uvx' (uv) nem található a DDGS kereséshez (telepítés: brew install uv).".to_string())?;

    let base_q = format!("{} {}", search.query.trim(), search.location.trim())
        .trim()
        .to_string();

    // Multi-angle Hungarian/B2B queries to maximize real company websites (not just news/articles)
    let queries = vec![
        base_q.clone(),
        format!("{} kapcsolat OR árak OR szolgáltatások", base_q),
        if !search.industry.trim().is_empty()
            && !search.industry.eq_ignore_ascii_case(&search.query)
        {
            format!("{} {} Kft OR Bt OR rendelő OR stúdió", search.industry.trim(), search.location.trim())
        } else {
            format!("{} cég OR vállalkozás OR hivatalos oldal", base_q)
        },
    ];

    let py_script = r#"
import json, sys
from ddgs import DDGS

queries = json.loads(sys.argv[1])
per_query = int(sys.argv[2])
seen = set()
out = []
ddgs = DDGS()

for q in queries:
    try:
        rows = ddgs.text(q, region="hu-hu", max_results=per_query)
        for r in (rows or []):
            href = (r.get("href") or r.get("link") or "").strip()
            if not href or href in seen:
                continue
            seen.add(href)
            out.append({
                "title": r.get("title") or "",
                "href": href,
                "body": r.get("body") or ""
            })
    except Exception:
        continue

print(json.dumps(out, ensure_ascii=False))
"#;

    let per_query = ((limit as f64 / 1.5).ceil() as usize).clamp(8, 25);
    let q_json = serde_json::to_string(&queries).unwrap_or_else(|_| "[]".into());

    let output = tokio::time::timeout(
        Duration::from_secs(22),
        Command::new(&uvx)
            .args(["--with", "ddgs", "python3", "-c", py_script, &q_json, &per_query.to_string()])
            .env("PATH", enriched_path_env())
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "DuckDuckGo (DDGS) keresés időtúllépés.".to_string())?
    .map_err(|e| format!("DDGS indítási hiba: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("DDGS hiba: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let rows: Vec<Value> = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("DDGS válasz feldolgozási hiba: {}", e))?;

    let mut out = Vec::new();
    for r in rows {
        let href = r["href"].as_str().unwrap_or_default().trim().to_string();
        let title = r["title"].as_str().unwrap_or_default().trim().to_string();
        let domain = extract_domain(&href);
        if domain.is_empty() || is_noise_domain(&domain) {
            continue;
        }
        out.push(DiscoveredCompany {
            company_name: clean_company_title(&title, &domain),
            website_url: to_root_homepage(&href),
            industry: if search.industry.trim().is_empty() {
                search.query.clone()
            } else {
                search.industry.clone()
            },
            location: search.location.clone(),
            address: String::new(),
            phone: String::new(),
            email: String::new(),
            google_rating: None,
            google_reviews: None,
            source: "DuckDuckGo / DDGS".to_string(),
        });
    }

    Ok(out)
}

/// Open-source Google Maps Scraper (https://github.com/gosom/google-maps-scraper)
async fn discover_via_gmaps_scraper(
    search: &SearchJob,
    settings: &AppSettings,
    limit: usize,
) -> Result<Vec<DiscoveredCompany>, String> {
    let bin = resolve_tool_binary("google-maps-scraper", &settings.gmaps_scraper_path)
        .ok_or_else(|| {
            "A 'google-maps-scraper' (gosom) nincs még telepítve. Kattints a Beállítások → Keresési API-k fülön a „Telepítés (Go)” gombra!".to_string()
        })?;

    let tmp_id = Uuid::new_v4();
    let input_path = std::env::temp_dir().join(format!("mylead-gmaps-in-{}.txt", tmp_id));
    let output_path = std::env::temp_dir().join(format!("mylead-gmaps-out-{}.json", tmp_id));

    let query_line = format!(
        "{} {}",
        search.query.trim(),
        search.location.trim()
    )
    .trim()
    .to_string();

    std::fs::write(&input_path, format!("{}\n", query_line))
        .map_err(|e| format!("Ideiglenes input fájl hiba: {}", e))?;

    let depth = if limit <= 15 { "1" } else { "2" };
    let run_res = tokio::time::timeout(
        Duration::from_secs(120),
        Command::new(&bin)
            .args([
                "-input",
                &input_path.to_string_lossy(),
                "-results",
                &output_path.to_string_lossy(),
                "-json",
                "-email",
                "-depth",
                depth,
                "-c",
                "2",
                "-lang",
                "hu",
                "-exit-on-inactivity",
                "30s",
            ])
            .env("PATH", enriched_path_env())
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await;

    let _ = std::fs::remove_file(&input_path);
    let raw_content = std::fs::read_to_string(&output_path).unwrap_or_default();
    let _ = std::fs::remove_file(&output_path);

    if let Ok(Ok(out)) = run_res {
        if !out.status.success() && raw_content.trim().is_empty() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("google-maps-scraper hiba: {}", err.trim()));
        }
    }

    if raw_content.trim().is_empty() {
        return Err("A google-maps-scraper nem adott vissza találatot erre a keresésre.".to_string());
    }

    // gosom/google-maps-scraper writes either JSON array OR NDJSON (one JSON object per line)
    let mut records: Vec<Value> = Vec::new();
    if let Ok(arr) = serde_json::from_str::<Vec<Value>>(&raw_content) {
        records = arr;
    } else {
        for line in raw_content.lines() {
            let t = line.trim();
            if t.starts_with('{') {
                if let Ok(obj) = serde_json::from_str::<Value>(t) {
                    records.push(obj);
                }
            }
        }
    }

    let mut out = Vec::new();
    for r in records.into_iter().take(limit * 2) {
        let name = r["title"].as_str().unwrap_or_default().trim().to_string();
        if name.is_empty() {
            continue;
        }
        let website = r["web_site"]
            .as_str()
            .or_else(|| r["website"].as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        let email = r["emails"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        let phone = r["phone"].as_str().unwrap_or_default().trim().to_string();
        let address = r["address"].as_str().unwrap_or_default().trim().to_string();
        let category = r["category"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or(&search.industry)
            .to_string();
        let rating = r["review_rating"].as_f64();
        let reviews = r["review_count"].as_i64();

        out.push(DiscoveredCompany {
            company_name: name,
            website_url: website,
            industry: category,
            location: search.location.clone(),
            address,
            phone,
            email,
            google_rating: rating,
            google_reviews: reviews,
            source: "Google Maps (Open-Source Scraper)".to_string(),
        });
    }

    Ok(out)
}

#[derive(Debug, Deserialize)]
struct CliLeadItem {
    company_name: Option<String>,
    website_url: Option<String>,
    location: Option<String>,
    address: Option<String>,
    phone: Option<String>,
    email: Option<String>,
    industry: Option<String>,
}

/// Uses the built-in web search of installed local AI CLIs (OpenCode / Claude Code / Codex)
async fn discover_via_ai_cli(
    search: &SearchJob,
    settings: &AppSettings,
    limit: usize,
) -> Result<Vec<DiscoveredCompany>, String> {
    // Choose which CLI to run based on settings.cli_search_engine (auto picks OpenCode -> Claude -> Codex)
    let preferred = settings.cli_search_engine.as_str();
    let candidates: Vec<&str> = match preferred {
        "opencode" => vec!["opencode", "claude", "codex"],
        "claude" => vec!["claude", "opencode", "codex"],
        "codex" => vec!["codex", "opencode", "claude"],
        _ => match settings.ai_provider.as_str() {
            "claude_cli" => vec!["claude", "opencode", "codex"],
            "codex_cli" => vec!["codex", "opencode", "claude"],
            _ => vec!["opencode", "claude", "codex"],
        },
    };

    let chosen = candidates
        .into_iter()
        .find_map(|b| resolve_tool_binary(b, "").map(|p| (b, p)))
        .ok_or_else(|| {
            "Nincs telepített AI CLI (opencode, claude vagy codex) a beépített webkereséshez.".to_string()
        })?;

    let (engine_name, bin_path) = chosen;
    let prompt = format!(
        r#"Használd a beépített webkeresődet, és keress pontosan {limit} VALÓDI, létező céget/vállalkozást a következő feltételekkel:
- Téma / kulcsszó: {query}
- Iparág: {industry}
- Város / régió: {location}
- Cél cégméret: {size}
- Keresett probléma / fókusz: {problem}

FONTOS SZABÁLYOK:
1. KIZÁRÓLAG valódi cégek saját hivatalos weboldalát add vissza (NE Facebook, NE Aranyoldalak, NE Céginformáció, NE gyűjtőoldal).
2. Ne találj ki domain neveket — csak olyan cégeket adj vissza, amiket a webkeresésed ténylegesen megtalált!
3. Kizárólag érvényes JSON objektumot adj vissza semmilyen magyarázat nélkül, pontosan ebben a formátumban:
{{"companies":[{{"company_name":"...","website_url":"https://...","industry":"...","location":"...","address":"...","phone":"...","email":"..."}}]}}"#,
        limit = limit.min(20),
        query = search.query,
        industry = search.industry,
        location = search.location,
        size = search.company_size,
        problem = if search.target_problem.trim().is_empty() {
            "bármilyen releváns B2B fejlesztési lehetőség"
        } else {
            &search.target_problem
        }
    );

    let raw_output = match engine_name {
        "opencode" => {
            let mut cmd = Command::new(&bin_path);
            cmd.env("PATH", enriched_path_env())
                .current_dir(std::env::temp_dir())
                .stdin(Stdio::null())
                .kill_on_drop(true)
                .args(["run", "--auto", "--archived", "--format", "default"]);
            if settings.ai_provider == "opencode_cli" && !settings.ai_model.trim().is_empty() {
                cmd.arg("--model").arg(settings.ai_model.trim());
            }
            let out = tokio::time::timeout(
                Duration::from_secs(60),
                cmd.arg(&prompt).output(),
            )
            .await
            .map_err(|_| "OpenCode CLI webkeresés időtúllépés (60 mp)".to_string())?
            .map_err(|e| format!("OpenCode CLI hiba: {}", e))?;

            if !out.status.success() {
                return Err(format!(
                    "OpenCode CLI hiba: {}",
                    String::from_utf8_lossy(&out.stderr).trim()
                ));
            }
            String::from_utf8_lossy(&out.stdout).to_string()
        }
        "claude" => {
            let mut cmd = Command::new(&bin_path);
            cmd.env("PATH", enriched_path_env())
                .current_dir(std::env::temp_dir())
                .kill_on_drop(true)
                .args([
                    "-p",
                    "--output-format",
                    "text",
                    "--no-session-persistence",
                    "--allowedTools",
                    "WebSearch",
                    "WebFetch",
                ]);
            if settings.ai_provider == "claude_cli" && !settings.ai_model.trim().is_empty() {
                cmd.arg("--model").arg(settings.ai_model.trim());
            }
            cmd.stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());

            let mut child = cmd
                .spawn()
                .map_err(|e| format!("Claude CLI indítási hiba: {}", e))?;
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(prompt.as_bytes()).await;
            }
            let out = tokio::time::timeout(Duration::from_secs(60), child.wait_with_output())
                .await
                .map_err(|_| "Claude CLI webkeresés időtúllépés (60 mp)".to_string())?
                .map_err(|e| format!("Claude CLI hiba: {}", e))?;

            if !out.status.success() {
                return Err(format!(
                    "Claude CLI hiba: {}",
                    String::from_utf8_lossy(&out.stderr).trim()
                ));
            }
            String::from_utf8_lossy(&out.stdout).to_string()
        }
        _ => {
            // Codex CLI with native --search live web search!
            let out_file = std::env::temp_dir().join(format!("mylead-codex-search-{}.txt", Uuid::new_v4()));
            let mut cmd = Command::new(&bin_path);
            cmd.env("PATH", enriched_path_env())
                .current_dir(std::env::temp_dir())
                .kill_on_drop(true)
                .args([
                    "--search",
                    "exec",
                    "--skip-git-repo-check",
                    "--ephemeral",
                    "--sandbox",
                    "read-only",
                    "--color",
                    "never",
                    "-o",
                ])
                .arg(&out_file);
            if settings.ai_provider == "codex_cli" && !settings.ai_model.trim().is_empty() {
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
                let _ = stdin.write_all(prompt.as_bytes()).await;
            }
            let out = tokio::time::timeout(Duration::from_secs(120), child.wait_with_output())
                .await
                .map_err(|_| {
                    let _ = std::fs::remove_file(&out_file);
                    "Codex CLI webkeresés időtúllépés (120 mp)".to_string()
                })?
                .map_err(|e| {
                    let _ = std::fs::remove_file(&out_file);
                    format!("Codex CLI hiba: {}", e)
                })?;
            let text = std::fs::read_to_string(&out_file).ok();
            let _ = std::fs::remove_file(&out_file);
            text.filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| String::from_utf8_lossy(&out.stdout).to_string())
        }
    };

    // Extract JSON block from CLI response
    let json_slice = if let (Some(s), Some(e)) = (raw_output.find('{'), raw_output.rfind('}')) {
        if e >= s {
            &raw_output[s..=e]
        } else {
            raw_output.trim()
        }
    } else {
        raw_output.trim()
    };

    let parsed: Value = serde_json::from_str(json_slice)
        .map_err(|_| format!("A {} CLI nem adott érvényes JSON céglistát.", engine_name))?;

    let items: Vec<CliLeadItem> = parsed["companies"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();

    let source_label = match engine_name {
        "opencode" => "OpenCode CLI Webkereső",
        "claude" => "Claude CLI WebSearch",
        _ => "Codex CLI WebSearch",
    };

    let mut out = Vec::new();
    for item in items {
        let name = item.company_name.unwrap_or_default().trim().to_string();
        let website = item.website_url.unwrap_or_default().trim().to_string();
        if name.is_empty() && website.is_empty() {
            continue;
        }
        out.push(DiscoveredCompany {
            company_name: if name.is_empty() { extract_domain(&website) } else { name },
            website_url: website,
            industry: item.industry.filter(|s| !s.is_empty()).unwrap_or_else(|| search.industry.clone()),
            location: item.location.filter(|s| !s.is_empty()).unwrap_or_else(|| search.location.clone()),
            address: item.address.unwrap_or_default(),
            phone: item.phone.unwrap_or_default(),
            email: item.email.unwrap_or_default(),
            google_rating: None,
            google_reviews: None,
            source: source_label.to_string(),
        });
    }

    Ok(out)
}

/// Self-hosted or public SearXNG open-source meta-search JSON API
async fn discover_via_searxng(
    search: &SearchJob,
    settings: &AppSettings,
    limit: usize,
) -> Result<Vec<DiscoveredCompany>, String> {
    let base = settings.searxng_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("SearXNG URL nincs beállítva a Beállítások → Keresési API-k fülön.".to_string());
    }
    let client = build_client()?;
    let q = format!("{} {} kapcsolat", search.query.trim(), search.location.trim());
    let resp = client
        .get(format!("{}/search", base))
        .query(&[("q", q.as_str()), ("format", "json"), ("language", "hu")])
        .send()
        .await
        .map_err(|e| format!("SearXNG hálózati hiba: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("SearXNG hiba ({})", resp.status()));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(arr) = v["results"].as_array() {
        for r in arr.iter().take(limit * 2) {
            let url = r["url"].as_str().unwrap_or_default();
            let title = r["title"].as_str().unwrap_or_default();
            let domain = extract_domain(url);
            if domain.is_empty() || is_noise_domain(&domain) {
                continue;
            }
            out.push(DiscoveredCompany {
                company_name: clean_company_title(title, &domain),
                website_url: to_root_homepage(url),
                industry: search.industry.clone(),
                location: search.location.clone(),
                address: String::new(),
                phone: String::new(),
                email: String::new(),
                google_rating: None,
                google_reviews: None,
                source: "SearXNG".to_string(),
            });
        }
    }
    Ok(out)
}

async fn discover_via_google_places(
    search: &SearchJob,
    api_key: &str,
    limit: usize,
) -> Result<Vec<DiscoveredCompany>, String> {
    let client = build_client()?;
    let text_query = format!(
        "{} {} {}",
        search.query.trim(),
        search.industry.trim(),
        search.location.trim()
    )
    .trim()
    .to_string();

    let resp = client
        .post("https://places.googleapis.com/v1/places:searchText")
        .header("X-Goog-Api-Key", api_key.trim())
        .header(
            "X-Goog-FieldMask",
            "places.displayName,places.formattedAddress,places.websiteUri,places.internationalPhoneNumber,places.rating,places.userRatingCount,places.primaryTypeDisplayName",
        )
        .json(&json!({
            "textQuery": text_query,
            "maxResultCount": limit.min(20),
            "languageCode": "hu"
        }))
        .send()
        .await
        .map_err(|e| format!("Google Places API hiba: {}", e))?;

    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("Google Places API hiba válasz: {}", txt));
    }

    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    if let Some(places) = v["places"].as_array() {
        for p in places.iter().take(limit) {
            let name = p["displayName"]["text"].as_str().unwrap_or_default().trim().to_string();
            if name.is_empty() {
                continue;
            }
            results.push(DiscoveredCompany {
                company_name: name,
                website_url: p["websiteUri"].as_str().unwrap_or_default().to_string(),
                industry: p["primaryTypeDisplayName"]["text"]
                    .as_str()
                    .unwrap_or(&search.industry)
                    .to_string(),
                location: search.location.clone(),
                address: p["formattedAddress"].as_str().unwrap_or_default().to_string(),
                phone: p["internationalPhoneNumber"].as_str().unwrap_or_default().to_string(),
                email: String::new(),
                google_rating: p["rating"].as_f64(),
                google_reviews: p["userRatingCount"].as_i64(),
                source: "Google Maps (Places API)".to_string(),
            });
        }
    }
    Ok(results)
}

async fn discover_via_serper_maps(
    search: &SearchJob,
    api_key: &str,
    limit: usize,
) -> Result<Vec<DiscoveredCompany>, String> {
    let client = build_client()?;
    let q = format!("{} {} {}", search.query, search.industry, search.location)
        .trim()
        .to_string();

    let resp = client
        .post("https://google.serper.dev/maps")
        .header("X-API-KEY", api_key.trim())
        .json(&json!({
            "q": q,
            "hl": "hu",
            "gl": "hu"
        }))
        .send()
        .await
        .map_err(|e| format!("Serper API hiba: {}", e))?;

    if !resp.status().is_success() {
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("Serper API hiba válasz: {}", txt));
    }

    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    if let Some(places) = v["places"].as_array() {
        for p in places.iter().take(limit) {
            let name = p["title"].as_str().unwrap_or_default().trim().to_string();
            if name.is_empty() {
                continue;
            }
            results.push(DiscoveredCompany {
                company_name: name,
                website_url: p["website"].as_str().unwrap_or_default().to_string(),
                industry: p["category"].as_str().unwrap_or(&search.industry).to_string(),
                location: search.location.clone(),
                address: p["address"].as_str().unwrap_or_default().to_string(),
                phone: p["phoneNumber"].as_str().unwrap_or_default().to_string(),
                email: String::new(),
                google_rating: p["rating"].as_f64(),
                google_reviews: p["ratingCount"].as_i64(),
                source: "Google Maps (Serper)".to_string(),
            });
        }
    }
    Ok(results)
}

/// Upgraded Dual-Pass OpenStreetMap: Nominatim free-text POI + Overpass expanded tag & name regex search
async fn discover_via_osm_upgraded(search: &SearchJob, limit: usize) -> Result<Vec<DiscoveredCompany>, String> {
    let client = build_client()?;
    let city = if search.location.trim().is_empty() {
        "Budapest"
    } else {
        search.location.trim()
    };

    let mut out = Vec::new();

    // Pass 1: Nominatim free-text POI search (great for exact Hungarian business names & niches)
    let poi_q = format!("{} {}", search.query.trim(), city);
    if let Ok(resp) = client
        .get("https://nominatim.openstreetmap.org/search")
        .query(&[
            ("q", poi_q.as_str()),
            ("format", "jsonv2"),
            ("extratags", "1"),
            ("addressdetails", "1"),
            ("limit", "15"),
        ])
        .send()
        .await
    {
        if let Ok(arr) = resp.json::<Vec<Value>>().await {
            for item in arr {
                let name = item["name"].as_str().unwrap_or_default().trim().to_string();
                let cat = item["category"].as_str().unwrap_or_default();
                if name.is_empty() || cat == "boundary" || cat == "place" || cat == "highway" {
                    continue;
                }
                let extra = &item["extratags"];
                let website = extra["website"]
                    .as_str()
                    .or_else(|| extra["contact:website"].as_str())
                    .unwrap_or_default()
                    .to_string();
                let phone = extra["phone"]
                    .as_str()
                    .or_else(|| extra["contact:phone"].as_str())
                    .unwrap_or_default()
                    .to_string();
                let email = extra["email"]
                    .as_str()
                    .or_else(|| extra["contact:email"].as_str())
                    .unwrap_or_default()
                    .to_string();
                let address = item["display_name"].as_str().unwrap_or_default().to_string();

                out.push(DiscoveredCompany {
                    company_name: name,
                    website_url: website,
                    industry: if search.industry.trim().is_empty() {
                        search.query.clone()
                    } else {
                        search.industry.clone()
                    },
                    location: city.to_string(),
                    address,
                    phone,
                    email,
                    google_rating: None,
                    google_reviews: None,
                    source: "OpenStreetMap".to_string(),
                });
            }
        }
    }

    // Pass 2: Geocode city & Overpass structured tag/name query
    let (lat, lon) = if let Ok(nom_resp) = client
        .get("https://nominatim.openstreetmap.org/search")
        .query(&[("q", city), ("format", "json"), ("limit", "1")])
        .send()
        .await
    {
        if let Ok(nom_json) = nom_resp.json::<Value>().await {
            if let Some(first) = nom_json.as_array().and_then(|a| a.first()) {
                let lat = first["lat"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(47.4979);
                let lon = first["lon"].as_str().and_then(|s| s.parse::<f64>().ok()).unwrap_or(19.0402);
                (lat, lon)
            } else {
                (47.4979, 19.0402)
            }
        } else {
            (47.4979, 19.0402)
        }
    } else {
        (47.4979, 19.0402)
    };

    let kw_lower = format!("{} {}", search.query, search.industry).to_lowercase();
    let tag_filter = if kw_lower.contains("fogászat") || kw_lower.contains("fogaszat") || kw_lower.contains("dentist") {
        r#"["amenity"="dentist"]"#
    } else if kw_lower.contains("állatorvos") || kw_lower.contains("allatorvos") || kw_lower.contains("vet") {
        r#"["amenity"="veterinary"]"#
    } else if kw_lower.contains("orvos") || kw_lower.contains("klinika") || kw_lower.contains("clinic") || kw_lower.contains("egészség") {
        r#"["amenity"~"clinic|doctors|dentist"]"#
    } else if kw_lower.contains("étterem") || kw_lower.contains("etterem") || kw_lower.contains("vendéglát") || kw_lower.contains("restaurant") || kw_lower.contains("kávézó") {
        r#"["amenity"~"restaurant|cafe"]"#
    } else if kw_lower.contains("hotel") || kw_lower.contains("szálloda") || kw_lower.contains("szalloda") || kw_lower.contains("panzió") {
        r#"["tourism"~"hotel|guest_house"]"#
    } else if kw_lower.contains("ügyvéd") || kw_lower.contains("ugyved") || kw_lower.contains("jog") || kw_lower.contains("lawyer") {
        r#"["office"="lawyer"]"#
    } else if kw_lower.contains("könyvel") || kw_lower.contains("konyvel") || kw_lower.contains("adó") || kw_lower.contains("accountant") {
        r#"["office"~"accountant|tax_advisor"]"#
    } else if kw_lower.contains("ingatlan") || kw_lower.contains("real estate") {
        r#"["office"="estate_agent"]"#
    } else if kw_lower.contains("autó") || kw_lower.contains("szerviz") || kw_lower.contains("gumi") || kw_lower.contains("car") {
        r#"["shop"~"car_repair|car|tyres"]"#
    } else if kw_lower.contains("fodrász") || kw_lower.contains("szépség") || kw_lower.contains("kozmetik") || kw_lower.contains("salon") {
        r#"["shop"~"hairdresser|beauty"]"#
    } else if kw_lower.contains("edző") || kw_lower.contains("fitnes") || kw_lower.contains("gym") || kw_lower.contains("jóga") {
        r#"["leisure"~"fitness_centre|sports_centre"]"#
    } else if kw_lower.contains("építő") || kw_lower.contains("epito") || kw_lower.contains("kivitelez") || kw_lower.contains("klíma") || kw_lower.contains("napelem") {
        r#"["craft"]"#
    } else if kw_lower.contains("it") || kw_lower.contains("szoftver") || kw_lower.contains("marketing") || kw_lower.contains("ügynökség") || kw_lower.contains("web") {
        r#"["office"~"it|advertising_agency|company|consulting"]"#
    } else if kw_lower.contains("logisztik") || kw_lower.contains("fuvar") || kw_lower.contains("szállít") {
        r#"["office"~"logistics|moving_company|company"]"#
    } else if kw_lower.contains("bútor") || kw_lower.contains("lakberendez") || kw_lower.contains("bolt") || kw_lower.contains("shop") {
        r#"["shop"]["website"]"#
    } else {
        r#"["office"]["website"]"#
    };

    let overpass_query = format!(
        "[out:json][timeout:10];(node{tag}(around:14000,{lat},{lon});way{tag}(around:14000,{lat},{lon}););out center {lim};",
        tag = tag_filter,
        lat = lat,
        lon = lon,
        lim = (limit * 3).min(100)
    );

    // Fast-fail client (4s) so an overloaded/502 Overpass server never stalls or fails the search
    let fast_client = Client::builder()
        .timeout(Duration::from_secs(4))
        .connect_timeout(Duration::from_secs(3))
        .user_agent("MyLeadDesktop/0.2 (B2B Lead Discovery)")
        .build()
        .unwrap_or(client);

    let overpass_mirrors = ["https://overpass-api.de/api/interpreter"];

    for mirror in overpass_mirrors {
        if let Ok(ov_resp) = fast_client
            .post(mirror)
            .body(format!("data={}", overpass_query))
            .send()
            .await
        {
            if ov_resp.status().is_success() {
                if let Ok(ov_json) = ov_resp.json::<Value>().await {
                    if let Some(elements) = ov_json["elements"].as_array() {
                        for el in elements {
                            let tags = &el["tags"];
                            let name = tags["name"].as_str().unwrap_or_default().trim().to_string();
                            if name.is_empty() {
                                continue;
                            }
                            let website = tags["website"]
                                .as_str()
                                .or_else(|| tags["contact:website"].as_str())
                                .unwrap_or_default()
                                .trim()
                                .to_string();
                            let email = tags["email"]
                                .as_str()
                                .or_else(|| tags["contact:email"].as_str())
                                .unwrap_or_default()
                                .trim()
                                .to_string();
                            let phone = tags["phone"]
                                .as_str()
                                .or_else(|| tags["contact:phone"].as_str())
                                .unwrap_or_default()
                                .trim()
                                .to_string();

                            let street = tags["addr:street"].as_str().unwrap_or_default();
                            let housenumber = tags["addr:housenumber"].as_str().unwrap_or_default();
                            let postcode = tags["addr:postcode"].as_str().unwrap_or_default();
                            let addr_city = tags["addr:city"].as_str().unwrap_or(city);
                            let address = format!("{} {} {} {}", postcode, addr_city, street, housenumber)
                                .split_whitespace()
                                .collect::<Vec<_>>()
                                .join(" ");

                            out.push(DiscoveredCompany {
                                company_name: name,
                                website_url: website,
                                industry: if search.industry.trim().is_empty() {
                                    search.query.clone()
                                } else {
                                    search.industry.clone()
                                },
                                location: addr_city.to_string(),
                                address,
                                phone,
                                email,
                                google_rating: None,
                                google_reviews: None,
                                source: "OpenStreetMap".to_string(),
                            });
                        }
                        break; // Mirror succeeded, no need to query fallback mirror
                    }
                }
            }
        }
    }

    Ok(out)
}
