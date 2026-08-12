-- In-app group chat scoped to a single gig. Deliberately immutable once
-- sent (no update policy, no UPDATE grant at all -- not even RLS could
-- open that door back up without also changing the grant) and capped at
-- 160 characters, matching classic SMS. Visible/postable only to the
-- gig's own roster (real accounts, not placeholder deps -- they have no
-- login to post with), the band's leader, and admins.
create table public.gig_messages (
  id uuid primary key default gen_random_uuid(),
  gig_id uuid not null references public.gigs(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint gig_messages_body_length check (char_length(body) <= 160),
  constraint gig_messages_body_not_blank check (char_length(btrim(body)) > 0)
);

create index gig_messages_gig_id_created_at_idx on public.gig_messages (gig_id, created_at);

alter table public.gig_messages enable row level security;

create policy "gig_messages_select" on public.gig_messages for select
using (
  is_admin()
  or is_band_leader_of((select band_id from public.gigs where id = gig_id))
  or is_on_gig(gig_id)
);

create policy "gig_messages_insert" on public.gig_messages for insert
with check (
  sender_id = auth.uid()
  and (
    is_admin()
    or is_band_leader_of((select band_id from public.gigs where id = gig_id))
    or is_on_gig(gig_id)
  )
);

-- Sent messages can be un-sent by their own author, or removed by an
-- admin for moderation -- but never edited. Deliberately no update
-- grant/policy anywhere below.
create policy "gig_messages_delete" on public.gig_messages for delete
using (sender_id = auth.uid() or is_admin());

grant select, insert, delete on public.gig_messages to authenticated;

alter publication supabase_realtime add table public.gig_messages;
