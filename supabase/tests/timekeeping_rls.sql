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

create function pg_temp.fixture_id(fixture_number integer)
returns uuid
language sql
immutable
security invoker
set search_path = ''
as $$
  select ('10000000-0000-4000-8000-'
    || pg_catalog.lpad(fixture_number::text, 12, '0'))::uuid;
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

-- The namespace is separate from profiles_rls.sql; never replace real records.
select pg_temp.assert_true(
  not exists (select 1 from auth.users
    where id between pg_temp.fixture_id(1) and pg_temp.fixture_id(999))
  and not exists (select 1 from public.sites
    where id between pg_temp.fixture_id(1) and pg_temp.fixture_id(999))
  and not exists (select 1 from public.assignments
    where id between pg_temp.fixture_id(1) and pg_temp.fixture_id(999))
  and not exists (select 1 from public.work_sessions
    where id between pg_temp.fixture_id(1) and pg_temp.fixture_id(999)),
  'fixture namespace is empty before setup'
);

select pg_temp.assert_true(
  (select count(*) = 3 and bool_and(relrowsecurity)
    from pg_catalog.pg_class where oid in (
      'public.sites'::regclass, 'public.assignments'::regclass,
      'public.work_sessions'::regclass)),
  'RLS is enabled on all timekeeping tables'
);
select pg_temp.assert_true(
  (select count(*) = 4 and bool_and(confdeltype = 'a')
    from pg_catalog.pg_constraint where contype = 'f'
      and conrelid in ('public.assignments'::regclass,
        'public.work_sessions'::regclass)),
  'all assignment and session foreign keys protect history with NO ACTION'
);
select pg_temp.assert_true(
  (select indisunique and indpred is not null
    from pg_catalog.pg_index
    where indexrelid = 'public.work_sessions_one_open_per_agent'::regclass),
  'an independent partial unique index enforces one open session per agent'
);

select pg_temp.assert_true(
  not pg_catalog.has_table_privilege(api_role, table_name, 'DELETE')
  and not pg_catalog.has_table_privilege(api_role, table_name, 'TRUNCATE'),
  api_role || ' cannot delete or truncate ' || table_name
)
from (values ('anon'), ('authenticated'), ('service_role')) as roles(api_role)
cross join (values ('public.sites'), ('public.assignments'),
  ('public.work_sessions')) as tables(table_name);

insert into auth.users (id, email)
select pg_temp.fixture_id(number), (310000 + number)::text || '@example.invalid'
from pg_catalog.generate_series(1, 9) as fixtures(number);

insert into public.profiles (id, badge_number, first_name, role, is_active)
select pg_temp.fixture_id(number), (310000 + number)::text, 'Timekeeping fixture',
  role::public.user_role, is_active
from (values
  (1, 'agent', true), (2, 'agent', true),
  (3, 'supervisor', true), (4, 'admin', true),
  (5, 'agent', false), (6, 'admin', false),
  (8, 'supervisor', false), (9, 'agent', true)
) as fixtures(number, role, is_active);

insert into public.sites (
  id, name, latitude, longitude, is_active, created_at, updated_at
) values
  (pg_temp.fixture_id(101), 'Timekeeping active site A', 45.5, -73.6,
    true, '2000-01-01', '2000-01-01'),
  (pg_temp.fixture_id(102), 'Timekeeping active site B', -90, 180,
    true, '2000-01-01', '2000-01-01'),
  (pg_temp.fixture_id(103), 'Timekeeping inactive site', 90, -180,
    false, '2000-01-01', '2000-01-01');

insert into public.assignments (
  id, agent_id, site_id, is_active, created_at, updated_at
) values
  (pg_temp.fixture_id(201), pg_temp.fixture_id(1), pg_temp.fixture_id(101),
    true, '2000-01-01', '2000-01-01'),
  (pg_temp.fixture_id(202), pg_temp.fixture_id(1), pg_temp.fixture_id(102),
    false, '2000-01-01', '2000-01-01'),
  (pg_temp.fixture_id(203), pg_temp.fixture_id(2), pg_temp.fixture_id(102),
    true, '2000-01-01', '2000-01-01'),
  (pg_temp.fixture_id(204), pg_temp.fixture_id(5), pg_temp.fixture_id(101),
    true, '2000-01-01', '2000-01-01'),
  (pg_temp.fixture_id(205), pg_temp.fixture_id(1), pg_temp.fixture_id(103),
    true, '2000-01-01', '2000-01-01'),
  (pg_temp.fixture_id(206), pg_temp.fixture_id(2), pg_temp.fixture_id(101),
    true, '2000-01-01', '2000-01-01');

