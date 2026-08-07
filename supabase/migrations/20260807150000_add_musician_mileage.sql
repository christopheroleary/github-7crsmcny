-- Standalone business mileage log, parallel to expenses/income -- for
-- journeys NOT tied to a gig (buying gear, a rehearsal, meeting a client),
-- so a musician's full simplified-expenses mileage claim isn't limited to
-- just what gig_lineup.travel_miles already captures per gig.
create table public.mileage (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  date date not null default current_date,
  miles numeric not null check (miles > 0),
  purpose text not null,
  created_at timestamptz not null default now()
);

alter table public.mileage enable row level security;

create policy "mileage_select" on public.mileage for select
using (profile_id = auth.uid() or is_admin());

create policy "mileage_insert" on public.mileage for insert
with check (profile_id = auth.uid() or is_admin());

create policy "mileage_update" on public.mileage for update
using (profile_id = auth.uid() or is_admin())
with check (profile_id = auth.uid() or is_admin());

create policy "mileage_delete" on public.mileage for delete
using (profile_id = auth.uid() or is_admin());

grant select, insert, update, delete on public.mileage to authenticated;
