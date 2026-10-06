# Treatment Manager – Konzept & Entscheidungen

Stand: 06.10.2026
Prototyp (Version 3): https://claude.ai/artifact/BxnRKon9fBJZjVaufrkmnK
Code: Mac → Dokumente/Treatment Manager · Supabase-Projekt `treatment-manager` (ID zmrykzunjryvqrtlhhhn, Frankfurt, Gratis-Plan)

## Entscheidungen
- Zielgruppe: Heilpraktiker (Selbstzahler / Privatpatienten). Keine GKV-Abrechnung im ersten Schritt.
- Termine legt nur der Behandelnde an. Patienten haben keinen Login, nur einen Eintrag in der Kartei.
- Plattform: Web-App, auch mobil. Kalender mit Tag-, Wochen- und Monatsansicht.
- Konten: Praxen beantragen selbst, Admin (Kilian) schaltet frei, sperrt oder lädt per E-Mail ein.
- **Admin hat keinen Zugriff auf Praxisdaten** – erzwungen per Row Level Security in der Datenbank.
  Admin kann keine Passwörter sehen oder vergeben und sich nicht als Praxis anmelden.
  Neue Konten über Einladungslink, Passwort vergessen nur per E-Mail an die Praxis.
- Backend: Supabase (Postgres, Auth, Edge Functions), Region Frankfurt.
- Frontend ohne Build-Schritt (ES-Module + CDN), damit es ohne npm läuft und per Netlify Drop veröffentlicht werden kann.
- Erster Admin: Kilians Gmail-Adresse (Tabelle `app_admins`), wird bei Registrierung automatisch Admin.

## Datenmodell (Supabase, Schema public)
- `profiles`: Konto je Auth-Nutzer – Name, Praxisname, Berufsbezeichnung, Rolle (admin/user), Status (pending/active/blocked)
- `practice_settings`: Briefkopf, Steuernummer, Bank, USt-Hinweis, Zahlungsziel (1 Zeile je Praxis)
- `services`: Leistungen mit Dauer, Preis, GebüH-Ziffer, aktiv/archiviert
- `patients`: Patientenkartei
- `appointments`: Termine (Start, Dauer, Leistungen als uuid[], Status, Notiz, Rechnungs-Verknüpfung)
- `invoices`: unveränderbare Rechnungen mit Snapshot von Patient, Praxis und Positionen; Status offen/bezahlt/storniert
- `invoice_counters`: fortlaufende Nummer je Praxis und Jahr
- Funktionen: `create_invoice`, `admin_list_accounts`, `admin_set_status`; Edge Function `admin-accounts` (invite, reject)

## Sicherheitstests (06.10.2026, alle bestanden)
Abgerechnete Termine nicht änderbar/löschbar · Rechnungen nicht änderbar, nicht direkt anlegbar, Storno endgültig ·
Nutzer können eigene Rolle/Status nicht ändern · Admin sieht 0 Patienten/Termine/Rechnungen/Leistungen/Praxisdaten
und kann nicht schreiben · wartende Konten haben keinen Zugriff · Praxen sehen nur eigene Daten.

## Offene To-dos vor dem Test mit Heilpraktikern
1. Supabase: Site URL und Redirect URLs eintragen (Authentication → URL Configuration)
2. Eigenen SMTP-Dienst einrichten – sonst gehen E-Mails nur an Supabase-Teammitglieder
3. E-Mail-Vorlagen auf Deutsch
4. App veröffentlichen (z. B. Netlify Drop) und Adresse in Supabase eintragen
5. Kilian registriert sich mit seiner Admin-Adresse
6. Testkonten aus den Sicherheitstests entfernen (supabase/cleanup_testkonten.sql), falls noch vorhanden
7. Vor echtem Betrieb: Supabase Pro (Backups), AV-Verträge, Datenschutzerklärung/Impressum, 2FA im Supabase-Dashboard

## Wichtige fachliche Punkte
- Rechnungs-Pflichtangaben nach § 14 UStG; Hinweis auf Steuerbefreiung nach § 4 Nr. 14 UStG
- GoBD: unveränderbare Rechnungen, lückenlose Nummern, 10 Jahre Aufbewahrung
- DSGVO Art. 9 und § 203 StGB: EU-Hosting, Verschlüsselung, AV-Vertrag, Zugriffsprotokoll, Admin ohne Zugriff auf Gesundheitsdaten
- Rechtliche Details vor dem Livegang mit Steuerberater/Anwalt prüfen

## Roadmap (Vorschlag)
1. Feedback von 2–3 Heilpraktikern (Testpersonen vorhanden)
2. Ausfallhonorar für „nicht erschienen“, Mahnwesen, Zahlungsabgleich
3. Terminerinnerung per E-Mail/SMS, Kalender-Export (iCal)
4. Zwei-Faktor-Anmeldung für Praxen, Protokoll der Zugriffe
5. Später: Online-Buchung durch Patienten, Behandlungsdokumentation, GebüH-Katalog, DATEV-Export, Abo-Modell
