-- Treatment Manager – Rechnungen im Stil der bisherigen Praxis-Rechnungen
-- * Logo der Praxis (als Bild-Daten-URL), erscheint oben rechts auf Rechnungen
-- * Rechnungsnummer im Format JJJJ-NNN (z. B. 2026-007) statt RE-JJJJ-NNNN; bestehende Nummern bleiben
-- * Startnummer: Wer bisher anders Rechnungen geschrieben hat, trägt die letzte Nummer des Jahres ein,
--   die App macht mit der nächsten weiter. Nur erhöhen, nie zurücksetzen (keine doppelten Nummern).

alter table public.practice_settings add column logo text not null default '';

-- create_invoice wie bisher, nur neues Nummernformat; das Logo wird nicht in jede Rechnung kopiert
create or replace function public.create_invoice(p_patient uuid, p_appointments uuid[], p_date date default current_date)
returns public.invoices
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  n_ok int;
  v_lines jsonb;
  v_total numeric(10,2);
  v_year int := extract(year from p_date)::int;
  v_seq int;
  v_patient jsonb;
  v_practice jsonb;
  v_pay int;
  v_from date; v_to date;
  inv public.invoices;
begin
  if not public.is_active_practice() then raise exception 'Kein aktives Praxiskonto.' using errcode = '42501'; end if;
  if p_appointments is null or array_length(p_appointments, 1) is null then raise exception 'Keine Termine ausgewählt.'; end if;

  select jsonb_build_object('name', p.first_name || ' ' || p.last_name, 'street', p.street, 'zip', p.zip,
                            'city', p.city, 'birth', p.birth_date)
    into v_patient
    from public.patients p where p.id = p_patient and p.owner_id = uid;
  if v_patient is null then raise exception 'Patient nicht gefunden.'; end if;

  select count(*) into n_ok from public.appointments a
   where a.id = any(p_appointments) and a.owner_id = uid and a.patient_id = p_patient
     and a.status = 'durchgefuehrt' and a.invoice_id is null and a.needs_invoice and cardinality(a.service_ids) > 0;
  if n_ok <> cardinality(array(select distinct unnest(p_appointments))) then
    raise exception 'Mindestens ein Termin ist nicht abrechenbar (nicht durchgeführt, schon abgerechnet oder ohne Rechnung).';
  end if;

  select jsonb_agg(jsonb_build_object('date', (a.starts_at at time zone 'Europe/Berlin')::date, 'name', s.name,
                                      'code', s.code, 'qty', 1, 'price', s.price)
                   order by a.starts_at, u.ord),
         coalesce(sum(s.price), 0),
         min((a.starts_at at time zone 'Europe/Berlin')::date), max((a.starts_at at time zone 'Europe/Berlin')::date)
    into v_lines, v_total, v_from, v_to
    from public.appointments a
    cross join lateral unnest(a.service_ids) with ordinality as u(sid, ord)
    join public.services s on s.id = u.sid and s.owner_id = uid
   where a.id = any(p_appointments);
  if v_lines is null then raise exception 'Die Termine enthalten keine gültigen Leistungen.'; end if;

  select to_jsonb(ps) - 'owner_id' - 'updated_at' - 'logo', ps.pay_days into v_practice, v_pay
    from public.practice_settings ps where ps.owner_id = uid;
  v_practice := coalesce(v_practice, '{}'::jsonb);
  v_pay := coalesce(v_pay, 14);

  insert into public.invoice_counters as c (owner_id, year, last) values (uid, v_year, 1)
    on conflict (owner_id, year) do update set last = c.last + 1
    returning c.last into v_seq;

  insert into public.invoices (owner_id, number, year, seq, patient_id, invoice_date, pay_days, patient, practice,
                               lines, total, period_start, period_end)
  values (uid, v_year || '-' || lpad(v_seq::text, 3, '0'), v_year, v_seq, p_patient, p_date, v_pay,
          v_patient, v_practice, v_lines, v_total, v_from, v_to)
  returning * into inv;

  perform set_config('app.internal', '1', true);
  update public.appointments set invoice_id = inv.id where id = any(p_appointments);
  perform set_config('app.internal', '', true);
  return inv;
end $$;

create or replace function public.set_invoice_start(p_year int, p_last int) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); cur int;
begin
  if not public.is_active_practice() then raise exception 'Kein aktives Praxiskonto.' using errcode = '42501'; end if;
  if p_last is null or p_last < 0 or p_last > 999999 then raise exception 'Ungültige Rechnungsnummer.'; end if;
  select last into cur from public.invoice_counters where owner_id = uid and year = p_year;
  if cur is not null and p_last < cur then
    raise exception 'Für % ist schon die Nummer % vergeben. Die Nummer kann nur erhöht werden.', p_year, cur;
  end if;
  insert into public.invoice_counters (owner_id, year, last) values (uid, p_year, p_last)
    on conflict (owner_id, year) do update set last = excluded.last;
end $$;
revoke execute on function public.set_invoice_start(int, int) from public, anon;
grant execute on function public.set_invoice_start(int, int) to authenticated;

-- Aktueller Stand für die Anzeige in den Praxis-Einstellungen
create or replace function public.invoice_counter(p_year int) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select last from public.invoice_counters where owner_id = (select auth.uid()) and year = p_year
                   and public.is_active_practice()), 0);
$$;
revoke execute on function public.invoice_counter(int) from public, anon;
grant execute on function public.invoice_counter(int) to authenticated;
