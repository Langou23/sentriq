begin;

-- A direct sites policy reading work_sessions recurses during check-in policy
-- evaluation. Expose only the current active agent's single open-session site.
create function public.current_user_open_work_site_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select session.site_id
  from public.work_sessions as session
  join public.profiles as profile on profile.id = session.agent_id
  where session.agent_id = (select auth.uid())
    and session.check_out_at is null
    and profile.role = 'agent'::public.user_role
    and profile.is_active;
$$;

alter function public.current_user_open_work_site_id() owner to postgres;
revoke all on function public.current_user_open_work_site_id()
  from public, anon, authenticated, service_role;
grant execute on function public.current_user_open_work_site_id()
  to authenticated;

create policy sites_select_own_open_session
on public.sites for select to authenticated
using (id = (select public.current_user_open_work_site_id()));

commit;
