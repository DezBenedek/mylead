use crate::ai;
use crate::assistant;
use crate::crawler;
use crate::db::Database;
use crate::discovery;
use crate::mailer;
use crate::models::*;
use crate::seed;
use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager, State};

fn emit_progress(app: &AppHandle, job_type: &str, job_id: &str, current: usize, total: usize, message: String) {
    let _ = app.emit(
        "job-progress",
        JobProgressEvent {
            job_type: job_type.to_string(),
            job_id: job_id.to_string(),
            current,
            total,
            message,
        },
    );
}

// ==================== PROJECTS & OFFERS ====================

#[tauri::command]
pub fn list_projects(db: State<Database>) -> Result<Vec<Project>, String> {
    db.list_projects()
}

#[tauri::command]
pub fn save_project(db: State<Database>, input: ProjectInput) -> Result<Project, String> {
    let p = db.save_project(input)?;
    db.log_activity("project", "Projekt mentve", &p.name, None);
    Ok(p)
}

#[tauri::command]
pub fn delete_project(db: State<Database>, id: String) -> Result<(), String> {
    db.delete_project(&id)
}

#[tauri::command]
pub fn save_offer(db: State<Database>, input: OfferInput) -> Result<Offer, String> {
    db.save_offer(input)
}

#[tauri::command]
pub fn delete_offer(db: State<Database>, id: String) -> Result<(), String> {
    db.delete_offer(&id)
}

#[tauri::command]
pub async fn crawl_and_analyze_project(
    app: AppHandle,
    db: State<'_, Database>,
    project_id: String,
) -> Result<Project, String> {
    let project = db.get_project(&project_id)?;
    let settings = db.get_settings()?;
    if project.website_url.trim().is_empty() {
        return Err("Adj meg egy weboldal URL-t a projekt feltérképezéséhez!".to_string());
    }

    emit_progress(&app, "project_crawl", &project_id, 1, 3, format!("Weboldal letöltése: {}", project.website_url));
    let crawled = crawler::crawl_website(&project.website_url, 5).await?;

    emit_progress(&app, "project_crawl", &project_id, 2, 3, format!("{} aloldal feldolgozva, AI pozicionálás építése...", crawled.pages_crawled));
    let profile = ai::analyze_project_website(&settings, &project, &crawled).await;

    let updated = db.update_project_ai_profile(
        &project_id,
        &profile.value_proposition,
        &profile.target_audience,
        &profile.pain_points_solved,
        &profile.pitch_angles,
        &profile.objection_handlers,
        &profile.crawled_summary,
        crawled.pages_crawled,
    )?;

    db.log_activity(
        "project",
        "Weboldal feltérképezve",
        &format!("{} — {} oldal elemezve", updated.name, crawled.pages_crawled),
        None,
    );
    emit_progress(&app, "project_crawl", &project_id, 3, 3, "Projekt profil elkészült!".to_string());
    Ok(updated)
}

// ==================== SEARCHES & DISCOVERY ====================

#[tauri::command]
pub fn list_searches(db: State<Database>) -> Result<Vec<SearchJob>, String> {
    db.list_searches()
}

#[tauri::command]
pub fn save_search(db: State<Database>, input: SearchJobInput) -> Result<SearchJob, String> {
    db.save_search(input)
}

#[tauri::command]
pub fn delete_search(db: State<Database>, id: String) -> Result<(), String> {
    db.delete_search(&id)
}

#[tauri::command]
pub async fn run_search_job(
    app: AppHandle,
    db: State<'_, Database>,
    search_id: String,
) -> Result<SearchJob, String> {
    assistant::spawn_search_job(app, search_id.clone(), false)?;
    db.get_search(&search_id)
}

#[tauri::command]
pub async fn start_search_job(
    app: AppHandle,
    db: State<'_, Database>,
    search_id: String,
    continuous: bool,
) -> Result<SearchJob, String> {
    assistant::spawn_search_job(app, search_id.clone(), continuous)?;
    db.get_search(&search_id)
}

#[tauri::command]
pub fn stop_search_job(
    app: AppHandle,
    search_id: String,
) -> Result<bool, String> {
    assistant::force_stop_search_job(&app, &search_id)
}

#[tauri::command]
pub fn list_running_searches(
    reg: State<'_, assistant::SearchControlRegistry>,
) -> Result<Vec<String>, String> {
    Ok(reg.list_running())
}

#[tauri::command]
pub async fn optimize_search_with_ai(
    db: State<'_, Database>,
    input: SearchJobInput,
    instruction: String,
) -> Result<SearchOptimizationResult, String> {
    let settings = db.get_settings()?;
    let project = db.get_project(&input.project_id)?;
    Ok(ai::optimize_search_config(&settings, &project, &input, &instruction).await)
}

#[tauri::command]
pub async fn run_assistant_command(
    app: AppHandle,
    db: State<'_, Database>,
    message: String,
    history: Vec<AssistantChatMessage>,
    active_search_id: Option<String>,
) -> Result<AssistantResponse, String> {
    assistant::run_central_assistant(&app, &db, &message, &history, active_search_id.as_deref()).await
}

#[tauri::command]
pub async fn import_csv_and_evaluate(
    app: AppHandle,
    file_name: String,
    csv_content: String,
    instruction: String,
    project_id: Option<String>,
) -> Result<CsvImportResult, String> {
    assistant::import_csv_and_evaluate(app, file_name, csv_content, instruction, project_id)
}

#[tauri::command]
pub async fn import_manual_leads(
    app: AppHandle,
    db: State<'_, Database>,
    search_id: Option<String>,
    raw_lines: String,
    run_audit: bool,
) -> Result<usize, String> {
    let settings = db.get_settings()?;
    let search_opt = match &search_id {
        Some(sid) if !sid.is_empty() => db.get_search(sid).ok(),
        _ => None,
    };
    let project_opt = match &search_opt {
        Some(s) => db.get_project(&s.project_id).ok(),
        None => db.list_projects()?.into_iter().next(),
    };
    let offer_opt = match search_opt.as_ref().and_then(|s| s.offer_id.as_ref()) {
        Some(oid) => db.get_offer(oid).ok().flatten(),
        None => None,
    };

    let lines: Vec<String> = raw_lines
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    let total = lines.len().max(1);
    let mut imported = 0usize;

    for (idx, line) in lines.iter().enumerate() {
        // Supports "Company Name, https://domain.hu, email@domain.hu" OR just "https://domain.hu"
        let parts: Vec<&str> = line.split(|c| c == ',' || c == ';' || c == '\t').map(|s| s.trim()).collect();
        let (company_name, website_url, email) = if parts.len() >= 2 {
            (
                parts[0].to_string(),
                parts[1].to_string(),
                parts.get(2).copied().unwrap_or("").to_string(),
            )
        } else {
            let dom = crawler::extract_domain(parts[0]);
            let fallback_name = if !dom.is_empty() { dom.clone() } else { parts[0].to_string() };
            (fallback_name, parts[0].to_string(), String::new())
        };

        emit_progress(&app, "import", "manual", idx + 1, total, format!("Importálás ({}/{}): {}", idx + 1, total, company_name));

        let lead_id = db.upsert_discovered_lead(
            search_opt.as_ref().map(|s| s.id.as_str()),
            &company_name,
            &website_url,
            search_opt.as_ref().map(|s| s.industry.as_str()).unwrap_or("B2B"),
            search_opt.as_ref().map(|s| s.location.as_str()).unwrap_or(""),
            "",
            "",
            &email,
            None,
            None,
            "Kézi import",
        )?;
        imported += 1;

        if run_audit {
            if let Some(ref proj) = project_opt {
                let lead = db.get_lead(&lead_id)?;
                let crawled = crawler::crawl_website(&website_url, 2).await.ok();
                let audit_ref = crawled.as_ref().map(|c| &c.audit);
                let text = crawled.as_ref().map(|c| c.combined_text.as_str()).unwrap_or("");
                let analysis = ai::audit_and_score_lead(&settings, proj, offer_opt.as_ref(), search_opt.as_ref(), &lead, audit_ref, text).await;
                let first_email = audit_ref.and_then(|a| a.extracted_emails.first().cloned());
                let first_phone = audit_ref.and_then(|a| a.extracted_phones.first().cloned());
                let tech = audit_ref.map(|a| a.tech_stack.clone()).unwrap_or_default();
                let _ = db.update_lead_enrichment(
                    &lead_id,
                    analysis.fit_score,
                    if analysis.fit_score >= 70 { "promising" } else { "new" },
                    crawled.is_some(),
                    &analysis.employee_estimate,
                    &analysis.company_summary,
                    &analysis.pain_points,
                    &analysis.how_we_can_help,
                    &analysis.recommended_pitch,
                    &tech,
                    &lead.contacts,
                    first_email.as_deref(),
                    first_phone.as_deref(),
                    audit_ref,
                );
            }
        }
    }

    db.log_activity("search", "Kézi lead import", &format!("{} cég hozzáadva a központi adatbázishoz", imported), None);
    Ok(imported)
}

