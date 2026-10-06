-- Entfernt die Testkonten aus den Sicherheitstests (im Supabase SQL-Editor ausführen)
begin;
select set_config('app.internal', '1', true);
update public.appointments set invoice_id = null
 where owner_id in (select id from auth.users where email in ('test-admin@example.org','test-praxis1@example.org','test-praxis2@example.org'));
delete from public.appointments
 where owner_id in (select id from auth.users where email in ('test-admin@example.org','test-praxis1@example.org','test-praxis2@example.org'));
delete from public.invoices
 where owner_id in (select id from auth.users where email in ('test-admin@example.org','test-praxis1@example.org','test-praxis2@example.org'));
delete from auth.users where email in ('test-admin@example.org','test-praxis1@example.org','test-praxis2@example.org');
commit;
