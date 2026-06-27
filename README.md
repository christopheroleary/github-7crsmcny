# Gig Manager — first slice

A minimal Vite + React app wired up to your Supabase project. This slice
does exactly two things: lets you sign in, and shows the list of gigs
your RLS policies allow you to see. Everything else (songs, setlists,
outfits, day sheets) follows the same pattern once this round-trip works.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your project's URL and
   anon/publishable key (Supabase dashboard → Project Settings → API):
   ```
   cp .env.example .env
   ```

3. Run it:
   ```
   npm run dev
   ```

4. Open the local URL it prints and sign in with the account you
   created under Authentication → Users.

## What's in here

- `src/supabaseClient.js` — the one place the Supabase connection is configured
- `src/components/Login.jsx` — email/password sign-in
- `src/components/GigsList.jsx` — pulls and displays your `gigs` table
- `src/index.css` — all visual styling, plain CSS, no extra build step

## If the gigs list comes back empty

That likely means there's no seed data yet, or the grants/RLS policies
aren't quite right — both worth ruling out before assuming the frontend
is broken.

## Next steps

- A form to create a new gig (instead of using the Table Editor)
- A gig detail screen: lineup, setlist, outfit, notes
- The public day-sheet page that calls `get_day_sheet` for venues and
  clients with no login at all
