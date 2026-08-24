-- From Supabase's database linter, run against the live project.
--
-- snapshot_confirmed_fee: pin search_path (lint 0011).
--
-- Worth being precise about severity: this function is SECURITY INVOKER (the
-- live definition has no SECURITY DEFINER clause), so it runs with the
-- caller's own privileges and a hostile search_path could not use it to
-- escalate. That is a very different situation from the same lint firing on
-- a SECURITY DEFINER function. Every SECURITY DEFINER function in this schema
-- does already pin search_path -- verified against pg_proc, not assumed.
--
-- Setting it anyway: it silences the linter so genuine findings stand out,
-- and it means the function keeps resolving `public` if anyone later adds a
-- SECURITY DEFINER clause without thinking about the consequences.
--
-- Body below is copied verbatim from the live definition -- unchanged.
create or replace function public.snapshot_confirmed_fee()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.confirmed = true and (tg_op = 'INSERT' or coalesce(old.confirmed, false) = false) then
    new.confirmed_fee_pence := new.fee_pence;
  elsif new.confirmed = false then
    new.confirmed_fee_pence := null;
  end if;
  return new;
end;
$function$;
