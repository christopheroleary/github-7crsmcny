-- Per-band fee-split template: each role's cut as a % of the total gig fee,
-- so a bigger gig scales everyone's pay proportionally. Nullable — a band
-- with none of these set just doesn't get an auto-suggested split.
alter table public.bands add column fee_split_musician_base_pct numeric(5,2);
alter table public.bands add column fee_split_singer_bonus_pct numeric(5,2);
alter table public.bands add column fee_split_captain_bonus_pct numeric(5,2);
alter table public.bands add column fee_split_dj_pct numeric(5,2);
alter table public.bands add column fee_split_roadie_pct numeric(5,2);

-- Pre-roster budgeting inputs — lets the admin project profit/loss before
-- anyone is actually booked. needs_dj/needs_roadie (added earlier this
-- session) double as the planned DJ/roadie flags here.
alter table public.gigs add column planned_headcount integer;
alter table public.gigs add column planned_has_captain boolean not null default false;
alter table public.gigs add column planned_has_singer boolean not null default false;
alter table public.gigs add column estimated_travel_pence integer;

-- The actual, applied fee for this person once calculated — stored (not
-- live-recomputed) so a quoted fee doesn't silently shift if the roster
-- changes later. This is what the musician sees.
alter table public.gig_lineup add column fee_pence integer;
