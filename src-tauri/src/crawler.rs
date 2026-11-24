use crate::models::WebsiteAudit;
use chrono::{Datelike, Utc};
use regex::Regex;
use reqwest::Client;
use scraper::{Html, Selector};
use std::collections::HashSet;
use std::time::{Duration, Instant};
use url::Url;

#[derive(Debug, Clone)]
pub struct CrawledSiteData {
    pub final_url: String,
    pub pages_crawled: i64,
    pub combined_text: String,
    pub titles: Vec<String>,
    pub headings: Vec<String>,
    pub meta_description: String,
    pub audit: WebsiteAudit,
}

pub fn normalize_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    };
    Url::parse(&with_scheme).ok().map(|u| u.to_string())
}

pub fn extract_domain(raw: &str) -> String {
    normalize_url(raw)
        .and_then(|u| Url::parse(&u).ok())
        .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_lowercase()))
        .unwrap_or_default()
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(11))
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| format!("HTTP kliens hiba: {}", e))
}

fn extract_clean_text(doc: &Html) -> String {
    let body_sel = Selector::parse("body").unwrap();
    let skip_tags = [
        "script", "style", "noscript", "svg", "iframe", "header", "footer", "nav", "aside",
    ];
    // Sablon-zaj: süti-sávok, felugrók, átfedő rétegek — ezek minden aloldalon
    // ismétlődnének, és elnyomnák a valódi tartalmat az AI-elemzés elől.
    const BOILERPLATE_CLASS: &[&str] = &[
        "cookie", "suti", "consent", "popup", "modal", "overlay", "offcanvas", "toast",
        "snackbar",
    ];
    let mut parts = Vec::new();
    if let Some(body) = doc.select(&body_sel).next() {
        for node in body.descendants() {
            if let Some(text) = node.value().as_text() {
                let mut skip = false;
                let mut parent = node.parent();
                while let Some(p) = parent {
                    if let Some(el) = p.value().as_element() {
                        if skip_tags.contains(&el.name()) {
                            skip = true;
                            break;
                        }
                        let class_id = format!(
                            "{} {}",
                            el.attr("class").unwrap_or_default(),
                            el.attr("id").unwrap_or_default()
                        )
                        .to_lowercase();
                        if BOILERPLATE_CLASS.iter().any(|b| class_id.contains(b)) {
                            skip = true;
                            break;
                        }
                    }
                    parent = p.parent();
                }
                if !skip {
                    let t = text.trim();
                    if t.len() >= 2 {
                        parts.push(t.to_string());
                    }
                }
            }
        }
    }
    let joined = parts.join(" ");
    let ws = Regex::new(r"\s+").unwrap();
    ws.replace_all(&joined, " ").trim().to_string()
}

/// Megállapítja, hogy egy aloldal-kivonat túlnyomórészt olyan szöveg-e, ami
/// már szerepel az eddig gyűjtött tartalomban (menü / lábléc / sablonismétlés).
/// Ilyenkor az aloldal szövegét nem fűzzük hozzá, hogy a 12 000 karakteres
/// keretbe valódi, egyedi tartalom kerüljön az AI-elemzéshez.
fn is_boilerplate_repeat(snippet: &str, collected: &str) -> bool {
    let words: Vec<&str> = snippet.split_whitespace().collect();
    if words.len() < 30 || collected.len() < 200 {
        return false;
    }
    let mut total = 0usize;
    let mut dup = 0usize;
    let mut i = 0;
    while i + 25 <= words.len() {
        let window = words[i..i + 25].join(" ");
        total += 1;
        if collected.contains(&window) {
            dup += 1;
        }
        i += 12;
    }
    if total == 0 {
        return false;
    }
    dup * 100 / total >= 55
}

fn decode_cfemail(hex: &str) -> Option<String> {
    if hex.len() < 6 || hex.len() % 2 != 0 {
        return None;
    }
    let key = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let mut bytes = Vec::with_capacity((hex.len() - 2) / 2);
    let mut idx = 2;
    while idx + 2 <= hex.len() {
        let b = u8::from_str_radix(&hex[idx..idx + 2], 16).ok()?;
        bytes.push(b ^ key);
        idx += 2;
    }
    let decoded = String::from_utf8(bytes).ok()?;
    if decoded.contains('@') && decoded.contains('.') {
        Some(decoded.trim().to_lowercase())
    } else {
        None
    }
}

