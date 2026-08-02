-- Free-text fields for gig-day operational details, visible to admins,
-- band leaders, and performing musicians alike (no new RLS needed --
-- existing gigs select/update policies already cover these columns).
alter table public.gigs add column sets_info text;
alter table public.gigs add column dress_code text;
alter table public.gigs add column venue_wifi text;
