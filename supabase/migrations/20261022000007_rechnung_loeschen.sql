-- Treatment Manager – Rechnung komplett löschen
-- Die Termine werden wieder abrechenbar. War es die zuletzt vergebene Nummer des Jahres,
-- wird der Zähler zurückgesetzt, sodass die nächste Rechnung diese Nummer wieder bekommt.

create or replace function public.delete_invoice(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); inv public.invoices;
begin
  if not public.is_active_practice() then raise exception 'Kein aktives Praxiskonto.' using errcode = '42501'; end if;
  select * into inv from public.invoices where id = p_invoice and owner_id = uid;
  if inv.id is null then raise exception 'Rechnung nicht gefunden.'; end if;
  perform set_config('app.internal', '1', true);
  update public.appointments set invoice_id = null where invoice_id = inv.id;
  delete from public.invoices where id = inv.id;
  perform set_config('app.internal', '', true);
  update public.invoice_counters set last = inv.seq - 1 where owner_id = uid and year = inv.year and last = inv.seq;
end $$;
revoke execute on function public.delete_invoice(uuid) from public, anon;
grant execute on function public.delete_invoice(uuid) to authenticated;