insert into public.work_sessions (
  id, agent_id, site_id, check_in_at, check_out_at, created_at, updated_at
) values
  (pg_temp.fixture_id(301), pg_temp.fixture_id(1), pg_temp.fixture_id(101),
    '2000-01-01', '2000-01-02', '2000-01-01', '2000-01-01'),
  (pg_temp.fixture_id(302), pg_temp.fixture_id(2), pg_temp.fixture_id(102),
    '2000-01-01', null, '2000-01-01', '2000-01-01'),
  (pg_temp.fixture_id(303), pg_temp.fixture_id(5), pg_temp.fixture_id(101),
    '2000-01-01', '2000-01-02', '2000-01-01', '2000-01-01'),
  (pg_temp.fixture_id(304), pg_temp.fixture_id(1), pg_temp.fixture_id(102),
    '2000-01-01', '2000-01-02', '2000-01-01', '2000-01-01');

select pg_temp.assert_true(
  (select radius_m = 150 and address is null
    from public.sites where id = pg_temp.fixture_id(101)),
  'site radius defaults to 150 meters and address is nullable'
);
select pg_temp.assert_true(
  (select check_in_lat is null and check_in_lng is null
      and check_in_distance_m is null and check_in_within_radius is null
      and check_out_lat is null and check_out_lng is null
      and check_out_distance_m is null and check_out_within_radius is null
    from public.work_sessions where id = pg_temp.fixture_id(302)),
  'geolocation and checkout details may be absent on an open session'
);

