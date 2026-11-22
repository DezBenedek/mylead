use crate::models::SenderAccount;
use chrono::Utc;
use hmac::{Hmac, Mac};
use lettre::message::MultiPart;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use mail_parser::MessageParser;
use reqwest::Client;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::time::Duration;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone)]
pub struct InboundEmail {
    pub from_email: String,
    pub subject: String,
    pub body: String,
    pub message_id: String,
    pub in_reply_to: Option<String>,
    pub _received_at: String,
}

fn escape_html_and_linkify(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len() + 32);
    for ch in text.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            _ => escaped.push(ch),
        }
    }
    escaped.replace('\n', "<br>")
}

/// Formats an outbound email into both `text/plain` and `text/html`, rendering the signature fine print
/// (cégadatok, adószám, székhely, jogi/GDPR megjegyzés — or any text after `\n---\n`) in small 11px muted font.
pub fn format_email_plain_and_html(body: &str, fine_print: Option<&str>) -> (String, String) {
    let trimmed_body = body.trim();
    let (main_part, inline_fine_part) = if let Some(idx) = trimmed_body.find("\n---\n") {
        (
            trimmed_body[..idx].trim().to_string(),
            Some(trimmed_body[idx + 5..].trim().to_string()),
        )
    } else {
        (trimmed_body.to_string(), None)
    };

    let extra_fp = fine_print
        .map(str::trim)
        .filter(|s| !s.is_empty() && !trimmed_body.contains(*s));

    let combined_fine_print = match (inline_fine_part, extra_fp) {
        (Some(a), Some(b)) if !a.is_empty() => Some(format!("{}\n{}", a, b)),
        (Some(a), None) if !a.is_empty() => Some(a),
        (_, Some(b)) => Some(b.to_string()),
        _ => None,
    };

    let plain_out = match &combined_fine_print {
        Some(fp) => format!("{}\n\n---\n{}", main_part, fp),
        None => main_part.clone(),
    };

    let main_paragraphs_html = main_part
        .split("\n\n")
        .map(|p| {
            format!(
                "<p style=\"margin:0 0 14px 0;\">{}</p>",
                escape_html_and_linkify(p.trim())
            )
        })
        .collect::<Vec<_>>()
        .join("");

    let fine_print_html = match &combined_fine_print {
        Some(fp) => format!(
            "<div style=\"margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;font-size:11px;line-height:1.45;color:#6b7280;\">{}</div>",
            escape_html_and_linkify(fp)
        ),
        None => String::new(),
    };

    let html_out = format!(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body style=\"margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;\"><div>{}{}</div></body></html>",
        main_paragraphs_html, fine_print_html
    );

    (plain_out, html_out)
}

pub async fn send_email(
    account: &SenderAccount,
    to_email: &str,
    subject: &str,
    body: &str,
    in_reply_to: Option<&str>,
    fine_print: Option<&str>,
) -> Result<String, String> {
    if to_email.trim().is_empty() || !to_email.contains('@') {
        return Err("Érvénytelen címzett e-mail cím".to_string());
    }
    match account.provider.as_str() {
        "ses" => send_via_amazon_ses(account, to_email, subject, body, fine_print).await,
        _ => send_via_smtp(account, to_email, subject, body, in_reply_to, fine_print).await,
    }
}

