-- A fixed per-musician % breaks the moment headcount changes gig to gig —
-- 7 musicians at 12.8% each is 89.6% of the fee gone before DJ/roadie/profit;
-- 3 musicians at 12.8% each leaves a huge, unintended "remainder". Owner
-- profit becomes the explicit primary input instead; musicians split
-- whatever's left (after profit, DJ, roadie, singer bonus, fuel) evenly
-- across however many are actually booked, so pay scales sensibly at any
-- band size. Captain bonus folds into owner profit — one line, matching the
-- original "captain/leader gets X" framing.
alter table public.bands add column fee_split_owner_profit_pct numeric(5,2);
alter table public.bands drop column fee_split_musician_base_pct;
alter table public.bands drop column fee_split_captain_bonus_pct;
