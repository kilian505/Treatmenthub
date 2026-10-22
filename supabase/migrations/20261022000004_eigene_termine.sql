-- Treatment Manager – Termine ohne Behandlung (z. B. privat, Besprechung, Fortbildung)
-- Solche Termine haben keinen Kunden, keine Leistungen und nie eine Rechnung, dafür einen Titel.

alter table public.appointments alter column patient_id drop not null;
alter table public.appointments add column title text not null default '';
alter table public.appointments add constraint appointments_kunde_oder_titel check (
  patient_id is not null
  or (length(trim(title)) > 0 and cardinality(service_ids) = 0 and not needs_invoice and invoice_id is null)
);
