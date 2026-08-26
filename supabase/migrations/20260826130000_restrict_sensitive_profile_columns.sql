-- Stops musicians reading each other's bank details.
--
-- profiles RLS is row-level: can_view_profile() correctly lets you see a
-- bandmate's row so rosters and day sheets work, but "see the row" has
-- always meant "see every column in it" -- including bank_account_number,
-- bank_sort_code and calendar_token. Anyone sharing a gig or a band with
-- you could read your bank details.
--
-- This also makes an existing protection real rather than cosmetic. There
-- is a get_gig_roster_phones RPC that deliberately returns numbers only for
-- musicians who ticked share_phone_on_daysheet, and useOfflineGigData is
-- careful never to select phone directly. None of that helped while the
-- column itself was readable. phone is NOT revoked here -- band leaders'
-- dep-finder and WhatsApp-group features read it legitimately and would
-- need their own RPCs first -- but the same reasoning applies and it is
-- worth a follow-up.
--
-- RLS can't express column-level rules, so this uses grants: drop the
-- blanket SELECT and hand back only the columns that are safe to share.
-- Legitimate access to the rest goes through the security-definer
-- functions below, which check the caller themselves.

revoke select on public.profiles from authenticated;

grant select (
  id, full_name, role, phone, created_at, is_active,
  home_address, home_latitude, home_longitude,
  share_phone_on_daysheet, available_for_dep_work, ui_theme,
  avail_sun, avail_mon, avail_tue, avail_wed, avail_thu, avail_fri, avail_sat,
  has_pa, has_subs, has_iem, has_mics, has_cables, has_lighting,
  equipment_notes, avatar_url,
  -- Status, not an identifier: needed to decide what the payouts UI shows.
  stripe_connect_status,
  -- Drives the Pro gate throughout the app.
  subscription_tier
) on public.profiles to authenticated;

-- Left revoked, reachable only via the functions below:
--   bank_name, bank_account_name, bank_sort_code, bank_account_number,
--   stripe_connect_account_id, stripe_customer_id, stripe_subscription_id,
--   calendar_token
--
-- UPDATE is deliberately untouched -- writing your own details is still a
-- plain update, gated by the existing row policy.

-- Your own payment details, or anyone's if you're the admin (who needs
-- them to pay musicians by manual bank transfer).
create or replace function public.get_payment_details(p_profile_id uuid default null)
returns table (
  full_name text,
  phone text,
  bank_name text,
  bank_account_name text,
  bank_sort_code text,
  bank_account_number text,
  stripe_connect_account_id text,
  stripe_connect_status text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.full_name, p.phone, p.bank_name, p.bank_account_name,
         p.bank_sort_code, p.bank_account_number,
         p.stripe_connect_account_id, p.stripe_connect_status
  from public.profiles p
  where p.id = coalesce(p_profile_id, auth.uid())
    and (p.id = auth.uid() or public.is_admin());
$function$;

grant execute on function public.get_payment_details(uuid) to authenticated;

-- Your calendar token is the only secret in the URL that serves your gig
-- schedule, so it's self-only -- not even admin, who has no reason to
-- subscribe to someone else's calendar.
create or replace function public.get_my_calendar_token()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select calendar_token from public.profiles where id = auth.uid();
$function$;

grant execute on function public.get_my_calendar_token() to authenticated;
