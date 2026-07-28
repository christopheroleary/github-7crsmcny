alter table public.gigs
  add column dj_song_rules text,
  add column first_dance_mode text check (first_dance_mode in ('live', 'dj')),
  add column first_dance_song_id uuid references public.songs(id),
  add column roadie_stage_layout text,
  add column roadie_van_parking text,
  add column roadie_contact text;