fn normalize_obfuscated_emails(input: &str) -> String {
    let mut s = input
        .replace("&#64;", "@")
        .replace("&#x40;", "@")
        .replace("&#X40;", "@")
        .replace("&#46;", ".")
        .replace("&commat;", "@");

    if let Ok(re_at) = Regex::new(r"(?i)\s*(?:\(kukac\)|\[kukac\]|\{kukac\}|\(at\)|\[at\])\s*") {
        s = re_at.replace_all(&s, "@").to_string();
    }
    if let Ok(re_dot) = Regex::new(r"(?i)\s*(?:\(pont\)|\[pont\]|\(dot\)|\[dot\])\s*") {
        s = re_dot.replace_all(&s, ".").to_string();
    }
    s
}

fn extract_emails(text: &str, html: &str, site_domain: &str) -> Vec<String> {
    let re = Regex::new(r"(?i)[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,10}").unwrap();
    let re_cf = Regex::new(r#"data-cfemail=["']([0-9a-fA-F]{6,})["']"#).unwrap();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let blacklist_ext = [
        ".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".css", ".js", ".woff", ".woff2", ".avif",
    ];
    let blacklist_domains = [
        "example.com",
        "sentry.io",
        "wixpress.com",
        "domain.com",
        "email.com",
        "yoursite.com",
        "yourwebpage.com",
        "wordpress.org",
        "w3.org",
        "schema.org",
        "naih.hu",
        "mediacenter.hu",
        "rackforest.com",
        "tarhely.eu",
        "sybell.hu",
        "mhosting.hu",
        "dotroll.com",
        "nethely.hu",
        "posta.hu",
        "nmhh.hu",
        "nav.gov.hu",
        "nkfh.gov.hu",
        "fogyasztovedelem.hu",
        "bekeltetotestulet.hu",
        "guardian.co.uk",
        "theguardian.com",
        "pdfcoffee.com",
    ];

    let mut candidates = Vec::new();
    for cap in re_cf.captures_iter(html) {
        if let Some(m) = cap.get(1) {
            if let Some(dec) = decode_cfemail(m.as_str()) {
                candidates.push(dec);
            }
        }
    }

    let norm_text = normalize_obfuscated_emails(text);
    let norm_html = normalize_obfuscated_emails(html);
    for source in [&norm_text, &norm_html] {
        for cap in re.find_iter(source) {
            candidates.push(cap.as_str().to_lowercase());
        }
    }

    for email in candidates {
        if blacklist_ext.iter().any(|ext| email.ends_with(ext)) {
            continue;
        }
        if blacklist_domains.iter().any(|d| email.ends_with(d) || email.contains(d)) {
            continue;
        }
        if email.len() > 80 || email.starts_with("noreply@") || email.starts_with("no-reply@") {
            continue;
        }
        if seen.insert(email.clone()) {
            out.push(email);
        }
    }

    let site_stem = site_domain
        .trim()
        .trim_start_matches("www.")
        .split('.')
        .next()
        .unwrap_or("")
        .to_lowercase();

    out.sort_by_key(|e| {
        let email_dom = e.split('@').nth(1).unwrap_or("");
        let matches_site = !site_stem.is_empty() && site_stem.len() >= 3 && email_dom.contains(&site_stem);
        let is_primary_prefix = e.starts_with("info@")
            || e.starts_with("iroda@")
            || e.starts_with("kapcsolat@")
            || e.starts_with("hello@")
            || e.starts_with("office@")
            || e.starts_with("jelentkezes@")
            || e.starts_with("kepzes@")
            || e.starts_with("sales@")
            || e.starts_with("recepcio@");
        match (matches_site, is_primary_prefix) {
            (true, true) => 0,
            (true, false) => 1,
            (false, true) => 2,
            (false, false) => 3,
        }
    });
    out.truncate(10);
    out
}

fn extract_phones(text: &str) -> Vec<String> {
    let re = Regex::new(r"(\+36|\+43|\+49|\+44|\+1|06)[\s\-/]?\d{1,3}[\s\-/]?\d{3}[\s\-/]?\d{3,4}").unwrap();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for cap in re.find_iter(text) {
        let p = cap.as_str().trim().to_string();
        if seen.insert(p.clone()) {
            out.push(p);
        }
    }
    out.truncate(5);
    out
}

fn extract_copyright_year(text: &str) -> Option<i64> {
    let re = Regex::new(r"(?i)(?:©|&copy;|copyright)\s*(?:20\d{2}\s*[-–]\s*)?(20\d{2})").unwrap();
    let mut max_year: Option<i64> = None;
    for cap in re.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            if let Ok(y) = m.as_str().parse::<i64>() {
                if (2005..=2030).contains(&y) {
                    max_year = Some(max_year.map_or(y, |cur| cur.max(y)));
                }
            }
        }
    }
    max_year
}

