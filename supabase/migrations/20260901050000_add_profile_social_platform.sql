-- Which platform social_handle is for -- paired field, mirrors bands'
-- social_links[].label but as a single value since a musician's Settings
-- only needs one handle, not a repeating list like a band's social_links.
alter table public.profiles add column social_platform text default 'Instagram';
