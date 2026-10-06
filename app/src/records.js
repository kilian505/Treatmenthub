// Termine, Patienten, Leistungen
import { $, $$, esc, eur, ymd, hm, parseLocal, toLocalStr, addMin, fmtDate, fmtDay } from "./util.js";
import { ST, render, STATUS, INV_STATUS, pat, svc, pname, apptTotal, apptTitle, overlaps, toast, toastError, modal, closeModal, busy, armed } from "./state.js";
import * as api from "./api.js";
import { openInvoice } from "./billing.js";

/* ---------------- Termin ---------------- */
export function openAppt(id, startStr, presetPatient) {
  const { S } = ST;
  const existing = id ? S.appts.find((a) => a.id === id) : null;
  const a = existing ? structuredClone(existing)
    : { id: null, patientId: presetPatient || null, start: startStr, duration: 0, serviceIds: [S.services.find((s) => s.active)?.id].filter(Boolean), status: "geplant", note: "", invoiceId: null };
  const locked = !!a.invoiceId;
  let mode = a.patientId ? "chosen" : S.patients.length ? "search" : "new";
  let durManual = existing ? a.duration !== a.serviceIds.reduce((t, i) => t + (svc(i)?.duration || 0), 0) : false;
  const newP = { first: "", last: "", street: "", zip: "", city: "", birth: "", phone: "", email: "" };

  const ov = modal(`
    <div class="modal-head"><h2>${existing ? "Termin" : "Neuer Termin"}</h2>${locked ? '<span class="pill s-bezahlt">abgerechnet</span>' : ""}<button class="btn ghost sm" data-close aria-label="Schließen">✕</button></div>
    <form class="modal-body" id="apptForm" novalidate>
      ${locked ? '<div class="alert info">Dieser Termin steht auf einer Rechnung und kann nicht mehr geändert werden. Für Änderungen die Rechnung stornieren.</div>' : ""}
      <div class="section"><span class="label">Patient</span><div id="patBox"></div></div>
      <div class="section"><span class="label">Wann</span>
        <div class="grid3">
          <div class="field"><label for="ap-date">Datum</label><input id="ap-date" type="date" value="${a.start.slice(0, 10)}" ${locked ? "disabled" : ""}></div>
          <div class="field"><label for="ap-time">Uhrzeit</label><input id="ap-time" type="time" step="300" value="${a.start.slice(11, 16)}" ${locked ? "disabled" : ""}></div>
          <div class="field"><label for="ap-dur">Dauer (Minuten)</label><input id="ap-dur" type="number" min="5" step="5" value="${a.duration}" ${locked ? "disabled" : ""}></div>
        </div><div id="overlapMsg"></div>
      </div>
      <div class="section"><span class="label">Behandlung</span><div class="items" id="items"></div>
        ${locked ? "" : '<button type="button" class="btn sm" id="addItem" style="align-self:flex-start">+ Weitere Leistung</button>'}
        <div class="sum"><span>Summe</span><span class="num" id="sum"></span></div>
      </div>
      <div class="section"><span class="label">Status</span><div class="status-pick">
        ${Object.entries(STATUS).map(([k, v]) => `<button type="button" class="s-${k}" data-st="${k}" aria-pressed="${a.status === k}" ${locked ? "disabled" : ""}>${v}</button>`).join("")}
      </div></div>
      <div class="field"><label for="ap-note">Notiz (intern, erscheint nicht auf der Rechnung)</label><textarea id="ap-note" ${locked ? "disabled" : ""}>${esc(a.note)}</textarea></div>
      <div id="formErr"></div>
    </form>
    <div class="modal-foot">
      <div class="left">${existing && !locked ? '<button class="btn danger" id="delAppt">Löschen</button>' : ""}
        ${existing && !locked && a.status === "durchgefuehrt" ? '<button class="btn" id="billNow">Jetzt abrechnen</button>' : ""}
        ${locked ? '<button class="btn" id="showInv">Rechnung ansehen</button>' : ""}</div>
      <button class="btn" data-close>Abbrechen</button>
      ${locked ? "" : `<button class="btn primary" id="saveAppt">${existing ? "Speichern" : "Termin anlegen"}</button>`}
    </div>`);

  function renderPat() {
    const box = $("#patBox");
    if (mode === "chosen") {
      const p = pat(a.patientId);
      box.innerHTML = `<div class="chosen"><div><strong>${esc(pname(p))}</strong><div class="muted" style="font-size:.88rem">${esc(p?.street)}, ${esc(p?.zip)} ${esc(p?.city)}</div></div>${locked ? "" : '<button type="button" class="btn sm" id="chg">Ändern</button>'}</div>`;
      if (!locked) $("#chg").onclick = () => { mode = "search"; renderPat(); };
      return;
    }
    box.innerHTML = `<div class="tabs-mini" role="group"><button type="button" data-m="search" aria-pressed="${mode === "search"}">Bestehender Patient</button><button type="button" data-m="new" aria-pressed="${mode === "new"}">Neuer Patient</button></div><div id="patInner" style="margin-top:.6rem"></div>`;
    $$("[data-m]", box).forEach((b) => (b.onclick = () => { mode = b.dataset.m; renderPat(); }));
    const inner = $("#patInner");
    if (mode === "search") {
      inner.innerHTML = `<div class="search-wrap"><div class="field"><label for="ap-search">Name suchen</label><input id="ap-search" autocomplete="off" placeholder="Vor- oder Nachname"></div><div class="suggest" id="sugg" hidden></div></div>`;
      const inp = $("#ap-search"), sg = $("#sugg");
      const show = () => {
        const q = inp.value.trim().toLowerCase();
        const res = S.patients.filter((p) => !q || pname(p).toLowerCase().includes(q)).slice(0, 8);
        sg.innerHTML = res.length ? res.map((p) => `<button type="button" data-pid="${p.id}"><strong>${esc(pname(p))}</strong> <span class="muted">· ${esc(p.city)}${p.birth ? " · geb. " + fmtDate(parseLocal(p.birth)) : ""}</span></button>`).join("")
          : `<button type="button" id="mkNew">Kein Treffer. Neuen Patienten „${esc(inp.value)}“ anlegen</button>`;
        sg.hidden = false;
        $$("[data-pid]", sg).forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); a.patientId = b.dataset.pid; mode = "chosen"; renderPat(); }));
        const mk = $("#mkNew", sg);
        if (mk) mk.onmousedown = (e) => { e.preventDefault(); const parts = inp.value.trim().split(/\s+/); newP.first = parts.slice(0, -1).join(" ") || parts[0] || ""; newP.last = parts.length > 1 ? parts[parts.length - 1] : ""; mode = "new"; renderPat(); };
      };
      inp.oninput = show; inp.onfocus = show; inp.onblur = () => setTimeout(() => (sg.hidden = true), 120);
      setTimeout(() => inp.focus(), 30);
    } else {
      inner.innerHTML = patientFields("np", newP);
      ["first", "last", "street", "zip", "city", "birth", "phone", "email"].forEach((k) => ($("#np-" + k).oninput = (e) => (newP[k] = e.target.value)));
    }
  }
  function renderItems() {
    const wrap = $("#items");
    const opts = (sel) => S.services.filter((s) => s.active || s.id === sel).map((s) => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)} · ${s.duration} Min · ${eur(s.price)}</option>`).join("");
    wrap.innerHTML = a.serviceIds.length ? a.serviceIds.map((sid, i) => `<div class="item-row"><select data-i="${i}" aria-label="Leistung ${i + 1}" ${locked ? "disabled" : ""}>${opts(sid)}</select>${locked || a.serviceIds.length < 2 ? "" : `<button type="button" class="btn ghost sm" data-rm="${i}" aria-label="Entfernen">✕</button>`}</div>`).join("")
      : `<div class="alert warn">Noch keine Leistungen angelegt. Unter „Leistungen“ legen Sie Ihre Behandlungen mit Preisen an.</div>`;
    $$("select[data-i]", wrap).forEach((s) => (s.onchange = () => { a.serviceIds[+s.dataset.i] = s.value; sync(); }));
    $$("[data-rm]", wrap).forEach((b) => (b.onclick = () => { a.serviceIds.splice(+b.dataset.rm, 1); renderItems(); sync(); }));
    $("#sum").textContent = eur(apptTotal(a));
  }
  function sync() {
    if (!durManual) { a.duration = a.serviceIds.reduce((t, i) => t + (svc(i)?.duration || 0), 0) || 30; $("#ap-dur").value = a.duration; }
    $("#sum").textContent = eur(apptTotal(a)); checkOverlap();
  }
  function checkOverlap() {
    const d = $("#ap-date").value, t = $("#ap-time").value, box = $("#overlapMsg");
    if (!d || !t) { box.innerHTML = ""; return; }
    const dur = +$("#ap-dur").value || 0, o = overlaps(`${d}T${t}`, dur, a.id), s = parseLocal(`${d}T${t}`);
    box.innerHTML = (o.length ? `<div class="alert warn">Überschneidung mit ${o.map((x) => `${x.start.slice(11, 16)} ${esc(pname(pat(x.patientId)))}`).join(", ")}.</div>` : "")
      + `<div class="muted" style="font-size:.85rem;margin-top:.3rem">${fmtDay(s)}, ${hm(s)} – ${hm(addMin(s, dur))} Uhr</div>`;
  }
  renderPat(); renderItems(); checkOverlap();
  if (!locked) {
    $("#addItem").onclick = () => { const f = S.services.find((s) => s.active); if (f) { a.serviceIds.push(f.id); renderItems(); sync(); } };
    $("#ap-dur").oninput = () => { durManual = true; checkOverlap(); };
    $("#ap-date").oninput = checkOverlap; $("#ap-time").oninput = checkOverlap;
    $$("[data-st]").forEach((b) => (b.onclick = () => { a.status = b.dataset.st; $$("[data-st]").forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
  }
  function validate() {
    const err = [];
    if (mode === "new") err.push(...patientErrors(newP));
    else if (!a.patientId) err.push("Bitte einen Patienten auswählen oder neu anlegen.");
    if (!$("#ap-date").value || !$("#ap-time").value) err.push("Datum und Uhrzeit fehlen.");
    if (!a.serviceIds.length) err.push("Bitte mindestens eine Leistung wählen.");
    $("#formErr").innerHTML = err.length ? `<div class="alert bad">${err.map(esc).join("<br>")}</div>` : "";
    return !err.length;
  }
  async function persist() {
    if (mode === "new") {
      const p = await api.savePatient(trimAll(newP)); S.patients.push(p); a.patientId = p.id; mode = "chosen";
    }
    a.start = `${$("#ap-date").value}T${$("#ap-time").value}`; a.duration = +$("#ap-dur").value || 30; a.note = $("#ap-note").value;
    const saved = await api.saveAppt(a);
    if (existing) Object.assign(existing, saved); else S.appts.push(saved);
    a.id = saved.id;
    return existing || saved;
  }
  const saveBtn = $("#saveAppt");
  if (saveBtn) saveBtn.onclick = () => { if (!validate()) return; busy(saveBtn, async () => {
    try { const r = await persist(); ST.UI.cursor = parseLocal(r.start); closeModal(); render(); toast(existing ? "Termin gespeichert" : "Termin angelegt"); }
    catch (e) { toastError(e); }
  }); };
  const del = $("#delAppt");
  if (del) del.onclick = () => { if (!armed(del, "Wirklich löschen?")) return; busy(del, async () => {
    try { await api.deleteAppt(existing.id); S.appts = S.appts.filter((x) => x.id !== existing.id); closeModal(); render(); toast("Termin gelöscht"); }
    catch (e) { toastError(e); }
  }); };
  const bill = $("#billNow");
  if (bill) bill.onclick = () => { if (!validate()) return; busy(bill, async () => {
    try {
      const r = await persist();
      const inv = await api.createInvoice(r.patientId, [r.id]);
      S.invoices.push(inv); r.invoiceId = inv.id; closeModal(); render(); openInvoice(inv.id);
    } catch (e) { toastError(e); }
  }); };
  const si = $("#showInv"); if (si) si.onclick = () => openInvoice(a.invoiceId);
}

/* ---------------- Patienten ---------------- */
const trimAll = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
function patientErrors(p) {
  const err = [];
  if (!p.first?.trim() || !p.last?.trim()) err.push("Vor- und Nachname des Patienten fehlen.");
  if (!p.street?.trim() || !p.zip?.trim() || !p.city?.trim()) err.push("Die Adresse ist unvollständig. Sie wird für die Rechnung gebraucht.");
  else if (!/^\d{5}$/.test(p.zip.trim())) err.push("Die PLZ muss fünf Ziffern haben.");
  return err;
}
function patientFields(px, p) {
  return `
    <div class="grid2">
      <div class="field"><label for="${px}-first">Vorname *</label><input id="${px}-first" value="${esc(p.first)}"></div>
      <div class="field"><label for="${px}-last">Nachname *</label><input id="${px}-last" value="${esc(p.last)}"></div>
    </div>
    <div class="field" style="margin-top:.6rem"><label for="${px}-street">Straße und Hausnummer *</label><input id="${px}-street" value="${esc(p.street)}" autocomplete="street-address"></div>
    <div class="grid2" style="margin-top:.6rem;grid-template-columns:1fr 2fr">
      <div class="field"><label for="${px}-zip">PLZ *</label><input id="${px}-zip" inputmode="numeric" maxlength="5" value="${esc(p.zip)}"></div>
      <div class="field"><label for="${px}-city">Ort *</label><input id="${px}-city" value="${esc(p.city)}"></div>
    </div>
    <div class="grid3" style="margin-top:.6rem;grid-template-columns:1fr 1fr 1fr">
      <div class="field"><label for="${px}-birth">Geburtsdatum</label><input id="${px}-birth" type="date" value="${esc(p.birth)}"></div>
      <div class="field"><label for="${px}-phone">Telefon</label><input id="${px}-phone" type="tel" value="${esc(p.phone)}"></div>
      <div class="field"><label for="${px}-email">E-Mail</label><input id="${px}-email" type="email" value="${esc(p.email)}"></div>
    </div>
    <p class="muted" style="font-size:.85rem;margin:.5rem 0 0">* Pflichtfelder. Die Adresse wird für die Rechnung gebraucht.</p>`;
}

export function patientsView(main) {
  const { S, UI } = ST;
  const q = UI.patientQuery.toLowerCase();
  const list = S.patients.filter((p) => !q || pname(p).toLowerCase().includes(q) || (p.city || "").toLowerCase().includes(q)).sort((a, b) => a.last.localeCompare(b.last, "de"));
  main.innerHTML = `
    <div class="page-head"><h1>Patienten</h1><span class="muted num">${S.patients.length} in der Kartei</span><span class="spacer"></span><button class="btn primary" id="newPat">+ Neuer Patient</button></div>
    <div class="field" style="max-width:360px;margin-bottom:12px"><label for="pq">Suchen</label><input id="pq" value="${esc(UI.patientQuery)}" placeholder="Name oder Ort"></div>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Name</th><th>Adresse</th><th>Geburtsdatum</th><th class="r">Termine</th><th>Nächster Termin</th><th class="r">Offen</th></tr></thead>
      <tbody>${list.map((p) => {
        const ap = S.appts.filter((a) => a.patientId === p.id);
        const next = ap.filter((a) => a.status === "geplant" && parseLocal(a.start) > new Date()).sort((a, b) => a.start.localeCompare(b.start))[0];
        const openSum = S.invoices.filter((i) => i.patientId === p.id && i.status === "offen").reduce((t, i) => t + i.total, 0);
        return `<tr class="click" data-pid="${p.id}"><td><strong>${esc(pname(p))}</strong></td><td>${esc(p.street)}, ${esc(p.zip)} ${esc(p.city)}</td><td class="num">${p.birth ? fmtDate(parseLocal(p.birth)) : "–"}</td><td class="r num">${ap.length}</td><td class="num">${next ? fmtDay(parseLocal(next.start)) + ", " + next.start.slice(11, 16) : "–"}</td><td class="r num">${openSum ? eur(openSum) : "–"}</td></tr>`;
      }).join("") || `<tr><td colspan="6" class="empty">${S.patients.length ? "Keine Patienten gefunden." : "Noch keine Patienten. Neue Patienten legen Sie hier oder direkt beim Termin an."}</td></tr>`}</tbody>
    </table></div>`;
  const pq = $("#pq");
  pq.oninput = () => { UI.patientQuery = pq.value; const pos = pq.selectionStart; patientsView(main); const n = $("#pq"); n.focus(); n.setSelectionRange(pos, pos); };
  $$("[data-pid]").forEach((r) => (r.onclick = () => openPatient(r.dataset.pid)));
  $("#newPat").onclick = () => openPatient(null);
}

export function openPatient(id) {
  const { S } = ST;
  const p = id ? pat(id) : { first: "", last: "", street: "", zip: "", city: "", birth: "", phone: "", email: "" };
  const ap = id ? S.appts.filter((a) => a.patientId === id).sort((a, b) => b.start.localeCompare(a.start)) : [];
  const invs = id ? S.invoices.filter((i) => i.patientId === id).sort((a, b) => b.number.localeCompare(a.number)) : [];
  const ov = modal(`
    <div class="modal-head"><h2>${id ? esc(pname(p)) : "Neuer Patient"}</h2><button class="btn ghost sm" data-close aria-label="Schließen">✕</button></div>
    <form class="modal-body" novalidate>
      ${patientFields("pf", p)}
      ${id ? `<p class="muted" style="font-size:.85rem;margin:0">Adressänderungen gelten für neue Rechnungen. Erstellte Rechnungen behalten die alte Adresse.</p>` : ""}
      <div id="pfErr"></div>
      ${id ? `<div class="section"><span class="label">Termine (${ap.length})</span>
        <div class="table-wrap"><table><tbody>${ap.map((a) => `<tr class="click" data-aid="${a.id}"><td class="num">${fmtDay(parseLocal(a.start))} ${a.start.slice(11, 16)}</td><td>${esc(apptTitle(a))}</td><td><span class="pill s-${a.status}">${STATUS[a.status]}</span></td><td class="r num">${eur(apptTotal(a))}</td></tr>`).join("") || '<tr><td class="empty">Noch keine Termine.</td></tr>'}</tbody></table></div></div>
      <div class="section"><span class="label">Rechnungen (${invs.length})</span>
        <div class="table-wrap"><table><tbody>${invs.map((i) => `<tr class="click" data-iid="${i.id}"><td class="num">${i.number}</td><td class="num">${fmtDate(parseLocal(i.date))}</td><td><span class="pill s-${i.status}">${INV_STATUS[i.status]}</span></td><td class="r num">${eur(i.total)}</td></tr>`).join("") || '<tr><td class="empty">Noch keine Rechnungen.</td></tr>'}</tbody></table></div></div>` : ""}
    </form>
    <div class="modal-foot">
      ${id ? '<div class="left"><button class="btn" id="pfAppt">+ Termin für diesen Patienten</button></div>' : ""}
      <button class="btn" data-close>Abbrechen</button><button class="btn primary" id="pfSave">${id ? "Speichern" : "Anlegen"}</button>
    </div>`, { wide: !!id });
  $$("[data-aid]", ov).forEach((r) => (r.onclick = () => openAppt(r.dataset.aid)));
  $$("[data-iid]", ov).forEach((r) => (r.onclick = () => openInvoice(r.dataset.iid)));
  const pa = $("#pfAppt"); if (pa) pa.onclick = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); openAppt(null, toLocalStr(d), id); };
  const btn = $("#pfSave");
  btn.onclick = () => {
    const data = {}; ["first", "last", "street", "zip", "city", "birth", "phone", "email"].forEach((k) => (data[k] = $("#pf-" + k).value.trim()));
    const err = patientErrors(data);
    if (err.length) { $("#pfErr").innerHTML = `<div class="alert bad">${err.join("<br>")}</div>`; return; }
    busy(btn, async () => {
      try {
        const saved = await api.savePatient({ ...data, id: id || undefined });
        if (id) Object.assign(p, saved); else S.patients.push(saved);
        closeModal(); render(); toast(id ? "Patient gespeichert" : "Patient angelegt");
      } catch (e) { toastError(e); }
    });
  };
}

/* ---------------- Leistungen ---------------- */
export function servicesView(main) {
  const { S } = ST;
  main.innerHTML = `
    <div class="page-head"><h1>Leistungen</h1><span class="spacer"></span><button class="btn primary" id="newSvc">+ Neue Leistung</button></div>
    <p class="muted" style="margin:0 0 14px;max-width:65ch">Diese Liste erscheint im Termin als Auswahlmenü. Die Dauer bestimmt die Länge im Kalender, der Preis landet auf der Rechnung. Preisänderungen gelten nur für künftige Rechnungen.</p>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Leistung</th><th>GebüH-Ziffer</th><th class="r">Dauer</th><th class="r">Preis</th><th>Status</th><th class="r">Verwendet</th></tr></thead>
      <tbody>${S.services.map((s) => `<tr class="click" data-sid="${s.id}"><td><strong>${esc(s.name)}</strong></td><td class="num">${esc(s.code) || '<span class="muted">–</span>'}</td><td class="r num">${s.duration} Min</td><td class="r num">${eur(s.price)}</td><td>${s.active ? '<span class="pill s-durchgefuehrt">Aktiv</span>' : '<span class="pill s-abgesagt">Archiviert</span>'}</td><td class="r num">${S.appts.filter((a) => a.serviceIds.includes(s.id)).length}×</td></tr>`).join("") || '<tr><td colspan="6" class="empty">Noch keine Leistungen. Legen Sie Ihre erste Behandlung an.</td></tr>'}</tbody>
    </table></div>`;
  $$("[data-sid]").forEach((r) => (r.onclick = () => openService(r.dataset.sid)));
  $("#newSvc").onclick = () => openService(null);
}
function openService(id) {
  const { S } = ST;
  const s = id ? svc(id) : { name: "", code: "", duration: 30, price: 0, active: true };
  const used = id ? S.appts.some((a) => a.serviceIds.includes(id)) : false;
  modal(`
    <div class="modal-head"><h2>${id ? "Leistung bearbeiten" : "Neue Leistung"}</h2><button class="btn ghost sm" data-close aria-label="Schließen">✕</button></div>
    <form class="modal-body" novalidate>
      <div class="field"><label for="sf-name">Bezeichnung *</label><input id="sf-name" value="${esc(s.name)}" placeholder="z. B. Akupunktur"></div>
      <div class="grid3" style="grid-template-columns:1fr 1fr 1fr">
        <div class="field"><label for="sf-code">GebüH-Ziffer (optional)</label><input id="sf-code" value="${esc(s.code)}"></div>
        <div class="field"><label for="sf-dur">Dauer (Minuten) *</label><input id="sf-dur" type="number" min="5" step="5" value="${s.duration}"></div>
        <div class="field"><label for="sf-price">Preis in € *</label><input id="sf-price" type="number" min="0" step="0.5" value="${s.price}"></div>
      </div>
      <p class="muted" style="font-size:.85rem;margin:0">Die GebüH-Ziffer hilft Privatversicherten bei der Erstattung und steht mit auf der Rechnung.</p>
      <div id="sfErr"></div>
    </form>
    <div class="modal-foot">
      ${id ? `<div class="left"><button class="btn ${used ? "" : "danger"}" id="sfArch">${used ? (s.active ? "Archivieren" : "Reaktivieren") : "Löschen"}</button></div>` : ""}
      <button class="btn" data-close>Abbrechen</button><button class="btn primary" id="sfSave">Speichern</button>
    </div>`);
  const btn = $("#sfSave");
  btn.onclick = () => {
    const name = $("#sf-name").value.trim(), dur = +$("#sf-dur").value, price = Math.round(parseFloat($("#sf-price").value) * 100) / 100;
    const err = []; if (!name) err.push("Bitte eine Bezeichnung eingeben."); if (!(dur > 0)) err.push("Die Dauer muss größer als 0 sein."); if (!(price >= 0)) err.push("Bitte einen gültigen Preis eingeben.");
    if (err.length) { $("#sfErr").innerHTML = `<div class="alert bad">${err.join("<br>")}</div>`; return; }
    busy(btn, async () => {
      try {
        const saved = await api.saveService({ ...s, name, code: $("#sf-code").value.trim(), duration: dur, price });
        if (id) Object.assign(s, saved); else S.services.push(saved);
        closeModal(); render(); toast("Leistung gespeichert");
      } catch (e) { toastError(e); }
    });
  };
  const ar = $("#sfArch");
  if (ar) ar.onclick = () => busy(ar, async () => {
    try {
      if (used) { const saved = await api.saveService({ ...s, active: !s.active }); Object.assign(s, saved); toast(s.active ? "Leistung reaktiviert" : "Leistung archiviert"); }
      else { await api.deleteService(id); S.services = S.services.filter((x) => x.id !== id); toast("Leistung gelöscht"); }
      closeModal(); render();
    } catch (e) { toastError(e); }
  });
}