-- Constraint failures run in helper subtransactions and leave no extra rows.
select pg_temp.expect_sqlstate(statement, expected_state, test_name)
from (values
  ('insert into public.sites (name, latitude, longitude) values (null, 0, 0)',
    '23502', 'site name is required'),
  ('insert into public.sites (name, latitude, longitude) values (''bad'', null, 0)',
    '23502', 'site latitude is required'),
  ('insert into public.sites (name, latitude, longitude) values (''bad'', 0, null)',
    '23502', 'site longitude is required'),
  ('insert into public.sites (name, latitude, longitude, radius_m) values (''bad'', 0, 0, null)',
    '23502', 'site radius cannot be null'),
  ('insert into public.sites (name, latitude, longitude) values (''bad'', 90.1, 0)',
    '23514', 'site latitude cannot exceed 90'),
  ('insert into public.sites (name, latitude, longitude) values (''bad'', -90.1, 0)',
    '23514', 'site latitude cannot be below -90'),
  ('insert into public.sites (name, latitude, longitude) values (''bad'', 0, 180.1)',
    '23514', 'site longitude cannot exceed 180'),
  ('insert into public.sites (name, latitude, longitude) values (''bad'', 0, -180.1)',
    '23514', 'site longitude cannot be below -180'),
  ('insert into public.sites (name, latitude, longitude, radius_m) values (''bad'', 0, 0, 0)',
    '23514', 'site radius must be positive'),
  ('insert into public.sites (name, latitude, longitude, radius_m) values (''bad'', 0, 0, -1)',
    '23514', 'negative site radius is rejected'),
  ('insert into public.assignments (agent_id, site_id) values (null, pg_temp.fixture_id(101))',
    '23502', 'assignment agent is required'),
  ('insert into public.assignments (agent_id, site_id) values (pg_temp.fixture_id(1), null)',
    '23502', 'assignment site is required'),
  ('insert into public.assignments (agent_id, site_id) values (pg_temp.fixture_id(999), pg_temp.fixture_id(101))',
    '23503', 'assignment agent must reference an existing profile'),
  ('insert into public.assignments (agent_id, site_id) values (pg_temp.fixture_id(1), pg_temp.fixture_id(999))',
    '23503', 'assignment site must exist'),
  ('insert into public.work_sessions (agent_id, site_id) values (null, pg_temp.fixture_id(101))',
    '23502', 'session agent is required'),
  ('insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(9), null)',
    '23502', 'session site is required'),
  ('insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(999), pg_temp.fixture_id(101))',
    '23503', 'session agent must reference an existing profile'),
  ('insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(9), pg_temp.fixture_id(999))',
    '23503', 'session site must exist'),
  ('insert into public.work_sessions (agent_id, site_id, check_in_at) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101), null)',
    '23502', 'session check-in timestamp is required'),
  ('insert into public.work_sessions (agent_id, site_id, check_in_lat) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101), 91)',
    '23514', 'session check-in latitude is bounded'),
  ('insert into public.work_sessions (agent_id, site_id, check_in_lng) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101), -181)',
    '23514', 'session check-in longitude is bounded'),
  ('insert into public.work_sessions (agent_id, site_id, check_in_distance_m) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101), -1)',
    '23514', 'session check-in distance cannot be negative'),
  ('insert into public.work_sessions (agent_id, site_id, check_in_at, check_out_at) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101), ''2000-01-02'', ''2000-01-01'')',
    '23514', 'checkout cannot precede check-in'),
  ('insert into public.work_sessions (agent_id, site_id, check_out_lat) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101), 45)',
    '23514', 'open sessions cannot have checkout latitude'),
  ('insert into public.work_sessions (agent_id, site_id, check_out_lng) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101), -73)',
    '23514', 'open sessions cannot have checkout longitude'),
  ('insert into public.work_sessions (agent_id, site_id, check_out_distance_m) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101), 0)',
    '23514', 'open sessions cannot have checkout distance'),
  ('insert into public.work_sessions (agent_id, site_id, check_out_within_radius) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101), false)',
    '23514', 'open sessions cannot have a checkout radius result'),
  ('insert into public.work_sessions (agent_id, site_id, check_in_at, check_out_at, check_out_lat) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101), ''2000-01-01'', ''2000-01-02'', -91)',
    '23514', 'session checkout latitude is bounded'),
  ('insert into public.work_sessions (agent_id, site_id, check_in_at, check_out_at, check_out_lng) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101), ''2000-01-01'', ''2000-01-02'', 181)',
    '23514', 'session checkout longitude is bounded'),
  ('insert into public.work_sessions (agent_id, site_id, check_in_at, check_out_at, check_out_distance_m) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101), ''2000-01-01'', ''2000-01-02'', -1)',
    '23514', 'session checkout distance cannot be negative'),
  ('delete from public.profiles where id = pg_temp.fixture_id(1)',
    '23503', 'profiles with assignments or work history cannot be deleted'),
  ('delete from public.sites where id = pg_temp.fixture_id(101)',
    '23503', 'sites with assignments or work history cannot be deleted')
) as failures(statement, expected_state, test_name);

-- Even a table owner cannot rewrite an open session's identity or check-in.
select pg_temp.expect_sqlstate(
  'update public.work_sessions set ' || change
    || ' where id = pg_temp.fixture_id(302)',
  '42501', 'history trigger rejects owner change to ' || field_name
)
from (values
  ('id = pg_temp.fixture_id(399)', 'id'),
  ('agent_id = pg_temp.fixture_id(9)', 'agent_id'),
  ('site_id = pg_temp.fixture_id(101)', 'site_id'),
  ('check_in_at = ''1999-01-01''', 'check_in_at'),
  ('check_in_lat = 45', 'check_in_lat'),
  ('check_in_lng = -73', 'check_in_lng'),
  ('check_in_distance_m = 0', 'check_in_distance_m'),
  ('check_in_within_radius = true', 'check_in_within_radius'),
  ('created_at = ''1999-01-01''', 'created_at')
) as changes(change, field_name);
select pg_temp.expect_sqlstate(
  'update public.work_sessions set check_out_at = null where id = pg_temp.fixture_id(301)',
  '42501', 'history trigger prevents the owner from reopening a closed session'
);

set local role anon;
select pg_temp.set_subject(null);
select pg_temp.expect_sqlstate('select * from ' || table_name,
  '42501', 'anonymous reads are denied for ' || table_name)
