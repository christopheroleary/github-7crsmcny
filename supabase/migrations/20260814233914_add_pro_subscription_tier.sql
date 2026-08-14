-- Pro subscription tier: £1/month per-user upgrade. subscription_tier is the
-- single source of truth an "isPro" check reads client-side; it and the two
-- Stripe ID columns are only ever meant to be written by the subscription
-- webhook (service role) or an admin, never by a user's own client update.
alter table public.profiles add column subscription_tier text not null default 'free' check (subscription_tier in ('free', 'pro'));
alter table public.profiles add column stripe_customer_id text unique;
alter table public.profiles add column stripe_subscription_id text;

-- profiles_update_own lets a user update their own row with no column
-- restriction -- without this, a musician could just
-- `.update({ subscription_tier: 'pro' })` their own row from the browser
-- and grant themselves Pro for free. Silently reverts any client-side
-- attempt to touch these three columns unless the request is running as
-- service_role (the webhook) or an admin; other fields in the same update
-- (e.g. full_name) are unaffected.
create or replace function public.protect_subscription_fields()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    new.subscription_tier := old.subscription_tier;
    new.stripe_customer_id := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
  end if;
  return new;
end;
$$;

create trigger protect_subscription_fields_trigger
before update on public.profiles
for each row execute function public.protect_subscription_fields();

-- Free tier: 12 gigs total (lifetime) per band. Admins always bypass (same
-- as everywhere else is_admin() short-circuits RLS); a non-admin band
-- leader's band is unlocked once ANY band leader of that band is Pro, since
-- gigs belong to the band, not to one specific leader's account.
create or replace function public.enforce_gig_free_tier_cap()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  gig_count integer;
begin
  if public.is_admin() then
    return new;
  end if;

  select count(*) into gig_count from public.gigs where band_id = new.band_id;

  if gig_count >= 12 and not exists (
    select 1 from public.band_leaders bl
    join public.profiles p on p.id = bl.profile_id
    where bl.band_id = new.band_id and p.subscription_tier = 'pro'
  ) then
    raise exception 'FREE_TIER_GIG_LIMIT: This band has reached the 12-gig free limit. Upgrade to Pro to add more gigs.';
  end if;

  return new;
end;
$$;

create trigger enforce_gig_free_tier_cap_trigger
before insert on public.gigs
for each row execute function public.enforce_gig_free_tier_cap();
