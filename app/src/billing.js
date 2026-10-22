// Rechnungen, PDF und Statistik
import { jsPDF } from "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm";
import { $, $$, esc, eur, eur0, eurPdf, ymd, parseLocal, addDays, fmtDate, MONTHS, MONTHS_LONG } from "./util.js";
import { ST, render, go, STATUS, INV_STATUS, pat, svc, loc, pname, apptTotal, apptTitle, billable, unbilledDone, isOwn, taxNote, toast, toastError, modal, closeModal, busy, armed } from "./state.js";
import * as api from "./api.js";

/* ---------------- Rechnungen: Reiter ---------------- */
const BILL_TABS = [["rechnungen", "Mit Rechnung"], ["ohne", "Ohne Rechnung"], ["gutscheine", "Gutscheine"]];
export function invoicesView(main) {
  const { UI } = ST;
  if (!BILL_TABS.some(([k]) => k === UI.billTab)) UI.billTab = "rechnungen";
  main.innerHTML = `
    <div class="page-head"><h1>Rechnungen</h1><span class="spacer"></span>
      <div class="seg" role="group" aria-label="Ansicht">${BILL_TABS.map(([k, l]) => `<button data-tab="${k}" aria-pressed="${UI.billTab === k}">${l}</button>`).join("")}</div></div>
    <div id="billHost"></div>`;
  $$("[data-tab]").forEach((b) => (b.onclick = () => { UI.billTab = b.dataset.tab; render(); }));
  const host = $("#billHost");
  if (UI.billTab === "ohne") unbilledView(host);
  else if (UI.billTab === "gutscheine") vouchersView(host);
  else invoiceListView(host);
}

/* ---------------- Behandlungen ohne Rechnung ---------------- */
function unbilledView(host) {
  const { S } = ST;
  const list = S.appts.filter((a) => !isOwn(a) && !a.needsInvoice && a.status !== "abgesagt").sort((a, b) => b.start.localeCompare(a.start));
  const done = unbilledDone(), y = String(new Date().getFullYear());
  const sumYear = done.filter((a) => a.start.startsWith(y)).reduce((t, a) => t + apptTotal(a), 0);
  host.innerHTML = `
    <div class="kpis">
      <div class="panel kpi"><div class="label">Ohne Rechnung ${y}</div><div class="v num">${eur(sumYear)}</div><div class="muted small">${done.filter((a) => a.start.startsWith(y)).length} durchgeführte Behandlungen</div></div>
      <div class="panel kpi"><div class="label">Ohne Rechnung gesamt</div><div class="v num">${eur(done.reduce((t, a) => t + apptTotal(a), 0))}</div><div class="muted small">${done.length} durchgeführte Behandlungen</div></div>
      <div class="panel kpi"><div class="label">Geplant ohne Rechnung</div><div class="v num">${list.filter((a) => a.status === "geplant").length}</div><div class="muted small">kommende Termine</div></div>
    </div>
    <p class="muted" style="margin:0 0 12px;max-width:70ch">Termine, bei denen „Rechnung nein“ gewählt ist. Durchgeführte Behandlungen zählen in der Statistik mit, zum Preis der Leistung.</p>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Datum</th><th>Kunde</th><th>Ort</th><th>Behandlung</th><th>Status</th><th class="r">Betrag</th></tr></thead>
      <tbody>${list.map((a) => `<tr class="click" data-aid="${a.id}"><td class="num">${fmtDate(parseLocal(a.start))} ${a.start.slice(11, 16)}</td><td>${esc(pname(pat(a.patientId)))}</td><td>${esc(loc(a.locationId)?.name || "–")}</td><td>${esc(apptTitle(a))}</td><td><span class="pill s-${a.status}">${STATUS[a.status]}</span></td><td class="r num">${eur(apptTotal(a))}</td></tr>`).join("")
        || '<tr><td colspan="6" class="empty">Noch keine Termine ohne Rechnung. Im Termin wählen Sie dafür „Rechnung nein“.</td></tr>'}</tbody>
    </table></div>`;
  $$("[data-aid]", host).forEach((r) => (r.onclick = () => import("./records.js").then((m) => m.openAppt(r.dataset.aid))));
}

