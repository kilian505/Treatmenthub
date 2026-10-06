# Treatment Manager

Web-App für Heilpraktiker: Termine (Tag/Woche/Monat), Patientenkartei, Leistungskatalog mit Preisen,
Rechnungen als PDF, Umsatzstatistik. Konten werden von dir als Admin freigeschaltet.
Datenbank und Anmeldung laufen über **Supabase** (Projekt `treatment-manager`, Server in Frankfurt).

## Was liegt wo?

| Ordner / Datei | Inhalt |
|---|---|
| `app/` | Die eigentliche App (HTML, CSS, JavaScript). Diesen Ordner veröffentlichst du. |
| `app/src/config.js` | Adresse und öffentlicher Schlüssel deines Supabase-Projekts |
| `supabase/migrations/` | Datenbank-Aufbau inkl. Sicherheitsregeln (bereits in Supabase eingespielt) |
| `supabase/functions/admin-accounts/` | Server-Funktion für Einladungen und Ablehnungen (bereits veröffentlicht) |
| `prototyp/index.html` | Klickbarer Prototyp ohne Server, mit Beispieldaten (zum Zeigen und Testen) |
| `docs/` | Konzept und Entscheidungen |
| `App lokal starten.command` | Startet die App per Doppelklick auf deinem Mac |

## App auf dem Mac starten

1. Doppelklick auf **„App lokal starten.command“**. Beim ersten Mal: Rechtsklick → „Öffnen“, weil macOS unbekannten Skripten misstraut.
2. Der Browser öffnet `http://localhost:8000`. Das Terminalfenster offen lassen, solange du die App nutzt.

(Alternativ im Terminal im Ordner `app`: `python3 -m http.server 8000`)

## Einmalige Einstellungen in Supabase (wichtig!)

Diese Punkte gehen nur im Supabase-Dashboard (supabase.com → Projekt „treatment-manager“):

1. **Adressen für E-Mail-Links** – *Authentication → URL Configuration*
   - *Site URL*: die Adresse, unter der die App läuft (zum Testen `http://localhost:8000`, später z. B. deine Netlify-Adresse)
   - *Redirect URLs*: `http://localhost:8000/**` und später deine echte Adresse mit `/**`
2. **Eigener E-Mail-Versand (SMTP)** – *Authentication → Emails → SMTP Settings*
   Ohne eigenen SMTP-Server verschickt Supabase E-Mails **nur an Mitglieder deines Supabase-Teams** und nur wenige pro Stunde.
   Deine Test-Heilpraktiker bekämen also weder Bestätigungs- noch Einladungs-E-Mails. Günstige Anbieter: z. B. Brevo, Resend, Postmark
   (für Gesundheitsdaten-Umfeld einen EU-Anbieter mit AV-Vertrag wählen).
3. **E-Mail-Texte auf Deutsch** – *Authentication → Emails → Templates* (Bestätigen, Einladen, Passwort zurücksetzen)

## Dein Admin-Konto

Registriere dich in der App ganz normal über „Konto beantragen“ mit **deiner Gmail-Adresse** (die in der Datenbank als Admin hinterlegte).
Diese Adresse steht in der Tabelle `app_admins`: Das Konto ist nach der E-Mail-Bestätigung sofort aktiv und sieht nur den Bereich „Konten“.

## So funktionieren Konten

- **Praxis beantragt selbst:** „Konto beantragen“ → E-Mail bestätigen → wartet → du klickst „Freischalten“.
- **Du lädst ein:** „+ Praxis einladen“ → die Praxis bekommt einen Link und legt ihr Passwort selbst fest.
- **Passwort vergessen:** läuft nur per E-Mail-Link direkt an die Praxis.
- **Sperren/Entsperren:** gesperrte Konten kommen sofort nicht mehr an ihre Daten.

### Admin hat keinen Zugriff auf Praxisdaten

Das ist nicht nur in der Oberfläche versteckt, sondern in der Datenbank erzwungen (Row Level Security):
Admin-Konten können Patienten, Termine, Leistungen, Rechnungen und Praxisdaten weder lesen noch ändern,
und es gibt keine Funktion, mit der ein Admin Passwörter sieht, setzt oder sich als Praxis anmeldet.
Getestet mit Testkonten direkt in der Datenbank (alle Prüfungen bestanden).

