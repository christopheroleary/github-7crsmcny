-- Both functions already guard with is_admin() internally, but the
-- default grant left them callable by anon too (PostgREST's default),
-- same gap already closed for revoke_get_band_payment_details_public_execute
-- and revoke_protect_band_connect_fields_public_execute -- an anonymous
-- caller couldn't get anything out of these anyway (is_admin() is false
-- for them), but there's no reason to leave the RPC endpoint reachable.
revoke execute on function public.get_song_duplicate_groups() from anon;
revoke execute on function public.merge_duplicate_songs(uuid, uuid) from anon;
