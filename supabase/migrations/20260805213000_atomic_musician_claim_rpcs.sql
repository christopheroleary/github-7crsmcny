-- Fixes a real race condition found while verifying the itemised-claims
-- work: the frontend used to insert the musician_claims header row, then
-- insert its musician_claim_items in a *separate* follow-up request. The
-- notify-admin/notify-musician webhooks fire the instant the header row
-- commits -- before that second request even reaches the database -- so a
-- claim notification could (and, reproduced live, did) show "£0.00" because
-- claimSummary()/claimTotalLabel() queried musician_claim_items before any
-- rows existed yet.
--
-- Fix: do the header insert/update and its items in a single Postgres
-- function call (one transaction) so that by the time the async webhook
-- fires post-commit, both the header and its items are already visible.
-- SECURITY INVOKER (the default, stated explicitly) -- these still run as
-- the calling user, so the existing claims_insert_own / claim_items_*
-- RLS policies apply exactly as before; nothing is bypassed.

create or replace function public.create_musician_claim(p_gig_id uuid, p_notes text, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claim_id uuid;
begin
  insert into musician_claims (gig_id, profile_id, notes)
  values (p_gig_id, auth.uid(), p_notes)
  returning id into v_claim_id;

  insert into musician_claim_items (claim_id, category, description, amount_pence, sort_order)
  select v_claim_id, item->>'category', item->>'description', (item->>'amount_pence')::integer, (ord - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);

  return v_claim_id;
end;
$$;

create or replace function public.update_musician_claim(p_claim_id uuid, p_notes text, p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Resubmitting a rejected claim puts it back in the admin's queue.
  update musician_claims
  set notes = p_notes, created_at = now(), status = 'pending'
  where id = p_claim_id;

  delete from musician_claim_items where claim_id = p_claim_id;

  insert into musician_claim_items (claim_id, category, description, amount_pence, sort_order)
  select p_claim_id, item->>'category', item->>'description', (item->>'amount_pence')::integer, (ord - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as t(item, ord);
end;
$$;

grant execute on function public.create_musician_claim(uuid, text, jsonb) to authenticated;
grant execute on function public.update_musician_claim(uuid, text, jsonb) to authenticated;
