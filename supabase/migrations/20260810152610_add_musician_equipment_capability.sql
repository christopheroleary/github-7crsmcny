-- "Can this dep basically run the whole show" -- highly in-demand deps who
-- bring their own PA/lighting rig, and (per the request) the same fields
-- also work for a non-musician PA/lighting hire company: placeholder
-- deps already support a null instrument_id, so a hire company can be
-- added as a dep with no instrument and just these boxes ticked, without
-- needing a separate "supplier" entity.
alter table profiles
  add column has_pa boolean not null default false,
  add column has_subs boolean not null default false,
  add column has_iem boolean not null default false,
  add column has_mics boolean not null default false,
  add column has_cables boolean not null default false,
  add column has_lighting boolean not null default false,
  add column equipment_notes text;

alter table placeholder_musicians
  add column has_pa boolean not null default false,
  add column has_subs boolean not null default false,
  add column has_iem boolean not null default false,
  add column has_mics boolean not null default false,
  add column has_cables boolean not null default false,
  add column has_lighting boolean not null default false,
  add column equipment_notes text;
