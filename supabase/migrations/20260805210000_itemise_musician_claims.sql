-- Phase 1 of MTD-readiness work: itemised musician claims. A claim used to
-- be one row with a single amount_pence + free-text description, forcing a
-- fee + travel + any incidental costs into one lump sum with no way to tell
-- them apart later (they're different tax categories for the musician's own
-- records). This adds a line-items table, mirroring invoice_items, so a
-- claim becomes a header (gig, profile, status) + N categorised lines.

create table public.musician_claim_items (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.musician_claims(id) on delete cascade,
  category text not null check (category in (
    'Fee', 'Travel / mileage', 'Accommodation', 'Equipment & consumables',
    'Subsistence', 'Parking / congestion / tolls', 'Other'
  )),
  description text not null,
  amount_pence integer not null check (amount_pence > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.musician_claim_items enable row level security;

-- Same visibility as the parent claim (musician_claims.claims_select): the
-- claim's own musician, any admin, or a leader of the gig's band.
create policy "claim_items_select" on public.musician_claim_items for select
using (
  is_admin()
  or exists (select 1 from public.musician_claims c where c.id = claim_id and c.profile_id = auth.uid())
  or exists (
    select 1 from public.musician_claims c
    join public.gigs g on g.id = c.gig_id
    where c.id = claim_id and is_band_leader_of(g.band_id)
  )
);

-- Writes are scoped tighter than reads: only the claim's own musician, and
-- only while the claim is still editable (pending or a rejected claim being
-- amended) -- once approved/paid the line items are locked, same as the
-- header's own claims_update policy already enforces. Admin can always
-- correct records.
create policy "claim_items_insert" on public.musician_claim_items for insert
with check (
  is_admin()
  or exists (
    select 1 from public.musician_claims c
    where c.id = claim_id and c.profile_id = auth.uid() and c.status in ('pending', 'rejected')
  )
);

create policy "claim_items_update" on public.musician_claim_items for update
using (
  is_admin()
  or exists (
    select 1 from public.musician_claims c
    where c.id = claim_id and c.profile_id = auth.uid() and c.status in ('pending', 'rejected')
  )
)
with check (
  is_admin()
  or exists (
    select 1 from public.musician_claims c
    where c.id = claim_id and c.profile_id = auth.uid() and c.status in ('pending', 'rejected')
  )
);

create policy "claim_items_delete" on public.musician_claim_items for delete
using (
  is_admin()
  or exists (
    select 1 from public.musician_claims c
    where c.id = claim_id and c.profile_id = auth.uid() and c.status in ('pending', 'rejected')
  )
);

grant select, insert, update, delete on public.musician_claim_items to authenticated;
-- Granted up front, not discovered the hard way later: notify-admin/notify-
-- musician (service_role clients) need to read this table to build claim
-- notifications now that amount/description live here instead of on the
-- header. See the placeholder_musicians and notifications grant-fix
-- migrations earlier this session for exactly what happens when this is
-- missed -- service_role SELECT denied, error unchecked, notification
-- silently shows wrong/blank data.
grant select on public.musician_claim_items to service_role;

-- Migrate every existing claim's single amount/description into one item
-- row. Tagged 'Fee' since every historic claim predates itemisation and was
-- submitted as a lump performance-fee-style total.
insert into public.musician_claim_items (claim_id, category, description, amount_pence, sort_order)
select id, 'Fee', description, amount_pence, 0
from public.musician_claims;

-- Now that every row has been migrated, the header no longer needs these --
-- amount/description live on items going forward.
alter table public.musician_claims drop column amount_pence;
alter table public.musician_claims drop column description;
