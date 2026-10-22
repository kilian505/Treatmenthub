// Einstieg: Anmeldung, App-Rahmen, Praxis-Einstellungen, Admin-Bereich
import { $, $$, esc, ymd, addDays, toLocalStr, parseLocal, fmtDate, fmtTs, validEmail, addMin, startOfWeek } from "./util.js";
import { ST, hooks, render, go, toast, toastError, modal, closeModal, busy, armed, billable } from "./state.js";
import * as api from "./api.js";
import { calendarView } from "./calendar.js";
import { patientsView, servicesView } from "./records.js";
import { invoicesView, statsView } from "./billing.js";

const ICONS = {
  kalender: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  patienten: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-4-5.5"/></svg>',
  leistungen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4h6M12 4v4M5 8h14l-1 12H6z"/><path d="M12 12v5M9.5 14.5h5"/></svg>',
  rechnungen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h5"/></svg>',
  statistik: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 21h18M6 17v-5M11 17V7M16 17v-8M21 17V4"/></svg>',
  einstellungen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 21v-6M4 11V3M12 21v-9M12 8V3M20 21v-4M20 13V3M1 15h6M9 8h6M17 17h6"/></svg>',
  konten: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
};
const NAV_USER = [["kalender", "Kalender"], ["patienten", "Kunden"], ["leistungen", "Leistungen"], ["rechnungen", "Rechnungen"], ["statistik", "Statistik"], ["einstellungen", "Praxis"]];
const NAV_ADMIN = [["konten", "Konten"]];
const VIEWS = { kalender: calendarView, patienten: patientsView, leistungen: servicesView, rechnungen: invoicesView, statistik: statsView, einstellungen: settingsView, konten: accountsView };
const BRAND = `<div class="brand"><span class="brand-mark">${ICONS.leistungen.replace("<svg", '<svg width="18" height="18"')}</span>Treatment Manager</div>`;

let mode = "loading"; // loading | auth | setpw | pending | blocked | app
let adminAccounts = null;

/* ---------------- Start ---------------- */
async function boot() {
  mode = "loading"; render();
  try {
    const session = await api.auth.session();
    if (api.linkError) { ST.UI.auth = "login"; mode = "auth"; render(); toast(api.linkError, "error"); return; }
    if (session && (api.linkType === "invite" || api.linkType === "recovery")) { mode = "setpw"; render(); return; }
    if (!session) { mode = "auth"; render(); return; }
    await enter();
  } catch (e) { mode = "auth"; render(); toastError(e); }
}
async function enter() {
  ST.profile = await api.getProfile();
  const p = ST.profile;
  if (!p) { mode = "auth"; render(); return; }
  if (p.status === "pending") { mode = "pending"; render(); return; }
  if (p.status === "blocked") { mode = "blocked"; render(); return; }
  if (p.role === "admin") { ST.S = null; adminAccounts = null; mode = "app"; render(); return; }
  ST.S = await api.loadPractice(p);
  mode = "app"; render();
}
api.auth.onChange((event) => {
  if (event === "PASSWORD_RECOVERY") { mode = "setpw"; render(); }
  if (event === "SIGNED_OUT") { ST.profile = null; ST.S = null; mode = "auth"; ST.UI.auth = "login"; closeModal(); render(); }
});
async function logout() { await api.auth.signOut(); }

