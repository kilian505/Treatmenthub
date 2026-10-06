-- Treatment Manager – Grundschema
-- Grundsatz: Jede Praxis sieht nur ihre eigenen Daten. Admins verwalten nur Konten
-- und haben per Row Level Security KEINEN Zugriff auf Patienten, Termine, Leistungen oder Rechnungen.

-- ---------------------------------------------------------------------------
-- Konten
-- ---------------------------------------------------------------------------
create table public.app_admins (
  email text primary key
);
alter table public.app_admins enable row level security; -- keine Policies: nur per SQL pflegbar

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  full_name     text not null default '',
  practice_name text not null default '',
  title         text not null default 'Heilpraktiker/in',
  role          text not null default 'user'    check (role in ('admin','user')),
  status        text not null default 'pending' check (status in ('pending','active','blocked')),
  created_at    timestamptz not null default now(),
  approved_at   timestamptz
);
alter table public.profiles enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles
                 where id = (select auth.uid()) and role = 'admin' and status = 'active');
$$;

create or replace function public.is_active_practice() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles
                 where id = (select auth.uid()) and role = 'user' and status = 'active');
$$;

create policy "profiles: eigenes Profil lesen" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles: eigenes Profil ändern" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Rolle, Status und E-Mail können Nutzer nicht selbst ändern
-- (Ausnahme: Admin-Funktion admin_set_status setzt app.admin_action).
create or replace function public.profiles_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null and coalesce(current_setting('app.admin_action', true), '') <> '1' then
    new.role := old.role;
    new.email := old.email;
    new.status := old.status;
    new.approved_at := old.approved_at;
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Neues Auth-Konto -> Profil (Status "wartet auf Freischaltung", Admins aus app_admins sofort aktiv)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare adm boolean;
begin
  adm := exists (select 1 from public.app_admins a where lower(a.email) = lower(new.email));
  insert into public.profiles (id, email, full_name, practice_name, title, role, status, approved_at)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'practice_name', ''),
    coalesce(nullif(new.raw_user_meta_data->>'title', ''), 'Heilpraktiker/in'),
    case when adm then 'admin' else 'user' end,
    case when adm then 'active' else 'pending' end,
    case when adm then now() end
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admin: Kontenliste inkl. letzter Anmeldung (ohne jegliche Praxisdaten)
create or replace function public.admin_list_accounts()
returns table (id uuid, email text, full_name text, practice_name text, title text, role text, status text,
               created_at timestamptz, approved_at timestamptz, last_sign_in_at timestamptz,
               email_confirmed_at timestamptz, invited_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Nur für Administratoren.' using errcode = '42501'; end if;
  return query
    select p.id, p.email, p.full_name, p.practice_name, p.title, p.role, p.status, p.created_at, p.approved_at,
           u.last_sign_in_at, u.email_confirmed_at, u.invited_at
    from public.profiles p join auth.users u on u.id = p.id
    order by p.created_at desc;
end $$;

-- Admin: Konto freischalten / sperren / entsperren
create or replace function public.admin_set_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Nur für Administratoren.' using errcode = '42501'; end if;
  if p_status not in ('active','blocked') then raise exception 'Ungültiger Status.'; end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'admin') then
    raise exception 'Admin-Konten können hier nicht geändert werden.';
  end if;
  perform set_config('app.admin_action', '1', true);
  update public.profiles
     set status = p_status,
         approved_at = case when p_status = 'active' and approved_at is null then now() else approved_at end
   where id = p_user;
  perform set_config('app.admin_action', '', true);
end $$;

-- ---------------------------------------------------------------------------
-- Praxisdaten (nur für aktive Praxis-Konten, nie für Admins)
-- ---------------------------------------------------------------------------
create table public.practice_settings (
  owner_id   uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  name       text not null default '',
  owner_name text not null default '',
  title      text not null default '',
  street     text not null default '',
  zip        text not null default '',
  city       text not null default '',
  phone      text not null default '',
  email      text not null default '',
  tax_no     text not null default '',
  iban       text not null default '',
  bank       text not null default '',
  tax_mode   text not null default 'p4' check (tax_mode in ('p4','p19','none')),
  pay_days   int  not null default 14 check (pay_days >= 0),
  updated_at timestamptz not null default now()
);