// ==================== LEADS & DEEP ENRICHMENT ====================

#[tauri::command]
pub fn list_leads(
    db: State<Database>,
    search_id: Option<String>,
    status: Option<String>,
    min_score: Option<i64>,
    query: Option<String>,
) -> Result<Vec<Lead>, String> {
    db.list_leads(search_id.as_deref(), status.as_deref(), min_score, query.as_deref())
}

#[tauri::command]
pub fn get_lead(db: State<Database>, id: String) -> Result<Lead, String> {
    db.get_lead(&id)
}

#[tauri::command]
pub fn update_lead(db: State<Database>, input: LeadUpdateInput) -> Result<Lead, String> {
    db.update_lead_fields(input)
}

#[tauri::command]
pub fn delete_leads(db: State<Database>, ids: Vec<String>) -> Result<(), String> {
    db.delete_leads(&ids)
}

#[tauri::command]
pub fn bulk_update_lead_status(db: State<Database>, ids: Vec<String>, status: String) -> Result<usize, String> {
    db.bulk_update_lead_status(&ids, &status)
}

#[tauri::command]
pub async fn create_manual_lead(
    app: AppHandle,
    db: State<'_, Database>,
    input: CreateLeadInput,
) -> Result<Lead, String> {
    if input.company_name.trim().is_empty() {
        return Err("Add meg a cég nevét!".to_string());
    }
    let lead_id = db.upsert_discovered_lead(
        None,
        input.company_name.trim(),
        input.website_url.trim(),
        if input.industry.trim().is_empty() { "B2B" } else { input.industry.trim() },
        input.location.trim(),
        "",
        input.phone.trim(),
        input.primary_email.trim(),
        None,
        None,
        "Kézi felvétel",
    )?;
    if !input.notes.trim().is_empty() {
        let _ = db.update_lead_fields(LeadUpdateInput {
            id: lead_id.clone(),
            notes: Some(input.notes.trim().to_string()),
            ..Default::default()
        });
    }
    if input.run_audit && !input.website_url.trim().is_empty() {
        let settings = db.get_settings()?;
        if let Some(proj) = db.list_projects()?.into_iter().next() {
            let lead = db.get_lead(&lead_id)?;
            emit_progress(&app, "import", &lead_id, 1, 2, format!("Weboldal audit: {}", lead.company_name));
            let crawled = crawler::crawl_website(&input.website_url, 3).await.ok();
            let audit_ref = crawled.as_ref().map(|c| &c.audit);
            let text = crawled.as_ref().map(|c| c.combined_text.as_str()).unwrap_or("");
            let analysis = ai::audit_and_score_lead(&settings, &proj, proj.offers.first(), None, &lead, audit_ref, text).await;
            let first_email = audit_ref.and_then(|a| a.extracted_emails.first().cloned());
            let first_phone = audit_ref.and_then(|a| a.extracted_phones.first().cloned());
            let tech = audit_ref.map(|a| a.tech_stack.clone()).unwrap_or_default();
            let _ = db.update_lead_enrichment(
                &lead_id,
                analysis.fit_score,
                if analysis.fit_score >= 70 { "promising" } else { "new" },
                crawled.is_some(),
                &analysis.employee_estimate,
                &analysis.company_summary,
                &analysis.pain_points,
                &analysis.how_we_can_help,
                &analysis.recommended_pitch,
                &tech,
                &lead.contacts,
                first_email.as_deref(),
                first_phone.as_deref(),
                audit_ref,
            );
            emit_progress(&app, "import", &lead_id, 2, 2, format!("Kész: {}", lead.company_name));
        }
    }
    db.log_activity("search", "Új lead manuálisan felvéve", input.company_name.trim(), Some(&lead_id));
    db.get_lead(&lead_id)
}

