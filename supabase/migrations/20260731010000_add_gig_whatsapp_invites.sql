create table public.gig_whatsapp_invites (
  id uuid primary key default gen_random_uuid(),
  gig_id uuid not null references public.gigs(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  placeholder_id uuid references public.placeholder_musicians(id) on delete cascade,
  sent_at timestamptz not null default now(),
  sent_by uuid references public.profiles(id),
  constraint gig_whatsapp_invites_one_recipient check (
    (profile_id is not null and placeholder_id is null) or
    (profile_id is null and placeholder_id is not null)
  ),
  unique (gig_id, profile_id),
  unique (gig_id, placeholder_id)
);

alter table public.gig_whatsapp_invites enable row level security;

create policy gig_whatsapp_invites_select on public.gig_whatsapp_invites for select to public
using (
  is_admin() or exists (select 1 from gigs g where g.id = gig_whatsapp_invites.gig_id and is_band_leader_of(g.band_id))
);

create policy gig_whatsapp_invites_insert on public.gig_whatsapp_invites for insert to public
with check (
  is_admin() or exists (select 1 from gigs g where g.id = gig_whatsapp_invites.gig_id and is_band_leader_of(g.band_id))
);

create policy gig_whatsapp_invites_update on public.gig_whatsapp_invites for update to public
using (
  is_admin() or exists (select 1 from gigs g where g.id = gig_whatsapp_invites.gig_id and is_band_leader_of(g.band_id))
);
