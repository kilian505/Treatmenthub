-- Treatment Manager – Rechnungsnummer in den Einstellungen frei einstellbar
-- Auch zurücksetzen ist erlaubt, aber nie unter eine schon vergebene Nummer (keine doppelten Nummern).

create or replace function public.set_invoice_start(p_year int, p_last int) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); used int;
begin
  if not public.is_active_practice() then raise exception 'Kein aktives Praxiskonto.' using errcode = '42501'; end if;
  if p_last is null or p_last < 0 or p_last > 999999 then raise exception 'Ungültige Rechnungsnummer.'; end if;
  select max(seq) into used from public.invoices where owner_id = uid and year = p_year;
  if used is not null and p_last < used then
    raise exception 'Die Nummer %-% ist schon vergeben. Die nächste Nummer muss danach kommen.', p_year, lpad(used::text, 3, '0');
  end if;
  insert into public.invoice_counters (owner_id, year, last) values (uid, p_year, p_last)
    on conflict (owner_id, year) do update set last = excluded.last;
end $$;
revoke execute on function public.set_invoice_start(int, int) from public, anon;
grant execute on function public.set_invoice_start(int, int) to authenticated;