#[tauri::command]
pub async fn enrich_leads(
    app: AppHandle,
    db: State<'_, Database>,
    lead_ids: Vec<String>,
    project_id: Option<String>,
) -> Result<Vec<Lead>, String> {
    let settings = db.get_settings()?;
    let project = match project_id {
        Some(pid) if !pid.is_empty() => db.get_project(&pid)?,
        _ => db
            .list_projects()?
            .into_iter()
            .next()
            .ok_or_else(|| "Hozz létre legalább egy Projektet a gazdagítás előtt!".to_string())?,
    };
    let offer = project.offers.first().cloned();
    let total = lead_ids.len().max(1);
    let mut updated = Vec::new();
    let mut done = 0usize;

    // Run up to 5 leads in parallel per batch and stream per-subpage progress to frontend!
    for chunk in lead_ids.chunks(5) {
        let mut handles = Vec::new();
        for lid in chunk {
            let lead = db.get_lead(lid)?;
            let app_c = app.clone();
            let settings_c = settings.clone();
            let project_c = project.clone();
            let offer_c = offer.clone();
            let cur_done = done;

            handles.push(tauri::async_runtime::handle().inner().spawn(async move {
                let dom = crawler::extract_domain(&lead.website_url);
                let search_ctx = lead
                    .searches
                    .first()
                    .map(|s| s.search_id.clone())
                    .unwrap_or_else(|| "manual-enrich".to_string());

                let crawled = if !lead.website_url.trim().is_empty() {
                    let app_p = app_c.clone();
                    let sid_p = search_ctx.clone();
                    let lid_p = lead.id.clone();
                    let cname_p = lead.company_name.clone();
                    let dom_p = dom.clone();
                    let fit_p = lead.fit_score;
                    crawler::crawl_website_with_progress(&lead.website_url, 5, move |pg, tot, u| {
                        let _ = app_p.emit(
                            "search-live-event",
                            SearchLiveEvent {
                                search_id: sid_p.clone(),
                                phase: "deep_enriching".into(),
                                lead_id: Some(lid_p.clone()),
                                company_name: Some(cname_p.clone()),
                                domain: Some(dom_p.clone()),
                                fit_score: Some(fit_p),
                                status: Some("deep_enriching".into()),
                                message: format!("Mély kutatás ({}/{} oldal): {} — {}", pg, tot, cname_p, u),
                                current: cur_done,
                                total,
                                round: 1,
                                batch: 1,
                                continuous: false,
                                current_url: Some(u.to_string()),
                                pages_crawled: Some(pg),
                                pages_total: Some(tot),
                                timestamp: Utc::now().to_rfc3339(),
                            },
                        );
                    })
                    .await
                    .ok()
                } else {
                    None
                };

                let audit_ref = crawled.as_ref().map(|c| &c.audit);
                let text = crawled.as_ref().map(|c| c.combined_text.as_str()).unwrap_or("");
                let analysis = ai::audit_and_score_lead(
                    &settings_c,
                    &project_c,
                    offer_c.as_ref(),
                    None,
                    &lead,
                    audit_ref,
                    text,
                )
                .await;
                (lead, search_ctx, crawled, analysis)
            }));
        }

        for h in handles {
            if let Ok((lead, search_ctx, crawled, analysis)) = h.await {
                done += 1;
                let audit_ref = crawled.as_ref().map(|c| &c.audit);
                let mut contacts = lead.contacts.clone();
                let mut first_email = None;
                let mut first_phone = None;

                if let Some(a) = audit_ref {
                    first_email = a.extracted_emails.first().cloned();
                    first_phone = a.extracted_phones.first().cloned();
                    for em in &a.extracted_emails {
                        if !contacts.iter().any(|c| c.email.eq_ignore_ascii_case(em)) {
                            contacts.push(LeadContact {
                                name: format!("{} ({})", lead.company_name, em.split('@').next().unwrap_or("kapcsolat")),
                                role: if em.starts_with("info@") || em.starts_with("iroda@") {
                                    "Központi iroda".to_string()
                                } else {
                                    "Kapcsolattartó".to_string()
                                },
                                email: em.clone(),
                                phone: first_phone.clone().unwrap_or_default(),
                                source: "Mély weboldal-bejárás".to_string(),
                            });
                        }
                    }
                }

                let tech = audit_ref
                    .map(|a| a.tech_stack.clone())
                    .unwrap_or_else(|| lead.tech_stack.clone());

                let saved = db.update_lead_enrichment(
                    &lead.id,
                    analysis.fit_score,
                    "enriched",
                    true,
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
                )?;

                let _ = app.emit(
                    "search-live-event",
                    SearchLiveEvent {
                        search_id: search_ctx,
                        phase: "lead_done".into(),
                        lead_id: Some(saved.id.clone()),
                        company_name: Some(saved.company_name.clone()),
                        domain: Some(saved.domain.clone()),
                        fit_score: Some(saved.fit_score),
                        status: Some(saved.status.clone()),
                        message: format!("Mély adatlap kész ({}/{}): {} — Fit {}", done, total, saved.company_name, saved.fit_score),
                        current: done,
                        total,
                        round: 1,
                        batch: 1,
                        continuous: false,
                        current_url: None,
                        pages_crawled: None,
                        pages_total: None,
                        timestamp: Utc::now().to_rfc3339(),
                    },
                );
                emit_progress(
                    &app,
                    "enrich",
                    &saved.id,
                    done,
                    total,
                    format!("Mély adatlap kész ({}/{}): {}", done, total, saved.company_name),
                );
                updated.push(saved);
            }
        }
    }

    db.log_activity(
        "enrich",
        "Mély gazdagítás elkészült",
        &format!("{} lead adatlapja frissítve", updated.len()),
        updated.first().map(|l| l.id.as_str()),
    );
    Ok(updated)
}

// ==================== CAMPAIGNS & OUTREACH ====================

#[tauri::command]
pub fn list_campaigns(db: State<Database>) -> Result<Vec<Campaign>, String> {
    db.list_campaigns()
}

#[tauri::command]
pub fn list_campaign_messages(db: State<Database>, campaign_id: String) -> Result<Vec<EmailMessage>, String> {
    db.list_campaign_messages(&campaign_id)
}

#[tauri::command]
pub async fn create_campaign_with_drafts(
    app: AppHandle,
    db: State<'_, Database>,
    mut input: CampaignInput,
) -> Result<Campaign, String> {
    let settings = db.get_settings()?;
    let offer = match &input.offer_id {
        Some(oid) if !oid.is_empty() => db.get_offer(oid)?,
        _ => None,
    };
    // Resolve project automatically from Offer if project_id was omitted!
    if input.project_id.trim().is_empty() {
        if let Some(ref o) = offer {
            input.project_id = o.project_id.clone();
        } else if let Some(first_p) = db.list_projects()?.into_iter().next() {
            input.project_id = first_p.id;
        }
    }
    let project = db.get_project(&input.project_id)?;

    // Determine target leads: explicit lead_ids OR all leads with email from search_id
    let target_leads: Vec<Lead> = if !input.lead_ids.is_empty() {
        let mut out = Vec::new();
        for lid in &input.lead_ids {
            if let Ok(l) = db.get_lead(lid) {
                if !l.primary_email.trim().is_empty() && !db.is_suppressed(&l.primary_email) {
                    out.push(l);
                }
            }
        }
        out
    } else if let Some(ref sid) = input.search_id {
        db.list_leads(Some(sid), None, None, None)?
            .into_iter()
            .filter(|l| !l.primary_email.trim().is_empty() && !db.is_suppressed(&l.primary_email))
            .collect()
    } else {
        vec![]
    };

    let campaign = db.create_campaign(&input)?;
    let total = target_leads.len().max(1);

    for (idx, lead) in target_leads.iter().enumerate() {
        emit_progress(
            &app,
            "campaign_draft",
            &campaign.id,
            idx + 1,
            total,
            format!("Személyre szabott levél írása ({}/{}): {}", idx + 1, total, lead.company_name),
        );

        let generated = ai::generate_cold_email(
            &settings,
            &project,
            offer.as_ref(),
            lead,
            &campaign.tone,
            &campaign.language,
            campaign.include_booking_link,
            &campaign.custom_instructions,
        )
        .await;

        let booking_included = campaign.include_booking_link
            && !project.booking_url.is_empty()
            && generated.body.contains(&project.booking_url);

        db.insert_email_message(
            Some(&campaign.id),
            &lead.id,
            "outbound",
            "draft",
            1,
            &generated.subject,
            &generated.body,
            None,
            None,
            None,
            None,
            booking_included,
            None,
        )?;
    }

    db.log_activity(
        "campaign",
        "Új kampány létrehozva",
        &format!("{} — {} személyre szabott levéltervezet elkészült", campaign.name, target_leads.len()),
        None,
    );
    db.get_campaign(&campaign.id)
}

#[tauri::command]
pub fn update_campaign(db: State<Database>, mut input: CampaignUpdateInput) -> Result<Campaign, String> {
    if let Some(ref oid) = input.offer_id {
        if !oid.trim().is_empty() {
            if let Ok(Some(off)) = db.get_offer(oid) {
                input.project_id = Some(off.project_id);
            }
        }
    }
    db.update_campaign(&input)
}

