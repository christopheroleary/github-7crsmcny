-- known_songs/placeholder_known_songs previously only ever needed
-- INSERT/DELETE/SELECT (toggling a song known on/off). The new
-- can_sing_lead upsert ("insert if missing, update can_sing_lead if the
-- row already exists") needs UPDATE too -- an upsert's ON CONFLICT DO
-- UPDATE branch requires both the table-level UPDATE grant and a
-- matching RLS policy, neither of which existed since nothing ever
-- updated these rows before.
grant update on public.known_songs to authenticated;
grant update on public.placeholder_known_songs to authenticated;

create policy "known_songs_update" on public.known_songs for update
using (profile_id = auth.uid() or is_admin())
with check (profile_id = auth.uid() or is_admin());

create policy "pks_update" on public.placeholder_known_songs for update
using (
  is_admin() or (is_band_leader() and exists (
    select 1 from placeholder_musicians pm
    where pm.id = placeholder_known_songs.placeholder_id
      and (pm.created_by = auth.uid() or exists (
        select 1 from band_members bm
        where bm.placeholder_id = pm.id and is_band_leader_of(bm.band_id)
      ))
  ))
)
with check (
  is_admin() or (is_band_leader() and exists (
    select 1 from placeholder_musicians pm
    where pm.id = placeholder_known_songs.placeholder_id
      and (pm.created_by = auth.uid() or exists (
        select 1 from band_members bm
        where bm.placeholder_id = pm.id and is_band_leader_of(bm.band_id)
      ))
  ))
);
