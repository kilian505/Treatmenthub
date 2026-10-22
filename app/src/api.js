// Datenzugriff: die einzige Stelle, die mit Supabase spricht.
// Übersetzt zwischen Datenbank-Spalten (snake_case) und den Objekten der Oberfläche.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { toLocalStr, parseLocal } from "./util.js";

// Typ des Links, mit dem die Seite geöffnet wurde (Einladung, Passwort-Reset, E-Mail-Bestätigung)
const hash = new URLSearchParams(location.hash.slice(1));
export const linkType = hash.get("type");
export const linkError = hash.get("error_description");

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const MESSAGES = [
  [/invalid login credentials/i, "E-Mail-Adresse oder Passwort stimmen nicht."],
  [/email not confirmed/i, "Bitte bestätigen Sie zuerst Ihre E-Mail-Adresse. Den Link dazu haben wir Ihnen per E-Mail geschickt."],
  [/already registered|already been registered|already exists/i, "Für diese E-Mail-Adresse gibt es bereits ein Konto."],
  [/rate limit|too many/i, "Zu viele Versuche. Bitte warten Sie einige Minuten und versuchen Sie es erneut."],
  [/password should be|weak password/i, "Das Passwort ist zu schwach. Bitte mindestens 8 Zeichen verwenden."],
  [/same.*password|different from the old/i, "Bitte ein anderes als das bisherige Passwort wählen."],
  [/violates foreign key.*appointments|still referenced/i, "Dieser Eintrag wird noch von Terminen oder Rechnungen verwendet."],
  [/failed to fetch|network/i, "Keine Verbindung zum Server. Bitte Internetverbindung prüfen."],
  [/jwt expired|invalid jwt/i, "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich neu an."],
];
export function message(err) {
  const raw = err?.message || String(err || "Unbekannter Fehler");
  for (const [re, txt] of MESSAGES) if (re.test(raw)) return txt;
  return raw;
}
const check = ({ data, error }) => { if (error) throw new Error(message(error)); return data; };

/* ---------------- Anmeldung ---------------- */
export const auth = {
  session: async () => (await sb.auth.getSession()).data.session,
  onChange: (cb) => sb.auth.onAuthStateChange((event, session) => cb(event, session)),
  signIn: async (email, password) => check(await sb.auth.signInWithPassword({ email, password })),
  signUp: async ({ email, password, full_name, practice_name, title }) =>
    check(await sb.auth.signUp({ email, password, options: { data: { full_name, practice_name, title }, emailRedirectTo: appUrl() } })),
  signOut: async () => { await sb.auth.signOut(); },
  sendReset: async (email) => check(await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })),
  setPassword: async (password) => check(await sb.auth.updateUser({ password })),
};
export const appUrl = () => location.origin + location.pathname;

export async function getProfile() {
  const uid = (await auth.session())?.user?.id;
  if (!uid) return null;
  return check(await sb.from("profiles").select("*").eq("id", uid).single());
}

/* ---------------- Mapping ---------------- */
const practiceFrom = (r = {}) => ({ name: r.name || "", owner: r.owner_name || "", title: r.title || "", street: r.street || "", zip: r.zip || "",
  city: r.city || "", phone: r.phone || "", email: r.email || "", taxNo: r.tax_no || "", iban: r.iban || "", bank: r.bank || "",
  taxMode: r.tax_mode || "p4", payDays: r.pay_days ?? 14, logo: logoUrl(r.logo) });
// Logo ist als Daten-URL gespeichert; ältere Einträge enthalten nur die Base64-Daten eines PNG
const logoUrl = (v) => (!v ? "" : v.startsWith("data:") ? v : "data:image/png;base64," + v);
const practiceTo = (p) => ({ name: p.name, owner_name: p.owner, title: p.title, street: p.street, zip: p.zip, city: p.city, phone: p.phone,
  email: p.email, tax_no: p.taxNo, iban: p.iban, bank: p.bank, tax_mode: p.taxMode, pay_days: p.payDays, logo: p.logo || "", updated_at: new Date().toISOString() });
const svcFrom = (r) => ({ id: r.id, name: r.name, code: r.code, duration: r.duration, price: Number(r.price), active: r.active, locationId: r.location_id || null });
const svcTo = (s) => ({ name: s.name, code: s.code || "", duration: s.duration, price: s.price, active: s.active !== false, location_id: s.locationId || null });
const patFrom = (r) => ({ id: r.id, first: r.first_name, last: r.last_name, street: r.street, zip: r.zip, city: r.city, birth: r.birth_date || "",
  phone: r.phone, email: r.email, createdAt: r.created_at });
const patTo = (p) => ({ first_name: p.first, last_name: p.last, street: p.street, zip: p.zip, city: p.city, birth_date: p.birth || null, phone: p.phone || "", email: p.email || "" });
const apptFrom = (r) => ({ id: r.id, patientId: r.patient_id, start: toLocalStr(new Date(r.starts_at)), duration: r.duration, serviceIds: r.service_ids || [],
  status: r.status, note: r.note || "", invoiceId: r.invoice_id, locationId: r.location_id || null, needsInvoice: r.needs_invoice !== false, title: r.title || "", paymentMethod: r.payment_method || "" });
const apptTo = (a) => ({ patient_id: a.patientId, starts_at: parseLocal(a.start).toISOString(), duration: a.duration, service_ids: a.serviceIds, status: a.status, note: a.note || "",
  location_id: a.locationId || null, needs_invoice: a.needsInvoice !== false, title: a.title || "", payment_method: a.paymentMethod || "" });
