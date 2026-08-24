-- DEFENCE IN DEPTH: close the INSERT path into profiles.
--
-- The two existing guards on this table are BEFORE UPDATE only:
--   * prevent_self_role_change      (blocks role changes)
--   * protect_subscription_fields   (reverts subscription_tier + stripe ids)
--
-- Nothing guards INSERT. Today that is probably fine, because there is no
-- INSERT policy on public.profiles in the migration history and RLS denies
-- what it does not explicitly allow -- but the row has to be created
-- somehow, which means a trigger on auth.users creates it, and that trigger
-- is NOT in this migration history (like is_admin(), is_on_gig() and the
-- original profiles_update_own policy, it predates it).
--
-- That matters because signUp() lets the *client* choose its own metadata:
--
--   supabase.auth.signUp({ email, password,
--     options: { data: { full_name: 'x', role: 'admin' } } })
--
-- lands attacker-controlled JSON in auth.users.raw_user_meta_data. If the
-- signup trigger copies role (or subscription_tier) out of that blob -- a
-- very common pattern, and the single most likely remaining route to admin
-- in this schema -- then anyone can mint themselves an admin account at
-- signup, and no amount of UPDATE-time guarding helps because the row is
-- born privileged.
--
-- This migration makes that irrelevant either way: privileged values are
-- rejected at INSERT unless the caller is already an admin or the service
-- role. It is safe for the real signup flow, which only ever sends
-- full_name (see Login.jsx -- the invite link prefills a name via query
-- params and nothing else), so this can only fire on an attempt.
--
-- It is deliberately a hard exception rather than a silent downgrade: a
-- silent coercion would need to guess this column's default, and a failed
-- privileged signup should be loud.

create or replace function public.guard_profile_insert()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  -- An admin creating an account, or the service role (webhooks, admin
  -- tooling), may set whatever they like.
  if public.is_admin() or auth.role() = 'service_role' then
    return new;
  end if;

  if new.role in ('admin', 'band_leader') then
    raise exception 'Cannot self-assign a privileged role at signup';
  end if;

  -- A new account is always free, and never arrives pre-linked to Stripe.
  -- Mirrors protect_subscription_fields, which does the same on UPDATE.
  new.subscription_tier        := 'free';
  new.stripe_customer_id       := null;
  new.stripe_subscription_id   := null;
  new.stripe_connect_account_id := null;
  new.stripe_connect_status    := null;

  return new;
end;
$$;

drop trigger if exists profiles_guard_insert on public.profiles;
create trigger profiles_guard_insert
before insert on public.profiles
for each row execute function public.guard_profile_insert();
