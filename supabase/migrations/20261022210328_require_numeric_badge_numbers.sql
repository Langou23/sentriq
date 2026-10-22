begin;

-- Keep badge numbers as text so leading zeros remain part of the identity.
-- Validate existing rows too; do not rewrite badges coupled to Auth identities.
-- If validation fails, inspect and resolve existing records through a trusted path:
-- select id, badge_number from public.profiles
-- where badge_number !~ '^[0-9]+$';
alter table public.profiles
  add constraint profiles_badge_number_digits_only
  check (badge_number ~ '^[0-9]+$');

commit;
