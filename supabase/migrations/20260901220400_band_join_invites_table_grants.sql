-- RLS policies only take effect on top of an underlying SQL privilege --
-- they restrict, they don't grant. band_join_invites never got the base
-- table-level GRANT authenticated needs to even attempt an insert/select/
-- delete (confirmed live: "permission denied for table band_join_invites"
-- before this, compared against band_members' grants via
-- information_schema.role_table_grants, which has exactly this set).
-- No UPDATE grant -- the only write to used_at/used_by goes through
-- accept_band_invite(), which is SECURITY DEFINER and bypasses this
-- entirely, same as band_members' own grant list has no UPDATE either.
grant select, insert, delete on public.band_join_invites to authenticated;
