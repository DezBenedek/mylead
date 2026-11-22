use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub website_url: String,
    pub industry: String,
    pub language: String,
    pub description: String,
    pub booking_url: String,
    pub landing_url: String,
    #[serde(default)]
    pub email_signature: String,
    pub value_proposition: String,
    pub target_audience: String,
    pub pain_points_solved: Vec<String>,
    pub pitch_angles: Vec<String>,
    pub objection_handlers: Vec<String>,
    pub crawled_summary: String,
    pub crawled_pages_count: i64,
    pub last_crawled_at: Option<String>,
    pub offers: Vec<Offer>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub id: Option<String>,
    pub name: String,
    pub website_url: String,
    pub industry: String,
    pub language: String,
    pub description: String,
    pub booking_url: String,
    pub landing_url: String,
    #[serde(default)]
    pub email_signature: Option<String>,
    pub value_proposition: Option<String>,
    pub target_audience: Option<String>,
    pub pain_points_solved: Option<Vec<String>>,
    pub pitch_angles: Option<Vec<String>>,
    pub objection_handlers: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub offer_type: String, // discount | free_trial | audit | bundle | custom
    pub discount_value: String,
    pub description: String,
    pub cta_text: String,
    pub conditions: String,
    pub active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferInput {
    pub id: Option<String>,
    pub project_id: String,
    pub title: String,
    pub offer_type: String,
    pub discount_value: String,
    pub description: String,
    pub cta_text: String,
    pub conditions: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchJob {
    pub id: String,
    pub project_id: String,
    pub project_name: String,
    pub offer_id: Option<String>,
    pub offer_title: Option<String>,
    pub name: String,
    pub query: String,
    pub industry: String,
    pub location: String,
    pub company_size: String, // any | 1-10 | 11-50 | 51-200 | 200+
    pub target_problem: String,
    pub source: String, // osm | google_places | serper | manual
    pub max_results: i64,
    pub auto_audit: bool,
    pub auto_enrich_threshold: i64,
    pub status: String, // draft | running | completed | failed
    pub leads_found: i64,
    pub promising_count: i64,
    pub last_error: Option<String>,
    pub last_run_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchJobInput {
    pub id: Option<String>,
    pub project_id: String,
    pub offer_id: Option<String>,
    pub name: String,
    pub query: String,
    pub industry: String,
    pub location: String,
    pub company_size: String,
    pub target_problem: String,
    pub source: String,
    pub max_results: i64,
    pub auto_audit: bool,
    pub auto_enrich_threshold: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeadProvenance {
    pub search_id: String,
    pub search_name: String,
    pub found_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeadContact {
    pub name: String,
    pub role: String,
    pub email: String,
    pub phone: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebsiteAudit {
    pub reachable: bool,
    pub status_code: Option<u16>,
    pub has_https: bool,
    pub load_time_ms: i64,
    pub has_mobile_viewport: bool,
    pub title: String,
    pub meta_description: String,
    pub has_analytics: bool,
    pub has_chat_widget: bool,
    pub has_booking_system: bool,
    pub has_contact_form: bool,
    pub tech_stack: Vec<String>,
    pub detected_issues: Vec<String>,
    pub extracted_emails: Vec<String>,
    pub extracted_phones: Vec<String>,
    pub social_links: Vec<String>,
    pub pages_crawled: i64,
    pub audited_at: String,
    // Deep audit v2 metrics (serde(default) for backwards compatibility with existing DB rows)
    #[serde(default)]
    pub overall_score: i64,
    #[serde(default)]
    pub score_seo: i64,
    #[serde(default)]
    pub score_ux_mobile: i64,
    #[serde(default)]
    pub score_conversion: i64,
    #[serde(default)]
    pub score_trust: i64,
    #[serde(default)]
    pub html_size_kb: i64,
    #[serde(default)]
    pub h1_count: i64,
    #[serde(default)]
    pub h1_text: String,
    #[serde(default)]
    pub image_count: i64,
    #[serde(default)]
    pub images_missing_alt: i64,
    #[serde(default)]
    pub has_og_tags: bool,
    #[serde(default)]
    pub has_canonical: bool,
    #[serde(default)]
    pub has_structured_data: bool,
    #[serde(default)]
    pub has_pricing_signals: bool,
    #[serde(default)]
    pub has_testimonials: bool,
    #[serde(default)]
    pub has_gdpr_privacy: bool,
    #[serde(default)]
    pub has_multilingual: bool,
    #[serde(default)]
    pub has_cta_signals: bool,
    #[serde(default)]
    pub copyright_year: Option<i64>,
    #[serde(default)]
    pub strengths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lead {
    pub id: String,
    pub company_name: String,
    pub domain: String,
    pub website_url: String,
    pub industry: String,
    pub location: String,
    pub address: String,
    pub phone: String,
    pub primary_email: String,
    pub employee_estimate: String,
    pub google_rating: Option<f64>,
    pub google_reviews: Option<i64>,
    pub source: String,
    pub status: String, // new | promising | enriched | in_campaign | replied | booked | won | disqualified | unsubscribed
    pub fit_score: i64,
    pub enriched: bool,
    pub company_summary: String,
    pub pain_points: Vec<String>,
    pub how_we_can_help: String,
    pub recommended_pitch: String,
    pub tech_stack: Vec<String>,
    pub contacts: Vec<LeadContact>,
    pub audit: Option<WebsiteAudit>,
    pub tags: Vec<String>,
    pub notes: String,
    pub searches: Vec<LeadProvenance>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeadUpdateInput {
    pub id: String,
    #[serde(default)]
    pub company_name: Option<String>,
    #[serde(default)]
    pub website_url: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    pub status: Option<String>,
    pub primary_email: Option<String>,
    pub employee_estimate: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SenderAccount {
    pub id: String,
    pub name: String,
    pub provider: String, // smtp | ses
    pub from_name: String,
    pub from_email: String,
    pub reply_to: String,
    pub smtp_host: String,
    pub smtp_port: i64,
    pub smtp_username: String,
    pub smtp_password: String,
    pub smtp_security: String, // starttls | tls | none
    pub ses_region: String,
    pub ses_access_key: String,
    pub ses_secret_key: String,
    pub daily_limit: i64,
    pub sent_today: i64,
    pub imap_host: String,
    pub imap_port: i64,
    pub imap_username: String,
    pub imap_password: String,
    pub imap_enabled: bool,
    pub is_default: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SenderAccountInput {
    pub id: Option<String>,
    pub name: String,
    pub provider: String,
    pub from_name: String,
    pub from_email: String,
    pub reply_to: String,
    pub smtp_host: String,
    pub smtp_port: i64,
    pub smtp_username: String,
    pub smtp_password: String,
    pub smtp_security: String,
    pub ses_region: String,
    pub ses_access_key: String,
    pub ses_secret_key: String,
    pub daily_limit: i64,
    pub imap_host: String,
    pub imap_port: i64,
    pub imap_username: String,
    pub imap_password: String,
    pub imap_enabled: bool,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Campaign {
    pub id: String,
    pub name: String,
    pub project_id: String,
    pub project_name: String,
    pub offer_id: Option<String>,
    pub offer_title: Option<String>,
    pub search_id: Option<String>,
    pub search_name: Option<String>,
    pub sender_account_id: Option<String>,
    pub sender_name: Option<String>,
    pub status: String, // draft | active | paused | completed
    pub tone: String,   // professional_formal | friendly_direct | concise_executive
    pub language: String,
    pub auto_reply_mode: String, // manual | draft | autopilot
    pub daily_limit: i64,
    pub min_delay_sec: i64,
    pub follow_up_days: i64,
    pub include_booking_link: bool,
    pub custom_instructions: String,
    #[serde(default)]
    pub offer_summary: String,
    #[serde(default = "default_offer_timing")]
    pub offer_timing: String, // first_email | on_interest | on_objection | custom
    #[serde(default)]
    pub offer_delivery: String,
    pub total_recipients: i64,
    pub sent_count: i64,
    pub failed_count: i64,
    pub reply_count: i64,
    pub positive_count: i64,
    pub booked_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignInput {
    pub id: Option<String>,
    pub name: String,
    pub project_id: String,
    pub offer_id: Option<String>,
    pub search_id: Option<String>,
    pub sender_account_id: Option<String>,
    pub tone: String,
    pub language: String,
    pub auto_reply_mode: String,
    pub daily_limit: i64,
    pub min_delay_sec: i64,
    pub follow_up_days: i64,
    pub include_booking_link: bool,
    pub custom_instructions: String,
    #[serde(default)]
    pub offer_summary: String,
    #[serde(default = "default_offer_timing")]
    pub offer_timing: String,
    #[serde(default)]
    pub offer_delivery: String,
    pub lead_ids: Vec<String>,
}

fn default_offer_timing() -> String {
    "on_interest".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailMessage {
    pub id: String,
    pub campaign_id: Option<String>,
    pub campaign_name: Option<String>,
    pub lead_id: String,
    pub lead_company: String,
    pub lead_email: String,
    pub direction: String, // outbound | inbound
    pub status: String,    // draft | queued | sent | failed | received
    pub step_number: i64,
    pub subject: String,
    pub body: String,
    pub message_id_header: Option<String>,
    pub in_reply_to: Option<String>,
    pub ai_intent: Option<String>, // interested | booking_request | question | objection | not_interested | out_of_office | unsubscribe
    pub ai_suggested_reply: Option<String>,
    pub booking_link_sent: bool,
    pub error_message: Option<String>,
    pub sent_at: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub scheduled_send_at: Option<String>,
    #[serde(default)]
    pub auto_send_status: Option<String>, // scheduled | paused | cancelled | sent | failed
    #[serde(default)]
    pub ai_summary: Option<String>,
    #[serde(default)]
    pub ai_rewrite_note: Option<String>,
    #[serde(default)]
    pub ai_priority_score: i64,
    #[serde(default)]
    pub ai_tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxThread {
    pub lead_id: String,
    pub lead_company: String,
    pub lead_email: String,
    pub lead_status: String,
    pub fit_score: i64,
    pub campaign_id: Option<String>,
    pub campaign_name: Option<String>,
    #[serde(default)]
    pub offer_title: Option<String>,
    pub last_message_at: String,
    pub last_direction: String,
    pub latest_intent: Option<String>,
    #[serde(default)]
    pub priority_score: i64,
    #[serde(default)]
    pub ai_tags: Vec<String>,
    #[serde(default)]
    pub decision_summary: Option<String>,
    pub has_pending_draft: bool,
    #[serde(default)]
    pub pending_reply_id: Option<String>,
    #[serde(default)]
    pub scheduled_send_at: Option<String>,
    #[serde(default)]
    pub auto_send_status: Option<String>,
    pub booking_link_sent: bool,
    pub message_count: i64,
    pub messages: Vec<EmailMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectEmailInput {
    pub lead_id: String,
    pub sender_account_id: Option<String>,
    pub offer_id: Option<String>,
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default = "default_schedule_mode")]
    pub schedule_mode: String, // now | auto_random | custom
    pub scheduled_send_at: Option<String>,
}

fn default_schedule_mode() -> String {
    "now".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateLeadInput {
    pub company_name: String,
    #[serde(default)]
    pub website_url: String,
    #[serde(default)]
    pub industry: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub primary_email: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub run_audit: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignUpdateInput {
    pub id: String,
    pub name: Option<String>,
    pub project_id: Option<String>,
    pub offer_id: Option<String>,
    pub sender_account_id: Option<String>,
    pub status: Option<String>,
    pub tone: Option<String>,
    pub auto_reply_mode: Option<String>,
    pub daily_limit: Option<i64>,
    pub include_booking_link: Option<bool>,
    pub custom_instructions: Option<String>,
    pub offer_summary: Option<String>,
    pub offer_timing: Option<String>,
    pub offer_delivery: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub ai_provider: String, // openrouter | opencode_go | claude_cli | codex_cli | opencode_cli | openai | anthropic | gemini | ollama | local_heuristic
    pub ai_api_key: String,
    pub ai_model: String,
    pub ai_base_url: String,
    #[serde(default)]
    pub ai_cli_path: String,
    pub google_places_api_key: String,
    pub serper_api_key: String,
    #[serde(default)]
    pub searxng_url: String,
    #[serde(default)]
    pub gmaps_scraper_path: String,
    #[serde(default = "default_cli_search_engine")]
    pub cli_search_engine: String, // auto | opencode | claude | codex
    pub default_language: String,
    pub company_signature: String,
    #[serde(default)]
    pub signature_fine_print: String,
    pub imap_poll_minutes: i64,
    // Auto-reply scheduling & customization
    #[serde(default = "default_true")]
    pub auto_reply_enabled: bool,
    #[serde(default = "default_workdays")]
    pub auto_reply_workdays: Vec<u8>, // 1=Mon .. 7=Sun (default Mon-Sat: 1..=6)
    #[serde(default = "default_start_hour")]
    pub auto_reply_start_hour: u8, // default 8 (08:00)
    #[serde(default = "default_end_hour")]
    pub auto_reply_end_hour: u8, // default 18 (18:00)
    #[serde(default = "default_min_delay_min")]
    pub auto_reply_min_delay_min: i64, // default 20 minutes
    #[serde(default = "default_max_delay_min")]
    pub auto_reply_max_delay_min: i64, // default 120 minutes (2 hours)
    #[serde(default)]
    pub auto_reply_default_dry_run: bool,
    #[serde(default = "default_ai_analysis_focus")]
    pub ai_analysis_focus: String,
    #[serde(default)]
    pub ai_reply_instructions: String,
    #[serde(default = "default_tone")]
    pub default_tone: String,
    #[serde(default = "default_daily_limit")]
    pub default_daily_limit: i64,
    // OpenRouter Inbound Decision / Triage Model settings
    #[serde(default = "default_decision_provider")]
    pub decision_model_provider: String, // openrouter | inherit
    #[serde(default = "default_decision_api")]
    pub decision_model_api: String, // decisions (OpenRouter Decisions API) | chat (legacy structured outputs)
    #[serde(default)]
    pub decision_model_api_key: String, // OpenRouter API key (falls back to ai_api_key when provider is openrouter)
    #[serde(default = "default_decision_model_id")]
    pub decision_model_id: String, // Decisions model slug, e.g. typesafe/jev-1.14, cloudflare/clef-flash
    #[serde(default = "default_true")]
    pub decision_auto_sort_inbox: bool,
}

fn default_decision_provider() -> String {
    "openrouter".to_string()
}
fn default_decision_api() -> String {
    "decisions".to_string()
}
fn default_decision_model_id() -> String {
    "typesafe/jev-1.14".to_string()
}

fn default_cli_search_engine() -> String {
    "auto".to_string()
}
fn default_true() -> bool {
    true
}
fn default_workdays() -> Vec<u8> {
    vec![1, 2, 3, 4, 5, 6]
}
fn default_start_hour() -> u8 {
    8
}
fn default_end_hour() -> u8 {
    18
}
fn default_min_delay_min() -> i64 {
    20
}
fn default_max_delay_min() -> i64 {
    120
}
fn default_ai_analysis_focus() -> String {
    "Fókuszálj konkrétan arra, hogy egy okosűrlap (intelligens, többlépcsős ajánlatkérő / előszűrő / kalkulátor / időpontfoglaló űrlap) mit tehet ennek a cégnek a saját szolgáltatásai alapján: milyen kérdéseket válthat ki, hogyan gyorsítja az ajánlatadást/időpontfoglalást, és milyen nagyságrendű konverzió- vagy időnyereséget hozhat.".to_string()
}
fn default_tone() -> String {
    "professional_formal".to_string()
}
fn default_daily_limit() -> i64 {
    35
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            ai_provider: "openrouter".to_string(),
            ai_api_key: String::new(),
            ai_model: "openai/gpt-4o-mini".to_string(),
            ai_base_url: String::new(),
            ai_cli_path: String::new(),
            google_places_api_key: String::new(),
            serper_api_key: String::new(),
            searxng_url: String::new(),
            gmaps_scraper_path: String::new(),
            cli_search_engine: "auto".to_string(),
            default_language: "hu".to_string(),
            company_signature: "Üdvözlettel,\nMyLead Csapat".to_string(),
            signature_fine_print: String::new(),
            imap_poll_minutes: 1,
            auto_reply_enabled: default_true(),
            auto_reply_workdays: default_workdays(),
            auto_reply_start_hour: default_start_hour(),
            auto_reply_end_hour: default_end_hour(),
            auto_reply_min_delay_min: default_min_delay_min(),
            auto_reply_max_delay_min: default_max_delay_min(),
            auto_reply_default_dry_run: false,
            ai_analysis_focus: default_ai_analysis_focus(),
            ai_reply_instructions: String::new(),
            default_tone: default_tone(),
            default_daily_limit: default_daily_limit(),
            decision_model_provider: default_decision_provider(),
            decision_model_api: default_decision_api(),
            decision_model_api_key: String::new(),
            decision_model_id: default_decision_model_id(),
            decision_auto_sort_inbox: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryToolStatus {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub detail: String,
    pub installable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCliStatus {
    pub id: String,       // claude_cli | codex_cli | opencode_cli | ollama
    pub name: String,
    pub binary: String,
    pub installed: bool,
    pub path: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelOption {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuppressionEntry {
    pub email: String,
    pub reason: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub lead_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FunnelStep {
    pub label: String,
    pub count: i64,
    pub rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyMetric {
    pub date: String,
    pub sent: i64,
    pub replies: i64,
    pub positive: i64,
    pub booked: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStat {
    pub search_id: String,
    pub search_name: String,
    pub leads_count: i64,
    pub avg_fit_score: f64,
    pub enriched_count: i64,
    pub replied_count: i64,
    pub booked_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsOverview {
    pub total_projects: i64,
    pub total_searches: i64,
    pub total_leads: i64,
    pub promising_leads: i64,
    pub enriched_leads: i64,
    pub leads_with_email: i64,
    pub avg_fit_score: f64,
    pub total_sent: i64,
    pub total_failed: i64,
    pub total_replies: i64,
    pub positive_replies: i64,
    pub booking_links_sent: i64,
    pub booked_leads: i64,
    pub unsubscribed_count: i64,
    pub delivery_rate: f64,
    pub reply_rate: f64,
    pub positive_rate: f64,
    pub booking_rate: f64,
    pub funnel: Vec<FunnelStep>,
    pub daily_metrics: Vec<DailyMetric>,
    pub search_stats: Vec<SearchStat>,
    pub recent_activity: Vec<ActivityItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgressEvent {
    pub job_type: String,
    pub job_id: String,
    pub current: usize,
    pub total: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLiveEvent {
    pub search_id: String,
    pub phase: String, // starting | discovering | merging | batch_start | auditing | deep_enriching | lead_done | stopped | completed | failed
    pub lead_id: Option<String>,
    pub company_name: Option<String>,
    pub domain: Option<String>,
    pub fit_score: Option<i64>,
    pub status: Option<String>,
    pub message: String,
    pub current: usize,
    pub total: usize,
    #[serde(default)]
    pub round: usize,
    #[serde(default)]
    pub batch: usize,
    #[serde(default)]
    pub continuous: bool,
    #[serde(default)]
    pub current_url: Option<String>,
    #[serde(default)]
    pub pages_crawled: Option<usize>,
    #[serde(default)]
    pub pages_total: Option<usize>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportResult {
    pub search_id: String,
    pub search_name: String,
    pub imported_count: usize,
    pub skipped_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantStatusEvent {
    pub stage: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptimizationResult {
    pub name: String,
    pub query: String,
    pub industry: String,
    pub location: String,
    pub company_size: String,
    pub target_problem: String,
    pub source: String,
    pub max_results: i64,
    pub auto_enrich_threshold: i64,
    pub offer_id: Option<String>,
    pub reasoning: String,
    #[serde(default)]
    pub ai_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantChatMessage {
    pub role: String, // user | assistant
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantActionLog {
    pub tool: String,
    pub summary: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantResponse {
    pub reply: String,
    pub actions: Vec<AssistantActionLog>,
    pub navigate_to: Option<String>,
    pub open_search_id: Option<String>,
    pub data_changed: bool,
    #[serde(default)]
    pub ai_error: Option<String>,
}