/* ---------------- Rendering ---------------- */
hooks.render = function () {
  const app = $("#app");
  if (mode === "loading") { app.innerHTML = `<div class="login"><div class="login-card">${BRAND}<p class="muted" style="margin:0">Wird geladen …</p></div></div>`; return; }
  if (mode === "auth") { app.innerHTML = authView(); bindAuth(); return; }
  if (mode === "setpw") { app.innerHTML = setPwView(); bindSetPw(); return; }
  if (mode === "pending" || mode === "blocked") { app.innerHTML = waitView(); $("#wOut").onclick = logout; const r = $("#wRe"); if (r) r.onclick = () => busy(r, boot); return; }
  const isAdmin = ST.profile.role === "admin";
  const nav = isAdmin ? NAV_ADMIN : NAV_USER;
  if (!nav.some(([k]) => k === ST.UI.route)) ST.UI.route = nav[0][0];
  const badge = (k) => { const n = k === "rechnungen" ? billable().length : k === "konten" && adminAccounts ? adminAccounts.filter((a) => a.status === "pending").length : 0; return n ? `<span class="badge num">${n}</span>` : ""; };
  app.innerHTML = `
  <div class="shell">
    <aside class="side">
      ${BRAND}
      <nav class="nav" aria-label="Hauptnavigation">${nav.map(([k, l]) => `<button data-go="${k}" ${ST.UI.route === k ? 'aria-current="page"' : ""}>${ICONS[k]}<span>${l}</span>${badge(k)}</button>`).join("")}</nav>
      <div class="side-foot"><span class="muted">${isAdmin ? "Administrator" : "Angemeldet als"}</span><strong style="overflow-wrap:anywhere">${esc(ST.profile.email)}</strong><button class="btn sm" id="logout">Abmelden</button></div>
    </aside>
    <main class="main" id="main"></main>
  </div>`;
  $$("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  $("#logout").onclick = logout;
  VIEWS[ST.UI.route]($("#main"));
};

/* ---------------- Anmelden / Registrieren ---------------- */
function authView() {
  const a = ST.UI.auth;
  if (a === "register") return `<div class="login"><form class="login-card" id="regForm" novalidate>
    ${BRAND}
    <div><h1>Konto beantragen</h1><p class="muted" style="margin:.3rem 0 0">Nach der Prüfung wird Ihr Konto freigeschaltet. Erst dann können Sie die App nutzen.</p></div>
    <div class="field"><label for="rg-name">Ihr Name *</label><input id="rg-name" autocomplete="name"></div>
    <div class="grid2"><div class="field"><label for="rg-practice">Praxisname *</label><input id="rg-practice" autocomplete="organization"></div>
      <div class="field"><label for="rg-title">Berufsbezeichnung</label><input id="rg-title" value="Heilpraktiker/in"></div></div>
    <div class="field"><label for="rg-mail">E-Mail *</label><input id="rg-mail" type="email" autocomplete="email"></div>
    <div class="grid2"><div class="field"><label for="rg-pw">Passwort *</label><input id="rg-pw" type="password" autocomplete="new-password"></div>
      <div class="field"><label for="rg-pw2">Passwort wiederholen *</label><input id="rg-pw2" type="password" autocomplete="new-password"></div></div>
    <p class="muted small" style="margin:0">Mindestens 8 Zeichen.</p>
    <label class="check"><input type="checkbox" id="rg-ok"> Ich habe die Datenschutzerklärung und die Nutzungsbedingungen gelesen und stimme zu.</label>
    <div id="err"></div>
    <button class="btn primary block" type="submit">Konto beantragen</button>
    <p class="center"><button type="button" class="link" data-auth="login">Zurück zur Anmeldung</button></p>
  </form></div>`;
  if (a === "registered") return `<div class="login"><div class="login-card">${BRAND}
    <h1>Fast geschafft</h1>
    <p style="margin:0">Wir haben Ihnen eine E-Mail geschickt. Bitte bestätigen Sie darin Ihre E-Mail-Adresse.</p>
    <p class="muted" style="margin:0">Danach prüfen wir Ihren Antrag und schalten Ihr Konto frei. Sie können sich schon anmelden und sehen dann den aktuellen Stand.</p>
    <button class="btn primary block" data-auth="login">Zur Anmeldung</button></div></div>`;
  if (a === "forgot") return `<div class="login"><form class="login-card" id="fgForm" novalidate>${BRAND}
    <div><h1>Passwort vergessen</h1><p class="muted" style="margin:.3rem 0 0">Wir schicken Ihnen einen Link, mit dem Sie ein neues Passwort festlegen.</p></div>
    <div class="field"><label for="fg-mail">E-Mail</label><input id="fg-mail" type="email" autocomplete="email"></div>
    <div id="err"></div>
    <button class="btn primary block" type="submit">Link senden</button>
    <p class="center"><button type="button" class="link" data-auth="login">Zurück zur Anmeldung</button></p></form></div>`;
  return `<div class="login"><form class="login-card" id="loginForm" novalidate>${BRAND}
    <div><h1>Anmelden</h1><p class="muted" style="margin:.3rem 0 0">Termine, Kundenkartei und Rechnungen für Ihre Praxis.</p></div>
    <div class="field"><label for="lg-mail">E-Mail</label><input id="lg-mail" type="email" autocomplete="email"></div>
    <div class="field"><label for="lg-pw">Passwort</label><input id="lg-pw" type="password" autocomplete="current-password"></div>
    <div id="err"></div>
    <button class="btn primary block" type="submit">Anmelden</button>
    <p class="center"><button type="button" class="link" data-auth="forgot">Passwort vergessen?</button></p>
    <p class="center">Noch kein Konto? <button type="button" class="link" data-auth="register">Konto beantragen</button></p>
  </form></div>`;
}
const showErr = (msg, kind = "bad") => ($("#err").innerHTML = msg ? `<div class="alert ${kind}">${esc(msg)}</div>` : "");
function bindAuth() {
  $$("[data-auth]").forEach((b) => (b.onclick = () => { ST.UI.auth = b.dataset.auth; render(); }));
  const lf = $("#loginForm");
  if (lf) lf.addEventListener("submit", (e) => {
    e.preventDefault();
    const m = $("#lg-mail").value.trim(), pw = $("#lg-pw").value;
    if (!validEmail(m) || !pw) return showErr("Bitte E-Mail-Adresse und Passwort eingeben.");
    busy(lf.querySelector("[type=submit]"), async () => {
      try { await api.auth.signIn(m, pw); await enter(); } catch (err) { showErr(err.message); }
    });
  });
  const rf = $("#regForm");
  if (rf) rf.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = (k) => $("#rg-" + k).value.trim(); const err = [];
    if (!v("name")) err.push("Bitte Ihren Namen eingeben.");
    if (!v("practice")) err.push("Bitte den Praxisnamen eingeben.");
    if (!validEmail(v("mail"))) err.push("Bitte eine gültige E-Mail-Adresse eingeben.");
    if ($("#rg-pw").value.length < 8) err.push("Das Passwort braucht mindestens 8 Zeichen.");
    else if ($("#rg-pw").value !== $("#rg-pw2").value) err.push("Die beiden Passwörter stimmen nicht überein.");
    if (!$("#rg-ok").checked) err.push("Bitte stimmen Sie der Datenschutzerklärung zu.");
    if (err.length) return ($("#err").innerHTML = `<div class="alert bad">${err.map(esc).join("<br>")}</div>`);
    busy(rf.querySelector("[type=submit]"), async () => {
      try {
        const res = await api.auth.signUp({ email: v("mail").toLowerCase(), password: $("#rg-pw").value, full_name: v("name"), practice_name: v("practice"), title: v("title") || "Heilpraktiker/in" });
        if (res.session) { await enter(); return; } // falls E-Mail-Bestätigung abgeschaltet ist
        ST.UI.auth = "registered"; render();
      } catch (err2) { showErr(err2.message); }
    });
  });
  const ff = $("#fgForm");
  if (ff) ff.addEventListener("submit", (e) => {
    e.preventDefault();
    const m = $("#fg-mail").value.trim();
    if (!validEmail(m)) return showErr("Bitte eine gültige E-Mail-Adresse eingeben.");
    busy(ff.querySelector("[type=submit]"), async () => {
      try { await api.auth.sendReset(m); showErr("Falls ein Konto mit dieser Adresse existiert, ist der Link jetzt unterwegs. Bitte prüfen Sie auch den Spam-Ordner.", "info"); }
      catch (err) { showErr(err.message); }
    });
  });
}
function setPwView() {
  const invite = api.linkType === "invite";
  return `<div class="login"><form class="login-card" id="spForm" novalidate>${BRAND}
    <div><h1>${invite ? "Willkommen! Passwort festlegen" : "Neues Passwort festlegen"}</h1>
    <p class="muted" style="margin:.3rem 0 0">${invite ? "Ihr Konto ist eingerichtet. Wählen Sie jetzt Ihr persönliches Passwort." : "Wählen Sie ein neues Passwort für Ihr Konto."}</p></div>
    <div class="field"><label for="sp-1">Neues Passwort</label><input id="sp-1" type="password" autocomplete="new-password"></div>
    <div class="field"><label for="sp-2">Wiederholen</label><input id="sp-2" type="password" autocomplete="new-password"></div>
    <p class="muted small" style="margin:0">Mindestens 8 Zeichen.</p>
    <div id="err"></div>
    <button class="btn primary block" type="submit">Speichern und weiter</button></form></div>`;
}
function bindSetPw() {
  const f = $("#spForm");
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const a = $("#sp-1").value, b = $("#sp-2").value;
    if (a.length < 8) return showErr("Das Passwort braucht mindestens 8 Zeichen.");
    if (a !== b) return showErr("Die beiden Passwörter stimmen nicht überein.");
    busy(f.querySelector("[type=submit]"), async () => {
      try { await api.auth.setPassword(a); history.replaceState(null, "", location.pathname); toast("Passwort gespeichert"); await enter(); }
      catch (err) { showErr(err.message); }
    });
  });
}
function waitView() {
  const p = ST.profile, pending = mode === "pending";
  return `<div class="login"><div class="login-card">${BRAND}
    <h1>${pending ? "Ihr Konto wird geprüft" : "Konto gesperrt"}</h1>
    <p style="margin:0">${pending ? `Danke, ${esc(p.full_name || "")}! Ihr Antrag für <strong>${esc(p.practice_name)}</strong> ist eingegangen. Sobald Ihr Konto freigeschaltet ist, können Sie loslegen.` : "Dieses Konto ist derzeit gesperrt. Bitte wenden Sie sich an den Support."}</p>
    ${pending ? '<button class="btn primary block" id="wRe">Status erneut prüfen</button>' : ""}
    <button class="btn block" id="wOut">Abmelden</button></div></div>`;
}

