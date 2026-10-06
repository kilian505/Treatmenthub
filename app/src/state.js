// Gemeinsamer Zustand der Oberfläche + kleine UI-Bausteine (Toast, Dialog)
import { $, $$, parseLocal, addMin } from "./util.js";

export const ST = {
  profile: null,        // eigenes Profil (Rolle, Status)
  S: null,              // Praxisdaten im Speicher: practice, services, patients, appts, invoices
  UI: {
    route: "kalender", auth: "login",
    cursor: new Date(),
    view: window.matchMedia("(max-width:760px)").matches ? "tag" : "woche",
    patientQuery: "", statYear: new Date().getFullYear(), acctFilter: "alle",
  },
};
try { const r = localStorage.getItem("tm:route"); if (r) ST.UI.route = r; const v = localStorage.getItem("tm:view"); if (v) ST.UI.view = v; } catch (_) {}

export const hooks = { render: () => {} };
export const render = () => hooks.render();
export function go(r) { ST.UI.route = r; try { localStorage.setItem("tm:route", r); } catch (_) {} render(); }
export function setView(v) { ST.UI.view = v; try { localStorage.setItem("tm:view", v); } catch (_) {} render(); }

export const STATUS = { geplant: "Geplant", durchgefuehrt: "Durchgeführt", ausgefallen: "Nicht erschienen", abgesagt: "Abgesagt" };
export const INV_STATUS = { offen: "Offen", bezahlt: "Bezahlt", storniert: "Storniert" };

export const pat = (id) => ST.S.patients.find((p) => p.id === id);
export const svc = (id) => ST.S.services.find((s) => s.id === id);
export const pname = (p) => (p ? `${p.first} ${p.last}` : "Unbekannt");
export const apptTotal = (a) => a.serviceIds.reduce((t, id) => t + (svc(id)?.price || 0), 0);
export const apptTitle = (a) => a.serviceIds.map((id) => svc(id)?.name || "–").join(" + ");
export const billable = () => ST.S.appts.filter((a) => a.status === "durchgefuehrt" && !a.invoiceId && a.serviceIds.length);
export function overlaps(start, duration, ignoreId) {
  const s = parseLocal(start), e = addMin(s, duration);
  return ST.S.appts.filter((a) => a.id !== ignoreId && a.status !== "abgesagt").filter((a) => {
    const as = parseLocal(a.start), ae = addMin(as, a.duration);
    return as < e && s < ae;
  });
}
export function taxNote(mode) {
  if (mode === "p4") return "Gemäß § 4 Nr. 14 a UStG ist diese Heilbehandlung von der Umsatzsteuer befreit.";
  if (mode === "p19") return "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung).";
  return "";
}

let toastTimer;
export function toast(msg, kind) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.dataset.kind = kind || ""; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), kind === "error" ? 6000 : 2600);
}
export const toastError = (e) => toast(e?.message || String(e), "error");

export function modal(html, { wide = false } = {}) {
  closeModal();
  const ov = document.createElement("div"); ov.className = "overlay"; ov.id = "overlay";
  ov.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</div>`;
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov);
  $$("[data-close]", ov).forEach((b) => (b.onclick = closeModal));
  const first = ov.querySelector("input,select,textarea,button"); if (first) setTimeout(() => first.focus(), 20);
  return ov;
}
export function closeModal() { const o = $("#overlay"); if (o) o.remove(); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

// Button während einer Server-Aktion sperren
export async function busy(btn, fn) {
  if (!btn) return fn();
  const label = btn.textContent; btn.disabled = true; btn.textContent = "Bitte warten …";
  try { return await fn(); } finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
}
// Zweistufige Bestätigung ohne confirm()
export function armed(btn, text) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = "1"; btn.textContent = text; return false;
}
