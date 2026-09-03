-- One reaction per (message, person) -- a simple thumbs-up toggle, not a
-- multi-emoji picker, matching what was actually asked for. No gig_id/
-- band_id columns: RLS mirrors gig_messages' own access rule exactly via
-- an EXISTS join to the message being reacted to, so there's no
-- client-suppliable gig_id a caller could mismatch against message_id to
-- react to (or leak the existence of) a message on a gig they can't see.
create table public.gig_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.gig_messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (message_id, profile_id)
);

create index gig_message_reactions_message_id_idx on public.gig_message_reactions(message_id);
create index gig_message_reactions_profile_id_idx on public.gig_message_reactions(profile_id);

alter table public.gig_message_reactions enable row level security;

create policy "gig_message_reactions_select" on public.gig_message_reactions
for select using (
  exists (
    select 1 from public.gig_messages m
    where m.id = gig_message_reactions.message_id
      and (public.is_admin() or public.is_band_leader_of((select g.band_id from public.gigs g where g.id = m.gig_id)) or public.is_on_gig(m.gig_id))
  )
);

create policy "gig_message_reactions_insert" on public.gig_message_reactions
for insert with check (
  profile_id = (select auth.uid())
  and exists (
    select 1 from public.gig_messages m
    where m.id = gig_message_reactions.message_id
      and (public.is_admin() or public.is_band_leader_of((select g.band_id from public.gigs g where g.id = m.gig_id)) or public.is_on_gig(m.gig_id))
  )
);

-- Only your own reaction -- unlike message deletion, no admin override.
-- A like isn't moderation-worthy content the way an actual message is.
create policy "gig_message_reactions_delete" on public.gig_message_reactions
for delete using (profile_id = (select auth.uid()));

grant select, insert, delete on public.gig_message_reactions to authenticated;

-- So a like appears live for everyone looking at the same gig's chat,
-- same as new messages already do.
alter publication supabase_realtime add table public.gig_message_reactions;