**Ehrlicher Hinweis:** Als Eigentümer des Supabase-Projekts kannst du im Supabase-Dashboard (Table Editor/SQL)
technisch trotzdem alle Tabellen sehen. Das gilt für jeden Betreiber einer Datenbank. Für den echten Betrieb:
Dashboard-Zugang streng begrenzen, Zwei-Faktor-Anmeldung bei Supabase aktivieren, AV-Verträge mit den Praxen
und mit Supabase abschließen, und langfristig über eine Verschlüsselung sensibler Felder nachdenken.

## Rechnungen sind GoBD-freundlich

- Fortlaufende Nummern `RE-JJJJ-NNNN` pro Praxis und Jahr, vergeben in der Datenbank (keine Lücken, keine Doppelten)
- Preise, Adressen und Praxisdaten werden beim Erstellen eingefroren
- Rechnungen können nicht geändert oder gelöscht werden, nur storniert. Abgerechnete Termine sind gesperrt.

## Veröffentlichen über GitHub Pages (empfohlen)

Der Ordner ist dafür vorbereitet (`index.html` leitet auf `app/` weiter, `.nojekyll` sorgt dafür, dass GitHub alle Dateien unverändert ausliefert).

1. Auf github.com: **„+“ → „New repository“**, Name `treatment-manager`, **Public**, ohne README anlegen.
2. **„uploading an existing file“** klicken und den gesamten Inhalt dieses Ordners hineinziehen
   (im Finder alles markieren mit ⌘A; versteckte Dateien wie `.nojekyll` zeigst du mit ⌘⇧. an). Dann **„Commit changes“**.
3. **Settings → Pages** → *Branch*: `main`, Ordner `/ (root)` → **Save**.
4. Nach 1–2 Minuten läuft die App unter `https://DEIN-NAME.github.io/treatment-manager/`.
5. In Supabase unter *Authentication → URL Configuration*:
   - *Site URL*: `https://DEIN-NAME.github.io/treatment-manager/app/`
   - *Redirect URLs*: `https://DEIN-NAME.github.io/treatment-manager/**` (und weiterhin `http://localhost:8000/**` für lokale Tests)

Hinweise: Bei einem kostenlosen GitHub-Konto muss das Repository öffentlich sein, damit Pages läuft. Der Code ist dann lesbar,
die Praxisdaten nicht (die liegen geschützt in Supabase). Der Schlüssel in `app/src/config.js` darf öffentlich sein.
Änderungen später einfach erneut hochladen; GitHub speichert jede Version.

Alternativen ohne GitHub: Netlify Drop (Ordner `app` auf app.netlify.com/drop ziehen), Vercel, Cloudflare Pages.

## Kosten / Gratis-Plan

Das Supabase-Projekt läuft im Gratis-Plan. Es wird nach 7 Tagen ohne Nutzung pausiert (im Dashboard per Klick wieder aktivierbar)
und hat keine automatischen Backups. Vor echtem Praxisbetrieb auf den Pro-Plan wechseln.

## Aufräumen

Für die Sicherheitstests wurden drei Testkonten angelegt (`test-admin@`, `test-praxis1@`, `test-praxis2@example.org`, ohne Passwort, nicht anmeldbar).
Falls sie noch existieren: im SQL-Editor `supabase/cleanup_testkonten.sql` ausführen.

## Technik in Kürze

- Kein Build-Schritt: ES-Module im Browser, Bibliotheken über jsDelivr (`@supabase/supabase-js@2`, `jspdf@2.5.2`)
- `app/src/api.js` ist die einzige Datei, die mit Supabase spricht
- Datenbank-Logik: `create_invoice` (Rechnung atomar), Trigger für Unveränderbarkeit, `admin_list_accounts` / `admin_set_status`
- Edge Function `admin-accounts`: Einladen (inviteUserByEmail) und Anträge ablehnen, nur für aktive Admins