async fn send_via_smtp(
    account: &SenderAccount,
    to_email: &str,
    subject: &str,
    body: &str,
    in_reply_to: Option<&str>,
    fine_print: Option<&str>,
) -> Result<String, String> {
    if account.smtp_host.trim().is_empty() {
        return Err("SMTP szerver host nincs megadva".to_string());
    }

    let from_formatted = if account.from_name.trim().is_empty() {
        account.from_email.trim().to_string()
    } else {
        format!("{} <{}>", account.from_name.trim(), account.from_email.trim())
    };

    let domain = account
        .from_email
        .split('@')
        .nth(1)
        .unwrap_or("mylead.local");
    let msg_id = format!("<{}.mylead@{}>", Uuid::new_v4(), domain);

    let mut builder = Message::builder()
        .from(from_formatted.parse().map_err(|e| format!("Hibás feladó cím: {}", e))?)
        .to(to_email.trim().parse().map_err(|e| format!("Hibás címzett cím: {}", e))?)
        .subject(subject)
        .message_id(Some(msg_id.clone()));

    if !account.reply_to.trim().is_empty() {
        if let Ok(rt) = account.reply_to.trim().parse() {
            builder = builder.reply_to(rt);
        }
    }
    if let Some(reply_ref) = in_reply_to {
        if !reply_ref.trim().is_empty() {
            builder = builder.in_reply_to(reply_ref.trim().to_string());
            builder = builder.references(reply_ref.trim().to_string());
        }
    }

    let (plain_body, html_body) = format_email_plain_and_html(body, fine_print);

    let email = builder
        .multipart(MultiPart::alternative_plain_html(plain_body, html_body))
        .map_err(|e| format!("E-mail összeállítási hiba: {}", e))?;

    let creds = Credentials::new(
        account.smtp_username.clone(),
        account.smtp_password.clone(),
    );

    let port = account.smtp_port.clamp(1, 65535) as u16;
    let transport_builder = match account.smtp_security.as_str() {
        "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(&account.smtp_host)
            .map_err(|e| format!("SMTP TLS hiba: {}", e))?
            .port(port),
        "none" => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&account.smtp_host)
            .port(port),
        _ => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&account.smtp_host)
            .map_err(|e| format!("SMTP STARTTLS hiba: {}", e))?
            .port(port),
    };

    let mailer = if !account.smtp_username.trim().is_empty() {
        transport_builder
            .credentials(creds)
            .timeout(Some(Duration::from_secs(20)))
            .build()
    } else {
        transport_builder
            .timeout(Some(Duration::from_secs(20)))
            .build()
    };

    mailer
        .send(email)
        .await
        .map_err(|e| format!("SMTP küldési hiba: {}", e))?;

    Ok(msg_id)
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC key error");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// Native Amazon SES v2 API sender with AWS Signature Version 4 (zero AWS SDK bloat)
async fn send_via_amazon_ses(
    account: &SenderAccount,
    to_email: &str,
    subject: &str,
    body: &str,
    fine_print: Option<&str>,
) -> Result<String, String> {
    let region = if account.ses_region.trim().is_empty() {
        "eu-central-1"
    } else {
        account.ses_region.trim()
    };
    if account.ses_access_key.trim().is_empty() || account.ses_secret_key.trim().is_empty() {
        return Err("Amazon SES Access Key és Secret Key megadása kötelező".to_string());
    }

    let host = format!("email.{}.amazonaws.com", region);
    let path = "/v2/email/outbound-emails";
    let endpoint = format!("https://{}{}", host, path);

    let from_addr = if account.from_name.trim().is_empty() {
        account.from_email.trim().to_string()
    } else {
        format!("{} <{}>", account.from_name.trim(), account.from_email.trim())
    };

    let (plain_body, html_body) = format_email_plain_and_html(body, fine_print);

    let mut payload_obj = json!({
        "FromEmailAddress": from_addr,
        "Destination": {
            "ToAddresses": [to_email.trim()]
        },
        "Content": {
            "Simple": {
                "Subject": { "Data": subject, "Charset": "UTF-8" },
                "Body": {
                    "Text": { "Data": plain_body, "Charset": "UTF-8" },
                    "Html": { "Data": html_body, "Charset": "UTF-8" }
                }
            }
        }
    });
    if !account.reply_to.trim().is_empty() {
        payload_obj["ReplyToAddresses"] = json!([account.reply_to.trim()]);
    }

    let payload = payload_obj.to_string();
    let payload_hash = sha256_hex(payload.as_bytes());

    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();

    let canonical_headers = format!(
        "content-type:application/json\nhost:{}\nx-amz-content-sha256:{}\nx-amz-date:{}\n",
        host, payload_hash, amz_date
    );
    let signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date";
    let canonical_request = format!(
        "POST\n{}\n\n{}\n{}\n{}",
        path, canonical_headers, signed_headers, payload_hash
    );

    let credential_scope = format!("{}/{}/ses/aws4_request", date_stamp, region);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date,
        credential_scope,
        sha256_hex(canonical_request.as_bytes())
    );

    let k_date = hmac_sha256(
        format!("AWS4{}", account.ses_secret_key.trim()).as_bytes(),
        date_stamp.as_bytes(),
    );
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, b"ses");
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));

    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        account.ses_access_key.trim(),
        credential_scope,
        signed_headers,
        signature
    );

    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .header("X-Amz-Date", &amz_date)
        .header("X-Amz-Content-Sha256", &payload_hash)
        .header("Authorization", &authorization)
        .body(payload)
        .send()
        .await
        .map_err(|e| format!("Amazon SES hálózati hiba: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("Amazon SES hiba ({}): {}", status, txt));
    }

    let v: serde_json::Value = resp.json().await.unwrap_or_default();
    let ses_id = v["MessageId"]
        .as_str()
        .map(|id| format!("<{}@ses.amazonaws.com>", id))
        .unwrap_or_else(|| format!("<{}.ses@mylead.local>", Uuid::new_v4()));

    Ok(ses_id)
}