from (values ('public.sites'), ('public.assignments'),
  ('public.work_sessions')) as tables(table_name);
select pg_temp.expect_sqlstate(
  'insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(1), pg_temp.fixture_id(101))',
  '42501', 'anonymous check-in is denied'
);

set local role authenticated;
select pg_temp.set_subject(null);
select pg_temp.assert_true((select count(*) = 0 from public.sites),
  'authenticated database role without a user id cannot read sites');
select pg_temp.assert_true((select count(*) = 0 from public.assignments)
  and (select count(*) = 0 from public.work_sessions),
  'authenticated database role without a user id cannot read assignments or sessions');

-- Missing and disabled application profiles still see active sites, as specified.
select pg_temp.set_subject(pg_temp.fixture_id(7));
select pg_temp.assert_true(
  (select count(*) = 2 from public.sites
    where id between pg_temp.fixture_id(101) and pg_temp.fixture_id(103))
  and (select count(*) = 0 from public.assignments)
  and (select count(*) = 0 from public.work_sessions),
  'a profileless user sees active sites but no assignments or sessions'
);
select pg_temp.expect_sqlstate(
  'insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(7), pg_temp.fixture_id(101))',
  '42501', 'a profileless user cannot check in'
);

select pg_temp.set_subject(pg_temp.fixture_id(5));
select pg_temp.assert_true(
  (select count(*) = 2 from public.sites
    where id between pg_temp.fixture_id(101) and pg_temp.fixture_id(103))
  and (select count(*) = 0 from public.assignments)
  and (select count(*) = 0 from public.work_sessions),
  'an inactive agent sees active sites but no assignment or session history'
);
select pg_temp.expect_sqlstate(
  'insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(5), pg_temp.fixture_id(101))',
  '42501', 'an inactive assigned agent cannot check in'
);
select pg_temp.assert_affected(
  'update public.work_sessions set check_out_at = now() where id = pg_temp.fixture_id(303)',
  0, 'an inactive agent cannot change their own session'
);

select pg_temp.set_subject(pg_temp.fixture_id(6));
select pg_temp.assert_true(
  (select count(*) = 2 from public.sites
    where id between pg_temp.fixture_id(101) and pg_temp.fixture_id(103))
  and (select count(*) = 0 from public.assignments)
  and (select count(*) = 0 from public.work_sessions),
  'an inactive admin cannot use privileged site or operational reads'
);
select pg_temp.expect_sqlstate(
  'insert into public.sites (name, latitude, longitude) values (''Inactive admin site'', 0, 0)',
  '42501', 'an inactive admin cannot create sites'
);
select pg_temp.assert_affected(
  'update public.assignments set is_active = false where id = pg_temp.fixture_id(201)',
  0, 'an inactive admin cannot manage assignments'
);

select pg_temp.set_subject(pg_temp.fixture_id(8));
select pg_temp.assert_true(
  (select count(*) = 0 from public.assignments)
  and (select count(*) = 0 from public.work_sessions),
  'an inactive supervisor cannot read operational data'
);

select pg_temp.set_subject(pg_temp.fixture_id(9));
select pg_temp.expect_sqlstate(
  'insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101))',
  '42501', 'an active but unassigned agent cannot check in'
);

select pg_temp.set_subject(pg_temp.fixture_id(1));
select pg_temp.assert_true(
  (select count(*) = 2 from public.sites
    where id between pg_temp.fixture_id(101) and pg_temp.fixture_id(103)),
  'an active agent reads active sites only'
);
select pg_temp.assert_true(
  (select count(*) = 3 and bool_and(agent_id = pg_temp.fixture_id(1))
    from public.assignments
    where id between pg_temp.fixture_id(201) and pg_temp.fixture_id(206)),
  'an active agent reads their own active and inactive assignments only'
);
select pg_temp.assert_true(
  (select count(*) = 2 and bool_and(agent_id = pg_temp.fixture_id(1))
    from public.work_sessions
    where id between pg_temp.fixture_id(301) and pg_temp.fixture_id(304)),
  'an active agent reads their own historical sessions only'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.work_sessions
    where id = pg_temp.fixture_id(302)),
  'knowing another session id does not expose its data'
);
select pg_temp.expect_sqlstate(
  'insert into public.sites (name, latitude, longitude) values (''Agent-created site'', 0, 0)',
  '42501', 'an agent cannot create sites'
);
select pg_temp.assert_affected(
  'update public.sites set name = ''Forbidden'' where id = pg_temp.fixture_id(101)',
  0, 'an agent cannot update an active site'
);
select pg_temp.expect_sqlstate(
  'insert into public.assignments (agent_id, site_id) values (pg_temp.fixture_id(1), pg_temp.fixture_id(102))',
  '42501', 'an agent cannot assign themselves to a site'
);
select pg_temp.assert_affected(
  'update public.assignments set is_active = true where id = pg_temp.fixture_id(202)',
  0, 'an agent cannot activate their own assignment'
);

