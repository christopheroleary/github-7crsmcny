-- The previous migration revoked from `anon` directly, but anon never
-- held its own grant -- Postgres grants EXECUTE to PUBLIC by default on
-- function creation, and anon inherits through that, so revoking from
-- anon specifically was a no-op (confirmed still showing in the security
-- advisor after that migration). Revoking from PUBLIC is what actually
-- removes it for anon (and any other role) while authenticated keeps its
-- own explicit grant from the original migration.
revoke execute on function public.get_song_duplicate_groups() from public;
revoke execute on function public.merge_duplicate_songs(uuid, uuid) from public;
