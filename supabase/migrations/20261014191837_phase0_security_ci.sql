-- Phase 0: authenticated API allowlist, protected scores, immutable results and safe pilot timeouts.
-- No real users or matches are deleted. Existing confirmed ELO is preserved.
revoke create on schema public from public, anon, authenticated;

-- Replace legacy permissive write policies (including policies present only in the cloud).
do $$ declare p record; begin
  for p in select tablename, policyname from pg_policies
    where schemaname='public' and tablename in ('profiles','events','event_participants','friend_requests','friendships')
    and cmd in ('INSERT','UPDATE','DELETE','ALL')
  loop execute format('drop policy %I on public.%I',p.policyname,p.tablename); end loop;
end $$;

revoke insert,update,delete,truncate,references,trigger on public.profiles,public.events,public.event_participants,public.friend_requests,public.friendships from public,anon,authenticated;
-- Remove any old column grants before establishing the allowlist.
do $$ declare c record; begin
  for c in select table_name,column_name from information_schema.columns where table_schema='public'
    and table_name in ('profiles','events','event_participants','friend_requests','friendships')
  loop execute format('revoke insert (%I),update (%I),references (%I) on public.%I from public,anon,authenticated',c.column_name,c.column_name,c.column_name,c.table_name); end loop;
end $$;
grant update (username,full_name,avatar_url) on public.profiles to authenticated;
create policy profiles_update_own on public.profiles for update to authenticated
  using ((select auth.uid())=id) with check ((select auth.uid())=id);
-- Profiles are created by the Auth trigger, not by arbitrary browser inserts.
grant insert (event_id,user_id,team),update (team),delete on public.event_participants to authenticated;
create policy participants_insert_self on public.event_participants for insert to authenticated
  with check ((select auth.uid())=user_id);
create policy participants_update_self on public.event_participants for update to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy participants_delete_self on public.event_participants for delete to authenticated
  using ((select auth.uid())=user_id);

-- Lock the event row to serialize joins and enforce capacity even for direct API writes.
create or replace function public.guard_participant_change()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_event public.events%rowtype; v_count integer; begin
  select * into v_event from public.events where id=coalesce(new.event_id,old.event_id) for update;
  if v_event.id is null then return coalesce(new,old); end if;
  if v_event.status not in ('OPEN','FULL') and
    (tg_op in ('INSERT','DELETE') or (tg_op='UPDATE' and (old.team is distinct from new.team or old.event_id<>new.event_id or old.user_id<>new.user_id)))
    then raise exception 'La partida no admite cambios de jugadores'; end if;
  if tg_op='INSERT' then
    select count(*) into v_count from public.event_participants where event_id=new.event_id;
    if v_count>=4 then raise exception 'La partida esta completa'; end if;
  end if;
  if tg_op <> 'DELETE' and new.team is not null then
    select count(*) into v_count from public.event_participants
    where event_id=new.event_id and team=new.team and id<>new.id;
    if v_count>=2 then raise exception 'Equipo completo'; end if;
  end if;
  return coalesce(new,old);
end $$;
drop trigger if exists ab_guard_participant_change on public.event_participants;
create trigger ab_guard_participant_change before insert or update or delete on public.event_participants for each row execute function public.guard_participant_change();

-- Invalidate presence when a line-up changes, including a player leaving and rejoining.
create or replace function public.invalidate_changed_presence()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='DELETE' or (tg_op='UPDATE' and old.team is distinct from new.team) then
    delete from public.event_presence_tokens where event_id=old.event_id;
    delete from public.event_presence_proofs where event_id=old.event_id;
    perform public.recalculate_presence_for_event(old.event_id);
  end if;
  return coalesce(new,old);
end $$;
drop trigger if exists ac_invalidate_changed_presence on public.event_participants;
create trigger ac_invalidate_changed_presence after update of team or delete on public.event_participants for each row execute function public.invalidate_changed_presence();