select pg_temp.expect_sqlstate(statement, '42501', test_name)
from (values
  ('insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(2), pg_temp.fixture_id(102))',
    'an agent cannot spoof another agent during check-in'),
  ('insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(1), pg_temp.fixture_id(102))',
    'an inactive assignment cannot authorize check-in'),
  ('insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(1), pg_temp.fixture_id(103))',
    'an active assignment to an inactive site cannot authorize check-in'),
  ('insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(1), pg_temp.fixture_id(999))',
    'a forged site id cannot authorize check-in')
) as failures(statement, test_name);

select pg_temp.assert_affected(
  'insert into public.work_sessions (agent_id, site_id, check_in_lat, check_in_lng, check_in_distance_m, check_in_within_radius) values (pg_temp.fixture_id(1), pg_temp.fixture_id(101), 45.5, -73.6, 0, true)',
  1, 'an active assigned agent can start their own session'
);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(id is not null
      and check_in_at = now() and created_at = now() and updated_at = now()
      and check_in_lat = 45.5 and check_in_lng = -73.6
      and check_in_distance_m = 0 and check_in_within_radius
      and check_out_at is null and check_out_lat is null
      and check_out_lng is null and check_out_distance_m is null
      and check_out_within_radius is null)
    from public.work_sessions where agent_id = pg_temp.fixture_id(1)
      and check_out_at is null),
  'new open sessions receive generated identity, server timestamps and empty checkout'
);

select pg_temp.expect_sqlstate(
  'insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(1), pg_temp.fixture_id(101))',
  '23505', 'an agent cannot create a second open session at the same site'
);
select pg_temp.assert_affected(
  'update public.work_sessions set check_out_at = now() where id = pg_temp.fixture_id(302)',
  0, 'an agent cannot check out another agent session'
);
select pg_temp.assert_affected(
  'update public.work_sessions set check_out_at = null where id = pg_temp.fixture_id(301)',
  0, 'an agent cannot reopen their closed history'
);
select pg_temp.expect_sqlstate(
  'update public.work_sessions set check_out_distance_m = 1 where agent_id = pg_temp.fixture_id(1) and check_out_at is null',
  '42501', 'checkout details alone cannot leave the session open'
);
select pg_temp.expect_sqlstate(
  'update public.work_sessions set check_out_at = now() - interval ''1 second'' where agent_id = pg_temp.fixture_id(1) and check_out_at is null',
  '23514', 'an agent cannot check out before the server check-in timestamp'
);

