-- Public band booking page: adds the columns/RPCs needed for a no-login
-- page at /band/:slug per band. Free for every band, not Pro-gated -- the
-- growth-loop value of every band having a shareable page outweighs
-- gating it, and it costs nothing at scale (no Stripe fees, no AI calls).

alter table public.bands
  add column public_slug text,
  add column public_bio text,
  add column public_genres text[],
  add column public_enabled boolean not null default false;

alter table public.bands
  add constraint bands_public_slug_format
    check (public_slug is null or public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint bands_public_slug_length
    check (public_slug is null or char_length(public_slug) <= 60),
  add constraint bands_public_bio_length
    check (public_bio is null or char_length(public_bio) <= 2000),
  add constraint bands_public_enabled_needs_slug
    check (not public_enabled or public_slug is not null);

-- Multiple bands can share public_slug = null (not yet published);
-- Postgres unique indexes already treat nulls as distinct, so a plain
-- unique index (rather than a partial one) would work too, but scoping it
-- to non-null slugs states the intent directly: uniqueness is only a rule
-- once a band actually publishes.
create unique index bands_public_slug_key on public.bands (public_slug) where public_slug is not null;

alter table public.enquiries
  add column band_id uuid references public.bands(id);

-- anon's INSERT on enquiries is granted per-column (see
-- 20260730121500_restrict_enquiries_anon_insert_columns.sql), so the new
-- column needs its own explicit grant -- it doesn't inherit access from a
-- blanket table-level grant, because none exists.
grant insert (band_id) on public.enquiries to anon, authenticated;

-- Public, no-login band page -- mirrors get_invoice_by_token's shape
-- (SECURITY DEFINER, scoped strictly to what should be public, never a
-- direct table select from PublicBandPage.jsx). Returns null entirely for
-- a band that hasn't opted in, so a guessed slug for a real but
-- unpublished band reveals nothing at all.
create or replace function public.get_public_band_page(p_slug text)
returns json
language sql
stable
security definer
set search_path to 'public'
as $$
  select json_build_object(
    'band_id', b.id,
    'name', b.name,
    'bio', b.public_bio,
    'genres', b.public_genres,
    'logo_url', b.logo_url,
    'website_url', b.website_url,
    'social_links', b.social_links,
    'doc_accent_colour', b.doc_accent_colour
  )
  from public.bands b
  where b.public_slug = p_slug
    and b.public_enabled = true;
$$;

-- Busy dates only, in a capped forward-looking range -- never venue,
-- client, fee or any other gig detail. 'inquiry' status is deliberately
-- excluded: it's a soft, unconfirmed lead and shouldn't block a real
-- enquiry from someone else for the same date. p_to is silently clamped
-- to 400 days past p_from so this can't be used to bulk-scrape a band's
-- full gig history.
create or replace function public.get_band_availability(p_slug text, p_from date, p_to date)
returns json
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(json_agg(g.gig_date order by g.gig_date), '[]'::json)
  from public.gigs g
  join public.bands b on b.id = g.band_id
  where b.public_slug = p_slug
    and b.public_enabled = true
    and g.status in ('confirmed', 'completed')
    and p_from is not null
    and p_to is not null
    and p_to >= p_from
    and g.gig_date >= p_from
    and g.gig_date <= least(p_to, (p_from + interval '400 days')::date);
$$;