create table public.services (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  code       text not null default '',
  duration   int  not null check (duration > 0),
  price      numeric(10,2) not null check (price >= 0),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index services_owner_idx on public.services(owner_id);

create table public.patients (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  first_name text not null,
  last_name  text not null,
  street     text not null default '',
  zip        text not null default '',
  city       text not null default '',
  birth_date date,
  phone      text not null default '',
  email      text not null default '',
  created_at timestamptz not null default now()
);
create index patients_owner_idx on public.patients(owner_id);

create table public.invoices (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  number        text not null,
  year          int  not null,
  seq           int  not null,
  patient_id    uuid not null references public.patients(id) on delete restrict,
  invoice_date  date not null,
  pay_days      int  not null,
  patient       jsonb not null,
  practice      jsonb not null,
  lines         jsonb not null,
  total         numeric(10,2) not null,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'offen' check (status in ('offen','bezahlt','storniert')),
  paid_at       date,
  cancelled_at  date,
  created_at    timestamptz not null default now(),
  unique (owner_id, year, seq)
);
create index invoices_owner_idx on public.invoices(owner_id);
create index invoices_patient_idx on public.invoices(patient_id);

create table public.appointments (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  patient_id  uuid not null references public.patients(id) on delete restrict,
  starts_at   timestamptz not null,
  duration    int not null check (duration > 0),
  service_ids uuid[] not null default '{}',
  status      text not null default 'geplant' check (status in ('geplant','durchgefuehrt','ausgefallen','abgesagt')),
  note        text not null default '',
  invoice_id  uuid references public.invoices(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index appointments_owner_start_idx on public.appointments(owner_id, starts_at);
create index appointments_patient_idx on public.appointments(patient_id);
create index appointments_invoice_idx on public.appointments(invoice_id);

create table public.invoice_counters (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  year     int  not null,
  last     int  not null,
  primary key (owner_id, year)
);

alter table public.practice_settings enable row level security;
alter table public.services          enable row level security;
alter table public.patients          enable row level security;
alter table public.appointments      enable row level security;
alter table public.invoices          enable row level security;
alter table public.invoice_counters  enable row level security; -- keine Policies: nur über create_invoice

create policy "practice_settings: eigene Praxis" on public.practice_settings for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_active_practice()))
  with check (owner_id = (select auth.uid()) and (select public.is_active_practice()));
create policy "services: eigene Praxis" on public.services for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_active_practice()))
  with check (owner_id = (select auth.uid()) and (select public.is_active_practice()));
create policy "patients: eigene Praxis" on public.patients for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_active_practice()))
  with check (owner_id = (select auth.uid()) and (select public.is_active_practice()));
create policy "appointments: eigene Praxis" on public.appointments for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_active_practice()))
  with check (owner_id = (select auth.uid()) and (select public.is_active_practice()));
-- Rechnungen: lesen und Status ändern, aber nicht direkt anlegen oder löschen
create policy "invoices: eigene lesen" on public.invoices for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_active_practice()));
create policy "invoices: Status ändern" on public.invoices for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_active_practice()))
  with check (owner_id = (select auth.uid()) and (select public.is_active_practice()));

-- Abgerechnete Termine sind gesperrt; invoice_id ändert nur das System
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
     (new.patient_id, new.starts_at, new.duration, new.service_ids, new.status)
       is distinct from (old.patient_id, old.starts_at, old.duration, old.service_ids, old.status) then
    raise exception 'Dieser Termin ist abgerechnet. Für Änderungen zuerst die Rechnung stornieren.';
  end if;
  return new;
end $$;
create trigger appointments_guard before insert or update or delete on public.appointments
  for each row execute function public.appointments_guard();

-- Rechnungen sind unveränderbar (GoBD). Nur Status-Wechsel offen <-> bezahlt und -> storniert.
create or replace function public.invoices_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.number, new.year, new.seq, new.patient_id, new.invoice_date, new.pay_days, new.patient, new.practice,
      new.lines, new.total, new.period_start, new.period_end, new.owner_id, new.created_at)
     is distinct from
     (old.number, old.year, old.seq, old.patient_id, old.invoice_date, old.pay_days, old.patient, old.practice,
      old.lines, old.total, old.period_start, old.period_end, old.owner_id, old.created_at) then
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
create trigger invoices_guard before update on public.invoices
  for each row execute function public.invoices_guard();

-- Rechnung erstellen: fortlaufende Nummer, Preise/Adressen als Snapshot, Termine verknüpfen – atomar.
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
     and a.status = 'durchgefuehrt' and a.invoice_id is null and cardinality(a.service_ids) > 0;
  if n_ok <> cardinality(array(select distinct unnest(p_appointments))) then
    raise exception 'Mindestens ein Termin ist nicht abrechenbar (nicht durchgeführt oder schon abgerechnet).';
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

-- Ausführungsrechte: nur angemeldete Nutzer, nie anonym
revoke execute on function public.create_invoice(uuid, uuid[], date) from public, anon;
revoke execute on function public.admin_list_accounts() from public, anon;
revoke execute on function public.admin_set_status(uuid, text) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.create_invoice(uuid, uuid[], date) to authenticated;
grant execute on function public.admin_list_accounts() to authenticated;
grant execute on function public.admin_set_status(uuid, text) to authenticated;

-- Erster Admin
-- Admin-Adresse(n) eintragen (in der Datenbank bereits gesetzt, hier bewusst nicht öffentlich):
-- insert into public.app_admins (email) values ('deine-adresse@example.com');
