-- Run as postgres on a disposable database after applying all migrations.
-- No fixture or changed access state survives the final rollback.
begin;

create function pg_temp.assert_true(condition boolean, test_name text)
returns void language plpgsql security invoker set search_path = ''
as $$
begin
  if condition is distinct from true then
    raise exception 'FAIL: %', test_name;
  end if;
  raise notice 'PASS: %', test_name;
end;
$$;

create function pg_temp.expect_sqlstate(
  statement text, expected_state text, test_name text
)
returns void language plpgsql security invoker set search_path = ''
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
  statement text, expected_count bigint, test_name text
)
returns void language plpgsql security invoker set search_path = ''
as $$
declare
  actual_count bigint;
begin
  execute statement;
  get diagnostics actual_count = row_count;
  perform pg_temp.assert_true(actual_count = expected_count, test_name);
end;
$$;

create function pg_temp.fixture_id(fixture_number integer)
returns uuid language sql immutable security invoker set search_path = ''
as $$
  select ('20000000-0000-4000-8000-'
    || pg_catalog.lpad(fixture_number::text, 12, '0'))::uuid;
$$;

create function pg_temp.set_subject(subject uuid)
returns void language plpgsql security invoker set search_path = ''
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
  not exists (select 1 from auth.users
    where id between pg_temp.fixture_id(1) and pg_temp.fixture_id(999))
  and not exists (select 1 from public.sites
    where id between pg_temp.fixture_id(1) and pg_temp.fixture_id(999))
  and not exists (select 1 from public.assignments
    where id between pg_temp.fixture_id(1) and pg_temp.fixture_id(999))
  and not exists (select 1 from public.work_sessions
    where id between pg_temp.fixture_id(1) and pg_temp.fixture_id(999)),
  '01 - fixture identities do not replace existing records'
);
select pg_temp.assert_true(
  (select p.prosecdef and p.provolatile = 's' and p.pronargs = 0
      and p.prorettype = 'uuid'::regtype
      and pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      and exists (
        select 1 from pg_catalog.unnest(p.proconfig) as setting
        where setting in ('search_path=""', 'search_path=')
      )
    from pg_catalog.pg_proc as p
    where p.oid = 'public.current_user_open_work_site_id()'::regprocedure),
  '02 - open-site helper is a hardened stable zero-argument definer'
);
select pg_temp.assert_true(
  pg_catalog.has_function_privilege(
    'authenticated', 'public.current_user_open_work_site_id()', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon', 'public.current_user_open_work_site_id()', 'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'service_role', 'public.current_user_open_work_site_id()', 'EXECUTE'
  ),
  '03 - only authenticated API callers can execute the helper'
);
select pg_temp.assert_true(
  exists (select 1 from pg_catalog.pg_policy
    where polrelid = 'public.sites'::regclass
      and polname = 'sites_select_own_open_session' and polcmd = 'r'),
  '04 - additional site access is a SELECT-only policy'
);

insert into auth.users (id, email)
select pg_temp.fixture_id(number), (410000 + number)::text || '@example.invalid'
from pg_catalog.generate_series(1, 7) as fixtures(number);

insert into public.profiles (id, badge_number, role, is_active)
select pg_temp.fixture_id(number), (410000 + number)::text,
  role::public.user_role, is_active
from (values
  (1, 'agent', true), (2, 'agent', true), (3, 'agent', false),
  (4, 'supervisor', true), (5, 'admin', true), (7, 'admin', false)
) as fixtures(number, role, is_active);

insert into public.sites (
  id, name, latitude, longitude, radius_m, is_active
)
select pg_temp.fixture_id(number), 'Open-session site fixture ' || number,
  45.5, -73.6, 150, number = 106
from pg_catalog.generate_series(101, 107) as fixtures(number);

insert into public.assignments (id, agent_id, site_id, is_active) values
  (pg_temp.fixture_id(201), pg_temp.fixture_id(1), pg_temp.fixture_id(101), true),
  (pg_temp.fixture_id(202), pg_temp.fixture_id(1), pg_temp.fixture_id(106), true),
  (pg_temp.fixture_id(203), pg_temp.fixture_id(2), pg_temp.fixture_id(102), true),
  (pg_temp.fixture_id(204), pg_temp.fixture_id(3), pg_temp.fixture_id(103), true);

-- A former agent can retain an open historical session after a role change.
insert into public.work_sessions (
  id, agent_id, site_id, check_in_at, check_out_at
) values
  (pg_temp.fixture_id(301), pg_temp.fixture_id(1), pg_temp.fixture_id(101),
    '2000-01-01', null),
  (pg_temp.fixture_id(302), pg_temp.fixture_id(1), pg_temp.fixture_id(104),
    '2000-01-01', '2000-01-02'),
  (pg_temp.fixture_id(303), pg_temp.fixture_id(2), pg_temp.fixture_id(102),
    '2000-01-01', null),
  (pg_temp.fixture_id(304), pg_temp.fixture_id(3), pg_temp.fixture_id(103),
    '2000-01-01', null),
  (pg_temp.fixture_id(305), pg_temp.fixture_id(4), pg_temp.fixture_id(107),
    '2000-01-01', null);