fn detect_tech_and_signals(html_lower: &str, text_lower: &str) -> (Vec<String>, bool, bool, bool, bool) {
    let mut tech = Vec::new();
    let checks: &[(&str, &str)] = &[
        ("wp-content", "WordPress"),
        ("elementor", "Elementor"),
        ("divi", "Divi"),
        ("woocommerce", "WooCommerce"),
        ("cdn.shopify.com", "Shopify"),
        ("wix.com", "Wix"),
        ("squarespace", "Squarespace"),
        ("webflow", "Webflow"),
        ("joomla", "Joomla"),
        ("drupal", "Drupal"),
        ("unas.hu", "UNAS Webshop"),
        ("shoprenter", "Shoprenter"),
        ("next/static", "Next.js"),
        ("react", "React"),
        ("vue", "Vue.js"),
        ("bootstrap", "Bootstrap"),
        ("tailwind", "Tailwind CSS"),
        ("googletagmanager", "Google Tag Manager"),
        ("gtag(", "GA4"),
        ("fbq(", "Meta Pixel"),
        ("clarity.ms", "Microsoft Clarity"),
        ("hotjar", "Hotjar"),
        ("hubspot", "HubSpot"),
        ("klaviyo", "Klaviyo"),
        ("mailchimp", "Mailchimp"),
        ("mailerlite", "MailerLite"),
        ("stripe.com", "Stripe"),
        ("barion", "Barion"),
        ("simplepay", "SimplePay"),
        ("szamlazz.hu", "Számlázz.hu"),
        ("billingo", "Billingo"),
        ("calendly.com", "Calendly"),
        ("cal.com", "Cal.com"),
        ("salonic.hu", "Salonic"),
        ("booked4.us", "Booked4us"),
        ("minup.io", "Minup"),
        ("tawk.to", "Tawk.to Chat"),
        ("crisp.chat", "Crisp Chat"),
        ("intercom", "Intercom"),
        ("smartsupp", "Smartsupp"),
    ];
    for (needle, label) in checks {
        if html_lower.contains(needle) && !tech.contains(&label.to_string()) {
            tech.push(label.to_string());
        }
    }

    let has_analytics = html_lower.contains("googletagmanager")
        || html_lower.contains("gtag(")
        || html_lower.contains("google-analytics")
        || html_lower.contains("fbq(")
        || html_lower.contains("plausible.io")
        || html_lower.contains("hotjar")
        || html_lower.contains("clarity.ms")
        || html_lower.contains("matomo");

    let has_chat = html_lower.contains("intercom")
        || html_lower.contains("tawk.to")
        || html_lower.contains("crisp.chat")
        || html_lower.contains("tidio")
        || html_lower.contains("livechat")
        || html_lower.contains("zendesk")
        || html_lower.contains("smartsupp")
        || html_lower.contains("messenger-chat")
        || html_lower.contains("drift.com")
        || html_lower.contains("freshchat");

    let has_booking = html_lower.contains("calendly.com")
        || html_lower.contains("cal.com")
        || html_lower.contains("booked4.us")
        || html_lower.contains("salonic.hu")
        || html_lower.contains("foglaljorvost")
        || html_lower.contains("minup.io")
        || html_lower.contains("idopontfoglalas")
        || html_lower.contains("book-appointment")
        || html_lower.contains("reservio")
        || html_lower.contains("simplybook")
        || text_lower.contains("online időpontfoglalás")
        || text_lower.contains("foglalj időpontot online");

    let has_form = html_lower.contains("<form");

    (tech, has_analytics, has_chat, has_booking, has_form)
}

