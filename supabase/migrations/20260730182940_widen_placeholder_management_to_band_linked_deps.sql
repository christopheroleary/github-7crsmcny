-- Band leaders can now rename/edit-details/manage-instruments for any dep
-- linked to a band they lead (not just ones they personally created) — this
-- covers deps an admin originally created that later ended up on their
-- band's roster. Permanent delete of the placeholder record itself stays
-- restricted to the creator (or admin) — removing a dep from just their own
-- band's roster is a separate, already-available action via band_members.
drop policy if exists placeholder_update_admin on public.placeholder_musicians;
create policy placeholder_update_admin on public.placeholder_musicians for update to public
using (
  is_admin()
  or (is_band_leader() and (
    created_by = auth.uid()
    or exists (select 1 from band_members bm where bm.placeholder_id = placeholder_musicians.id and is_band_leader_of(bm.band_id))
  ))
);

drop policy if exists ph_instr_write on public.placeholder_musician_instruments;
create policy ph_instr_write on public.placeholder_musician_instruments for insert to public
with check (
  is_admin()
  or (is_band_leader() and exists (
    select 1 from placeholder_musicians pm
    where pm.id = placeholder_musician_instruments.placeholder_id
    and (
      pm.created_by = auth.uid()
      or exists (select 1 from band_members bm where bm.placeholder_id = pm.id and is_band_leader_of(bm.band_id))
    )
  ))
);

drop policy if exists ph_instr_delete on public.placeholder_musician_instruments;
create policy ph_instr_delete on public.placeholder_musician_instruments for delete to public
using (
  is_admin()
  or (is_band_leader() and exists (
    select 1 from placeholder_musicians pm
    where pm.id = placeholder_musician_instruments.placeholder_id
    and (
      pm.created_by = auth.uid()
      or exists (select 1 from band_members bm where bm.placeholder_id = pm.id and is_band_leader_of(bm.band_id))
    )
  ))
);
