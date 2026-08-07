-- Lets any signed-in user (band leader or musician, admin too) send free-
-- text feedback straight to admin. Security posture, since this is a
-- free-text box writing to the database:
--   - insert requires profile_id = auth.uid() (enforced at the RLS layer,
--     not trusted from the client) -- nobody can submit feedback "as"
--     someone else.
--   - only the submitter or admin can ever read a given row; other
--     musicians/band leaders can't see each other's feedback.
--   - only admin can update (mark read/archived) or delete -- a submitter
--     can't come back and edit/erase what they said after the fact.
--   - message length is bounded and can't be empty/whitespace-only.
--   - rendering is the other half of this: the client must show `message`
--     as plain text (React's default JSX escaping), never through
--     dangerouslySetInnerHTML, so a submitted message can't run as HTML/JS
--     in the admin's browser.
-- No anonymous access at all -- only granted to `authenticated`.
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(btrim(message)) > 0 and char_length(message) <= 2000),
  page text,
  status text not null default 'new' check (status in ('new', 'read', 'archived')),
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

create policy "feedback_select" on public.feedback for select
using (profile_id = auth.uid() or is_admin());

create policy "feedback_insert" on public.feedback for insert
with check (profile_id = auth.uid());

create policy "feedback_update" on public.feedback for update
using (is_admin())
with check (is_admin());

create policy "feedback_delete" on public.feedback for delete
using (is_admin());

grant select, insert, update, delete on public.feedback to authenticated;

-- Notify every admin the moment feedback lands, the same way
-- notify_fee_decrease already does -- security definer, owned by postgres
-- (bypassrls), since notifications has no client-side insert policy by
-- design.
create or replace function public.notify_admins_of_feedback()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  submitter_name text;
  admin_id uuid;
begin
  select full_name into submitter_name from public.profiles where id = new.profile_id;

  for admin_id in select id from public.profiles where role = 'admin' loop
    insert into public.notifications (profile_id, title, body, url, section)
    values (
      admin_id,
      'New feedback from ' || coalesce(submitter_name, 'a user'),
      left(new.message, 140),
      '/feedback',
      'feedback'
    );
  end loop;
  return new;
end;
$function$;

create trigger feedback_notify_admins
  after insert on public.feedback
  for each row execute function public.notify_admins_of_feedback();
