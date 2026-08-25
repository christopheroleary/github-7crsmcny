-- Shared server-side cache for the "Nearby X" (food/fuel/hotel/music shop/
-- car park) feature, populated by the refresh-venue-nearby-places Edge
-- Function instead of each musician's own phone hitting the free Overpass
-- mirrors live -- those are shared, rate-limited public servers, and every
-- musician independently re-fetching the exact same venue was both the
-- cause of the timeouts and pointless duplicate work. One background fetch
-- per venue, read by everyone who's ever on a gig there.
create table public.venue_nearby_places (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  category text not null check (category in ('food', 'fuel', 'hotel', 'music_shop', 'car_park')),
  data jsonb not null,
  fetched_at timestamptz not null default now(),
  unique (venue_id, category)
);

create index venue_nearby_places_venue_idx on public.venue_nearby_places (venue_id);

alter table public.venue_nearby_places enable row level security;

-- Same OSM data anyone could look up themselves -- not sensitive, no need
-- to scope by band/gig, just requires being signed in.
create policy venue_nearby_places_select on public.venue_nearby_places
for select to authenticated
using (true);

grant select on public.venue_nearby_places to authenticated;
-- service_role has no default table privileges on a newly created table
-- (RLS bypass and table GRANTs are separate Postgres layers) -- needs this
-- explicit grant or the Edge Function's writes fail with "permission
-- denied", which is exactly what happened testing this live.
grant select, insert, update, delete on public.venue_nearby_places to service_role;
