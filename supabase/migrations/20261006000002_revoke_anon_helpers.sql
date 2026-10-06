-- Hilfsfunktionen nicht für anonyme Aufrufe freigeben
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_active_practice() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_practice() to authenticated;