/* ---------------- Rechnungsliste ---------------- */
function invoiceListView(main) {
  const { S } = ST;
  const groups = {}; billable().forEach((a) => (groups[a.patientId] = groups[a.patientId] || []).push(a));
  const openInv = S.invoices.filter((i) => i.status === "offen"), y = String(new Date().getFullYear());
  const paidYear = S.invoices.filter((i) => i.status === "bezahlt" && i.date.startsWith(y)).reduce((t, i) => t + i.total, 0);
  const toBill = billable().reduce((t, a) => t + apptTotal(a), 0);
  main.innerHTML = `
    <div class="kpis">
      <div class="panel kpi"><div class="label">Noch abzurechnen</div><div class="v num">${eur(toBill)}</div><div class="muted small">${billable().length} durchgeführte Termine</div></div>
      <div class="panel kpi"><div class="label">Offene Rechnungen</div><div class="v num">${eur(openInv.reduce((t, i) => t + i.total, 0))}</div><div class="muted small">${openInv.length} Rechnungen</div></div>
      <div class="panel kpi"><div class="label">Bezahlt ${y}</div><div class="v num">${eur(paidYear)}</div><div class="muted small">nach Rechnungsdatum</div></div>
    </div>
    <h2 style="margin-bottom:10px">Bereit zur Abrechnung</h2>
    ${Object.keys(groups).length ? `<div class="cards" style="margin-bottom:22px">${Object.entries(groups).map(([pid, list]) => `
      <div class="panel bill-card"><div style="display:flex;justify-content:space-between;gap:.5rem"><strong>${esc(pname(pat(pid)))}</strong><span class="num">${eur(list.reduce((t, a) => t + apptTotal(a), 0))}</span></div>
      <ul>${list.sort((a, b) => a.start.localeCompare(b.start)).map((a) => `<li><span class="num">${fmtDate(parseLocal(a.start))}</span>: ${esc(apptTitle(a))}</li>`).join("")}</ul>
      <button class="btn primary sm" data-bill="${pid}" style="align-self:flex-start">${list.length > 1 ? `Sammelrechnung (${list.length} Termine)` : "Rechnung erstellen"}</button></div>`).join("")}</div>`
      : `<div class="panel empty" style="margin-bottom:22px">Alle durchgeführten Termine sind abgerechnet.</div>`}
    <h2 style="margin-bottom:10px">Alle Rechnungen</h2>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Nummer</th><th>Datum</th><th>Kunde</th><th>Ort</th><th>Fällig</th><th>Status</th><th class="r">Betrag</th></tr></thead>
      <tbody>${S.invoices.slice().sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)).map((i) => {
        const due = addDays(parseLocal(i.date), i.payDays), over = i.status === "offen" && due < new Date();
        return `<tr class="click" data-iid="${i.id}"><td class="num"><strong>${i.number}</strong></td><td class="num">${fmtDate(parseLocal(i.date))}</td><td>${esc(i.patient.name)}</td><td>${esc(i.location) || '<span class="muted">–</span>'}</td><td class="num">${i.status === "offen" ? fmtDate(due) + (over ? ' <span class="pill s-ausgefallen">überfällig</span>' : "") : "–"}</td><td><span class="pill s-${i.status}">${INV_STATUS[i.status]}</span></td><td class="r num">${eur(i.total)}</td></tr>`;
      }).join("") || '<tr><td colspan="7" class="empty">Noch keine Rechnungen.</td></tr>'}</tbody>
    </table></div>`;
  $$("[data-bill]").forEach((b) => (b.onclick = () => openCreateInvoice(b.dataset.bill, groups[b.dataset.bill])));
  $$("[data-iid]").forEach((r) => (r.onclick = () => openInvoice(r.dataset.iid)));
}

// Rechnung erstellen: Ort (Hotel) wählen oder neu anlegen, Rechnungsdatum
export function openCreateInvoice(pid, list) {
  const { S } = ST;
  // Vorschlag: der Ort, an dem die meisten dieser Termine stattfanden
  const cnt = {}; list.forEach((a) => a.locationId && (cnt[a.locationId] = (cnt[a.locationId] || 0) + 1));
  let locId = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0]?.[0] || "";
  modal(`
    <div class="modal-head"><h2>Rechnung erstellen</h2><button class="btn ghost sm" data-close aria-label="Schließen">✕</button></div>
    <div class="modal-body">
      <p style="margin:0"><strong>${esc(pname(pat(pid)))}</strong> · ${list.length} ${list.length > 1 ? "Termine" : "Termin"} · <span class="num">${eur(list.reduce((t, a) => t + apptTotal(a), 0))}</span></p>
      <div class="grid2">
        <div class="field"><label for="ci-loc">Ort der Behandlung (Hotel)</label><select id="ci-loc"></select></div>
        <div class="field"><label for="ci-date">Rechnungsdatum</label><input id="ci-date" type="date" value="${ymd(new Date())}"></div>
      </div>
      <div id="ciNewBox" hidden><div class="grid2" style="grid-template-columns:1fr auto;align-items:end">
        <div class="field"><label for="ci-newloc">Neuer Ort (z. B. Name des Hotels)</label><input id="ci-newloc" autocomplete="off"></div>
        <button type="button" class="btn" id="ci-addloc">Hinzufügen</button></div></div>
      <p class="muted small" style="margin:0">Der Ort erscheint auf der Rechnung unter der Rechnungsnummer.</p>
    </div>
    <div class="modal-foot"><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="ciGo">Rechnung erstellen</button></div>`);
  const sel = $("#ci-loc");
  const renderSel = () => {
    const ls = S.locations.filter((l) => l.active || l.id === locId).sort((x, y) => x.name.localeCompare(y.name, "de"));
    sel.innerHTML = `<option value="">– Kein Ort –</option>${ls.map((l) => `<option value="${l.id}" ${l.id === locId ? "selected" : ""}>${esc(l.name)}</option>`).join("")}<option value="__neu">+ Neuen Ort anlegen …</option>`;
  };
  renderSel();
  sel.onchange = () => {
    if (sel.value === "__neu") { $("#ciNewBox").hidden = false; sel.value = locId; setTimeout(() => $("#ci-newloc").focus(), 20); } else locId = sel.value;
  };
  const addLoc = () => {
    const name = $("#ci-newloc").value.trim(); if (!name) return;
    busy($("#ci-addloc"), async () => {
      try {
        const l = S.locations.find((x) => x.name.toLowerCase() === name.toLowerCase()) || await api.saveLocation({ name });
        if (!S.locations.includes(l)) S.locations.push(l);
        locId = l.id; $("#ci-newloc").value = ""; $("#ciNewBox").hidden = true; renderSel();
      } catch (e) { toastError(e); }
    });
  };
  $("#ci-addloc").onclick = addLoc;
  $("#ci-newloc").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addLoc(); } };
  const btn = $("#ciGo");
  btn.onclick = () => busy(btn, async () => {
    try {
      const inv = await api.createInvoice(pid, list.map((a) => a.id), $("#ci-date").value || null, locId || null);
      S.invoices.push(inv); list.forEach((a) => (a.invoiceId = inv.id));
      closeModal(); render(); openInvoice(inv.id); toast(`Rechnung ${inv.number} erstellt`);
    } catch (e) { toastError(e); }
  });
}

