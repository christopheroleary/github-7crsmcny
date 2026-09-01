-- A musician's own social media handle (Instagram etc.), so
-- generate-gig-caption (GigPhotos.jsx) can @ tag real people instead of
-- guessing -- ordinary column, no column-restriction trigger needed
-- (unlike subscription_tier/stripe_* -- see 20260815010000), the existing
-- profiles_update_own RLS policy already covers a self-edit of this like
-- it does home_address/ui_theme/etc.
alter table public.profiles add column social_handle text;
