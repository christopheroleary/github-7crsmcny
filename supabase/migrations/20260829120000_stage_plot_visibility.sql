-- Musicians see the stage plot only once an admin/leader has actually
-- checked it over -- it's automated from the roster but not always right
-- on the first pass, and it isn't polished enough yet to show by default.
-- Defaults false so every existing and future gig starts hidden from the
-- band until someone explicitly flips it on.
alter table public.gig_stage_plots
  add column if not exists visible_to_band boolean not null default false;