#[tauri::command]
pub async fn add_leads_to_campaign(
    app: AppHandle,
    db: State<'_, Database>,
    campaign_id: String,
    lead_ids: Vec<String>,
    generate_drafts: bool,
) -> Result<Campaign, String> {
    let campaign = db.get_campaign(&campaign_id)?;
    let project = db.get_project(&campaign.project_id)?;
    let offer = match &campaign.offer_id {
        Some(oid) if !oid.is_empty() => db.get_offer(oid)?,
        _ => project.offers.first().cloned(),
    };
    let settings = db.get_settings()?;

    let mut targets = Vec::new();
    for lid in &lead_ids {
        if db.campaign_has_lead(&campaign_id, lid) {
            continue;
        }
        if let Ok(l) = db.get_lead(lid) {
            if !l.primary_email.trim().is_empty() && !db.is_suppressed(&l.primary_email) {
                targets.push(l);
            }
        }
    }

    let total = targets.len().max(1);
    for (idx, lead) in targets.iter().enumerate() {
        emit_progress(
            &app,
            "campaign_draft",
            &campaign.id,
            idx + 1,
            total,
            format!("Lead hozzáadása a kampányhoz ({}/{}): {}", idx + 1, total, lead.company_name),
        );

        let (subject, body) = if generate_drafts {
            let gen = ai::generate_cold_email(
                &settings,
                &project,
                offer.as_ref(),
                lead,
                &campaign.tone,
                &campaign.language,
                campaign.include_booking_link,
                &campaign.custom_instructions,
            )
            .await;
            (gen.subject, gen.body)
        } else {
            (
                format!("{} — megkeresés", lead.company_name),
                format!("Tisztelt {}!\n\n\n\n{}", lead.company_name, settings.company_signature),
            )
        };

        let booking_included = !project.booking_url.is_empty() && body.contains(&project.booking_url);
        db.insert_email_message(
            Some(&campaign.id),
            &lead.id,
            "outbound",
            "draft",
            1,
            &subject,
            &body,
            None,
            None,
            None,
            None,
            booking_included,
            None,
        )?;
    }

    db.log_activity(
        "campaign",
        "Leadek manuálisan kampányba véve",
        &format!("{} — {} új cég hozzáadva", campaign.name, targets.len()),
        None,
    );
    db.get_campaign(&campaign.id)
}

#[tauri::command]
pub async fn regenerate_email_draft(
    db: State<'_, Database>,
    message_id: String,
    instruction: Option<String>,
) -> Result<EmailMessage, String> {
    let msg = db.get_email_message(&message_id)?;
    let lead = db.get_lead(&msg.lead_id)?;
    let settings = db.get_settings()?;
    let campaign = msg.campaign_id.as_deref().and_then(|cid| db.get_campaign(cid).ok());
    let project = match &campaign {
        Some(c) => db.get_project(&c.project_id).ok(),
        None => db.list_projects()?.into_iter().next(),
    };
    let offer = campaign
        .as_ref()
        .and_then(|c| c.offer_id.as_deref())
        .and_then(|oid| db.get_offer(oid).ok().flatten())
        .or_else(|| project.as_ref().and_then(|p| p.offers.first().cloned()));

    let updated = if let Some(instr) = instruction.as_deref().filter(|s| !s.trim().is_empty()) {
        let history = db.list_lead_messages(&lead.id).unwrap_or_default();
        ai::rewrite_email_with_instruction(
            &settings,
            project.as_ref(),
            offer.as_ref(),
            &lead,
            &history,
            &msg.subject,
            &msg.body,
            instr,
        )
        .await?
    } else if let Some(ref proj) = project {
        ai::generate_cold_email(
            &settings,
            proj,
            offer.as_ref(),
            &lead,
            campaign.as_ref().map(|c| c.tone.as_str()).unwrap_or(&settings.default_tone),
            &settings.default_language,
            campaign.as_ref().is_some_and(|c| c.include_booking_link),
            campaign.as_ref().map(|c| c.custom_instructions.as_str()).unwrap_or(""),
        )
        .await
    } else {
        return Err("Nincs projekt az újrageneráláshoz.".to_string());
    };

    db.update_email_message_content(&message_id, &updated.subject, &updated.body, instruction.as_deref())
}

#[tauri::command]
pub async fn generate_direct_email_draft(
    db: State<'_, Database>,
    lead_id: String,
    offer_id: Option<String>,
    tone: String,
    instruction: String,
) -> Result<ai::GeneratedEmail, String> {
    let lead = db.get_lead(&lead_id)?;
    let settings = db.get_settings()?;
    let offer = match offer_id.as_deref().filter(|s| !s.is_empty()) {
        Some(oid) => db.get_offer(oid)?,
        None => None,
    };
    let project = match &offer {
        Some(o) => db.get_project(&o.project_id)?,
        None => db
            .list_projects()?
            .into_iter()
            .next()
            .ok_or_else(|| "Hozz létre legalább egy Projektet / Ajánlatot az AI levélíráshoz!".to_string())?,
    };
    let resolved_offer = offer.or_else(|| project.offers.first().cloned());

    Ok(ai::generate_cold_email(
        &settings,
        &project,
        resolved_offer.as_ref(),
        &lead,
        if tone.is_empty() { &settings.default_tone } else { &tone },
        &settings.default_language,
        true,
        &instruction,
    )
    .await)
}

#[tauri::command]
pub async fn send_direct_email(
    app: AppHandle,
    db: State<'_, Database>,
    input: DirectEmailInput,
) -> Result<InboxThread, String> {
    let lead = db.get_lead(&input.lead_id)?;
    if lead.primary_email.trim().is_empty() {
        return Err("Ennek a leadnek nincs megadott e-mail címe!".to_string());
    }
    if db.is_suppressed(&lead.primary_email) {
        return Err("Ez az e-mail cím a tiltólistán (leiratkozott) szerepel!".to_string());
    }
    let settings = db.get_settings()?;
    let offer = match input.offer_id.as_deref().filter(|s| !s.is_empty()) {
        Some(oid) => db.get_offer(oid).ok().flatten(),
        None => None,
    };
    let project = match &offer {
        Some(o) => db.get_project(&o.project_id).ok(),
        None => db.list_projects()?.into_iter().next(),
    };
    let booking_sent = project
        .as_ref()
        .is_some_and(|p| !p.booking_url.is_empty() && input.body.contains(&p.booking_url));

    if input.schedule_mode == "auto_random" || input.schedule_mode == "custom" {
        let scheduled_at = if input.schedule_mode == "custom" {
            input
                .scheduled_send_at
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| ai::compute_random_business_send_time(&settings))
        } else {
            ai::compute_random_business_send_time(&settings)
        };
        db.insert_email_message_full(
            None,
            &lead.id,
            "outbound",
            "queued",
            2,
            &input.subject,
            &input.body,
            None,
            None,
            None,
            None,
            booking_sent,
            None,
            Some(&scheduled_at),
            Some("scheduled"),
            None,
            None,
        )?;
        db.log_activity(
            "campaign",
            "Közvetlen üzenet időzítve",
            &format!("{} ({}) — kiküldés időzítve", lead.company_name, lead.primary_email),
            Some(&lead.id),
        );
    } else {
        let msg_id = if input.dry_run {
            format!("<direct-sim-{}.mylead@local>", uuid::Uuid::new_v4())
        } else {
            let accounts = db.list_sender_accounts()?;
            let account = input
                .sender_account_id
                .as_deref()
                .and_then(|aid| accounts.iter().find(|a| a.id == aid))
                .or_else(|| accounts.iter().find(|a| a.is_default))
                .or_else(|| accounts.first())
                .ok_or_else(|| "Nincs beállított SMTP vagy Amazon SES fiók a küldéshez!".to_string())?;
            let id = mailer::send_email(account, &lead.primary_email, &input.subject, &input.body, None).await?;
            db.increment_sender_sent_today(&account.id);
            id
        };
        db.insert_email_message_full(
            None,
            &lead.id,
            "outbound",
            "sent",
            1,
            &input.subject,
            &input.body,
            Some(&msg_id),
            None,
            None,
            None,
            booking_sent,
            Some(&Utc::now().to_rfc3339()),
            None,
            None,
            None,
            None,
        )?;
        if matches!(lead.status.as_str(), "new" | "promising" | "enriched") {
            let _ = db.update_lead_fields(LeadUpdateInput {
                id: lead.id.clone(),
                status: Some("in_campaign".to_string()),
                ..Default::default()
            });
        }
        db.log_activity(
            "campaign",
            if input.dry_run { "Szimulált közvetlen üzenet" } else { "Közvetlen üzenet elküldve" },
            &format!("{} ({})", lead.company_name, lead.primary_email),
            Some(&lead.id),
        );
    }

    let _ = app.emit("inbox-updated", ());
    db.list_inbox_threads()?
        .into_iter()
        .find(|t| t.lead_id == lead.id)
        .ok_or_else(|| "Beszélgetés nem található".to_string())
}

