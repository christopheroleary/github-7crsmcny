-- Reusable external vendor/supplier directory (photographer, florist, DJ,
-- caterer, etc.) -- global like venues/clients rather than gig-scoped, so
-- the same supplier tagged across multiple gigs builds a real contact
-- history instead of a fresh disconnected record every time, and so admin
-- can eventually browse the whole vendor list this naturally builds up.
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  company_name text not null,
  owner_name text,
  contact_email text,
  contact_phone text,
  social_url text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index suppliers_company_name_idx on public.suppliers (company_name);

-- Per-gig tagging: which suppliers worked a given gig, plus who the band
-- actually met on site that day -- often a different name from whoever's
-- listed as the company's usual owner/contact.
create table public.gig_suppliers (
  id uuid primary key default gen_random_uuid(),
  gig_id uuid not null references public.gigs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  person_met_on_site text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint gig_suppliers_unique_per_gig unique (gig_id, supplier_id)
);

create index gig_suppliers_gig_id_idx on public.gig_suppliers (gig_id);
create index gig_suppliers_supplier_id_idx on public.gig_suppliers (supplier_id);

alter table public.suppliers enable row level security;

create policy "suppliers_select" on public.suppliers for select
using (
  is_admin()
  or created_by = auth.uid()
  or exists (
    select 1 from public.gig_suppliers gs
    join public.gig_lineup gl on gl.gig_id = gs.gig_id
    where gs.supplier_id = suppliers.id and gl.profile_id = auth.uid()
  )
  or exists (
    select 1 from public.gig_suppliers gs
    join public.gigs g on g.id = gs.gig_id
    where gs.supplier_id = suppliers.id and is_band_leader_of(g.band_id)
  )
);

create policy "suppliers_insert" on public.suppliers for insert
with check (
  is_admin() or (is_band_leader() and created_by = auth.uid())
);

create policy "suppliers_update" on public.suppliers for update
using (
  is_admin()
  or created_by = auth.uid()
  or exists (
    select 1 from public.gig_suppliers gs
    join public.gigs g on g.id = gs.gig_id
    where gs.supplier_id = suppliers.id and is_band_leader_of(g.band_id)
  )
);

create policy "suppliers_delete" on public.suppliers for delete
using (is_admin() or created_by = auth.uid());

grant select, insert, update, delete on public.suppliers to authenticated;

alter table public.gig_suppliers enable row level security;

create policy "gig_suppliers_select" on public.gig_suppliers for select
using (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
  or is_on_gig(gig_id)
);

create policy "gig_suppliers_insert" on public.gig_suppliers for insert
with check (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
);

create policy "gig_suppliers_update" on public.gig_suppliers for update
using (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
);

create policy "gig_suppliers_delete" on public.gig_suppliers for delete
using (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
);

grant select, insert, update, delete on public.gig_suppliers to authenticated;
