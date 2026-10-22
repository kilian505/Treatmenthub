-- Treatment Manager – Leistungen je Behandlungsort
-- Gleiche Behandlung, anderer Preis je Hotel: eine Leistung kann einem Ort zugeordnet werden.
-- Ohne Ort gilt sie überall. Additiv, bestehende Leistungen bleiben ohne Ort.

alter table public.services
  add column location_id uuid references public.locations(id) on delete set null;
create index services_location_idx on public.services(location_id);
