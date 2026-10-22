-- Treatment Manager – Rechnungsnummer einer erstellten Rechnung ändern
-- Nur über set_invoice_number: gleiches Jahr, Nummer noch frei, Rechnung nicht storniert.
-- Alle anderen Rechnungsdaten bleiben unveränderlich.

create or replace function public.invoices_guard() returns trigger
language plpgsql set search_path = '' as $$
declare internal boolean := coalesce(current_setting('app.internal', true), '') = '1';
begin
  if (case when internal then old.number else new.number end, new.year,
      case when internal then old.seq else new.seq end, new.patient_id, new.invoice_date, new.pay_days, new.patient, new.practice,
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

create or replace function public.set_invoice_number(p_invoice uuid, p_seq int) returns public.invoices
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); inv public.invoices; v_number text;
begin
  if not public.is_active_practice() then raise exception 'Kein aktives Praxiskonto.' using errcode = '42501'; end if;
  select * into inv from public.invoices where id = p_invoice and owner_id = uid;
  if inv.id is null then raise exception 'Rechnung nicht gefunden.'; end if;
  if inv.status = 'storniert' then raise exception 'Bei einer stornierten Rechnung kann die Nummer nicht geändert werden.'; end if;
  if p_seq is null or p_seq < 1 or p_seq > 999999 then raise exception 'Ungültige Rechnungsnummer.'; end if;
  if p_seq = inv.seq then return inv; end if;
  v_number := inv.year || '-' || lpad(p_seq::text, 3, '0');
  if exists (select 1 from public.invoices where owner_id = uid and year = inv.year and seq = p_seq) then
    raise exception 'Die Nummer % ist schon vergeben.', v_number;
  end if;
  perform set_config('app.internal', '1', true);
  update public.invoices set number = v_number, seq = p_seq where id = inv.id returning * into inv;
  perform set_config('app.internal', '', true);
  -- Damit neue Rechnungen nicht auf diese Nummer stoßen
  update public.invoice_counters set last = p_seq where owner_id = uid and year = inv.year and last < p_seq;
  return inv;
end $$;
revoke execute on function public.set_invoice_number(uuid, int) from public, anon;
grant execute on function public.set_invoice_number(uuid, int) to authenticated;
