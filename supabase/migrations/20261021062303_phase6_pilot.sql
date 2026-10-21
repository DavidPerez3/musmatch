-- Field pilot: opt-in real matches and private, user-submitted incident reports.
create table public.pilot_matches (
 event_id uuid primary key references public.events(id) on delete cascade,
 enrolled_by uuid not null references auth.users(id) on delete cascade,
 enrolled_at timestamptz not null default now()
);
create index pilot_matches_organizer on public.pilot_matches(enrolled_by,enrolled_at desc);
create table public.pilot_issues (
 id uuid primary key default gen_random_uuid(), reporter_id uuid not null references auth.users(id) on delete cascade,
 event_id uuid references public.events(id) on delete set null,
 category text not null check(category in ('ACCESS','PRESENCE','RESULTS','PUSH','LOCATION','OTHER')),
 severity text not null check(severity in ('BLOCKER','NORMAL','SUGGESTION')),
 title text not null check(length(trim(title)) between 5 and 120),
 steps text not null check(length(trim(steps)) between 10 and 1500),
 expected text not null check(length(trim(expected)) between 5 and 1000),
 actual text not null check(length(trim(actual)) between 5 and 1000),
 environment jsonb not null default '{}',
 status text not null default 'OPEN' check(status in ('OPEN','IN_PROGRESS','RESOLVED','DISMISSED')),
 review_note text, reviewer_id uuid references auth.users(id) on delete set null,
 revision integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index pilot_issues_owner on public.pilot_issues(reporter_id,created_at desc);
create index pilot_issues_event on public.pilot_issues(event_id);
create index pilot_issues_triage on public.pilot_issues(status,created_at desc);
alter table public.pilot_matches enable row level security;
alter table public.pilot_issues enable row level security;
revoke all on public.pilot_matches,public.pilot_issues from public,anon,authenticated;
grant select on public.pilot_matches,public.pilot_issues to authenticated;
grant all on public.pilot_matches,public.pilot_issues to service_role;
create policy pilot_match_read on public.pilot_matches for select to authenticated using(
 enrolled_by=(select auth.uid()) or exists(select 1 from public.event_participants ep where ep.event_id=pilot_matches.event_id and ep.user_id=(select auth.uid()))
 or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin));
create policy pilot_issue_read on public.pilot_issues for select to authenticated using(
 reporter_id=(select auth.uid()) or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin));