#[tauri::command]
pub fn update_email_draft(db: State<Database>, message_id: String, subject: String, body: String) -> Result<(), String> {
    db.update_email_draft(&message_id, &subject, &body)
}

#[tauri::command]
pub fn delete_campaign(db: State<Database>, id: String) -> Result<(), String> {
    db.delete_campaign(&id)
}

#[tauri::command]
pub async fn send_campaign_drafts(
    app: AppHandle,
    db: State<'_, Database>,
    campaign_id: String,
    dry_run: bool,
) -> Result<Campaign, String> {
    let campaign = db.get_campaign(&campaign_id)?;
    let account_id = campaign
        .sender_account_id
        .clone()
        .ok_or_else(|| "Válassz SMTP vagy Amazon SES küldő fiókot a kampányhoz!".to_string())?;
    let account = db.get_sender_account(&account_id)?;
    let project = db.get_project(&campaign.project_id)?;

    let messages: Vec<EmailMessage> = db
        .list_campaign_messages(&campaign_id)?
        .into_iter()
        .filter(|m| m.direction == "outbound" && (m.status == "draft" || m.status == "failed"))
        .collect();

    if messages.is_empty() {
        return Err("Nincs kiküldésre váró levéltervezet ebben a kampányban.".to_string());
    }

    db.update_campaign_status(&campaign_id, "active")?;
    let max_to_send = ((account.daily_limit - account.sent_today).max(0) as usize).min(campaign.daily_limit as usize);
    let slice: Vec<EmailMessage> = messages.into_iter().take(if dry_run { 50 } else { max_to_send.max(1) }).collect();
    let total = slice.len();
    let mut sent_ok = 0usize;

    for (idx, msg) in slice.iter().enumerate() {
        if db.is_suppressed(&msg.lead_email) {
            db.mark_email_failed(&msg.id, "Címzett a tiltólistán (leiratkozott) szerepel")?;
            continue;
        }
        emit_progress(
            &app,
            "campaign_send",
            &campaign_id,
            idx + 1,
            total,
            format!("{} ({}/{}): {}", if dry_run { "Szimulált küldés" } else { "Küldés" }, idx + 1, total, msg.lead_email),
        );

        let has_booking = !project.booking_url.is_empty() && msg.body.contains(&project.booking_url);

        if dry_run {
            let fake_id = format!("<sim-{}.mylead@local>", uuid::Uuid::new_v4());
            db.mark_email_sent(&msg.id, &fake_id, has_booking)?;
            let _ = db.update_lead_fields(LeadUpdateInput {
                id: msg.lead_id.clone(),
                status: Some("in_campaign".to_string()),
                ..Default::default()
            });
            sent_ok += 1;
        } else {
            match mailer::send_email(&account, &msg.lead_email, &msg.subject, &msg.body, None).await {
                Ok(msg_id) => {
                    db.mark_email_sent(&msg.id, &msg_id, has_booking)?;
                    db.increment_sender_sent_today(&account.id);
                    let _ = db.update_lead_fields(LeadUpdateInput {
                        id: msg.lead_id.clone(),
                        status: Some("in_campaign".to_string()),
                        ..Default::default()
                    });
                    sent_ok += 1;
                }
                Err(e) => {
                    db.mark_email_failed(&msg.id, &e)?;
                }
            }
        }
    }

    db.log_activity(
        "campaign",
        if dry_run { "Kampány szimulált kiküldése" } else { "Kampány levelek kiküldve" },
        &format!("{} — {}/{} levél sikeres", campaign.name, sent_ok, total),
        None,
    );
    db.get_campaign(&campaign_id)
}

// ==================== INBOX & AI AUTO-RESPONDER ====================

#[tauri::command]
pub fn list_inbox_threads(db: State<Database>) -> Result<Vec<InboxThread>, String> {
    db.list_inbox_threads()
}

#[tauri::command]
pub async fn sync_imap_inbox(app: AppHandle, db: State<'_, Database>, sender_account_id: Option<String>) -> Result<usize, String> {
    let count = sync_imap_inbox_inner(&app, &db, sender_account_id.as_deref()).await?;
    Ok(count)
}

pub(crate) async fn sync_imap_inbox_inner(
    app: &AppHandle,
    db: &Database,
    sender_account_id: Option<&str>,
) -> Result<usize, String> {
    let accounts = db.list_sender_accounts()?;
    let target = match sender_account_id {
        Some(id) if !id.is_empty() => accounts.into_iter().find(|a| a.id == id),
        _ => accounts.into_iter().find(|a| a.imap_enabled),
    }
    .ok_or_else(|| "Nincs IMAP szinkronizálásra beállított postafiók a Beállításokban.".to_string())?;

    let account_clone = target.clone();
    let fetched = tokio::task::spawn_blocking(move || mailer::fetch_recent_imap_messages(&account_clone, 30))
        .await
        .map_err(|e| format!("IMAP háttérszál hiba: {}", e))??;

    let mut new_replies = 0usize;
    for mail in fetched {
        if db.message_id_exists(&mail.message_id) {
            continue;
        }
        if let Some(lead) = db.find_lead_by_email(&mail.from_email)? {
            process_inbound_reply(app, db, &lead, None, &mail.subject, &mail.body, Some(&mail.message_id), mail.in_reply_to.as_deref()).await?;
            new_replies += 1;
        }
    }
    Ok(new_replies)
}

