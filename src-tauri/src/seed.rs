use crate::db::Database;
use crate::models::*;
use chrono::{Duration, Utc};
use rusqlite::params;
use uuid::Uuid;

pub fn seed_demo_workspace(db: &Database) -> Result<(), String> {
    let existing = db.list_projects()?;
    if !existing.is_empty() {
        return Err("A munkaterület már tartalmaz adatokat. Ha újra szeretnéd tölteni a mintaadatokat, előbb töröld az adatbázist a Beállításokban.".to_string());
    }

    // 1. Project + Offers
    let proj = db.save_project(ProjectInput {
        id: None,
        name: "FoglaljPro SaaS".to_string(),
        website_url: "https://foglaljpro.hu".to_string(),
        industry: "B2B SaaS / Online időpontfoglalás & CRM".to_string(),
        language: "hu".to_string(),
        description: "Automatizált online időpontfoglaló, SMS emlékeztető és páciens-visszahívó rendszer magánklinikáknak, fogászatoknak és szépségszalonoknak.".to_string(),
        booking_url: "https://cal.com/foglaljpro/15perc-demo".to_string(),
        landing_url: "https://foglaljpro.hu/klinikaknak".to_string(),
        value_proposition: Some("38%-kal kevesebb lemondott időpont és 0–24 órás online páciensfoglalás telefonos recepció-terhelés nélkül.".to_string()),
        target_audience: Some("5–50 fős magán fogászati klinikák, esztétikai rendelők és orvosi központok Magyarországon.".to_string()),
        pain_points_solved: Some(vec![
            "Munkaidőn kívül érkező páciensek nem tudnak időpontot foglalni, így a konkurenciához mennek".into(),
            "Túlterhelt recepció a folyamatos telefonos visszahívások és átütemezések miatt".into(),
            "Magas no-show (meg nem jelenés) arány automatikus SMS emlékeztető hiányában".into(),
        ]),
        pitch_angles: Some(vec![
            "Weboldal-audit: megmutatjuk, hány pácienst veszítenek jelenleg online foglaló nélkül".into(),
            "30 napos kockázatmentes próba + ingyenes beüzemelés a meglévő weboldalra".into(),
            "Automatikus 24 órás SMS emlékeztetővel akár havi 400–800 ezer Ft kieső bevétel menthető meg".into(),
        ]),
        objection_handlers: Some(vec![
            "„A pácienseink szeretnek telefonálni” → A telefonos foglalás megmarad, de az esti és hétvégi érdeklődők 42%-a online foglalna.".into(),
            "„Nincs időnk új rendszert bevezetni” → 48 órán belül mi kötjük be a meglévő oldalukra, 0 fejlesztési munkával.".into(),
        ]),
    })?;

    db.update_project_ai_profile(
        &proj.id,
        &proj.value_proposition,
        &proj.target_audience,
        &proj.pain_points_solved,
        &proj.pitch_angles,
        &proj.objection_handlers,
        "Feltérképezve 5 aloldal (foglaljpro.hu, /arak, /funkciok, /esettanulmanyok, /kapcsolat). Erős ROI-fókusz, gyors bevezetés, kész integrációk WordPress és egyedi oldalakra.",
        5,
    )?;

    let offer1 = db.save_offer(OfferInput {
        id: None,
        project_id: proj.id.clone(),
        title: "30 napos ingyenes próba + 25% kedvezmény az első félévre".to_string(),
        offer_type: "discount".to_string(),
        discount_value: "-25% + 30 nap ingyen".to_string(),
        description: "Teljes körű díjmentes beüzemelés a weboldalra, 100 ingyenes SMS emlékeztető kredit és 25% havidíj-kedvezmény 6 hónapon át.".to_string(),
        cta_text: "15 perces élő demó igénylése".to_string(),
        conditions: "Új partnerklinikák számára, a hónap végéig.".to_string(),
        active: true,
    })?;

    let _offer2 = db.save_offer(OfferInput {
        id: None,
        project_id: proj.id.clone(),
        title: "Ingyenes Konverziós & Foglalási Audit Videó".to_string(),
        offer_type: "audit".to_string(),
        discount_value: "0 Ft (értéke 45 000 Ft)".to_string(),
        description: "3 perces személyre szabott videós elemzés a rendelő weboldaláról, 3 azonnali konverzió-növelő javaslattal.".to_string(),
        cta_text: "Kérem az ingyenes auditot".to_string(),
        conditions: "Kötelezettségmentes.".to_string(),
        active: true,
    })?;

    // 2. Searches
    let search1 = db.save_search(SearchJobInput {
        id: None,
        project_id: proj.id.clone(),
        offer_id: Some(offer1.id.clone()),
        name: "Budapesti fogászatok — online foglaló hiánya".to_string(),
        query: "fogászati klinika".to_string(),
        industry: "Fogászat / Magánklinika".to_string(),
        location: "Budapest".to_string(),
        company_size: "11-50".to_string(),
        target_problem: "Nincs valós idejű online időpontfoglalás a weboldalon, csak telefonszám vagy statikus űrlap".to_string(),
        source: "smart_hybrid".to_string(),
        max_results: 20,
        auto_audit: true,
        auto_enrich_threshold: 72,
    })?;
    db.set_search_status(&search1.id, "completed", None)?;

    let search2 = db.save_search(SearchJobInput {
        id: None,
        project_id: proj.id.clone(),
        offer_id: Some(offer1.id.clone()),
        name: "Győri & Nyugat-dunántúli esztétikai rendelők".to_string(),
        query: "bőrgyógyászat esztétikai klinika".to_string(),
        industry: "Esztétikai rendelő".to_string(),
        location: "Győr".to_string(),
        company_size: "1-10".to_string(),
        target_problem: "Hiányzó automatikus páciens-visszahívás és gyenge mobil konverzió".to_string(),
        source: "smart_hybrid".to_string(),
        max_results: 15,
        auto_audit: true,
        auto_enrich_threshold: 70,
    })?;
    db.set_search_status(&search2.id, "completed", None)?;

    // 3. Realistic Leads
    let demo_leads = vec![
        (
            &search1.id,
            "DunaDent Implantációs Központ",
            "https://dunadent-klinika.hu",
            "Fogászati klinika",
            "Budapest",
            "1137 Budapest, Pozsonyi út 42.",
            "+36 1 329 4410",
            "vezetoseg@dunadent-klinika.hu",
            Some(4.8),
            Some(214),
            92,
            "booked",
            true,
            "18–25 fő (6 fogorvos, 2 recepciós)",
            "Prémium implantációs és esztétikai fogászat Újlipótvárosban, erős Google értékelésekkel, de kizárólag telefonos időpontegyeztetéssel.",
            vec![
                "Nincs online időpontfoglaló a weboldalon — csak telefon és visszahívás kérés".into(),
                "Esti/hétvégi Google Ads kattintások jelentős része konverzió nélkül távozik".into(),
                "Hiányzó élő chat és gyors árajánlat-előszűrés".into(),
            ],
            "A FoglaljPro 0–24 online naptárával és automatikus SMS emlékeztetőivel várhatóan havi 25–35 új esti foglalás menthető meg és drasztikusan csökken a recepció leterheltsége.",
            "Hivatkozz a 4.8-as Google értékelésükre és a Pozsonyi úti rendelő nagy forgalmára, majd mutass rá, hogy munkaidő után nem lehet online foglalni.",
            vec!["WordPress".into(), "Google Ads".into()],
            false,
        ),
        (
            &search1.id,
            "BudaSmile Fogászati Rendelő",
            "https://budasmile.hu",
            "Fogászati rendelő",
            "Budapest",
            "1024 Budapest, Margit körút 58.",
            "+36 30 512 8890",
            "info@budasmile.hu",
            Some(4.6),
            Some(128),
            86,
            "replied",
            true,
            "10–15 fő (4 kezelőszék)",
            "Családias budai fogászat fogszabályozással és szájsebészettel. Régebbi WordPress oldal, lassú mobil betöltéssel.",
            vec![
                "Lassú mobil betöltés (3.4 mp) és nehézkes kapcsolatfelvételi űrlap".into(),
                "Nincs online időpontfoglaló modul".into(),
                "Hiányzik a GA4 konverziómérés az űrlapküldéseken".into(),
            ],
            "Beágyazható mobilbarát foglaló widget + 30 napos díjmentes próba, amivel már az első hónapban mérhető a plusz páciensszám.",
            "Emeld ki, hogy a fogszabályozási konzultációkra tipikusan este keresnek a szülők — az online foglaló azonnal behúzza őket.",
            vec!["WordPress".into(), "Contact Form 7".into()],
            false,
        ),
        (
            &search1.id,
            "Pannónia Dental Studio",
            "https://pannoniadental.hu",
            "Fogászati klinika",
            "Budapest",
            "1114 Budapest, Bartók Béla út 31.",
            "+36 1 466 1920",
            "recepcio@pannoniadental.hu",
            Some(4.9),
            Some(94),
            81,
            "in_campaign",
            true,
            "12–20 fő",
            "Modern újbudai rendelő, szép arculattal, de az időpontkérés még mindig manuális e-mailes visszaigazolással működik.",
            vec![
                "Manuális e-mailes időpontkérés (átlag 18 órás válaszidő)".into(),
                "Nincs automatikus SMS emlékeztető említve".into(),
            ],
            "Azonnali valós idejű naptár-szinkronizálás, így a páciens 30 másodperc alatt foglal, a recepció pedig mentesül az e-mailezéstől.",
            "Rövid, szakmai hangnemben mutasd meg, mennyit gyorsít az azonnali visszaigazolás a konkurens újbudai rendelőkhoz képest.",
            vec!["Webflow".into(), "Google Analytics".into()],
            false,
        ),
        (
            &search1.id,
            "Belvárosi Fogklinika Kft.",
            "https://belvarosifogklinika.hu",
            "Fogászat",
            "Budapest",
            "1052 Budapest, Váci utca 19.",
            "+36 1 266 7811",
            "iroda@belvarosifogklinika.hu",
            Some(4.4),
            Some(167),
            78,
            "enriched",
            true,
            "20–35 fő",
            "Nagy forgalmú V. kerületi magánklinika magyar és külföldi páciensekkel. Hiányzik a kétnyelvű online foglalási lehetőség.",
            vec![
                "Nincs angol/magyar kétnyelvű online időpontfoglaló".into(),
                "Nincs HTTPS átirányítás több aloldalon".into(),
            ],
            "Kétnyelvű (HU/EN) online foglaló felület, ami a külföldi páciensek foglalási rátáját is megemeli.",
            "Fókuszálj a belvárosi külföldi páciensekre, akik telefonálás helyett szinte mindig online foglalnak.",
            vec!["Joomla".into()],
            false,
        ),
        (
            &search2.id,
            "Arrabona Esztétikai Központ",
            "https://arrabona-esztetika.hu",
            "Esztétikai rendelő",
            "Győr",
            "9021 Győr, Baross Gábor út 22.",
            "+36 96 411 230",
            "kapcsolat@arrabona-esztetika.hu",
            Some(4.7),
            Some(83),
            84,
            "replied",
            true,
            "8–12 fő",
            "Győri bőrgyógyászati és lézeres esztétikai klinika osztrák határmenti vendégkörrel is.",
            vec![
                "Nincs online időpontfoglaló a kezelésekhez".into(),
                "Hiányzó német nyelvű foglalási folyamat az osztrák ügyfeleknek".into(),
            ],
            "Többnyelvű foglaló rendszer és automatikus előleg-emlékeztető a nagy értékű lézeres kezelésekhez.",
            "Emeld ki a győri + osztrák vendégkört és a 25%-os induló kedvezményt.",
            vec!["WordPress".into(), "Elementor".into()],
            false,
        ),
        (
            &search2.id,
            "MosonMed Bőrgyógyászat",
            "https://mosonmed.hu",
            "Magánrendelő",
            "Győr",
            "9022 Győr, Batthyány tér 4.",
            "+36 30 778 1204",
            "rendelo@mosonmed.hu",
            Some(4.5),
            Some(46),
            74,
            "promising",
            false,
            "5–10 fő",
            "Privát bőrgyógyászati és allergológiai rendelő Győr belvárosában.",
            vec![
                "Nem mobilbarát időpontkérő aloldal".into(),
                "Nincs online naptár integráció".into(),
            ],
            "Gyorsan beágyazható mobilbarát foglaló widget a 30 napos próbaidőszakkal.",
            "Rövid, konkrét javaslat a mobil élmény javítására.",
            vec!["Wix".into()],
            false,
        ),
        (
            &search1.id,
            "Kertvárosi Fogászat Bt.",
            "https://kertvarosifogas.hu",
            "Fogászat",
            "Budapest",
            "1163 Budapest, Veres Péter út 88.",
            "+36 1 403 1122",
            "info@kertvarosifogas.hu",
            Some(4.2),
            Some(31),
            58,
            "new",
            false,
            "1–5 fő",
            "Kisebb XVI. kerületi fogászati rendelő, már használ egy egyszerű foglalási űrlapot.",
            vec!["Alapszintű űrlap, nincs automatikus SMS emlékeztető".into()],
            "SMS no-show csökkentő modul és egyszerűbb pácienskezelés.",
            "Alacsonyabb prioritású, de a 30 napos ingyenes próba vonzó lehet.",
            vec!["WordPress".into()],
            true,
        ),
    ];

    let mut lead_ids = Vec::new();
    for (
        sid, name, url, ind, loc, addr, phone, email, rating, reviews, score, status, enriched,
        emp, summary, pains, help, pitch, tech, has_booking,
    ) in demo_leads
    {
        let lid = db.upsert_discovered_lead(
            Some(sid), name, url, ind, loc, addr, phone, email, rating, reviews, "Google Maps (Places API)",
        )?;
        let audit = WebsiteAudit {
            reachable: true,
            status_code: Some(200),
            has_https: true,
            load_time_ms: if score > 80 { 2950 } else { 1420 },
            has_mobile_viewport: score != 74,
            title: format!("{} — Hivatalos weboldal", name),
            meta_description: summary.to_string(),
            has_analytics: tech.contains(&"Google Analytics".to_string()),
            has_chat_widget: false,
            has_booking_system: has_booking,
            has_contact_form: true,
            tech_stack: tech.clone(),
            detected_issues: pains.clone(),
            extracted_emails: vec![email.to_string()],
            extracted_phones: vec![phone.to_string()],
            social_links: vec![],
            pages_crawled: if enriched { 5 } else { 1 },
            audited_at: Utc::now().to_rfc3339(),
            overall_score: if score > 80 { 54 } else { 68 },
            score_seo: 66,
            score_ux_mobile: if score == 74 { 45 } else { 62 },
            score_conversion: if has_booking { 72 } else { 38 },
            score_trust: 78,
            html_size_kb: 184,
            h1_count: 1,
            h1_text: name.to_string(),
            image_count: 14,
            images_missing_alt: 6,
            has_og_tags: true,
            has_canonical: true,
            has_structured_data: false,
            has_pricing_signals: true,
            has_testimonials: true,
            has_gdpr_privacy: true,
            has_multilingual: false,
            has_cta_signals: true,
            copyright_year: Some(if score > 84 { 2021 } else { 2025 }),
            strengths: vec![
                "Érvényes HTTPS / SSL titkosítás".into(),
                "Átlátható ár / csomag kommunikáció".into(),
            ],
        };
        let contacts = vec![LeadContact {
            name: format!("{} Vezetőség", name),
            role: "Ügyvezető / Rendelővezető".to_string(),
            email: email.to_string(),
            phone: phone.to_string(),
            source: "Weboldal impresszum".to_string(),
        }];
        db.update_lead_enrichment(
            &lid, score, status, enriched, emp, summary, &pains, help, pitch, &tech, &contacts,
            Some(email), Some(phone), Some(&audit),
        )?;
        // Also ensure exact status (since update_lead_enrichment preserves terminal statuses)
        let _ = db.update_lead_fields(LeadUpdateInput {
            id: lid.clone(),
            status: Some(status.to_string()),
            tags: Some(vec![loc.to_string(), "Magánklinika".to_string()]),
            ..Default::default()
        });
        lead_ids.push(lid);
    }

    // 4. Demo Sender Account (SMTP)
    let sender = db.save_sender_account(SenderAccountInput {
        id: None,
        name: "FoglaljPro SMTP (Minta)".to_string(),
        provider: "smtp".to_string(),
        from_name: "Kovács Márton — FoglaljPro".to_string(),
        from_email: "marton@foglaljpro.hu".to_string(),
        reply_to: "marton@foglaljpro.hu".to_string(),
        smtp_host: "smtp.postmarkapp.com".to_string(),
        smtp_port: 587,
        smtp_username: "".to_string(),
        smtp_password: "".to_string(),
        smtp_security: "starttls".to_string(),
        ses_region: "eu-central-1".to_string(),
        ses_access_key: "".to_string(),
        ses_secret_key: "".to_string(),
        daily_limit: 50,
        imap_host: "imap.gmail.com".to_string(),
        imap_port: 993,
        imap_username: "".to_string(),
        imap_password: "".to_string(),
        imap_enabled: false,
        is_default: true,
    })?;

    // 5. Campaign + Realistic Outreach & Reply Threads spanning recent days
    let camp = db.create_campaign(&CampaignInput {
        id: None,
        name: "Budapest Fogászatok Q4 — Online Foglaló Kampány".to_string(),
        project_id: proj.id.clone(),
        offer_id: Some(offer1.id.clone()),
        search_id: Some(search1.id.clone()),
        sender_account_id: Some(sender.id.clone()),
        tone: "professional_formal".to_string(),
        language: "hu".to_string(),
        auto_reply_mode: "draft".to_string(),
        daily_limit: 35,
        min_delay_sec: 45,
        follow_up_days: 3,
        include_booking_link: false,
        custom_instructions: "Hivatkozz a konkrét weboldal-audit megállapításokra, kerüld a túlzó reklámszöveget.".to_string(),
        lead_ids: vec![],
    })?;
    db.update_campaign_status(&camp.id, "active")?;

    let now = Utc::now();
    let d_minus = |days: i64, hours: i64| (now - Duration::days(days) - Duration::hours(hours)).to_rfc3339();

    // Thread 1: DunaDent — Outbound -> Booking request -> Auto reply with Cal.com link!
    let m1 = db.insert_email_message(
        Some(&camp.id), &lead_ids[0], "outbound", "sent", 1,
        "DunaDent Implantációs Központ — rövid észrevétel a foglalási folyamatról",
        "Tisztelt DunaDent Vezetőség!\n\nÁtnéztem a dunadent-klinika.hu oldalt és láttam a kiemelkedő 4.8-as Google értékelésüket. Egy konkrét dolog tűnt fel: munkaidőn kívül jelenleg nem tudnak a páciensek közvetlenül időpontot foglalni, csak telefonon vagy visszahívás kéréssel.\n\nA FoglaljPro rendszerrel 48 óra alatt beépíthető egy 0–24 órás online naptár és automatikus SMS emlékeztető, amivel partnerklinikáink 38%-kal csökkentették a lemondásokat.\n\nJelenleg 30 napos ingyenes próbát és 25% kedvezményt adunk az első félévre.\nBővebben: https://foglaljpro.hu/klinikaknak\n\nHa nyitottak egy 15 perces bemutatóra, elég egy rövid válasz erre a levélre.\n\nÜdvözlettel,\nKovács Márton",
        Some("<msg-dunadent-1@foglaljpro.hu>"), None, None, None, false, Some(&d_minus(4, 3)),
    )?;
    let _ = m1;
    db.insert_email_message(
        Some(&camp.id), &lead_ids[0], "inbound", "received", 1,
        "Re: DunaDent Implantációs Központ — rövid észrevétel a foglalási folyamatról",
        "Üdvözlöm Márton!\n\nPont most keressük a megoldást erre, mert a recepciósaink alig győzik a hétfő reggeli visszahívásokat. Mikor tudnánk egy 15 perces online demót tartani a héten?\n\nKöszönettel,\nDr. Szabó Gábor",
        Some("<msg-dunadent-reply-1@dunadent-klinika.hu>"), Some("<msg-dunadent-1@foglaljpro.hu>"),
        Some("booking_request"), None, false, Some(&d_minus(3, 5)),
    )?;
    db.insert_email_message(
        Some(&camp.id), &lead_ids[0], "outbound", "sent", 2,
        "Re: DunaDent Implantációs Központ — rövid észrevétel a foglalási folyamatról",
        "Tisztelt Dr. Szabó Gábor!\n\nNagyon örülök, hogy aktuális a téma! Itt tud közvetlenül egy Önnek megfelelő 15 perces időpontot foglalni a bemutatóra:\nhttps://cal.com/foglaljpro/15perc-demo\n\nA híváson élőben megmutatom, hogyan illeszkedik a foglaló a dunadent-klinika.hu oldalba, és hogyan működik a 30 napos díjmentes próba.\n\nÜdvözlettel,\nKovács Márton",
        Some("<msg-dunadent-2@foglaljpro.hu>"), Some("<msg-dunadent-reply-1@dunadent-klinika.hu>"),
        None, None, true, Some(&d_minus(3, 4)),
    )?;

    // Thread 2: BudaSmile — Outbound -> Question inbound with AI suggested draft waiting for approval!
    db.insert_email_message(
        Some(&camp.id), &lead_ids[1], "outbound", "sent", 1,
        "BudaSmile — mobil foglalás és 30 napos ingyenes próba",
        "Tisztelt BudaSmile Csapat!\n\nA budasmile.hu oldal átvizsgálásakor láttam, hogy mobilon viszonylag lassan tölt be az űrlap, és még nincs közvetlen naptáras időpontfoglalás. A fogszabályozási konzultációkra érkező szülők nagy része este telefonról böngészik.\n\nA FoglaljPro 30 napig díjmentesen tesztelhető, 25% kedvezménnyel az első félévre: https://foglaljpro.hu/klinikaknak\n\nÉrdekelheti Önöket egy rövid bemutató?\n\nÜdvözlettel,\nKovács Márton",
        Some("<msg-budasmile-1@foglaljpro.hu>"), None, None, None, false, Some(&d_minus(2, 6)),
    )?;
    db.insert_email_message(
        Some(&camp.id), &lead_ids[1], "inbound", "received", 1,
        "Re: BudaSmile — mobil foglalás és 30 napos ingyenes próba",
        "Szia Márton,\n\nÉrdekesnek hangzik. Meg tudod mondani, hogy mennyibe kerül pontosan 4 kezelőszékre a próba után, és összeköthető-e Google Naptárral?\n\nÜdv,\nTóth Eszter",
        Some("<msg-budasmile-reply-1@budasmile.hu>"), Some("<msg-budasmile-1@foglaljpro.hu>"),
        Some("question"),
        Some("Szia Eszter!\n\nKöszönöm az érdeklődést! Igen, a FoglaljPro kétirányú szinkronban működik a Google Naptárral (minden kezelőszékhez / orvoshoz külön naptár köthető).\n\n4 kezelőszék esetén a csomag listaára 39 900 Ft/hó, amiből a 30 napos ingyenes próba után az első 6 hónapra 25% kedvezményt adunk (29 925 Ft/hó), rejtett beüzemelési díj nélkül.\n\nA pontos csomagokat itt is megnézheted: https://foglaljpro.hu/klinikaknak\n\nHa kényelmesebb, 10 percben megmutatom élőben a Google Naptár összekötést — itt tudsz időpontot választani:\nhttps://cal.com/foglaljpro/15perc-demo\n\nÜdvözlettel,\nKovács Márton"),
        false, Some(&d_minus(1, 2)),
    )?;

    // Thread 3: Arrabona Esztétika — Outbound -> Interested inbound with AI draft!
    db.insert_email_message(
        Some(&camp.id), &lead_ids[4], "outbound", "sent", 1,
        "Arrabona Esztétikai Központ — kétnyelvű online időpontfoglalás",
        "Tisztelt Arrabona Esztétikai Központ!\n\nLáttam, hogy Győrben kiemelkedő értékelésekkel dolgoznak, és sok osztrák páciensük is van, viszont a weboldalon még nincs közvetlen online foglaló. A FoglaljPro magyarul és németül is működik, SMS emlékeztetővel.\n\nRészletek és 25% induló kedvezmény: https://foglaljpro.hu/klinikaknak\n\nÜdvözlettel,\nKovács Márton",
        Some("<msg-arrabona-1@foglaljpro.hu>"), None, None, None, false, Some(&d_minus(1, 8)),
    )?;
    db.insert_email_message(
        Some(&camp.id), &lead_ids[4], "inbound", "received", 1,
        "Re: Arrabona Esztétikai Központ — kétnyelvű online időpontfoglalás",
        "Tisztelt Kovács Márton!\n\nA német nyelvű online foglaló és az SMS emlékeztető valóban nagyon aktuális nálunk. Szívesen megnéznénk egy bemutatót jövő hét kedden vagy szerdán!\n\nÜdvözlettel,\nVarga Zsófia",
        Some("<msg-arrabona-reply-1@arrabona-esztetika.hu>"), Some("<msg-arrabona-1@foglaljpro.hu>"),
        Some("booking_request"),
        Some("Tisztelt Varga Zsófia!\n\nNagyon örülök a visszajelzésének! Keddre és szerdára is van szabad sávom — az alábbi linken egy kattintással ki tudják választani a legkényelmesebb 15 perces időpontot:\nhttps://cal.com/foglaljpro/15perc-demo\n\nA bemutatón kifejezetten a német–magyar kétnyelvű foglalót és az automatikus SMS emlékeztetőt is megmutatom. Addig is a részletek itt elérhetők: https://foglaljpro.hu/klinikaknak\n\nÜdvözlettel,\nKovács Márton"),
        false, Some(&d_minus(0, 3)),
    )?;

    // Thread 4: Pannónia Dental — Outbound sent, awaiting reply
    db.insert_email_message(
        Some(&camp.id), &lead_ids[2], "outbound", "sent", 1,
        "Pannónia Dental Studio — azonnali online időpontfoglalás a weboldalra",
        "Tisztelt Pannónia Dental Studio!\n\nNagyon igényes a pannoniadental.hu oldaluk, ugyanakkor láttam, hogy az időpontkérés jelenleg manuális visszaigazolással működik. A FoglaljPro-val a páciensek 30 másodperc alatt valós időben foglalhatnak.\n\nRészletek: https://foglaljpro.hu/klinikaknak\n\nÜdvözlettel,\nKovács Márton",
        Some("<msg-pannonia-1@foglaljpro.hu>"), None, None, None, false, Some(&d_minus(0, 5)),
    )?;

    // Draft waiting for Belvárosi Fogklinika
    db.insert_email_message(
        Some(&camp.id), &lead_ids[3], "outbound", "draft", 1,
        "Belvárosi Fogklinika — HU/EN online foglaló a Váci utcai rendelőbe",
        "Tisztelt Belvárosi Fogklinika Vezetőség!\n\nA belvarosifogklinika.hu áttekintésekor feltűnt, hogy a belvárosi elhelyezkedés ellenére még nincs kétnyelvű (magyar/angol) online időpontfoglalási lehetőség az oldalon.\n\nA FoglaljPro 30 napos díjmentes próbával és 25% kedvezménnyel segít növelni a külföldi és esti foglalásokat: https://foglaljpro.hu/klinikaknak\n\nNyitottak lennének egy 15 perces bemutatóra?\n\nÜdvözlettel,\nKovács Márton",
        None, None, None, None, false, None,
    )?;

    // Extra activity log entries
    {
        let conn = db.conn.lock().unwrap();
        let acts = vec![
            ("booking", "Időpontfoglaló link kiküldve", "DunaDent Implantációs Központ — Cal.com link automatikusan elküldve", Some(lead_ids[0].as_str()), d_minus(3, 4)),
            ("reply", "Új beérkező válasz (Időpontkérés)", "Arrabona Esztétikai Központ: bemutatót kér jövő hétre", Some(lead_ids[4].as_str()), d_minus(0, 3)),
            ("reply", "Új beérkező válasz (Kérdés)", "BudaSmile: árazás és Google Naptár integráció iránt érdeklődik", Some(lead_ids[1].as_str()), d_minus(1, 2)),
            ("campaign", "Kampány elindítva", "Budapest Fogászatok Q4 — 4 levél sikeresen kézbesítve", None, d_minus(2, 6)),
            ("search", "Keresés befejezve", "Budapesti fogászatok — 5 cég auditálva, 4 ígéretes (Fit ≥ 72)", None, d_minus(4, 6)),
            ("project", "Weboldal feltérképezve", "FoglaljPro SaaS — 5 oldal elemezve, marketing profil kész", None, d_minus(5, 2)),
        ];
        for (kind, title, detail, lid, ts) in acts {
            let _ = conn.execute(
                "INSERT INTO activity_log (id, kind, title, detail, lead_id, created_at) VALUES (?1,?2,?3,?4,?5,?6)",
                params![Uuid::new_v4().to_string(), kind, title, detail, lid, ts],
            );
        }
    }

    Ok(())
}
