// Kalender: Liste (Standard), Tag, Woche, Monat
import { $, $$, esc, pad, ymd, hm, parseLocal, toLocalStr, addDays, addMin, startOfWeek, fmtDate, WD, MONTHS_LONG } from "./util.js";
import { ST, render, go, setView, STATUS, pat, loc, pname, apptTitle, apptWho, isOwn } from "./state.js";
import { openAppt, getDraft } from "./records.js";
import { openVoucher } from "./billing.js";

const DAY_START = 7, DAY_END = 21;
const VIEWS = [["liste", "Liste"], ["tag", "Tag"], ["woche", "Woche"], ["monat", "Monat"]];
const WD_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const ICON_PEOPLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4Zm8 0c-.3 0-.7 0-1.1.1 1.2.9 2.1 2.1 2.1 3.9v2h7v-2c0-2.7-5.3-4-8-4Z"/></svg>';
const newAt = (d, h = 10) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return toLocalStr(x); };

export function calendarView(main) {
  const { S, UI } = ST;
  const view = UI.view;
  const todayStr = ymd(new Date());
  const title = view === "tag" ? UI.cursor.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : view === "monat" ? `${MONTHS_LONG[UI.cursor.getMonth()]} ${UI.cursor.getFullYear()}`
    : (() => { const d0 = startOfWeek(UI.cursor); return `${fmtDate(d0)} – ${fmtDate(addDays(d0, 5))}`; })();

  if (view === "liste") return agendaView(main, todayStr);
  main.innerHTML = `
    <div class="page-head"><h1>Kalender</h1><span class="spacer"></span><button class="btn" id="newVoucher">+ Neuer Gutschein</button>${getDraft(null) ? '<button class="btn" id="draftAppt">Entwurf fortsetzen</button>' : ""}<button class="btn primary" id="newAppt">+ Neuer Termin</button></div>
    ${(!S.services.length || !S.practice.street) ? `<div class="alert info onboard"><strong>Erste Schritte:</strong>
      ${!S.practice.street ? '<button class="btn sm" data-go2="einstellungen">Praxisdaten für die Rechnung ergänzen</button>' : ""}
      ${!S.services.length ? '<button class="btn sm" data-go2="leistungen">Erste Leistung mit Preis anlegen</button>' : ""}</div>` : ""}
    <div class="cal-bar">
      <button class="btn sm" id="prev" aria-label="Zurück">‹</button>
      <button class="btn sm" id="today">Heute</button>
      <button class="btn sm" id="next" aria-label="Weiter">›</button>
      <span class="cal-title">${esc(title)}</span>
      <span style="flex:1"></span>
      <div class="seg" role="group" aria-label="Ansicht">
        ${VIEWS.map(([k, l]) => `<button data-view="${k}" aria-pressed="${view === k}">${l}</button>`).join("")}
      </div>
    </div>
    <div id="calHost"></div>
    <div class="legend">${Object.entries(STATUS).map(([k, v]) => `<span class="pill s-${k}">${v}</span>`).join("")}<span class="pill own">Eigener Termin</span>
      <span class="muted">€ = abgerechnet · ${view === "monat" ? "Klick auf einen Tag öffnet die Tagesansicht" : "Klick in eine freie Zeit legt einen Termin an"}</span></div>`;

  if (view === "monat") monthGrid($("#calHost"), todayStr); else timeGrid($("#calHost"), view, todayStr);

  const da = $("#draftAppt"); if (da) da.onclick = () => openAppt(null);
  $("#newAppt").onclick = () => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(Math.min(Math.max(d.getHours() + 1, 8), 18)); openAppt(null, toLocalStr(d)); };
  $("#newVoucher").onclick = () => openVoucher(null);
  const move = (dir) => {
    if (view === "tag") UI.cursor = addDays(UI.cursor, dir);
    else if (view === "woche") UI.cursor = addDays(UI.cursor, 7 * dir);
    else UI.cursor = new Date(UI.cursor.getFullYear(), UI.cursor.getMonth() + dir, 1);
    render();
  };
  $("#prev").onclick = () => move(-1);
  $("#next").onclick = () => move(1);
  $("#today").onclick = () => { UI.cursor = new Date(); render(); };
  $$("[data-view]").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $$("[data-go2]").forEach((b) => (b.onclick = () => go(b.dataset.go2)));
}

