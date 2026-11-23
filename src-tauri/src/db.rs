use crate::crawler::extract_domain;
use crate::models::*;
use chrono::{Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use uuid::Uuid;

pub struct Database {
    pub conn: Mutex<Connection>,
}

/// Strips mail client reply/forward prefixes so that "Re: Foo" and "Foo"
/// belong to the same subject-based conversation.
pub(crate) fn normalize_subject_root(subject: &str) -> String {
    let mut current = subject.trim().to_lowercase();
    loop {
        let trimmed = current.trim_start();
        let mut stripped = false;
        for prefix in ["re:", "fw:", "fwd:", "aw:", "sv:", "válasz:"] {
            if let Some(rest) = trimmed.strip_prefix(prefix) {
                current = rest.trim_start().to_string();
                stripped = true;
                break;
            }
        }
        if !stripped {
            break;
        }
    }
    let cleaned = current.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        "nincs tárgy".to_string()
    } else {
        cleaned
    }
}

fn normalize_message_id(id: &str) -> String {
    id.trim()
        .trim_start_matches('<')
        .trim_end_matches('>')
        .trim()
        .to_lowercase()
}

/// A conversation is either scoped to a campaign (outreach thread) or, for
/// direct e-mails without a campaign, to the normalized subject.
fn conversation_base_key(msg: &EmailMessage) -> String {
    match msg.campaign_id.as_deref().filter(|c| !c.trim().is_empty()) {
        Some(campaign_id) => format!("{}|campaign:{}", msg.lead_id, campaign_id),
        None => format!(
            "{}|direct:{}",
            msg.lead_id,
            normalize_subject_root(&msg.subject)
        ),
    }
}

fn find_conversation_root(parents: &mut HashMap<String, String>, key: &str) -> String {
    let mut root = key.to_string();
    loop {
        let next = parents
            .get(&root)
            .cloned()
            .unwrap_or_else(|| root.clone());
        if next == root {
            break;
        }
        root = next;
    }
    // Path compression so repeated lookups stay cheap.
    let mut cursor = key.to_string();
    while cursor != root {
        let next = parents
            .get(&cursor)
            .cloned()
            .unwrap_or_else(|| root.clone());
        parents.insert(cursor.clone(), root.clone());
        cursor = next;
    }
    root
}

fn union_conversations(parents: &mut HashMap<String, String>, a: &str, b: &str) {
    let root_a = find_conversation_root(parents, a);
    let root_b = find_conversation_root(parents, b);
    if root_a == root_b {
        return;
    }
    // Keep the lexicographically smaller key as root so the result is stable.
    if root_a <= root_b {
        parents.insert(root_b, root_a);
    } else {
        parents.insert(root_a, root_b);
    }
}

