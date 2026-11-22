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

            // Wait for all 5 in this batch to complete, saving each result immediately
            for h in handles {
                if let Ok(Some((lead_id, comp, lead, crawled_opt, analysis, deep_enriched))) = h.await {
                    total_processed += 1;
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
                                name: format!("{} Kapcsolat", comp.company_name),
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

                    let dom = crawler::extract_domain(&comp.website_url);
                    let audit_score_str = audit_ref
                        .map(|a| format!(" • Audit: {}/100", a.overall_score))
                        .unwrap_or_default();
                    let msg = format!(
                        "Kész ({}/{}) — {}: Fit {}{}{}",
                        total_processed,
                        target_total,
                        comp.company_name,
                        analysis.fit_score,
                        audit_score_str,
                        if deep_enriched { " [Mély dosszié]" } else { "" }
                    );
                    emit_live(
                        app,
                        search_id,
                        "lead_done",
                        Some(lead_id),
                        Some(comp.company_name),
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

/// Fast, non-blocking Central AI Assistant: streams status, never swallows AI text, and runs heavy jobs in the background!
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
    let senders = db.list_sender_accounts()?;
    let analytics = db.get_analytics()?;

    // Keep context lean & compact for fast LLM / CLI turnaround
    let workspace_context = serde_json::json!({
        "activeSearchId": active_search_id,
        "stats": {
            "projects": projects.len(),
            "searches": searches.len(),
            "leads": leads.len(),
            "promising": analytics.promising_leads,
            "enriched": analytics.enriched_leads,
            "sent": analytics.total_sent,
            "replies": analytics.total_replies,
            "booked": analytics.booked_leads
        },
        "projects": projects.iter().take(6).map(|p| serde_json::json!({
            "id": p.id, "name": p.name, "url": p.website_url,
            "offers": p.offers.iter().take(5).map(|o| serde_json::json!({"id": o.id, "title": o.title, "val": o.discount_value})).collect::<Vec<_>>()
        })).collect::<Vec<_>>(),
        "searches": searches.iter().take(10).map(|s| serde_json::json!({
            "id": s.id, "name": s.name, "query": s.query, "loc": s.location,
            "src": s.source, "max": s.max_results, "found": s.leads_found, "status": s.status
        })).collect::<Vec<_>>(),
        "topLeads": leads.iter().take(8).map(|l| serde_json::json!({
            "id": l.id, "name": l.company_name, "email": l.primary_email,
            "fit": l.fit_score, "status": l.status
        })).collect::<Vec<_>>(),
        "campaigns": campaigns.iter().take(6).map(|c| serde_json::json!({
            "id": c.id, "name": c.name, "sent": c.sent_count, "replies": c.reply_count
        })).collect::<Vec<_>>()
    });

    let system_prompt = r#"Te vagy a MyLead központi végrehajtó AI asszisztense. Válaszolj GYORSAN, tömören magyarul, és adj vissza pontos JSON-t:
{"reply":"Konkrét magyar válasz","actions":[{"tool":"...","args":{...}}],"navigate_to":"dashboard|projects|searches|leads|campaigns|inbox|analytics|settings|null"}

ELÉRHETŐ ESZKÖZÖK:
- create_project: {"name","websiteUrl","industry","description","bookingUrl","landingUrl"}
- crawl_project: {"projectId":"id|LAST"}
- create_offer: {"projectId":"id|LAST","title","offerType":"discount|free_trial|audit","discountValue","description"}
- create_search: {"projectId":"id|LAST","offerId","name","query","industry","location","companySize":"any|1-10|11-50|51-200|200+","targetProblem","source":"smart_hybrid|duckduckgo|gmaps_scraper|ai_cli_search|osm","maxResults":15,"autoAudit":true,"autoEnrichThreshold":70}
- update_search: {"searchId":"id|activeSearchId","name","query","industry","location","companySize","targetProblem","source","maxResults","autoEnrichThreshold"}
- run_search: {"searchId":"id|LAST|activeSearchId","continuous":false} (ha folyamatos / leállításig futó keresést kér: "continuous":true!)
- stop_search: {"searchId":"id|activeSearchId"}
- enrich_leads: {"leadIds":[],"minScore":75}
- create_campaign: {"name","projectId","offerId","searchId","leadIds":[],"tone":"professional_formal|friendly_direct","autoReplyMode":"draft|autopilot","includeBookingLink":false}
- send_campaign: {"campaignId":"id|LAST","dryRun":true}
- update_lead_status: {"leadId","status","notes"}
- load_demo_data: {}

Kizárólag érvényes JSON-t adj vissza!"#;

    let recent_history = history
        .iter()
        .rev()
        .take(4)
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
                let cleaned = raw_text
                    .trim()
                    .trim_start_matches("```json")
                    .trim_start_matches("```")
                    .trim_end_matches("```")
                    .trim();
                match serde_json::from_str::<PlannedAssistantOutput>(cleaned) {
                    Ok(p) => p,
                    Err(_) => {
                        let plain = raw_text.trim();
                        if !plain.is_empty() {
                            PlannedAssistantOutput {
                                reply: plain.to_string(),
                                actions: vec![],
                                navigate_to: None,
                            }
                        } else {
                            ai_error_msg = Some(format!(
                                "Az AI modell ({} / {}) üres választ adott vissza.",
                                settings.ai_provider, settings.ai_model
                            ));
                            fallback_plan(user_message, &projects, &searches, &leads, &analytics, active_search_id)
                        }
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
                    max_results: args["maxResults"].as_i64().unwrap_or(15).clamp(1, 60),
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
                            max_results: args["maxResults"].as_i64().unwrap_or(cur.max_results).clamp(1, 60),
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
                                let crawled = if !lead.website_url.is_empty() {
                                    crawler::crawl_website(&lead.website_url, 5).await.ok()
                                } else {
                                    None
                                };
                                let audit_ref = crawled.as_ref().map(|c| &c.audit);
                                let txt = crawled.as_ref().map(|c| c.combined_text.as_str()).unwrap_or("");
                                let an = ai::audit_and_score_lead(&settings_c, &proj, proj.offers.first(), None, &lead, audit_ref, txt).await;
                                let first_em = audit_ref.and_then(|a| a.extracted_emails.first().cloned());
                                let first_ph = audit_ref.and_then(|a| a.extracted_phones.first().cloned());
                                let tech = audit_ref.map(|a| a.tech_stack.clone()).unwrap_or_else(|| lead.tech_stack.clone());
                                let db_bg = app_c.state::<Database>();
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
                let pid = resolve_id(args["projectId"].as_str(), &last_project_id);
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
                    offer_id: args["offerId"].as_str().map(|s| s.to_string()).filter(|s| !s.is_empty()),
                    search_id: sid.clone(),
                    sender_account_id: sender_id,
                    tone: args["tone"].as_str().unwrap_or("professional_formal").to_string(),
                    language: "hu".into(),
                    auto_reply_mode: args["autoReplyMode"].as_str().unwrap_or("draft").to_string(),
                    daily_limit: 35,
                    min_delay_sec: 45,
                    follow_up_days: 3,
                    include_booking_link: args["includeBookingLink"].as_bool().unwrap_or(false),
                    custom_instructions: args["customInstructions"].as_str().unwrap_or_default().to_string(),
                    lead_ids: lead_ids.clone(),
                };

                if let (Ok(proj), Ok(camp)) = (db.get_project(&pid), db.create_campaign(&input)) {
                    let offer = input.offer_id.as_deref().and_then(|oid| db.get_offer(oid).ok().flatten());
                    let targets: Vec<Lead> = if !lead_ids.is_empty() {
                        lead_ids.iter().filter_map(|id| db.get_lead(id).ok()).filter(|l| !l.primary_email.is_empty()).collect()
                    } else if let Some(ref s) = sid {
                        db.list_leads(Some(s), None, None, None).unwrap_or_default().into_iter().filter(|l| !l.primary_email.is_empty()).collect()
                    } else {
                        db.list_leads(None, None, Some(70), None).unwrap_or_default().into_iter().filter(|l| !l.primary_email.is_empty()).take(10).collect()
                    };
                    let target_count = targets.len();
                    let camp_id = camp.id.clone();
                    let camp_name = camp.name.clone();
                    let app_c = app.clone();
                    let settings_c = settings.clone();

                    // Generate personalized email drafts in background so assistant responds fast!
                    tokio::spawn(async move {
                        for l in &targets {
                            let gen = ai::generate_cold_email(
                                &settings_c, &proj, offer.as_ref(), l,
                                &camp.tone, &camp.language, camp.include_booking_link, &camp.custom_instructions,
                            ).await;
                            let db_bg = app_c.state::<Database>();
                            let _ = db_bg.insert_email_message(
                                Some(&camp.id), &l.id, "outbound", "draft", 1,
                                &gen.subject, &gen.body, None, None, None, None, false, None,
                            );
                        }
                    });

                    last_campaign_id = camp_id;
                    data_changed = true;
                    action_logs.push(AssistantActionLog {
                        tool: "create_campaign".into(),
                        summary: format!("Kampány létrehozva: {} ({} levéltervezet generálása indult)", camp_name, target_count),
                        ok: true,
                    });
                }
            }
            "send_campaign" => {
                let cid = resolve_id(args["campaignId"].as_str(), &last_campaign_id);
                let dry_run = args["dryRun"].as_bool().unwrap_or(true);
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
                            if let Ok(mid) = mailer::send_email(acc, &m.lead_email, &m.subject, &m.body, None).await {
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
                        status: args["status"].as_str().map(|s| s.to_string()),
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

    Ok(AssistantResponse {
        reply: if planned.reply.trim().is_empty() {
            "A kért műveleteket elindítottam.".to_string()
        } else {
            planned.reply
        },
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
                {
                    let db = app.state::<Database>();
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
