-- Lets an already-registered musician join a band without the leader ever
-- needing to find them in `profiles` first -- see can_view_profile()
-- (20260818220000): a leader can only see rows for people already tied to
-- one of their bands or gigs, or who've opted into the dep pool, so a
-- genuine stranger with their own account is invisible to "Choose
-- musician"/BandMembers' add form no matter how obviously right a fit they
-- are. This closes that gap with a leader-initiated, single-use invite
-- link the leader sends out of band (however they'd normally reach that
-- person) -- never a lookup, never a bulk/blast mechanism, and never a
-- reason to loosen profiles visibility.
--
-- Deliberately NOT a reusable per-band code: one token per intended
-- recipient, so an abusive leader has to generate (and therefore leave a
-- record of) one invite per target rather than blasting a single link
-- anywhere. Capped further below at 20 new invites per band per rolling
-- 24h as a cheap extra backstop.
--
-- Note on scope: becoming a band leader at all already requires an admin
-- to set profiles.role='band_leader' -- guard_profile_insert
-- (20260818250000) and prevent_self_role_change block self-promotion
-- outright, so this feature can only ever be wielded by leaders already
-- vetted by an admin, not by anyone who simply signs up.
--
-- Note on blast radius if misused anyway: accepting only ever grants the
-- SAME visibility can_view_profile() already grants through the dep pool
-- or a shared gig (full_name, phone, home_address/lat/lon, equipment) --
-- never bank_name/bank_account_name/bank_sort_code/bank_account_number,
-- which are revoked from `authenticated` at the column-grant level
-- (restrict_sensitive_profile_columns, 20260826130000) and reachable only
-- via get_payment_details(), gated to the row owner or an admin regardless
-- of band/gig membership. This feature has no path to that data.

create table public.band_join_invites (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references public.bands(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  recipient_label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  used_at timestamptz,
  used_by uuid references public.profiles(id)
);

alter table public.band_join_invites enable row level security;

create index band_join_invites_band_id_idx on public.band_join_invites(band_id);

-- Leaders/admins only, for their own band, attributed to themselves (an
-- admin may set created_by to someone else when acting on a leader's
-- behalf) -- rate-limited so a compromised or malicious leader account
-- can't mint an unbounded number of invites in one sitting.
create policy band_join_invites_insert on public.band_join_invites
for insert to public
with check (
  (created_by = auth.uid() or (select is_admin()))
  and ((select is_admin()) or is_band_leader_of(band_id))
  and (
    select count(*) from public.band_join_invites existing
    where existing.band_id = band_id
      and existing.created_at > now() - interval '24 hours'
  ) < 20
);

create policy band_join_invites_select on public.band_join_invites
for select to public
using ((select is_admin()) or is_band_leader_of(band_id));

create policy band_join_invites_delete on public.band_join_invites
for delete to public
using ((select is_admin()) or is_band_leader_of(band_id));

-- Narrow, deliberately minimal preview for the invite landing screen --
-- enough for the invitee to recognise who's asking and decide whether to
-- accept, without needing a SELECT grant on the invites table itself
-- (which would either have to be public, or require the same
-- is_band_leader_of() the invitee by definition doesn't have).
create or replace function public.get_band_invite_preview(p_token uuid)
returns table (band_name text, invited_by text, status text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    b.name,
    p.full_name,
    case
      when i.used_at is not null then 'used'
      when i.expires_at < now() then 'expired'
      else 'valid'
    end
  from public.band_join_invites i
  join public.bands b on b.id = i.band_id
  join public.profiles p on p.id = i.created_by
  where i.id = p_token;
$$;

grant execute on function public.get_band_invite_preview(uuid) to authenticated;

-- Accept: the only way a band_join_invites row ever turns into a
-- band_members row. Runs as the invitee, for the invitee only --
-- profile_id is always auth.uid(), never a parameter, so this can't be
-- used to add anyone else. Row-locks the invite first so two concurrent
-- accepts of the same token can't both succeed.
create or replace function public.accept_band_invite(p_token uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_band_id uuid;
  v_expires_at timestamptz;
  v_used_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in to accept this invite';
  end if;

  select band_id, expires_at, used_at into v_band_id, v_expires_at, v_used_at
  from public.band_join_invites
  where id = p_token
  for update;

  if v_band_id is null then
    raise exception 'This invite link is not valid';
  end if;
  if v_used_at is not null then
    raise exception 'This invite has already been used';
  end if;
  if v_expires_at < now() then
    raise exception 'This invite has expired';
  end if;

  if exists (
    select 1 from public.band_members
    where band_id = v_band_id and profile_id = auth.uid()
  ) then
    -- Already a member (e.g. added directly since this invite went out) --
    -- still consume the token so it can't be reused, but don't duplicate
    -- the row.
    update public.band_join_invites set used_at = now(), used_by = auth.uid() where id = p_token;
    return;
  end if;

  insert into public.band_members (band_id, profile_id, instrument_id, placeholder_id)
  values (v_band_id, auth.uid(), null, null);

  update public.band_join_invites set used_at = now(), used_by = auth.uid() where id = p_token;
end;
$$;

grant execute on function public.accept_band_invite(uuid) to authenticated;