/// Messages that belong on the Beérkező (inbox) screen. Plain step-1 campaign
/// drafts are managed on the Campaigns page and should not define a thread's
/// visible subject or date.
fn is_inbox_visible_message(msg: &EmailMessage) -> bool {
    msg.status == "sent"
        || msg.status == "received"
        || msg.status == "queued"
        || (msg.status == "draft" && (msg.step_number >= 2 || msg.auto_send_status.is_some()))
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("DB könyvtár hiba: {}", e))?;
        }
        let conn = Connection::open(path).map_err(|e| format!("SQLite megnyitási hiba: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| format!("SQLite PRAGMA hiba: {}", e))?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                website_url TEXT NOT NULL DEFAULT '',
                industry TEXT NOT NULL DEFAULT '',
                language TEXT NOT NULL DEFAULT 'hu',
                description TEXT NOT NULL DEFAULT '',
                booking_url TEXT NOT NULL DEFAULT '',
                landing_url TEXT NOT NULL DEFAULT '',
                value_proposition TEXT NOT NULL DEFAULT '',
                target_audience TEXT NOT NULL DEFAULT '',
                pain_points_solved TEXT NOT NULL DEFAULT '[]',
                pitch_angles TEXT NOT NULL DEFAULT '[]',
                objection_handlers TEXT NOT NULL DEFAULT '[]',
                crawled_summary TEXT NOT NULL DEFAULT '',
                crawled_pages_count INTEGER NOT NULL DEFAULT 0,
                last_crawled_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS offers (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                offer_type TEXT NOT NULL DEFAULT 'discount',
                discount_value TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                cta_text TEXT NOT NULL DEFAULT '',
                conditions TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS searches (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                offer_id TEXT REFERENCES offers(id) ON DELETE SET NULL,
                name TEXT NOT NULL,
                query TEXT NOT NULL DEFAULT '',
                industry TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                company_size TEXT NOT NULL DEFAULT 'any',
                target_problem TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'osm',
                max_results INTEGER NOT NULL DEFAULT 15,
                auto_audit INTEGER NOT NULL DEFAULT 1,
                auto_enrich_threshold INTEGER NOT NULL DEFAULT 70,
                status TEXT NOT NULL DEFAULT 'draft',
                leads_found INTEGER NOT NULL DEFAULT 0,
                promising_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                last_run_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS leads (
                id TEXT PRIMARY KEY,
                company_name TEXT NOT NULL,
                domain TEXT NOT NULL DEFAULT '',
                website_url TEXT NOT NULL DEFAULT '',
                industry TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                address TEXT NOT NULL DEFAULT '',
                phone TEXT NOT NULL DEFAULT '',
                primary_email TEXT NOT NULL DEFAULT '',
                employee_estimate TEXT NOT NULL DEFAULT '',
                google_rating REAL,
                google_reviews INTEGER,
                source TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'new',
                fit_score INTEGER NOT NULL DEFAULT 0,
                enriched INTEGER NOT NULL DEFAULT 0,
                company_summary TEXT NOT NULL DEFAULT '',
                pain_points TEXT NOT NULL DEFAULT '[]',
                how_we_can_help TEXT NOT NULL DEFAULT '',
                recommended_pitch TEXT NOT NULL DEFAULT '',
                tech_stack TEXT NOT NULL DEFAULT '[]',
                contacts TEXT NOT NULL DEFAULT '[]',
                audit_json TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_leads_domain ON leads(domain);
            CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
            CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(fit_score);

            CREATE TABLE IF NOT EXISTS search_leads (
                search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
                lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                found_at TEXT NOT NULL,
                PRIMARY KEY (search_id, lead_id)
            );

            CREATE TABLE IF NOT EXISTS sender_accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider TEXT NOT NULL DEFAULT 'smtp',
                from_name TEXT NOT NULL DEFAULT '',
                from_email TEXT NOT NULL DEFAULT '',
                reply_to TEXT NOT NULL DEFAULT '',
                smtp_host TEXT NOT NULL DEFAULT '',
                smtp_port INTEGER NOT NULL DEFAULT 587,
                smtp_username TEXT NOT NULL DEFAULT '',
                smtp_password TEXT NOT NULL DEFAULT '',
                smtp_security TEXT NOT NULL DEFAULT 'starttls',
                ses_region TEXT NOT NULL DEFAULT 'eu-central-1',
                ses_access_key TEXT NOT NULL DEFAULT '',
                ses_secret_key TEXT NOT NULL DEFAULT '',
                daily_limit INTEGER NOT NULL DEFAULT 50,
                sent_today INTEGER NOT NULL DEFAULT 0,
                imap_host TEXT NOT NULL DEFAULT '',
                imap_port INTEGER NOT NULL DEFAULT 993,
                imap_username TEXT NOT NULL DEFAULT '',
                imap_password TEXT NOT NULL DEFAULT '',
                imap_enabled INTEGER NOT NULL DEFAULT 0,
                is_default INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS campaigns (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                offer_id TEXT REFERENCES offers(id) ON DELETE SET NULL,
                search_id TEXT REFERENCES searches(id) ON DELETE SET NULL,
                sender_account_id TEXT REFERENCES sender_accounts(id) ON DELETE SET NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                tone TEXT NOT NULL DEFAULT 'professional_formal',
                language TEXT NOT NULL DEFAULT 'hu',
                auto_reply_mode TEXT NOT NULL DEFAULT 'draft',
                daily_limit INTEGER NOT NULL DEFAULT 40,
                min_delay_sec INTEGER NOT NULL DEFAULT 45,
                follow_up_days INTEGER NOT NULL DEFAULT 3,
                include_booking_link INTEGER NOT NULL DEFAULT 0,
                custom_instructions TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS email_messages (
                id TEXT PRIMARY KEY,
                campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
                lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
                direction TEXT NOT NULL DEFAULT 'outbound',
                status TEXT NOT NULL DEFAULT 'draft',
                step_number INTEGER NOT NULL DEFAULT 1,
                subject TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                message_id_header TEXT,
                in_reply_to TEXT,
                ai_intent TEXT,
                ai_suggested_reply TEXT,
                booking_link_sent INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                sent_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_lead ON email_messages(lead_id);
            CREATE INDEX IF NOT EXISTS idx_messages_campaign ON email_messages(campaign_id);
            CREATE INDEX IF NOT EXISTS idx_messages_msgid ON email_messages(message_id_header);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS suppression_list (
                email TEXT PRIMARY KEY,
                reason TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS activity_log (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                title TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '',
                lead_id TEXT,
                created_at TEXT NOT NULL
            );
            "#,
        )
        .map_err(|e| format!("Séma inicializálási hiba: {}", e))?;

        // Safe additive migrations for existing SQLite databases
        let migrations = [
            "ALTER TABLE projects ADD COLUMN email_signature TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE campaigns ADD COLUMN offer_summary TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE campaigns ADD COLUMN offer_timing TEXT NOT NULL DEFAULT 'on_interest'",
            "ALTER TABLE campaigns ADD COLUMN offer_delivery TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE email_messages ADD COLUMN scheduled_send_at TEXT",
            "ALTER TABLE email_messages ADD COLUMN auto_send_status TEXT",
            "ALTER TABLE email_messages ADD COLUMN ai_summary TEXT",
            "ALTER TABLE email_messages ADD COLUMN ai_rewrite_note TEXT",
            "ALTER TABLE email_messages ADD COLUMN ai_priority_score INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE email_messages ADD COLUMN ai_tags TEXT NOT NULL DEFAULT '[]'",
        ];
        for sql in migrations {
            let _ = conn.execute(sql, []);
        }
        let _ = conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_scheduled ON email_messages(status, auto_send_status, scheduled_send_at)",
            [],
        );

        Ok(())
    }

    pub fn log_activity(&self, kind: &str, title: &str, detail: &str, lead_id: Option<&str>) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "INSERT INTO activity_log (id, kind, title, detail, lead_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![Uuid::new_v4().to_string(), kind, title, detail, lead_id, Utc::now().to_rfc3339()],
        );
    }

    // ==================== SETTINGS ====================
    pub fn get_settings(&self) -> Result<AppSettings, String> {
        let conn = self.conn.lock().unwrap();
        let json_opt: Option<String> = conn
            .query_row("SELECT value FROM settings WHERE key = 'app_settings'", [], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        match json_opt {
            Some(s) => serde_json::from_str(&s).or_else(|_| Ok(AppSettings::default())),
            None => Ok(AppSettings::default()),
        }
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<AppSettings, String> {
        let conn = self.conn.lock().unwrap();
        let serialized = serde_json::to_string(settings).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('app_settings', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![serialized],
        )
        .map_err(|e| e.to_string())?;
        Ok(settings.clone())
    }

    // ==================== PROJECTS & OFFERS ====================
    fn fetch_offers_for_project(conn: &Connection, project_id: &str) -> Result<Vec<Offer>, String> {
        let mut stmt = conn
            .prepare("SELECT id, project_id, title, offer_type, discount_value, description, cta_text, conditions, active, created_at FROM offers WHERE project_id = ?1 ORDER BY created_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], |r| {
                Ok(Offer {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    title: r.get(2)?,
                    offer_type: r.get(3)?,
                    discount_value: r.get(4)?,
                    description: r.get(5)?,
                    cta_text: r.get(6)?,
                    conditions: r.get(7)?,
                    active: r.get::<_, i64>(8)? != 0,
                    created_at: r.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for item in rows {
            out.push(item.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn list_projects(&self) -> Result<Vec<Project>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, website_url, industry, language, description, booking_url, landing_url, email_signature, value_proposition, target_audience, pain_points_solved, pitch_angles, objection_handlers, crawled_summary, crawled_pages_count, last_crawled_at, created_at, updated_at FROM projects ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |r| {
                let id: String = r.get(0)?;
                Ok((
                    id,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                    r.get::<_, String>(9)?,
                    r.get::<_, String>(10)?,
                    r.get::<_, String>(11)?,
                    r.get::<_, String>(12)?,
                    r.get::<_, String>(13)?,
                    r.get::<_, String>(14)?,
                    r.get::<_, i64>(15)?,
                    r.get::<_, Option<String>>(16)?,
                    r.get::<_, String>(17)?,
                    r.get::<_, String>(18)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut projects = Vec::new();
        for row in rows {
            let (id, name, website_url, industry, language, description, booking_url, landing_url, email_signature, value_proposition, target_audience, pp_s, pa_s, oh_s, crawled_summary, crawled_pages_count, last_crawled_at, created_at, updated_at) =
                row.map_err(|e| e.to_string())?;
            let offers = Self::fetch_offers_for_project(&conn, &id)?;
            projects.push(Project {
                id,
                name,
                website_url,
                industry,
                language,
                description,
                booking_url,
                landing_url,
                email_signature,
                value_proposition,
                target_audience,
                pain_points_solved: serde_json::from_str(&pp_s).unwrap_or_default(),
                pitch_angles: serde_json::from_str(&pa_s).unwrap_or_default(),
                objection_handlers: serde_json::from_str(&oh_s).unwrap_or_default(),
                crawled_summary,
                crawled_pages_count,
                last_crawled_at,
                offers,
                created_at,
                updated_at,
            });
        }
        Ok(projects)
    }

    pub fn get_project(&self, id: &str) -> Result<Project, String> {
        self.list_projects()?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| "Projekt nem található".to_string())
    }

    pub fn save_project(&self, input: ProjectInput) -> Result<Project, String> {
        let now = Utc::now().to_rfc3339();
        let id = input.id.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| Uuid::new_v4().to_string());
        {
            let conn = self.conn.lock().unwrap();
            let exists: bool = conn
                .query_row("SELECT COUNT(*) FROM projects WHERE id = ?1", params![&id], |r| r.get::<_, i64>(0))
                .unwrap_or(0)
                > 0;

            if exists {
                conn.execute(
                    "UPDATE projects SET name=?1, website_url=?2, industry=?3, language=?4, description=?5, booking_url=?6, landing_url=?7, email_signature=COALESCE(?8, email_signature), value_proposition=COALESCE(?9, value_proposition), target_audience=COALESCE(?10, target_audience), pain_points_solved=COALESCE(?11, pain_points_solved), pitch_angles=COALESCE(?12, pitch_angles), objection_handlers=COALESCE(?13, objection_handlers), updated_at=?14 WHERE id=?15",
                    params![
                        input.name,
                        input.website_url,
                        input.industry,
                        input.language,
                        input.description,
                        input.booking_url,
                        input.landing_url,
                        input.email_signature,
                        input.value_proposition,
                        input.target_audience,
                        input.pain_points_solved.map(|v| serde_json::to_string(&v).unwrap_or_else(|_| "[]".into())),
                        input.pitch_angles.map(|v| serde_json::to_string(&v).unwrap_or_else(|_| "[]".into())),
                        input.objection_handlers.map(|v| serde_json::to_string(&v).unwrap_or_else(|_| "[]".into())),
                        now,
                        &id
                    ],
                )
                .map_err(|e| e.to_string())?;
            } else {
                conn.execute(
                    "INSERT INTO projects (id, name, website_url, industry, language, description, booking_url, landing_url, email_signature, value_proposition, target_audience, pain_points_solved, pitch_angles, objection_handlers, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                    params![
                        &id,
                        input.name,
                        input.website_url,
                        input.industry,
                        input.language,
                        input.description,
                        input.booking_url,
                        input.landing_url,
                        input.email_signature.unwrap_or_default(),
                        input.value_proposition.unwrap_or_default(),
                        input.target_audience.unwrap_or_default(),
                        serde_json::to_string(&input.pain_points_solved.unwrap_or_default()).unwrap_or_else(|_| "[]".into()),
                        serde_json::to_string(&input.pitch_angles.unwrap_or_default()).unwrap_or_else(|_| "[]".into()),
                        serde_json::to_string(&input.objection_handlers.unwrap_or_default()).unwrap_or_else(|_| "[]".into()),
                        &now,
                        &now
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        self.get_project(&id)
    }

    pub fn update_project_ai_profile(
        &self,
        project_id: &str,
        value_proposition: &str,
        target_audience: &str,
        pain_points_solved: &[String],
        pitch_angles: &[String],
        objection_handlers: &[String],
        crawled_summary: &str,
        crawled_pages_count: i64,
    ) -> Result<Project, String> {
        let now = Utc::now().to_rfc3339();
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE projects SET value_proposition=?1, target_audience=?2, pain_points_solved=?3, pitch_angles=?4, objection_handlers=?5, crawled_summary=?6, crawled_pages_count=?7, last_crawled_at=?8, updated_at=?8 WHERE id=?9",
                params![
                    value_proposition,
                    target_audience,
                    serde_json::to_string(pain_points_solved).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(pitch_angles).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(objection_handlers).unwrap_or_else(|_| "[]".into()),
                    crawled_summary,
                    crawled_pages_count,
                    now,
                    project_id
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        self.get_project(project_id)
    }

    pub fn delete_project(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_offer(&self, input: OfferInput) -> Result<Offer, String> {
        let now = Utc::now().to_rfc3339();
        let id = input.id.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| Uuid::new_v4().to_string());
        let conn = self.conn.lock().unwrap();
        let exists: bool = conn
            .query_row("SELECT COUNT(*) FROM offers WHERE id = ?1", params![&id], |r| r.get::<_, i64>(0))
            .unwrap_or(0)
            > 0;
        if exists {
            conn.execute(
                "UPDATE offers SET title=?1, offer_type=?2, discount_value=?3, description=?4, cta_text=?5, conditions=?6, active=?7 WHERE id=?8",
                params![input.title, input.offer_type, input.discount_value, input.description, input.cta_text, input.conditions, if input.active { 1 } else { 0 }, &id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                "INSERT INTO offers (id, project_id, title, offer_type, discount_value, description, cta_text, conditions, active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![&id, input.project_id, input.title, input.offer_type, input.discount_value, input.description, input.cta_text, input.conditions, if input.active { 1 } else { 0 }, &now],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(Offer {
            id,
            project_id: input.project_id,
            title: input.title,
            offer_type: input.offer_type,
            discount_value: input.discount_value,
            description: input.description,
            cta_text: input.cta_text,
            conditions: input.conditions,
            active: input.active,
            created_at: now,
        })
    }

    pub fn delete_offer(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM offers WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_offer(&self, id: &str) -> Result<Option<Offer>, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, project_id, title, offer_type, discount_value, description, cta_text, conditions, active, created_at FROM offers WHERE id = ?1",
            params![id],
            |r| {
                Ok(Offer {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    title: r.get(2)?,
                    offer_type: r.get(3)?,
                    discount_value: r.get(4)?,
                    description: r.get(5)?,
                    cta_text: r.get(6)?,
                    conditions: r.get(7)?,
                    active: r.get::<_, i64>(8)? != 0,
                    created_at: r.get(9)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    // ==================== SEARCHES ====================
    pub fn list_searches(&self) -> Result<Vec<SearchJob>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                r#"
                SELECT s.id, s.project_id, COALESCE(p.name, ''), s.offer_id, o.title,
                       s.name, s.query, s.industry, s.location, s.company_size, s.target_problem,
                       s.source, s.max_results, s.auto_audit, s.auto_enrich_threshold, s.status,
                       (SELECT COUNT(*) FROM search_leads sl WHERE sl.search_id = s.id) as leads_found,
                       (SELECT COUNT(*) FROM search_leads sl JOIN leads l ON l.id = sl.lead_id WHERE sl.search_id = s.id AND l.fit_score >= s.auto_enrich_threshold) as promising_count,
                       s.last_error, s.last_run_at, s.created_at
                FROM searches s
                LEFT JOIN projects p ON p.id = s.project_id
                LEFT JOIN offers o ON o.id = s.offer_id
                ORDER BY s.created_at DESC
                "#,
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |r| {
                Ok(SearchJob {
                    id: r.get(0)?,
                    project_id: r.get(1)?,
                    project_name: r.get(2)?,
                    offer_id: r.get(3)?,
                    offer_title: r.get(4)?,
                    name: r.get(5)?,
                    query: r.get(6)?,
                    industry: r.get(7)?,
                    location: r.get(8)?,
                    company_size: r.get(9)?,
                    target_problem: r.get(10)?,
                    source: r.get(11)?,
                    max_results: r.get(12)?,
                    auto_audit: r.get::<_, i64>(13)? != 0,
                    auto_enrich_threshold: r.get(14)?,
                    status: r.get(15)?,
                    leads_found: r.get(16)?,
                    promising_count: r.get(17)?,
                    last_error: r.get(18)?,
                    last_run_at: r.get(19)?,
                    created_at: r.get(20)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn get_search(&self, id: &str) -> Result<SearchJob, String> {
        self.list_searches()?
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| "Keresés nem található".to_string())
    }

    pub fn save_search(&self, input: SearchJobInput) -> Result<SearchJob, String> {
        let now = Utc::now().to_rfc3339();
        let id = input.id.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| Uuid::new_v4().to_string());
        {
            let conn = self.conn.lock().unwrap();
            let exists: bool = conn
                .query_row("SELECT COUNT(*) FROM searches WHERE id = ?1", params![&id], |r| r.get::<_, i64>(0))
                .unwrap_or(0)
                > 0;
            if exists {
                conn.execute(
                    "UPDATE searches SET project_id=?1, offer_id=?2, name=?3, query=?4, industry=?5, location=?6, company_size=?7, target_problem=?8, source=?9, max_results=?10, auto_audit=?11, auto_enrich_threshold=?12 WHERE id=?13",
                    params![
                        input.project_id,
                        input.offer_id.filter(|s| !s.is_empty()),
                        input.name,
                        input.query,
                        input.industry,
                        input.location,
                        input.company_size,
                        input.target_problem,
                        input.source,
                        input.max_results,
                        if input.auto_audit { 1 } else { 0 },
                        input.auto_enrich_threshold,
                        &id
                    ],
                )
                .map_err(|e| e.to_string())?;
            } else {
                conn.execute(
                    "INSERT INTO searches (id, project_id, offer_id, name, query, industry, location, company_size, target_problem, source, max_results, auto_audit, auto_enrich_threshold, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'draft', ?14)",
                    params![
                        &id,
                        input.project_id,
                        input.offer_id.filter(|s| !s.is_empty()),
                        input.name,
                        input.query,
                        input.industry,
                        input.location,
                        input.company_size,
                        input.target_problem,
                        input.source,
                        input.max_results,
                        if input.auto_audit { 1 } else { 0 },
                        input.auto_enrich_threshold,
                        &now
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        self.get_search(&id)
    }

    pub fn set_search_status(&self, id: &str, status: &str, error: Option<&str>) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE searches SET status=?1, last_error=?2, last_run_at=?3 WHERE id=?4",
            params![status, error, now, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_search(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM searches WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        // Clean up orphaned leads that belonged only to the deleted search and have no email threads
        let _ = conn.execute(
            r#"
            DELETE FROM leads
            WHERE NOT EXISTS (SELECT 1 FROM search_leads sl WHERE sl.lead_id = leads.id)
              AND NOT EXISTS (SELECT 1 FROM email_messages em WHERE em.lead_id = leads.id)
              AND status NOT IN ('in_campaign', 'replied', 'booked', 'won')
              AND source NOT IN ('Kézi felvétel', 'Kézi import', 'AI Asszisztens')
            "#,
            [],
        );
        Ok(())
    }

    pub fn update_lead_identity(
        &self,
        lead_id: &str,
        company_name: Option<&str>,
        industry: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        if let Some(name) = company_name.map(|s| s.trim()).filter(|s| !s.is_empty()) {
            let _ = conn.execute(
                "UPDATE leads SET company_name = ?1 WHERE id = ?2",
                params![name, lead_id],
            );
        }
        if let Some(ind) = industry.map(|s| s.trim()).filter(|s| !s.is_empty()) {
            let _ = conn.execute(
                "UPDATE leads SET industry = ?1 WHERE id = ?2",
                params![ind, lead_id],
            );
        }
        Ok(())
    }

    pub fn remove_rejected_search_lead(&self, search_id: &str, lead_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM search_leads WHERE search_id = ?1 AND lead_id = ?2",
            params![search_id, lead_id],
        );
        let _ = conn.execute(
            r#"
            DELETE FROM leads
            WHERE id = ?1
              AND NOT EXISTS (SELECT 1 FROM search_leads sl WHERE sl.lead_id = leads.id)
              AND NOT EXISTS (SELECT 1 FROM email_messages em WHERE em.lead_id = leads.id)
              AND status NOT IN ('in_campaign', 'replied', 'booked', 'won')
            "#,
            params![lead_id],
        );
        Ok(())
    }

    // ==================== CENTRAL LEADS DATABASE ====================
    fn fetch_lead_provenance(conn: &Connection, lead_id: &str) -> Result<Vec<LeadProvenance>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT sl.search_id, s.name, sl.found_at FROM search_leads sl JOIN searches s ON s.id = sl.search_id WHERE sl.lead_id = ?1 ORDER BY sl.found_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![lead_id], |r| {
                Ok(LeadProvenance {
                    search_id: r.get(0)?,
                    search_name: r.get(1)?,
                    found_at: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn list_leads(&self, search_id: Option<&str>, status: Option<&str>, min_score: Option<i64>, q: Option<&str>) -> Result<Vec<Lead>, String> {
        let conn = self.conn.lock().unwrap();
        let mut sql = String::from(
            "SELECT DISTINCT l.id, l.company_name, l.domain, l.website_url, l.industry, l.location, l.address, l.phone, l.primary_email, l.employee_estimate, l.google_rating, l.google_reviews, l.source, l.status, l.fit_score, l.enriched, l.company_summary, l.pain_points, l.how_we_can_help, l.recommended_pitch, l.tech_stack, l.contacts, l.audit_json, l.tags, l.notes, l.created_at, l.updated_at FROM leads l",
        );
        let mut conds = Vec::new();
        if search_id.is_some_and(|s| !s.is_empty()) {
            sql.push_str(" JOIN search_leads sl ON sl.lead_id = l.id");
            conds.push(format!("sl.search_id = '{}'", search_id.unwrap().replace('\'', "''")));
        }
        if let Some(st) = status {
            if !st.is_empty() && st != "all" {
                conds.push(format!("l.status = '{}'", st.replace('\'', "''")));
            }
        }
        if let Some(ms) = min_score {
            if ms > 0 {
                conds.push(format!("l.fit_score >= {}", ms));
            }
        }
        if let Some(query) = q {
            let clean = query.trim().replace('\'', "''").to_lowercase();
            if !clean.is_empty() {
                conds.push(format!(
                    "(LOWER(l.company_name) LIKE '%{0}%' OR LOWER(l.domain) LIKE '%{0}%' OR LOWER(l.location) LIKE '%{0}%' OR LOWER(l.industry) LIKE '%{0}%' OR LOWER(l.primary_email) LIKE '%{0}%')",
                    clean
                ));
            }
        }
        if !conds.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&conds.join(" AND "));
        }
        sql.push_str(" ORDER BY l.fit_score DESC, l.updated_at DESC");

        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                let id: String = r.get(0)?;
                let audit_str: Option<String> = r.get(22)?;
                Ok(Lead {
                    id,
                    company_name: r.get(1)?,
                    domain: r.get(2)?,
                    website_url: r.get(3)?,
                    industry: r.get(4)?,
                    location: r.get(5)?,
                    address: r.get(6)?,
                    phone: r.get(7)?,
                    primary_email: r.get(8)?,
                    employee_estimate: r.get(9)?,
                    google_rating: r.get(10)?,
                    google_reviews: r.get(11)?,
                    source: r.get(12)?,
                    status: r.get(13)?,
                    fit_score: r.get(14)?,
                    enriched: r.get::<_, i64>(15)? != 0,
                    company_summary: r.get(16)?,
                    pain_points: serde_json::from_str(&r.get::<_, String>(17)?).unwrap_or_default(),
                    how_we_can_help: r.get(18)?,
                    recommended_pitch: r.get(19)?,
                    tech_stack: serde_json::from_str(&r.get::<_, String>(20)?).unwrap_or_default(),
                    contacts: serde_json::from_str(&r.get::<_, String>(21)?).unwrap_or_default(),
                    audit: audit_str.and_then(|s| serde_json::from_str(&s).ok()),
                    tags: serde_json::from_str(&r.get::<_, String>(23)?).unwrap_or_default(),
                    notes: r.get(24)?,
                    searches: vec![],
                    created_at: r.get(25)?,
                    updated_at: r.get(26)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut leads = Vec::new();
        for item in rows {
            let mut l = item.map_err(|e| e.to_string())?;
            l.searches = Self::fetch_lead_provenance(&conn, &l.id)?;
            leads.push(l);
        }
        Ok(leads)
    }

    pub fn get_lead(&self, id: &str) -> Result<Lead, String> {
        let conn = self.conn.lock().unwrap();
        let mut lead = conn
            .query_row(
                "SELECT id, company_name, domain, website_url, industry, location, address, phone, primary_email, employee_estimate, google_rating, google_reviews, source, status, fit_score, enriched, company_summary, pain_points, how_we_can_help, recommended_pitch, tech_stack, contacts, audit_json, tags, notes, created_at, updated_at FROM leads WHERE id = ?1",
                params![id],
                |r| {
                    let audit_str: Option<String> = r.get(22)?;
                    Ok(Lead {
                        id: r.get(0)?,
                        company_name: r.get(1)?,
                        domain: r.get(2)?,
                        website_url: r.get(3)?,
                        industry: r.get(4)?,
                        location: r.get(5)?,
                        address: r.get(6)?,
                        phone: r.get(7)?,
                        primary_email: r.get(8)?,
                        employee_estimate: r.get(9)?,
                        google_rating: r.get(10)?,
                        google_reviews: r.get(11)?,
                        source: r.get(12)?,
                        status: r.get(13)?,
                        fit_score: r.get(14)?,
                        enriched: r.get::<_, i64>(15)? != 0,
                        company_summary: r.get(16)?,
                        pain_points: serde_json::from_str(&r.get::<_, String>(17)?).unwrap_or_default(),
                        how_we_can_help: r.get(18)?,
                        recommended_pitch: r.get(19)?,
                        tech_stack: serde_json::from_str(&r.get::<_, String>(20)?).unwrap_or_default(),
                        contacts: serde_json::from_str(&r.get::<_, String>(21)?).unwrap_or_default(),
                        audit: audit_str.and_then(|s| serde_json::from_str(&s).ok()),
                        tags: serde_json::from_str(&r.get::<_, String>(23)?).unwrap_or_default(),
                        notes: r.get(24)?,
                        searches: vec![],
                        created_at: r.get(25)?,
                        updated_at: r.get(26)?,
                    })
                },
            )
            .map_err(|_| "Lead nem található".to_string())?;
        lead.searches = Self::fetch_lead_provenance(&conn, &lead.id)?;
        Ok(lead)
    }

    /// Deduplicates by domain (if present) or lowercase company_name + location, attaches provenance to search_id
    pub fn upsert_discovered_lead(
        &self,
        search_id: Option<&str>,
        company_name: &str,
        website_url: &str,
        industry: &str,
        location: &str,
        address: &str,
        phone: &str,
        email: &str,
        google_rating: Option<f64>,
        google_reviews: Option<i64>,
        source: &str,
    ) -> Result<String, String> {
        let now = Utc::now().to_rfc3339();
        let domain = extract_domain(website_url);
        let conn = self.conn.lock().unwrap();

        let existing_id: Option<String> = if !domain.is_empty() {
            conn.query_row("SELECT id FROM leads WHERE domain = ?1 LIMIT 1", params![&domain], |r| r.get(0))
                .optional()
                .map_err(|e| e.to_string())?
        } else {
            conn.query_row(
                "SELECT id FROM leads WHERE LOWER(company_name) = LOWER(?1) AND LOWER(location) = LOWER(?2) LIMIT 1",
                params![company_name, location],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        };

        let lead_id = if let Some(id) = existing_id {
            // Merge any newly discovered contact fields if empty
            conn.execute(
                "UPDATE leads SET phone = CASE WHEN phone='' THEN ?1 ELSE phone END, primary_email = CASE WHEN primary_email='' THEN ?2 ELSE primary_email END, google_rating = COALESCE(google_rating, ?3), google_reviews = COALESCE(google_reviews, ?4), updated_at = ?5 WHERE id = ?6",
                params![phone, email, google_rating, google_reviews, &now, &id],
            )
            .map_err(|e| e.to_string())?;
            id
        } else {
            let new_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO leads (id, company_name, domain, website_url, industry, location, address, phone, primary_email, google_rating, google_reviews, source, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'new', ?13, ?13)",
                params![&new_id, company_name, &domain, website_url, industry, location, address, phone, email, google_rating, google_reviews, source, &now],
            )
            .map_err(|e| e.to_string())?;
            new_id
        };

        if let Some(sid) = search_id {
            conn.execute(
                "INSERT OR IGNORE INTO search_leads (search_id, lead_id, found_at) VALUES (?1, ?2, ?3)",
                params![sid, &lead_id, &now],
            )
            .map_err(|e| e.to_string())?;
        }

        Ok(lead_id)
    }

    pub fn update_lead_enrichment(
        &self,
        lead_id: &str,
        fit_score: i64,
        status: &str,
        enriched: bool,
        employee_estimate: &str,
        company_summary: &str,
        pain_points: &[String],
        how_we_can_help: &str,
        recommended_pitch: &str,
        tech_stack: &[String],
        contacts: &[LeadContact],
        primary_email: Option<&str>,
        phone: Option<&str>,
        audit: Option<&WebsiteAudit>,
    ) -> Result<Lead, String> {
        let now = Utc::now().to_rfc3339();
        {
            let conn = self.conn.lock().unwrap();
            let audit_json = audit.and_then(|a| serde_json::to_string(a).ok());
            conn.execute(
                r#"
                UPDATE leads SET
                    fit_score = ?1,
                    status = CASE WHEN status IN ('in_campaign','replied','booked','won','unsubscribed') THEN status ELSE ?2 END,
                    enriched = CASE WHEN ?3 = 1 THEN 1 ELSE enriched END,
                    employee_estimate = CASE WHEN ?4 != '' THEN ?4 ELSE employee_estimate END,
                    company_summary = ?5,
                    pain_points = ?6,
                    how_we_can_help = ?7,
                    recommended_pitch = ?8,
                    tech_stack = ?9,
                    contacts = ?10,
                    primary_email = CASE WHEN primary_email = '' AND ?11 IS NOT NULL THEN ?11 ELSE primary_email END,
                    phone = CASE WHEN phone = '' AND ?12 IS NOT NULL THEN ?12 ELSE phone END,
                    audit_json = COALESCE(?13, audit_json),
                    updated_at = ?14
                WHERE id = ?15
                "#,
                params![
                    fit_score,
                    status,
                    if enriched { 1 } else { 0 },
                    employee_estimate,
                    company_summary,
                    serde_json::to_string(pain_points).unwrap_or_else(|_| "[]".into()),
                    how_we_can_help,
                    recommended_pitch,
                    serde_json::to_string(tech_stack).unwrap_or_else(|_| "[]".into()),
                    serde_json::to_string(contacts).unwrap_or_else(|_| "[]".into()),
                    primary_email,
                    phone,
                    audit_json,
                    now,
                    lead_id
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        self.get_lead(lead_id)
    }

    pub fn update_lead_fields(&self, input: LeadUpdateInput) -> Result<Lead, String> {
        let now = Utc::now().to_rfc3339();
        let new_domain = input.website_url.as_deref().map(extract_domain);
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE leads SET company_name=COALESCE(?1, company_name), website_url=COALESCE(?2, website_url), domain=COALESCE(?3, domain), location=COALESCE(?4, location), phone=COALESCE(?5, phone), status=COALESCE(?6, status), primary_email=COALESCE(?7, primary_email), employee_estimate=COALESCE(?8, employee_estimate), notes=COALESCE(?9, notes), tags=COALESCE(?10, tags), updated_at=?11 WHERE id=?12",
                params![
                    input.company_name,
                    input.website_url,
                    new_domain,
                    input.location,
                    input.phone,
                    input.status,
                    input.primary_email,
                    input.employee_estimate,
                    input.notes,
                    input.tags.map(|t| serde_json::to_string(&t).unwrap_or_else(|_| "[]".into())),
                    now,
                    &input.id
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        self.get_lead(&input.id)
    }

    pub fn delete_leads(&self, ids: &[String]) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        for id in ids {
            conn.execute("DELETE FROM leads WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn bulk_update_lead_status(&self, ids: &[String], status: &str) -> Result<usize, String> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let mut count = 0usize;
        for id in ids {
            let n = conn
                .execute(
                    "UPDATE leads SET status = ?1, updated_at = ?2 WHERE id = ?3",
                    params![status, &now, id],
                )
                .map_err(|e| e.to_string())?;
            count += n;
        }
        Ok(count)
    }

    pub fn find_lead_by_email(&self, email: &str) -> Result<Option<Lead>, String> {
        let clean = email.trim().to_lowercase();
        if clean.is_empty() {
            return Ok(None);
        }
        let id_opt: Option<String> = {
            let conn = self.conn.lock().unwrap();
            conn.query_row(
                "SELECT id FROM leads WHERE LOWER(primary_email) = ?1 OR LOWER(contacts) LIKE ?2 LIMIT 1",
                params![&clean, format!("%\"{}\"% ", clean).trim()],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        };
        match id_opt {
            Some(id) => Ok(Some(self.get_lead(&id)?)),
            None => Ok(None),
        }
    }

    pub fn update_email_decision_metadata(
        &self,
        message_id: &str,
        intent: &str,
        priority_score: i64,
        tags: &[String],
        summary: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let tags_json = serde_json::to_string(tags).unwrap_or_else(|_| "[]".into());
        conn.execute(
            "UPDATE email_messages SET ai_intent = ?1, ai_priority_score = ?2, ai_tags = ?3, ai_summary = ?4 WHERE id = ?5",
            params![intent, priority_score, tags_json, summary, message_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ==================== SENDER ACCOUNTS ====================
    pub fn list_sender_accounts(&self) -> Result<Vec<SenderAccount>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, name, provider, from_name, from_email, reply_to, smtp_host, smtp_port, smtp_username, smtp_password, smtp_security, ses_region, ses_access_key, ses_secret_key, daily_limit, sent_today, imap_host, imap_port, imap_username, imap_password, imap_enabled, is_default, created_at FROM sender_accounts ORDER BY is_default DESC, created_at DESC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |r| {
                Ok(SenderAccount {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    provider: r.get(2)?,
                    from_name: r.get(3)?,
                    from_email: r.get(4)?,
                    reply_to: r.get(5)?,
                    smtp_host: r.get(6)?,
                    smtp_port: r.get(7)?,
                    smtp_username: r.get(8)?,
                    smtp_password: r.get(9)?,
                    smtp_security: r.get(10)?,
                    ses_region: r.get(11)?,
                    ses_access_key: r.get(12)?,
                    ses_secret_key: r.get(13)?,
                    daily_limit: r.get(14)?,
                    sent_today: r.get(15)?,
                    imap_host: r.get(16)?,
                    imap_port: r.get(17)?,
                    imap_username: r.get(18)?,
                    imap_password: r.get(19)?,
                    imap_enabled: r.get::<_, i64>(20)? != 0,
                    is_default: r.get::<_, i64>(21)? != 0,
                    created_at: r.get(22)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn get_sender_account(&self, id: &str) -> Result<SenderAccount, String> {
        self.list_sender_accounts()?
            .into_iter()
            .find(|a| a.id == id)
            .ok_or_else(|| "Küldő fiók nem található".to_string())
    }

    pub fn save_sender_account(&self, input: SenderAccountInput) -> Result<SenderAccount, String> {
        let now = Utc::now().to_rfc3339();
        let id = input.id.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| Uuid::new_v4().to_string());
        {
            let conn = self.conn.lock().unwrap();
            if input.is_default {
                let _ = conn.execute("UPDATE sender_accounts SET is_default = 0", []);
            }
            let exists: bool = conn
                .query_row("SELECT COUNT(*) FROM sender_accounts WHERE id = ?1", params![&id], |r| r.get::<_, i64>(0))
                .unwrap_or(0)
                > 0;
            if exists {
                conn.execute(
                    "UPDATE sender_accounts SET name=?1, provider=?2, from_name=?3, from_email=?4, reply_to=?5, smtp_host=?6, smtp_port=?7, smtp_username=?8, smtp_password=?9, smtp_security=?10, ses_region=?11, ses_access_key=?12, ses_secret_key=?13, daily_limit=?14, imap_host=?15, imap_port=?16, imap_username=?17, imap_password=?18, imap_enabled=?19, is_default=?20 WHERE id=?21",
                    params![
                        input.name, input.provider, input.from_name, input.from_email, input.reply_to,
                        input.smtp_host, input.smtp_port, input.smtp_username, input.smtp_password, input.smtp_security,
                        input.ses_region, input.ses_access_key, input.ses_secret_key, input.daily_limit,
                        input.imap_host, input.imap_port, input.imap_username, input.imap_password,
                        if input.imap_enabled { 1 } else { 0 },
                        if input.is_default { 1 } else { 0 },
                        &id
                    ],
                )
                .map_err(|e| e.to_string())?;
            } else {
                conn.execute(
                    "INSERT INTO sender_accounts (id, name, provider, from_name, from_email, reply_to, smtp_host, smtp_port, smtp_username, smtp_password, smtp_security, ses_region, ses_access_key, ses_secret_key, daily_limit, imap_host, imap_port, imap_username, imap_password, imap_enabled, is_default, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
                    params![
                        &id, input.name, input.provider, input.from_name, input.from_email, input.reply_to,
                        input.smtp_host, input.smtp_port, input.smtp_username, input.smtp_password, input.smtp_security,
                        input.ses_region, input.ses_access_key, input.ses_secret_key, input.daily_limit,
                        input.imap_host, input.imap_port, input.imap_username, input.imap_password,
                        if input.imap_enabled { 1 } else { 0 },
                        if input.is_default { 1 } else { 0 },
                        &now
                    ],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        self.get_sender_account(&id)
    }

    pub fn delete_sender_account(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM sender_accounts WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn increment_sender_sent_today(&self, id: &str) {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute("UPDATE sender_accounts SET sent_today = sent_today + 1 WHERE id = ?1", params![id]);
    }

    // ==================== CAMPAIGNS & EMAIL MESSAGES ====================
    pub fn list_campaigns(&self) -> Result<Vec<Campaign>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                r#"
                SELECT c.id, c.name, c.project_id, COALESCE(p.name,''), c.offer_id, o.title,
                       c.search_id, s.name, c.sender_account_id, sa.name, c.status, c.tone,
                       c.language, c.auto_reply_mode, c.daily_limit, c.min_delay_sec, c.follow_up_days,
                       c.include_booking_link, c.custom_instructions,
                       c.offer_summary, c.offer_timing, c.offer_delivery,
                       (SELECT COUNT(DISTINCT lead_id) FROM email_messages em WHERE em.campaign_id = c.id) as total_recipients,
                       (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND em.direction='outbound' AND em.status='sent') as sent_count,
                       (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND em.direction='outbound' AND em.status='failed') as failed_count,
                       (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND em.direction='inbound') as reply_count,
                       (SELECT COUNT(*) FROM email_messages em WHERE em.campaign_id = c.id AND em.direction='inbound' AND em.ai_intent IN ('interested','booking_request','question')) as positive_count,
                       (SELECT COUNT(DISTINCT em.lead_id) FROM email_messages em JOIN leads l ON l.id = em.lead_id WHERE em.campaign_id = c.id AND (l.status = 'booked' OR em.booking_link_sent = 1)) as booked_count,
                       c.created_at, c.updated_at
                FROM campaigns c
                LEFT JOIN projects p ON p.id = c.project_id
                LEFT JOIN offers o ON o.id = c.offer_id
                LEFT JOIN searches s ON s.id = c.search_id
                LEFT JOIN sender_accounts sa ON sa.id = c.sender_account_id
                ORDER BY c.updated_at DESC
                "#,
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |r| {
                Ok(Campaign {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    project_id: r.get(2)?,
                    project_name: r.get(3)?,
                    offer_id: r.get(4)?,
                    offer_title: r.get(5)?,
                    search_id: r.get(6)?,
                    search_name: r.get(7)?,
                    sender_account_id: r.get(8)?,
                    sender_name: r.get(9)?,
                    status: r.get(10)?,
                    tone: r.get(11)?,
                    language: r.get(12)?,
                    auto_reply_mode: r.get(13)?,
                    daily_limit: r.get(14)?,
                    min_delay_sec: r.get(15)?,
                    follow_up_days: r.get(16)?,
                    include_booking_link: r.get::<_, i64>(17)? != 0,
                    custom_instructions: r.get(18)?,
                    offer_summary: r.get(19)?,
                    offer_timing: r.get(20)?,
                    offer_delivery: r.get(21)?,
                    total_recipients: r.get(22)?,
                    sent_count: r.get(23)?,
                    failed_count: r.get(24)?,
                    reply_count: r.get(25)?,
                    positive_count: r.get(26)?,
                    booked_count: r.get(27)?,
                    created_at: r.get(28)?,
                    updated_at: r.get(29)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn get_campaign(&self, id: &str) -> Result<Campaign, String> {
        self.list_campaigns()?
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| "Kampány nem található".to_string())
    }

    pub fn create_campaign(&self, input: &CampaignInput) -> Result<Campaign, String> {
        let now = Utc::now().to_rfc3339();
        let id = input.id.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| Uuid::new_v4().to_string());
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO campaigns (id, name, project_id, offer_id, search_id, sender_account_id, status, tone, language, auto_reply_mode, daily_limit, min_delay_sec, follow_up_days, include_booking_link, custom_instructions, offer_summary, offer_timing, offer_delivery, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,'draft',?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)",
                params![
                    &id,
                    input.name,
                    input.project_id,
                    input.offer_id.clone().filter(|s| !s.is_empty()),
                    input.search_id.clone().filter(|s| !s.is_empty()),
                    input.sender_account_id.clone().filter(|s| !s.is_empty()),
                    input.tone,
                    input.language,
                    input.auto_reply_mode,
                    input.daily_limit,
                    input.min_delay_sec,
                    input.follow_up_days,
                    if input.include_booking_link { 1 } else { 0 },
                    input.custom_instructions,
                    input.offer_summary,
                    if input.offer_timing.is_empty() { "on_interest" } else { input.offer_timing.as_str() },
                    input.offer_delivery,
                    &now
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        self.get_campaign(&id)
    }

    pub fn update_campaign(&self, input: &CampaignUpdateInput) -> Result<Campaign, String> {
        let now = Utc::now().to_rfc3339();
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE campaigns SET name=COALESCE(?1, name), project_id=COALESCE(?2, project_id), offer_id=COALESCE(?3, offer_id), sender_account_id=COALESCE(?4, sender_account_id), status=COALESCE(?5, status), tone=COALESCE(?6, tone), auto_reply_mode=COALESCE(?7, auto_reply_mode), daily_limit=COALESCE(?8, daily_limit), include_booking_link=COALESCE(?9, include_booking_link), custom_instructions=COALESCE(?10, custom_instructions), offer_summary=COALESCE(?11, offer_summary), offer_timing=COALESCE(?12, offer_timing), offer_delivery=COALESCE(?13, offer_delivery), updated_at=?14 WHERE id=?15",
                params![
                    input.name,
                    input.project_id,
                    input.offer_id.as_ref().filter(|s| !s.is_empty()),
                    input.sender_account_id.as_ref().filter(|s| !s.is_empty()),
                    input.status,
                    input.tone,
                    input.auto_reply_mode,
                    input.daily_limit,
                    input.include_booking_link.map(|b| if b { 1i64 } else { 0i64 }),
                    input.custom_instructions,
                    input.offer_summary,
                    input.offer_timing,
                    input.offer_delivery,
                    &now,
                    &input.id
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        self.get_campaign(&input.id)
    }

    pub fn campaign_has_lead(&self, campaign_id: &str, lead_id: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM email_messages WHERE campaign_id = ?1 AND lead_id = ?2 AND direction = 'outbound'",
            params![campaign_id, lead_id],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
            > 0
    }

    pub fn update_campaign_status(&self, id: &str, status: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE campaigns SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, Utc::now().to_rfc3339(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_campaign(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM campaigns WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn insert_email_message(
        &self,
        campaign_id: Option<&str>,
        lead_id: &str,
        direction: &str,
        status: &str,
        step_number: i64,
        subject: &str,
        body: &str,
        message_id_header: Option<&str>,
        in_reply_to: Option<&str>,
        ai_intent: Option<&str>,
        ai_suggested_reply: Option<&str>,
        booking_link_sent: bool,
        sent_at: Option<&str>,
    ) -> Result<String, String> {
        self.insert_email_message_full(
            campaign_id,
            lead_id,
            direction,
            status,
            step_number,
            subject,
            body,
            message_id_header,
            in_reply_to,
            ai_intent,
            ai_suggested_reply,
            booking_link_sent,
            sent_at,
            None,
            None,
            None,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insert_email_message_full(
        &self,
        campaign_id: Option<&str>,
        lead_id: &str,
        direction: &str,
        status: &str,
        step_number: i64,
        subject: &str,
        body: &str,
        message_id_header: Option<&str>,
        in_reply_to: Option<&str>,
        ai_intent: Option<&str>,
        ai_suggested_reply: Option<&str>,
        booking_link_sent: bool,
        sent_at: Option<&str>,
        scheduled_send_at: Option<&str>,
        auto_send_status: Option<&str>,
        ai_summary: Option<&str>,
        ai_rewrite_note: Option<&str>,
    ) -> Result<String, String> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO email_messages (id, campaign_id, lead_id, direction, status, step_number, subject, body, message_id_header, in_reply_to, ai_intent, ai_suggested_reply, booking_link_sent, sent_at, created_at, scheduled_send_at, auto_send_status, ai_summary, ai_rewrite_note) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            params![
                &id,
                campaign_id,
                lead_id,
                direction,
                status,
                step_number,
                subject,
                body,
                message_id_header,
                in_reply_to,
                ai_intent,
                ai_suggested_reply,
                if booking_link_sent { 1 } else { 0 },
                sent_at,
                &now,
                scheduled_send_at,
                auto_send_status,
                ai_summary,
                ai_rewrite_note,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(id)
    }

    fn map_email_row(r: &rusqlite::Row) -> rusqlite::Result<EmailMessage> {
        let tags_raw: Option<String> = r.get(24).ok();
        Ok(EmailMessage {
            id: r.get(0)?,
            campaign_id: r.get(1)?,
            campaign_name: r.get(2)?,
            lead_id: r.get(3)?,
            lead_company: r.get(4)?,
            lead_email: r.get(5)?,
            direction: r.get(6)?,
            status: r.get(7)?,
            step_number: r.get(8)?,
            subject: r.get(9)?,
            body: r.get(10)?,
            message_id_header: r.get(11)?,
            in_reply_to: r.get(12)?,
            ai_intent: r.get(13)?,
            ai_suggested_reply: r.get(14)?,
            booking_link_sent: r.get::<_, i64>(15)? != 0,
            error_message: r.get(16)?,
            sent_at: r.get(17)?,
            created_at: r.get(18)?,
            scheduled_send_at: r.get(19)?,
            auto_send_status: r.get(20)?,
            ai_summary: r.get(21)?,
            ai_rewrite_note: r.get(22)?,
            ai_priority_score: r.get::<_, i64>(23).unwrap_or(0),
            ai_tags: tags_raw
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default(),
        })
    }

    pub fn get_email_message(&self, id: &str) -> Result<EmailMessage, String> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            r#"
            SELECT em.id, em.campaign_id, c.name, em.lead_id, l.company_name, l.primary_email,
                   em.direction, em.status, em.step_number, em.subject, em.body,
                   em.message_id_header, em.in_reply_to, em.ai_intent, em.ai_suggested_reply,
                   em.booking_link_sent, em.error_message, em.sent_at, em.created_at,
                   em.scheduled_send_at, em.auto_send_status, em.ai_summary, em.ai_rewrite_note,
                   em.ai_priority_score, em.ai_tags
            FROM email_messages em
            JOIN leads l ON l.id = em.lead_id
            LEFT JOIN campaigns c ON c.id = em.campaign_id
            WHERE em.id = ?1
            "#,
            params![id],
            Self::map_email_row,
        )
        .map_err(|_| "Üzenet nem található".to_string())
    }

    pub fn update_email_draft(&self, id: &str, subject: &str, body: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE email_messages SET subject = ?1, body = ?2 WHERE id = ?3",
            params![subject, body, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_email_message_content(
        &self,
        id: &str,
        subject: &str,
        body: &str,
        ai_rewrite_note: Option<&str>,
    ) -> Result<EmailMessage, String> {
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE email_messages SET subject = ?1, body = ?2, ai_rewrite_note = COALESCE(?3, ai_rewrite_note) WHERE id = ?4",
                params![subject, body, ai_rewrite_note, id],
            )
            .map_err(|e| e.to_string())?;
        }
        self.get_email_message(id)
    }

    pub fn update_email_schedule(
        &self,
        id: &str,
        status: &str,
        auto_send_status: Option<&str>,
        scheduled_send_at: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<EmailMessage, String> {
        {
            let conn = self.conn.lock().unwrap();
            conn.execute(
                "UPDATE email_messages SET status = ?1, auto_send_status = ?2, scheduled_send_at = ?3, error_message = ?4 WHERE id = ?5",
                params![status, auto_send_status, scheduled_send_at, error_message, id],
            )
            .map_err(|e| e.to_string())?;
        }
        self.get_email_message(id)
    }

    pub fn delete_email_message(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM email_messages WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Kézi küldés után a lead többi el nem küldött választervezetét törli,
    /// hogy az auto-küldés biztosan megszűnjön. A kampány-leveleket (step 1)
    /// nem érinti — csak a választervezeteket (step >= 2).
    pub fn delete_other_pending_reply_drafts(
        &self,
        lead_id: &str,
        exclude_id: &str,
    ) -> Result<usize, String> {
        let conn = self.conn.lock().unwrap();
        let n = conn
            .execute(
                "DELETE FROM email_messages WHERE lead_id = ?1 AND id <> ?2 AND direction = 'outbound' AND status IN ('queued', 'draft') AND step_number >= 2",
                params![lead_id, exclude_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(n)
    }

    /// Már beragadt duplikált bejövő üzenetek takarítása (azonos lead + tárgy +
    /// törzs): a legkorábbit tartja meg. Előretekintő védelem az IMAP-szinkron
    /// versenyhelyzetei ellen.
    pub fn delete_duplicate_inbound_messages(&self) -> Result<usize, String> {
        let conn = self.conn.lock().unwrap();
        let n = conn
            .execute(
                "DELETE FROM email_messages WHERE direction = 'inbound' AND rowid NOT IN (SELECT MIN(rowid) FROM email_messages WHERE direction = 'inbound' GROUP BY lead_id, subject, body)",
                [],
            )
            .map_err(|e| e.to_string())?;
        Ok(n)
    }

    pub fn delete_email_messages(&self, ids: &[String]) -> Result<usize, String> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut deleted = 0usize;
        {
            let mut stmt = tx
                .prepare("DELETE FROM email_messages WHERE id = ?1")
                .map_err(|e| e.to_string())?;
            for id in ids {
                deleted += stmt.execute(params![id]).map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(deleted)
    }

    pub fn find_email_message_by_header(
        &self,
        message_id_header: &str,
    ) -> Result<Option<EmailMessage>, String> {
        let normalized = normalize_message_id(message_id_header);
        if normalized.is_empty() {
            return Ok(None);
        }
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                r#"
                SELECT em.id, em.campaign_id, c.name, em.lead_id, l.company_name, l.primary_email,
                       em.direction, em.status, em.step_number, em.subject, em.body,
                       em.message_id_header, em.in_reply_to, em.ai_intent, em.ai_suggested_reply,
                       em.booking_link_sent, em.error_message, em.sent_at, em.created_at,
                       em.scheduled_send_at, em.auto_send_status, em.ai_summary, em.ai_rewrite_note,
                       em.ai_priority_score, em.ai_tags
                FROM email_messages em
                JOIN leads l ON l.id = em.lead_id
                LEFT JOIN campaigns c ON c.id = em.campaign_id
                WHERE em.message_id_header IS NOT NULL
                ORDER BY em.created_at ASC
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], Self::map_email_row)
            .map_err(|e| e.to_string())?;
        for row in rows {
            let msg = row.map_err(|e| e.to_string())?;
            if msg
                .message_id_header
                .as_deref()
                .map(normalize_message_id)
                .is_some_and(|header| header == normalized)
            {
                return Ok(Some(msg));
            }
        }
        Ok(None)
    }

    pub fn list_lead_messages(&self, lead_id: &str) -> Result<Vec<EmailMessage>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                r#"
                SELECT em.id, em.campaign_id, c.name, em.lead_id, l.company_name, l.primary_email,
                       em.direction, em.status, em.step_number, em.subject, em.body,
                       em.message_id_header, em.in_reply_to, em.ai_intent, em.ai_suggested_reply,
                       em.booking_link_sent, em.error_message, em.sent_at, em.created_at,
                       em.scheduled_send_at, em.auto_send_status, em.ai_summary, em.ai_rewrite_note,
                       em.ai_priority_score, em.ai_tags
                FROM email_messages em
                JOIN leads l ON l.id = em.lead_id
                LEFT JOIN campaigns c ON c.id = em.campaign_id
                WHERE em.lead_id = ?1
                ORDER BY COALESCE(em.sent_at, em.created_at) ASC
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![lead_id], Self::map_email_row)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn list_due_scheduled_messages(&self) -> Result<Vec<EmailMessage>, String> {
        let conn = self.conn.lock().unwrap();
        let now_utc = Utc::now().to_rfc3339();
        let mut stmt = conn
            .prepare(
                r#"
                SELECT em.id, em.campaign_id, c.name, em.lead_id, l.company_name, l.primary_email,
                       em.direction, em.status, em.step_number, em.subject, em.body,
                       em.message_id_header, em.in_reply_to, em.ai_intent, em.ai_suggested_reply,
                       em.booking_link_sent, em.error_message, em.sent_at, em.created_at,
                       em.scheduled_send_at, em.auto_send_status, em.ai_summary, em.ai_rewrite_note,
                       em.ai_priority_score, em.ai_tags
                FROM email_messages em
                JOIN leads l ON l.id = em.lead_id
                LEFT JOIN campaigns c ON c.id = em.campaign_id
                WHERE em.direction = 'outbound'
                  AND em.status = 'queued'
                  AND em.auto_send_status = 'scheduled'
                  AND em.scheduled_send_at IS NOT NULL
                  AND em.scheduled_send_at <= ?1
                ORDER BY em.scheduled_send_at ASC
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![&now_utc], Self::map_email_row)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn mark_email_sent(&self, id: &str, msg_id_header: &str, booking_link_sent: bool) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE email_messages SET status='sent', auto_send_status=CASE WHEN auto_send_status IS NOT NULL THEN 'sent' ELSE NULL END, message_id_header=?1, booking_link_sent=CASE WHEN ?2=1 THEN 1 ELSE booking_link_sent END, error_message=NULL, sent_at=?3 WHERE id=?4",
            params![msg_id_header, if booking_link_sent { 1 } else { 0 }, now, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn mark_email_failed(&self, id: &str, error: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE email_messages SET status='failed', auto_send_status=CASE WHEN auto_send_status='scheduled' THEN 'failed' ELSE auto_send_status END, error_message=?1 WHERE id=?2",
            params![error, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn message_id_exists(&self, message_id_header: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM email_messages WHERE message_id_header = ?1",
            params![message_id_header],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
            > 0
    }

    pub fn list_pending_generating_messages(&self) -> Result<Vec<EmailMessage>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                r#"
                SELECT em.id, em.campaign_id, c.name, em.lead_id, l.company_name, l.primary_email,
                       em.direction, em.status, em.step_number, em.subject, em.body,
                       em.message_id_header, em.in_reply_to, em.ai_intent, em.ai_suggested_reply,
                       em.booking_link_sent, em.error_message, em.sent_at, em.created_at,
                       em.scheduled_send_at, em.auto_send_status, em.ai_summary, em.ai_rewrite_note,
                       em.ai_priority_score, em.ai_tags
                FROM email_messages em
                JOIN leads l ON l.id = em.lead_id
                LEFT JOIN campaigns c ON c.id = em.campaign_id
                WHERE em.direction = 'outbound' AND em.status = 'generating'
                ORDER BY em.created_at ASC
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], Self::map_email_row)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn finalize_generated_email(
        &self,
        id: &str,
        subject: &str,
        body: &str,
        booking_link_sent: bool,
    ) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE email_messages SET status = 'draft', subject = ?1, body = ?2, booking_link_sent = ?3, error_message = NULL WHERE id = ?4",
            params![subject, body, if booking_link_sent { 1 } else { 0 }, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn mark_campaign_drafts_for_regeneration(
        &self,
        campaign_id: &str,
        feedback: Option<&str>,
    ) -> Result<usize, String> {
        let conn = self.conn.lock().unwrap();
        let cnt = conn
            .execute(
                "UPDATE email_messages SET status = 'generating', ai_rewrite_note = ?2 WHERE campaign_id = ?1 AND direction = 'outbound' AND status IN ('draft', 'generating', 'failed')",
                params![campaign_id, feedback],
            )
            .map_err(|e| e.to_string())?;
        Ok(cnt)
    }

    pub fn list_campaign_messages(&self, campaign_id: &str) -> Result<Vec<EmailMessage>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                r#"
                SELECT em.id, em.campaign_id, c.name, em.lead_id, l.company_name, l.primary_email,
                       em.direction, em.status, em.step_number, em.subject, em.body,
                       em.message_id_header, em.in_reply_to, em.ai_intent, em.ai_suggested_reply,
                       em.booking_link_sent, em.error_message, em.sent_at, em.created_at,
                       em.scheduled_send_at, em.auto_send_status, em.ai_summary, em.ai_rewrite_note,
                       em.ai_priority_score, em.ai_tags
                FROM email_messages em
                JOIN leads l ON l.id = em.lead_id
                LEFT JOIN campaigns c ON c.id = em.campaign_id
                WHERE em.campaign_id = ?1
                ORDER BY em.created_at DESC
                "#,
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![campaign_id], Self::map_email_row)
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn list_inbox_threads(&self) -> Result<Vec<InboxThread>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                r#"
                SELECT em.id, em.campaign_id, c.name, COALESCE(NULLIF(c.offer_summary, ''), o.title), em.lead_id, l.company_name, l.primary_email,
                       em.direction, em.status, em.step_number, em.subject, em.body,
                       em.message_id_header, em.in_reply_to, em.ai_intent, em.ai_suggested_reply,
                       em.booking_link_sent, em.error_message, em.sent_at, em.created_at,
                       em.scheduled_send_at, em.auto_send_status, em.ai_summary, em.ai_rewrite_note,
                       l.status, l.fit_score, em.ai_priority_score, em.ai_tags
                FROM email_messages em
                JOIN leads l ON l.id = em.lead_id
                LEFT JOIN campaigns c ON c.id = em.campaign_id
                LEFT JOIN offers o ON o.id = c.offer_id
                WHERE em.status IN ('sent', 'received', 'queued', 'draft')
                ORDER BY COALESCE(em.sent_at, em.created_at) ASC
                "#,
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |r| {
                let raw_tags: String = r.get::<_, Option<String>>(27)?.unwrap_or_else(|| "[]".to_string());
                let ai_tags: Vec<String> = serde_json::from_str(&raw_tags).unwrap_or_default();
                let msg = EmailMessage {
                    id: r.get(0)?,
                    campaign_id: r.get(1)?,
                    campaign_name: r.get(2)?,
                    lead_id: r.get(4)?,
                    lead_company: r.get(5)?,
                    lead_email: r.get(6)?,
                    direction: r.get(7)?,
                    status: r.get(8)?,
                    step_number: r.get(9)?,
                    subject: r.get(10)?,
                    body: r.get(11)?,
                    message_id_header: r.get(12)?,
                    in_reply_to: r.get(13)?,
                    ai_intent: r.get(14)?,
                    ai_suggested_reply: r.get(15)?,
                    booking_link_sent: r.get::<_, i64>(16)? != 0,
                    error_message: r.get(17)?,
                    sent_at: r.get(18)?,
                    created_at: r.get(19)?,
                    scheduled_send_at: r.get(20)?,
                    auto_send_status: r.get(21)?,
                    ai_summary: r.get(22)?,
                    ai_rewrite_note: r.get(23)?,
                    ai_priority_score: r.get::<_, Option<i64>>(26)?.unwrap_or(0),
                    ai_tags,
                };
                Ok((
                    msg,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, String>(24)?,
                    r.get::<_, i64>(25)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        struct LoadedMessage {
            message: EmailMessage,
            offer_title: Option<String>,
            lead_status: String,
            fit_score: i64,
        }

        let mut loaded: Vec<LoadedMessage> = Vec::new();
        for row in rows {
            let (message, offer_title, lead_status, fit_score) = row.map_err(|e| e.to_string())?;
            loaded.push(LoadedMessage {
                message,
                offer_title,
                lead_status,
                fit_score,
            });
        }

        // Resolve which messages belong to the same conversation. Replies inherit
        // the conversation of the message they answer when the In-Reply-To header
        // points to a message we know about, so a changed subject does not split
        // a real thread. Independent conversations of the same lead stay separate.
        let mut parents: HashMap<String, String> = HashMap::new();
        let mut header_to_base: HashMap<String, String> = HashMap::new();
        for item in &loaded {
            let base = conversation_base_key(&item.message);
            parents.entry(base.clone()).or_insert(base.clone());
            if let Some(header) = item.message.message_id_header.as_deref() {
                let normalized = normalize_message_id(header);
                if !normalized.is_empty() {
                    header_to_base.entry(normalized).or_insert(base);
                }
            }
        }
        for item in &loaded {
            if let Some(parent_header) = item.message.in_reply_to.as_deref() {
                let normalized = normalize_message_id(parent_header);
                if let Some(parent_base) = header_to_base.get(&normalized) {
                    let base = conversation_base_key(&item.message);
                    union_conversations(&mut parents, &base, parent_base);
                }
            }
        }

        let mut grouped: HashMap<String, Vec<LoadedMessage>> = HashMap::new();
        for item in loaded {
            let base = conversation_base_key(&item.message);
            let root = find_conversation_root(&mut parents, &base);
            grouped.entry(root).or_default().push(item);
        }

        let mut threads: Vec<InboxThread> = Vec::new();
        for mut items in grouped.into_values() {
            items.sort_by(|a, b| {
                let a_ts = a.message.sent_at.as_deref().unwrap_or(&a.message.created_at);
                let b_ts = b.message.sent_at.as_deref().unwrap_or(&b.message.created_at);
                a_ts.cmp(b_ts)
            });

            let visible = items
                .iter()
                .any(|item| is_inbox_visible_message(&item.message));
            if !visible || items.is_empty() {
                continue;
            }

            let first = &items[0];
            let first_message = &first.message;
            let mut entry = InboxThread {
                thread_key: conversation_base_key(first_message),
                lead_id: first_message.lead_id.clone(),
                lead_company: first_message.lead_company.clone(),
                lead_email: first_message.lead_email.clone(),
                lead_status: first.lead_status.clone(),
                fit_score: first.fit_score,
                campaign_id: first_message.campaign_id.clone(),
                campaign_name: first_message.campaign_name.clone(),
                offer_title: first.offer_title.clone(),
                subject: first_message.subject.clone(),
                last_message_at: first_message
                    .sent_at
                    .clone()
                    .unwrap_or_else(|| first_message.created_at.clone()),
                last_direction: first_message.direction.clone(),
                latest_intent: first_message.ai_intent.clone(),
                priority_score: (first.fit_score / 2).clamp(20, 48),
                ai_tags: vec![],
                decision_summary: None,
                has_pending_draft: false,
                pending_reply_id: None,
                scheduled_send_at: None,
                auto_send_status: None,
                booking_link_sent: false,
                message_count: 0,
                messages: vec![],
            };

            for item in items {
                let msg = item.message;
                let ts = msg.sent_at.clone().unwrap_or_else(|| msg.created_at.clone());
                if is_inbox_visible_message(&msg) {
                    entry.last_message_at = ts;
                    entry.last_direction = msg.direction.clone();
                    entry.subject = msg.subject.clone();
                }
                if msg.ai_intent.is_some() {
                    entry.latest_intent = msg.ai_intent.clone();
                }
                if msg.direction == "inbound" {
                    if msg.ai_priority_score > 0 {
                        entry.priority_score = msg.ai_priority_score;
                    } else if let Some(ref intent) = msg.ai_intent {
                        entry.priority_score = match intent.as_str() {
                            "booking_request" => 94,
                            "interested" => 85,
                            "question" => 74,
                            "objection" => 58,
                            "not_interested" => 22,
                            "unsubscribe" => 10,
                            "out_of_office" => 15,
                            _ => 52,
                        };
                    }
                    if !msg.ai_tags.is_empty() {
                        entry.ai_tags = msg.ai_tags.clone();
                    } else if entry.ai_tags.is_empty() {
                        if let Some(ref intent) = msg.ai_intent {
                            entry.ai_tags = match intent.as_str() {
                                "booking_request" => vec!["Időpontkérés".to_string(), "Forró lead".to_string()],
                                "interested" => vec!["Érdeklődik".to_string(), "Potenciális ügyfél".to_string()],
                                "question" => vec!["Kérdés".to_string(), "Válaszra vár".to_string()],
                                "objection" => vec!["Kifogás".to_string(), "Utánkövetendő".to_string()],
                                "not_interested" => vec!["Elutasítás".to_string()],
                                "unsubscribe" => vec!["Leiratkozás".to_string()],
                                _ => vec!["Beérkező".to_string()],
                            };
                        }
                    }
                    if msg.ai_summary.as_ref().is_some_and(|s| !s.trim().is_empty()) {
                        entry.decision_summary = msg.ai_summary.clone();
                    }
                }
                if item.offer_title.is_some() {
                    entry.offer_title = item.offer_title;
                }
                if msg.direction == "outbound" && (msg.status == "queued" || (msg.status == "draft" && (msg.step_number >= 2 || msg.auto_send_status.is_some()))) {
                    entry.has_pending_draft = true;
                    entry.pending_reply_id = Some(msg.id.clone());
                    entry.scheduled_send_at = msg.scheduled_send_at.clone();
                    entry.auto_send_status = msg.auto_send_status.clone();
                } else if msg.direction == "inbound" && msg.ai_suggested_reply.as_ref().is_some_and(|s| !s.is_empty()) {
                    entry.has_pending_draft = true;
                }
                if msg.direction == "outbound" && msg.status == "sent" {
                    entry.has_pending_draft = false;
                    entry.pending_reply_id = None;
                    entry.scheduled_send_at = None;
                    entry.auto_send_status = None;
                }
                if msg.booking_link_sent {
                    entry.booking_link_sent = true;
                }
                if msg.campaign_id.is_some() {
                    entry.campaign_id = msg.campaign_id.clone();
                    entry.campaign_name = msg.campaign_name.clone();
                }
                entry.message_count += 1;
                entry.messages.push(msg);
            }
            threads.push(entry);
        }

        threads.sort_by(|a, b| {
            b.last_message_at
                .cmp(&a.last_message_at)
                .then_with(|| a.thread_key.cmp(&b.thread_key))
        });
        Ok(threads)
    }

    // ==================== SUPPRESSION LIST ====================
    pub fn list_suppressions(&self) -> Result<Vec<SuppressionEntry>, String> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT email, reason, created_at FROM suppression_list ORDER BY created_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(SuppressionEntry {
                    email: r.get(0)?,
                    reason: r.get(1)?,
                    created_at: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn add_suppression(&self, email: &str, reason: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO suppression_list (email, reason, created_at) VALUES (?1, ?2, ?3)",
            params![email.trim().to_lowercase(), reason, Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_suppression(&self, email: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM suppression_list WHERE email = ?1", params![email.trim().to_lowercase()])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn is_suppressed(&self, email: &str) -> bool {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM suppression_list WHERE email = ?1",
            params![email.trim().to_lowercase()],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0)
            > 0
    }

    // ==================== ANALYTICS ====================
    pub fn get_analytics(&self) -> Result<AnalyticsOverview, String> {
        let conn = self.conn.lock().unwrap();
        let count_q = |sql: &str| -> i64 {
            conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0)
        };

        let total_projects = count_q("SELECT COUNT(*) FROM projects");
        let total_searches = count_q("SELECT COUNT(*) FROM searches");
        let total_leads = count_q("SELECT COUNT(*) FROM leads");
        let promising_leads = count_q("SELECT COUNT(*) FROM leads WHERE fit_score >= 70");
        let enriched_leads = count_q("SELECT COUNT(*) FROM leads WHERE enriched = 1");
        let leads_with_email = count_q("SELECT COUNT(*) FROM leads WHERE primary_email != ''");
        let avg_fit_score: f64 = conn
            .query_row("SELECT COALESCE(AVG(fit_score), 0.0) FROM leads WHERE fit_score > 0", [], |r| r.get(0))
            .unwrap_or(0.0);

        let total_sent = count_q("SELECT COUNT(*) FROM email_messages WHERE direction='outbound' AND status='sent'");
        let total_failed = count_q("SELECT COUNT(*) FROM email_messages WHERE direction='outbound' AND status='failed'");
        let total_replies = count_q("SELECT COUNT(*) FROM email_messages WHERE direction='inbound'");
        let positive_replies = count_q("SELECT COUNT(*) FROM email_messages WHERE direction='inbound' AND ai_intent IN ('interested','booking_request','question')");
        let booking_links_sent = count_q("SELECT COUNT(*) FROM email_messages WHERE booking_link_sent = 1");
        let booked_leads = count_q("SELECT COUNT(*) FROM leads WHERE status IN ('booked','won')");
        let unsubscribed_count = count_q("SELECT COUNT(*) FROM suppression_list");

        let contacted_leads = count_q("SELECT COUNT(DISTINCT lead_id) FROM email_messages WHERE direction='outbound' AND status='sent'");
        let replied_leads = count_q("SELECT COUNT(DISTINCT lead_id) FROM email_messages WHERE direction='inbound'");
        let audited_leads = count_q("SELECT COUNT(*) FROM leads WHERE audit_json IS NOT NULL");

        let pct = |num: i64, den: i64| -> f64 {
            if den <= 0 { 0.0 } else { ((num as f64 / den as f64) * 1000.0).round() / 10.0 }
        };

        let delivery_rate = pct(total_sent, total_sent + total_failed);
        let reply_rate = pct(replied_leads, contacted_leads);
        let positive_rate = pct(positive_replies, total_replies);
        let booking_rate = pct(booked_leads, contacted_leads);

        let funnel = vec![
            FunnelStep { label: "Összes talált cég".into(), count: total_leads, rate: 100.0 },
            FunnelStep { label: "Auditált weboldal".into(), count: audited_leads, rate: pct(audited_leads, total_leads) },
            FunnelStep { label: "Ígéretes (Fit ≥ 70)".into(), count: promising_leads, rate: pct(promising_leads, total_leads) },
            FunnelStep { label: "Mély adatlap (Gazdagított)".into(), count: enriched_leads, rate: pct(enriched_leads, total_leads) },
            FunnelStep { label: "Megszólított (E-mail elküldve)".into(), count: contacted_leads, rate: pct(contacted_leads, total_leads) },
            FunnelStep { label: "Válaszolt".into(), count: replied_leads, rate: pct(replied_leads, contacted_leads) },
            FunnelStep { label: "Időpont / Konverzió".into(), count: booked_leads, rate: pct(booked_leads, contacted_leads) },
        ];

        // Daily metrics for the last 14 days
        let mut daily_metrics = Vec::new();
        let today = Utc::now().date_naive();
        for offset in (0..14).rev() {
            let d = today - Duration::days(offset);
            let day_prefix = d.format("%Y-%m-%d").to_string();
            let like = format!("{}%", day_prefix);
            let sent: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM email_messages WHERE direction='outbound' AND status='sent' AND COALESCE(sent_at, created_at) LIKE ?1",
                    params![&like],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let replies: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM email_messages WHERE direction='inbound' AND COALESCE(sent_at, created_at) LIKE ?1",
                    params![&like],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let positive: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM email_messages WHERE direction='inbound' AND ai_intent IN ('interested','booking_request','question') AND COALESCE(sent_at, created_at) LIKE ?1",
                    params![&like],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let booked: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM email_messages WHERE booking_link_sent = 1 AND COALESCE(sent_at, created_at) LIKE ?1",
                    params![&like],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            daily_metrics.push(DailyMetric {
                date: d.format("%m.%d").to_string(),
                sent,
                replies,
                positive,
                booked,
            });
        }

        // Per-search performance
        let mut search_stats = Vec::new();
        let mut stmt = conn
            .prepare(
                r#"
                SELECT s.id, s.name,
                       COUNT(DISTINCT sl.lead_id) as leads_count,
                       COALESCE(AVG(l.fit_score), 0.0) as avg_fit,
                       SUM(CASE WHEN l.enriched = 1 THEN 1 ELSE 0 END) as enriched_count,
                       SUM(CASE WHEN l.status IN ('replied','booked','won') THEN 1 ELSE 0 END) as replied_count,
                       SUM(CASE WHEN l.status IN ('booked','won') THEN 1 ELSE 0 END) as booked_count
                FROM searches s
                LEFT JOIN search_leads sl ON sl.search_id = s.id
                LEFT JOIN leads l ON l.id = sl.lead_id
                GROUP BY s.id
                ORDER BY leads_count DESC
                "#,
            )
            .map_err(|e| e.to_string())?;
        let srows = stmt
            .query_map([], |r| {
                Ok(SearchStat {
                    search_id: r.get(0)?,
                    search_name: r.get(1)?,
                    leads_count: r.get(2)?,
                    avg_fit_score: ((r.get::<_, f64>(3)? * 10.0).round()) / 10.0,
                    enriched_count: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
                    replied_count: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
                    booked_count: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
                })
            })
            .map_err(|e| e.to_string())?;
        for r in srows {
            search_stats.push(r.map_err(|e| e.to_string())?);
        }

        // Recent activity
        let mut recent_activity = Vec::new();
        let mut astmt = conn
            .prepare("SELECT id, kind, title, detail, lead_id, created_at FROM activity_log ORDER BY created_at DESC LIMIT 18")
            .map_err(|e| e.to_string())?;
        let arows = astmt
            .query_map([], |r| {
                Ok(ActivityItem {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    title: r.get(2)?,
                    detail: r.get(3)?,
                    lead_id: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in arows {
            recent_activity.push(r.map_err(|e| e.to_string())?);
        }

        Ok(AnalyticsOverview {
            total_projects,
            total_searches,
            total_leads,
            promising_leads,
            enriched_leads,
            leads_with_email,
            avg_fit_score: (avg_fit_score * 10.0).round() / 10.0,
            total_sent,
            total_failed,
            total_replies,
            positive_replies,
            booking_links_sent,
            booked_leads,
            unsubscribed_count,
            delivery_rate,
            reply_rate,
            positive_rate,
            booking_rate,
            funnel,
            daily_metrics,
            search_stats,
            recent_activity,
        })
    }

    pub fn clear_all_data(&self) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "DELETE FROM email_messages; DELETE FROM campaigns; DELETE FROM search_leads; DELETE FROM searches; DELETE FROM leads; DELETE FROM offers; DELETE FROM projects; DELETE FROM activity_log; DELETE FROM suppression_list;",
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_lead_can_have_separate_conversations() {
        let db_path = std::env::temp_dir().join(format!("mylead-test-{}.sqlite", Uuid::new_v4()));
        let db = Database::open(&db_path).unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1','P','2026-01-01','2026-01-01')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO leads (id, company_name, primary_email, created_at, updated_at) VALUES ('l1','Acme','a@acme.hu','2026-01-01','2026-01-01')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO campaigns (id, name, project_id, created_at, updated_at) VALUES ('c1','C','p1','2026-01-01','2026-01-01')",
                [],
            )
            .unwrap();
        }

        // Campaign conversation: outbound, inbound reply with a changed scope,
        // then a pending AI answer.
        db.insert_email_message_full(
            Some("c1"), "l1", "outbound", "sent", 1, "Outreach A", "Hello",
            Some("<out-1@acme.hu>"), None, None, None, false,
            Some("2026-01-01T10:00:00Z"), None, None, None, None,
        )
        .unwrap();
        db.insert_email_message_full(
            None, "l1", "inbound", "received", 1, "Re: Outreach A", "Hi",
            Some("<in-1@acme.hu>"), Some("<out-1@acme.hu>"), Some("interested"),
            Some("Reply"), false, Some("2026-01-01T11:00:00Z"), None, None, None, None,
        )
        .unwrap();
        db.insert_email_message_full(
            None, "l1", "outbound", "draft", 2, "Re: Outreach A", "Draft",
            None, Some("<in-1@acme.hu>"), None, None, false, None, None,
            Some("paused"), None, None,
        )
        .unwrap();

        // Independent direct conversation with the same person.
        db.insert_email_message_full(
            None, "l1", "outbound", "sent", 1, "Direct B", "Yo",
            Some("<out-2@acme.hu>"), None, None, None, false,
            Some("2026-01-02T10:00:00Z"), None, None, None, None,
        )
        .unwrap();
        db.insert_email_message_full(
            None, "l1", "inbound", "received", 1, "Re: Direct B", "Hey",
            Some("<in-2@acme.hu>"), Some("<out-2@acme.hu>"), None, None, false,
            Some("2026-01-02T11:00:00Z"), None, None, None, None,
        )
        .unwrap();

        let threads = db.list_inbox_threads().unwrap();
        assert_eq!(threads.len(), 2, "the two conversations must be separate");

        let campaign_thread = threads
            .iter()
            .find(|t| t.campaign_id.as_deref() == Some("c1"))
            .expect("campaign conversation");
        assert_eq!(campaign_thread.messages.len(), 3);
        assert!(campaign_thread.has_pending_draft);
        assert!(campaign_thread.pending_reply_id.is_some());

        let direct_thread = threads
            .iter()
            .find(|t| t.campaign_id.is_none())
            .expect("direct conversation");
        assert_eq!(direct_thread.messages.len(), 2);
        assert!(!direct_thread.has_pending_draft);
        assert_ne!(campaign_thread.thread_key, direct_thread.thread_key);

        std::fs::remove_file(&db_path).ok();
    }
}
