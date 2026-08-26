-- A free, simple way to object to the device/usage logging described in
-- My Profile's "Your data" notice (device type, browser, screen size, IP
-- address, last active). That logging is first-party and used only for
-- troubleshooting -- never advertising, never shared onward -- which is
-- what UK PECR's 2026 statistical-purposes exception (Schedule A1, added
-- by the Data (Use and Access) Act) needs to apply without a cookie-style
-- consent banner. The exception's other condition, clear information about
-- what's collected and why, is already met by the existing notice; this
-- column is what closes the second one.
alter table public.profiles
  add column usage_logging_opt_out boolean not null default false;

-- Everyone needs to read their own flag (to render the toggle) and it's
-- not sensitive, so it goes in the safe column grant alongside the other
-- non-financial profile fields from the previous migration -- SELECT is
-- per-column since the blanket table grant was revoked there.
grant select (usage_logging_opt_out) on public.profiles to authenticated;
