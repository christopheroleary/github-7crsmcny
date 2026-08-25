-- Validates that a receipt attached to a claim line actually belongs to the
-- person submitting the claim.
--
-- The previous version cast item->>'receipt_id' straight into the insert
-- with no ownership check, so a claim could reference any receipt id the
-- caller happened to know. RLS still stopped them READING that receipt or
-- its image, so this was never a data-disclosure hole from their side --
-- but it let one musician's claim point at another's evidence, which an
-- admin reviewing the claim would then be shown. That's an integrity
-- problem regardless of how hard the id is to guess, and the fix is cheap.
--
-- Deliberately raises rather than silently nulling the value: quietly
-- discarding an attachment the user believes they made is worse than a
-- clear failure.
create or replace function public.assert_owns_receipts(p_items jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_bad uuid;
begin
  select (item->>'receipt_id')::uuid into v_bad
  from jsonb_array_elements(p_items) as t(item)
  where nullif(item->>'receipt_id', '') is not null
    and not exists (
      select 1 from public.receipts r
      where r.id = (item->>'receipt_id')::uuid
        and r.profile_id = auth.uid()
    )
  limit 1;

  if v_bad is not null then
    raise exception 'That receipt does not belong to you';
  end if;
end;
$function$;

create or replace function public.create_musician_claim(p_gig_id uuid, p_notes text, p_items jsonb)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_claim_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or subscription_tier = 'pro')) then
    raise exception 'PRO_REQUIRED: Claims are a Pro feature. Upgrade to Pro in My Profile to submit one.';
  end if;

  perform public.assert_owns_receipts(p_items);

  insert into musician_claims (gig_id, profile_id, notes)
  values (p_gig_id, auth.uid(), p_notes)
  returning id into v_claim_id;

  insert into musician_claim_items (claim_id, category, description, amount_pence, sort_order, receipt_id)
  select v_claim_id, item->>'category', item->>'description', (item->>'amount_pence')::integer, (ord - 1)::integer,
         nullif(item->>'receipt_id', '')::uuid
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);

  return v_claim_id;
end;
$function$;

create or replace function public.update_musician_claim(p_claim_id uuid, p_notes text, p_items jsonb)
returns void
language plpgsql
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or subscription_tier = 'pro')) then
    raise exception 'PRO_REQUIRED: Claims are a Pro feature. Upgrade to Pro in My Profile to submit one.';
  end if;

  perform public.assert_owns_receipts(p_items);

  update musician_claims
  set notes = p_notes, created_at = now(), status = 'pending'
  where id = p_claim_id;

  delete from musician_claim_items where claim_id = p_claim_id;

  insert into musician_claim_items (claim_id, category, description, amount_pence, sort_order, receipt_id)
  select p_claim_id, item->>'category', item->>'description', (item->>'amount_pence')::integer, (ord - 1)::integer,
         nullif(item->>'receipt_id', '')::uuid
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);
end;
$function$;
