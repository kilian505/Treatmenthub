-- Treatment Manager – Behandlungsort (Hotel) auf der Rechnung
-- Beim Erstellen wird der Ort gewählt (Vorschlag: Ort der Termine); sein Name wird wie die übrigen
-- Rechnungsdaten fest in die Rechnung übernommen.

alter table public.invoices add column location text not null default '';

create or replace function public.invoices_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.number, new.year, new.seq, new.patient_id, new.invoice_date, new.pay_days, new.patient, new.practice,
      new.lines, new.total, new.period_start, new.period_end, new.owner_id, new.created_at, new.location)
     is distinct from
     (old.number, old.year, old.seq, old.patient_id, old.invoice_date, old.pay_days, old.patient, old.practice,
      old.lines, old.total, old.period_start, old.period_end, old.owner_id, old.created_at, old.location) then
    raise exception 'Rechnungen können nicht geändert werden. Bitte stornieren und neu erstellen.';
  end if;
  if old.status = 'storniert' and new.status <> 'storniert' then
    raise exception 'Eine stornierte Rechnung kann nicht wieder geöffnet werden.';
  end if;
  if new.status = 'bezahlt' and old.status <> 'bezahlt' then new.paid_at := coalesce(new.paid_at, current_date); end if;
  if new.status = 'offen' then new.paid_at := null; end if;
  if new.status = 'storniert' and old.status <> 'storniert' then
    new.cancelled_at := current_date;
    perform set_config('app.internal', '1', true);
    update public.appointments set invoice_id = null where invoice_id = old.id;
    perform set_config('app.internal', '', true);
  end if;
  if new.status <> 'storniert' then new.cancelled_at := old.cancelled_at; end if;
  return new;
end $$;

-- Neue Variante mit Ort; create_invoice ohne Ort bleibt für ältere App-Stände bestehen
create or replace function public.create_invoice_at(p_patient uuid, p_appointments uuid[], p_date date default current_date,
                                                    p_location uuid default null)
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
  v_location text := '';
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

  if p_location is not null then
    select l.name into v_location from public.locations l where l.id = p_location and l.owner_id = uid;
    if v_location is null then raise exception 'Ort nicht gefunden.'; end if;
  end if;

  select to_jsonb(ps) - 'owner_id' - 'updated_at' - 'logo', ps.pay_days into v_practice, v_pay
    from public.practice_settings ps where ps.owner_id = uid;
  v_practice := coalesce(v_practice, '{}'::jsonb);
  v_pay := coalesce(v_pay, 14);

  insert into public.invoice_counters as c (owner_id, year, last) values (uid, v_year, 1)
    on conflict (owner_id, year) do update set last = c.last + 1
    returning c.last into v_seq;

  insert into public.invoices (owner_id, number, year, seq, patient_id, invoice_date, pay_days, patient, practice,
                               lines, total, period_start, period_end, location)
  values (uid, v_year || '-' || lpad(v_seq::text, 3, '0'), v_year, v_seq, p_patient, p_date, v_pay,
          v_patient, v_practice, v_lines, v_total, v_from, v_to, v_location)
  returning * into inv;

  perform set_config('app.internal', '1', true);
  update public.appointments set invoice_id = inv.id where id = any(p_appointments);
  perform set_config('app.internal', '', true);
  return inv;
end $$;

revoke execute on function public.create_invoice_at(uuid, uuid[], date, uuid) from public, anon;
grant execute on function public.create_invoice_at(uuid, uuid[], date, uuid) to authenticated;
