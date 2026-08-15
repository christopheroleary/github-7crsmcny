-- Same gap as subscription_tier before it was locked down: profiles_update_own
-- lets a user update their own row with no column restriction, so without
-- this a musician could `.update({ stripe_connect_status: 'active',
-- stripe_connect_account_id: '<anything>' })` on their own row directly,
-- skipping Stripe's real onboarding/identity verification entirely and
-- pointing payouts at an arbitrary destination. Extends the existing
-- protect_subscription_fields trigger rather than adding a second one, since
-- it's the same class of problem on the same table/trigger event.
create or replace function public.protect_subscription_fields()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    new.subscription_tier := old.subscription_tier;
    new.stripe_customer_id := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.stripe_connect_account_id := old.stripe_connect_account_id;
    new.stripe_connect_status := old.stripe_connect_status;
  end if;
  return new;
end;
$$;
