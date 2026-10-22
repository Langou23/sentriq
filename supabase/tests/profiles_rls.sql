-- Run as postgres against a disposable database after applying all migrations.
-- Every fixture and change stays inside this transaction and is rolled back.
begin;

create function pg_temp.assert_true(condition boolean, test_name text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if condition is distinct from true then
    raise exception 'FAIL: %', test_name;
  end if;
  raise notice 'PASS: %', test_name;
end;
$$;

create function pg_temp.expect_sqlstate(
  statement text,
  expected_state text,
  test_name text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actual_state text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
    if actual_state <> expected_state then
      raise exception 'FAIL: % (expected SQLSTATE %, received %: %)',
        test_name, expected_state, actual_state, sqlerrm;
    end if;
    raise notice 'PASS: %', test_name;
    return;
  end;
  raise exception 'FAIL: % (expected SQLSTATE %, statement succeeded)',
    test_name, expected_state;
end;
$$;

create function pg_temp.assert_affected(
  statement text,
  expected_count bigint,
  test_name text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actual_count bigint;
begin
  execute statement;
  get diagnostics actual_count = row_count;
  perform pg_temp.assert_true(
    actual_count = expected_count,
    test_name || ' (affected rows: ' || actual_count || ')'
  );
end;
$$;

create function pg_temp.set_subject(subject uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.set_config(
    'request.jwt.claim.sub', coalesce(subject::text, ''), true
  );
  perform pg_catalog.set_config(
    'request.jwt.claims',
    case when subject is null then '{}'
      else pg_catalog.json_build_object(
        'sub', subject::text, 'role', 'authenticated'
      )::text
    end,
    true
  );
end;
$$;

select pg_temp.assert_true(
  pg_catalog.enum_range(null::public.user_role)::text
    = '{agent,supervisor,admin}',
  '01 - role enum has exactly the requested values'
);

select pg_temp.assert_true(
  (select relrowsecurity from pg_catalog.pg_class
    where oid = 'public.profiles'::regclass),
  '02 - profiles has RLS enabled'
);

select pg_temp.assert_true(
  (select p.prosecdef and p.provolatile = 's'
      and p.pronargs = 0 and p.prorettype = 'public.user_role'::regtype
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and exists (
        select 1 from pg_catalog.unnest(p.proconfig) as setting
        where setting in ('search_path=""', 'search_path=')
      )
    from pg_catalog.pg_proc as p
    where p.oid = 'public.current_user_role()'::regprocedure),
  '03 - role helper is a stable postgres-owned definer with an empty search path'
);

select pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.current_user_role()', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.current_user_role()', 'EXECUTE'
  )
  and not pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.profiles', 'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated', 'public.profiles', 'DELETE'
  ),
  '04 - grants exclude anonymous access and client provisioning or deletion'
);

select pg_temp.assert_true(
  not exists (
    select 1 from auth.users
    where id between '00000000-0000-4000-8000-000000000001'::uuid
      and '00000000-0000-4000-8000-000000000006'::uuid
  ),
  '05 - reserved fixture identities do not overwrite existing users'
);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000001', 'sentriq-rls-agent-1@example.invalid'),
  ('00000000-0000-4000-8000-000000000002', 'sentriq-rls-agent-2@example.invalid'),
  ('00000000-0000-4000-8000-000000000003', 'sentriq-rls-supervisor@example.invalid'),
  ('00000000-0000-4000-8000-000000000004', 'sentriq-rls-admin@example.invalid'),
  ('00000000-0000-4000-8000-000000000005', 'sentriq-rls-defaults@example.invalid'),
  ('00000000-0000-4000-8000-000000000006', 'sentriq-rls-unprovisioned@example.invalid');

select pg_temp.assert_true(
  not exists (
    select 1 from public.profiles
    where id between '00000000-0000-4000-8000-000000000001'::uuid
      and '00000000-0000-4000-8000-000000000006'::uuid
  ),
  '06 - auth signup does not automatically provision a profile'
);

insert into public.profiles (
  id, badge_number, first_name, last_name, role, created_at, updated_at
) values
  ('00000000-0000-4000-8000-000000000001', '000001',
    'Agent', 'One', 'agent', '2000-01-01', '2000-01-01'),
  ('00000000-0000-4000-8000-000000000002', '000002',
    'Agent', 'Two', 'agent', '2000-01-01', '2000-01-01'),
  ('00000000-0000-4000-8000-000000000003', '000003',
    'Supervisor', 'Three', 'supervisor', '2000-01-01', '2000-01-01'),
  ('00000000-0000-4000-8000-000000000004', '000004',
    'Admin', 'Four', 'admin', '2000-01-01', '2000-01-01');

insert into public.profiles (id, badge_number) values
  ('00000000-0000-4000-8000-000000000005', '000005');

select pg_temp.assert_true(
  (select role = 'agent' and is_active and first_name is null
      and last_name is null and created_at = pg_catalog.now()
      and updated_at = pg_catalog.now()
    from public.profiles
    where id = '00000000-0000-4000-8000-000000000005'),
  '07 - profile defaults and nullable names match the model'
);

select pg_temp.expect_sqlstate(
  $test$insert into public.profiles (id, badge_number)
    values ('00000000-0000-4000-8000-000000000006', null)$test$,
  '23502', '08 - badge number is required'
);
select pg_temp.expect_sqlstate(
  $test$insert into public.profiles (id, badge_number, role)
    values ('00000000-0000-4000-8000-000000000006', '900009', null)$test$,
  '23502', '09 - role cannot be null'
);
select pg_temp.expect_sqlstate(
  $test$insert into public.profiles (id, badge_number, is_active)
    values ('00000000-0000-4000-8000-000000000006', '900010', null)$test$,
  '23502', '10 - active status cannot be null'
);
select pg_temp.expect_sqlstate(
  $test$insert into public.profiles (id, badge_number, created_at)
    values ('00000000-0000-4000-8000-000000000006', '900011', null)$test$,
  '23502', '11 - created_at cannot be null'
);
select pg_temp.expect_sqlstate(
  $test$insert into public.profiles (id, badge_number, updated_at)
    values ('00000000-0000-4000-8000-000000000006', '900012', null)$test$,
  '23502', '12 - updated_at cannot be null'
);
select pg_temp.expect_sqlstate(
  $test$insert into public.profiles (id, badge_number)
    values ('00000000-0000-4000-8000-000000000006', '000001')$test$,
  '23505', '13 - duplicate badge numbers are rejected'
);
select pg_temp.expect_sqlstate(
  $test$insert into public.profiles (id, badge_number)
    values ('00000000-0000-4000-8000-000000000001', '900014')$test$,
  '23505', '14 - profile identity is the primary key'
);
select pg_temp.expect_sqlstate(
  $test$insert into public.profiles (id, badge_number)
    values ('00000000-0000-4000-8000-000000000007', '900015')$test$,
  '23503', '15 - profiles must reference an existing auth user'
);
select pg_temp.expect_sqlstate(
  $test$insert into public.profiles (id, badge_number, role)
    values ('00000000-0000-4000-8000-000000000006', '900016', 'owner')$test$,
  '22P02', '16 - roles outside the enum are rejected'
);

set local role anon;
select pg_temp.set_subject(null);

select pg_temp.expect_sqlstate(
  'select * from public.profiles',
  '42501', '17 - anonymous reads are denied'
);
select pg_temp.expect_sqlstate(
  'select public.current_user_role()',
  '42501', '18 - anonymous role-helper execution is denied'
);
select pg_temp.expect_sqlstate(
  $test$update public.profiles set first_name = 'Anonymous'
    where id = '00000000-0000-4000-8000-000000000001'$test$,
  '42501', '19 - anonymous updates are denied'
);

set local role authenticated;
select pg_temp.set_subject('00000000-0000-4000-8000-000000000001');

select pg_temp.assert_true(
  public.current_user_role() = 'agent',
  '20 - helper resolves the authenticated agent without RLS recursion'
);
select pg_temp.assert_true(
  (select count(*) = 1 and min(id::text)
      = '00000000-0000-4000-8000-000000000001'
    from public.profiles
    where id between '00000000-0000-4000-8000-000000000001'::uuid
      and '00000000-0000-4000-8000-000000000005'::uuid),
  '21 - an agent sees only their own profile'
);
select pg_temp.assert_affected(
  $test$update public.profiles
    set first_name = 'Edited', last_name = 'Agent', badge_number = '000101'
    where id = '00000000-0000-4000-8000-000000000001'$test$,
  1, '22 - an agent can edit their own personal fields'
);
select pg_temp.assert_true(
  (select first_name = 'Edited' and last_name = 'Agent'
      and badge_number = '000101'
      and updated_at = pg_catalog.now() and updated_at > created_at
      and created_at = '2000-01-01'::timestamptz
    from public.profiles
    where id = '00000000-0000-4000-8000-000000000001'),
  '23 - personal edits persist and updated_at is stamped automatically'
);
select pg_temp.assert_affected(
  $test$update public.profiles set first_name = 'Forbidden'
    where id = '00000000-0000-4000-8000-000000000002'$test$,
  0, '24 - an agent cannot update another profile'
);
select pg_temp.expect_sqlstate(
  $test$update public.profiles set role = 'admin'
    where id = '00000000-0000-4000-8000-000000000001'$test$,
  '42501', '25 - an agent cannot promote their own role'
);
select pg_temp.expect_sqlstate(
  $test$update public.profiles set is_active = false
    where id = '00000000-0000-4000-8000-000000000001'$test$,
  '42501', '26 - an agent cannot change their own active status'
);
select pg_temp.expect_sqlstate(
  $test$update public.profiles set id = id
    where id = '00000000-0000-4000-8000-000000000001'$test$,
  '42501', '27 - clients cannot write the profile identity'
);
select pg_temp.expect_sqlstate(
  $test$update public.profiles set created_at = pg_catalog.now()
    where id = '00000000-0000-4000-8000-000000000001'$test$,
  '42501', '28 - clients cannot write created_at'
);
select pg_temp.expect_sqlstate(
  $test$update public.profiles set updated_at = '2099-01-01'
    where id = '00000000-0000-4000-8000-000000000001'$test$,
  '42501', '29 - clients cannot override updated_at'
);
select pg_temp.expect_sqlstate(
  $test$insert into public.profiles (id, badge_number)
    values ('00000000-0000-4000-8000-000000000006', '900030')$test$,
  '42501', '30 - clients cannot provision profiles'
);
select pg_temp.expect_sqlstate(
  $test$delete from public.profiles
    where id = '00000000-0000-4000-8000-000000000001'$test$,
  '42501', '31 - clients cannot delete profiles'
);
select pg_temp.assert_affected(
  $test$update public.profiles set role = 'admin', is_active = false
    where id = '00000000-0000-4000-8000-000000000002'$test$,
  0, '32 - an agent cannot change another role or status'
);

select pg_temp.set_subject('00000000-0000-4000-8000-000000000003');

select pg_temp.assert_true(
  public.current_user_role() = 'supervisor',
  '33 - helper resolves the supervisor without RLS recursion'
);
select pg_temp.assert_true(
  (select count(*) = 5 from public.profiles
    where id between '00000000-0000-4000-8000-000000000001'::uuid
      and '00000000-0000-4000-8000-000000000005'::uuid),
  '34 - a supervisor reads all fixture profiles'
);
select pg_temp.assert_affected(
  $test$update public.profiles set first_name = 'Edited supervisor'
    where id = '00000000-0000-4000-8000-000000000003'$test$,
  1, '35 - a supervisor can edit their own personal fields'
);
select pg_temp.assert_affected(
  $test$update public.profiles set first_name = 'Forbidden'
    where id = '00000000-0000-4000-8000-000000000002'$test$,
  0, '36 - a supervisor cannot edit another personal profile'
);
select pg_temp.expect_sqlstate(
  $test$update public.profiles set role = 'admin'
    where id = '00000000-0000-4000-8000-000000000003'$test$,
  '42501', '37 - a supervisor cannot promote themselves'
);
select pg_temp.expect_sqlstate(
  $test$update public.profiles set is_active = false
    where id = '00000000-0000-4000-8000-000000000003'$test$,
  '42501', '38 - a supervisor cannot change their own active status'
);
select pg_temp.assert_affected(
  $test$update public.profiles set role = 'admin', is_active = false
    where id = '00000000-0000-4000-8000-000000000002'$test$,
  0, '39 - a supervisor cannot change another role or status'
);

select pg_temp.set_subject('00000000-0000-4000-8000-000000000004');

select pg_temp.assert_true(
  public.current_user_role() = 'admin',
  '40 - helper resolves the admin without RLS recursion'
);
select pg_temp.assert_true(
  (select count(*) = 5 from public.profiles
    where id between '00000000-0000-4000-8000-000000000001'::uuid
      and '00000000-0000-4000-8000-000000000005'::uuid),
  '41 - an admin reads all fixture profiles'
);
select pg_temp.assert_affected(
  $test$update public.profiles set role = 'supervisor', is_active = false
    where id = '00000000-0000-4000-8000-000000000002'$test$,
  1, '42 - an admin can change another role and active status'
);
select pg_temp.assert_true(
  (select role = 'supervisor' and not is_active
      and updated_at = pg_catalog.now()
      and first_name = 'Agent' and last_name = 'Two'
    from public.profiles
    where id = '00000000-0000-4000-8000-000000000002'),
  '43 - admin access changes persist without changing personal fields'
);
select pg_temp.expect_sqlstate(
  $test$update public.profiles set badge_number = '900044'
    where id = '00000000-0000-4000-8000-000000000002'$test$,
  '42501', '44 - an admin cannot edit another badge number'
);
select pg_temp.expect_sqlstate(
  $test$update public.profiles set first_name = 'Forbidden'
    where id = '00000000-0000-4000-8000-000000000002'$test$,
  '42501', '45 - an admin cannot edit another first name'
);
select pg_temp.expect_sqlstate(
  $test$update public.profiles set last_name = 'Forbidden'
    where id = '00000000-0000-4000-8000-000000000002'$test$,
  '42501', '46 - an admin cannot edit another last name'
);
select pg_temp.assert_affected(
  $test$update public.profiles set first_name = 'Edited admin'
    where id = '00000000-0000-4000-8000-000000000004'$test$,
  1, '47 - an admin can edit their own personal profile'
);
select pg_temp.expect_sqlstate(
  $test$update public.profiles set id = id
    where id = '00000000-0000-4000-8000-000000000002'$test$,
  '42501', '48 - app admins cannot bypass identity column grants'
);

select pg_temp.set_subject('00000000-0000-4000-8000-000000000006');

select pg_temp.assert_true(
  public.current_user_role() is null,
  '49 - an unprovisioned authenticated user has no role'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.profiles
    where id between '00000000-0000-4000-8000-000000000001'::uuid
      and '00000000-0000-4000-8000-000000000005'::uuid),
  '50 - an unprovisioned authenticated user cannot read profiles'
);
select pg_temp.assert_affected(
  $test$update public.profiles set first_name = 'Forbidden'
    where id = '00000000-0000-4000-8000-000000000002'$test$,
  0, '51 - an unprovisioned authenticated user cannot update profiles'
);

