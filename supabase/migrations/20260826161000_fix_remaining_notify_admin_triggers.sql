-- Two more triggers carrying the exact same leaked key fixed in
-- 20260826160000_notify_admin_vault_secret.sql -- discovered by sweeping
-- every trigger definition in the database for the leaked key's literal
-- text, not previously known about. These were never tracked in a
-- migration file (created directly against the database at some point),
-- so they weren't part of the public GitHub leak, but they're the same
-- live, already-compromised credential sitting in the database itself --
-- equally worth closing.
drop trigger if exists "notify-admin-lineup" on public.gig_lineup;
create trigger notify_admin_lineup
  after update on public.gig_lineup
  for each row execute function public.notify_admin_webhook();

drop trigger if exists "notify-admin-claims" on public.musician_claims;
create trigger notify_admin_claims
  after insert or update on public.musician_claims
  for each row execute function public.notify_admin_webhook();
