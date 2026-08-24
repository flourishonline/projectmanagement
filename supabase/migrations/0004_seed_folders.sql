-- Flourish Ops — folder taxonomy.
-- Mirrors the ClickUp space structure it replaces: Retainer Projects,
-- One-off Projects, Bundles, AdHoc, plus Flourish's own internal work.
-- Folders carry no logic, so renaming or reordering these later costs nothing.

insert into public.folders (name, sort_order) values
  ('Retainer Projects', 10),
  ('Bundles',           20),
  ('One-off Projects',  30),
  ('AdHoc',             40),
  ('Internal',          50)
on conflict do nothing;
