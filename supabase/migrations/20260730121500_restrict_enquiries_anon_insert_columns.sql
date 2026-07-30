drop policy if exists enquiries_anon_insert on public.enquiries;

create policy enquiries_anon_insert
on public.enquiries
for insert
to public
with check (
  status = 'new'
  and converted_gig_id is null
  and admin_notes is null
);
