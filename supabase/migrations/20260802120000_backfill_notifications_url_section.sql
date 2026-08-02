-- One-time backfill for notification rows created before the url/section
-- fix (see the notify-admin/notify-musician deploy in the prior migration):
-- every notification a user could currently click was created with the
-- broken url ('/') and/or no section at all, since the fix only applies
-- to newly-generated notifications going forward, not rows already sitting
-- in someone's bell. Confirmed live: the newest row in the table predated
-- the fix, so every notification anyone could actually click was still
-- broken regardless of the frontend/edge-function code being correct.
--
-- Matched by title text, since that's the only thing that reliably
-- identifies notification type on old rows (no type/category column
-- exists). Includes two claim-notification title variants ("New claim
-- from X" / "Updated claim from X") not present in the current
-- notify-admin source -- apparently wording used by an earlier version of
-- that function, discovered only by inspecting the actual historic data
-- rather than assuming the current source is the only shape that exists.

-- Fix the broken url on any gig-related notification that still has it.
update public.notifications
set url = '/gigs'
where url = '/' and gig_id is not null;

-- Roster-related: a musician confirming/unconfirming, or being added to a gig.
update public.notifications
set section = 'roster'
where section is null
  and gig_id is not null
  and (
    title ilike '% confirmed for %'
    or title ilike '% unconfirmed for %'
    or title ilike 'A musician confirmed%'
    or title ilike 'A musician unconfirmed%'
    or title ilike 'You''ve been added to a gig%'
  );

-- Claims-related: a new/updated/resubmitted claim, or a claim decision.
update public.notifications
set section = 'claims'
where section is null
  and gig_id is not null
  and (
    title ilike 'New payment claim from %'
    or title ilike '% resubmitted their claim'
    or title ilike 'Your claim has been %'
    or title ilike 'New claim from %'
    or title ilike 'Updated claim from %'
  );
