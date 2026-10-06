// Edge Function: Konten-Aktionen, die den Service-Schlüssel brauchen.
// - invite: neues Praxis-Konto per Einladungs-E-Mail anlegen (Admin sieht nie ein Passwort)
// - reject: offenen Antrag ablehnen (Konto wird gelöscht; nur Status "pending")
// Aufrufer muss ein aktiver Admin sein. Zugriff auf Praxisdaten gibt es hier bewusst nicht.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST erlaubt." }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1) Aufrufer prüfen: aktiver Admin?
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc("is_admin");
  if (adminErr || !isAdmin) return json({ error: "Nur für Administratoren." }, 403);

  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Ungültige Anfrage." }, 400); }
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  if (body.action === "invite") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const full_name = String(body.full_name ?? "").trim();
    const practice_name = String(body.practice_name ?? "").trim();
    const title = String(body.title ?? "").trim() || "Heilpraktiker/in";
    if (!/^\S+@\S+\.\S+$/.test(email) || !full_name || !practice_name) {
      return json({ error: "Name, Praxisname und eine gültige E-Mail-Adresse sind Pflicht." }, 400);
    }
    const redirectTo = body.redirect_to || undefined;
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name, practice_name, title }, redirectTo });
    if (error) {
      const msg = /already/i.test(error.message) ? "Für diese E-Mail-Adresse gibt es bereits ein Konto." : error.message;
      return json({ error: msg }, 400);
    }
    // Eingeladene Konten sind direkt freigeschaltet
    const { error: upErr } = await admin.from("profiles")
      .update({ status: "active", approved_at: new Date().toISOString() }).eq("id", data.user.id);
    if (upErr) return json({ error: upErr.message }, 500);
    return json({ ok: true, id: data.user.id });
  }

  if (body.action === "reject") {
    const id = String(body.user_id ?? "");
    const { data: prof } = await admin.from("profiles").select("status, role").eq("id", id).single();
    if (!prof) return json({ error: "Konto nicht gefunden." }, 404);
    if (prof.role !== "user" || prof.status !== "pending") return json({ error: "Nur offene Anträge können abgelehnt werden." }, 400);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Unbekannte Aktion." }, 400);
});