alter view public.events_with_counts set (security_invoker=true);
alter view public.user_match_history set (security_invoker=true);
create or replace view public.admin_event_presence_overview with (security_invoker=true) as
select
  e.id as event_id,
  e.title,
  e.starts_at,
  e.status,
  e.result_status,
  e.match_type,
  coalesce(pc.players_count, 0) as players_count,
  coalesce(pc.checked_in_count, 0) as checked_in_count,
  coalesce(pr.proofs_count, 0) as proofs_count,
  greatest(0, 4 - coalesce(pc.checked_in_count, 0)) as pending_checkins
from public.events e
left join (
  select
    ep.event_id,
    count(*) filter (where ep.team is not null) as players_count,
    count(*) filter (where ep.team is not null and ep.attendance_status = 'CHECKED_IN') as checked_in_count
  from public.event_participants ep
  group by ep.event_id
) pc on pc.event_id = e.id
left join (
  select
    p.event_id,
    count(*) as proofs_count
  from public.event_presence_proofs p
  group by p.event_id
) pr on pr.event_id = e.id
where public.is_admin_uid(auth.uid());
revoke all on public.profiles,public.events,public.event_participants,public.friend_requests,public.friendships,public.event_presence_tokens,public.event_presence_proofs,public.audit_logs,public.events_with_counts,public.user_match_history,public.admin_event_presence_overview from anon;
revoke all on public.event_presence_tokens,public.event_presence_proofs from authenticated;
grant select on public.event_presence_proofs to authenticated;
create policy presence_proofs_select_admin on public.event_presence_proofs for select to authenticated
using (public.is_admin_uid((select auth.uid())));
grant select on public.profiles,public.events,public.event_participants,public.friend_requests,public.friendships,public.events_with_counts,public.user_match_history,public.audit_logs,public.admin_event_presence_overview to authenticated;

alter table public.events add column if not exists elo_applied_at timestamptz;
update public.events set elo_applied_at=coalesce(created_at,now())
where match_type='COMPETITIVE' and result_status='CONFIRMED' and status='FINISHED' and elo_applied_at is null;
create or replace function public.apply_match_elo(p_match_id uuid, p_winner public.team_side)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_a_avg float;
  v_team_b_avg float;
  v_expected_a float;
  v_base_delta_a integer;
  v_final_delta_a integer;
  v_k integer := 32;
  v_sig_a text;
  v_sig_b text;
  v_repeats integer := 0;
  v_multiplier numeric(5,2) := 1.00;
  v_reason text := null;
