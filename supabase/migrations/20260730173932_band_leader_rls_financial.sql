-- musician_claims
drop policy if exists claims_select on public.musician_claims;
create policy claims_select on public.musician_claims for select to public
using (
  profile_id = auth.uid() or is_admin()
  or exists (select 1 from gigs g where g.id = musician_claims.gig_id and is_band_leader_of(g.band_id))
);

drop policy if exists claims_update on public.musician_claims;
create policy claims_update on public.musician_claims for update to public
using (
  (profile_id = auth.uid() and status = any (array['pending','rejected']))
  or is_admin()
  or exists (select 1 from gigs g where g.id = musician_claims.gig_id and is_band_leader_of(g.band_id))
)
with check (
  (profile_id = auth.uid() and status = 'pending')
  or is_admin()
  or exists (select 1 from gigs g where g.id = musician_claims.gig_id and is_band_leader_of(g.band_id))
);

-- invoices
drop policy if exists invoices_admin_only on public.invoices;
create policy invoices_manage on public.invoices for all to public
using (
  is_admin()
  or exists (select 1 from gigs g where g.id = invoices.gig_id and is_band_leader_of(g.band_id))
)
with check (
  is_admin()
  or exists (select 1 from gigs g where g.id = invoices.gig_id and is_band_leader_of(g.band_id))
);

-- invoice_items
drop policy if exists invoice_items_admin_only on public.invoice_items;
create policy invoice_items_manage on public.invoice_items for all to public
using (
  is_admin()
  or exists (
    select 1 from invoices i join gigs g on g.id = i.gig_id
    where i.id = invoice_items.invoice_id and is_band_leader_of(g.band_id)
  )
)
with check (
  is_admin()
  or exists (
    select 1 from invoices i join gigs g on g.id = i.gig_id
    where i.id = invoice_items.invoice_id and is_band_leader_of(g.band_id)
  )
);
