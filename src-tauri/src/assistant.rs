use crate::ai;
use crate::crawler;
use crate::db::Database;
use crate::discovery;
use crate::mailer;
use crate::models::*;
use chrono::Utc;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

struct RunningSearchEntry {
    stop_flag: Arc<AtomicBool>,
    abort_handle: Option<tokio::task::AbortHandle>,
}

/// Tracks active searches, their stop flags, and Tokio abort handles so Stop ALWAYS works instantly
#[derive(Default)]
pub struct SearchControlRegistry {
    entries: Mutex<HashMap<String, RunningSearchEntry>>,
}

impl SearchControlRegistry {
    pub fn register(&self, search_id: &str) -> Arc<AtomicBool> {
        let mut map = self.entries.lock().unwrap();
        if let Some(old) = map.remove(search_id) {
            old.stop_flag.store(true, Ordering::SeqCst);
            if let Some(h) = old.abort_handle {
                h.abort();
            }
        }
        let flag = Arc::new(AtomicBool::new(false));
        map.insert(
            search_id.to_string(),
            RunningSearchEntry {
                stop_flag: flag.clone(),
                abort_handle: None,
            },
        );
        flag
    }

    pub fn attach_abort(&self, search_id: &str, flag: &Arc<AtomicBool>, abort_handle: tokio::task::AbortHandle) {
        let mut map = self.entries.lock().unwrap();
        if let Some(entry) = map.get_mut(search_id) {
            if Arc::ptr_eq(&entry.stop_flag, flag) {
                entry.abort_handle = Some(abort_handle);
            }
        }
    }

    pub fn request_stop(&self, search_id: &str) -> bool {
        let mut map = self.entries.lock().unwrap();
        if let Some(entry) = map.remove(search_id) {
            entry.stop_flag.store(true, Ordering::SeqCst);
            if let Some(h) = entry.abort_handle {
                h.abort();
            }
            return true;
        }
        false
    }

    pub fn unregister(&self, search_id: &str, flag: &Arc<AtomicBool>) {
        let mut map = self.entries.lock().unwrap();
        if let Some(cur) = map.get(search_id) {
            if Arc::ptr_eq(&cur.stop_flag, flag) {
                map.remove(search_id);
            }
        }
    }

    pub fn list_running(&self) -> Vec<String> {
        let map = self.entries.lock().unwrap();
        map.keys().cloned().collect()
    }
}

