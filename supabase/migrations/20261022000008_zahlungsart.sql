-- Zahlungsart je Termin (nur intern, erscheint nicht auf der Rechnung)
alter table public.appointments
  add column if not exists payment_method text not null default ''
  check (payment_method in ('', 'paypal', 'ueberweisung', 'bar'));