begin
  if p_winner is null then raise exception 'Falta ganador'; end if;
  perform 1 from public.events where id=p_match_id and match_type='COMPETITIVE' for update;
  if not found then raise exception 'Partida competitiva no encontrada'; end if;
  if exists(select 1 from public.events where id=p_match_id and elo_applied_at is not null) then return; end if;
  if (select count(*) from public.event_participants where event_id=p_match_id and team='A')<>2
    or (select count(*) from public.event_participants where event_id=p_match_id and team='B')<>2
    or (select count(*) from public.event_participants where event_id=p_match_id and attendance_status='CHECKED_IN')<>4
  then raise exception 'ELO requiere dos equipos completos y presencia validada'; end if;
  -- Team signatures (pair identity) for anti-boost checks
  select string_agg(ep.user_id::text, ',' order by ep.user_id::text)
  into v_sig_a
  from public.event_participants ep
  where ep.event_id = p_match_id and ep.team = 'A';

  select string_agg(ep.user_id::text, ',' order by ep.user_id::text)
  into v_sig_b
  from public.event_participants ep
  where ep.event_id = p_match_id and ep.team = 'B';

  if v_sig_a is null or v_sig_b is null then
    raise exception 'No hay equipos completos para calcular ELO';
  end if;

  -- Count repeated pair-vs-pair matches in the last 7 days (regardless of A/B side swap)
  with hist as (
    select
      e.id,
      (
        select string_agg(ep.user_id::text, ',' order by ep.user_id::text)
        from public.event_participants ep
        where ep.event_id = e.id and ep.team = 'A'
      ) as sig_a,
      (
        select string_agg(ep.user_id::text, ',' order by ep.user_id::text)
        from public.event_participants ep
        where ep.event_id = e.id and ep.team = 'B'
      ) as sig_b
    from public.events e
    where e.id <> p_match_id
      and e.match_type = 'COMPETITIVE'
      and e.result_status = 'CONFIRMED'
      and e.created_at >= now() - interval '7 days'
  )
  select count(*)::integer
  into v_repeats
  from hist
  where (sig_a = v_sig_a and sig_b = v_sig_b)
     or (sig_a = v_sig_b and sig_b = v_sig_a);

  -- Anti-boost multiplier policy
  if v_repeats >= 4 then
    v_multiplier := 0.00;
    v_reason := 'ANTI_BOOST_REPEAT_4_PLUS_LAST_7D';
  elsif v_repeats = 3 then
    v_multiplier := 0.25;
    v_reason := 'ANTI_BOOST_REPEAT_3_LAST_7D';
  elsif v_repeats = 2 then
    v_multiplier := 0.50;
    v_reason := 'ANTI_BOOST_REPEAT_2_LAST_7D';
  elsif v_repeats = 1 then
    v_multiplier := 0.75;
    v_reason := 'ANTI_BOOST_REPEAT_1_LAST_7D';
  end if;

  -- Base ELO computation
  select avg(p.elo_rating)::float into v_team_a_avg
  from public.event_participants ep
  join public.profiles p on p.id = ep.user_id
  where ep.event_id = p_match_id and ep.team = 'A';

  select avg(p.elo_rating)::float into v_team_b_avg
  from public.event_participants ep
  join public.profiles p on p.id = ep.user_id
  where ep.event_id = p_match_id and ep.team = 'B';

  if v_team_a_avg is null or v_team_b_avg is null then
    raise exception 'No hay dos equipos completos para calcular ELO';
  end if;

  v_expected_a := 1.0 / (1.0 + power(10, (v_team_b_avg - v_team_a_avg) / 400.0));

  if p_winner = 'A' then
    v_base_delta_a := round(v_k * (1.0 - v_expected_a));
  else
    v_base_delta_a := round(v_k * (0.0 - v_expected_a));
  end if;

  v_final_delta_a := round(v_base_delta_a * v_multiplier);

  -- Apply final delta
  update public.profiles
  set elo_rating = elo_rating + v_final_delta_a
  where id in (
    select user_id
    from public.event_participants
    where event_id = p_match_id and team = 'A'
  );

  update public.profiles
  set elo_rating = elo_rating - v_final_delta_a
  where id in (
    select user_id
    from public.event_participants
    where event_id = p_match_id and team = 'B'
  );

  -- Audit anti-boost metadata on event
  update public.events
  set
    elo_applied_at = now(),
    elo_multiplier = v_multiplier,
    elo_base_delta = v_base_delta_a,
    elo_final_delta = v_final_delta_a,
    elo_antiboost_reason = v_reason
  where id = p_match_id;