-- API column privileges are checked even when a caller owns the target row.
select pg_temp.expect_sqlstate(statement, '42501', test_name)
from (values
  ('insert into public.work_sessions (id, agent_id, site_id) values (pg_temp.fixture_id(399), pg_temp.fixture_id(1), pg_temp.fixture_id(101))',
    'clients cannot supply session ids'),
  ('insert into public.work_sessions (agent_id, site_id, check_in_at) values (pg_temp.fixture_id(1), pg_temp.fixture_id(101), ''1999-01-01'')',
    'clients cannot forge check-in timestamps'),
  ('insert into public.work_sessions (agent_id, site_id, created_at) values (pg_temp.fixture_id(1), pg_temp.fixture_id(101), ''1999-01-01'')',
    'clients cannot forge session creation timestamps'),
  ('insert into public.work_sessions (agent_id, site_id, updated_at) values (pg_temp.fixture_id(1), pg_temp.fixture_id(101), ''1999-01-01'')',
    'clients cannot forge session update timestamps'),
  ('insert into public.work_sessions (agent_id, site_id, check_out_at) values (pg_temp.fixture_id(1), pg_temp.fixture_id(101), now())',
    'clients cannot insert preclosed sessions'),
  ('insert into public.work_sessions (agent_id, site_id, check_out_lat) values (pg_temp.fixture_id(1), pg_temp.fixture_id(101), 45)',
    'clients cannot insert checkout geolocation'),
  ('update public.work_sessions set agent_id = pg_temp.fixture_id(2) where agent_id = pg_temp.fixture_id(1) and check_out_at is null',
    'clients cannot reassign session ownership'),
  ('update public.work_sessions set site_id = pg_temp.fixture_id(102) where agent_id = pg_temp.fixture_id(1) and check_out_at is null',
    'clients cannot move an existing session to another site'),
  ('update public.work_sessions set check_in_lat = 0 where agent_id = pg_temp.fixture_id(1) and check_out_at is null',
    'clients cannot rewrite recorded check-in coordinates'),
  ('update public.work_sessions set check_in_at = ''1999-01-01'' where agent_id = pg_temp.fixture_id(1) and check_out_at is null',
    'clients cannot rewrite recorded check-in timestamps'),
  ('update public.work_sessions set created_at = ''1999-01-01'' where agent_id = pg_temp.fixture_id(1) and check_out_at is null',
    'clients cannot rewrite recorded creation timestamps'),
  ('update public.work_sessions set updated_at = ''2099-01-01'' where agent_id = pg_temp.fixture_id(1) and check_out_at is null',
    'clients cannot override automatic session timestamps')
) as failures(statement, test_name);

select pg_temp.expect_sqlstate('delete from ' || table_name,
  '42501', 'agents cannot delete from ' || table_name)
from (values ('public.sites'), ('public.assignments'),
  ('public.work_sessions')) as tables(table_name);
select pg_temp.expect_sqlstate('truncate table ' || table_name,
  '42501', 'agents cannot truncate ' || table_name)
from (values ('public.sites'), ('public.assignments'),
  ('public.work_sessions')) as tables(table_name);

select pg_temp.set_subject(pg_temp.fixture_id(2));
select pg_temp.expect_sqlstate(
  'insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(2), pg_temp.fixture_id(101))',
  '23505', 'the one-open-session limit applies across different assigned sites'
);

select pg_temp.set_subject(pg_temp.fixture_id(3));
select pg_temp.assert_true(
  (select count(*) = 2 from public.sites
    where id between pg_temp.fixture_id(101) and pg_temp.fixture_id(103))
  and (select count(*) = 6 from public.assignments
    where id between pg_temp.fixture_id(201) and pg_temp.fixture_id(206))
  and (select count(*) = 4 from public.work_sessions
    where id between pg_temp.fixture_id(301) and pg_temp.fixture_id(304)),
  'an active supervisor reads active sites and all assignment/session fixtures'
);
select pg_temp.expect_sqlstate(
  'insert into public.sites (name, latitude, longitude) values (''Supervisor site'', 0, 0)',
  '42501', 'a supervisor cannot create sites'
);
select pg_temp.expect_sqlstate(
  'insert into public.assignments (agent_id, site_id) values (pg_temp.fixture_id(9), pg_temp.fixture_id(101))',
  '42501', 'a supervisor cannot create assignments'
);
select pg_temp.assert_affected(
  'update public.assignments set is_active = false where id = pg_temp.fixture_id(201)',
  0, 'a supervisor cannot update assignments'
);
select pg_temp.expect_sqlstate(
  'insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(1), pg_temp.fixture_id(101))',
  '42501', 'a supervisor cannot start an agent session'
);
select pg_temp.assert_affected(
  'update public.work_sessions set check_out_at = now() where id = pg_temp.fixture_id(302)',
  0, 'a supervisor cannot close another agent session'
);

