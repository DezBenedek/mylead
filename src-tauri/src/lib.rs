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
            commands::enrich_leads,
            commands::list_campaigns,
            commands::list_campaign_messages,
            commands::create_campaign_with_drafts,
            commands::update_email_draft,
            commands::delete_campaign,
            commands::send_campaign_drafts,
            commands::list_inbox_threads,
            commands::sync_imap_inbox,
            commands::simulate_inbound_reply,
            commands::send_inbox_reply,
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