set local role anon;
select pg_temp.set_subject(null);
select pg_temp.expect_sqlstate(
  'select public.current_user_open_work_site_id()', '42501',
  '05 - anonymous callers cannot execute the helper'
);
select pg_temp.expect_sqlstate('select * from public.sites', '42501',
  '06 - anonymous callers cannot read site coordinates');

set local role authenticated;
select pg_temp.set_subject(null);
select pg_temp.assert_true(public.current_user_open_work_site_id() is null,
  '07 - a missing Auth subject has no open site');
select pg_temp.assert_true((select count(*) = 0 from public.sites),
  '08 - an authenticated database role without a subject sees no sites');

select pg_temp.set_subject(pg_temp.fixture_id(6));
select pg_temp.assert_true(public.current_user_open_work_site_id() is null,
  '09 - an unprovisioned user has no open-site access');
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(id = pg_temp.fixture_id(106))
    from public.sites where id between pg_temp.fixture_id(101)
      and pg_temp.fixture_id(107)),
  '10 - an unprovisioned user still sees active sites only'
);

select pg_temp.set_subject(pg_temp.fixture_id(3));
select pg_temp.assert_true(public.current_user_open_work_site_id() is null,
  '11 - an inactive agent has no helper result despite an open session');
select pg_temp.assert_true(
  (select count(*) = 0 from public.sites where id = pg_temp.fixture_id(103)),
  '12 - an inactive agent cannot read their own inactive open-session site'
);

select pg_temp.set_subject(pg_temp.fixture_id(7));
select pg_temp.assert_true(public.current_user_open_work_site_id() is null,
  '13 - an inactive administrator receives no open-site exception');
select pg_temp.assert_true(
  (select count(*) = 1 from public.sites where id between pg_temp.fixture_id(101)
    and pg_temp.fixture_id(107)),
  '14 - an inactive administrator still sees active sites only'
);

select pg_temp.set_subject(pg_temp.fixture_id(4));
select pg_temp.assert_true(public.current_user_open_work_site_id() is null,
  '15 - a supervisor receives no exception for a former-agent open session');
select pg_temp.assert_true(
  (select count(*) = 1 from public.sites where id between pg_temp.fixture_id(101)
    and pg_temp.fixture_id(107)),
  '16 - a supervisor receives no new inactive-site visibility'
);

select pg_temp.set_subject(pg_temp.fixture_id(5));
select pg_temp.assert_true(public.current_user_open_work_site_id() is null,
  '17 - the agent-specific helper returns nothing for an administrator');
select pg_temp.assert_true(
  (select count(*) = 7 from public.sites where id between pg_temp.fixture_id(101)
    and pg_temp.fixture_id(107)),
  '18 - existing active-administrator site visibility remains intact'
);

select pg_temp.set_subject(pg_temp.fixture_id(2));
select pg_temp.assert_true(
  public.current_user_open_work_site_id() = pg_temp.fixture_id(102),
  '19 - another active agent resolves only their own open site'
);
select pg_temp.assert_true(
  (select count(*) = 2 and bool_and(id in (pg_temp.fixture_id(102),
      pg_temp.fixture_id(106))) from public.sites
    where id between pg_temp.fixture_id(101) and pg_temp.fixture_id(107)),
  '20 - another agent sees their own open site and active sites only'
);

select pg_temp.set_subject(pg_temp.fixture_id(1));
select pg_temp.assert_true(
  public.current_user_open_work_site_id() = pg_temp.fixture_id(101),
  '21 - an active agent resolves their inactive open-session site'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.sites where id = pg_temp.fixture_id(101)),
  '22 - an active agent can read their own inactive open-session site'
);
select pg_temp.assert_true(
  (select count(*) = 0 from public.sites where id in (
    pg_temp.fixture_id(102), pg_temp.fixture_id(103), pg_temp.fixture_id(104),
    pg_temp.fixture_id(105), pg_temp.fixture_id(107))),
  '23 - other-agent, closed-session and unrelated inactive sites stay hidden'
);
select pg_temp.assert_true(
  (select count(*) = 1 from public.sites where id = pg_temp.fixture_id(106)),
  '24 - existing active-site access is unchanged'
);
select pg_temp.assert_true(
  (select latitude = 45.5 and longitude = -73.6 and radius_m = 150
    from public.sites where id = pg_temp.fixture_id(101)),
  '25 - checkout can load the inactive site coordinates and radius'
);
select pg_temp.assert_affected(
  'update public.work_sessions set check_out_at = now() where id = pg_temp.fixture_id(301)',
  1, '26 - an agent can close their own inactive-site session without recursion'
);
select pg_temp.assert_true(public.current_user_open_work_site_id() is null,
  '27 - the helper stops exposing a site after checkout');