fn find_interesting_subpages(doc: &Html, base_url: &Url, max_links: usize) -> Vec<String> {
    let a_sel = Selector::parse("a[href]").unwrap();
    let high_priority = [
        "kapcsolat", "contact", "elerhetoseg", "elérhetőség", "impresszum",
        "jelentkezes", "jelentkezés", "regisztracio", "regisztráció", "idopont", "időpont",
    ];
    let med_priority = [
        "arak", "árak", "arlista", "árlista", "pricing", "szolgaltatas", "szolgáltatás",
        "services", "kepzes", "képzés", "trening", "tréning", "coaching", "tanfolyam",
    ];
    let low_priority = [
        "about", "rolunk", "rólunk", "csapat", "team", "features", "termek", "product",
        "referencia", "velemeny", "adatvedel", "adatkezel", "aszf", "ászf",
    ];
    let base_host = base_url.host_str().unwrap_or_default().trim_start_matches("www.");
    let mut seen = HashSet::new();
    seen.insert(base_url.path().trim_end_matches('/').to_string());
    let mut scored_urls: Vec<(i32, String)> = Vec::new();

    for el in doc.select(&a_sel) {
        if let Some(href) = el.value().attr("href") {
            let trimmed = href.trim();
            if trimmed.starts_with('#')
                || trimmed.starts_with("mailto:")
                || trimmed.starts_with("tel:")
                || trimmed.starts_with("javascript:")
            {
                continue;
            }
            if let Ok(mut resolved) = base_url.join(trimmed) {
                resolved.set_fragment(None);
                let host = resolved.host_str().unwrap_or_default().trim_start_matches("www.");
                let path_lower = resolved.path().to_lowercase();
                if path_lower.ends_with(".pdf")
                    || path_lower.ends_with(".jpg")
                    || path_lower.ends_with(".png")
                    || path_lower.ends_with(".css")
                    || path_lower.ends_with(".js")
                    || path_lower.contains("/wp-content/")
                {
                    continue;
                }
                let text_lower = el.text().collect::<String>().to_lowercase();

                // Allow external privacy/impressum links on owner's sister domain (e.g. drmeszarosadam.hu/adatvedelem on coachkepzes.hu)
                let is_external_legal = host != base_host
                    && (path_lower.contains("adatvedel") || path_lower.contains("impresszum"))
                    && !host.contains("google")
                    && !host.contains("facebook")
                    && !host.contains("cookie");

                if host != base_host && !is_external_legal {
                    continue;
                }

                let priority = if high_priority.iter().any(|k| path_lower.contains(k) || text_lower.contains(k)) {
                    Some(1)
                } else if med_priority.iter().any(|k| path_lower.contains(k) || text_lower.contains(k)) {
                    Some(2)
                } else if low_priority.iter().any(|k| path_lower.contains(k) || text_lower.contains(k)) || is_external_legal {
                    Some(3)
                } else {
                    None
                };

                if let Some(prio) = priority {
                    let dedup_key = format!("{}::{}", host, resolved.path().trim_end_matches('/'));
                    if resolved.path().trim_end_matches('/') != base_url.path().trim_end_matches('/')
                        && seen.insert(dedup_key)
                    {
                        scored_urls.push((prio, resolved.to_string()));
                    }
                }
            }
        }
    }

    scored_urls.sort_by_key(|(prio, _)| *prio);
    scored_urls
        .into_iter()
        .take(max_links)
        .map(|(_, u)| u)
        .collect()
}

fn extract_social_links(doc: &Html) -> Vec<String> {
    let a_sel = Selector::parse("a[href]").unwrap();
    let socials = ["linkedin.com", "facebook.com", "instagram.com", "youtube.com", "tiktok.com", "x.com", "twitter.com"];
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for el in doc.select(&a_sel) {
        if let Some(href) = el.value().attr("href") {
            let lower = href.to_lowercase();
            if socials.iter().any(|s| lower.contains(s)) && seen.insert(href.to_string()) {
                out.push(href.to_string());
            }
        }
    }
    out.truncate(6);
    out
}

pub async fn crawl_website(raw_url: &str, max_subpages: usize) -> Result<CrawledSiteData, String> {
    crawl_website_with_progress(raw_url, max_subpages, |_, _, _| {}).await
}