#[derive(Debug, Deserialize)]
struct PlannedAssistantOutput {
    #[serde(default)]
    reply: String,
    #[serde(default)]
    actions: Vec<PlannedAction>,
    #[serde(default)]
    navigate_to: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PlannedAction {
    tool: String,
    #[serde(default)]
    args: Value,
}

fn emit_assistant_status(app: &AppHandle, stage: &str, message: impl Into<String>) {
    let _ = app.emit(
        "assistant-status",
        AssistantStatusEvent {
            stage: stage.to_string(),
            message: message.into(),
        },
    );
}

fn emit_live_full(
    app: &AppHandle,
    search_id: &str,
    phase: &str,
    lead_id: Option<String>,
    company_name: Option<String>,
    domain: Option<String>,
    fit_score: Option<i64>,
    status: Option<String>,
    message: String,
    current: usize,
    total: usize,
    round: usize,
    batch: usize,
    continuous: bool,
    current_url: Option<String>,
    pages_crawled: Option<usize>,
    pages_total: Option<usize>,
) {
    let _ = app.emit(
        "search-live-event",
        SearchLiveEvent {
            search_id: search_id.to_string(),
            phase: phase.to_string(),
            lead_id,
            company_name,
            domain,
            fit_score,
            status,
            message,
            current,
            total,
            round,
            batch,
            continuous,
            current_url,
            pages_crawled,
            pages_total,
            timestamp: Utc::now().to_rfc3339(),
        },
    );
}

fn emit_live(
    app: &AppHandle,
    search_id: &str,
    phase: &str,
    lead_id: Option<String>,
    company_name: Option<String>,
    domain: Option<String>,
    fit_score: Option<i64>,
    status: Option<String>,
    message: String,
    current: usize,
    total: usize,
    round: usize,
    batch: usize,
    continuous: bool,
) {
    emit_live_full(
        app,
        search_id,
        phase,
        lead_id,
        company_name,
        domain,
        fit_score,
        status,
        message,
        current,
        total,
        round,
        batch,
        continuous,
        None,
        None,
        None,
    );
}

/// Spawns a search job in the background (strictly 5 concurrent companies per batch; in continuous mode loops rounds until user clicks Stop!)
pub fn spawn_search_job(app: AppHandle, search_id: String, continuous: bool) -> Result<(), String> {
    {
        let db = app.state::<Database>();
        let _ = db.get_search(&search_id)?;
        db.set_search_status(&search_id, "running", None)?;
    }

    let stop_flag = {
        let reg = app.state::<SearchControlRegistry>();
        reg.register(&search_id)
    };

    let app_for_task = app.clone();
    let sid_for_task = search_id.clone();
    let flag_for_task = stop_flag.clone();

    let handle = tauri::async_runtime::handle().inner().spawn(async move {
        let res = execute_search_pipeline(&app_for_task, &sid_for_task, continuous, flag_for_task.clone()).await;
        if let Err(err) = res {
            let db = app_for_task.state::<Database>();
            let _ = db.set_search_status(&sid_for_task, "failed", Some(&err));
            emit_live(
                &app_for_task,
                &sid_for_task,
                "failed",
                None,
                None,
                None,
                None,
                None,
                format!("Hiba: {}", err),
                0,
                1,
                1,
                0,
                continuous,
            );
        }
        let reg = app_for_task.state::<SearchControlRegistry>();
        reg.unregister(&sid_for_task, &flag_for_task);
    });

    {
        let reg = app.state::<SearchControlRegistry>();
        reg.attach_abort(&search_id, &stop_flag, handle.abort_handle());
    }

    Ok(())
}

/// Immediately stops & aborts a running (or stale-stuck) search, resets SQLite status, and notifies UI!
pub fn force_stop_search_job(app: &AppHandle, search_id: &str) -> Result<bool, String> {
    let was_in_memory = {
        let reg = app.state::<SearchControlRegistry>();
        reg.request_stop(search_id)
    };
    {
        let db = app.state::<Database>();
        let _ = db.set_search_status(search_id, "completed", None);
    }
    emit_live(
        app,
        search_id,
        "stopped",
        None,
        None,
        None,
        None,
        None,
        if was_in_memory {
            "Keresés azonnal leállítva.".to_string()
        } else {
            "Beragadt keresési állapot visszaállítva (újra indítható).".to_string()
        },
        1,
        1,
        1,
        0,
        false,
    );
    Ok(true)
}

/// Batch-of-5 concurrent search pipeline with full realtime events and continuous ("run until stopped") loop
pub async fn execute_search_pipeline(
    app: &AppHandle,
    search_id: &str,
    continuous: bool,
    stop_flag: Arc<AtomicBool>,
) -> Result<SearchJob, String> {
    let (search, project, offer, settings, existing_domains) = {
        let db = app.state::<Database>();
        let search = db.get_search(search_id)?;
        let project = db.get_project(&search.project_id)?;
        let offer = match &search.offer_id {
            Some(oid) => db.get_offer(oid)?,
            None => None,
        };
        let settings = db.get_settings()?;
        let existing_leads = db.list_leads(Some(search_id), None, None, None).unwrap_or_default();
        let existing_domains: HashSet<String> = existing_leads
            .into_iter()
            .filter(|l| l.audit.is_some())
            .map(|l| {
                if !l.domain.is_empty() {
                    l.domain.to_lowercase()
                } else {
                    l.company_name.to_lowercase()
                }
            })
            .collect();
        (search, project, offer, settings, existing_domains)
    };

    let mut seen_keys: HashSet<String> = existing_domains;
    let mut round = 1usize;
    let mut total_processed = 0usize;
    let mut global_batch = 0usize;
    let mut empty_rounds = 0usize;

    emit_live(
        app,
        search_id,
        "starting",
        None,
        None,
        None,
        None,
        None,
        if continuous {
            format!("Folyamatos keresés indítása (5 párhuzamos cég / adag, leállításig fut): „{}”", search.name)
        } else {
            format!("Keresés indítása (5 párhuzamos cég / adag): „{}”", search.name)
        },
        0,
        1,
        round,
        0,
        continuous,
    );

    loop {
        if stop_flag.load(Ordering::SeqCst) {
            break;
        }

        emit_live(
            app,
            search_id,
            "discovering",
            None,
            None,
            None,
            None,
            None,
            format!(
                "Kör #{}: cégek felkutatása ({} motor) — kulcsszó: „{}”...",
                round, search.source, search.query
            ),
            total_processed,
            total_processed.max(1),
            round,
            global_batch,
            continuous,
        );

        let discovered = match discovery::discover_companies_for_round(&search, &settings, round).await {
            Ok(list) => list,
            Err(e) => {
                if round == 1 && !continuous {
                    return Err(e);
                }
                emit_live(
                    app,
                    search_id,
                    "discovering",
                    None,
                    None,
                    None,
                    None,
                    None,
                    format!("Kör #{} figyelmeztetés: {} — továbblépés következő körre...", round, e),
                    total_processed,
                    total_processed.max(1),
                    round,
                    global_batch,
                    continuous,
                );
                empty_rounds += 1;
                if empty_rounds >= 3 {
                    break;
                }
                round += 1;
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                continue;
            }
        };

        if stop_flag.load(Ordering::SeqCst) {
            break;
        }

        // Filter out already-audited companies in continuous mode so every batch of 5 is FRESH!
        let mut fresh: Vec<discovery::DiscoveredCompany> = Vec::new();
        for comp in discovered {
            let dom = crawler::extract_domain(&comp.website_url);
            let key = if !dom.is_empty() {
                dom
            } else {
                comp.company_name.to_lowercase()
            };
            if !continuous || seen_keys.insert(key) {
                fresh.push(comp);
            }
        }

        if fresh.is_empty() {
            empty_rounds += 1;
            emit_live(
                app,
                search_id,
                "merging",
                None,
                None,
                None,
                None,
                None,
                format!("Kör #{}: minden talált cég már szerepel az adatbázisban, bővített kör következik...", round),
                total_processed,
                total_processed.max(1),
                round,
                global_batch,
                continuous,
            );
            if !continuous || empty_rounds >= 4 {
                break;
            }
            round += 1;
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            continue;
        }
        empty_rounds = 0;

        let round_total = fresh.len();
        let target_total = total_processed + round_total;

        emit_live(
            app,
            search_id,
            "merging",
            None,
            None,
            None,
            None,
            None,
            format!(
                "Kör #{}: {} új cég találva — feldolgozás 5-ös párhuzamos adagokban!",
                round, round_total
            ),
            total_processed,
            target_total,
            round,
            global_batch,
            continuous,
        );

        // Save discovered companies immediately so they show up in the table right away
        let mut prepared: Vec<(String, discovery::DiscoveredCompany, Lead)> = Vec::new();
        {
            let db = app.state::<Database>();
            for comp in fresh {
                let lead_id = db.upsert_discovered_lead(
                    Some(search_id),
                    &comp.company_name,
                    &comp.website_url,
                    &comp.industry,
                    &comp.location,
                    &comp.address,
                    &comp.phone,
                    &comp.email,
                    comp.google_rating,
                    comp.google_reviews,
                    &comp.source,
                )?;
                let lead = db.get_lead(&lead_id)?;
                prepared.push((lead_id, comp, lead));
            }
        }

        // Process STRICTLY in batches of 5 concurrent workers; once 5 finish -> next 5!
        for chunk in prepared.chunks(5) {
            if stop_flag.load(Ordering::SeqCst) {
                break;
            }
            global_batch += 1;
            let batch_names: Vec<String> = chunk.iter().map(|(_, c, _)| c.company_name.clone()).collect();
            emit_live(
                app,
                search_id,
                "batch_start",
                None,
                None,
                None,
                None,
                None,
                format!(
                    "Adag #{} (Kör #{}) — {} cég párhuzamos vizsgálata: {}",
                    global_batch,
                    round,
                    chunk.len(),
                    batch_names.join(", ")
                ),
                total_processed,
                target_total,
                round,
                global_batch,
                continuous,
            );

            if !search.auto_audit {
                total_processed += chunk.len();
                continue;
            }

            let mut handles = Vec::new();
            for (lead_id, comp, lead) in chunk.iter().cloned() {
                let app_c = app.clone();
                let sid_c = search_id.to_string();
                let settings_c = settings.clone();
                let project_c = project.clone();
                let offer_c = offer.clone();
                let search_c = search.clone();
                let stop_c = stop_flag.clone();
                let batch_num = global_batch;
                let cur_done = total_processed;

                handles.push(tokio::spawn(async move {
                    if stop_c.load(Ordering::SeqCst) {
                        return None;
                    }
                    let dom = crawler::extract_domain(&comp.website_url);

                    emit_live(
                        &app_c,
                        &sid_c,
                        "auditing",
                        Some(lead_id.clone()),
                        Some(comp.company_name.clone()),
                        Some(dom.clone()),
                        None,
                        Some("auditing".into()),
                        format!(
                            "Adag #{} • Weboldal audit: {} ({})",
                            batch_num,
                            comp.company_name,
                            if dom.is_empty() { "nincs weboldal" } else { &dom }
                        ),
                        cur_done,
                        target_total,
                        round,
                        batch_num,
                        continuous,
                    );

                    let mut crawled_opt = if !comp.website_url.trim().is_empty() {
                        let app_p = app_c.clone();
                        let sid_p = sid_c.clone();
                        let lid_p = lead_id.clone();
                        let cname_p = comp.company_name.clone();
                        let dom_p = dom.clone();
                        crawler::crawl_website_with_progress(&comp.website_url, 2, move |pg, tot, u| {
                            emit_live_full(
                                &app_p,
                                &sid_p,
                                "auditing",
                                Some(lid_p.clone()),
                                Some(cname_p.clone()),
                                Some(dom_p.clone()),
                                None,
                                Some("auditing".into()),
                                format!("Audit ({}/{} oldal): {} — {}", pg, tot, cname_p, u),
                                cur_done,
                                target_total,
                                round,
                                batch_num,
                                continuous,
                                Some(u.to_string()),
                                Some(pg),
                                Some(tot),
                            );
                        })
                        .await
                        .ok()
                    } else {
                        None
                    };

                    if stop_c.load(Ordering::SeqCst) {
                        return None;
                    }

                    let mut analysis = ai::audit_and_score_lead(
                        &settings_c,
                        &project_c,
                        offer_c.as_ref(),
                        Some(&search_c),
                        &lead,
                        crawled_opt.as_ref().map(|c| &c.audit),
                        crawled_opt.as_ref().map(|c| c.combined_text.as_str()).unwrap_or(""),
                    )
                    .await;

                    let is_promising = analysis.fit_score >= search_c.auto_enrich_threshold;
                    let mut deep_enriched = false;

                    if is_promising && !comp.website_url.trim().is_empty() && !stop_c.load(Ordering::SeqCst) {
                        let fit_now = analysis.fit_score;
                        emit_live_full(
                            &app_c,
                            &sid_c,
                            "deep_enriching",
                            Some(lead_id.clone()),
                            Some(comp.company_name.clone()),
                            Some(dom.clone()),
                            Some(fit_now),
                            Some("deep_enriching".into()),
                            format!(
                                "Ígéretes (Fit {}) → mélyebb 5-oldalas kutatás: {}",
                                fit_now, comp.company_name
                            ),
                            cur_done,
                            target_total,
                            round,
                            batch_num,
                            continuous,
                            Some(comp.website_url.clone()),
                            Some(1),
                            Some(6),
                        );
                        let app_p = app_c.clone();
                        let sid_p = sid_c.clone();
                        let lid_p = lead_id.clone();
                        let cname_p = comp.company_name.clone();
                        let dom_p = dom.clone();
                        if let Ok(deep_crawl) = crawler::crawl_website_with_progress(&comp.website_url, 5, move |pg, tot, u| {
                            emit_live_full(
                                &app_p,
                                &sid_p,
                                "deep_enriching",
                                Some(lid_p.clone()),
                                Some(cname_p.clone()),
                                Some(dom_p.clone()),
                                Some(fit_now),
                                Some("deep_enriching".into()),
                                format!("Mély kutatás ({}/{} oldal): {} — {}", pg, tot, cname_p, u),
                                cur_done,
                                target_total,
                                round,
                                batch_num,
                                continuous,
                                Some(u.to_string()),
                                Some(pg),
                                Some(tot),
                            );
                        }).await {
                            analysis = ai::audit_and_score_lead(
                                &settings_c,
                                &project_c,
                                offer_c.as_ref(),
                                Some(&search_c),
                                &lead,
                                Some(&deep_crawl.audit),
                                &deep_crawl.combined_text,
                            )
                            .await;
                            crawled_opt = Some(deep_crawl);
                            deep_enriched = true;
                        }
                    }

                    Some((lead_id, comp, lead, crawled_opt, analysis, deep_enriched))
                }));
            }

            // Wait for all 5 in this batch to complete, filtering out non-matching noise and saving verified leads with AI-cleaned names
            for h in handles {
                if let Ok(Some((lead_id, comp, lead, crawled_opt, analysis, deep_enriched))) = h.await {
                    total_processed += 1;
                    let dom = crawler::extract_domain(&comp.website_url);
                    let clean_name = if !analysis.company_name.trim().is_empty() {
                        analysis.company_name.trim().to_string()
                    } else {
                        comp.company_name.clone()
                    };

                    // Strict gate: only keep leads in the search that genuinely match the search criteria!
                    if !analysis.matches_search || analysis.fit_score < 48 {
                        {
                            let db = app.state::<Database>();
                            let _ = db.remove_rejected_search_lead(search_id, &lead_id);
                        }
                        let reject_msg = format!(
                            "Kiszűrve ({}/{}) — {} ({}): nem felel meg a keresési feltételeknek (Fit {})",
                            total_processed, target_total, clean_name, dom, analysis.fit_score
                        );
                        emit_live(
                            app,
                            search_id,
                            "lead_done",
                            Some(lead_id),
                            Some(clean_name),
                            Some(dom),
                            Some(analysis.fit_score),
                            Some("disqualified".to_string()),
                            reject_msg,
                            total_processed,
                            target_total,
                            round,
                            global_batch,
                            continuous,
                        );
                        continue;
                    }

                    let audit_ref = crawled_opt.as_ref().map(|c| &c.audit);
                    let is_promising = analysis.fit_score >= search.auto_enrich_threshold;
                    let status = if deep_enriched {
                        "enriched"
                    } else if is_promising {
                        "promising"
                    } else {
                        "new"
                    };

                    let mut contacts = lead.contacts.clone();
                    let first_email = audit_ref
                        .and_then(|a| a.extracted_emails.first().cloned())
                        .or_else(|| if !comp.email.is_empty() { Some(comp.email.clone()) } else { None });
                    let first_phone = audit_ref
                        .and_then(|a| a.extracted_phones.first().cloned())
                        .or_else(|| if !comp.phone.is_empty() { Some(comp.phone.clone()) } else { None });

                    if let Some(ref em) = first_email {
                        if !contacts.iter().any(|c| c.email.eq_ignore_ascii_case(em)) {
                            contacts.push(LeadContact {
                                name: format!("{} Kapcsolat", clean_name),
                                role: "Központi / Vezetőség".to_string(),
                                email: em.clone(),
                                phone: first_phone.clone().unwrap_or_default(),
                                source: if deep_enriched { "Mély kutatás" } else { "Weboldal-audit" }.to_string(),
                            });
                        }
                    }

                    let tech = audit_ref.map(|a| a.tech_stack.clone()).unwrap_or_default();
                    {
                        let db = app.state::<Database>();
                        let _ = db.update_lead_identity(
                            &lead_id,
                            Some(&clean_name),
                            Some(&analysis.detected_industry),
                        );
                        let _ = db.update_lead_enrichment(
                            &lead_id,
                            analysis.fit_score,
                            status,
                            deep_enriched,
                            &analysis.employee_estimate,
                            &analysis.company_summary,
                            &analysis.pain_points,
                            &analysis.how_we_can_help,
                            &analysis.recommended_pitch,
                            &tech,
                            &contacts,
                            first_email.as_deref(),
                            first_phone.as_deref(),
                            audit_ref,
                        );
                    }

                    let audit_score_str = audit_ref
                        .map(|a| format!(" • Audit: {}/100", a.overall_score))
                        .unwrap_or_default();
                    let msg = format!(
                        "Kész ({}/{}) — {}: Fit {}{}{}",
                        total_processed,
                        target_total,
                        clean_name,
                        analysis.fit_score,
                        audit_score_str,
                        if deep_enriched { " [Mély dosszié]" } else { "" }
                    );
                    emit_live(
                        app,
                        search_id,
                        "lead_done",
                        Some(lead_id),
                        Some(clean_name),
                        Some(dom),
                        Some(analysis.fit_score),
                        Some(status.to_string()),
                        msg.clone(),
                        total_processed,
                        target_total,
                        round,
                        global_batch,
                        continuous,
                    );
                    let _ = app.emit(
                        "job-progress",
                        JobProgressEvent {
                            job_type: "search".into(),
                            job_id: search_id.to_string(),
                            current: total_processed,
                            total: target_total.max(1),
                            message: msg,
                        },
                    );
                }
            }
        }

        if !continuous || stop_flag.load(Ordering::SeqCst) {
            break;
        }
        round += 1;
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
    }

    let was_stopped = stop_flag.load(Ordering::SeqCst);
    let finished = {
        let db = app.state::<Database>();
        db.set_search_status(search_id, "completed", None)?;
        let f = db.get_search(search_id)?;
        db.log_activity(
            "search",
            if was_stopped { "Keresés leállítva" } else { "Keresés befejezve" },
            &format!("{} — {} feldolgozva ({} ígéretes)", f.name, total_processed, f.promising_count),
            None,
        );
        f
    };

    emit_live(
        app,
        search_id,
        if was_stopped { "stopped" } else { "completed" },
        None,
        None,
        None,
        None,
        None,
        if was_stopped {
            format!(
                "Keresés leállítva a felhasználó által ({} kör, {} adag, {} cég feldolgozva).",
                round, global_batch, total_processed
            )
        } else {
            format!(
                "Keresés befejezve! {} cég az adatbázisban, {} ígéretes.",
                finished.leads_found, finished.promising_count
            )
        },
        total_processed.max(1),
        total_processed.max(1),
        round,
        global_batch,
        continuous,
    );

    Ok(finished)
}

/// Resilient parser for LLM JSON output so malformed quotes (e.g. Hungarian „rejected") NEVER leak raw JSON to the user!
fn parse_assistant_output(raw: &str) -> Option<PlannedAssistantOutput> {
    let trimmed = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    if let Ok(parsed) = serde_json::from_str::<PlannedAssistantOutput>(trimmed) {
        return Some(parsed);
    }

    // Attempt 1: Fix common Hungarian „..." closing ASCII quote inside JSON string values
    // (e.g. `„rejected"` -> `„rejected”`)
    let re_hu_quote = regex::Regex::new(r#"„([^"„”\n]{1,80})""#).ok();
    if let Some(re) = re_hu_quote {
        let repaired = re.replace_all(trimmed, "„$1”").to_string();
        if let Ok(parsed) = serde_json::from_str::<PlannedAssistantOutput>(&repaired) {
            return Some(parsed);
        }
    }

    // Attempt 2: Regex extraction of "reply", "actions", and "navigate_to" if raw looks like our JSON envelope
    if trimmed.starts_with('{') && trimmed.contains("\"reply\"") {
        let reply = regex::Regex::new(r#"(?s)"reply"\s*:\s*"(.*?)"\s*,\s*"(?:actions|navigate_to)"#)
            .ok()
            .and_then(|re| re.captures(trimmed))
            .and_then(|c| c.get(1))
            .map(|m| {
                m.as_str()
                    .replace("\\n", "\n")
                    .replace("\\\"", "\"")
                    .replace("\\\\", "\\")
            })
            .unwrap_or_default();

        let actions: Vec<PlannedAction> = regex::Regex::new(r#"(?s)"actions"\s*:\s*(\[.*?\])\s*(?:,|\})"#)
            .ok()
            .and_then(|re| re.captures(trimmed))
            .and_then(|c| c.get(1))
            .and_then(|m| serde_json::from_str::<Vec<PlannedAction>>(m.as_str()).ok())
            .unwrap_or_default();

        let navigate_to = regex::Regex::new(r#""navigate_to"\s*:\s*"([^"]+)""#)
            .ok()
            .and_then(|re| re.captures(trimmed))
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .filter(|s| !s.is_empty() && s != "null");

        if !reply.is_empty() || !actions.is_empty() {
            return Some(PlannedAssistantOutput {
                reply,
                actions,
                navigate_to,
            });
        }
    }

    None
}

fn normalize_lead_status(raw: &str) -> String {
    match raw.trim().to_lowercase().as_str() {
        "rejected" | "archived" | "archive" | "elutasitva" | "elutasítva" | "disqualified" => "disqualified".to_string(),
        "new" | "uj" | "új" => "new".to_string(),
        "promising" | "igeretes" | "ígéretes" => "promising".to_string(),
        "enriched" | "gazdagitott" | "gazdagított" => "enriched".to_string(),
        "in_campaign" | "kampanyban" | "kampányban" => "in_campaign".to_string(),
        "replied" | "valaszolt" | "válaszolt" => "replied".to_string(),
        "booked" | "idopont" | "időpont" => "booked".to_string(),
        "won" | "ugyfel" | "ügyfél" => "won".to_string(),
        "unsubscribed" | "leiratkozott" => "unsubscribed".to_string(),
        other => other.to_string(),
    }
}

/// Filter leads matching flexible assistant tool arguments (explicit IDs or score/status/search/email/query criteria)
fn select_leads_by_args(leads: &[Lead], args: &Value) -> Vec<Lead> {
    let explicit_ids: Vec<String> = args["leadIds"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();

    if !explicit_ids.is_empty() {
        return leads
            .iter()
            .filter(|l| explicit_ids.iter().any(|id| id == &l.id))
            .cloned()
            .collect();
    }

    let below_score = args["belowScore"].as_i64();
    let max_score = args["maxScore"].as_i64();
    let min_score = args["minScore"].as_i64();
    let status_filter = args["status"].as_str().filter(|s| !s.trim().is_empty() && *s != "all").map(normalize_lead_status);
    let search_filter = args["searchId"].as_str().filter(|s| !s.trim().is_empty() && *s != "all");
    let without_email = args["withoutEmail"].as_bool().unwrap_or(false);
    let only_with_email = args["onlyWithEmail"].as_bool().unwrap_or(false);
    let query_filter = args["query"].as_str().map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());

    let has_any_filter = below_score.is_some()
        || max_score.is_some()
        || min_score.is_some()
        || status_filter.is_some()
        || search_filter.is_some()
        || without_email
        || only_with_email
        || query_filter.is_some();

    if !has_any_filter {
        return vec![];
    }

    leads
        .iter()
        .filter(|l| {
            if let Some(bs) = below_score {
                if l.fit_score >= bs {
                    return false;
                }
            }
            if let Some(ms) = max_score {
                if l.fit_score > ms {
                    return false;
                }
            }
            if let Some(mins) = min_score {
                if l.fit_score < mins {
                    return false;
                }
            }
            if let Some(ref st) = status_filter {
                if &l.status != st {
                    return false;
                }
            }
            if let Some(sid) = search_filter {
                if !l.searches.iter().any(|sp| sp.search_id == sid) {
                    return false;
                }
            }
            if without_email && !l.primary_email.trim().is_empty() {
                return false;
            }
            if only_with_email && l.primary_email.trim().is_empty() {
                return false;
            }
            if let Some(ref q) = query_filter {
                let hay = format!("{} {} {} {} {}", l.company_name, l.domain, l.location, l.industry, l.primary_email).to_lowercase();
                if !hay.contains(q) {
                    return false;
                }
            }
            true
        })
        .cloned()
        .collect()
}

/// Fast, non-blocking Central AI Assistant: streams status, never leaks raw JSON, sees full lead distribution, and executes all workspace actions!
pub async fn run_central_assistant(
    app: &AppHandle,
    db: &Database,
    user_message: &str,
    history: &[AssistantChatMessage],
    active_search_id: Option<&str>,
) -> Result<AssistantResponse, String> {
    emit_assistant_status(app, "context", "Munkaterület adatok beolvasása...");

    let settings = db.get_settings()?;
    let projects = db.list_projects()?;
    let searches = db.list_searches()?;
    let leads = db.list_leads(None, None, None, None)?;
    let campaigns = db.list_campaigns()?;
    let threads = db.list_inbox_threads().unwrap_or_default();
    let senders = db.list_sender_accounts()?;
    let analytics = db.get_analytics()?;

    // Build full score & status breakdown so the assistant is NEVER blind to low-score or filtered leads!
    let mut status_counts: HashMap<String, usize> = HashMap::new();
    let mut below_30 = 0usize;
    let mut score_30_49 = 0usize;
    let mut score_50_69 = 0usize;
    let mut score_70_plus = 0usize;
    let mut without_email_count = 0usize;
    let mut min_fit = i64::MAX;
    let mut max_fit = i64::MIN;

    for l in &leads {
        *status_counts.entry(l.status.clone()).or_insert(0) += 1;
        if l.fit_score < 30 {
            below_30 += 1;
        } else if l.fit_score < 50 {
            score_30_49 += 1;
        } else if l.fit_score < 70 {
            score_50_69 += 1;
        } else {
            score_70_plus += 1;
        }
        if l.primary_email.trim().is_empty() {
            without_email_count += 1;
        }
        if l.fit_score < min_fit {
            min_fit = l.fit_score;
        }
        if l.fit_score > max_fit {
            max_fit = l.fit_score;
        }
    }

    // Include BOTH top 25 AND bottom 25 leads (prioritizing active_search_id if set) with domain, industry & search provenance
    let scoped_leads: Vec<&Lead> = if let Some(asid) = active_search_id.filter(|s| !s.is_empty()) {
        let matching: Vec<&Lead> = leads
            .iter()
            .filter(|l| l.searches.iter().any(|sp| sp.search_id == asid))
            .collect();
        if matching.is_empty() {
            leads.iter().collect()
        } else {
            matching
        }
    } else {
        leads.iter().collect()
    };

    let mut seen_lead_ids: HashSet<String> = HashSet::new();
    let mut sample_leads: Vec<Value> = Vec::new();
    for l in scoped_leads.iter().take(25).chain(scoped_leads.iter().rev().take(25)) {
        if seen_lead_ids.insert(l.id.clone()) {
            sample_leads.push(serde_json::json!({
                "id": l.id,
                "name": l.company_name,
                "domain": l.domain,
                "industry": l.industry,
                "email": l.primary_email,
                "fit": l.fit_score,
                "status": l.status,
                "loc": l.location
            }));
        }
    }

    let scheduled_count = threads
        .iter()
        .filter(|t| t.auto_send_status.as_deref() == Some("scheduled"))
        .count();

    let workspace_context = serde_json::json!({
        "activeSearchId": active_search_id,
        "stats": {
            "projects": projects.len(),
            "searches": searches.len(),
            "leadsTotal": leads.len(),
            "leadsWithoutEmail": without_email_count,
            "scoreBuckets": {
                "below30": below_30,
                "30to49": score_30_49,
                "50to69": score_50_69,
                "70plus": score_70_plus,
                "minScore": if leads.is_empty() { 0 } else { min_fit },
                "maxScore": if leads.is_empty() { 0 } else { max_fit }
            },
            "statusCounts": status_counts,
            "sent": analytics.total_sent,
            "replies": analytics.total_replies,
            "booked": analytics.booked_leads,
            "scheduledAutoReplies": scheduled_count
        },
        "autoReplySettings": {
            "enabled": settings.auto_reply_enabled,
            "workdays": settings.auto_reply_workdays,
            "startHour": settings.auto_reply_start_hour,
            "endHour": settings.auto_reply_end_hour,
            "minDelayMin": settings.auto_reply_min_delay_min,
            "maxDelayMin": settings.auto_reply_max_delay_min
        },
        "projects": projects.iter().take(6).map(|p| serde_json::json!({
            "id": p.id, "name": p.name, "url": p.website_url, "emailSignature": p.email_signature
        })).collect::<Vec<_>>(),
        "searches": searches.iter().take(12).map(|s| serde_json::json!({
            "id": s.id, "name": s.name, "query": s.query, "loc": s.location,
            "src": s.source, "max": s.max_results, "found": s.leads_found, "status": s.status
        })).collect::<Vec<_>>(),
        "leadsSample": sample_leads,
        "campaigns": campaigns.iter().take(10).map(|c| serde_json::json!({
            "id": c.id,
            "name": c.name,
            "offerSummary": if !c.offer_summary.is_empty() { c.offer_summary.as_str() } else { c.offer_title.as_deref().unwrap_or("") },
            "offerTiming": c.offer_timing,
            "offerDelivery": c.offer_delivery,
            "recipients": c.total_recipients,
            "sent": c.sent_count,
            "replies": c.reply_count
        })).collect::<Vec<_>>(),
        "inboxThreads": threads.iter().take(12).map(|t| serde_json::json!({
            "leadId": t.lead_id,
            "company": t.lead_company,
            "intent": t.latest_intent,
            "pendingReplyId": t.pending_reply_id,
            "autoSendStatus": t.auto_send_status,
            "scheduledSendAt": t.scheduled_send_at
        })).collect::<Vec<_>>()
    });

    let system_prompt = r#"Te vagy a MyLead központi végrehajtó AI asszisztense. Válaszolj GYORSAN, okosan, tömören MAGYAR nyelven, és hajtsd végre a kért műveleteket a rendelkezésre álló eszközökkel!
SZIGORÚ FORMÁTUM: Kizárólag érvényes, tiszta JSON objektumot adj vissza (NE használj escape-eletlen " idézőjelet a magyar szövegek belsejében — használj „...” vagy '...' jeleket!):
{"reply":"Konkrét, barátságos magyar válasz","actions":[{"tool":"...","args":{...}}],"navigate_to":"dashboard|projects|searches|leads|campaigns|inbox|analytics|settings|null"}

ELÉRHETŐ ESZKÖZÖK (MINDEN VALÓBAN VÉGREHAJTÓDIK):
- delete_leads: {"leadIds":[],"belowScore":32,"maxScore":null,"minScore":null,"status":null,"searchId":null,"withoutEmail":false,"query":null} — Törli a megadott ID-jú VAGY a szűrőnek megfelelő leadeket! Pl. '32 alatti leadek törlése' -> {"belowScore":32}.
- bulk_update_lead_status: {"leadIds":[],"belowScore":null,"maxScore":null,"minScore":null,"status":null,"searchId":null,"query":null,"newStatus":"promising|enriched|in_campaign|replied|booked|won|disqualified|new"} — Tömeges státuszmódosítás.
- query_leads: {"belowScore":null,"maxScore":null,"minScore":null,"status":null,"withoutEmail":false,"query":null} — Pontos szűrt lista lekérése.
- create_lead: {"companyName","websiteUrl","primaryEmail","phone","location","industry","notes"} — Új lead felvétele kézzel.
- update_lead_status: {"leadId","status","notes"}
- enrich_leads: {"leadIds":[],"minScore":70}
- create_project: {"name","websiteUrl","industry","description","bookingUrl","landingUrl"}
- crawl_project: {"projectId":"id|LAST"}
- create_search: {"projectId":"id|LAST","name","query","industry","location","companySize":"any|1-10|11-50|51-200|200+","targetProblem","source":"smart_hybrid|duckduckgo|gmaps_scraper|ai_cli_search|osm","maxResults":15,"autoAudit":true,"autoEnrichThreshold":70}
- update_search: {"searchId":"id|activeSearchId","name","query","industry","location","companySize","targetProblem","source","maxResults","autoEnrichThreshold"}
- run_search: {"searchId":"id|LAST|activeSearchId","continuous":false}
- stop_search: {"searchId":"id|activeSearchId"}
- create_campaign: {"name","projectId":"id|LAST","offerSummary":"pl. 5 000 Ft kedvezmény","offerTiming":"first_email|on_interest|on_objection|custom","offerDelivery":"pl. Csak akkor ajánld fel, ha tényleg érdeklődik az okosűrlap iránt!","searchId","leadIds":[],"minScore":null,"tone":"professional_formal|friendly_direct|concise_executive","autoReplyMode":"draft|autopilot|manual","includeBookingLink":false,"customInstructions":""} — Az ajánlat és annak tálalási szabálya MINDIG kampányonként van megadva (projekteknél nincs ajánlat)!
- add_leads_to_campaign: {"campaignId":"id|LAST","leadIds":[],"minScore":null,"searchId":null,"generateDrafts":true} — Meglévő kampányba veszi a leadeket!
- send_campaign: {"campaignId":"id|LAST","dryRun":true}
- send_direct_email: {"leadId","subject","body","generateWithAi":true,"instruction":"","scheduleMode":"now|auto_random","dryRun":false} — Közvetlen üzenet küldése vagy időzítése egy leadnek.
- control_auto_reply: {"messageId":"id|ALL","leadId":null,"action":"pause|cancel|resume|reschedule_random|rewrite|send_now","instruction":"","dryRun":false} — Időzített AI auto-válasz megállítása, átírása megjegyzéssel, újraidőzítése vagy azonnali küldése!
- update_settings: {"autoReplyEnabled":true,"autoReplyWorkdays":[1,2,3,4,5,6],"autoReplyStartHour":8,"autoReplyEndHour":18,"autoReplyMinDelayMin":20,"autoReplyMaxDelayMin":120,"aiAnalysisFocus":null,"aiReplyInstructions":null,"companySignature":null}
- load_demo_data: {}

FONTOS: Ha a felhasználó konkrét műveletet kér (pl. törlés, státuszváltás, kampányba vétel, üzenetküldés, auto-válasz megállítása), NE csak kérdezgesd vissza — hajtsd végre azonnal a megfelelő eszközzel és számolj be az eredményről!"#;

    let recent_history = history
        .iter()
        .rev()
        .take(8)
        .rev()
        .map(|m| format!("{}: {}", m.role, m.content))
        .collect::<Vec<_>>()
        .join("\n");

    let user_prompt = format!(
        "ÁLLAPOT:\n{}\nELŐZMÉNY:\n{}\nKÉRÉS: {}",
        serde_json::to_string(&workspace_context).unwrap_or_default(),
        recent_history,
        user_message
    );

    let mut ai_error_msg: Option<String> = None;
    let planned: PlannedAssistantOutput = if ai::has_live_ai(&settings) {
        emit_assistant_status(
            app,
            "thinking",
            format!(
                "AI válasz várása ({} / {})...",
                settings.ai_provider,
                if settings.ai_model.is_empty() { "alapértelmezett" } else { &settings.ai_model }
            ),
        );
        match ai::call_llm_json(&settings, system_prompt, &user_prompt).await {
            Ok(raw_text) => {
                if let Some(p) = parse_assistant_output(&raw_text) {
                    p
                } else {
                    let plain = raw_text.trim();
                    if !plain.is_empty() && !plain.starts_with('{') {
                        PlannedAssistantOutput {
                            reply: plain.to_string(),
                            actions: vec![],
                            navigate_to: None,
                        }
                    } else {
                        ai_error_msg = Some(format!(
                            "Az AI modell ({} / {}) hibás JSON választ adott, ezért a beépített végrehajtó lépett közbe.",
                            settings.ai_provider, settings.ai_model
                        ));
                        fallback_plan(user_message, &projects, &searches, &leads, &analytics, active_search_id)
                    }
                }
            }
            Err(err) => {
                ai_error_msg = Some(err.clone());
                let mut fb = fallback_plan(user_message, &projects, &searches, &leads, &analytics, active_search_id);
                fb.reply = format!("Nem érkezett válasz az AI modelltől.\n\n{}", fb.reply);
                fb
            }
        }
    } else {
        ai_error_msg = Some("Nincs aktív AI modell beállítva (vagy hiányzik az API kulcs / CLI bináris).".into());
        fallback_plan(user_message, &projects, &searches, &leads, &analytics, active_search_id)
    };

    let mut action_logs: Vec<AssistantActionLog> = Vec::new();
    let mut last_project_id = projects.first().map(|p| p.id.clone()).unwrap_or_default();
    let mut last_search_id = active_search_id
        .map(|s| s.to_string())
        .or_else(|| searches.first().map(|s| s.id.clone()))
        .unwrap_or_default();
    let mut last_campaign_id = campaigns.first().map(|c| c.id.clone()).unwrap_or_default();
    let mut open_search_id: Option<String> = None;
    let mut data_changed = false;
    let mut extra_reply_lines: Vec<String> = Vec::new();

    for act in planned.actions {
        emit_assistant_status(app, "executing", format!("Művelet végrehajtása: {}...", act.tool));
        let args = &act.args;
        let resolve_id = |val: Option<&str>, fallback: &str| -> String {
            match val {
                Some(s) if !s.trim().is_empty() && !s.eq_ignore_ascii_case("LAST") => s.to_string(),
                _ => fallback.to_string(),
            }
        };

        match act.tool.as_str() {
            "delete_leads" => {
                let current_leads = db.list_leads(None, None, None, None).unwrap_or_default();
                let matched = select_leads_by_args(&current_leads, args);
                if matched.is_empty() {
                    action_logs.push(AssistantActionLog {
                        tool: "delete_leads".into(),
                        summary: "Nem volt a feltételnek megfelelő törölhető lead.".into(),
                        ok: true,
                    });
                } else {
                    let ids: Vec<String> = matched.iter().map(|l| l.id.clone()).collect();
                    let names_preview: String = matched
                        .iter()
                        .take(5)
                        .map(|l| format!("{} ({})", l.company_name, l.fit_score))
                        .collect::<Vec<_>>()
                        .join(", ");
                    match db.delete_leads(&ids) {
                        Ok(_) => {
                            data_changed = true;
                            db.log_activity("search", "AI Asszisztens: leadek törölve", &format!("{} lead törölve", ids.len()), None);
                            action_logs.push(AssistantActionLog {
                                tool: "delete_leads".into(),
                                summary: format!("{} lead törölve: {}{}", ids.len(), names_preview, if ids.len() > 5 { "…" } else { "" }),
                                ok: true,
                            });
                        }
                        Err(e) => action_logs.push(AssistantActionLog {
                            tool: "delete_leads".into(),
                            summary: format!("Törlési hiba: {}", e),
                            ok: false,
                        }),
                    }
                }
            }
            "bulk_update_lead_status" => {
                let current_leads = db.list_leads(None, None, None, None).unwrap_or_default();
                let matched = select_leads_by_args(&current_leads, args);
                let new_st = normalize_lead_status(args["newStatus"].as_str().or_else(|| args["status"].as_str()).unwrap_or("disqualified"));
                let ids: Vec<String> = matched.iter().map(|l| l.id.clone()).collect();
                match db.bulk_update_lead_status(&ids, &new_st) {
                    Ok(cnt) => {
                        data_changed = cnt > 0;
                        action_logs.push(AssistantActionLog {
                            tool: "bulk_update_lead_status".into(),
                            summary: format!("{} lead státusza frissítve erre: {}", cnt, new_st),
                            ok: true,
                        });
                    }
                    Err(e) => action_logs.push(AssistantActionLog {
                        tool: "bulk_update_lead_status".into(),
                        summary: format!("Hiba: {}", e),
                        ok: false,
                    }),
                }
            }
            "query_leads" => {
                let current_leads = db.list_leads(None, None, None, None).unwrap_or_default();
                let matched = select_leads_by_args(&current_leads, args);
                let lines: Vec<String> = matched
                    .iter()
                    .take(15)
                    .map(|l| format!("• {} — Fit: {} | {} | {}", l.company_name, l.fit_score, l.status, if l.primary_email.is_empty() { "nincs e-mail" } else { &l.primary_email }))
                    .collect();
                if !lines.is_empty() {
                    extra_reply_lines.push(format!("\nTalálatok ({} db):\n{}", matched.len(), lines.join("\n")));
                }
                action_logs.push(AssistantActionLog {
                    tool: "query_leads".into(),
                    summary: format!("{} megfelelő lead található", matched.len()),
                    ok: true,
                });
            }
            "create_lead" => {
                let name = args["companyName"].as_str().unwrap_or("Új cég").to_string();
                match db.upsert_discovered_lead(
                    None,
                    &name,
                    args["websiteUrl"].as_str().unwrap_or_default(),
                    args["industry"].as_str().unwrap_or("B2B"),
                    args["location"].as_str().unwrap_or_default(),
                    "",
                    args["phone"].as_str().unwrap_or_default(),
                    args["primaryEmail"].as_str().unwrap_or_default(),
                    None,
                    None,
                    "AI Asszisztens",
                ) {
                    Ok(lid) => {
                        if let Some(n) = args["notes"].as_str().filter(|s| !s.is_empty()) {
                            let _ = db.update_lead_fields(LeadUpdateInput {
                                id: lid,
                                notes: Some(n.to_string()),
                                ..Default::default()
                            });
                        }
                        data_changed = true;
                        action_logs.push(AssistantActionLog {
                            tool: "create_lead".into(),
                            summary: format!("Új lead felvéve: {}", name),
                            ok: true,
                        });
                    }
                    Err(e) => action_logs.push(AssistantActionLog {
                        tool: "create_lead".into(),
                        summary: format!("Hiba: {}", e),
                        ok: false,
                    }),
                }
            }
            "add_leads_to_campaign" => {
                let cid = resolve_id(args["campaignId"].as_str(), &last_campaign_id);
                let generate_drafts = args["generateDrafts"].as_bool().unwrap_or(true);
                if let Ok(camp) = db.get_campaign(&cid) {
                    let current_leads = db.list_leads(None, None, None, None).unwrap_or_default();
                    let matched = select_leads_by_args(&current_leads, args);
                    let targets: Vec<Lead> = matched
                        .into_iter()
                        .filter(|l| !l.primary_email.trim().is_empty() && !db.is_suppressed(&l.primary_email) && !db.campaign_has_lead(&cid, &l.id))
                        .collect();
                    let cnt = targets.len();
                    if let Ok(proj) = db.get_project(&camp.project_id) {
                        for l in &targets {
                            if generate_drafts {
                                let _ = db.insert_email_message(
                                    Some(&camp.id),
                                    &l.id,
                                    "outbound",
                                    "generating",
                                    1,
                                    &format!("Személyre szabott levél készül — {}...", l.company_name),
                                    "Az AI több szálon írja az emberi hangvételű, cégre szabott megkeresést a háttérben...",
                                    None,
                                    None,
                                    None,
                                    None,
                                    false,
                                    None,
                                );
                            } else {
                                let _ = db.insert_email_message(
                                    Some(&camp.id),
                                    &l.id,
                                    "outbound",
                                    "draft",
                                    1,
                                    &format!("{} — megkeresés", l.company_name),
                                    &format!("Kedves {} Csapat!\n\n{}", l.company_name, ai::resolve_email_signature(Some(&proj), &settings)),
                                    None,
                                    None,
                                    None,
                                    None,
                                    false,
                                    None,
                                );
                            }
                        }
                        if generate_drafts && cnt > 0 {
                            crate::commands::spawn_pending_email_generator(app.clone());
                        }
                        data_changed = cnt > 0;
                        action_logs.push(AssistantActionLog {
                            tool: "add_leads_to_campaign".into(),
                            summary: format!("{} új lead hozzáadva a „{}” kampányhoz (párhuzamos AI generálás indult)", cnt, camp.name),
                            ok: true,
                        });
                    }
                } else {
                    action_logs.push(AssistantActionLog {
                        tool: "add_leads_to_campaign".into(),
                        summary: "Kampány nem található.".into(),
                        ok: false,
                    });
                }
            }
            "send_direct_email" => {
                if let Some(lid) = args["leadId"].as_str() {
                    if let Ok(lead) = db.get_lead(lid) {
                        let offer_id = args["offerId"].as_str().map(|s| s.to_string()).filter(|s| !s.is_empty());
                        let offer = offer_id.as_deref().and_then(|oid| db.get_offer(oid).ok().flatten());
                        let proj = offer
                            .as_ref()
                            .and_then(|o| db.get_project(&o.project_id).ok())
                            .or_else(|| projects.first().cloned());
                        let gen_ai = args["generateWithAi"].as_bool().unwrap_or(false)
                            || args["body"].as_str().unwrap_or("").trim().is_empty();
                        let (subj, body) = if gen_ai {
                            if let Some(ref p) = proj {
                                let g = ai::generate_cold_email(
                                    &settings,
                                    p,
                                    offer.as_ref().or_else(|| p.offers.first()),
                                    "",
                                    "first_email",
                                    "",
                                    &lead,
                                    &settings.default_tone,
                                    &settings.default_language,
                                    true,
                                    args["instruction"].as_str().unwrap_or_default(),
                                )
                                .await;
                                (g.subject, g.body)
                            } else {
                                (
                                    args["subject"].as_str().unwrap_or("Megkeresés").to_string(),
                                    args["body"].as_str().unwrap_or("").to_string(),
                                )
                            }
                        } else {
                            (
                                args["subject"].as_str().unwrap_or("Megkeresés").to_string(),
                                args["body"].as_str().unwrap_or("").to_string(),
                            )
                        };
                        let mode = args["scheduleMode"].as_str().unwrap_or("auto_random");
                        let dry_run = args["dryRun"].as_bool().unwrap_or(false);
                        if mode == "auto_random" {
                            let sched = ai::compute_random_business_send_time(&settings);
                            let _ = db.insert_email_message_full(
                                None, &lead.id, "outbound", "queued", 2, &subj, &body,
                                None, None, None, None, false, None, Some(&sched), Some("scheduled"), None, None,
                            );
                            let _ = app.emit("inbox-updated", ());
                            data_changed = true;
                            action_logs.push(AssistantActionLog {
                                tool: "send_direct_email".into(),
                                summary: format!("Üzenet előkészítve és munkaidőre időzítve: {}", lead.company_name),
                                ok: true,
                            });
                        } else {
                            let msg_id_res = if dry_run {
                                Ok(format!("<asst-sim-{}.mylead@local>", uuid::Uuid::new_v4()))
                            } else if let Some(acc) = senders.iter().find(|a| a.is_default).or_else(|| senders.first()) {
                                mailer::send_email(
                                    acc,
                                    &lead.primary_email,
                                    &subj,
                                    &body,
                                    None,
                                    Some(settings.signature_fine_print.as_str()),
                                )
                                .await
                            } else {
                                Err("Nincs küldő fiók beállítva".to_string())
                            };
                            match msg_id_res {
                                Ok(mid) => {
                                    let _ = db.insert_email_message(
                                        None, &lead.id, "outbound", "sent", 1, &subj, &body,
                                        Some(&mid), None, None, None, false, Some(&Utc::now().to_rfc3339()),
                                    );
                                    let _ = app.emit("inbox-updated", ());
                                    data_changed = true;
                                    action_logs.push(AssistantActionLog {
                                        tool: "send_direct_email".into(),
                                        summary: format!("Üzenet elküldve: {} ({})", lead.company_name, lead.primary_email),
                                        ok: true,
                                    });
                                }
                                Err(e) => action_logs.push(AssistantActionLog {
                                    tool: "send_direct_email".into(),
                                    summary: format!("Küldési hiba: {}", e),
                                    ok: false,
                                }),
                            }
                        }
                    }
                }
            }
            "control_auto_reply" => {
                let action = args["action"].as_str().unwrap_or("pause");
                let msg_id_arg = args["messageId"].as_str().unwrap_or("");
                let lead_id_arg = args["leadId"].as_str().unwrap_or("");
                let target_ids: Vec<String> = if msg_id_arg.eq_ignore_ascii_case("ALL") {
                    threads
                        .iter()
                        .filter_map(|t| t.pending_reply_id.clone())
                        .collect()
                } else if !msg_id_arg.is_empty() {
                    vec![msg_id_arg.to_string()]
                } else if !lead_id_arg.is_empty() {
                    threads
                        .iter()
                        .find(|t| t.lead_id == lead_id_arg)
                        .and_then(|t| t.pending_reply_id.clone())
                        .into_iter()
                        .collect()
                } else {
                    threads
                        .iter()
                        .filter(|t| t.auto_send_status.as_deref() == Some("scheduled"))
                        .filter_map(|t| t.pending_reply_id.clone())
                        .collect()
                };

                let mut affected = 0usize;
                for mid in target_ids {
                    match action {
                        "pause" | "stop" => {
                            if db.update_email_schedule(&mid, "draft", Some("paused"), None, None).is_ok() {
                                affected += 1;
                            }
                        }
                        "cancel" | "delete" => {
                            if db.delete_email_message(&mid).is_ok() {
                                affected += 1;
                            }
                        }
                        "resume" | "reschedule_random" => {
                            let next_at = ai::compute_random_business_send_time(&settings);
                            if db.update_email_schedule(&mid, "queued", Some("scheduled"), Some(&next_at), None).is_ok() {
                                affected += 1;
                            }
                        }
                        "rewrite" => {
                            if let Ok(msg) = db.get_email_message(&mid) {
                                if let Ok(lead) = db.get_lead(&msg.lead_id) {
                                    let instr = args["instruction"].as_str().unwrap_or("Írd át barátságosabban és tömörebben.");
                                    let hist = db.list_lead_messages(&lead.id).unwrap_or_default();
                                    if let Ok(rew) = ai::rewrite_email_with_instruction(
                                        &settings, projects.first(), projects.first().and_then(|p| p.offers.first()),
                                        &lead, &hist, &msg.subject, &msg.body, instr,
                                    ).await {
                                        let _ = db.update_email_message_content(&mid, &rew.subject, &rew.body, Some(instr));
                                        affected += 1;
                                    }
                                }
                            }
                        }
                        "send_now" => {
                            if let Ok(msg) = db.get_email_message(&mid) {
                                if crate::commands::execute_send_for_message(db, &msg, args["dryRun"].as_bool().unwrap_or(false)).await.is_ok() {
                                    affected += 1;
                                }
                            }
                        }
                        _ => {}
                    }
                }
                if affected > 0 {
                    data_changed = true;
                    let _ = app.emit("inbox-updated", ());
                }
                action_logs.push(AssistantActionLog {
                    tool: "control_auto_reply".into(),
                    summary: format!("{} időzített válasz frissítve ({})", affected, action),
                    ok: affected > 0,
                });
            }
            "update_settings" => {
                let mut next = settings.clone();
                if let Some(v) = args["autoReplyEnabled"].as_bool() {
                    next.auto_reply_enabled = v;
                }
                if let Some(arr) = args["autoReplyWorkdays"].as_array() {
                    let days: Vec<u8> = arr.iter().filter_map(|v| v.as_u64().map(|n| n as u8)).filter(|d| (1..=7).contains(d)).collect();
                    if !days.is_empty() {
                        next.auto_reply_workdays = days;
                    }
                }
                if let Some(h) = args["autoReplyStartHour"].as_u64() {
                    next.auto_reply_start_hour = (h as u8).min(22);
                }
                if let Some(h) = args["autoReplyEndHour"].as_u64() {
                    next.auto_reply_end_hour = (h as u8).clamp(1, 24);
                }
                if let Some(m) = args["autoReplyMinDelayMin"].as_i64() {
                    next.auto_reply_min_delay_min = m.clamp(1, 720);
                }
                if let Some(m) = args["autoReplyMaxDelayMin"].as_i64() {
                    next.auto_reply_max_delay_min = m.clamp(next.auto_reply_min_delay_min, 1440);
                }
                if let Some(s) = args["aiAnalysisFocus"].as_str() {
                    next.ai_analysis_focus = s.to_string();
                }
                if let Some(s) = args["aiReplyInstructions"].as_str() {
                    next.ai_reply_instructions = s.to_string();
                }
                if let Some(s) = args["companySignature"].as_str() {
                    next.company_signature = s.to_string();
                }
                match db.save_settings(&next) {
                    Ok(_) => {
                        data_changed = true;
                        action_logs.push(AssistantActionLog {
                            tool: "update_settings".into(),
                            summary: "Beállítások frissítve".into(),
                            ok: true,
                        });
                    }
                    Err(e) => action_logs.push(AssistantActionLog {
                        tool: "update_settings".into(),
                        summary: format!("Hiba: {}", e),
                        ok: false,
                    }),
                }
            }
            "create_project" => {
                let name = args["name"].as_str().unwrap_or("Új Projekt").to_string();
                match db.save_project(ProjectInput {
                    id: None,
                    name,
                    website_url: args["websiteUrl"].as_str().unwrap_or_default().to_string(),
                    industry: args["industry"].as_str().unwrap_or("B2B").to_string(),
                    language: args["language"].as_str().unwrap_or("hu").to_string(),
                    description: args["description"].as_str().unwrap_or_default().to_string(),
                    booking_url: args["bookingUrl"].as_str().unwrap_or_default().to_string(),
                    landing_url: args["landingUrl"].as_str().unwrap_or_default().to_string(),
                    email_signature: args["emailSignature"].as_str().map(|s| s.to_string()),
                    value_proposition: None,
                    target_audience: None,
                    pain_points_solved: None,
                    pitch_angles: None,
                    objection_handlers: None,
                }) {
                    Ok(p) => {
                        last_project_id = p.id.clone();
                        data_changed = true;
                        action_logs.push(AssistantActionLog {
                            tool: "create_project".into(),
                            summary: format!("Projekt létrehozva: {}", p.name),
                            ok: true,
                        });
                    }
                    Err(e) => action_logs.push(AssistantActionLog {
                        tool: "create_project".into(),
                        summary: format!("Hiba: {}", e),
                        ok: false,
                    }),
                }
            }
            "crawl_project" => {
                let pid = resolve_id(args["projectId"].as_str(), &last_project_id);
                if let Ok(proj) = db.get_project(&pid) {
                    if !proj.website_url.trim().is_empty() {
                        // Launch project crawl in background so assistant responds immediately!
                        let app_c = app.clone();
                        let pid_c = pid.clone();
                        let settings_c = settings.clone();
                        tokio::spawn(async move {
                            if let Ok(crawled) = crawler::crawl_website(&proj.website_url, 5).await {
                                let prof = ai::analyze_project_website(&settings_c, &proj, &crawled).await;
                                let db_bg = app_c.state::<Database>();
                                let _ = db_bg.update_project_ai_profile(
                                    &pid_c,
                                    &prof.value_proposition,
                                    &prof.target_audience,
                                    &prof.pain_points_solved,
                                    &prof.pitch_angles,
                                    &prof.objection_handlers,
                                    &prof.crawled_summary,
                                    crawled.pages_crawled,
                                );
                            }
                        });
                        action_logs.push(AssistantActionLog {
                            tool: "crawl_project".into(),
                            summary: "Weboldal-feltérképezés elindítva a háttérben".into(),
                            ok: true,
                        });
                    }
                }
            }
            "create_offer" => {
                let pid = resolve_id(args["projectId"].as_str(), &last_project_id);
                match db.save_offer(OfferInput {
                    id: None,
                    project_id: pid,
                    title: args["title"].as_str().unwrap_or("Kiemelt ajánlat").to_string(),
                    offer_type: args["offerType"].as_str().unwrap_or("discount").to_string(),
                    discount_value: args["discountValue"].as_str().unwrap_or("-20%").to_string(),
                    description: args["description"].as_str().unwrap_or_default().to_string(),
                    cta_text: args["ctaText"].as_str().unwrap_or("15 perces egyeztetés").to_string(),
                    conditions: args["conditions"].as_str().unwrap_or_default().to_string(),
                    active: true,
                }) {
                    Ok(o) => {
                        data_changed = true;
                        action_logs.push(AssistantActionLog {
                            tool: "create_offer".into(),
                            summary: format!("Ajánlat létrehozva: {}", o.title),
                            ok: true,
                        });
                    }
                    Err(e) => action_logs.push(AssistantActionLog {
                        tool: "create_offer".into(),
                        summary: format!("Hiba: {}", e),
                        ok: false,
                    }),
                }
            }
            "create_search" => {
                let mut pid = resolve_id(args["projectId"].as_str(), &last_project_id);
                if pid.is_empty() {
                    if let Ok(auto_p) = db.save_project(ProjectInput {
                        id: None,
                        name: "Alap Projekt".into(),
                        website_url: String::new(),
                        industry: "B2B".into(),
                        language: "hu".into(),
                        description: "Automatikusan létrehozott projekt".into(),
                        booking_url: String::new(),
                        landing_url: String::new(),
                        email_signature: None,
                        value_proposition: None,
                        target_audience: None,
                        pain_points_solved: None,
                        pitch_angles: None,
                        objection_handlers: None,
                    }) {
                        pid = auto_p.id.clone();
                        last_project_id = auto_p.id;
                    }
                }
                let q = args["query"].as_str().unwrap_or("vállalkozás").to_string();
                let loc = args["location"].as_str().unwrap_or("Budapest").to_string();
                let name = args["name"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("{} — {}", loc, q));

                match db.save_search(SearchJobInput {
                    id: None,
                    project_id: pid,
                    offer_id: args["offerId"].as_str().map(|s| s.to_string()).filter(|s| !s.is_empty()),
                    name,
                    query: q.clone(),
                    industry: args["industry"].as_str().unwrap_or(&q).to_string(),
                    location: loc,
                    company_size: args["companySize"].as_str().unwrap_or("any").to_string(),
                    target_problem: args["targetProblem"].as_str().unwrap_or_default().to_string(),
                    source: args["source"].as_str().unwrap_or("smart_hybrid").to_string(),
                    max_results: args["maxResults"].as_i64().unwrap_or(15).max(1),
                    auto_audit: args["autoAudit"].as_bool().unwrap_or(true),
                    auto_enrich_threshold: args["autoEnrichThreshold"].as_i64().unwrap_or(70).clamp(10, 95),
                }) {
                    Ok(s) => {
                        last_search_id = s.id.clone();
                        open_search_id = Some(s.id.clone());
                        data_changed = true;
                        action_logs.push(AssistantActionLog {
                            tool: "create_search".into(),
                            summary: format!("Keresés létrehozva: {} ({})", s.name, s.source),
                            ok: true,
                        });
                    }
                    Err(e) => action_logs.push(AssistantActionLog {
                        tool: "create_search".into(),
                        summary: format!("Hiba: {}", e),
                        ok: false,
                    }),
                }
            }
            "update_search" => {
                let sid = resolve_id(args["searchId"].as_str(), &last_search_id);
                match db.get_search(&sid) {
                    Ok(cur) => {
                        let input = SearchJobInput {
                            id: Some(cur.id.clone()),
                            project_id: cur.project_id,
                            offer_id: args["offerId"].as_str().map(|s| s.to_string()).or(cur.offer_id),
                            name: args["name"].as_str().unwrap_or(&cur.name).to_string(),
                            query: args["query"].as_str().unwrap_or(&cur.query).to_string(),
                            industry: args["industry"].as_str().unwrap_or(&cur.industry).to_string(),
                            location: args["location"].as_str().unwrap_or(&cur.location).to_string(),
                            company_size: args["companySize"].as_str().unwrap_or(&cur.company_size).to_string(),
                            target_problem: args["targetProblem"].as_str().unwrap_or(&cur.target_problem).to_string(),
                            source: args["source"].as_str().unwrap_or(&cur.source).to_string(),
                            max_results: args["maxResults"].as_i64().unwrap_or(cur.max_results).max(1),
                            auto_audit: args["autoAudit"].as_bool().unwrap_or(cur.auto_audit),
                            auto_enrich_threshold: args["autoEnrichThreshold"].as_i64().unwrap_or(cur.auto_enrich_threshold).clamp(10, 95),
                        };
                        match db.save_search(input) {
                            Ok(updated) => {
                                last_search_id = updated.id.clone();
                                open_search_id = Some(updated.id.clone());
                                data_changed = true;
                                action_logs.push(AssistantActionLog {
                                    tool: "update_search".into(),
                                    summary: format!("Keresés frissítve: {} ({})", updated.name, updated.source),
                                    ok: true,
                                });
                            }
                            Err(e) => action_logs.push(AssistantActionLog {
                                tool: "update_search".into(),
                                summary: format!("Hiba: {}", e),
                                ok: false,
                            }),
                        }
                    }
                    Err(e) => action_logs.push(AssistantActionLog {
                        tool: "update_search".into(),
                        summary: format!("Keresés nem található: {}", e),
                        ok: false,
                    }),
                }
            }
            "run_search" => {
                // Non-blocking! Launches in background immediately so assistant replies instantly and user watches it live!
                let sid = resolve_id(args["searchId"].as_str(), &last_search_id);
                let continuous = args["continuous"].as_bool().unwrap_or(false);
                open_search_id = Some(sid.clone());
                match spawn_search_job(app.clone(), sid.clone(), continuous) {
                    Ok(_) => {
                        data_changed = true;
                        action_logs.push(AssistantActionLog {
                            tool: "run_search".into(),
                            summary: if continuous {
                                "Folyamatos keresés elindítva (5-ös adagokban, leállításig fut)".into()
                            } else {
                                "Keresés elindítva a háttérben (5-ös adagokban — élőben követhető!)".into()
                            },
                            ok: true,
                        });
                    }
                    Err(e) => action_logs.push(AssistantActionLog {
                        tool: "run_search".into(),
                        summary: format!("Indítási hiba: {}", e),
                        ok: false,
                    }),
                }
            }
            "stop_search" => {
                let sid = resolve_id(args["searchId"].as_str(), &last_search_id);
                let _ = force_stop_search_job(app, &sid);
                data_changed = true;
                action_logs.push(AssistantActionLog {
                    tool: "stop_search".into(),
                    summary: "Keresés azonnal leállítva".into(),
                    ok: true,
                });
            }
            "enrich_leads" => {
                let min_score = args["minScore"].as_i64().unwrap_or(70);
                let mut target_ids: Vec<String> = args["leadIds"]
                    .as_array()
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                if target_ids.is_empty() {
                    target_ids = db
                        .list_leads(None, None, Some(min_score), None)
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|l| !l.enriched && !l.website_url.is_empty())
                        .take(5)
                        .map(|l| l.id)
                        .collect();
                }
                if let Some(proj) = projects.first().cloned() {
                    let count = target_ids.len();
                    let app_c = app.clone();
                    let settings_c = settings.clone();
                    tokio::spawn(async move {
                        for lid in target_ids {
                            let lead_opt = {
                                let db_bg = app_c.state::<Database>();
                                db_bg.get_lead(&lid).ok()
                            };
                            if let Some(lead) = lead_opt {
                                let lead_search_opt = {
                                    let db_bg = app_c.state::<Database>();
                                    lead.searches.first().and_then(|sp| db_bg.get_search(&sp.search_id).ok())
                                };
                                let crawled = if !lead.website_url.is_empty() {
                                    crawler::crawl_website(&lead.website_url, 5).await.ok()
                                } else {
                                    None
                                };
                                let audit_ref = crawled.as_ref().map(|c| &c.audit);
                                let txt = crawled.as_ref().map(|c| c.combined_text.as_str()).unwrap_or("");
                                let an = ai::audit_and_score_lead(&settings_c, &proj, proj.offers.first(), lead_search_opt.as_ref(), &lead, audit_ref, txt).await;
                                let first_em = audit_ref.and_then(|a| a.extracted_emails.first().cloned());
                                let first_ph = audit_ref.and_then(|a| a.extracted_phones.first().cloned());
                                let tech = audit_ref.map(|a| a.tech_stack.clone()).unwrap_or_else(|| lead.tech_stack.clone());
                                let db_bg = app_c.state::<Database>();
                                let _ = db_bg.update_lead_identity(
                                    &lid,
                                    Some(&an.company_name),
                                    Some(&an.detected_industry),
                                );
                                let _ = db_bg.update_lead_enrichment(
                                    &lid, an.fit_score, "enriched", true, &an.employee_estimate,
                                    &an.company_summary, &an.pain_points, &an.how_we_can_help,
                                    &an.recommended_pitch, &tech, &lead.contacts,
                                    first_em.as_deref(), first_ph.as_deref(), audit_ref,
                                );
                            }
                        }
                    });
                    action_logs.push(AssistantActionLog {
                        tool: "enrich_leads".into(),
                        summary: format!("{} lead mély gazdagítása elindítva a háttérben", count),
                        ok: true,
                    });
                }
            }
            "create_campaign" => {
                let offer_id = args["offerId"].as_str().map(|s| s.to_string()).filter(|s| !s.is_empty());
                let resolved_offer = offer_id.as_deref().and_then(|oid| db.get_offer(oid).ok().flatten());
                let pid = resolved_offer
                    .as_ref()
                    .map(|o| o.project_id.clone())
                    .unwrap_or_else(|| resolve_id(args["projectId"].as_str(), &last_project_id));
                let sid = args["searchId"].as_str().map(|s| resolve_id(Some(s), &last_search_id)).filter(|s| !s.is_empty());
                let lead_ids: Vec<String> = args["leadIds"]
                    .as_array()
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default();
                let sender_id = args["senderAccountId"]
                    .as_str()
                    .map(|s| s.to_string())
                    .or_else(|| senders.iter().find(|a| a.is_default).or_else(|| senders.first()).map(|a| a.id.clone()));

                let input = CampaignInput {
                    id: None,
                    name: args["name"].as_str().unwrap_or("AI Kampány").to_string(),
                    project_id: pid.clone(),
                    offer_id,
                    search_id: sid.clone(),
                    sender_account_id: sender_id,
                    tone: args["tone"].as_str().unwrap_or(&settings.default_tone).to_string(),
                    language: "hu".into(),
                    auto_reply_mode: args["autoReplyMode"].as_str().unwrap_or("draft").to_string(),
                    daily_limit: settings.default_daily_limit,
                    min_delay_sec: 45,
                    follow_up_days: 3,
                    include_booking_link: args["includeBookingLink"].as_bool().unwrap_or(false),
                    custom_instructions: args["customInstructions"].as_str().unwrap_or_default().to_string(),
                    offer_summary: args["offerSummary"].as_str().unwrap_or_default().to_string(),
                    offer_timing: args["offerTiming"].as_str().unwrap_or("on_interest").to_string(),
                    offer_delivery: args["offerDelivery"].as_str().unwrap_or_default().to_string(),
                    lead_ids: lead_ids.clone(),
                };

                if let (Ok(_proj), Ok(camp)) = (db.get_project(&pid), db.create_campaign(&input)) {
                    let min_sc = args["minScore"].as_i64().unwrap_or(70);
                    let targets: Vec<Lead> = if !lead_ids.is_empty() {
                        lead_ids.iter().filter_map(|id| db.get_lead(id).ok()).filter(|l| !l.primary_email.is_empty()).collect()
                    } else if let Some(ref s) = sid {
                        db.list_leads(Some(s), None, None, None).unwrap_or_default().into_iter().filter(|l| !l.primary_email.is_empty()).collect()
                    } else {
                        db.list_leads(None, None, Some(min_sc), None).unwrap_or_default().into_iter().filter(|l| !l.primary_email.is_empty()).take(15).collect()
                    };
                    let target_count = targets.len();
                    let camp_id = camp.id.clone();
                    let camp_name = camp.name.clone();

                    for l in &targets {
                        let _ = db.insert_email_message(
                            Some(&camp.id),
                            &l.id,
                            "outbound",
                            "generating",
                            1,
                            &format!("Személyre szabott levél készül — {}...", l.company_name),
                            "Az AI több szálon írja az emberi hangvételű, cégre szabott megkeresést a háttérben...",
                            None,
                            None,
                            None,
                            None,
                            false,
                            None,
                        );
                    }
                    if target_count > 0 {
                        crate::commands::spawn_pending_email_generator(app.clone());
                    }

                    last_campaign_id = camp_id;
                    data_changed = true;
                    action_logs.push(AssistantActionLog {
                        tool: "create_campaign".into(),
                        summary: format!("Kampány létrehozva: {} ({} levél párhuzamos AI generálása elindult)", camp_name, target_count),
                        ok: true,
                    });
                }
            }
            "send_campaign" => {
                let cid = resolve_id(args["campaignId"].as_str(), &last_campaign_id);
                let dry_run = args["dryRun"].as_bool().unwrap_or(false);
                if let Ok(camp) = db.get_campaign(&cid) {
                    let msgs: Vec<EmailMessage> = db.list_campaign_messages(&cid).unwrap_or_default()
                        .into_iter().filter(|m| m.direction == "outbound" && m.status == "draft").collect();
                    let mut sent = 0usize;
                    let acc_opt = camp.sender_account_id.as_deref().and_then(|aid| db.get_sender_account(aid).ok());
                    for m in msgs {
                        if dry_run {
                            let _ = db.mark_email_sent(&m.id, &format!("<sim-{}.mylead@local>", uuid::Uuid::new_v4()), false);
                            sent += 1;
                        } else if let Some(ref acc) = acc_opt {
                            if let Ok(mid) = mailer::send_email(
                                acc,
                                &m.lead_email,
                                &m.subject,
                                &m.body,
                                None,
                                Some(settings.signature_fine_print.as_str()),
                            )
                            .await
                            {
                                let _ = db.mark_email_sent(&m.id, &mid, false);
                                sent += 1;
                            }
                        }
                    }
                    let _ = db.update_campaign_status(&cid, "active");
                    data_changed = sent > 0;
                    action_logs.push(AssistantActionLog {
                        tool: "send_campaign".into(),
                        summary: format!("{} — {} levél {}", camp.name, sent, if dry_run { "szimulálva" } else { "elküldve" }),
                        ok: true,
                    });
                }
            }
            "update_lead_status" => {
                if let Some(lid) = args["leadId"].as_str() {
                    let res = db.update_lead_fields(LeadUpdateInput {
                        id: lid.to_string(),
                        status: args["status"].as_str().map(normalize_lead_status),
                        notes: args["notes"].as_str().map(|s| s.to_string()),
                        ..Default::default()
                    });
                    let ok = res.is_ok();
                    data_changed = ok;
                    action_logs.push(AssistantActionLog {
                        tool: "update_lead_status".into(),
                        summary: match res {
                            Ok(l) => format!("{} státusz frissítve: {}", l.company_name, l.status),
                            Err(e) => format!("Hiba: {}", e),
                        },
                        ok,
                    });
                }
            }
            "load_demo_data" => {
                let res = crate::seed::seed_demo_workspace(db);
                let ok = res.is_ok();
                data_changed = ok;
                action_logs.push(AssistantActionLog {
                    tool: "load_demo_data".into(),
                    summary: match res {
                        Ok(_) => "Mintaadatok betöltve".into(),
                        Err(e) => e,
                    },
                    ok,
                });
            }
            _ => {}
        }
    }

    emit_assistant_status(app, "done", "Kész!");

    let mut final_reply = if planned.reply.trim().is_empty() {
        "A kért műveleteket elindítottam.".to_string()
    } else {
        planned.reply
    };
    if !extra_reply_lines.is_empty() {
        final_reply.push_str(&extra_reply_lines.join("\n"));
    }

    Ok(AssistantResponse {
        reply: final_reply,
        actions: action_logs,
        navigate_to: planned.navigate_to.filter(|s| !s.is_empty() && s != "null"),
        open_search_id,
        data_changed,
        ai_error: ai_error_msg,
    })
}

fn fallback_plan(
    msg: &str,
    projects: &[Project],
    searches: &[SearchJob],
    leads: &[Lead],
    analytics: &AnalyticsOverview,
    active_search_id: Option<&str>,
) -> PlannedAssistantOutput {
    let lower = msg.to_lowercase();
    if (lower.contains("töröl") || lower.contains("torol")) && (lower.contains("alatt") || lower.contains("lead")) {
        if let Some(cap) = regex::Regex::new(r"(\d{1,3})\s*(?:pont\s*)?alatt").ok().and_then(|re| re.captures(&lower)) {
            if let Ok(thresh) = cap[1].parse::<i64>() {
                return PlannedAssistantOutput {
                    reply: format!("Törlöm a {} pont alatti leadeket az adatbázisból.", thresh),
                    actions: vec![PlannedAction {
                        tool: "delete_leads".into(),
                        args: serde_json::json!({ "belowScore": thresh }),
                    }],
                    navigate_to: Some("leads".into()),
                };
            }
        }
    }
    if lower.contains("minta") && lower.contains("betölt") {
        return PlannedAssistantOutput {
            reply: "Betöltöm a minta B2B munkaterületet.".into(),
            actions: vec![PlannedAction { tool: "load_demo_data".into(), args: serde_json::json!({}) }],
            navigate_to: Some("dashboard".into()),
        };
    }
    if lower.contains("állítsd le") || lower.contains("allitsd le") || lower.contains("stop") {
        if let Some(sid) = active_search_id.or_else(|| searches.first().map(|s| s.id.as_str())) {
            return PlannedAssistantOutput {
                reply: "Leállítom a futó keresést.".into(),
                actions: vec![PlannedAction { tool: "stop_search".into(), args: serde_json::json!({"searchId": sid}) }],
                navigate_to: Some("searches".into()),
            };
        }
    }
    if lower.contains("folyamatos") || lower.contains("végtelen") || lower.contains("amíg le nem") {
        if let Some(sid) = active_search_id.or_else(|| searches.first().map(|s| s.id.as_str())) {
            return PlannedAssistantOutput {
                reply: "Elindítom a folyamatos keresést 5-ös párhuzamos adagokban (addig fut, amíg le nem állítod).".into(),
                actions: vec![PlannedAction { tool: "run_search".into(), args: serde_json::json!({"searchId": sid, "continuous": true}) }],
                navigate_to: Some("searches".into()),
            };
        }
    }
    if lower.contains("futtas") || lower.contains("indítsd el") || lower.contains("inditsd el") {
        if let Some(sid) = active_search_id.or_else(|| searches.first().map(|s| s.id.as_str())) {
            return PlannedAssistantOutput {
                reply: "Elindítom a keresést a háttérben 5-ös adagokban — rögtön látod élőben a haladást.".into(),
                actions: vec![PlannedAction { tool: "run_search".into(), args: serde_json::json!({"searchId": sid, "continuous": false}) }],
                navigate_to: Some("searches".into()),
            };
        }
    }
    if lower.contains("legjobb") || lower.contains("stat") || lower.contains("összefoglal") || lower.contains("állás") {
        let top_list = leads
            .iter()
            .take(5)
            .map(|l| format!("• {} (Fit {}, státusz: {})", l.company_name, l.fit_score, l.status))
            .collect::<Vec<_>>()
            .join("\n");
        return PlannedAssistantOutput {
            reply: format!(
                "Aktuális munkaterület összefoglaló:\n• Projektek: {}\n• Keresések: {}\n• Összes lead: {} ({} ígéretes, {} mély dosszié)\n• Kiküldött e-mail: {}, Válaszok: {}, Időpontok: {}\n\nTop leadek:\n{}",
                projects.len(),
                searches.len(),
                analytics.total_leads,
                analytics.promising_leads,
                analytics.enriched_leads,
                analytics.total_sent,
                analytics.total_replies,
                analytics.booked_leads,
                if top_list.is_empty() { "Még nincs lead." } else { &top_list }
            ),
            actions: vec![],
            navigate_to: None,
        };
    }
    if lower.contains("keresés") || lower.contains("kereses") || lower.contains("keress") {
        let loc = ["budapest", "győr", "debrecen", "szeged", "pécs", "miskolc", "székesfehérvár", "kecskemét"]
            .iter()
            .find(|c| lower.contains(**c))
            .map(|c| {
                let mut ch = c.chars();
                match ch.next() {
                    Some(f) => f.to_uppercase().collect::<String>() + ch.as_str(),
                    None => String::new(),
                }
            })
            .unwrap_or_else(|| "Budapest".into());
        let pid = projects.first().map(|p| p.id.clone()).unwrap_or_default();
        return PlannedAssistantOutput {
            reply: format!("Létrehoztam és elindítottam a keresést ({} / Okos Hibrid, 5-ös adagokban).", loc),
            actions: vec![
                PlannedAction {
                    tool: "create_search".into(),
                    args: serde_json::json!({
                        "projectId": pid,
                        "name": format!("AI Keresés — {}", loc),
                        "query": msg,
                        "industry": msg,
                        "location": loc,
                        "source": "smart_hybrid",
                        "maxResults": 15,
                        "autoAudit": true
                    }),
                },
                PlannedAction {
                    tool: "run_search".into(),
                    args: serde_json::json!({"searchId": "LAST", "continuous": false}),
                },
            ],
            navigate_to: Some("searches".into()),
        };
    }

    PlannedAssistantOutput {
        reply: "Tipp: gyors API válaszhoz állíts be OpenRouter / OpenCode Go API kulcsot (vagy Claude/Codex/OpenCode CLI-t) a Beállítások → AI fülön. Addig is kérhetsz tőlem keresés létrehozást, indítást, folyamatos futtatást, leállítást vagy statisztikát!".into(),
        actions: vec![],
        navigate_to: None,
    }
}

/// Parses a single CSV/TSV line handling quotes and custom delimiter (`,`, `;`, `\t`)
fn parse_csv_line(line: &str, delim: char) -> Vec<String> {
    let mut fields = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    cur.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(ch);
            }
        } else if ch == '"' {
            in_quotes = true;
        } else if ch == delim {
            fields.push(cur.trim().to_string());
            cur.clear();
        } else {
            cur.push(ch);
        }
    }
    fields.push(cur.trim().to_string());
    fields
}

/// Imports a CSV file of leads (with smart HU/EN header detection), creates a dedicated Search batch, and immediately spawns 5-at-a-time live evaluation!
pub fn import_csv_and_evaluate(
    app: AppHandle,
    file_name: String,
    csv_content: String,
    instruction: String,
    project_id: Option<String>,
) -> Result<CsvImportResult, String> {
    let cleaned = csv_content.trim_start_matches('\u{feff}').trim();
    let raw_lines: Vec<&str> = cleaned
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    if raw_lines.is_empty() {
        return Err("A feltöltött CSV fájl üres.".to_string());
    }

    // Detect delimiter from first line (`;`, `\t`, or `,`)
    let first_line = raw_lines[0];
    let delim = if first_line.matches(';').count() > first_line.matches(',').count() {
        ';'
    } else if first_line.matches('\t').count() > first_line.matches(',').count() {
        '\t'
    } else {
        ','
    };

    let first_cols = parse_csv_line(first_line, delim);
    let lower_cols: Vec<String> = first_cols.iter().map(|s| s.to_lowercase()).collect();

    let find_col = |keys: &[&str]| -> Option<usize> {
        lower_cols
            .iter()
            .position(|h| keys.iter().any(|k| h.contains(k)))
    };

    let col_name = find_col(&["cégnév", "cegnev", "company", "név", "nev", "name", "title", "vállalkozás"]);
    let col_web = find_col(&["weboldal", "website", "url", "domain", "honlap", "link", "site"]);
    let col_email = find_col(&["email", "e-mail", "mail"]);
    let col_phone = find_col(&["telefon", "phone", "tel", "mobil"]);
    let col_loc = find_col(&["város", "varos", "city", "location", "hely", "cím", "cim", "address"]);
    let col_ind = find_col(&["iparág", "iparag", "industry", "kategória", "kategoria", "category"]);

    let has_header = col_name.is_some() || col_web.is_some() || col_email.is_some();
    let data_lines = if has_header { &raw_lines[1..] } else { &raw_lines[..] };

    if data_lines.is_empty() {
        return Err("A CSV csak fejlécet tartalmaz, adatsort nem.".to_string());
    }

    // Ensure a Project exists
    let (search_id, search_name, lead_ids, skipped_count) = {
        let db = app.state::<Database>();
        let pid = match project_id.filter(|s| !s.is_empty()) {
            Some(id) => id,
            None => match db.list_projects()?.into_iter().next() {
                Some(p) => p.id,
                None => db
                    .save_project(ProjectInput {
                        id: None,
                        name: "Alap Projekt".into(),
                        website_url: String::new(),
                        industry: "B2B".into(),
                        language: "hu".into(),
                        description: "CSV importáláshoz létrehozott projekt".into(),
                        booking_url: String::new(),
                        landing_url: String::new(),
                        email_signature: None,
                        value_proposition: None,
                        target_audience: None,
                        pain_points_solved: None,
                        pitch_angles: None,
                        objection_handlers: None,
                    })?
                    .id,
            },
        };

        let proj = db.get_project(&pid)?;
        let clean_fname = file_name.trim().trim_end_matches(".csv").trim_end_matches(".txt");
        let s_name = format!("CSV Kiértékelés — {}", if clean_fname.is_empty() { "Import" } else { clean_fname });

        let search = db.save_search(SearchJobInput {
            id: None,
            project_id: pid,
            offer_id: proj.offers.first().map(|o| o.id.clone()),
            name: s_name.clone(),
            query: clean_fname.to_string(),
            industry: proj.industry.clone(),
            location: "CSV Import".to_string(),
            company_size: "any".to_string(),
            target_problem: if instruction.trim().is_empty() {
                "CSV-ből feltöltött cégek weboldal- és alkalmassági vizsgálata (jók-e a projekthez)".to_string()
            } else {
                instruction.trim().to_string()
            },
            source: "manual".to_string(),
            max_results: data_lines.len().min(500) as i64,
            auto_audit: true,
            auto_enrich_threshold: 70,
        })?;
        db.set_search_status(&search.id, "running", None)?;

        let mut imported_ids = Vec::new();
        let mut skipped = 0usize;

        for line in data_lines {
            let cols = parse_csv_line(line, delim);
            let get = |idx: Option<usize>| -> String {
                idx.and_then(|i| cols.get(i)).cloned().unwrap_or_default()
            };

            let (mut name, mut web, mut email, phone, loc, ind) = if has_header {
                (
                    get(col_name),
                    get(col_web),
                    get(col_email),
                    get(col_phone),
                    get(col_loc),
                    get(col_ind),
                )
            } else {
                // Headerless heuristics: detect URLs, emails, company names per column
                let mut n = String::new();
                let mut w = String::new();
                let mut em = String::new();
                let mut ph = String::new();
                for c in &cols {
                    let lc = c.to_lowercase();
                    if c.contains('@') && c.contains('.') && em.is_empty() {
                        em = c.clone();
                    } else if (lc.starts_with("http://")
                        || lc.starts_with("https://")
                        || lc.starts_with("www.")
                        || (c.contains('.') && !c.contains(' ') && c.len() >= 4))
                        && w.is_empty()
                    {
                        w = c.clone();
                    } else if c.starts_with('+') && ph.is_empty() {
                        ph = c.clone();
                    } else if n.is_empty() && !c.is_empty() {
                        n = c.clone();
                    }
                }
                (n, w, em, ph, String::new(), String::new())
            };

            // Normalize website if it looks like a bare domain
            if !web.is_empty() && !web.starts_with("http://") && !web.starts_with("https://") {
                web = format!("https://{}", web);
            }
            if name.is_empty() && !web.is_empty() {
                name = crawler::extract_domain(&web);
            }
            if name.is_empty() && !email.is_empty() {
                name = email.split('@').nth(1).unwrap_or(&email).to_string();
            }
            if name.is_empty() {
                skipped += 1;
                continue;
            }
            // Strip accidental mailto: prefix
            if email.to_lowercase().starts_with("mailto:") {
                email = email[7..].to_string();
            }

            if let Ok(lid) = db.upsert_discovered_lead(
                Some(&search.id),
                &name,
                &web,
                if ind.is_empty() { &proj.industry } else { &ind },
                &loc,
                "",
                &phone,
                &email,
                None,
                None,
                &format!("CSV ({})", file_name),
            ) {
                imported_ids.push(lid);
            }
        }

        db.log_activity(
            "search",
            "CSV leadek feltöltve",
            &format!("{} — {} cég betöltve, 5-ös párhuzamos kiértékelés indult", s_name, imported_ids.len()),
            None,
        );
        (search.id, s_name, imported_ids, skipped)
    };

    let imported_count = lead_ids.len();

    // Immediately launch 5-at-a-time concurrent evaluation in background with Stop support!
    let stop_flag = {
        let reg = app.state::<SearchControlRegistry>();
        reg.register(&search_id)
    };

    let app_bg = app.clone();
    let sid_bg = search_id.clone();
    let flag_bg = stop_flag.clone();

    let handle = tauri::async_runtime::handle().inner().spawn(async move {
        evaluate_lead_ids_in_batches(&app_bg, &sid_bg, lead_ids, flag_bg.clone()).await;
        let reg = app_bg.state::<SearchControlRegistry>();
        reg.unregister(&sid_bg, &flag_bg);
    });

    {
        let reg = app.state::<SearchControlRegistry>();
        reg.attach_abort(&search_id, &stop_flag, handle.abort_handle());
    }

    Ok(CsvImportResult {
        search_id,
        search_name,
        imported_count,
        skipped_count,
    })
}

/// Evaluates an explicit list of leads (e.g. from CSV import) strictly in 5-at-a-time concurrent batches, streaming page-level progress!
pub async fn evaluate_lead_ids_in_batches(
    app: &AppHandle,
    search_id: &str,
    lead_ids: Vec<String>,
    stop_flag: Arc<AtomicBool>,
) {
    let (search, project, offer, settings) = {
        let db = app.state::<Database>();
        let Ok(search) = db.get_search(search_id) else { return };
        let Ok(project) = db.get_project(&search.project_id) else { return };
        let offer = search.offer_id.as_deref().and_then(|oid| db.get_offer(oid).ok().flatten());
        let settings = db.get_settings().unwrap_or_default();
        (search, project, offer, settings)
    };

    let total = lead_ids.len();
    let mut processed = 0usize;
    let mut batch_num = 0usize;

    emit_live(
        app,
        search_id,
        "starting",
        None,
        None,
        None,
        None,
        None,
        format!("CSV kiértékelés indult: {} cég átnézése 5-ös párhuzamos adagokban...", total),
        0,
        total.max(1),
        1,
        0,
        false,
    );

    for chunk in lead_ids.chunks(5) {
        if stop_flag.load(Ordering::SeqCst) {
            break;
        }
        batch_num += 1;
        let leads_batch: Vec<Lead> = {
            let db = app.state::<Database>();
            chunk.iter().filter_map(|id| db.get_lead(id).ok()).collect()
        };
        let names: Vec<String> = leads_batch.iter().map(|l| l.company_name.clone()).collect();
        emit_live(
            app,
            search_id,
            "batch_start",
            None,
            None,
            None,
            None,
            None,
            format!("Adag #{} — {} cég vizsgálata: {}", batch_num, leads_batch.len(), names.join(", ")),
            processed,
            total.max(1),
            1,
            batch_num,
            false,
        );

        let mut handles = Vec::new();
        for lead in leads_batch {
            let app_c = app.clone();
            let sid_c = search_id.to_string();
            let settings_c = settings.clone();
            let project_c = project.clone();
            let offer_c = offer.clone();
            let search_c = search.clone();
            let stop_c = stop_flag.clone();
            let cur_done = processed;
            let b_num = batch_num;

            handles.push(tokio::spawn(async move {
                if stop_c.load(Ordering::SeqCst) {
                    return None;
                }
                let dom = crawler::extract_domain(&lead.website_url);
                let mut crawled_opt = if !lead.website_url.trim().is_empty() {
                    let app_p = app_c.clone();
                    let sid_p = sid_c.clone();
                    let lid_p = lead.id.clone();
                    let cname_p = lead.company_name.clone();
                    let dom_p = dom.clone();
                    crawler::crawl_website_with_progress(&lead.website_url, 2, move |pg, tot, u| {
                        emit_live_full(
                            &app_p,
                            &sid_p,
                            "auditing",
                            Some(lid_p.clone()),
                            Some(cname_p.clone()),
                            Some(dom_p.clone()),
                            None,
                            Some("auditing".into()),
                            format!("Audit ({}/{} oldal): {} — {}", pg, tot, cname_p, u),
                            cur_done,
                            total.max(1),
                            1,
                            b_num,
                            false,
                            Some(u.to_string()),
                            Some(pg),
                            Some(tot),
                        );
                    })
                    .await
                    .ok()
                } else {
                    None
                };

                if stop_c.load(Ordering::SeqCst) {
                    return None;
                }

                let mut analysis = ai::audit_and_score_lead(
                    &settings_c,
                    &project_c,
                    offer_c.as_ref(),
                    Some(&search_c),
                    &lead,
                    crawled_opt.as_ref().map(|c| &c.audit),
                    crawled_opt.as_ref().map(|c| c.combined_text.as_str()).unwrap_or(""),
                )
                .await;

                let is_promising = analysis.fit_score >= search_c.auto_enrich_threshold;
                let mut deep_enriched = false;

                if is_promising && !lead.website_url.trim().is_empty() && !stop_c.load(Ordering::SeqCst) {
                    let fit_now = analysis.fit_score;
                    let app_p = app_c.clone();
                    let sid_p = sid_c.clone();
                    let lid_p = lead.id.clone();
                    let cname_p = lead.company_name.clone();
                    let dom_p = dom.clone();
                    if let Ok(deep_crawl) = crawler::crawl_website_with_progress(&lead.website_url, 5, move |pg, tot, u| {
                        emit_live_full(
                            &app_p,
                            &sid_p,
                            "deep_enriching",
                            Some(lid_p.clone()),
                            Some(cname_p.clone()),
                            Some(dom_p.clone()),
                            Some(fit_now),
                            Some("deep_enriching".into()),
                            format!("Mély kutatás ({}/{} oldal): {} — {}", pg, tot, cname_p, u),
                            cur_done,
                            total.max(1),
                            1,
                            b_num,
                            false,
                            Some(u.to_string()),
                            Some(pg),
                            Some(tot),
                        );
                    }).await {
                        analysis = ai::audit_and_score_lead(
                            &settings_c,
                            &project_c,
                            offer_c.as_ref(),
                            Some(&search_c),
                            &lead,
                            Some(&deep_crawl.audit),
                            &deep_crawl.combined_text,
                        )
                        .await;
                        crawled_opt = Some(deep_crawl);
                        deep_enriched = true;
                    }
                }

                Some((lead, crawled_opt, analysis, deep_enriched))
            }));
        }

        for h in handles {
            if let Ok(Some((lead, crawled_opt, analysis, deep_enriched))) = h.await {
                processed += 1;
                let audit_ref = crawled_opt.as_ref().map(|c| &c.audit);
                let status = if deep_enriched {
                    "enriched"
                } else if analysis.fit_score >= search.auto_enrich_threshold {
                    "promising"
                } else if analysis.fit_score < 45 {
                    "disqualified"
                } else {
                    "new"
                };

                let mut contacts = lead.contacts.clone();
                let first_email = audit_ref.and_then(|a| a.extracted_emails.first().cloned());
                let first_phone = audit_ref.and_then(|a| a.extracted_phones.first().cloned());
                if let Some(ref em) = first_email {
                    if !contacts.iter().any(|c| c.email.eq_ignore_ascii_case(em)) {
                        contacts.push(LeadContact {
                            name: format!("{} Kapcsolat", lead.company_name),
                            role: "Központi / Vezetőség".into(),
                            email: em.clone(),
                            phone: first_phone.clone().unwrap_or_default(),
                            source: "CSV Audit".into(),
                        });
                    }
                }
                let tech = audit_ref.map(|a| a.tech_stack.clone()).unwrap_or_default();
                let clean_name = if !analysis.company_name.trim().is_empty() {
                    analysis.company_name.trim().to_string()
                } else {
                    lead.company_name.clone()
                };
                {
                    let db = app.state::<Database>();
                    let _ = db.update_lead_identity(
                        &lead.id,
                        Some(&clean_name),
                        Some(&analysis.detected_industry),
                    );
                    let _ = db.update_lead_enrichment(
                        &lead.id,
                        analysis.fit_score,
                        status,
                        deep_enriched,
                        &analysis.employee_estimate,
                        &analysis.company_summary,
                        &analysis.pain_points,
                        &analysis.how_we_can_help,
                        &analysis.recommended_pitch,
                        &tech,
                        &contacts,
                        first_email.as_deref(),
                        first_phone.as_deref(),
                        audit_ref,
                    );
                }

                let verdict = if analysis.fit_score >= search.auto_enrich_threshold {
                    "JÓ FIT"
                } else if analysis.fit_score < 45 {
                    "GYENGE FIT"
                } else {
                    "KÖZEPES"
                };
                emit_live(
                    app,
                    search_id,
                    "lead_done",
                    Some(lead.id.clone()),
                    Some(lead.company_name.clone()),
                    Some(lead.domain.clone()),
                    Some(analysis.fit_score),
                    Some(status.into()),
                    format!("Kész ({}/{}) — {}: Fit {} [{}]", processed, total, lead.company_name, analysis.fit_score, verdict),
                    processed,
                    total.max(1),
                    1,
                    batch_num,
                    false,
                );
            }
        }
    }

    let stopped = stop_flag.load(Ordering::SeqCst);
    {
        let db = app.state::<Database>();
        let _ = db.set_search_status(search_id, "completed", None);
    }
    emit_live(
        app,
        search_id,
        if stopped { "stopped" } else { "completed" },
        None,
        None,
        None,
        None,
        None,
        if stopped {
            format!("CSV kiértékelés leállítva ({}/{} cég átnézve).", processed, total)
        } else {
            format!("CSV kiértékelés kész! {}/{} cég átnézve és pontozva.", processed, total)
        },
        processed.max(1),
        total.max(1),
        1,
        batch_num,
        false,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_assistant_output_handles_hungarian_broken_quote() {
        let broken = r#"{"reply":"Sajnos nem tudom törölni a leadeket — nincs ilyen eszköz. Amit meg tudok tenni: az update_lead_status eszközzel „rejected"/archivált státuszra állítom őket.","actions":[],"navigate_to":"leads"}"#;
        let parsed = parse_assistant_output(broken).expect("should repair and parse broken HU quote");
        assert!(parsed.reply.contains("Sajnos nem tudom törölni"));
        assert!(!parsed.reply.starts_with('{'));
        assert_eq!(parsed.navigate_to.as_deref(), Some("leads"));
    }

    #[test]
    fn test_select_leads_by_below_score() {
        let make_lead = |id: &str, score: i64| Lead {
            id: id.into(),
            company_name: format!("Cég {}", id),
            domain: String::new(),
            website_url: String::new(),
            industry: String::new(),
            location: String::new(),
            address: String::new(),
            phone: String::new(),
            primary_email: "a@b.hu".into(),
            employee_estimate: String::new(),
            google_rating: None,
            google_reviews: None,
            source: String::new(),
            status: "new".into(),
            fit_score: score,
            enriched: false,
            company_summary: String::new(),
            pain_points: vec![],
            how_we_can_help: String::new(),
            recommended_pitch: String::new(),
            tech_stack: vec![],
            contacts: vec![],
            audit: None,
            tags: vec![],
            notes: String::new(),
            searches: vec![],
            created_at: String::new(),
            updated_at: String::new(),
        };
        let leads = vec![make_lead("1", 18), make_lead("2", 31), make_lead("3", 32), make_lead("4", 89)];
        let matched = select_leads_by_args(&leads, &serde_json::json!({ "belowScore": 32 }));
        let ids: Vec<String> = matched.into_iter().map(|l| l.id).collect();
        assert_eq!(ids, vec!["1", "2"]);
    }
}