/* ---------------- Praxis-Einstellungen ---------------- */
function settingsView(main) {
  const { S } = ST; const p = S.practice;
  const f = (k, l, extra = "") => `<div class="field"><label for="st-${k}">${l}</label><input id="st-${k}" value="${esc(p[k])}" ${extra}></div>`;
  const empty = !S.patients.length && !S.appts.length && !S.invoices.length;
  main.innerHTML = `
    <div class="page-head"><h1>Praxis</h1></div>
    <p class="muted" style="margin:0 0 14px;max-width:65ch">Diese Angaben stehen im Briefkopf und in der Fußzeile jeder neuen Rechnung.</p>
    <form class="panel" id="stForm" novalidate style="padding:18px;display:flex;flex-direction:column;gap:.75rem;max-width:720px">
      ${f("name", "Praxisname")}
      <div class="grid2">${f("owner", "Name Inhaber/in")}${f("title", "Berufsbezeichnung")}</div>
      ${f("street", "Straße und Hausnummer")}
      <div class="grid2" style="grid-template-columns:1fr 2fr">${f("zip", "PLZ")}${f("city", "Ort")}</div>
      <div class="grid2">${f("phone", "Telefon")}${f("email", "E-Mail")}</div>
      <div class="grid2">${f("taxNo", "Steuernummer oder Steuer-ID")}<div class="field"><label for="st-payDays">Zahlungsziel (Tage)</label><input id="st-payDays" type="number" min="0" value="${p.payDays}"></div></div>
      <div class="grid2">${f("bank", "Bank")}${f("iban", "IBAN")}</div>
      <div class="field"><label for="st-taxMode">Umsatzsteuer-Hinweis auf der Rechnung</label>
        <select id="st-taxMode">
          <option value="p4" ${p.taxMode === "p4" ? "selected" : ""}>Heilbehandlung steuerfrei (§ 4 Nr. 14 UStG)</option>
          <option value="p19" ${p.taxMode === "p19" ? "selected" : ""}>Kleinunternehmer (§ 19 UStG)</option>
          <option value="none" ${p.taxMode === "none" ? "selected" : ""}>Kein Hinweis</option>
        </select></div>
      <div class="field"><label for="st-logo">Logo (erscheint oben rechts auf der Rechnung)</label>
        <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">${p.logo ? `<img src="${p.logo}" alt="Logo" style="height:56px;background:#fff;border:1px solid var(--line);border-radius:6px;padding:4px">` : ""}
          <input id="st-logo" type="file" accept="image/png,image/jpeg">${p.logo ? '<button type="button" class="btn sm" id="stLogoDel">Logo entfernen</button>' : ""}</div></div>
      <div class="field"><label for="st-start">Nächste Rechnungsnummer ${YEAR}</label>
        <div style="display:flex;gap:.4rem;align-items:center"><span>${YEAR}-</span><input id="st-start" type="number" min="1" step="1" style="max-width:120px"></div>
        <span class="muted small" id="st-startHint">Die nächste Rechnung bekommt diese Nummer, danach geht es fortlaufend weiter.</span></div>
      <div><button class="btn primary" type="submit" id="stSave">Speichern</button></div>
    </form>
    ${empty ? `<div class="panel" style="padding:18px;margin-top:16px;max-width:720px;display:flex;flex-direction:column;gap:.5rem">
      <h2>Zum Ausprobieren</h2>
      <p class="muted" style="margin:0">Füllt Ihre noch leere Praxis mit erfundenen Beispieldaten aus den letzten Monaten: Leistungen, Kunden, Termine und Rechnungen. Nur für Testkonten gedacht, denn Rechnungen lassen sich danach nicht mehr löschen.</p>
      <div><button class="btn" id="loadDemo">Beispieldaten laden</button></div><div id="demoMsg" class="muted small"></div>
    </div>` : ""}`;
  let logo = p.logo, counter = 0;
  const startInp = $("#st-start");
  const hint = () => { const n = Math.max(1, parseInt(startInp.value) || 1); $("#st-startHint").textContent = `Die nächste Rechnung bekommt die Nummer ${YEAR}-${String(n).padStart(3, "0")}, danach geht es fortlaufend weiter.`; };
  api.invoiceCounter(YEAR).then((n) => { counter = n || 0; startInp.value = counter + 1; hint(); }).catch(() => {});
  startInp.oninput = hint;
  $("#st-logo").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { logo = await imageToDataUrl(file); toast("Logo geladen. Zum Übernehmen speichern."); } catch (err) { toastError(err); }
  };
  const ldel = $("#stLogoDel"); if (ldel) ldel.onclick = () => { logo = ""; ldel.closest(".field").querySelector("img")?.remove(); ldel.remove(); };
  $("#stForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const next = { ...p, logo };
    ["name", "owner", "title", "street", "zip", "city", "phone", "email", "taxNo", "bank", "iban"].forEach((k) => (next[k] = $("#st-" + k).value.trim()));
    next.payDays = Math.max(0, parseInt($("#st-payDays").value) || 14); next.taxMode = $("#st-taxMode").value;
    busy($("#stSave"), async () => {
      try {
        const nextNo = parseInt(startInp.value);
        if (nextNo >= 1 && nextNo - 1 !== counter) { await api.setInvoiceStart(YEAR, nextNo - 1); counter = nextNo - 1; }
        S.practice = await api.savePractice(next); S.practiceSaved = true; toast("Praxisdaten gespeichert"); render();
      } catch (err) { toastError(err); }
    });
  });
  const ld = $("#loadDemo");
  if (ld) ld.onclick = () => { if (!armed(ld, "Ja, Beispieldaten laden")) return; busy(ld, () => loadDemo((t) => ($("#demoMsg").textContent = t))); };
}