const locFrom = (r) => ({ id: r.id, name: r.name, active: r.active });
const locTo = (l) => ({ name: l.name, active: l.active !== false });
const vouFrom = (r) => ({ id: r.id, number: r.number, year: r.year, seq: r.seq, recipient: r.recipient, amount: Number(r.amount), service: r.service || "", date: r.issued_on });
const invFrom = (r) => ({ id: r.id, number: r.number, year: r.year, seq: r.seq, patientId: r.patient_id, date: r.invoice_date, payDays: r.pay_days, patient: r.patient,
  practice: practiceFrom(r.practice), lines: (r.lines || []).map((l) => ({ ...l, price: Number(l.price), qty: Number(l.qty) })), total: Number(r.total),
  status: r.status, paidAt: r.paid_at, cancelledAt: r.cancelled_at, period: [r.period_start, r.period_end], location: r.location || "" });

async function fetchAll(table, order) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const rows = check(await sb.from(table).select("*").order(order, { ascending: true }).range(from, from + size - 1));
    out.push(...rows); if (rows.length < size) break;
  }
  return out;
}

/* ---------------- Praxisdaten ---------------- */
export async function loadPractice(profile) {
  const [ps, services, patients, appts, invoices, locations, vouchers] = await Promise.all([
    sb.from("practice_settings").select("*").maybeSingle().then(check),
    fetchAll("services", "created_at"), fetchAll("patients", "created_at"),
    fetchAll("appointments", "starts_at"), fetchAll("invoices", "created_at"),
    fetchAll("locations", "created_at"), fetchAll("vouchers", "created_at"),
  ]);
  const practice = ps ? practiceFrom(ps) : practiceFrom({ name: profile.practice_name, owner_name: profile.full_name, title: profile.title, email: profile.email });
  return { practice, practiceSaved: !!ps, services: services.map(svcFrom), patients: patients.map(patFrom), appts: appts.map(apptFrom), invoices: invoices.map(invFrom),
    locations: locations.map(locFrom), vouchers: vouchers.map(vouFrom) };
}
export const savePractice = async (p) => practiceFrom(check(await sb.from("practice_settings").upsert(practiceTo(p)).select().single()));

export async function saveService(s) {
  const q = s.id ? sb.from("services").update(svcTo(s)).eq("id", s.id) : sb.from("services").insert(svcTo(s));
  return svcFrom(check(await q.select().single()));
}
export const deleteService = async (id) => check(await sb.from("services").delete().eq("id", id));

export async function savePatient(p) {
  const q = p.id ? sb.from("patients").update(patTo(p)).eq("id", p.id) : sb.from("patients").insert(patTo(p));
  return patFrom(check(await q.select().single()));
}

export async function saveAppt(a) {
  const q = a.id ? sb.from("appointments").update(apptTo(a)).eq("id", a.id) : sb.from("appointments").insert(apptTo(a));
  return apptFrom(check(await q.select().single()));
}
export const deleteAppt = async (id) => check(await sb.from("appointments").delete().eq("id", id));

export async function createInvoice(patientId, apptIds, date, locationId) {
  const args = { p_patient: patientId, p_appointments: apptIds };
  if (date) args.p_date = date;
  if (locationId) args.p_location = locationId;
  return invFrom(check(await sb.rpc("create_invoice_at", args)));
}
export async function saveLocation(l) {
  const q = l.id ? sb.from("locations").update(locTo(l)).eq("id", l.id) : sb.from("locations").insert(locTo(l));
  return locFrom(check(await q.select().single()));
}
export const deleteLocation = async (id) => check(await sb.from("locations").delete().eq("id", id));

export async function createVoucher(v) {
  const args = { p_recipient: v.recipient, p_amount: v.amount, p_service: v.service || "" };
  if (v.date) args.p_date = v.date;
  return vouFrom(check(await sb.rpc("create_voucher", args)));
}
export const updateVoucher = async (v) =>
  vouFrom(check(await sb.from("vouchers").update({ recipient: v.recipient, amount: v.amount, service: v.service || "" }).eq("id", v.id).select().single()));

// Rechnungsnummern: aktueller Stand und Start nach Umstieg aus einem anderen Rechnungsprogramm
export const invoiceCounter = async (year) => check(await sb.rpc("invoice_counter", { p_year: year }));
export const deleteInvoice = async (id) => check(await sb.rpc("delete_invoice", { p_invoice: id }));
export const setInvoiceNumber = async (id, seq) => invFrom(check(await sb.rpc("set_invoice_number", { p_invoice: id, p_seq: seq })));
export const setInvoiceStart = async (year, last) => check(await sb.rpc("set_invoice_start", { p_year: year, p_last: last }));
export const setInvoiceStatus = async (id, status) => invFrom(check(await sb.from("invoices").update({ status }).eq("id", id).select().single()));

/* Bulk-Import für Beispieldaten (nur für leere Test-Praxen) */
export async function insertMany(table, rows, map) {
  const out = [];
  for (let i = 0; i < rows.length; i += 500) out.push(...check(await sb.from(table).insert(rows.slice(i, i + 500).map(map)).select()));
  return out;
}
export const mappers = { svcTo, svcFrom, patTo, patFrom, apptTo, apptFrom };

/* ---------------- Admin (nur Konten, keine Praxisdaten) ---------------- */
export const admin = {
  list: async () => check(await sb.rpc("admin_list_accounts")),
  setStatus: async (id, status) => check(await sb.rpc("admin_set_status", { p_user: id, p_status: status })),
  invite: async (payload) => callFn({ action: "invite", ...payload, redirect_to: appUrl() }),
  reject: async (id) => callFn({ action: "reject", user_id: id }),
};
async function callFn(body) {
  const { data, error } = await sb.functions.invoke("admin-accounts", { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch (_) {}
    throw new Error(message({ message: msg }));
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
