-- Deps never had a geocoded location, so their travel cost was never
-- calculated (only profiles were) — mirrors profiles.home_latitude/longitude
-- so TravelCalculator can also compute a dep's travel.
alter table public.placeholder_musicians add column latitude numeric;
alter table public.placeholder_musicians add column longitude numeric;

-- Owner/band-leader profit and captain bonus are distinct: the owner is
-- often not even on the gig (like an agent) and their cut is a band-level
-- pot no individual musician receives, whereas captain bonus is real pay
-- for whoever leads on the day. Restoring the separate field.
alter table public.bands add column fee_split_captain_bonus_pct numeric(5,2);