#[tauri::command]
pub async fn simulate_inbound_reply(
    app: AppHandle,
    db: State<'_, Database>,
    lead_id: String,
    campaign_id: Option<String>,
    body: String,
) -> Result<InboxThread, String> {
    let lead = db.get_lead(&lead_id)?;
    let subject = format!("Re: {} — megkeresés", lead.company_name);
    process_inbound_reply(&app, &db, &lead, campaign_id.as_deref(), &subject, &body, None, None).await?;
    db.list_inbox_threads()?
        .into_iter()
        .find(|t| t.lead_id == lead_id)
        .ok_or_else(|| "Beszélgetés nem található".to_string())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn process_inbound_reply(
    app: &AppHandle,
    db: &Database,
    lead: &Lead,
    campaign_id_opt: Option<&str>,
    subject: &str,
    body: &str,
    msg_id: Option<&str>,
    in_reply_to: Option<&str>,
) -> Result<(), String> {
    let settings = db.get_settings()?;
    let campaign = match campaign_id_opt {
        Some(cid) => db.get_campaign(cid).ok(),
        None => db.list_campaigns()?.into_iter().next(),
    };
    let project = match &campaign {
        Some(c) => db.get_project(&c.project_id)?,
        None => db
            .list_projects()?
            .into_iter()
            .next()
            .ok_or_else(|| "Nincs aktív projekt az AI válaszelemzéshez".to_string())?,
    };
    let offer = match campaign.as_ref().and_then(|c| c.offer_id.as_ref()) {
        Some(oid) => db.get_offer(oid)?,
        None => project.offers.first().cloned(),
    };
    let thread_history = db.list_lead_messages(&lead.id).unwrap_or_default();

    let classification = ai::classify_and_draft_reply(&settings, &project, offer.as_ref(), lead, body, &thread_history).await;

    let now = Utc::now().to_rfc3339();
    db.insert_email_message_full(
        campaign.as_ref().map(|c| c.id.as_str()),
        &lead.id,
        "inbound",
        "received",
        1,
        subject,
        body,
        msg_id,
        in_reply_to,
        Some(&classification.intent),
        if classification.suggested_reply.is_empty() {
            None
        } else {
            Some(&classification.suggested_reply)
        },
        false,
        Some(&now),
        None,
        None,
        Some(&classification.summary),
        None,
    )?;

    // Update lead status & suppression list based on AI intent
    let new_status = match classification.intent.as_str() {
        "unsubscribe" => {
            db.add_suppression(&lead.primary_email, "Leiratkozás beérkező válasz alapján")?;
            "unsubscribed"
        }
        "not_interested" => "disqualified",
        "booking_request" => "booked",
        _ => "replied",
    };

    let _ = db.update_lead_fields(LeadUpdateInput {
        id: lead.id.clone(),
        status: Some(new_status.to_string()),
        ..Default::default()
    });

    db.log_activity(
        "reply",
        &format!("Beérkező válasz ({})", classification.intent),
        &format!("{} — {}", lead.company_name, classification.summary),
        Some(&lead.id),
    );

    // ALWAYS generate & schedule AI reply for questions / interested / booking_request / objection
    // within business hours (default Mon-Sat 08:00-18:00, random 20min-2h delay).
    // User can stop/pause, manually edit, or ask AI to rewrite with a note before send time!
    let should_auto_prepare = !classification.suggested_reply.trim().is_empty()
        && matches!(
            classification.intent.as_str(),
            "interested" | "booking_request" | "question" | "objection"
        );

    if should_auto_prepare {
        let campaign_allows_auto = campaign
            .as_ref()
            .map(|c| c.auto_reply_mode != "manual")
            .unwrap_or(true);
        let auto_schedule = settings.auto_reply_enabled && campaign_allows_auto;
        let scheduled_at = ai::compute_random_business_send_time(&settings);
        let reply_subject = if subject.to_lowercase().starts_with("re:") {
            subject.to_string()
        } else {
            format!("Re: {}", subject)
        };
        let booking_link_included = classification.should_include_booking_link
            || (!project.booking_url.is_empty() && classification.suggested_reply.contains(&project.booking_url));

        db.insert_email_message_full(
            campaign.as_ref().map(|c| c.id.as_str()),
            &lead.id,
            "outbound",
            if auto_schedule { "queued" } else { "draft" },
            2,
            &reply_subject,
            &classification.suggested_reply,
            None,
            msg_id,
            None,
            None,
            booking_link_included,
            None,
            if auto_schedule { Some(scheduled_at.as_str()) } else { None },
            Some(if auto_schedule { "scheduled" } else { "paused" }),
            Some(&classification.summary),
            None,
        )?;

        db.log_activity(
            "reply",
            if auto_schedule {
                "AI auto-válasz előkészítve és időzítve"
            } else {
                "AI választervezet elkészült (jóváhagyásra vár)"
            },
            &format!("{} — bármikor megállítható vagy átírható a Beérkező oldalon", lead.company_name),
            Some(&lead.id),
        );
    }

    let _ = app.emit("inbox-updated", ());
    Ok(())
}

/// Dispatches a single scheduled outbound message (live SMTP/SES or dry-run)
pub(crate) async fn execute_send_for_message(
    db: &Database,
    msg: &EmailMessage,
    dry_run: bool,
) -> Result<String, String> {
    if db.is_suppressed(&msg.lead_email) {
        let _ = db.update_email_schedule(
            &msg.id,
            "draft",
            Some("cancelled"),
            None,
            Some("Címzett tiltólistán szerepel — automatikus küldés leállítva"),
        );
        return Err("Címzett a tiltólistán szerepel.".to_string());
    }

    let campaign = msg.campaign_id.as_deref().and_then(|cid| db.get_campaign(cid).ok());
    let project = match &campaign {
        Some(c) => db.get_project(&c.project_id).ok(),
        None => db.list_projects()?.into_iter().next(),
    };
    let booking_sent = project
        .as_ref()
        .is_some_and(|p| !p.booking_url.is_empty() && msg.body.contains(&p.booking_url));

    let sent_msg_id = if dry_run {
        format!("<auto-sim-{}.mylead@local>", uuid::Uuid::new_v4())
    } else {
        let accounts = db.list_sender_accounts()?;
        let account = campaign
            .as_ref()
            .and_then(|c| c.sender_account_id.as_ref())
            .and_then(|aid| accounts.iter().find(|a| &a.id == aid))
            .or_else(|| accounts.iter().find(|a| a.is_default))
            .or_else(|| accounts.first())
            .ok_or_else(|| "Nincs beállított SMTP vagy Amazon SES fiók a küldéshez!".to_string())?;
        let id = mailer::send_email(
            account,
            &msg.lead_email,
            &msg.subject,
            &msg.body,
            msg.in_reply_to.as_deref(),
        )
        .await?;
        db.increment_sender_sent_today(&account.id);
        id
    };

    db.mark_email_sent(&msg.id, &sent_msg_id, booking_sent)?;

    if booking_sent {
        let _ = db.update_lead_fields(LeadUpdateInput {
            id: msg.lead_id.clone(),
            status: Some("booked".to_string()),
            ..Default::default()
        });
        db.log_activity("booking", "Időpontfoglaló link kiküldve", &msg.lead_company, Some(&msg.lead_id));
    } else {
        db.log_activity(
            "campaign",
            if dry_run { "Időzített válasz (szimulált) elküldve" } else { "Időzített AI válasz elküldve" },
            &msg.lead_company,
            Some(&msg.lead_id),
        );
    }

    Ok(sent_msg_id)
}

/// Called periodically by the background scheduler in lib.rs to fire due auto-replies!
pub(crate) async fn dispatch_due_scheduled_messages(app: &AppHandle) {
    let db = app.state::<Database>();
    let settings = match db.get_settings() {
        Ok(s) => s,
        Err(_) => return,
    };
    let due = match db.list_due_scheduled_messages() {
        Ok(list) => list,
        Err(_) => return,
    };
    if due.is_empty() {
        return;
    }

    let mut changed = false;
    for msg in due {
        let res = execute_send_for_message(&db, &msg, settings.auto_reply_default_dry_run).await;
        if let Err(err) = res {
            // Pause on missing account / SMTP error so user sees why and can fix & retry
            let _ = db.update_email_schedule(&msg.id, "draft", Some("paused"), None, Some(&err));
            db.log_activity("reply", "Auto-válasz küldése megállítva (hiba)", &format!("{}: {}", msg.lead_company, err), Some(&msg.lead_id));
        }
        changed = true;
    }

    if changed {
        let _ = app.emit("inbox-updated", ());
    }
}

#[tauri::command]
pub fn save_inbox_reply_draft(
    app: AppHandle,
    db: State<Database>,
    message_id: Option<String>,
    lead_id: String,
    campaign_id: Option<String>,
    subject: String,
    body: String,
    keep_scheduled: bool,
) -> Result<InboxThread, String> {
    let settings = db.get_settings()?;
    if let Some(mid) = message_id.filter(|s| !s.trim().is_empty()) {
        db.update_email_message_content(&mid, &subject, &body, None)?;
        if !keep_scheduled {
            db.update_email_schedule(&mid, "draft", Some("paused"), None, None)?;
        }
    } else {
        let scheduled_at = if keep_scheduled {
            Some(ai::compute_random_business_send_time(&settings))
        } else {
            None
        };
        db.insert_email_message_full(
            campaign_id.as_deref(),
            &lead_id,
            "outbound",
            if keep_scheduled { "queued" } else { "draft" },
            2,
            &subject,
            &body,
            None,
            None,
            None,
            None,
            false,
            None,
            scheduled_at.as_deref(),
            Some(if keep_scheduled { "scheduled" } else { "paused" }),
            None,
            None,
        )?;
    }

    let _ = app.emit("inbox-updated", ());
    db.list_inbox_threads()?
        .into_iter()
        .find(|t| t.lead_id == lead_id)
        .ok_or_else(|| "Beszélgetés nem található".to_string())
}

#[tauri::command]
pub async fn control_scheduled_reply(
    app: AppHandle,
    db: State<'_, Database>,
    message_id: String,
    action: String,
    custom_send_at: Option<String>,
    dry_run: Option<bool>,
) -> Result<InboxThread, String> {
    let msg = db.get_email_message(&message_id)?;
    let lead_id = msg.lead_id.clone();
    let settings = db.get_settings()?;

    match action.as_str() {
        "pause" | "stop" => {
            db.update_email_schedule(&message_id, "draft", Some("paused"), None, None)?;
            db.log_activity("reply", "Automatikus válasz megállítva", &msg.lead_company, Some(&lead_id));
        }
        "cancel" | "delete" => {
            db.delete_email_message(&message_id)?;
            db.log_activity("reply", "Időzített válasz törölve", &msg.lead_company, Some(&lead_id));
        }
        "resume" | "reschedule_random" => {
            let next_at = ai::compute_random_business_send_time(&settings);
            db.update_email_schedule(&message_id, "queued", Some("scheduled"), Some(&next_at), None)?;
            db.log_activity("reply", "AI válasz újra időzítve (munkaidőben)", &msg.lead_company, Some(&lead_id));
        }
        "reschedule_custom" => {
            let target_at = custom_send_at
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| "Adj meg egy érvényes időpontot!".to_string())?;
            db.update_email_schedule(&message_id, "queued", Some("scheduled"), Some(&target_at), None)?;
            db.log_activity("reply", "Válasz egyedi időpontra ütemezve", &msg.lead_company, Some(&lead_id));
        }
        "send_now" => {
            execute_send_for_message(&db, &msg, dry_run.unwrap_or(false)).await?;
        }
        _ => return Err(format!("Ismeretlen művelet: {}", action)),
    }

    let _ = app.emit("inbox-updated", ());
    db.list_inbox_threads()?
        .into_iter()
        .find(|t| t.lead_id == lead_id)
        .ok_or_else(|| "Beszélgetés nem található".to_string())
}

