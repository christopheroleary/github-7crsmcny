-- Freestanding task manager -- the "easy win" competitor feature (Giggio,
-- BandPencil both have one), but designed to differ from theirs in the one
-- way that actually matters: most of what shows up here is DERIVED from
-- data Seeau already has, not something someone has to remember to type in.
-- Manual tasks (this table) exist for the genuinely freestanding stuff
-- (Giggio's own example: "renew PLI insurance", "chase the agent for last
-- month's commission") that has no natural home elsewhere. The three
-- derived-task functions below cover the rest by querying gigs/invoices/
-- band_members directly, live, every time -- never materialized as rows,
-- so they can never go stale and "completing" one just means fixing the
-- real thing (paying the invoice, sending the invite).
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references public.bands(id) on delete cascade,
  gig_id uuid references public.gigs(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  title text not null,
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

create index tasks_band_id_idx on public.tasks(band_id);
create index tasks_gig_id_idx on public.tasks(gig_id);
create index tasks_client_id_idx on public.tasks(client_id);
create index tasks_created_by_idx on public.tasks(created_by);

-- Same shape as band_members throughout: admin or the band's own leader,
-- nothing more exotic. auth.uid()/is_admin() wrapped in (select ...) per
-- the auth_rls_initplan convention (20260827110000).
create policy tasks_select on public.tasks for select to public
using ((select is_admin()) or is_band_leader_of(band_id));

create policy tasks_insert on public.tasks for insert to public
with check (
  (created_by = (select auth.uid()) or (select is_admin()))
  and ((select is_admin()) or is_band_leader_of(band_id))
);

create policy tasks_update on public.tasks for update to public
using ((select is_admin()) or is_band_leader_of(band_id));

create policy tasks_delete on public.tasks for delete to public
using ((select is_admin()) or is_band_leader_of(band_id));

-- Learned from band_join_invites yesterday: RLS restricts an existing
-- grant, it doesn't create one -- this table needs its own base privilege
-- alongside the policies above, or every request fails with "permission
-- denied for table tasks" regardless of how correct the RLS is.
grant select, insert, update, delete on public.tasks to authenticated;

-- ── Derived task #1: needs invoicing ────────────────────────────────────
-- Exactly GigsList.jsx's existing "Needs invoicing" filter (past gig, no
-- invoice with status sent/paid), just expressed as a query instead of a
-- client-side filter over an already-fetched list, so the daily digest can
-- see it without loading every gig.
create or replace function public.get_needs_invoicing_tasks(p_band_id uuid)
returns table (gig_id uuid, gig_date date, venue_name text)
language sql stable security definer set search_path to 'public' as $$
  select g.id, g.gig_date, v.name
  from public.gigs g
  left join public.venues v on v.id = g.venue_id
  where g.band_id = p_band_id
    and g.status <> 'cancelled'
    and g.gig_date < current_date
    and ((select public.is_admin()) or public.is_band_leader_of(p_band_id))
    and not exists (
      select 1 from public.invoices i where i.gig_id = g.id and i.status in ('sent', 'paid')
    );
$$;

-- ── Derived task #2: repeat-client anniversary pitch ────────────────────
-- Giggio's own flagship example (get a reminder to re-pitch a Christmas
-- party/annual dinner client a year on) -- but auto-detected from gig
-- history instead of something the leader had to remember to set a
-- reminder for in the first place. Window is 350-380 days back (not
-- exactly 365) so it doesn't require checking on the literal anniversary.
create or replace function public.get_client_anniversary_tasks(p_band_id uuid)
returns table (client_id uuid, client_name text, last_gig_id uuid, last_gig_date date)
language sql stable security definer set search_path to 'public' as $$
  select distinct on (g.client_id) g.client_id, c.name, g.id, g.gig_date
  from public.gigs g
  join public.clients c on c.id = g.client_id
  where g.band_id = p_band_id
    and g.client_id is not null
    and g.status <> 'cancelled'
    and ((select public.is_admin()) or public.is_band_leader_of(p_band_id))
    and g.gig_date between (current_date - interval '380 days')::date and (current_date - interval '350 days')::date
    and not exists (
      select 1 from public.gigs g2
      where g2.client_id = g.client_id and g2.gig_date > g.gig_date and g2.status <> 'cancelled'
    )
  order by g.client_id, g.gig_date desc;
$$;

-- ── Derived task #3: dep never invited ──────────────────────────────────
-- Needs invite_sent_at tracking on placeholder_musicians, which didn't
-- exist before this migration -- the "Invite to sign up" mailto has always
-- been fire-and-forget with nothing recorded. Set from the client the
-- moment that button is clicked (MusiciansList.jsx, BandMembers.jsx).
alter table public.placeholder_musicians add column invite_sent_at timestamptz;

create or replace function public.get_uninvited_dep_tasks(p_band_id uuid)
returns table (placeholder_id uuid, dep_name text)
language sql stable security definer set search_path to 'public' as $$
  select distinct pm.id, pm.name
  from public.band_members bm
  join public.placeholder_musicians pm on pm.id = bm.placeholder_id
  where bm.band_id = p_band_id
    and pm.invite_sent_at is null
    and pm.merged_into is null
    and ((select public.is_admin()) or public.is_band_leader_of(p_band_id));
$$;

-- Same as get_band_invite_preview/accept_band_invite yesterday -- revoke
-- the accidental PUBLIC default, grant explicitly to authenticated.
revoke execute on function public.get_needs_invoicing_tasks(uuid) from public;
revoke execute on function public.get_client_anniversary_tasks(uuid) from public;
revoke execute on function public.get_uninvited_dep_tasks(uuid) from public;
grant execute on function public.get_needs_invoicing_tasks(uuid) to authenticated;
grant execute on function public.get_client_anniversary_tasks(uuid) to authenticated;
grant execute on function public.get_uninvited_dep_tasks(uuid) to authenticated;