const YEAR = new Date().getFullYear();
// Logo verkleinern (max. 600 px breit) und als PNG-Daten speichern
function imageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 5e6) return reject(new Error("Das Bild ist zu groß (max. 5 MB)."));
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 600 / img.width), c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Das Bild konnte nicht gelesen werden."));
    img.src = url;
  });
}

async function loadDemo(progress) {
  const { S } = ST;
  try {
    if (!S.practiceSaved) { S.practice = await api.savePractice({ ...S.practice, street: S.practice.street || "Musterweg 1", zip: S.practice.zip || "10115", city: S.practice.city || "Berlin" }); S.practiceSaved = true; }
    progress("Leistungen werden angelegt …");
    const svcs = [["Erstanamnese & Untersuchung", 60, 90], ["Folgebehandlung", 45, 65], ["Akupunktur", 30, 45], ["Schröpfmassage", 30, 40], ["Infusionstherapie", 45, 55], ["Telefonische Beratung", 15, 20]];
    const services = (await api.insertMany("services", svcs.map(([name, duration, price]) => ({ name, duration, price, code: "", active: true })), api.mappers.svcTo)).map(api.mappers.svcFrom);
    progress("Kunden werden angelegt …");
    const P = [["Lena", "Beispiel", "Lindenstraße 12", "10115", "Berlin"], ["Jonas", "Muster", "Am Hang 3", "14467", "Potsdam"], ["Aylin", "Probe", "Gartenweg 8a", "10997", "Berlin"], ["Peter", "Testmann", "Bahnhofstr. 40", "12555", "Berlin"],
      ["Sofia", "Exempel", "Kastanienallee 7", "10435", "Berlin"], ["Karl", "Vorlage", "Dorfstraße 2", "15344", "Strausberg"], ["Mia", "Fiktiv", "Rosenweg 15", "12203", "Berlin"], ["Emre", "Platzhalter", "Sonnenallee 101", "12045", "Berlin"]];
    const patients = (await api.insertMany("patients", P.map(([first, last, street, zip, city]) => ({ first, last, street, zip, city, birth: "", phone: "", email: "" })), api.mappers.patTo)).map(api.mappers.patFrom);
    progress("Termine werden angelegt …");
    const now = new Date(), from = new Date(now.getFullYear(), now.getMonth() - 3, 1), until = addDays(startOfWeek(now), 19);
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const combos = [[1], [1], [2], [1, 2], [3], [2, 3], [4], [5], [1, 3]];
    const appts = []; const seen = new Set();
    for (let d = new Date(from); d < until; d = addDays(d, 1)) {
      if ((d.getDay() + 6) % 7 > 4) continue;
      const hours = [8, 9, 10, 11, 13, 14, 15, 16].sort(() => rnd() - 0.5).slice(0, 1 + Math.floor(rnd() * 3)).sort((a, b) => a - b);
      for (const h of hours) {
        const p = patients[Math.floor(rnd() * patients.length)]; const first = !seen.has(p.id); seen.add(p.id);
        const sids = (first ? [0] : combos[Math.floor(rnd() * combos.length)]).map((i) => services[i].id);
        const st = new Date(d); st.setHours(h, rnd() < 0.3 ? 30 : 0, 0, 0);
        const dur = sids.reduce((t, id) => t + services.find((s) => s.id === id).duration, 0);
        const past = addMin(st, dur) < now, r = rnd();
        appts.push({ patientId: p.id, start: toLocalStr(st), duration: dur, serviceIds: sids, status: past ? (r < 0.05 ? "ausgefallen" : r < 0.09 ? "abgesagt" : "durchgefuehrt") : "geplant", note: "" });
      }
    }
    const savedAppts = (await api.insertMany("appointments", appts, api.mappers.apptTo)).map(api.mappers.apptFrom);
    S.services.push(...services); S.patients.push(...patients); S.appts.push(...savedAppts);
    // Monatliche Sammelrechnungen für abgeschlossene Monate
    const jobs = [];
    for (let m = new Date(from); m < new Date(now.getFullYear(), now.getMonth(), 1); m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const key = ymd(m).slice(0, 7), invDate = ymd(new Date(m.getFullYear(), m.getMonth() + 1, 2)), byP = {};
      savedAppts.filter((a) => a.status === "durchgefuehrt" && a.start.startsWith(key)).forEach((a) => (byP[a.patientId] = byP[a.patientId] || []).push(a.id));
      Object.entries(byP).forEach(([pid, ids]) => jobs.push({ pid, ids, invDate }));
    }
    for (let k = 0; k < jobs.length; k++) {
      progress(`Rechnungen werden erstellt (${k + 1} von ${jobs.length}) …`);
      const j = jobs[k];
      let inv = await api.createInvoice(j.pid, j.ids, j.invDate);
      if ((now - parseLocal(j.invDate)) / 86400000 > 20) inv = await api.setInvoiceStatus(inv.id, "bezahlt");
      S.invoices.push(inv); S.appts.forEach((a) => { if (j.ids.includes(a.id)) a.invoiceId = inv.id; });
    }
    progress(""); toast("Beispieldaten geladen"); go("kalender");
  } catch (e) { toastError(e); progress("Abgebrochen: " + e.message); }
}

