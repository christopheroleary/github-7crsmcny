insert into public.instruments (name, sort_order) values ('DJ', 9), ('Roadie', 10);
alter table public.gig_lineup add column is_captain boolean not null default false;