select pg_temp.set_subject(pg_temp.fixture_id(4));
select pg_temp.assert_true(
  (select count(*) = 3 from public.sites
    where id between pg_temp.fixture_id(101) and pg_temp.fixture_id(103))
  and (select count(*) = 6 from public.assignments
    where id between pg_temp.fixture_id(201) and pg_temp.fixture_id(206))
  and (select count(*) = 4 from public.work_sessions
    where id between pg_temp.fixture_id(301) and pg_temp.fixture_id(304)),
  'an active admin reads all fixture sites, assignments and sessions'
);
select pg_temp.assert_affected(
  'update public.sites set name = ''Renamed by admin'', address = ''Fixture address'', radius_m = 200 where id = pg_temp.fixture_id(101)',
  1, 'an active admin can manage site business fields'
);
select pg_temp.assert_true(
  (select updated_at = now() and updated_at > created_at
      and created_at = '2000-01-01'::timestamptz
    from public.sites where id = pg_temp.fixture_id(101)),
  'site edits automatically stamp updated_at while preserving created_at'
);
select pg_temp.assert_affected(
  'update public.assignments set is_active = true where id = pg_temp.fixture_id(201)',
  1, 'an active admin can manage assignments'
);
select pg_temp.assert_true(
  (select updated_at = now() and updated_at > created_at
      and created_at = '2000-01-01'::timestamptz
    from public.assignments where id = pg_temp.fixture_id(201)),
  'assignment edits automatically stamp updated_at'
);
select pg_temp.assert_affected(
  'insert into public.sites (name, latitude, longitude) values (''Timekeeping admin-created site'', 0, 0)',
  1, 'an active admin can create a site without providing database-owned fields'
);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(id is not null and radius_m = 150
      and is_active and created_at = now() and updated_at = now())
    from public.sites where name = 'Timekeeping admin-created site'),
  'admin-created sites receive generated ids and active/timestamp defaults'
);
select pg_temp.assert_affected(
  'insert into public.assignments (agent_id, site_id) values (pg_temp.fixture_id(9), pg_temp.fixture_id(102))',
  1, 'an active admin can create an assignment'
);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(id is not null and is_active
      and created_at = now() and updated_at = now())
    from public.assignments
    where agent_id = pg_temp.fixture_id(9) and site_id = pg_temp.fixture_id(102)),
  'admin-created assignments receive generated ids and active/timestamp defaults'
);

select pg_temp.expect_sqlstate(statement, '42501', test_name)
from (values
  ('insert into public.sites (id, name, latitude, longitude) values (pg_temp.fixture_id(199), ''Forged id'', 0, 0)',
    'app admins cannot supply site ids'),
  ('update public.sites set created_at = ''1999-01-01'' where id = pg_temp.fixture_id(101)',
    'app admins cannot rewrite site creation timestamps'),
  ('update public.sites set updated_at = ''2099-01-01'' where id = pg_temp.fixture_id(101)',
    'app admins cannot forge site update timestamps'),
  ('insert into public.assignments (id, agent_id, site_id) values (pg_temp.fixture_id(299), pg_temp.fixture_id(9), pg_temp.fixture_id(101))',
    'app admins cannot supply assignment ids'),
  ('update public.assignments set created_at = ''1999-01-01'' where id = pg_temp.fixture_id(201)',
    'app admins cannot rewrite assignment creation timestamps'),
  ('update public.assignments set updated_at = ''2099-01-01'' where id = pg_temp.fixture_id(201)',
    'app admins cannot forge assignment update timestamps'),
  ('insert into public.work_sessions (agent_id, site_id) values (pg_temp.fixture_id(1), pg_temp.fixture_id(101))',
    'app admins cannot create agent sessions')
) as failures(statement, test_name);
select pg_temp.assert_affected(
  'update public.work_sessions set check_out_at = now() where id = pg_temp.fixture_id(302)',
  0, 'app admins cannot close agent sessions'
);
select pg_temp.assert_affected(
  'update public.work_sessions set check_out_at = null where id = pg_temp.fixture_id(301)',
  0, 'app admins cannot reopen closed agent sessions'
);
select pg_temp.expect_sqlstate('delete from public.work_sessions',
  '42501', 'app admins cannot delete work history');
select pg_temp.expect_sqlstate('truncate public.work_sessions',
  '42501', 'app admins cannot truncate work history');

