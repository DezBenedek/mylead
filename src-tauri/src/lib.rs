mod ai;
mod assistant;
mod commands;
mod crawler;
mod db;
mod discovery;
mod mailer;
mod models;
mod seed;

use db::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("Nem sikerült meghatározni az app_data_dir útvonalat");
            let db_path = data_dir.join("mylead.sqlite");
            let database = Database::open(&db_path).expect("SQLite adatbázis inicializálási hiba");
            app.manage(database);
            app.manage(assistant::SearchControlRegistry::default());

            // Background Auto-Reply Scheduler (checks every 25s) & Periodic IMAP Poller
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut tick_count: u64 = 0;
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(25)).await;
                    tick_count += 1;
                    commands::dispatch_due_scheduled_messages(&app_handle).await;

                    // Periodic IMAP polling based on settings.imap_poll_minutes
                    let poll_mins = {
                        let db = app_handle.state::<Database>();
                        db.get_settings().map(|s| s.imap_poll_minutes).unwrap_or(0)
                    };
                    if poll_mins > 0 {
                        let ticks_needed = ((poll_mins * 60) / 25).max(2) as u64;
                        if tick_count % ticks_needed == 0 {
                            let db = app_handle.state::<Database>();
                            let has_imap = db
                                .list_sender_accounts()
                                .map(|list| list.iter().any(|a| a.imap_enabled))
                                .unwrap_or(false);
                            if has_imap {
                                let _ = commands::sync_imap_inbox_inner(&app_handle, &db, None).await;
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::save_project,
            commands::delete_project,
            commands::save_offer,
            commands::delete_offer,
            commands::crawl_and_analyze_project,
            commands::list_searches,
            commands::save_search,
            commands::delete_search,
            commands::run_search_job,
            commands::start_search_job,
            commands::stop_search_job,
            commands::list_running_searches,
            commands::optimize_search_with_ai,
            commands::run_assistant_command,
            commands::import_csv_and_evaluate,
            commands::import_manual_leads,
            commands::list_leads,
            commands::get_lead,
            commands::update_lead,
            commands::delete_leads,
            commands::bulk_update_lead_status,
            commands::create_manual_lead,
            commands::enrich_leads,
            commands::list_campaigns,
            commands::list_campaign_messages,
            commands::create_campaign_with_drafts,
            commands::update_campaign,
            commands::add_leads_to_campaign,
            commands::update_email_draft,
            commands::regenerate_email_draft,
            commands::delete_campaign,
            commands::send_campaign_drafts,
            commands::generate_direct_email_draft,
            commands::send_direct_email,
            commands::list_inbox_threads,
            commands::sync_imap_inbox,
            commands::simulate_inbound_reply,
            commands::send_inbox_reply,
            commands::save_inbox_reply_draft,
            commands::control_scheduled_reply,
            commands::rewrite_inbox_reply_with_ai,
            commands::generate_inbox_reply_with_ai,
            commands::list_sender_accounts,
            commands::save_sender_account,
            commands::delete_sender_account,
            commands::send_test_email,
            commands::get_settings,
            commands::save_settings,
            commands::test_ai_settings,
            commands::detect_local_ai_clis,
            commands::fetch_ai_models,
            commands::detect_discovery_tools,
            commands::install_gmaps_scraper,
            commands::list_suppressions,
            commands::add_suppression,
            commands::remove_suppression,
            commands::get_analytics,
            commands::load_demo_data,
            commands::clear_workspace_data,
        ])
        .run(tauri::generate_context!())
        .expect("Hiba a MyLead alkalmazás indításakor");
}
