-- Stage plot: one jsonb config per gig, built from an interactive
-- drag-to-place tool (StagePlot.jsx) that auto-seeds from the gig's own
-- roster/venue. Musicians get read-only access -- see the insert/update
-- policies below, which deliberately omit is_on_gig().

create table if not exists public.gig_stage_plots (
  gig_id      uuid primary key references public.gigs(id) on delete cascade,
  config      jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table public.gig_stage_plots enable row level security;

-- Same three-way access every other gig-scoped table already uses (see
-- song_requests_select in 20260827150000_song_requests.sql) -- admin,
-- the leader of the band this gig belongs to, or anyone on the roster.
create policy "gig_stage_plots_select" on public.gig_stage_plots for select
using (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
  or is_on_gig(gig_id)
);

-- No is_on_gig() here -- this is what actually makes a musician
-- read-only at the data layer, not just in the UI. Only admin or the
-- band's own leader can create/adjust a stage plot.
create policy "gig_stage_plots_insert" on public.gig_stage_plots for insert
with check (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
);

create policy "gig_stage_plots_update" on public.gig_stage_plots for update
using (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
)
with check (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
);

grant select, insert, update on public.gig_stage_plots to authenticated;

create index if not exists gig_stage_plots_gig_id_idx on public.gig_stage_plots (gig_id);

-- Optional, per-venue -- unset falls back to StagePlot's own "club"
-- preset. A venue used repeatedly only ever needs measuring once for
-- every future gig there to auto-size correctly from here on.
alter table public.venues
  add column if not exists stage_width_m numeric,
  add column if not exists stage_depth_m numeric,
  add column if not exists has_stage_riser boolean;
