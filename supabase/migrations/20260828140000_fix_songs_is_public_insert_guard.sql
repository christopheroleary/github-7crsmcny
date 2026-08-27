-- Fixes a regression from the previous migration, caught immediately by
-- re-testing after applying it: "new.is_public IS DISTINCT FROM
-- old.is_public" is meaningless on INSERT (OLD is null, and is_public is
-- NOT NULL DEFAULT false, so new.is_public is *always* "distinct from" the
-- null old row) -- it was blocking every non-admin song insert outright,
-- not just ones actually setting is_public=true. Branches on TG_OP: INSERT
-- only cares whether the row being created already claims is_public=true;
-- UPDATE keeps the original old-vs-new comparison, unchanged.
create or replace function public.prevent_non_admin_public_song_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    if new.is_public and not public.is_admin() and auth.uid() is not null then
      raise exception 'Only admins can change is_public';
    end if;
  else
    if new.is_public is distinct from old.is_public and not public.is_admin() and auth.uid() is not null then
      raise exception 'Only admins can change is_public';
    end if;
  end if;
  return new;
end;
$$;