function timeGrid(host, view, todayStr) {
  const { S, UI } = ST;
  const days = view === "tag" ? [new Date(UI.cursor.getFullYear(), UI.cursor.getMonth(), UI.cursor.getDate())]
    : Array.from({ length: 6 }, (_, i) => addDays(startOfWeek(UI.cursor), i));
  const cols = `56px repeat(${days.length},minmax(0,1fr))`;
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
  host.innerHTML = `
    <div class="panel cal">
      <div class="cal-head" style="grid-template-columns:${cols}"><div></div>${days.map((d) => `<div class="${ymd(d) === todayStr ? "today" : ""}">${WD[(d.getDay() + 6) % 7]} <b class="num">${d.getDate()}.</b></div>`).join("")}</div>
      <div class="cal-body" id="calBody" style="grid-template-columns:${cols}">
        <div class="cal-times">${hours.map((h) => `<div class="num">${h === DAY_START ? "" : pad(h) + ":00"}</div>`).join("")}</div>
        ${days.map((d) => `<div class="cal-day ${ymd(d) === todayStr ? "today" : ""}" data-day="${ymd(d)}" style="height:calc(var(--hour) * ${hours.length})"></div>`).join("")}
      </div>
    </div>`;
  const hourPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour")) || 52;
  days.forEach((d) => {
    const col = host.querySelector(`.cal-day[data-day="${ymd(d)}"]`);
    const list = S.appts.filter((a) => a.start.slice(0, 10) === ymd(d)).sort((a, b) => a.start.localeCompare(b.start));
    const lanes = []; const lane = new Map();
    list.forEach((a) => { const s = parseLocal(a.start); let i = lanes.findIndex((end) => end <= s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = addMin(s, a.duration); lane.set(a.id, i); });
    const nL = Math.max(1, lanes.length);
    list.forEach((a) => {
      const s = parseLocal(a.start);
      const top = (s.getHours() + s.getMinutes() / 60 - DAY_START) * hourPx, h = Math.max(22, (a.duration / 60) * hourPx - 2);
      const el = document.createElement("button");
      el.className = `ev s-${a.status}${a.invoiceId ? " billed" : ""}${isOwn(a) ? " own" : ""}`;
      el.style.top = top + "px"; el.style.height = h + "px";
      if (nL > 1) { el.style.left = `calc(${(lane.get(a.id) / nL) * 100}% + 3px)`; el.style.right = "auto"; el.style.width = `calc(${100 / nL}% - 6px)`; }
      el.innerHTML = isOwn(a) ? `<b>${hm(s)} ${esc(a.title)}</b>${a.note ? `<span>${esc(a.note)}</span>` : ""}` : `<b>${hm(s)} ${esc(pname(pat(a.patientId)))}</b><span>${esc(apptTitle(a))}${a.locationId && loc(a.locationId) ? " · " + esc(loc(a.locationId).name) : ""}</span>`;
      el.title = isOwn(a) ? `${hm(s)}–${hm(addMin(s, a.duration))} · ${a.title} · Eigener Termin` : `${hm(s)}–${hm(addMin(s, a.duration))} · ${pname(pat(a.patientId))}${a.locationId && loc(a.locationId) ? " · " + loc(a.locationId).name : ""} · ${STATUS[a.status]}${a.needsInvoice ? "" : " · ohne Rechnung"}`;
      el.onclick = (ev) => { ev.stopPropagation(); openAppt(a.id); };
      col.appendChild(el);
    });
    if (ymd(d) === todayStr) {
      const n = new Date(); const t = (n.getHours() + n.getMinutes() / 60 - DAY_START) * hourPx;
      if (t > 0 && t < hourPx * hours.length) { const l = document.createElement("div"); l.className = "now-line"; l.style.top = t + "px"; col.appendChild(l); }
    }
    col.onclick = (ev) => {
      const mins = Math.floor(((ev.offsetY / hourPx) * 60) / 15) * 15; const dt = new Date(d); dt.setHours(DAY_START, 0, 0, 0); dt.setMinutes(mins);
      openAppt(null, toLocalStr(dt));
    };
  });
  host.querySelector("#calBody").scrollTop = hourPx;
}

function monthGrid(host, todayStr) {
  const { S, UI } = ST;
  const first = new Date(UI.cursor.getFullYear(), UI.cursor.getMonth(), 1);
  const start = startOfWeek(first);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const weeks = Math.ceil((Math.round((last - start) / 86400000) + 1) / 7);
  const byDay = {};
  S.appts.forEach((a) => { const k = a.start.slice(0, 10); (byDay[k] = byDay[k] || []).push(a); });
  Object.values(byDay).forEach((l) => l.sort((a, b) => a.start.localeCompare(b.start)));
  const MAX = 3;
  let cells = "";
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i), k = ymd(d), list = byDay[k] || [];
    const active = list.filter((a) => a.status !== "abgesagt");
    const out = d.getMonth() !== first.getMonth();
    cells += `<div class="mcell${out ? " out" : ""}${k === todayStr ? " today" : ""}" data-day="${k}" role="button" tabindex="0" aria-label="${fmtDate(d)}, ${active.length} Termine">
      <div class="mnum"><span class="num">${d.getDate()}</span>${active.length ? `<span class="mcount num">${active.length}</span>` : ""}</div>
      <div class="mchips">${list.slice(0, MAX).map((a) => `<button class="mchip s-${a.status}${a.invoiceId ? " billed" : ""}${isOwn(a) ? " own" : ""}" data-aid="${a.id}" title="${esc(a.start.slice(11, 16) + " " + apptWho(a) + (isOwn(a) ? "" : " · " + apptTitle(a)))}"><span class="num">${a.start.slice(11, 16)}</span> ${esc(isOwn(a) ? a.title : pat(a.patientId)?.last || "")}</button>`).join("")}
        ${list.length > MAX ? `<span class="mmore">+${list.length - MAX} weitere</span>` : ""}</div>
      <div class="mdots">${list.slice(0, 6).map((a) => `<i class="s-${a.status}${isOwn(a) ? " own" : ""}"></i>`).join("")}</div>
    </div>`;
  }
  host.innerHTML = `<div class="panel month">
    <div class="mhead">${WD.map((w) => `<div>${w}</div>`).join("")}</div>
    <div class="mgrid" style="grid-template-rows:repeat(${weeks},minmax(92px,auto))">${cells}</div></div>`;
  $$(".mchip", host).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openAppt(b.dataset.aid); }));
  $$(".mcell", host).forEach((c) => {
    const open = () => { UI.cursor = parseLocal(c.dataset.day); setView("tag"); };
    c.onclick = open; c.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } };
  });
}

