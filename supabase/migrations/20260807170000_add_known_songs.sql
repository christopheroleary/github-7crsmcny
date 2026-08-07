-- Lets musicians/deps pre-tick which songs (from the shared public
-- repertoire) they know, so the admin-only dep-finder wizard can rank/show
-- candidates by setlist overlap for a gig, not just instrument/distance/
-- availability.

-- Real musicians self-report against their own profile.
create table public.known_songs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (profile_id, song_id)
);

alter table public.known_songs enable row level security;

create policy "known_songs_select" on public.known_songs for select
using (profile_id = auth.uid() or is_admin());

create policy "known_songs_insert" on public.known_songs for insert
with check (profile_id = auth.uid() or is_admin());

create policy "known_songs_delete" on public.known_songs for delete
using (profile_id = auth.uid() or is_admin());

grant select, insert, delete on public.known_songs to authenticated;

-- Placeholder deps have no login and can't self-report, so this is
-- entered on their behalf -- exact same permission shape already used
-- for placeholder_musician_instruments (admin, or whichever band leader
-- manages that dep).
create table public.placeholder_known_songs (
  id uuid primary key default gen_random_uuid(),
  placeholder_id uuid not null references public.placeholder_musicians(id) on delete cascade,
  song_id uuid not null references public.songs(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (placeholder_id, song_id)
);

alter table public.placeholder_known_songs enable row level security;

create policy "pks_read" on public.placeholder_known_songs for select to public
using (((auth.role() = 'authenticated') and not is_band_leader()) or is_admin() or (is_band_leader() and can_view_placeholder(placeholder_id)));

create policy "pks_write" on public.placeholder_known_songs for insert to public
with check (
  is_admin()
  or (is_band_leader() and exists (
    select 1 from placeholder_musicians pm
    where pm.id = placeholder_known_songs.placeholder_id
    and (
      pm.created_by = auth.uid()
      or exists (select 1 from band_members bm where bm.placeholder_id = pm.id and is_band_leader_of(bm.band_id))
    )
  ))
);

create policy "pks_delete" on public.placeholder_known_songs for delete to public
using (
  is_admin()
  or (is_band_leader() and exists (
    select 1 from placeholder_musicians pm
    where pm.id = placeholder_known_songs.placeholder_id
    and (
      pm.created_by = auth.uid()
      or exists (select 1 from band_members bm where bm.placeholder_id = pm.id and is_band_leader_of(bm.band_id))
    )
  ))
);

grant select, insert, delete on public.placeholder_known_songs to authenticated;
