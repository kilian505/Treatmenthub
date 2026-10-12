-- Treatment Manager – Behandlungsorte (z. B. Hotels), "Rechnung ja/nein" je Termin, Gutscheine
-- Alles additiv: bestehende Daten und die bisherige App-Version funktionieren weiter.

-- ---------------------------------------------------------------------------
-- Behandlungsorte (selbst gepflegte Liste je Praxis)
-- ---------------------------------------------------------------------------
create table public.locations (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index locations_owner_idx on public.locations(owner_id);
alter table public.locations enable row level security;
create policy "locations: eigene Praxis" on public.locations for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_active_practice()))
  with check (owner_id = (select auth.uid()) and (select public.is_active_practice()));

-- ---------------------------------------------------------------------------
-- Termine: Ort und "Rechnung ja/nein"
-- ---------------------------------------------------------------------------
alter table public.appointments
  add column location_id   uuid references public.locations(id) on delete set null,
  add column needs_invoice boolean not null default true;
create index appointments_location_idx on public.appointments(location_id);

-- Abgerechnete Termine: auch Ort und Rechnungs-Schalter sind dann gesperrt
create or replace function public.appointments_guard() returns trigger
language plpgsql set search_path = '' as $$
declare internal boolean := coalesce(current_setting('app.internal', true), '') = '1';
begin
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then raise exception 'Abgerechnete Termine können nicht gelöscht werden.'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.invoice_id is not null and not internal then raise exception 'Rechnungen werden nur über create_invoice verknüpft.'; end if;
    return new;
  end if;
  if new.invoice_id is distinct from old.invoice_id and not internal then
    raise exception 'Die Rechnungs-Verknüpfung kann nicht direkt geändert werden.';
  end if;
  if old.invoice_id is not null and new.invoice_id is not distinct from old.invoice_id and
     (new.patient_id, new.starts_at, new.duration, new.service_ids, new.status, new.needs_invoice)
       is distinct from (old.patient_id, old.starts_at, old.duration, old.service_ids, old.status, old.needs_invoice) then
    raise exception 'Dieser Termin ist abgerechnet. Für Änderungen zuerst die Rechnung stornieren.';
  end if;
  return new;
end $$;

-- create_invoice: Termine mit "Rechnung: nein" sind nicht abrechenbar (sonst unverändert)
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

  select to_jsonb(ps) - 'owner_id' - 'updated_at', ps.pay_days into v_practice, v_pay
    from public.practice_settings ps where ps.owner_id = uid;
  v_practice := coalesce(v_practice, '{}'::jsonb);
  v_pay := coalesce(v_pay, 14);

  insert into public.invoice_counters as c (owner_id, year, last) values (uid, v_year, 1)
    on conflict (owner_id, year) do update set last = c.last + 1
    returning c.last into v_seq;

  insert into public.invoices (owner_id, number, year, seq, patient_id, invoice_date, pay_days, patient, practice,
                               lines, total, period_start, period_end)
  values (uid, 'RE-' || v_year || '-' || lpad(v_seq::text, 4, '0'), v_year, v_seq, p_patient, p_date, v_pay,
          v_patient, v_practice, v_lines, v_total, v_from, v_to)
  returning * into inv;

  perform set_config('app.internal', '1', true);
  update public.appointments set invoice_id = inv.id where id = any(p_appointments);
  perform set_config('app.internal', '', true);
  return inv;
end $$;

-- ---------------------------------------------------------------------------
-- Gutscheine: fortlaufende Nummer GU + Jahr + laufende Nummer (GU202601, GU202602, …)
-- ---------------------------------------------------------------------------
create table public.vouchers (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  number       text not null,
  year         int  not null,
  seq          int  not null,
  recipient    text not null check (length(trim(recipient)) > 0),
  amount       numeric(10,2) not null check (amount >= 0),
  service      text not null default '',
  issued_on    date not null default current_date,
  created_at   timestamptz not null default now(),
  unique (owner_id, year, seq)
);
create index vouchers_owner_idx on public.vouchers(owner_id);

create table public.voucher_counters (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  year     int  not null,
  last     int  not null,
  primary key (owner_id, year)
);

alter table public.vouchers         enable row level security;
alter table public.voucher_counters enable row level security; -- keine Policies: nur über create_voucher

-- Lesen und korrigieren (Name, Betrag, Leistung), aber nicht direkt anlegen oder löschen
create policy "vouchers: eigene lesen" on public.vouchers for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_active_practice()));
create policy "vouchers: eigene ändern" on public.vouchers for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_active_practice()))
  with check (owner_id = (select auth.uid()) and (select public.is_active_practice()));

-- Nummer, Jahr, Ausstellungsdatum und Besitzer bleiben fest
create or replace function public.vouchers_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.number, new.year, new.seq, new.owner_id, new.issued_on, new.created_at)
     is distinct from (old.number, old.year, old.seq, old.owner_id, old.issued_on, old.created_at) then
    raise exception 'Gutscheinnummer und Ausstellungsdatum können nicht geändert werden.';
  end if;
  return new;
end $$;
create trigger vouchers_guard before update on public.vouchers
  for each row execute function public.vouchers_guard();

create or replace function public.create_voucher(p_recipient text, p_amount numeric, p_service text default '',
                                                 p_date date default current_date)
returns public.vouchers
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  v_year int := extract(year from p_date)::int;
  v_seq int;
  v public.vouchers;
begin
  if not public.is_active_practice() then raise exception 'Kein aktives Praxiskonto.' using errcode = '42501'; end if;
  if p_recipient is null or length(trim(p_recipient)) = 0 then raise exception 'Bitte den Namen eintragen.'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Bitte einen gültigen Betrag eintragen.'; end if;

  insert into public.voucher_counters as c (owner_id, year, last) values (uid, v_year, 1)
    on conflict (owner_id, year) do update set last = c.last + 1
    returning c.last into v_seq;

  insert into public.vouchers (owner_id, number, year, seq, recipient, amount, service, issued_on)
  values (uid, 'GU' || v_year || case when v_seq < 100 then lpad(v_seq::text, 2, '0') else v_seq::text end,
          v_year, v_seq, trim(p_recipient), round(p_amount, 2), trim(coalesce(p_service, '')), p_date)
  returning * into v;
  return v;
end $$;

revoke execute on function public.create_voucher(text, numeric, text, date) from public, anon;
grant execute on function public.create_voucher(text, numeric, text, date) to authenticated;
