-- Lets admins/leaders record a venue's website once they've found it (e.g.
-- via the new "Find on Google Maps" lookup link on the venue form) --
-- OpenStreetMap/Photon don't reliably carry this for the kind of small,
-- often-private venues this app deals with, so it's captured manually.
alter table public.venues add column website text;