// Rechnungslayout wie Manuelas bisherige Rechnungen: Logo und Absender rechts, Positionen als „2 x Leistung á € 78,00“
const num2 = (n) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const ddmm = (d) => fmtDate(parseLocal(d)).slice(0, 6);
// Gleiche Leistung zum gleichen Preis zusammenfassen, Behandlungstage anhängen
function invoiceItems(i) {
  const groups = [];
  i.lines.forEach((l) => {
    let g = groups.find((x) => x.name === l.name && x.price === l.price);
    if (!g) groups.push((g = { name: l.name, price: l.price, qty: 0, dates: [] }));
    g.qty += l.qty; if (!g.dates.includes(l.date)) g.dates.push(l.date);
  });
  return groups.map((g) => {
    const ds = g.dates.slice().sort(), last = fmtDate(parseLocal(ds[ds.length - 1]));
    const when = ds.length === 1 ? last : ds.slice(0, -1).map(ddmm).join(", ") + " und " + last;
    return { text: `${g.qty} x ${g.name}${g.qty > 1 ? ` á € ${num2(g.price)}` : ""} am ${when}`, sum: g.qty * g.price };
  });
}
const taxIdLabel = (t) => (/^\d{11}$/.test(t.replace(/\s/g, "")) ? "Steuer-ID" : "Steuernummer");
const payNote = (i) => (i.payDays > 0 ? `Die Rechnung ist innerhalb von ${i.payDays} Tagen zur Zahlung fällig.` : "");
const SALUTATION = "Sehr geehrte Damen und Herren,";
const INTRO = "wie vereinbart, erlaube ich mir für meine erbrachte Leistung, folgende Rechnung zu stellen:";

function invoiceHtml(i) {
  const pr = i.practice, logo = ST.S.practice.logo, items = invoiceItems(i);
  const to = [[i.patient.name, i.patient.street].filter((t) => t && t.trim()).map(esc).join("<br>"), esc([i.patient.zip, i.patient.city].filter(Boolean).join(" "))].filter(Boolean).join("<br><br>");
  return `<div class="paper inv">
    <div class="inv-head">${logo ? `<img src="${logo}" alt="">` : `<strong>${esc(pr.name)}</strong>`}
      <div>${[pr.owner, pr.street, `${pr.zip} ${pr.city}`].filter((t) => t.trim()).map(esc).join("<br>")}${pr.phone ? `<br>☎ ${esc(pr.phone)}` : ""}${pr.email ? `<br>✉ ${esc(pr.email)}` : ""}</div></div>
    <div class="inv-to">${to}</div>
    <div class="inv-date">${esc(pr.city)}${pr.city ? ", " : ""}${fmtDate(parseLocal(i.date))}</div>
    <p class="inv-no">Rechnung Nr. ${esc(i.number)}${i.status === "storniert" ? ' <span class="inv-storno">STORNIERT</span>' : ""}${i.location ? `<span class="inv-loc">Ort der Behandlung: ${esc(i.location)}</span>` : ""}</p>
    <p>${SALUTATION}</p><p>${INTRO}</p>
    <table class="inv-items"><tbody>${items.map((it) => `<tr><td>${esc(it.text)}</td><td class="r num">€ ${num2(it.sum)}</td></tr>`).join("")}
      <tr class="inv-sum"><td>Gesamtsumme</td><td class="r num">€ ${num2(i.total)}</td></tr></tbody></table>
    <p>${esc(taxNote(pr.taxMode))}${taxNote(pr.taxMode) && payNote(i) ? "<br>" : ""}${esc(payNote(i))}</p>
    <p>Ich bedanke mich für Ihren Auftrag!</p>
    <div class="inv-foot"><div>${pr.bank || pr.iban ? `Bankverbindung:<br>${esc(pr.bank)}${pr.iban ? `<br>IBAN ${esc(pr.iban)}` : ""}` : ""}</div>
      <div>${pr.taxNo ? `${taxIdLabel(pr.taxNo)}: ${esc(pr.taxNo)}` : ""}</div></div>
  </div>`;
}

