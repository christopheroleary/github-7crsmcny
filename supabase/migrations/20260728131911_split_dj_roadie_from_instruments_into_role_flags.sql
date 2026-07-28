-- DJ and Roadie were modeled as fake "instruments", which meant a person
-- could only ever hold ONE of {a real instrument, DJ, Roadie} per gig — the
-- gig_lineup unique constraint is (gig_id, profile_id), so adding someone as
-- both DJ and Roadie (or DJ alongside their actual instrument) was blocked.
-- They become boolean role flags on the single gig_lineup row instead, so
-- they can be freely combined with each other and with a real instrument.

alter table public.gig_lineup add column is_dj boolean not null default false;
alter table public.gig_lineup add column is_roadie boolean not null default false;

alter table public.gigs add column needs_dj boolean not null default false;
alter table public.gigs add column needs_roadie boolean not null default false;

-- Migrate existing gig_requirements rows (DJ/Roadie needed) into the new gig flags.
update public.gigs g set needs_dj = true
where exists (
  select 1 from public.gig_requirements gr
  join public.instruments i on i.id = gr.instrument_id
  where gr.gig_id = g.id and i.name = 'DJ'
);
update public.gigs g set needs_roadie = true
where exists (
  select 1 from public.gig_requirements gr
  join public.instruments i on i.id = gr.instrument_id
  where gr.gig_id = g.id and i.name = 'Roadie'
);

-- Migrate existing gig_lineup rows booked as DJ/Roadie "instrument" into the flags.
update public.gig_lineup set is_dj = true, instrument_id = null
where instrument_id = (select id from public.instruments where name = 'DJ');
update public.gig_lineup set is_roadie = true, instrument_id = null
where instrument_id = (select id from public.instruments where name = 'Roadie');

-- Clean up now-obsolete references to the DJ/Roadie pseudo-instruments.
delete from public.gig_requirements gr
using public.instruments i
where gr.instrument_id = i.id and i.name in ('DJ', 'Roadie');

delete from public.placeholder_musician_instruments pmi
using public.instruments i
where pmi.instrument_id = i.id and i.name in ('DJ', 'Roadie');

delete from public.profile_instruments pi
using public.instruments i
where pi.instrument_id = i.id and i.name in ('DJ', 'Roadie');

delete from public.band_members bm
using public.instruments i
where bm.instrument_id = i.id and i.name in ('DJ', 'Roadie');

delete from public.instruments where name in ('DJ', 'Roadie');