end;
$$;
create or replace function public.join_queue(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_pair_mode public.pair_mode;
  v_status text;
  v_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select pair_mode, status into v_pair_mode, v_status
  from public.events
  where id = p_event_id for update;

  if v_pair_mode is null then
    raise exception 'Partida no encontrada';
  end if;

  if v_pair_mode <> 'NEED_PARTNER' then
    raise exception 'Esta partida no usa cola de emparejamiento';
  end if;

  if v_status in ('CLOSED', 'FINISHED', 'CANCELLED') then
    raise exception 'La partida no admite mas jugadores';
  end if;

  select count(*)::integer into v_count
  from public.event_participants
  where event_id = p_event_id;

  if v_count >= 4 and not exists (
    select 1 from public.event_participants where event_id = p_event_id and user_id = v_uid
  ) then
    raise exception 'La partida esta completa';
  end if;

  insert into public.event_participants (event_id, user_id, team)
  values (p_event_id, v_uid, null)
  on conflict (event_id, user_id) do nothing;

  perform public.refresh_event_status(p_event_id);
end;
$$;
create or replace function public.assign_team(p_event_id uuid)
returns public.team_side
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair_mode public.pair_mode;
  v_target_id uuid;
  v_count_a integer;
  v_count_b integer;
  v_side public.team_side;
begin
  if auth.uid() is null or not exists(select 1 from public.event_participants where event_id=p_event_id and user_id=auth.uid()) then
    raise exception 'Solo participantes pueden asignar equipos'; end if;
  perform 1 from public.events where id=p_event_id and status in ('OPEN','FULL') for update;
  if not found then raise exception 'La partida no admite cambios de jugadores'; end if;
  select pair_mode into v_pair_mode
  from public.events
  where id = p_event_id;

  if v_pair_mode is null then
    raise exception 'Partida no encontrada';
  end if;

  if v_pair_mode <> 'NEED_PARTNER' then
    raise exception 'Esta partida no usa cola de emparejamiento';
  end if;

  select id into v_target_id
  from public.event_participants
  where event_id = p_event_id and team is null
  order by joined_at asc
  limit 1
  for update skip locked;

  if v_target_id is null then
    return null;
  end if;

  select count(*)::integer into v_count_a
  from public.event_participants
  where event_id = p_event_id and team = 'A';

  select count(*)::integer into v_count_b
  from public.event_participants
  where event_id = p_event_id and team = 'B';

  if v_count_a >= 2 and v_count_b >= 2 then
    return null;
  end if;

  if v_count_a <= v_count_b and v_count_a < 2 then
    v_side := 'A';
  elsif v_count_b < 2 then
    v_side := 'B';
  else
    v_side := 'A';
  end if;

  update public.event_participants
  set team = v_side
  where id = v_target_id;

  perform public.refresh_event_status(p_event_id);
  return v_side;
end;
$$;
create or replace function public.submit_team_result(
  match_id uuid,
  winner_team public.team_side,
  result_score text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  v_uid uuid;
  v_my_team public.team_side;
  v_event public.events%rowtype;
  v_status text;
  v_timeout interval := interval '12 hours';
  v_players integer;
  v_checked integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select ep.team
  into v_my_team
  from public.event_participants ep
  where ep.event_id = match_id
    and ep.user_id = v_uid;

  if v_my_team is null then
    raise exception 'Solo participantes con equipo pueden reportar';
  end if;

  select * into v_event
  from public.events
  where id = match_id
  for update;

  if v_event.id is null then
    raise exception 'Partida no encontrada';
  end if;

  if v_event.status in ('FINISHED', 'CANCELLED') or v_event.result_status='DISPUTED' then
    raise exception 'La partida ya esta cerrada';
  end if;

  if winner_team is null or nullif(trim(result_score),'') is null then raise exception 'Resultado incompleto'; end if;
  if (select count(*) from public.event_participants where event_id=match_id and team='A')<>2
    or (select count(*) from public.event_participants where event_id=match_id and team='B')<>2
  then raise exception 'Resultado requiere dos equipos completos'; end if;
  if (v_my_team='A' and v_event.result_team_a_submitted_at is not null)
    or (v_my_team='B' and v_event.result_team_b_submitted_at is not null)
  then raise exception 'Tu equipo ya reporto'; end if;
  if v_event.match_type = 'COMPETITIVE' then
    select count(*)::integer into v_players
    from public.event_participants ep
    where ep.event_id = match_id
      and ep.team is not null;

    select count(*)::integer into v_checked
    from public.event_participants ep
    where ep.event_id = match_id
      and ep.team is not null
      and ep.attendance_status = 'CHECKED_IN';

    if v_players < 4 or v_checked < 4 then
      raise exception 'Partida competitiva requiere 4 jugadores con presencia validada';
    end if;
  end if;

  if v_my_team = 'A' then
    update public.events
    set
      result_team_a_winner = winner_team,
      result_team_a_score = nullif(trim(result_score), ''),
      result_team_a_submitted_at = now(),
      winner_team = winner_team,
      result_score = nullif(trim(result_score), ''),
      result_proposed_by = v_uid,
      result_status = 'PENDING',
      status = 'CLOSED',
      result_pending_since = coalesce(result_pending_since, now()),
      result_pending_deadline = coalesce(result_pending_deadline, now() + v_timeout)
    where id = match_id;
  else
    update public.events
    set
      result_team_b_winner = winner_team,
      result_team_b_score = nullif(trim(result_score), ''),
      result_team_b_submitted_at = now(),
      winner_team = winner_team,
      result_score = nullif(trim(result_score), ''),
      result_proposed_by = v_uid,
      result_status = 'PENDING',
      status = 'CLOSED',
      result_pending_since = coalesce(result_pending_since, now()),
      result_pending_deadline = coalesce(result_pending_deadline, now() + v_timeout)
    where id = match_id;
  end if;

  select * into v_event
  from public.events
  where id = match_id
  for update;

  if v_event.result_team_a_submitted_at is not null
     and v_event.result_team_b_submitted_at is not null then

    if v_event.result_team_a_winner = v_event.result_team_b_winner
       and coalesce(v_event.result_team_a_score, '') = coalesce(v_event.result_team_b_score, '') then

      if v_event.match_type = 'COMPETITIVE' then
        perform public.apply_match_elo(match_id, v_event.result_team_a_winner);
      end if;

      update public.events
      set
        winner_team = v_event.result_team_a_winner,
        result_score = v_event.result_team_a_score,
        result_status = 'CONFIRMED',
        status = 'FINISHED',
        result_resolution_reason = 'AUTO_MATCHING_REPORTS',
        result_pending_since = null,
        result_pending_deadline = null
      where id = match_id;

      v_status := 'CONFIRMED_AUTO';
    else
      update public.events
      set
        result_status = 'DISPUTED',
        status = 'CLOSED',
        result_resolution_reason = 'MISMATCHED_TEAM_REPORTS'
      where id = match_id;

      v_status := 'DISPUTED_AUTO';
    end if;
  else
    v_status := 'PENDING_OTHER_TEAM';
  end if;

  return v_status;
end;
$$;
create or replace function public.confirm_match_and_update_elo(match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_event public.events%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_event
  from public.events
  where id = match_id
  for update;

  if v_event.id is null then
    raise exception 'Partida no encontrada';
  end if;

  if not exists (
    select 1 from public.event_participants
    where event_id = match_id and user_id = v_uid
  ) then
    raise exception 'Solo participantes pueden confirmar';
  end if;

  if v_event.result_team_a_submitted_at is not null or v_event.result_team_b_submitted_at is not null then
    raise exception 'Usa el reporte por equipos'; end if;
  if not exists(select 1 from public.event_participants mine join public.event_participants proposer
    on proposer.event_id=mine.event_id where mine.event_id=match_id and mine.user_id=v_uid
    and proposer.user_id=v_event.result_proposed_by and mine.team<>proposer.team) then
    raise exception 'Solo el equipo rival puede confirmar'; end if;
  if v_event.result_status <> 'PENDING' then
    raise exception 'No hay resultado pendiente para confirmar';
  end if;

  if v_event.result_proposed_by = v_uid then
    raise exception 'El mismo usuario no puede proponer y confirmar';
  end if;

  if v_event.winner_team is null then
    raise exception 'Resultado invalido: falta equipo ganador';
  end if;

  if v_event.match_type = 'COMPETITIVE' then
    perform public.apply_match_elo(match_id, v_event.winner_team);
  end if;

  update public.events
  set
    result_status = 'CONFIRMED',
    status = 'FINISHED'
  where id = match_id;
end;
$$;
create or replace function public.admin_resolve_dispute(
  match_id uuid,
  winner_team public.team_side,
  apply_elo boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_event public.events%rowtype;
  v_winner public.team_side;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_uid and is_admin = true
  ) then
    raise exception 'Solo admin';
  end if;

  select * into v_event
  from public.events
  where id = match_id
  for update;

  if v_event.id is null then
    raise exception 'Partida no encontrada';
  end if;

  if v_event.result_status is distinct from 'DISPUTED' or v_event.status in ('FINISHED','CANCELLED') then
    raise exception 'Solo se pueden resolver disputas abiertas'; end if;
  if winner_team is null then raise exception 'Falta ganador'; end if;
  v_winner := winner_team;

  if v_event.match_type = 'COMPETITIVE' and apply_elo then
    perform public.apply_match_elo(match_id, v_winner);
  end if;

  update public.events
  set
    winner_team = v_winner,
    result_status = 'CONFIRMED',
    result_proposed_by = v_uid,
    status = 'FINISHED'
  where id = match_id;
end;
$$;
-- Silence is evidence to review, not a victory or a no-show. No automatic rating penalty.
create or replace function public.resolve_pending_results_by_timeout()
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer; begin
  update public.events set result_status='DISPUTED',result_resolution_reason='TIMEOUT_REQUIRES_REVIEW',
    result_pending_since=null,result_pending_deadline=null
  where result_status='PENDING' and status='CLOSED' and result_pending_deadline<=now()
    and ((result_team_a_submitted_at is not null and result_team_b_submitted_at is null)
      or (result_team_b_submitted_at is not null and result_team_a_submitted_at is null));
  get diagnostics v_count=row_count; return v_count;
end $$;

create or replace function public.withdraw_legacy_result(p_event_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare e public.events%rowtype; begin
  select * into e from public.events where id=p_event_id for update;
  if auth.uid() is null or e.result_proposed_by is distinct from auth.uid()
    or e.result_status is distinct from 'PENDING' or e.result_team_a_submitted_at is not null or e.result_team_b_submitted_at is not null
    then raise exception 'No puedes retirar este resultado'; end if;
  update public.events set winner_team=null,result_score=null,result_proposed_by=null,result_status=null,
    result_pending_since=null,result_pending_deadline=null,status='FULL' where id=p_event_id;
end $$;

-- Explicit RPC allowlist. Trigger/internal helpers cannot be called through the browser.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature,p.proname,p.prosecdef from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and (p.prosecdef or p.proname='guard_direct_participant_state')
  loop
    execute format('revoke execute on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
    execute format('alter function %s set search_path = public, pg_temp',f.signature);
    if f.proname=any(array['create_match_with_partner','join_queue','assign_team','submit_team_result','confirm_match_and_update_elo','dispute_match','withdraw_legacy_result','create_presence_token','submit_presence_token','get_my_presence_token_status','send_friend_request','accept_friend_request','reject_friend_request','remove_friend','admin_adjust_user','admin_resolve_dispute','is_admin_uid']) then
      execute format('grant execute on function %s to authenticated',f.signature);
    end if;
  end loop;
  -- Cloud legacy trigger may not be present in fresh installs.
  if to_regprocedure('public.limit_team_size()') is not null then execute 'alter function public.limit_team_size() set search_path=public,pg_temp'; end if;
  alter function public.update_updated_at_column() set search_path=public,pg_temp;
end $$;
-- Future migrations must explicitly expose intended RPCs.
alter default privileges for role postgres in schema public revoke execute on functions from public,anon,authenticated;
notify pgrst,'reload schema';