export function openInvoice(id) {
  const { S } = ST;
  const i = S.invoices.find((x) => x.id === id); if (!i) return;
  modal(`
    <div class="modal-head"><h2>Rechnung ${esc(i.number)}</h2><span class="pill s-${i.status}">${INV_STATUS[i.status]}</span><button class="btn ghost sm" data-close aria-label="Schließen">✕</button></div>
    <div class="modal-body"><div class="paper-wrap">${invoiceHtml(i)}</div>
      ${i.status === "storniert" ? `<div class="alert info">Storniert am ${fmtDate(parseLocal(i.cancelledAt))}. Die Termine sind wieder abrechenbar. Die Rechnungsnummer bleibt vergeben.</div>`
        : `<div class="alert info">Erstellte Rechnungen lassen sich nicht mehr bearbeiten oder löschen, nur stornieren. So bleibt die Nummernfolge lückenlos.</div>`}
    </div>
    <div class="modal-foot">
      <div class="left">${i.status === "offen" ? '<button class="btn" id="paid">Als bezahlt markieren</button>' : ""}${i.status === "bezahlt" ? '<button class="btn" id="unpaid">Zahlung zurücknehmen</button>' : ""}${i.status !== "storniert" ? '<button class="btn danger" id="storno">Stornieren</button>' : ""}</div>
      <button class="btn" data-close>Schließen</button><button class="btn primary" id="pdf">PDF herunterladen</button>
    </div>`, { wide: true });
  const setStatus = (btn, status, msg) => busy(btn, async () => {
    try {
      const upd = await api.setInvoiceStatus(i.id, status);
      Object.assign(i, upd);
      if (status === "storniert") S.appts.forEach((a) => { if (a.invoiceId === i.id) a.invoiceId = null; });
      render(); openInvoice(i.id); if (msg) toast(msg);
    } catch (e) { toastError(e); }
  });
  const paid = $("#paid"); if (paid) paid.onclick = () => setStatus(paid, "bezahlt", "Als bezahlt markiert");
  const unp = $("#unpaid"); if (unp) unp.onclick = () => setStatus(unp, "offen");
  const st = $("#storno"); if (st) st.onclick = () => { if (armed(st, "Wirklich stornieren?")) setStatus(st, "storniert", `Rechnung ${i.number} storniert`); };
  $("#pdf").onclick = () => downloadPdf(i);
}

function buildPdf(i) {
  const doc = new jsPDF({ unit: "mm", format: "a4" }); const pr = i.practice, logo = ST.S.practice.logo;
  const L = 30, R = 182, IL = L + 8, ICUR = 140, INUM = 166;
  doc.setTextColor(25);
  // Kopf: Logo und Absender rechtsbündig
  let y = 18;
  if (logo) {
    const p = doc.getImageProperties(logo), w = 34, h = (w * p.height) / p.width;
    doc.addImage(logo, "PNG", R - w, y, w, h); y += h + 4.5;
  } else { doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text(pr.name || "", R, y + 6, { align: "right" }); y += 11; }
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  [pr.owner, pr.street, `${pr.zip} ${pr.city}`].filter((t) => t && t.trim()).forEach((t) => { doc.text(t, R, y, { align: "right" }); y += 4.1; });
  // Telefon- und Brief-Symbol als kleine Zeichnung (Symbolschriften zeigt nicht jeder PDF-Betrachter an)
  const icon = { phone(x, b) { doc.roundedRect(x - 1.7, b - 2.7, 1.7, 2.9, 0.3, 0.3, "S"); doc.line(x - 1.1, b - 0.35, x - 0.6, b - 0.35); },
    mail(x, b) { doc.rect(x - 2.6, b - 2.1, 2.6, 1.9, "S"); doc.line(x - 2.6, b - 2.1, x - 1.3, b - 1.0); doc.line(x - 1.3, b - 1.0, x, b - 2.1); } };
  doc.setLineWidth(0.2); doc.setDrawColor(25);
  [["phone", pr.phone], ["mail", pr.email]].filter(([, v]) => v).forEach(([k, v]) => {
    doc.text(v, R, y, { align: "right" }); icon[k](R - doc.getTextWidth(v) - 1.2, y); y += 4.1;
  });
  // Empfänger
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5);
  y = Math.max(y + 2, 66);
  [i.patient.name, i.patient.street].filter((t) => t && t.trim()).forEach((t) => { doc.text(t, L, y); y += 4.8; });
  const zc = [i.patient.zip, i.patient.city].filter(Boolean).join(" "); if (zc.trim()) { y += 4.8; doc.text(zc, L, y); }
  // Ort, Datum und Nummer
  y = Math.max(y + 18, 100);
  doc.text(`${pr.city ? pr.city + ", " : ""}${fmtDate(parseLocal(i.date))}`, R, y, { align: "right" });
  y += 20; doc.setFont("helvetica", "bold"); doc.text(`Rechnung Nr. ${i.number}`, L, y);
  if (i.status === "storniert") { doc.setTextColor(170, 30, 30); doc.text("STORNIERT", R, y, { align: "right" }); doc.setTextColor(25); }
  doc.setFont("helvetica", "normal");
  if (i.location) { y += 6; doc.text(`Ort der Behandlung: ${i.location}`, L, y); y += 12; } else y += 18;
  doc.text(SALUTATION, L, y); y += 9;
  doc.text(doc.splitTextToSize(INTRO, R - L), L, y); y += 12;
  // Positionen
  const items = invoiceItems(i);
  items.forEach((it, k) => {
    const lines = doc.splitTextToSize(it.text, ICUR - IL - 4);
    if (y + lines.length * 5 > 250) { doc.addPage(); y = 25; }
    doc.text(lines, IL, y); doc.text("€", ICUR, y); doc.text(num2(it.sum), INUM, y, { align: "right" });
    y += 5 * (lines.length - 1);
    if (k === items.length - 1) { doc.setDrawColor(25); doc.setLineWidth(0.25); doc.line(IL, y + 0.9, INUM, y + 0.9); }
    y += 5;
  });
  y += 2.5; doc.text("Gesamtsumme", IL, y); doc.text(`€ ${num2(i.total)}`, INUM, y, { align: "right" });
  doc.line(IL, y + 0.9, INUM, y + 0.9);
  // Hinweise
  y += 24; if (y > 245) { doc.addPage(); y = 30; }
  [taxNote(pr.taxMode), payNote(i)].filter(Boolean).forEach((t) => { doc.text(doc.splitTextToSize(t, R - L), L, y); y += 5; });
  y += 12; doc.text("Ich bedanke mich für Ihren Auftrag!", L, y);
  // Fuß: Bank links, Steuer-ID rechts
  doc.setFontSize(9.5); const fy = 268;
  if (pr.bank || pr.iban) doc.text(["Bankverbindung:", pr.bank, pr.iban ? `IBAN ${pr.iban}` : ""].filter(Boolean), L, fy);
  if (pr.taxNo) doc.text(`${taxIdLabel(pr.taxNo)}: ${pr.taxNo}`, R, fy, { align: "right" });
  return doc;
}
function downloadPdf(i) {
  try { buildPdf(i).save(`Rechnung_${i.number}_${i.patient.name.replace(/\s+/g, "_")}.pdf`); }
  catch (e) { toastError(e); }
}

