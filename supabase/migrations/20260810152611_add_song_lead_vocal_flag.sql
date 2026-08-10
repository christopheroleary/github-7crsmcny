-- Distinguishes "knows the song well enough to play it" from "could also
-- front it as lead vocal" -- a musician/dep's own repertoire checklist
-- ticks one or both per song. Singing lead implies knowing the song, so
-- can_sing_lead is only ever true alongside a known_songs/
-- placeholder_known_songs row existing at all.
alter table known_songs add column can_sing_lead boolean not null default false;
alter table placeholder_known_songs add column can_sing_lead boolean not null default false;