#[tauri::command]
pub async fn rewrite_inbox_reply_with_ai(
    app: AppHandle,
    db: State<'_, Database>,
    lead_id: String,
    message_id: Option<String>,
    current_subject: String,
    current_body: String,
    instruction: String,
) -> Result<ai::GeneratedEmail, String> {
    if instruction.trim().is_empty() {
        return Err("Írj megjegyzést vagy instrukciót az AI-nak az átíráshoz!".to_string());
    }
    let lead = db.get_lead(&lead_id)?;
    let settings = db.get_settings()?;
    let history = db.list_lead_messages(&lead_id).unwrap_or_default();
    let camp_id = message_id
        .as_deref()
        .and_then(|mid| db.get_email_message(mid).ok())
        .and_then(|m| m.campaign_id)
        .or_else(|| history.iter().rev().find_map(|m| m.campaign_id.clone()));
    let campaign = camp_id.as_deref().and_then(|cid| db.get_campaign(cid).ok());
    let project = match &campaign {
        Some(c) => db.get_project(&c.project_id).ok(),
        None => db.list_projects()?.into_iter().next(),
    };
    let offer = campaign
        .as_ref()
        .and_then(|c| c.offer_id.as_deref())
        .and_then(|oid| db.get_offer(oid).ok().flatten())
        .or_else(|| project.as_ref().and_then(|p| p.offers.first().cloned()));

    let rewritten = ai::rewrite_email_with_instruction(
        &settings,
        project.as_ref(),
        offer.as_ref(),
        &lead,
        &history,
        &current_subject,
        &current_body,
        instruction.trim(),
    )
    .await?;

    if let Some(mid) = message_id.filter(|s| !s.trim().is_empty()) {
        let _ = db.update_email_message_content(&mid, &rewritten.subject, &rewritten.body, Some(instruction.trim()));
        let _ = app.emit("inbox-updated", ());
    }
    Ok(rewritten)
}

#[tauri::command]
pub async fn generate_inbox_reply_with_ai(
    app: AppHandle,
    db: State<'_, Database>,
    lead_id: String,
    campaign_id: Option<String>,
) -> Result<InboxThread, String> {
    let lead = db.get_lead(&lead_id)?;
    let settings = db.get_settings()?;
    let history = db.list_lead_messages(&lead_id).unwrap_or_default();
    let last_inbound = history.iter().rev().find(|m| m.direction == "inbound");

    let camp = campaign_id
        .as_deref()
        .or_else(|| history.iter().rev().find_map(|m| m.campaign_id.as_deref()))
        .and_then(|cid| db.get_campaign(cid).ok());
    let project = match &camp {
        Some(c) => db.get_project(&c.project_id)?,
        None => db
            .list_projects()?
            .into_iter()
            .next()
            .ok_or_else(|| "Nincs aktív projekt az AI válasz generálásához!".to_string())?,
    };
    let offer = camp
        .as_ref()
        .and_then(|c| c.offer_id.as_deref())
        .and_then(|oid| db.get_offer(oid).ok().flatten())
        .or_else(|| project.offers.first().cloned());

    let inbound_text = last_inbound
        .map(|m| m.body.as_str())
        .unwrap_or("Kérem küldjenek bővebb tájékoztatást a megoldásról és a következő lépésekről.");
    let base_subj = last_inbound
        .map(|m| m.subject.as_str())
        .or_else(|| history.last().map(|m| m.subject.as_str()))
        .unwrap_or("Megkeresés");
    let reply_subject = if base_subj.to_lowercase().starts_with("re:") {
        base_subj.to_string()
    } else {
        format!("Re: {}", base_subj)
    };

    let classification = ai::classify_and_draft_reply(&settings, &project, offer.as_ref(), &lead, inbound_text, &history).await;
    let body = if classification.suggested_reply.trim().is_empty() {
        format!(
            "Köszönöm a megkeresést!\n\nSzívesen egyeztetünk a(z) {} kapcsán. {}\n\n{}",
            lead.company_name,
            if !project.booking_url.is_empty() {
                format!("Itt tud közvetlenül időpontot választani: {}", project.booking_url)
            } else {
                String::new()
            },
            settings.company_signature
        )
    } else {
        classification.suggested_reply
    };

    // If an existing pending/paused outbound reply exists, update it; otherwise insert new scheduled reply
    let existing_pending = history.iter().rev().find(|m| {
        m.direction == "outbound" && (m.status == "queued" || (m.status == "draft" && (m.step_number >= 2 || m.auto_send_status.is_some())))
    });
    let scheduled_at = ai::compute_random_business_send_time(&settings);
    if let Some(pend) = existing_pending {
        db.update_email_message_content(&pend.id, &reply_subject, &body, None)?;
        if settings.auto_reply_enabled {
            db.update_email_schedule(&pend.id, "queued", Some("scheduled"), Some(&scheduled_at), None)?;
        }
    } else {
        db.insert_email_message_full(
            camp.as_ref().map(|c| c.id.as_str()),
            &lead_id,
            "outbound",
            if settings.auto_reply_enabled { "queued" } else { "draft" },
            2,
            &reply_subject,
            &body,
            None,
            last_inbound.and_then(|m| m.message_id_header.as_deref()),
            None,
            None,
            classification.should_include_booking_link,
            None,
            if settings.auto_reply_enabled { Some(scheduled_at.as_str()) } else { None },
            Some(if settings.auto_reply_enabled { "scheduled" } else { "paused" }),
            Some(&classification.summary),
            None,
        )?;
    }

    let _ = app.emit("inbox-updated", ());
    db.list_inbox_threads()?
        .into_iter()
        .find(|t| t.lead_id == lead_id)
        .ok_or_else(|| "Beszélgetés nem található".to_string())
}