/* ---------------- Gutscheine ---------------- */
const byNumber = (a, b) => a.year - b.year || a.seq - b.seq;
function vouchersView(host) {
  const { S } = ST;
  const list = S.vouchers.slice().sort(byNumber);
  host.innerHTML = `
    <div class="page-head" style="margin-bottom:12px"><span class="muted">${list.length} Gutschein${list.length === 1 ? "" : "e"} · zusammen <span class="num">${eur(list.reduce((t, v) => t + v.amount, 0))}</span></span>
      <span class="spacer"></span><button class="btn primary" id="newVoucher2">+ Neuer Gutschein</button></div>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Nummer</th><th>Ausgestellt</th><th>Name</th><th>Leistung</th><th class="r">Betrag</th><th class="r">PDF</th></tr></thead>
      <tbody>${list.map((v) => `<tr class="click" data-vid="${v.id}"><td class="num"><strong>${esc(v.number)}</strong></td><td class="num">${fmtDate(parseLocal(v.date))}</td><td>${esc(v.recipient)}</td><td>${esc(v.service) || '<span class="muted">–</span>'}</td><td class="r num">${eur(v.amount)}</td><td class="r"><button class="btn sm" data-vpdf="${v.id}">PDF</button></td></tr>`).join("")
        || '<tr><td colspan="6" class="empty">Noch keine Gutscheine. Neue Gutscheine legen Sie hier oder im Kalender an.</td></tr>'}</tbody>
    </table></div>`;
  $("#newVoucher2").onclick = () => openVoucher(null);
  $$("[data-vid]", host).forEach((r) => (r.onclick = () => openVoucher(r.dataset.vid)));
  $$("[data-vpdf]", host).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); downloadVoucher(S.vouchers.find((v) => v.id === b.dataset.vpdf)); }));
}

export function openVoucher(id) {
  const { S } = ST;
  const existing = id ? S.vouchers.find((v) => v.id === id) : null;
  const v = existing ? { ...existing } : { recipient: "", amount: "", service: "", date: ymd(new Date()) };
  const active = S.services.filter((s) => s.active);
  modal(`
    <div class="modal-head"><h2>${existing ? "Gutschein " + esc(v.number) : "Neuer Gutschein"}</h2><button class="btn ghost sm" data-close aria-label="Schließen">✕</button></div>
    <form class="modal-body" id="vfForm" novalidate>
      <div class="field"><label for="vf-name">Name des Kunden *</label><input id="vf-name" value="${esc(v.recipient)}" autocomplete="off" list="vf-pats"></div>
      <datalist id="vf-pats">${S.patients.map((p) => `<option value="${esc(pname(p))}">`).join("")}</datalist>
      <div class="grid2" style="grid-template-columns:2fr 1fr">
        <div class="field"><label for="vf-svc">Leistung</label><input id="vf-svc" value="${esc(v.service)}" autocomplete="off" list="vf-svcs" placeholder="z. B. Massage 60 Minuten"></div>
        <div class="field"><label for="vf-amount">Betrag in € *</label><input id="vf-amount" type="number" min="0" step="0.5" value="${v.amount}"></div>
      </div>
      <datalist id="vf-svcs">${active.map((s) => `<option value="${esc(s.name)}">`).join("")}</datalist>
      ${existing ? `<p class="muted" style="font-size:.85rem;margin:0">Ausgestellt am ${fmtDate(parseLocal(v.date))}. Nummer und Datum bleiben fest.</p>`
        : `<div class="field" style="max-width:220px"><label for="vf-date">Ausstellungsdatum</label><input id="vf-date" type="date" value="${v.date}"></div>
           <p class="muted" style="font-size:.85rem;margin:0">Die Nummer wird automatisch vergeben (GU + Jahr + laufende Nummer, z. B. GU${v.date.slice(0, 4)}01).</p>`}
      <div id="vfErr"></div>
    </form>
    <div class="modal-foot">
      ${existing ? '<div class="left"><button class="btn" id="vfPdf">PDF herunterladen</button></div>' : ""}
      <button class="btn" data-close>Abbrechen</button><button class="btn primary" id="vfSave">${existing ? "Speichern" : "Gutschein erstellen"}</button>
    </div>`);
  // Leistung aus der Liste gewählt: Preis als Betrag vorschlagen, solange noch keiner eingetragen ist
  $("#vf-svc").oninput = (e) => { const s = active.find((x) => x.name === e.target.value); if (s && !$("#vf-amount").value) $("#vf-amount").value = s.price; };
  const pdf = $("#vfPdf"); if (pdf) pdf.onclick = () => downloadVoucher(existing);
  const btn = $("#vfSave");
  btn.onclick = () => {
    const data = { id: v.id, recipient: $("#vf-name").value.trim(), service: $("#vf-svc").value.trim(),
      amount: Math.round(parseFloat($("#vf-amount").value) * 100) / 100, date: existing ? v.date : $("#vf-date").value };
    const err = [];
    if (!data.recipient) err.push("Bitte den Namen eintragen.");
    if (!(data.amount >= 0)) err.push("Bitte einen gültigen Betrag eintragen.");
    if (!data.date) err.push("Bitte ein Ausstellungsdatum wählen.");
    if (err.length) { $("#vfErr").innerHTML = `<div class="alert bad">${err.join("<br>")}</div>`; return; }
    busy(btn, async () => {
      try {
        if (existing) { Object.assign(existing, await api.updateVoucher(data)); closeModal(); render(); toast("Gutschein gespeichert"); return; }
        const saved = await api.createVoucher(data); S.vouchers.push(saved);
        ST.UI.billTab = "gutscheine"; closeModal(); go("rechnungen"); downloadVoucher(saved); toast(`Gutschein ${saved.number} erstellt`);
      } catch (e) { toastError(e); }
    });
  };
}