pub async fn crawl_website_with_progress<F>(
    raw_url: &str,
    max_subpages: usize,
    mut on_page: F,
) -> Result<CrawledSiteData, String>
where
    F: FnMut(usize, usize, &str),
{
    let normalized = normalize_url(raw_url).ok_or_else(|| "Érvénytelen weboldal URL".to_string())?;
    let client = build_client()?;

    on_page(1, max_subpages + 1, &normalized);

    let start = Instant::now();
    let resp = match client.get(&normalized).send().await {
        Ok(r) => r,
        Err(e) => {
            if normalized.starts_with("https://") {
                let http_url = normalized.replacen("https://", "http://", 1);
                client
                    .get(&http_url)
                    .send()
                    .await
                    .map_err(|_| format!("A weboldal nem elérhető: {}", e))?
            } else {
                return Err(format!("A weboldal nem elérhető: {}", e));
            }
        }
    };
    let load_time_ms = start.elapsed().as_millis() as i64;
    let status_code = resp.status().as_u16();
    let final_url = resp.url().to_string();
    let has_https = final_url.starts_with("https://");
    let html = resp.text().await.unwrap_or_default();
    let html_size_kb = (html.len() as i64) / 1024;

    let (
        title,
        meta_description,
        has_mobile_viewport,
        has_og_tags,
        has_canonical,
        has_structured_data,
        h1_count,
        h1_text,
        image_count,
        images_missing_alt,
        mut headings,
        social_links,
        subpages,
        clean_text,
    ) = {
        let doc = Html::parse_document(&html);
        let title_sel = Selector::parse("title").unwrap();
        let meta_desc_sel = Selector::parse("meta[name='description'], meta[property='og:description']").unwrap();
        let viewport_sel = Selector::parse("meta[name='viewport']").unwrap();
        let og_sel = Selector::parse("meta[property='og:title'], meta[property='og:image']").unwrap();
        let canonical_sel = Selector::parse("link[rel='canonical']").unwrap();
        let jsonld_sel = Selector::parse("script[type='application/ld+json']").unwrap();
        let h1_sel = Selector::parse("h1").unwrap();
        let heading_sel = Selector::parse("h1, h2").unwrap();
        let img_sel = Selector::parse("img").unwrap();

        let title = doc
            .select(&title_sel)
            .next()
            .map(|e| e.text().collect::<String>().trim().to_string())
            .unwrap_or_default();
        let meta_description = doc
            .select(&meta_desc_sel)
            .next()
            .and_then(|e| e.value().attr("content"))
            .unwrap_or_default()
            .trim()
            .to_string();
        let has_mobile_viewport = doc.select(&viewport_sel).next().is_some();
        let has_og_tags = doc.select(&og_sel).next().is_some();
        let has_canonical = doc.select(&canonical_sel).next().is_some();
        let has_structured_data = doc.select(&jsonld_sel).next().is_some();

        let h1s: Vec<String> = doc
            .select(&h1_sel)
            .map(|e| e.text().collect::<String>().trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let h1_count = h1s.len() as i64;
        let h1_text = h1s.first().cloned().unwrap_or_default();

        let mut img_total = 0i64;
        let mut img_no_alt = 0i64;
        for img in doc.select(&img_sel) {
            img_total += 1;
            let alt = img.value().attr("alt").unwrap_or("").trim();
            if alt.is_empty() {
                img_no_alt += 1;
            }
        }

        let headings: Vec<String> = doc
            .select(&heading_sel)
            .map(|e| e.text().collect::<String>().trim().to_string())
            .filter(|h| !h.is_empty() && h.len() < 160)
            .take(16)
            .collect();
        let social_links = extract_social_links(&doc);
        let base_parsed = Url::parse(&final_url).unwrap_or_else(|_| Url::parse(&normalized).unwrap());
        let subpages = find_interesting_subpages(&doc, &base_parsed, max_subpages);
        let clean_text = extract_clean_text(&doc);
        (
            title,
            meta_description,
            has_mobile_viewport,
            has_og_tags,
            has_canonical,
            has_structured_data,
            h1_count,
            h1_text,
            img_total,
            img_no_alt,
            headings,
            social_links,
            subpages,
            clean_text,
        )
    };

    let site_domain = extract_domain(&final_url);
    let mut all_html_lower = html.to_lowercase();
    let mut all_text = clean_text.chars().take(6000).collect::<String>();
    let mut all_emails: Vec<String> = extract_emails(&all_text, &html, &site_domain);
    let mut all_phones: Vec<String> = extract_phones(&all_text);
    let mut titles = if title.is_empty() { vec![] } else { vec![title.clone()] };
    let mut pages_crawled = 1i64;

    let total_planned = 1 + subpages.len();
    on_page(1, total_planned, &final_url);

    for (idx, sub) in subpages.iter().enumerate() {
        on_page(idx + 2, total_planned, sub);
        if let Ok(sub_resp) = client.get(sub).send().await {
            let status_ok = sub_resp.status().is_success();
            if let Ok(sub_html) = sub_resp.text().await {
                // Accept subpage content if status is 2xx OR if it rendered substantial HTML before a footer PHP error
                if status_ok || sub_html.len() > 2000 {
                    pages_crawled += 1;
                    let sub_doc = Html::parse_document(&sub_html);
                    let sub_text = extract_clean_text(&sub_doc);
                    let sub_snippet: String = sub_text.chars().take(2500).collect();
                    // Sablonismétlés (azonos menü / lábléc minden aloldalon):
                    // nem fűzzük hozzá, hogy valódi tartalom maradjon a keretben.
                    if !is_boilerplate_repeat(&sub_snippet, &all_text) {
                        all_text.push_str("\n\n--- ALOLDAL: ");
                        all_text.push_str(sub);
                        all_text.push_str(" ---\n");
                        all_text.push_str(&sub_snippet);
                    }

                    all_html_lower.push_str(&sub_html.to_lowercase());

                    for em in extract_emails(&sub_text, &sub_html, &site_domain) {
                        if !all_emails.contains(&em) {
                            all_emails.push(em);
                        }
                    }
                    for ph in extract_phones(&sub_text) {
                        if !all_phones.contains(&ph) {
                            all_phones.push(ph);
                        }
                    }
                    let h_sel = Selector::parse("h1, h2").unwrap();
                    for h in sub_doc.select(&h_sel).take(4) {
                        let ht = h.text().collect::<String>().trim().to_string();
                        if !ht.is_empty() && !headings.contains(&ht) && headings.len() < 24 {
                            headings.push(ht);
                        }
                    }
                    let t_sel = Selector::parse("title").unwrap();
                    if let Some(st) = sub_doc.select(&t_sel).next() {
                        let ts = st.text().collect::<String>().trim().to_string();
                        if !ts.is_empty() && !titles.contains(&ts) {
                            titles.push(ts);
                        }
                    }
                }
            }
        }
    }

    // Fallback contact route probing if no email was found on homepage or linked subpages
    if all_emails.is_empty() {
        if let Ok(base_parsed) = Url::parse(&final_url) {
            for fallback_path in ["/kapcsolat", "/impresszum", "/contact", "/adatvedelmi-tajekoztato"] {
                if let Ok(probe_url) = base_parsed.join(fallback_path) {
                    let probe_str = probe_url.to_string();
                    if subpages.iter().any(|s| s.trim_end_matches('/') == probe_str.trim_end_matches('/')) {
                        continue;
                    }
                    if let Ok(resp) = client.get(&probe_str).send().await {
                        if resp.status().is_success() {
                            if let Ok(probe_html) = resp.text().await {
                                let probe_doc = Html::parse_document(&probe_html);
                                let probe_text = extract_clean_text(&probe_doc);
                                for em in extract_emails(&probe_text, &probe_html, &site_domain) {
                                    if !all_emails.contains(&em) {
                                        all_emails.push(em);
                                    }
                                }
                                for ph in extract_phones(&probe_text) {
                                    if !all_phones.contains(&ph) {
                                        all_phones.push(ph);
                                    }
                                }
                                if !all_emails.is_empty() {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let text_lower = all_text.to_lowercase();
    let (tech_stack, has_analytics, has_chat_widget, has_booking_system, has_contact_form) =
        detect_tech_and_signals(&all_html_lower, &text_lower);

    // Commercial, Trust & Compliance signals
    let has_pricing_signals = text_lower.contains("árlista")
        || text_lower.contains("árak")
        || text_lower.contains("pricing")
        || text_lower.contains("csomagok")
        || text_lower.contains(" ft")
        || text_lower.contains("eur");
    let has_testimonials = text_lower.contains("vélemény")
        || text_lower.contains("referenci")
        || text_lower.contains("értékelés")
        || text_lower.contains("esettanulmány")
        || text_lower.contains("testimonial")
        || text_lower.contains("reviews");
    let has_gdpr_privacy = text_lower.contains("adatvédel")
        || text_lower.contains("adatkezelés")
        || text_lower.contains("impresszum")
        || text_lower.contains("privacy policy")
        || all_html_lower.contains("gdpr")
        || all_html_lower.contains("cookie");
    let has_multilingual = all_html_lower.contains("hreflang=")
        || all_html_lower.contains("/en/")
        || all_html_lower.contains("/de/")
        || all_html_lower.contains("wpml")
        || all_html_lower.contains("polylang");
    let has_cta_signals = text_lower.contains("ajánlatkérés")
        || text_lower.contains("kapcsolatfelvétel")
        || text_lower.contains("időpont")
        || text_lower.contains("konzultáció")
        || text_lower.contains("ingyenes")
        || text_lower.contains("book now")
        || text_lower.contains("get started");

    let copyright_year = extract_copyright_year(&all_text).or_else(|| extract_copyright_year(&html));
    let current_year = Utc::now().year() as i64;

    // Detailed category scoring (0..100) + concrete issues & strengths
    let mut score_seo = 100i64;
    let mut score_ux = 100i64;
    let mut score_conv = 100i64;
    let mut score_trust = 100i64;
    let mut detected_issues = Vec::new();
    let mut strengths = Vec::new();

    // SEO checks
    if title.is_empty() {
        score_seo -= 25;
        detected_issues.push("Hiányzó <title> oldal-cím a főoldalon".into());
    } else if title.len() < 15 || title.len() > 75 {
        score_seo -= 10;
        detected_issues.push(format!("Nem optimális <title> hossz ({} karakter)", title.len()));
    } else {
        strengths.push("Jól formázott SEO oldalcím".into());
    }
    if meta_description.is_empty() {
        score_seo -= 20;
        detected_issues.push("Hiányzó SEO meta leírás (gyenge Google megjelenés)".into());
    }
    if h1_count == 0 {
        score_seo -= 20;
        detected_issues.push("Hiányzó H1 főcím a főoldalon".into());
    } else if h1_count > 2 {
        score_seo -= 10;
        detected_issues.push(format!("Túl sok H1 főcím ({} db) — rontja a keresőoptimalizálást", h1_count));
    }
    if !has_og_tags {
        score_seo -= 12;
        detected_issues.push("Hiányzó OpenGraph (Facebook/LinkedIn) megosztási meta tagek".into());
    }
    if !has_canonical {
        score_seo -= 8;
    }
    if !has_structured_data {
        score_seo -= 10;
        detected_issues.push("Hiányzó Schema.org (JSON-LD) strukturált cégadatok".into());
    } else {
        strengths.push("Beépített Schema.org strukturált adat".into());
    }

    // UX & Mobile checks
    if !has_mobile_viewport {
        score_ux -= 35;
        detected_issues.push("Hiányzó mobil viewport — okostelefonon rosszul jelenik meg".into());
    } else {
        strengths.push("Mobilbarát viewport beállítva".into());
    }
    if load_time_ms > 2800 {
        score_ux -= 25;
        detected_issues.push(format!("Lassú szerverválasz ({} ms — magas lemorzsolódási kockázat)", load_time_ms));
    } else if load_time_ms > 1600 {
        score_ux -= 12;
        detected_issues.push(format!("Közepesen lassú válaszidő ({} ms)", load_time_ms));
    } else {
        strengths.push(format!("Gyors betöltés ({} ms)", load_time_ms));
    }
    if html_size_kb > 450 {
        score_ux -= 12;
        detected_issues.push(format!("Túl nagy főoldal HTML méret ({} KB)", html_size_kb));
    }
    if image_count > 3 && images_missing_alt > image_count / 2 {
        score_ux -= 15;
        detected_issues.push(format!("Sok képnél hiányzik az alt leírás ({}/{} kép)", images_missing_alt, image_count));
    }
    if let Some(yr) = copyright_year {
        if yr <= current_year - 3 {
            score_ux -= 15;
            score_trust -= 15;
            detected_issues.push(format!("Elavult weboldal gyanú (lábléc copyright év: {})", yr));
        }
    }

    // Conversion checks
    if !has_booking_system {
        score_conv -= 28;
        detected_issues.push("Nincs beépített online időpontfoglaló modul".into());
    } else {
        strengths.push("Aktív online időpontfoglalás".into());
    }
    if !has_chat_widget {
        score_conv -= 15;
        detected_issues.push("Nincs élő chat vagy azonnali érdeklődő-kezelő widget".into());
    }
    if !has_contact_form {
        score_conv -= 22;
        detected_issues.push("Nem található közvetlen kapcsolatfelvételi / ajánlatkérő űrlap".into());
    }
    if !has_analytics {
        score_conv -= 20;
        detected_issues.push("Nem észlelhető analitika / konverziómérés (GA4, GTM, Meta Pixel)".into());
    } else {
        strengths.push("Analitika / konverziómérés telepítve".into());
    }
    if !has_cta_signals {
        score_conv -= 15;
        detected_issues.push("Gyenge vagy hiányzó egyértelmű CTA (ajánlatkérés / konzultáció)".into());
    }

    // Trust & Compliance checks
    if !has_https {
        score_trust -= 40;
        detected_issues.push("Nincs HTTPS / SSL titkosítás — a böngészők „Nem biztonságos”-ként jelzik!".into());
    } else {
        strengths.push("Érvényes HTTPS / SSL titkosítás".into());
    }
    if !has_gdpr_privacy {
        score_trust -= 22;
        detected_issues.push("Hiányzó vagy nehezen megtalálható Adatvédelmi tájékoztató / Impresszum".into());
    }
    if !has_testimonials {
        score_trust -= 15;
        detected_issues.push("Nincsenek kiemelt ügyfélvélemények vagy esettanulmányok".into());
    }
    if all_emails.is_empty() && all_phones.is_empty() {
        score_trust -= 18;
        detected_issues.push("Nincs közvetlenül kiírt publikus e-mail vagy telefonszám".into());
    }
    if has_pricing_signals {
        strengths.push("Átlátható ár / csomag kommunikáció".into());
    }
    if has_multilingual {
        strengths.push("Többnyelvű weboldal".into());
    }

    score_seo = score_seo.clamp(0, 100);
    score_ux = score_ux.clamp(0, 100);
    score_conv = score_conv.clamp(0, 100);
    score_trust = score_trust.clamp(0, 100);
    let overall_score = ((score_seo + score_ux + score_conv + score_trust) as f64 / 4.0).round() as i64;

    let audit = WebsiteAudit {
        reachable: status_code < 400,
        status_code: Some(status_code),
        has_https,
        load_time_ms,
        has_mobile_viewport,
        title: title.clone(),
        meta_description: meta_description.clone(),
        has_analytics,
        has_chat_widget,
        has_booking_system,
        has_contact_form,
        tech_stack,
        detected_issues,
        extracted_emails: all_emails,
        extracted_phones: all_phones,
        social_links,
        pages_crawled,
        audited_at: Utc::now().to_rfc3339(),
        overall_score,
        score_seo,
        score_ux_mobile: score_ux,
        score_conversion: score_conv,
        score_trust,
        html_size_kb,
        h1_count,
        h1_text,
        image_count,
        images_missing_alt,
        has_og_tags,
        has_canonical,
        has_structured_data,
        has_pricing_signals,
        has_testimonials,
        has_gdpr_privacy,
        has_multilingual,
        has_cta_signals,
        copyright_year,
        strengths,
    };

    Ok(CrawledSiteData {
        final_url,
        pages_crawled,
        combined_text: all_text.chars().take(12000).collect(),
        titles,
        headings,
        meta_description,
        audit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boilerplate_elements_are_excluded_from_text() {
        let html = r#"<html><body>
            <header><nav>Főoldal Rólunk Árak Kapcsolat</nav></header>
            <main><h1>Okos űrlap mindenkinek</h1><p>Árajánlatkérés és időpontfoglalás egy űrlapon.</p></main>
            <div class="cookie-consent">Ez az oldal sütiket használ. Elfogadom.</div>
            <div id="popup-overlay">Iratkozz fel hírlevelünkre!</div>
            <footer>© 2026 Cég Kft. Minden jog fenntartva.</footer>
        </body></html>"#;
        let text = extract_clean_text(&Html::parse_document(html));
        assert!(text.contains("Okos űrlap mindenkinek"), "fő tartalom: {}", text);
        assert!(!text.contains("Főoldal Rólunk"), "navigáció: {}", text);
        assert!(!text.contains("sütiket használ"), "süti-sáv: {}", text);
        assert!(!text.contains("hírlevelünkre"), "popup: {}", text);
        assert!(!text.contains("Minden jog fenntartva"), "lábléc: {}", text);
    }

    #[test]
    fn repeated_template_text_is_detected() {
        // 50 közös szó (menü + sablon), utána eltérő folytatás.
        let shared = "Főoldal Rólunk Szolgáltatások Árak Kapcsolat Belépés Regisztráció Hírek Blog GYIK Árajánlatkérés és időpontfoglalás egy űrlapon keresztül könnyedén és gyorsan megoldható mindenféle extra költség nélkül akár hétvégén is folyamatosan Cégünk tizenöt éve foglalkozik online marketinggel és weboldal készítéssel Budapesten számos referenciával és elégedett ügyféllel büszkélkedhetünk ezért válasszon minket bizalommal köszönjük érdeklődését";
        let collected = format!(
            "{} ez egy teljesen más folytatás ami nem egyezik meg semmiben sem az előző szöveggel hiszen más szavakból áll össze egészében",
            shared
        );
        let repeat = format!(
            "{} továbbá kedvezményes csomagok és akciók folyamatosan elérhetők minden kedves látogatónk számára még ma érdemes körülnézni az ajánlatok között is bátran",
            shared
        );
        assert!(is_boilerplate_repeat(&repeat, &collected));
        assert!(!is_boilerplate_repeat(
            "Az esküvői fotózás árairól és csomagjairól részletes tájékoztatást talál a galéria alatt, kérjen ajánlatot telefonon vagy e-mailben, munkatársunk hamarosan válaszol minden megkeresésre. Vállalunk családi rendezvényeket keresztelőket születésnapokat és céges eseményeket is országszerte kedvező áron.",
            &collected
        ));
        assert!(!is_boilerplate_repeat("Rövid.", &collected));
    }
}
