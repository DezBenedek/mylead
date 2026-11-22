# MyLead

Lokális, **Tauri v2 + Rust + SQLite + React + Mantine UI** alapú B2B lead-kutatási, weboldal-audit és automatizált e-mail outreach asztali alkalmazás.

## Főbb modulok

- **Projektek & Ajánlatok**: Saját cég/projekt felvétele, kedvezmények/ajánlatok rögzítése, valós HTTP weboldal-feltérképezés (`reqwest` + `scraper`) és AI értékesítési/reklám stratégia felépítése.
- **Keresések (Lead Discovery)**: Célcsoport cégek felkutatása **OpenStreetMap** (ingyenes, API kulcs nélkül), **Google Maps (Places API New)** vagy **Serper.dev** forrásból, illetve kézi/CSV URL importtal. Automatikus weboldal-látogatás, problémakeresés és Fit Score számítás.
- **Központi Lead Adatbázis (CRM)**: Deduplikált SQLite központi cégadatbázis keresési forrás címkézéssel (`search_leads`), mély adatlap-gazdagítással (több aloldal bejárása, tech stack, e-mailek, alkalmazotti létszám becslés, „Miben tudunk segíteni?” elemzés) és CSV exporttal.
- **Kampányok (SMTP & Amazon SES)**: Keresésből vagy kijelölt leadekből indított személyre szabott AI e-mail kampányok saját SMTP szerverrel (`lettre`) vagy natív Amazon SES v2 API-val (AWS SigV4).
- **Beérkező & AI Auto-válasz**: Valós IMAP szinkronizálás (`imap` + `mail-parser`), AI szándék-osztályozás (`booking_request`, `interested`, `question`, `objection`, `not_interested`, `unsubscribe`), jóváhagyásos vagy autopilóta válaszadás és automatikus időpontfoglaló link (Cal.com / Calendly) küldés.
- **Statisztikák & Riportok**: Konverziós tölcsér, 14 napos napi trend, keresésenkénti és kampányonkénti megtérülés, napi küldési kvóták és globális tiltólista.

## Indítás fejlesztői módban

```bash
pnpm install
pnpm dev
# vagy npm-mel:
npm run dev
```

*(A `pnpm dev` / `npm run dev` egyszerre indítja a Vite frontend szervert és a natív Tauri asztali alkalmazást.)*

## Production build

```bash
pnpm build:app
```
