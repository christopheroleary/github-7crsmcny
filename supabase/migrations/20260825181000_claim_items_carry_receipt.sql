-- Lets a claim line item carry the receipt that evidences it.
--
-- update_musician_claim deletes and re-inserts every item on each save, so
-- without threading receipt_id through the jsonb payload here, editing a
-- claim would silently detach every receipt already attached to it -- the
-- rows would come back with receipt_id null and the images would drop back
-- into the unfiled pile with no indication anything had happened.
--
-- nullif(...)::uuid rather than a plain cast so a client that doesn't send
-- receipt_id at all (or sends an empty string) still works unchanged.
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