function buildVoucherPdf(v) {
  const pr = ST.S.practice;
  const doc = new jsPDF({ unit: "mm", format: "a5", orientation: "landscape" }); const W = 210, H = 148, cx = W / 2;
  doc.setDrawColor(29, 94, 105); doc.setLineWidth(1.2); doc.rect(8, 8, W - 16, H - 16);
  doc.setLineWidth(0.3); doc.rect(11, 11, W - 22, H - 22);
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(29, 94, 105);
  doc.text(pr.name || "", cx, 24, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(90);
  const sub = [`${pr.owner || ""}${pr.title ? ", " + pr.title : ""}`, [pr.street, [pr.zip, pr.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ")].filter((t) => t.trim());
  doc.text(sub, cx, 29, { align: "center" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(34); doc.setTextColor(20);
  doc.text("GUTSCHEIN", cx, 56, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(60);
  doc.text("für", cx, 69, { align: "center" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(20);
  doc.text(doc.splitTextToSize(v.recipient, W - 50), cx, 78, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(60);
  doc.text("im Wert von", cx, 91, { align: "center" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(22); doc.setTextColor(29, 94, 105);
  doc.text(eurPdf(v.amount).replace(" EUR", " €"), cx, 101, { align: "center" });
  if (v.service) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(11.5); doc.setTextColor(40);
    doc.text(doc.splitTextToSize(`einzulösen für: ${v.service}`, W - 50), cx, 111, { align: "center" });
  }
  doc.setDrawColor(150); doc.setLineWidth(0.2); doc.line(W - 80, 128, W - 22, 128);
  doc.setFontSize(8); doc.setTextColor(100); doc.text("Datum, Unterschrift", W - 51, 132, { align: "center" });
  doc.text([`Gutschein-Nr. ${v.number}`, `Ausgestellt am ${fmtDate(parseLocal(v.date))}`], 22, 125);
  const contact = [pr.phone, pr.email].filter(Boolean).join(" · ");
  if (contact) doc.text(contact, 22, 133);
  return doc;
}
function downloadVoucher(v) {
  if (!v) return;
  try { buildVoucherPdf(v).save(`Gutschein_${v.number}_${v.recipient.replace(/\s+/g, "_")}.pdf`); }
  catch (e) { toastError(e); }
}

/* ---------------- Statistik ---------------- */
const eurShort = (n) => (n >= 1000 ? (n / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " T€" : Math.round(n) + " €");
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
function roundTop(x, y, w, h, r) { r = Math.min(r, w / 2, h); if (h <= 0) return ""; return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }
function roundRight(x, y, w, h, r) { r = Math.min(r, h / 2, w); if (w <= 0) return ""; return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`; }

function yearStats(y) {
  const { S } = ST; const ys = String(y);
  const inv = S.invoices.filter((i) => i.status !== "storniert" && i.date.startsWith(ys));
  // Behandlungen mit "Rechnung nein" zählen nach Termindatum zum Preis der Leistungen
  const noInv = unbilledDone().filter((a) => a.start.startsWith(ys));
  const months = Array.from({ length: 12 }, () => ({ paid: 0, open: 0, noinv: 0, count: 0, noinvCount: 0 }));
  inv.forEach((i) => { const m = +i.date.slice(5, 7) - 1; months[m][i.status === "bezahlt" ? "paid" : "open"] += i.total; months[m].count++; });
  noInv.forEach((a) => { const m = +a.start.slice(5, 7) - 1; months[m].noinv += apptTotal(a); months[m].noinvCount++; });
  const invTotal = inv.reduce((t, i) => t + i.total, 0), paid = inv.filter((i) => i.status === "bezahlt").reduce((t, i) => t + i.total, 0);
  const noinv = noInv.reduce((t, a) => t + apptTotal(a), 0), total = invTotal + noinv;
  const appts = S.appts.filter((a) => !isOwn(a) && a.start.startsWith(ys));
  const done = appts.filter((a) => a.status === "durchgefuehrt").length, noshow = appts.filter((a) => a.status === "ausgefallen").length;
  const bySvc = {}; inv.forEach((i) => i.lines.forEach((l) => (bySvc[l.name] = (bySvc[l.name] || 0) + l.qty * l.price)));
  noInv.forEach((a) => a.serviceIds.forEach((id) => { const s = svc(id); if (s) bySvc[s.name] = (bySvc[s.name] || 0) + s.price; }));
  return { inv, noInv, months, total, paid, open: invTotal - paid, noinv, done, noshow, bySvc };
}

export function statsView(main) {
  const { S, UI } = ST;
  const now = new Date(), cy = now.getFullYear();
  const years = [...new Set(S.invoices.map((i) => +i.date.slice(0, 4)).concat(unbilledDone().map((a) => +a.start.slice(0, 4)), [cy]))].sort();
  if (!years.includes(UI.statYear)) UI.statYear = cy;
  const y = UI.statYear, st = yearStats(y), prev = yearStats(y - 1);
  const isCur = y === cy, lastM = isCur ? now.getMonth() : 11;
  const mTotal = (m) => m.paid + m.open + m.noinv;
  const prevSame = prev.months.slice(0, lastM + 1).reduce((t, m) => t + mTotal(m), 0);
  const curSame = st.months.slice(0, lastM + 1).reduce((t, m) => t + mTotal(m), 0);
  const delta = prevSame ? ((curSame - prevSame) / prevSame) * 100 : null;
  const toBill = billable().reduce((t, a) => t + apptTotal(a), 0);
  const quote = st.done + st.noshow ? (st.noshow / (st.done + st.noshow)) * 100 : 0;
  main.innerHTML = `
    <div class="page-head"><h1>Statistik</h1><span class="spacer"></span>
      <div class="seg" role="group" aria-label="Jahr">${years.map((v) => `<button data-year="${v}" aria-pressed="${v === y}" class="num">${v}</button>`).join("")}</div></div>
    <div class="kpis kpis4">
      <div class="panel kpi"><div class="label">Umsatz ${y}${isCur ? " bisher" : ""}</div><div class="v num">${eur0(st.total)}</div>
        <div class="muted small">${delta === null ? "Kein Vorjahr zum Vergleich" : `<span class="${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toLocaleString("de-DE", { maximumFractionDigits: 0 })} %</span> ggü. ${isCur ? "Jan–" + MONTHS[lastM] + " " : ""}${y - 1}`}</div></div>
      <div class="panel kpi"><div class="label">Davon bezahlt</div><div class="v num">${eur0(st.paid)}</div><div class="muted small">Offen: <span class="num">${eur0(st.open)}</span>${st.noinv ? ` · ohne Rechnung: <span class="num">${eur0(st.noinv)}</span>` : ""}</div></div>
      <div class="panel kpi"><div class="label">Ø pro Monat</div><div class="v num">${eur0(st.total / (lastM + 1))}</div><div class="muted small">über ${lastM + 1} Monat${lastM ? "e" : ""}</div></div>
      <div class="panel kpi"><div class="label">Behandlungen</div><div class="v num">${st.done.toLocaleString("de-DE")}</div><div class="muted small">Ausfallquote <span class="num">${quote.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %</span></div></div>
    </div>
    ${isCur && toBill ? `<div class="alert warn" style="margin-bottom:16px;display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">Noch nicht abgerechnet: <strong class="num">${eur(toBill)}</strong> aus ${billable().length} durchgeführten Terminen. <button class="btn sm" data-go2="rechnungen">Jetzt abrechnen</button></div>` : ""}
    <div class="panel chart-card">
      <div class="chart-head"><div><h2>Umsatz pro Monat ${y}</h2><p class="muted small" style="margin:.15rem 0 0">Rechnungen nach Rechnungsdatum (ohne stornierte), Behandlungen ohne Rechnung nach Termindatum</p></div>
        <div class="legend-row"><span><i class="sw" style="background:var(--c1)"></i>Bezahlt</span><span><i class="sw" style="background:var(--c2)"></i>Offen</span><span><i class="sw" style="background:var(--c3)"></i>Ohne Rechnung</span></div></div>
      <div class="chart" id="chMonth"></div>
      <details class="tbl-toggle"><summary>Als Tabelle anzeigen</summary>
        <div class="table-wrap"><table><thead><tr><th>Monat</th><th class="r">Rechnungen</th><th class="r">Bezahlt</th><th class="r">Offen</th><th class="r">Ohne Rechnung</th><th class="r">Gesamt</th></tr></thead>
        <tbody>${st.months.map((m, i) => `<tr><td>${MONTHS_LONG[i]}</td><td class="r num">${m.count}</td><td class="r num">${eur(m.paid)}</td><td class="r num">${eur(m.open)}</td><td class="r num">${eur(m.noinv)}</td><td class="r num"><strong>${eur(mTotal(m))}</strong></td></tr>`).join("")}
        <tr><td><strong>Summe</strong></td><td class="r num">${st.inv.length}</td><td class="r num">${eur(st.paid)}</td><td class="r num">${eur(st.open)}</td><td class="r num">${eur(st.noinv)}</td><td class="r num"><strong>${eur(st.total)}</strong></td></tr></tbody></table></div>
      </details>
    </div>
    <div class="panel chart-card" style="margin-top:16px">
      <div class="chart-head"><div><h2>Umsatz nach Leistung ${y}</h2><p class="muted small" style="margin:.15rem 0 0">Welche Behandlungen tragen am meisten bei</p></div></div>
      <div class="chart" id="chSvc"></div>
    </div>`;
  $$("[data-year]").forEach((b) => (b.onclick = () => { UI.statYear = +b.dataset.year; render(); }));
  $$("[data-go2]").forEach((b) => (b.onclick = () => go(b.dataset.go2)));
  drawMonthly($("#chMonth"), st.months, y);
  drawServices($("#chSvc"), Object.entries(st.bySvc).sort((a, b) => b[1] - a[1]), st.total);
}

function drawMonthly(el, months, y) {
  const W = Math.max(300, el.clientWidth), H = W < 500 ? 220 : 280, m = { t: 24, r: 8, b: 28, l: W < 500 ? 40 : 56 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const totals = months.map((x) => x.paid + x.open + x.noinv), max = Math.max(...totals, 1);
  const step = niceStep(max / 4), top = Math.ceil(max / step) * step;
  const sy = (v) => m.t + ih - (v / top) * ih, bw = iw / 12, barW = Math.min(36, bw * 0.62);
  const now = new Date(); const future = (i) => y === now.getFullYear() && i > now.getMonth();
  const maxI = totals.indexOf(Math.max(...totals));
  let g = "";
  for (let v = 0; v <= top + 0.001; v += step) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}" class="${v === 0 ? "axis" : "grid"}"/><text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end" class="tick">${W < 500 ? eurShort(v) : eur0(v)}</text>`;
  let bars = "";
  months.forEach((x, i) => {
    const cx = m.l + bw * i + bw / 2, x0 = cx - barW / 2;
    // Gestapelt von unten: bezahlt, offen, ohne Rechnung; nur das oberste Segment bekommt runde Ecken
    const segs = [[x.paid, "var(--c1)"], [x.open, "var(--c2)"], [x.noinv, "var(--c3)"]].filter(([v]) => v > 0);
    let base = 0;
    segs.forEach(([v, col], k) => {
      const h = (v / top) * ih, gap = k > 0 ? 2 : 0, last = k === segs.length - 1;
      bars += last ? `<path d="${roundTop(x0, sy(base + v), barW, Math.max(0, h - gap), 4)}" fill="${col}"/>`
        : `<rect x="${x0}" y="${sy(base + v)}" width="${barW}" height="${Math.max(0, h - gap)}" fill="${col}"/>`;
      base += v;
    });
    if (future(i)) bars += `<text x="${cx}" y="${sy(0) - 6}" text-anchor="middle" class="tick">–</text>`;
    bars += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="tick">${MONTHS[i]}</text>`;
    bars += `<rect class="hit" data-i="${i}" x="${m.l + bw * i}" y="${m.t}" width="${bw}" height="${ih}" fill="transparent"/>`;
  });
  const lbl = totals[maxI] > 0 ? `<text x="${m.l + bw * maxI + bw / 2}" y="${sy(totals[maxI]) - 7}" text-anchor="middle" class="dlabel">${eur0(totals[maxI])}</text>` : "";
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Umsatz pro Monat ${y}, gestapelt nach bezahlt, offen und ohne Rechnung"><rect id="hl" x="${m.l}" y="${m.t}" width="${bw}" height="${ih}" class="hl" style="display:none"/>${g}${bars}${lbl}</svg><div class="tip" hidden></div>`;
  const tip = $(".tip", el), hl = $("#hl", el);
  $$(".hit", el).forEach((r) => {
    const show = () => {
      const i = +r.dataset.i, x = months[i]; hl.setAttribute("x", m.l + bw * i); hl.style.display = "";
      tip.innerHTML = `<strong>${MONTHS_LONG[i]} ${y}</strong><div class="tr"><i class="sw" style="background:var(--c1)"></i>Bezahlt<span class="num">${eur(x.paid)}</span></div><div class="tr"><i class="sw" style="background:var(--c2)"></i>Offen<span class="num">${eur(x.open)}</span></div><div class="tr"><i class="sw" style="background:var(--c3)"></i>Ohne Rechnung<span class="num">${eur(x.noinv)}</span></div><div class="tr tot">Gesamt<span class="num">${eur(x.paid + x.open + x.noinv)}</span></div><div class="muted" style="font-size:.8rem">${x.count} Rechnung${x.count === 1 ? "" : "en"}${x.noinvCount ? ` · ${x.noinvCount} ohne Rechnung` : ""}</div>`;
      tip.hidden = false; const cx = m.l + bw * i + bw / 2, tw = tip.offsetWidth; let left = cx + 12; if (left + tw > W) left = cx - 12 - tw;
      tip.style.left = Math.max(0, left) + "px"; tip.style.top = m.t + "px";
    };
    r.addEventListener("mouseenter", show); r.addEventListener("click", show);
    r.addEventListener("mouseleave", () => { tip.hidden = true; hl.style.display = "none"; });
  });
}
function drawServices(el, rows, total) {
  if (!rows.length) { el.innerHTML = '<div class="empty">Für dieses Jahr gibt es noch keine abgerechneten Behandlungen.</div>'; return; }
  const W = Math.max(300, el.clientWidth), rowH = 34, labelW = Math.min(220, W * 0.42), valW = W < 500 ? 64 : 120;
  const H = rows.length * rowH + 8, iw = W - labelW - valW - 8, max = rows[0][1], maxCh = Math.floor((labelW - 12) / 6.6);
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Umsatz nach Leistung">${rows.map(([name, v], i) => {
    const y = 4 + i * rowH, w = Math.max(2, (v / max) * iw), pct = ((v / total) * 100).toLocaleString("de-DE", { maximumFractionDigits: 0 });
    return `<g><title>${esc(name)}: ${eur(v)} (${pct} %)</title>
      <text x="${labelW - 10}" y="${y + rowH / 2 + 4}" text-anchor="end" class="slabel">${esc(name.length > maxCh ? name.slice(0, maxCh - 1) + "…" : name)}</text>
      <path d="${roundRight(labelW, y + 7, w, rowH - 14, 4)}" fill="var(--c1)"/>
      <text x="${labelW + w + 8}" y="${y + rowH / 2 + 4}" class="dlabel">${W < 500 ? eurShort(v) : eur0(v) + " · " + pct + " %"}</text></g>`;
  }).join("")}</svg>`;
}
let resizeT;
window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (ST.UI.route === "statistik" && ST.S && $("#chMonth")) render(); }, 150); });