-- Disabling a site and assignment must not strand an already open session.
select pg_temp.assert_affected(
  'update public.assignments set is_active = false where id = pg_temp.fixture_id(201)',
  1, 'an admin can deactivate an assignment while its agent is checked in'
);
select pg_temp.assert_affected(
  'update public.sites set is_active = false where id = pg_temp.fixture_id(101)',
  1, 'an admin can deactivate a site while its agent is checked in'
);
select pg_temp.set_subject(pg_temp.fixture_id(1));
select pg_temp.assert_true(
  (select count(*) = 1 from public.work_sessions
    where agent_id = pg_temp.fixture_id(1) and check_out_at is null)
  and (select count(*) = 1 from public.assignments
    where id = pg_temp.fixture_id(201) and not is_active),
  'an agent retains their own session and assignment history after deactivation'
);
select pg_temp.assert_affected(
  'update public.work_sessions set check_out_at = now(), check_out_lat = 45.5, check_out_lng = -73.6, check_out_distance_m = 10, check_out_within_radius = true where agent_id = pg_temp.fixture_id(1) and check_out_at is null',
  1, 'an active agent can check out after both site and assignment are disabled'
);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(check_out_at = now()
      and check_out_lat = 45.5 and check_out_lng = -73.6
      and check_out_distance_m = 10 and check_out_within_radius
      and check_in_lat = 45.5 and check_in_lng = -73.6)
    from public.work_sessions where agent_id = pg_temp.fixture_id(1)
      and check_in_at = now()),
  'checkout stores its own details and preserves check-in observations'
);

select pg_temp.set_subject(pg_temp.fixture_id(2));
select pg_temp.assert_affected(
  'update public.work_sessions set check_out_at = now() where id = pg_temp.fixture_id(302)',
  1, 'an agent can close their previously open historical session'
);
select pg_temp.assert_true(
  (select updated_at = now() and updated_at > created_at
      and created_at = '2000-01-01'::timestamptz
    from public.work_sessions where id = pg_temp.fixture_id(302)),
  'checkout automatically stamps the work-session update timestamp'
);
select pg_temp.assert_affected(
  'update public.work_sessions set check_out_at = now() where id = pg_temp.fixture_id(302)',
  0, 'a second checkout cannot alter an already closed session'
);

set local role service_role;
select pg_temp.set_subject(null);
select pg_temp.assert_true(
  (select count(*) = 3 from public.sites
    where id between pg_temp.fixture_id(101) and pg_temp.fixture_id(103))
  and (select count(*) = 6 from public.assignments
    where id between pg_temp.fixture_id(201) and pg_temp.fixture_id(206))
  and (select count(*) = 4 from public.work_sessions
    where id between pg_temp.fixture_id(301) and pg_temp.fixture_id(304)),
  'the trusted service can read historical data independently of RLS'
);
select pg_temp.expect_sqlstate(
  'update public.work_sessions set check_out_at = null where id = pg_temp.fixture_id(301)',
  '42501', 'the trusted service cannot reopen closed history'
);
select pg_temp.expect_sqlstate(
  'update public.work_sessions set check_out_distance_m = 1 where id = pg_temp.fixture_id(302)',
  '42501', 'the trusted service cannot edit closed checkout details'
);
select pg_temp.expect_sqlstate(
  'update public.work_sessions set agent_id = pg_temp.fixture_id(9) where id = pg_temp.fixture_id(302)',
  '42501', 'service column grants also prevent rewriting session identity'
);
select pg_temp.expect_sqlstate('delete from public.work_sessions',
  '42501', 'the trusted service cannot delete work history');
select pg_temp.expect_sqlstate('truncate public.work_sessions',
  '42501', 'the trusted service cannot truncate work history');

reset role;
select pg_temp.assert_true(
  (select count(*) = 0 from public.work_sessions
    where agent_id in (pg_temp.fixture_id(1), pg_temp.fixture_id(2))
      and check_out_at is null),
  'all allowed checkouts completed and rejected operations preserved history'
);
select pg_temp.assert_true(
  (select count(*) = 5 from public.work_sessions
    where agent_id in (pg_temp.fixture_id(1), pg_temp.fixture_id(2),
      pg_temp.fixture_id(5))),
  'fixture session history was neither deleted nor duplicated'
);

select 'All timekeeping schema and RLS checks passed; rolling back fixtures.' as result;
rollback;
