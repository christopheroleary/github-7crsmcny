-- band_leaders table (band <-> leader, many-to-many)
create table public.band_leaders (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references public.bands(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (band_id, profile_id)
);

alter table public.band_leaders enable row level security;

create policy band_leaders_select on public.band_leaders
for select to public
using (is_admin() or profile_id = auth.uid());

create policy band_leaders_insert_admin on public.band_leaders
for insert to public
with check (is_admin());

create policy band_leaders_update_admin on public.band_leaders
for update to public
using (is_admin());

create policy band_leaders_delete_admin on public.band_leaders
for delete to public
using (is_admin());

-- ownership / visibility columns
alter table public.venues add column created_by uuid references public.profiles(id);
alter table public.clients add column created_by uuid references public.profiles(id);
alter table public.songs add column created_by uuid references public.profiles(id);
alter table public.songs add column is_public boolean not null default false;
alter table public.placeholder_musicians add column created_by uuid references public.profiles(id);
alter table public.profiles add column available_for_dep_work boolean not null default false;

-- role helper functions
create or replace function public.is_band_leader()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'band_leader');
$$;

create or replace function public.is_band_leader_of(p_band_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.band_leaders where band_id = p_band_id and profile_id = auth.uid());
$$;

create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    p_profile_id = auth.uid()
    or exists (select 1 from public.profiles where id = p_profile_id and available_for_dep_work = true)
    or exists (
      select 1 from public.band_members bm
      where bm.profile_id = p_profile_id and public.is_band_leader_of(bm.band_id)
    )
    or exists (
      select 1 from public.gig_lineup gl
      join public.gigs g on g.id = gl.gig_id
      where gl.profile_id = p_profile_id and public.is_band_leader_of(g.band_id)
    );
$$;

create or replace function public.can_view_placeholder(p_placeholder_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    exists (select 1 from public.placeholder_musicians where id = p_placeholder_id and created_by = auth.uid())
    or exists (
      select 1 from public.band_members bm
      where bm.placeholder_id = p_placeholder_id and public.is_band_leader_of(bm.band_id)
    )
    or exists (
      select 1 from public.gig_lineup gl
      join public.gigs g on g.id = gl.gig_id
      where gl.placeholder_id = p_placeholder_id and public.is_band_leader_of(g.band_id)
    );
$$;

-- auto-assign leadership when a band leader creates their own band
create or replace function public.assign_band_leader_on_create()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() and public.is_band_leader() then
    insert into public.band_leaders (band_id, profile_id, added_by)
    values (new.id, auth.uid(), null)
    on conflict (band_id, profile_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger bands_auto_assign_leader
after insert on public.bands
for each row execute function public.assign_band_leader_on_create();

-- guard songs.is_public: only admin can toggle it
create or replace function public.prevent_non_admin_public_song_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.is_public is distinct from old.is_public and not public.is_admin() and auth.uid() is not null then
    raise exception 'Only admins can change is_public';
  end if;
  return new;
end;
$$;

create trigger songs_guard_is_public
before update on public.songs
for each row execute function public.prevent_non_admin_public_song_change();