create function public.enroll_pilot_match(p_event_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype; begin
 select * into e from public.events where id=p_event_id for update;
 if auth.uid() is null or e.created_by is distinct from auth.uid() then raise exception 'Solo el organizador puede incorporar su partida al piloto'; end if;
 if e.simulation_owner_id is not null or exists(select 1 from public.event_participants ep join public.profiles p on p.id=ep.user_id where ep.event_id=e.id and p.is_mock)
 or not exists(select 1 from public.profiles where id=auth.uid() and not is_mock) then raise exception 'El piloto requiere cuentas reales. Usa el simulador para las pruebas con mocks'; end if;
 if e.rules_version<>1 or e.status='CANCELLED' then raise exception 'Selecciona una partida con reglas acordadas que no esté cancelada'; end if;
 insert into public.pilot_matches(event_id,enrolled_by) values(e.id,auth.uid()) on conflict(event_id) do nothing;
end $$;
-- The invoker's RLS must authorize the pilot row before any state is returned.
create function public.get_pilot_match_state(p_event_id uuid) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
 select jsonb_build_object(
 'event_id',e.id,'title',e.title,'starts_at',e.starts_at,'match_type',e.match_type,'status',e.status,'result_status',e.result_status,
 'enrolled_at',pm.enrolled_at,'rules_variant',e.rules_variant,'points_per_game',e.points_per_game,'games_to_win',e.games_to_win,'vacas_to_win',e.vacas_to_win,
 'report_a',e.result_team_a_submitted_at is not null,'report_b',e.result_team_b_submitted_at is not null,'winner_team',e.winner_team,'result_score',e.result_score,'elo_applied',e.elo_applied_at is not null,
 'players',coalesce((select jsonb_agg(jsonb_build_object('user_id',ep.user_id,'username',p.username,'team',ep.team,'checked_in',ep.attendance_status='CHECKED_IN','is_mock',p.is_mock) order by ep.team,ep.joined_at)
 from public.event_participants ep join public.profiles p on p.id=ep.user_id where ep.event_id=e.id),'[]'::jsonb))
 from public.pilot_matches pm join public.events e on e.id=pm.event_id where pm.event_id=p_event_id and e.simulation_owner_id is null;
$$;
create function public.report_pilot_issue(p_event_id uuid,p_category text,p_severity text,p_title text,p_steps text,p_expected text,p_actual text,p_environment jsonb default '{}') returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); iid uuid; begin
 if uid is null or not exists(select 1 from public.profiles where id=uid and not is_mock) then raise exception 'Inicia sesión con una cuenta real'; end if;
 if p_category is null or p_category not in ('ACCESS','PRESENCE','RESULTS','PUSH','LOCATION','OTHER') or p_severity is null or p_severity not in ('BLOCKER','NORMAL','SUGGESTION')
 or coalesce(length(trim(p_title)),0) not between 5 and 120 or coalesce(length(trim(p_steps)),0) not between 10 and 1500
 or coalesce(length(trim(p_expected)),0) not between 5 and 1000 or coalesce(length(trim(p_actual)),0) not between 5 and 1000 then raise exception 'Completa el título, los pasos, lo esperado y lo ocurrido dentro de los límites indicados'; end if;
 if jsonb_typeof(p_environment) is distinct from 'object' or exists(select 1 from jsonb_each(p_environment) x where
 (x.key='platform' and x.value#>>'{}' not in ('ANDROID','IOS','DESKTOP','OTHER')) or
 (x.key='browser' and x.value#>>'{}' not in ('CHROME','SAFARI','FIREFOX','EDGE','OTHER')) or
 (x.key='display' and x.value#>>'{}' not in ('APP','BROWSER')) or x.key not in ('platform','browser','display') or jsonb_typeof(x.value)<>'string') then raise exception 'Información de dispositivo no válida'; end if;
 if p_event_id is not null and not exists(select 1 from public.events e where e.id=p_event_id and e.simulation_owner_id is null and
 (e.created_by=uid or exists(select 1 from public.event_participants ep where ep.event_id=e.id and ep.user_id=uid) or exists(select 1 from public.match_invitations i where i.event_id=e.id and i.invitee_id=uid)))
 then raise exception 'Selecciona una partida propia o envía la incidencia sin asociar una partida'; end if;
 perform 1 from public.profiles where id=uid for update;
 select id into iid from public.pilot_issues where reporter_id=uid and event_id is not distinct from p_event_id and category=p_category and severity=p_severity and title=trim(p_title)
 and steps=trim(p_steps) and expected=trim(p_expected) and actual=trim(p_actual) and environment=p_environment and created_at>now()-interval '10 minutes' order by created_at desc limit 1;
 if iid is not null then return iid; end if;
 if (select count(*) from public.pilot_issues where reporter_id=uid and created_at>now()-interval '1 hour')>=5 then raise exception 'Has enviado cinco incidencias en la última hora. Espera antes de enviar más'; end if;
 insert into public.pilot_issues(reporter_id,event_id,category,severity,title,steps,expected,actual,environment)
 values(uid,p_event_id,p_category,p_severity,trim(p_title),trim(p_steps),trim(p_expected),trim(p_actual),p_environment) returning id into iid;
 return iid;
end $$;
create function public.review_pilot_issue(p_issue_id uuid,p_status text,p_note text,p_revision integer) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare issue public.pilot_issues%rowtype; begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_admin and not is_mock) then raise exception 'Solo administración'; end if;
 if p_status is null or p_status not in ('OPEN','IN_PROGRESS','RESOLVED','DISMISSED') or coalesce(length(trim(p_note)),0) not between 10 and 1000 then raise exception 'Selecciona estado y añade una nota de revisión de 10 a 1000 caracteres'; end if;
 select * into issue from public.pilot_issues where id=p_issue_id for update;
 if issue.id is null then raise exception 'Incidencia no disponible'; end if;
 if p_revision is distinct from issue.revision then raise exception 'La incidencia ha cambiado. Actualiza antes de revisarla'; end if;
 update public.pilot_issues set status=p_status,review_note=trim(p_note),reviewer_id=auth.uid(),updated_at=now(),revision=revision+1 where id=issue.id;
 perform public.log_audit_event('PILOT_ISSUE_REVIEWED','pilot_issue',issue.id,jsonb_build_object('from',issue.status,'to',p_status,'revision',issue.revision+1));
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('enroll_pilot_match','get_pilot_match_state','report_pilot_issue','review_pilot_issue') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to authenticated,service_role',f.sig);
 end loop;
end $$;
