-- Daily music-industry news digest, shown on the Dashboard to give people a
-- reason to check the app even on days with no gig activity. Populated by a
-- scheduled Edge Function (daily-news-digest), never written by clients --
-- only service_role gets INSERT/UPDATE/DELETE.
create table public.news_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  -- The source feed's own snippet, used as-is (no AI rewrite) -- often
  -- empty or a near-duplicate of the title, in which case the frontend
  -- falls back to showing just source + time instead of a redundant line.
  summary text,
  url text not null unique,
  source text,
  published_at timestamptz,
  -- UK calendar date this article was picked up on -- lets the fetch
  -- function check "have I already run today" without depending on the
  -- server's UTC clock crossing midnight at the same moment UK time does.
  batch_date date not null default current_date,
  created_at timestamptz not null default now()
);

create index news_articles_published_at_idx on public.news_articles (published_at desc);

alter table public.news_articles enable row level security;

-- Generic public news content, not band/gig data -- every signed-in user
-- sees the same digest regardless of role.
create policy news_articles_read on public.news_articles
for select to authenticated
using (true);

grant select on public.news_articles to authenticated;
grant select, insert, update, delete on public.news_articles to service_role;