// Listenansicht: Wochenleiste mit Punkten, darunter alle Termine Tag für Tag
function agendaView(main, todayStr) {
  const { S, UI } = ST;
  const sel = new Date(UI.cursor.getFullYear(), UI.cursor.getMonth(), UI.cursor.getDate()), selStr = ymd(sel);
  const week = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(sel), i));
  const byDay = {};
  S.appts.forEach((a) => { const k = a.start.slice(0, 10); (byDay[k] = byDay[k] || []).push(a); });
  Object.values(byDay).forEach((l) => l.sort((a, b) => a.start.localeCompare(b.start)));
  const days = Array.from({ length: UI.listDays }, (_, i) => addDays(sel, i));
  const sub = (a) => (isOwn(a) ? "Eigener Termin" : (a.locationId && loc(a.locationId)?.name) || S.practice.owner.split(" ")[0] || "");
  const card = (a) => {
    const s = parseLocal(a.start);
    const head = isOwn(a) ? a.title : `${apptTitle(a)} ${pname(pat(a.patientId))}`;
    return `<div class="ag-row"><div class="ag-time num"><b>${hm(s)}</b><span>${hm(addMin(s, a.duration))}</span></div>
      <button class="ag-card s-${a.status}${isOwn(a) ? " own" : ""}${a.invoiceId ? " billed" : ""}" data-aid="${a.id}" title="${esc(STATUS[a.status] + (a.needsInvoice || isOwn(a) ? "" : " · ohne Rechnung"))}">
        <b>${esc(head)}</b><span>${ICON_PEOPLE}${esc(sub(a))}</span></button></div>`;
  };
  main.innerHTML = `
    <div class="ag">
      <div class="ag-top">
        <button class="ag-ic" id="today" aria-label="Heute" title="Heute"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg></button>
        <h1 class="ag-title">${sel.getDate()}. ${MONTHS_LONG[sel.getMonth()]}${sel.getFullYear() !== new Date().getFullYear() ? " " + sel.getFullYear() : ""}</h1>
        <span class="spacer"></span>
        <div class="seg" role="group" aria-label="Ansicht">${VIEWS.map(([k, l]) => `<button data-view="${k}" aria-pressed="${k === "liste"}">${l}</button>`).join("")}</div>
      </div>
      <div class="ag-week">
        <button class="ag-nav" id="prev" aria-label="Vorige Woche">‹</button>
        ${week.map((d) => { const k = ymd(d), n = (byDay[k] || []).filter((a) => a.status !== "abgesagt").length;
          return `<button class="ag-day${k === selStr ? " sel" : ""}${k === todayStr ? " today" : ""}" data-day="${k}" aria-label="${fmtDate(d)}, ${n} Termine"><small>${WD[(d.getDay() + 6) % 7][0]}</small><b class="num">${d.getDate()}</b><i>${"<em></em>".repeat(Math.min(n, 3))}</i></button>`; }).join("")}
        <button class="ag-nav" id="next" aria-label="Nächste Woche">›</button>
      </div>
      <div class="ag-actions">
        <button class="btn sm" id="newVoucher">+ Neuer Gutschein</button>
        ${getDraft(null) ? '<button class="btn sm" id="draftAppt">Entwurf fortsetzen</button>' : ""}
        <button class="btn sm primary" id="newAppt">+ Hinzufügen</button>
      </div>
      <div class="ag-list">
        ${days.map((d) => { const k = ymd(d), list = byDay[k] || [];
          return `<div class="ag-dhead${k === todayStr ? " today" : ""}"><span>${WD_LONG[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}</span><button class="ag-add" data-add="${k}" aria-label="Termin am ${fmtDate(d)} anlegen">+</button></div>
            ${list.length ? list.map(card).join("") : '<div class="ag-empty">Keine Termine</div>'}`; }).join("")}
        <button class="btn ag-more" id="more">Weitere Tage anzeigen</button>
      </div>
    </div>`;
  $$("[data-aid]", main).forEach((b) => (b.onclick = () => openAppt(b.dataset.aid)));
  $$("[data-add]", main).forEach((b) => (b.onclick = () => openAppt(null, newAt(parseLocal(b.dataset.add)))));
  $$("[data-day]", main).forEach((b) => (b.onclick = () => { UI.cursor = parseLocal(b.dataset.day); render(); }));
  $$("[data-view]", main).forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $("#prev").onclick = () => { UI.cursor = addDays(sel, -7); render(); };
  $("#next").onclick = () => { UI.cursor = addDays(sel, 7); render(); };
  $("#today").onclick = () => { UI.cursor = new Date(); render(); };
  $("#more").onclick = () => { UI.listDays += 21; render(); };
  $("#newAppt").onclick = () => openAppt(null, newAt(sel, Math.min(Math.max(new Date().getHours() + 1, 8), 18)));
  $("#newVoucher").onclick = () => openVoucher(null);
  const da = $("#draftAppt"); if (da) da.onclick = () => openAppt(null);
  // Wischen auf dem Handy wechselt die Woche
  const wk = $(".ag-week", main); let x0 = null;
  wk.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
  wk.addEventListener("touchend", (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) { UI.cursor = addDays(sel, dx < 0 ? 7 : -7); render(); } });
}
