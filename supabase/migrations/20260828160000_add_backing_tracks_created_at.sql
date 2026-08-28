-- Missed in the previous migration -- backing_tracks predates this repo's
-- tracked migration history and never had a created_at column at all
-- (confirmed via information_schema before writing that migration, but the
-- frontend query assumed one existed anyway). Needed to order the upload
-- list sensibly.
alter table public.backing_tracks add column created_at timestamptz not null default now();