select pg_temp.assert_true(
  (select count(*) = 0 from public.sites where id = pg_temp.fixture_id(101)),
  '28 - closing a session removes its inactive-site visibility'
);
select pg_temp.expect_sqlstate(
  'insert into public.work_sessions(agent_id, site_id) values(pg_temp.fixture_id(1), pg_temp.fixture_id(101))',
  '42501', '29 - inactive sites still cannot authorize a new check-in'
);
select pg_temp.assert_affected(
  'insert into public.work_sessions(agent_id, site_id) values(pg_temp.fixture_id(1), pg_temp.fixture_id(106))',
  1, '30 - normal assigned active-site check-in still succeeds without recursion'
);
select pg_temp.assert_true(
  public.current_user_open_work_site_id() = pg_temp.fixture_id(106),
  '31 - the helper resolves a newly created open session'
);
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(check_in_at = now() and check_out_at is null)
    from public.work_sessions where agent_id = pg_temp.fixture_id(1)
      and site_id = pg_temp.fixture_id(106)),
  '32 - new check-in timestamps and open-session state are preserved'
);

reset role;
update public.sites set is_active = false where id = pg_temp.fixture_id(106);
update public.assignments set is_active = false where id = pg_temp.fixture_id(202);
set local role authenticated;
select pg_temp.set_subject(pg_temp.fixture_id(1));
select pg_temp.assert_true(
  (select count(*) = 1 from public.sites where id = pg_temp.fixture_id(106)),
  '33 - site and assignment deactivation do not hide an ongoing session site'
);
select pg_temp.assert_true(
  public.current_user_open_work_site_id() = pg_temp.fixture_id(106),
  '34 - open-site lookup does not require a still-active assignment'
);

reset role;
update public.profiles set is_active = false where id = pg_temp.fixture_id(1);
set local role authenticated;
select pg_temp.set_subject(pg_temp.fixture_id(1));
select pg_temp.assert_true(public.current_user_open_work_site_id() is null,
  '35 - profile deactivation immediately removes the helper result');
select pg_temp.assert_true(
  (select count(*) = 0 from public.sites where id = pg_temp.fixture_id(106)),
  '36 - a deactivated profile loses inactive-site visibility'
);

reset role;
update public.profiles set is_active = true, role = 'supervisor'
where id = pg_temp.fixture_id(1);
set local role authenticated;
select pg_temp.set_subject(pg_temp.fixture_id(1));
select pg_temp.assert_true(public.current_user_open_work_site_id() is null,
  '37 - a role change immediately removes the agent-specific helper result');
select pg_temp.assert_true(
  (select count(*) = 0 from public.sites where id = pg_temp.fixture_id(106)),
  '38 - a promoted supervisor gains no inactive-site exception'
);

reset role;
update public.profiles set role = 'agent' where id = pg_temp.fixture_id(1);
set local role authenticated;
select pg_temp.set_subject(pg_temp.fixture_id(1));
select pg_temp.assert_true(
  public.current_user_open_work_site_id() = pg_temp.fixture_id(106),
  '39 - restoring an active agent profile restores its open-site access'
);
select pg_temp.assert_true(
  (select latitude = 45.5 and longitude = -73.6 and radius_m = 150
    from public.sites where id = pg_temp.fixture_id(106)),
  '40 - checkout can still read coordinates after site and assignment revocation'
);
select pg_temp.assert_affected(
  'update public.work_sessions set check_out_at = now() where agent_id = pg_temp.fixture_id(1) and check_out_at is null',
  1, '41 - closing after site and assignment revocation succeeds'
);
select pg_temp.assert_true(public.current_user_open_work_site_id() is null,
  '42 - no site remains exposed after the final checkout');
select pg_temp.assert_true(
  (select count(*) = 0 from public.sites
    where id between pg_temp.fixture_id(101) and pg_temp.fixture_id(107)),
  '43 - an agent with only closed sessions sees no inactive fixture site'
);
select pg_temp.expect_sqlstate(
  'insert into public.work_sessions(agent_id, site_id) values(pg_temp.fixture_id(1), pg_temp.fixture_id(106))',
  '42501', '44 - revoked site and assignment cannot authorize another check-in'
);

set local role service_role;
select pg_temp.set_subject(null);
select pg_temp.expect_sqlstate(
  'select public.current_user_open_work_site_id()', '42501',
  '45 - the helper does not add privileged-service execution grants'
);
select pg_temp.assert_true(
  (select count(*) = 7 from public.sites where id between pg_temp.fixture_id(101)
    and pg_temp.fixture_id(107)),
  '46 - existing trusted-service site reads remain intact'
);

reset role;
select pg_temp.assert_true(
  (select count(*) = 3 and bool_and(check_out_at is not null)
    from public.work_sessions where agent_id = pg_temp.fixture_id(1)),
  '47 - allowed checkouts preserve the full closed-session history'
);

select 'All 47 open-session site access checks passed; rolling back fixtures.'
  as result;
rollback;
