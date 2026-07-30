create or replace function public.prevent_self_role_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.role is distinct from old.role
     and not public.is_admin()
     and auth.uid() is not null then
    raise exception 'Only admins can change role';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;

create trigger profiles_guard_role
before update on public.profiles
for each row
execute function public.prevent_self_role_change();
