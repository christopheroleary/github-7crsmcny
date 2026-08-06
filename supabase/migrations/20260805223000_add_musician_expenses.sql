-- Phase 2 of MTD-readiness work: standalone musician expenses -- costs with
-- no gig attached at all (a website subscription, a mic bought at a music
-- shop, accountancy fees), as opposed to musician_claims which is money
-- claimed back from a specific gig/band.
--
-- Visibility is deliberately narrower than claims: a musician's own record
-- of their own personal business spending, plus admin (who explicitly asked
-- for visibility here rather than the initially-proposed owner-only model).
-- No band_leader clause -- unlike a claim, an expense has no band to be a
-- leader of, and this isn't band business.
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  date date not null default current_date,
  category text not null check (category in (
    'Travel / mileage', 'Accommodation', 'Equipment & consumables', 'Subsistence',
    'Parking / congestion / tolls', 'Phone, software & subscriptions',
    'Advertising & promotion', 'Accountancy & professional fees', 'Other'
  )),
  description text not null,
  amount_pence integer not null check (amount_pence > 0),
  created_at timestamptz not null default now()
);

alter table public.expenses enable row level security;

create policy "expenses_select" on public.expenses for select
using (profile_id = auth.uid() or is_admin());

create policy "expenses_insert" on public.expenses for insert
with check (profile_id = auth.uid() or is_admin());

create policy "expenses_update" on public.expenses for update
using (profile_id = auth.uid() or is_admin())
with check (profile_id = auth.uid() or is_admin());

create policy "expenses_delete" on public.expenses for delete
using (profile_id = auth.uid() or is_admin());

grant select, insert, update, delete on public.expenses to authenticated;
