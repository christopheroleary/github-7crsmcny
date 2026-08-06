-- Phase 4 of MTD-readiness work: non-gig income. Until now money could only
-- flow in via a gig claim -- selling an old amp, a one-off session outside
-- the band, teaching, royalties, all had nowhere to go. Mirrors expenses.sql
-- exactly (same shape, same visibility rules, same reasoning for why admin
-- can see it).
create table public.income (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  date date not null default current_date,
  category text not null check (category in (
    'Sale of equipment/asset', 'Teaching / tuition', 'Session work (other)',
    'Royalties', 'Other income'
  )),
  description text not null,
  amount_pence integer not null check (amount_pence > 0),
  created_at timestamptz not null default now()
);

alter table public.income enable row level security;

create policy "income_select" on public.income for select
using (profile_id = auth.uid() or is_admin());

create policy "income_insert" on public.income for insert
with check (profile_id = auth.uid() or is_admin());

create policy "income_update" on public.income for update
using (profile_id = auth.uid() or is_admin())
with check (profile_id = auth.uid() or is_admin());

create policy "income_delete" on public.income for delete
using (profile_id = auth.uid() or is_admin());

grant select, insert, update, delete on public.income to authenticated;