#[tauri::command]
pub async fn send_inbox_reply(
    app: AppHandle,
    db: State<'_, Database>,
    lead_id: String,
    campaign_id: Option<String>,
    subject: String,
    body: String,
    dry_run: bool,
    pending_message_id: Option<String>,
) -> Result<InboxThread, String> {
    if let Some(pid) = pending_message_id.filter(|s| !s.trim().is_empty()) {
        db.update_email_message_content(&pid, &subject, &body, None)?;
        let msg = db.get_email_message(&pid)?;
        execute_send_for_message(&db, &msg, dry_run).await?;
        let _ = app.emit("inbox-updated", ());
        return db
            .list_inbox_threads()?
            .into_iter()
            .find(|t| t.lead_id == lead_id)
            .ok_or_else(|| "Beszélgetés nem található".to_string());
    }

    let lead = db.get_lead(&lead_id)?;
    let campaign = match &campaign_id {
        Some(cid) => db.get_campaign(cid).ok(),
        None => db.list_campaigns()?.into_iter().next(),
    };
    let project = match &campaign {
        Some(c) => db.get_project(&c.project_id).ok(),
        None => db.list_projects()?.into_iter().next(),
    };

    let booking_sent = project
        .as_ref()
        .is_some_and(|p| !p.booking_url.is_empty() && body.contains(&p.booking_url));

    let msg_id = if dry_run {
        format!("<reply-sim-{}.mylead@local>", uuid::Uuid::new_v4())
    } else {
        let accounts = db.list_sender_accounts()?;
        let account = campaign
            .as_ref()
            .and_then(|c| c.sender_account_id.as_ref())
            .and_then(|aid| accounts.iter().find(|a| &a.id == aid))
            .or_else(|| accounts.iter().find(|a| a.is_default))
            .or_else(|| accounts.first())
            .ok_or_else(|| "Nincs beállított SMTP vagy Amazon SES fiók a küldéshez!".to_string())?;
        let id = mailer::send_email(account, &lead.primary_email, &subject, &body, None).await?;
        db.increment_sender_sent_today(&account.id);
        id
    };

    db.insert_email_message(
        campaign.as_ref().map(|c| c.id.as_str()),
        &lead.id,
        "outbound",
        "sent",
        2,
        &subject,
        &body,
        Some(&msg_id),
        None,
        None,
        None,
        booking_sent,
        Some(&Utc::now().to_rfc3339()),
    )?;

    if booking_sent {
        let _ = db.update_lead_fields(LeadUpdateInput {
            id: lead.id.clone(),
            status: Some("booked".to_string()),
            ..Default::default()
        });
        db.log_activity("booking", "Időpontfoglaló link kiküldve", &lead.company_name, Some(&lead.id));
    }

    let _ = app.emit("inbox-updated", ());
    db.list_inbox_threads()?
        .into_iter()
        .find(|t| t.lead_id == lead_id)
        .ok_or_else(|| "Beszélgetés nem található".to_string())
}

// ==================== SENDER ACCOUNTS, SETTINGS, ANALYTICS ====================

#[tauri::command]
pub fn list_sender_accounts(db: State<Database>) -> Result<Vec<SenderAccount>, String> {
    db.list_sender_accounts()
}

#[tauri::command]
pub fn save_sender_account(db: State<Database>, input: SenderAccountInput) -> Result<SenderAccount, String> {
    db.save_sender_account(input)
}

#[tauri::command]
pub fn delete_sender_account(db: State<Database>, id: String) -> Result<(), String> {
    db.delete_sender_account(&id)
}

#[tauri::command]
pub async fn send_test_email(
    db: State<'_, Database>,
    sender_account_id: String,
    to_email: String,
) -> Result<String, String> {
    let account = db.get_sender_account(&sender_account_id)?;
    let msg_id = mailer::send_email(
        &account,
        &to_email,
        "MyLead teszt e-mail — küldő fiók ellenőrzés",
        "Ez egy automatikus teszt levél a MyLead alkalmazásból. Az SMTP / Amazon SES kapcsolat megfelelően működik!",
        None,
    )
    .await?;
    Ok(format!("Teszt e-mail sikeresen elküldve! Message-ID: {}", msg_id))
}

#[tauri::command]
pub fn get_settings(db: State<Database>) -> Result<AppSettings, String> {
    db.get_settings()
}

#[tauri::command]
pub fn save_settings(db: State<Database>, settings: AppSettings) -> Result<AppSettings, String> {
    db.save_settings(&settings)
}

#[tauri::command]
pub async fn test_ai_settings(settings: AppSettings) -> Result<String, String> {
    ai::test_ai_connection(&settings).await
}

#[tauri::command]
pub async fn detect_local_ai_clis() -> Result<Vec<LocalCliStatus>, String> {
    Ok(ai::detect_local_clis().await)
}

#[tauri::command]
pub async fn fetch_ai_models(settings: AppSettings) -> Result<Vec<AiModelOption>, String> {
    ai::fetch_provider_models(&settings).await
}

#[tauri::command]
pub async fn detect_discovery_tools(db: State<'_, Database>) -> Result<Vec<DiscoveryToolStatus>, String> {
    let settings = db.get_settings()?;
    Ok(discovery::detect_discovery_tools(&settings).await)
}

#[tauri::command]
pub async fn install_gmaps_scraper() -> Result<String, String> {
    discovery::install_gmaps_scraper().await
}

#[tauri::command]
pub fn list_suppressions(db: State<Database>) -> Result<Vec<SuppressionEntry>, String> {
    db.list_suppressions()
}

#[tauri::command]
pub fn add_suppression(db: State<Database>, email: String, reason: String) -> Result<(), String> {
    db.add_suppression(&email, &reason)
}

#[tauri::command]
pub fn remove_suppression(db: State<Database>, email: String) -> Result<(), String> {
    db.remove_suppression(&email)
}

#[tauri::command]
pub fn get_analytics(db: State<Database>) -> Result<AnalyticsOverview, String> {
    db.get_analytics()
}

#[tauri::command]
pub fn load_demo_data(db: State<Database>) -> Result<(), String> {
    seed::seed_demo_workspace(&db)
}

#[tauri::command]
pub fn clear_workspace_data(db: State<Database>) -> Result<(), String> {
    db.clear_all_data()
}