select pg_temp.set_subject('00000000-0000-4000-8000-000000000002');
select pg_temp.assert_true(
  public.current_user_role() = 'supervisor',
  '52 - role helper returns the stored role independently of active status'
);

set local role service_role;
select pg_temp.set_subject(null);
select pg_temp.assert_affected(
  $test$update public.profiles
    set role = 'agent', is_active = true, first_name = 'Provisioned'
    where id = '00000000-0000-4000-8000-000000000002'$test$,
  1, '53 - trusted service provisioning can maintain profile fields'
);

reset role;
select pg_temp.assert_true(
  (select role = 'agent' and is_active and first_name = 'Provisioned'
    from public.profiles
    where id = '00000000-0000-4000-8000-000000000002'),
  '54 - trusted provisioning changes are visible to the database owner'
);

select pg_temp.assert_true(
  (select data_type = 'text' from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'badge_number')
  and (select convalidated from pg_catalog.pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_badge_number_digits_only'),
  '55 - badge numbers remain text with a validated digits-only constraint'
);
select pg_temp.assert_true(
  (select badge_number = '000101' from public.profiles
    where id = '00000000-0000-4000-8000-000000000001'),
  '56 - badge updates preserve leading zeros exactly'
);

insert into public.profiles (id, badge_number) values
  ('00000000-0000-4000-8000-000000000006', '101');

select pg_temp.assert_true(
  (select count(distinct badge_number) = 2 from public.profiles
    where id in ('00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000006')
      and badge_number in ('000101', '101')),
  '57 - leading zeros distinguish different badge identities'
);
select pg_temp.assert_affected(
  $test$update public.profiles set badge_number = '0'
    where id = '00000000-0000-4000-8000-000000000006'$test$,
  1, '58 - a badge consisting of a single zero is valid'
);
select pg_temp.assert_affected(
  $test$update public.profiles
    set badge_number = '1234567890123456789012345678901234567890'
    where id = '00000000-0000-4000-8000-000000000006'$test$,
  1, '59 - digit strings are not converted to bounded numeric types'
);

select pg_temp.expect_sqlstate(
  pg_catalog.format(
    'update public.profiles set badge_number = %L where id = %L',
    invalid_badge,
    '00000000-0000-4000-8000-000000000006'
  ),
  '23514', test_name
)
from (values
  ('', '60 - empty badge numbers are rejected'),
  (' ', '61 - whitespace-only badge numbers are rejected'),
  (' 00123', '62 - leading whitespace is rejected'),
  ('00123 ', '63 - trailing whitespace is rejected'),
  ('12a', '64 - trailing letters are rejected'),
  ('a12', '65 - leading letters are rejected'),
  ('-12', '66 - negative signs are rejected'),
  ('+12', '67 - positive signs are rejected'),
  ('12.0', '68 - decimal separators are rejected'),
  ('12_3', '69 - underscores are rejected'),
  ('1 23', '70 - internal whitespace is rejected'),
  (E'12\n', '71 - trailing newlines are rejected'),
  ('١٢٣', '72 - Arabic-Indic digits are rejected'),
  ('１２３', '73 - fullwidth digits are rejected')
) as invalid_badges(invalid_badge, test_name);

select pg_temp.assert_true(
  (select badge_number = '1234567890123456789012345678901234567890'
    from public.profiles
    where id = '00000000-0000-4000-8000-000000000006'),
  '74 - rejected updates do not rewrite the stored badge number'
);

delete from public.profiles
where id = '00000000-0000-4000-8000-000000000006';

select pg_temp.expect_sqlstate(
  $test$insert into public.profiles (id, badge_number)
    values ('00000000-0000-4000-8000-000000000006', 'AGENT-123')$test$,
  '23514', '75 - nonnumeric profile inserts are rejected too'
);

select 'All 75 profiles schema and RLS checks passed; rolling back fixtures.'
  as result;
rollback;
