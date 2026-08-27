-- Same class of gap guard_profile_insert closed for profiles, missed here:
-- protect_band_connect_fields_trigger only fires BEFORE UPDATE, but
-- bands_insert_admin's WITH CHECK is (is_admin() OR is_band_leader()) --
-- any existing band leader of ANY band, not just this one -- with no
-- column restriction. Combined with bands_auto_assign_leader (which
-- auto-adds the inserting user as this new band's own leader), a non-admin
-- leader could `.insert({ name: 'x', stripe_connect_account_id: '...',
-- stripe_connect_status: 'active' })` directly from the browser console,
-- self-declaring a verified-looking Connect account on a band they just
-- created and were auto-assigned to lead -- skipping real Stripe
-- onboarding entirely, exactly what the UPDATE-time trigger already
-- exists to prevent. Extends the same function to cover INSERT too,
-- mirroring guard_profile_insert's unconditional-null approach (there's no
-- OLD row to revert to on insert).
create or replace function public.protect_band_connect_fields()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.stripe_connect_account_id := null;
      new.stripe_connect_status := null;
    else
      new.stripe_connect_account_id := old.stripe_connect_account_id;
      new.stripe_connect_status := old.stripe_connect_status;
    end if;
  end if;
  return new;
end;
$$;

create trigger protect_band_connect_fields_insert_trigger
  before insert on public.bands
  for each row execute function public.protect_band_connect_fields();