/* ---------------- Admin: Konten (ohne Zugriff auf Praxisdaten) ---------------- */
const ACC = { pending: ["Wartet auf Freischaltung", "s-offen"], active: ["Aktiv", "s-durchgefuehrt"], blocked: ["Gesperrt", "s-abgesagt"] };
async function accountsView(main) {
  if (!adminAccounts) {
    main.innerHTML = `<div class="page-head"><h1>Konten</h1></div><div class="panel empty">Konten werden geladen …</div>`;
    try { adminAccounts = await api.admin.list(); } catch (e) { main.innerHTML = `<div class="page-head"><h1>Konten</h1></div><div class="alert bad">${esc(e.message)}</div>`; return; }
    render(); return;
  }
  const users = adminAccounts.filter((a) => a.role === "user");
  const pending = users.filter((a) => a.status === "pending");
  const f = ST.UI.acctFilter;
  const list = users.filter((a) => f === "alle" || a.status === f).sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email, "de"));
  const extra = (a) => a.invited_at && !a.last_sign_in_at ? ' <span class="pill s-geplant">Einladung offen</span>' : !a.email_confirmed_at ? ' <span class="pill s-abgesagt">E-Mail unbestätigt</span>' : "";
  main.innerHTML = `
    <div class="page-head"><h1>Konten</h1><span class="spacer"></span><button class="btn" id="reload">Aktualisieren</button><button class="btn primary" id="invite">+ Praxis einladen</button></div>
    <div class="kpis">
      <div class="panel kpi"><div class="label">Aktive Praxen</div><div class="v num">${users.filter((a) => a.status === "active").length}</div></div>
      <div class="panel kpi"><div class="label">Warten auf Freischaltung</div><div class="v num">${pending.length}</div></div>
      <div class="panel kpi"><div class="label">Gesperrt</div><div class="v num">${users.filter((a) => a.status === "blocked").length}</div></div>
    </div>
    <h2 style="margin-bottom:10px">Neue Anträge</h2>
    ${pending.length ? `<div class="cards" style="margin-bottom:22px">${pending.map((a) => `
      <div class="panel bill-card">
        <div><strong>${esc(a.full_name || "–")}</strong><div class="muted small">${esc(a.title)} · ${esc(a.practice_name)}</div></div>
        <div class="small" style="overflow-wrap:anywhere">${esc(a.email)}${extra(a)}<br><span class="muted">Beantragt am ${fmtDate(new Date(a.created_at))}</span></div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn primary sm" data-approve="${a.id}">Freischalten</button><button class="btn sm danger" data-reject="${a.id}">Ablehnen</button></div>
      </div>`).join("")}</div>` : `<div class="panel empty" style="margin-bottom:22px">Keine offenen Anträge.</div>`}
    <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin-bottom:10px"><h2>Alle Praxis-Konten</h2><span style="flex:1"></span>
      <div class="seg" role="group" aria-label="Filter">${[["alle", "Alle"], ["active", "Aktiv"], ["pending", "Wartend"], ["blocked", "Gesperrt"]].map(([k, l]) => `<button data-af="${k}" aria-pressed="${f === k}">${l}</button>`).join("")}</div></div>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Name / Praxis</th><th>E-Mail</th><th>Status</th><th>Registriert</th><th>Letzte Anmeldung</th><th class="r">Aktionen</th></tr></thead>
      <tbody>${list.map((a) => `<tr><td><strong>${esc(a.full_name || "–")}</strong><div class="muted small">${esc(a.practice_name)}</div></td><td style="overflow-wrap:anywhere">${esc(a.email)}</td>
        <td><span class="pill ${ACC[a.status][1]}">${ACC[a.status][0]}</span>${extra(a)}</td>
        <td class="num">${fmtDate(new Date(a.created_at))}</td><td class="num">${fmtTs(a.last_sign_in_at)}</td>
        <td class="r"><div class="row-actions">
          ${a.status === "pending" ? `<button class="btn sm primary" data-approve="${a.id}">Freischalten</button>` : ""}
          ${a.status === "active" ? `<button class="btn sm" data-block="${a.id}">Sperren</button>` : ""}
          ${a.status === "blocked" ? `<button class="btn sm" data-unblock="${a.id}">Entsperren</button>` : ""}
        </div></td></tr>`).join("") || '<tr><td colspan="6" class="empty">Keine Konten in dieser Ansicht.</td></tr>'}</tbody>
    </table></div>
    <div class="alert info" style="margin-top:14px;max-width:80ch">Admins haben keinen Zugriff auf Kunden, Termine, Leistungen oder Rechnungen der Praxen und können weder Passwörter sehen noch vergeben. Das erzwingt die Datenbank selbst. Passwörter setzen die Praxen ausschließlich selbst, über den Einladungslink oder „Passwort vergessen“.</div>`;
  const refresh = async () => { adminAccounts = await api.admin.list(); render(); };
  const act = (btn, fn, msg) => busy(btn, async () => { try { await fn(); await refresh(); toast(msg); } catch (e) { toastError(e); } });
  const byId = (id) => adminAccounts.find((a) => a.id === id);
  $("#reload").onclick = (e) => busy(e.currentTarget, async () => { try { await refresh(); } catch (er) { toastError(er); } });
  $$("[data-af]").forEach((b) => (b.onclick = () => { ST.UI.acctFilter = b.dataset.af; render(); }));
  $$("[data-approve]").forEach((b) => (b.onclick = () => act(b, () => api.admin.setStatus(b.dataset.approve, "active"), `${byId(b.dataset.approve).full_name || "Konto"} ist freigeschaltet`)));
  $$("[data-reject]").forEach((b) => (b.onclick = () => { if (armed(b, "Wirklich ablehnen?")) act(b, () => api.admin.reject(b.dataset.reject), "Antrag abgelehnt und gelöscht"); }));
  $$("[data-block]").forEach((b) => (b.onclick = () => { if (armed(b, "Wirklich sperren?")) act(b, () => api.admin.setStatus(b.dataset.block, "blocked"), "Konto gesperrt"); }));
  $$("[data-unblock]").forEach((b) => (b.onclick = () => act(b, () => api.admin.setStatus(b.dataset.unblock, "active"), "Konto entsperrt")));
  $("#invite").onclick = () => openInvite(refresh);
}
function openInvite(refresh) {
  modal(`<div class="modal-head"><h2>Praxis einladen</h2><button class="btn ghost sm" data-close aria-label="Schließen">✕</button></div>
    <form class="modal-body" novalidate>
      <div class="field"><label for="na-name">Name *</label><input id="na-name"></div>
      <div class="grid2"><div class="field"><label for="na-practice">Praxisname *</label><input id="na-practice"></div><div class="field"><label for="na-title">Berufsbezeichnung</label><input id="na-title" value="Heilpraktiker/in"></div></div>
      <div class="field"><label for="na-mail">E-Mail *</label><input id="na-mail" type="email"></div>
      <p class="muted small" style="margin:0">Die Praxis bekommt eine E-Mail mit einem Link und legt darüber ihr eigenes Passwort fest. Das Konto ist sofort freigeschaltet.</p>
      <div id="naErr"></div>
    </form>
    <div class="modal-foot"><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="naSave">Einladung senden</button></div>`);
  const btn = $("#naSave");
  btn.onclick = () => {
    const v = (k) => $("#na-" + k).value.trim(); const err = [];
    if (!v("name")) err.push("Bitte einen Namen eingeben."); if (!v("practice")) err.push("Bitte den Praxisnamen eingeben.");
    if (!validEmail(v("mail"))) err.push("Bitte eine gültige E-Mail-Adresse eingeben.");
    if (err.length) return ($("#naErr").innerHTML = `<div class="alert bad">${err.map(esc).join("<br>")}</div>`);
    busy(btn, async () => {
      const email = v("mail");
      try { await api.admin.invite({ email, full_name: v("name"), practice_name: v("practice"), title: v("title") }); closeModal(); toast(`Einladung an ${email} gesendet`); await refresh(); }
      catch (e) { $("#naErr").innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; }
    });
  };
}

boot();