/// Synchronous IMAP fetch wrapped cleanly for tokio::task::spawn_blocking
pub fn fetch_recent_imap_messages(account: &SenderAccount, max_fetch: u32) -> Result<Vec<InboundEmail>, String> {
    if !account.imap_enabled || account.imap_host.trim().is_empty() {
        return Err("IMAP nincs engedélyezve vagy hiányzik az IMAP host ennél a fióknál.".to_string());
    }

    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS hiba: {}", e))?;

    let port = account.imap_port.clamp(1, 65535) as u16;
    let client = imap::connect((account.imap_host.trim(), port), account.imap_host.trim(), &tls)
        .map_err(|e| format!("IMAP csatlakozási hiba ({}:{}): {}", account.imap_host, port, e))?;

    let mut session = client
        .login(account.imap_username.trim(), account.imap_password.trim())
        .map_err(|(e, _)| format!("IMAP bejelentkezési hiba: {}", e))?;

    let mailbox = session
        .select("INBOX")
        .map_err(|e| format!("INBOX megnyitási hiba: {}", e))?;

    let exists = mailbox.exists;
    if exists == 0 {
        let _ = session.logout();
        return Ok(vec![]);
    }

    let start = if exists > max_fetch { exists - max_fetch + 1 } else { 1 };
    let range = format!("{}:{}", start, exists);

    let fetches = session
        .fetch(range, "RFC822")
        .map_err(|e| format!("IMAP levelek letöltési hiba: {}", e))?;

    let parser = MessageParser::default();
    let mut results = Vec::new();

    for msg in fetches.iter() {
        if let Some(raw_bytes) = msg.body() {
            if let Some(parsed) = parser.parse(raw_bytes) {
                let from_email = parsed
                    .from()
                    .and_then(|addrs| addrs.first())
                    .and_then(|a| a.address())
                    .unwrap_or_default()
                    .to_lowercase();

                if from_email.is_empty() || from_email == account.from_email.to_lowercase() {
                    continue;
                }

                let subject = parsed.subject().unwrap_or("(Nincs tárgy)").to_string();
                let body = parsed
                    .body_text(0)
                    .map(|c| c.to_string())
                    .unwrap_or_default()
                    .trim()
                    .to_string();

                let message_id = parsed
                    .message_id()
                    .map(|s| format!("<{}>", s.trim_matches(|c| c == '<' || c == '>')))
                    .unwrap_or_else(|| format!("<imap-{}>", Uuid::new_v4()));

                let in_reply_to = parsed
                    .in_reply_to()
                    .as_text()
                    .map(|s| format!("<{}>", s.trim_matches(|c| c == '<' || c == '>')));

                let received_at = parsed
                    .date()
                    .map(|d| d.to_rfc3339())
                    .unwrap_or_else(|| Utc::now().to_rfc3339());

                results.push(InboundEmail {
                    from_email,
                    subject,
                    body,
                    message_id,
                    in_reply_to,
                    _received_at: received_at,
                });
            }
        }
    }

    let _ = session.logout();
    Ok(results)
}
