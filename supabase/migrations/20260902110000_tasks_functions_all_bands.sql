-- p_band_id is now optional (default null = every band the caller is
-- allowed to see). Fixes TasksWidget on the Dashboard showing nothing for
-- a real admin who doesn't personally lead any band -- the rest of
-- Dashboard.jsx already treats admin as "no band filter, company-wide"
-- (bandFilterIds = null), this makes the tasks functions match that
-- instead of requiring a specific ledBandIds loop. The auth check moves
-- from a single param-level check to per-row, since "no filter" now has to
-- mean "every row I'm allowed to see", not "every row, full stop". Also
-- adds band_id/band_name to every function's output -- needed now that one
-- call can span multiple bands, so each row can label itself.
--
-- Return type changed, so each function has to be dropped before it can be
-- recreated (Postgres can REPLACE a function's body but not its declared
-- output columns).
drop function if exists public.get_needs_invoicing_tasks(uuid);
drop function if exists public.get_client_anniversary_tasks(uuid);
drop function if exists public.get_uninvited_dep_tasks(uuid);

create function public.get_needs_invoicing_tasks(p_band_id uuid default null)
returns table (band_id uuid, band_name text, gig_id uuid, gig_date date, venue_name text)
language sql stable security definer set search_path to 'public' as $$
  select g.band_id, b.name, g.id, g.gig_date, v.name
  from public.gigs g
  join public.bands b on b.id = g.band_id
  left join public.venues v on v.id = g.venue_id
  where (p_band_id is null or g.band_id = p_band_id)
    and g.status <> 'cancelled'
    and g.gig_date < current_date
    and ((select public.is_admin()) or public.is_band_leader_of(g.band_id))
    and not exists (
      select 1 from public.invoices i where i.gig_id = g.id and i.status in ('sent', 'paid')
    );
$$;

create function public.get_client_anniversary_tasks(p_band_id uuid default null)
returns table (band_id uuid, band_name text, client_id uuid, client_name text, last_gig_id uuid, last_gig_date date)
language sql stable security definer set search_path to 'public' as $$
  select distinct on (g.client_id) g.band_id, b.name, g.client_id, c.name, g.id, g.gig_date
  from public.gigs g
  join public.bands b on b.id = g.band_id
  join public.clients c on c.id = g.client_id
  where (p_band_id is null or g.band_id = p_band_id)
    and g.client_id is not null
    and g.status <> 'cancelled'
    and ((select public.is_admin()) or public.is_band_leader_of(g.band_id))
    and g.gig_date between (current_date - interval '380 days')::date and (current_date - interval '350 days')::date
    and not exists (
      select 1 from public.gigs g2
      where g2.client_id = g.client_id and g2.gig_date > g.gig_date and g2.status <> 'cancelled'
    )
  order by g.client_id, g.gig_date desc;
$$;

create function public.get_uninvited_dep_tasks(p_band_id uuid default null)
returns table (band_id uuid, band_name text, placeholder_id uuid, dep_name text)
language sql stable security definer set search_path to 'public' as $$
  select distinct bm.band_id, b.name, pm.id, pm.name
  from public.band_members bm
  join public.bands b on b.id = bm.band_id
  join public.placeholder_musicians pm on pm.id = bm.placeholder_id
  where (p_band_id is null or bm.band_id = p_band_id)
    and pm.invite_sent_at is null
    and pm.merged_into is null
    and ((select public.is_admin()) or public.is_band_leader_of(bm.band_id));
$$;

revoke execute on function public.get_needs_invoicing_tasks(uuid) from public;
revoke execute on function public.get_client_anniversary_tasks(uuid) from public;
revoke execute on function public.get_uninvited_dep_tasks(uuid) from public;
grant execute on function public.get_needs_invoicing_tasks(uuid) to authenticated;
grant execute on function public.get_client_anniversary_tasks(uuid) to authenticated;
grant execute on function public.get_uninvited_dep_tasks(uuid) to authenticated;
