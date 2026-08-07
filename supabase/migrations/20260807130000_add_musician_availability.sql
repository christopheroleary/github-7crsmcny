-- Admin-side "dep wizard" feature: find the best-suited musician/placeholder
-- for an open gig slot by instrument, distance and availability. This adds
-- the availability half -- a musician needs to be able to set which days
-- they're generally free (and occasional exceptions) in seconds, or they
-- simply won't bother.
--
-- Model: a weekly default pattern (7 booleans directly on profiles, mirroring
-- how home_address/home_latitude already live there rather than a separate
-- 1:1 table) plus a short list of specific blackout dates for one-off
-- exceptions (holidays etc.) that override the weekly default for that day.
-- Deliberately no "available on a date the weekly pattern says no" case --
-- not requested, and would double the UI for an edge case.

alter table public.profiles
  add column avail_sun boolean not null default true,
  add column avail_mon boolean not null default true,
  add column avail_tue boolean not null default true,
  add column avail_wed boolean not null default true,
  add column avail_thu boolean not null default true,
  add column avail_fri boolean not null default true,
  add column avail_sat boolean not null default true;

create table public.musician_unavailable_dates (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  note text,
  created_at timestamptz not null default now(),
  unique (profile_id, date)
);

alter table public.musician_unavailable_dates enable row level security;

create policy "musician_unavailable_dates_select" on public.musician_unavailable_dates for select
using (profile_id = auth.uid() or is_admin());

create policy "musician_unavailable_dates_insert" on public.musician_unavailable_dates for insert
with check (profile_id = auth.uid() or is_admin());

create policy "musician_unavailable_dates_delete" on public.musician_unavailable_dates for delete
using (profile_id = auth.uid() or is_admin());

grant select, insert, delete on public.musician_unavailable_dates to authenticated;
