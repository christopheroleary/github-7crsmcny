-- Redesign: attaching an external invoice to a claim is a leader/admin
-- action, never a musician's own. A dep or full member sends their own
-- invoice to the leader by email/WhatsApp; the leader attaches it here
-- for the band's tax/audit records and to mark the musician paid --
-- exactly the flow create_placeholder_claim/update_placeholder_claim
-- already supported for deps. This migration:
--
--  1. Drops the two 5-arg musician_claim overloads added by
--     20260904120000 (self-serve attach) -- the 3-arg originals they
--     were added alongside are untouched and remain the only way a
--     musician submits their own claim.
--  2. Generalises create_placeholder_claim/update_placeholder_claim
--     (renamed create_leader_claim/update_leader_claim, since they're
--     no longer placeholder-only) so a leader/admin can raise or edit a
--     claim -- external evidence included -- on behalf of a real roster
--     member too, not just a dep.

drop function if exists public.create_musician_claim(uuid, text, jsonb, text, text);
drop function if exists public.update_musician_claim(uuid, text, jsonb, text, text);

create or replace function public.create_leader_claim(
  p_gig_id uuid,
  p_placeholder_id uuid default null,
  p_profile_id uuid default null,
  p_notes text default null,
  p_items jsonb default '[]'::jsonb,
  p_external_link text default null,
  p_attachment_path text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_band_id uuid;
  v_claim_id uuid;
begin
  if (p_placeholder_id is null) = (p_profile_id is null) then
    raise exception 'Specify exactly one of p_placeholder_id or p_profile_id';
  end if;

  select band_id into v_band_id from public.gigs where id = p_gig_id;
  if v_band_id is null or not ((select public.is_admin()) or public.is_band_leader_of(v_band_id)) then
    raise exception 'Not authorised to raise a claim on this gig';
  end if;

  if not exists (select 1 from public.profiles where id = (select auth.uid()) and (role = 'admin' or subscription_tier = 'pro')) then
    raise exception 'PRO_REQUIRED: Claims are a Pro feature. Upgrade to Pro in My Profile to raise one.';
  end if;

  if p_placeholder_id is not null then
    if not exists (select 1 from public.gig_lineup where gig_id = p_gig_id and placeholder_id = p_placeholder_id) then
      raise exception 'That dep is not on this gig''s roster';
    end if;
  else
    if not exists (select 1 from public.gig_lineup where gig_id = p_gig_id and profile_id = p_profile_id) then
      raise exception 'That musician is not on this gig''s roster';
    end if;
    if exists (select 1 from public.musician_claims where gig_id = p_gig_id and profile_id = p_profile_id) then
      raise exception 'This musician already has a claim for this gig -- edit it instead';
    end if;
  end if;

  insert into public.musician_claims (gig_id, placeholder_id, profile_id, notes, external_link, attachment_path)
  values (p_gig_id, p_placeholder_id, p_profile_id, p_notes, p_external_link, p_attachment_path)
  returning id into v_claim_id;

  insert into public.musician_claim_items (claim_id, category, description, amount_pence, sort_order)
  select v_claim_id, item->>'category', item->>'description', (item->>'amount_pence')::integer, (ord - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);

  return v_claim_id;
end;
$function$;

create or replace function public.update_leader_claim(
  p_claim_id uuid,
  p_notes text,
  p_items jsonb,
  p_external_link text default null,
  p_attachment_path text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_band_id uuid;
begin
  select g.band_id into v_band_id
  from public.musician_claims c join public.gigs g on g.id = c.gig_id
  where c.id = p_claim_id;

  if v_band_id is null or not ((select public.is_admin()) or public.is_band_leader_of(v_band_id)) then
    raise exception 'Not authorised to edit this claim';
  end if;
  if not exists (select 1 from public.profiles where id = (select auth.uid()) and (role = 'admin' or subscription_tier = 'pro')) then
    raise exception 'PRO_REQUIRED: Claims are a Pro feature. Upgrade to Pro in My Profile to edit one.';
  end if;

  update public.musician_claims
  set notes = p_notes, external_link = p_external_link, attachment_path = p_attachment_path,
      created_at = now(), status = 'pending'
  where id = p_claim_id;

  delete from public.musician_claim_items where claim_id = p_claim_id;

  insert into public.musician_claim_items (claim_id, category, description, amount_pence, sort_order)
  select p_claim_id, item->>'category', item->>'description', (item->>'amount_pence')::integer, (ord - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);
end;
$function$;

drop function if exists public.create_placeholder_claim(uuid, uuid, text, jsonb, text, text);
drop function if exists public.update_placeholder_claim(uuid, text, jsonb, text, text);
