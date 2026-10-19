-- Simulator capabilities are provisioned by administration, never by usernames/JWT metadata.
create table public.simulation_operators (
 user_id uuid primary key references auth.users(id), enabled boolean not null default true
);
create table public.simulation_actors (
 user_id uuid primary key references auth.users(id),
 owner_id uuid not null references public.simulation_operators(user_id),
 slot smallint not null check(slot between 1 and 3), unique(owner_id,slot),check(user_id<>owner_id)
);
alter table public.simulation_operators enable row level security;
alter table public.simulation_actors enable row level security;
revoke all on public.simulation_operators,public.simulation_actors from public,anon,authenticated;
grant select on public.simulation_operators,public.simulation_actors to authenticated;
create policy operator_read on public.simulation_operators for select to authenticated using(user_id=(select auth.uid()));
create policy actor_read on public.simulation_actors for select to authenticated using(owner_id=(select auth.uid()));
alter table public.profiles add column is_mock boolean not null default false;
alter table public.events add column simulation_owner_id uuid references auth.users(id);
create index simulation_events_owner on public.events(simulation_owner_id,created_at desc) where simulation_owner_id is not null;
create table public.simulation_scores (
 event_id uuid not null references public.events(id) on delete cascade,
 user_id uuid not null references auth.users(id),
 rating_before integer not null, delta integer not null default 0,
 rating_after integer not null, applied_at timestamptz,
 primary key(event_id,user_id)
);
alter table public.simulation_scores enable row level security;
revoke all on public.simulation_scores from public,anon,authenticated;
grant select on public.simulation_scores to authenticated;
create policy simulation_scores_read on public.simulation_scores for select to authenticated using(
 exists(select 1 from public.events e where e.id=event_id and e.simulation_owner_id=(select auth.uid())));
-- Restrictive policies compose with the existing discovery policies instead of replacing them.
create policy simulation_event_visibility on public.events as restrictive for select to authenticated
 using(simulation_owner_id is null or simulation_owner_id=(select auth.uid()));
create policy simulation_roster_visibility on public.event_participants as restrictive for select to authenticated
 using(exists(select 1 from public.events e where e.id=event_id));

create function public.guard_simulation_identity() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.simulation_owner_id is distinct from old.simulation_owner_id then raise exception 'No se puede cambiar el aislamiento de una partida'; end if;
 return new;
end $$;
create trigger guard_simulation_identity before update on public.events for each row execute function public.guard_simulation_identity();

create function public.guard_simulation_roster() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype; candidate uuid; begin
 select * into e from public.events where id=coalesce(new.event_id,old.event_id) for update;
 candidate:=case when tg_op='DELETE' then old.user_id else new.user_id end;
 if e.simulation_owner_id is not null then
  if auth.uid() is distinct from e.simulation_owner_id and not exists(select 1 from public.simulation_actors where owner_id=e.simulation_owner_id and user_id=auth.uid()) then raise exception 'Mesa de simulación privada'; end if;
  if candidate<>e.simulation_owner_id and not exists(select 1 from public.simulation_actors where owner_id=e.simulation_owner_id and user_id=candidate) then raise exception 'Solo se admiten los mocks registrados'; end if;
 elsif tg_op<>'DELETE' and exists(select 1 from public.profiles where id=candidate and is_mock) then
  raise exception 'Los mocks solo pueden incorporarse a mesas de simulación';
 end if;
 return coalesce(new,old);
end $$;
create trigger aa_simulation_roster before insert or update or delete on public.event_participants for each row execute function public.guard_simulation_roster();

create function public.guard_simulation_invitation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.events where id=new.event_id and simulation_owner_id is not null) then raise exception 'Usa los controles del simulador para los mocks'; end if;
 return new;
end $$;
create trigger guard_simulation_invitation before insert or update on public.match_invitations for each row execute function public.guard_simulation_invitation();

create or replace function public.apply_match_elo_live(p_match_id uuid, p_winner public.team_side)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
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
    where e.simulation_owner_id is null and e.id <> p_match_id
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

create or replace view public.events_with_counts with (security_invoker=true) as
select
  e.id,
  e.created_by,
  e.title,
  e.description,
  e.location_type,
  e.location_text,
  e.starts_at,
  e.notes,
  e.match_type,
  e.pair_mode,
  e.status,
  e.winner_team,
  e.result_score,
  e.result_proposed_by,
  e.result_status,
  e.created_at,
  (
    select count(*)::integer
    from public.event_participants p
    where p.event_id = e.id
  ) as players_count,
  e.rules_version,e.rules_variant,e.points_per_game,e.games_to_win,e.vacas_to_win,e.house_rules
from public.events e where e.simulation_owner_id is null;


create or replace function public.apply_match_elo(p_match_id uuid,p_winner public.team_side)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype; a float; b float; expected float; change integer;
begin
 select * into e from public.events where id=p_match_id for update;
 if e.simulation_owner_id is null then perform public.apply_match_elo_live(p_match_id,p_winner); return; end if;
 if p_winner is null then raise exception 'Falta ganador'; end if;
 if (select count(*) from public.event_participants where event_id=p_match_id and team='A')<>2
 or (select count(*) from public.event_participants where event_id=p_match_id and team='B')<>2
 or (select count(*) from public.event_participants where event_id=p_match_id and attendance_status='CHECKED_IN')<>4
 then raise exception 'ELO requiere dos equipos completos y presencia validada'; end if;
 if exists(select 1 from public.simulation_scores where event_id=p_match_id and applied_at is not null) then return; end if;
 select avg(s.rating_before) filter(where ep.team='A'),avg(s.rating_before) filter(where ep.team='B') into a,b
 from public.simulation_scores s join public.event_participants ep on ep.event_id=s.event_id and ep.user_id=s.user_id where s.event_id=p_match_id;
 if a is null or b is null then raise exception 'Falta el estado inicial de simulación'; end if;
 expected:=1.0/(1.0+power(10,(b-a)/400.0));
 change:=round(32*((case when p_winner='A' then 1.0 else 0.0 end)-expected));
 update public.simulation_scores s set delta=case when ep.team='A' then change else -change end,
 rating_after=rating_before+case when ep.team='A' then change else -change end,applied_at=now()
 from public.event_participants ep where s.event_id=p_match_id and ep.event_id=s.event_id and ep.user_id=s.user_id;
 -- No profiles/real ELO fields are written. This is a standalone base-ELO preview.
end $$;

create function public.create_simulation(p_variant text default 'EIGHT_KINGS',p_points integer default 40,p_games integer default 3,p_vacas integer default 1)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid:=auth.uid(); eid uuid; bot record;
begin
 perform 1 from public.simulation_operators where user_id=v_owner and enabled for update;
 if not found then raise exception 'Simulador no habilitado para esta cuenta'; end if;
 if (select count(*) from public.simulation_actors a join public.profiles p on p.id=a.user_id where a.owner_id=v_owner and p.is_mock)<>3 then raise exception 'Se requieren tres mocks registrados'; end if;
 insert into public.events(created_by,title,starts_at,location_text,notes,match_type,pair_mode,rules_version,rules_variant,points_per_game,games_to_win,vacas_to_win,simulation_owner_id)
 values(v_owner,'SIMULACIÓN · Mesa de mus',now()+interval '1 hour','Mesa virtual de pruebas','Partida privada de prueba. El ELO real no cambia.','COMPETITIVE','FIXED_PAIR',1,p_variant,p_points,p_games,p_vacas,v_owner) returning id into eid;
 insert into public.event_participants(event_id,user_id,team) values(eid,v_owner,'A');
 for bot in select * from public.simulation_actors where owner_id=v_owner order by slot loop
  insert into public.event_participants(event_id,user_id,team) values(eid,bot.user_id,(case when bot.slot=1 then 'A' else 'B' end)::public.team_side);
 end loop;
 insert into public.simulation_scores(event_id,user_id,rating_before,rating_after)
 select eid,p.id,p.elo_rating,p.elo_rating from public.event_participants ep join public.profiles p on p.id=ep.user_id where ep.event_id=eid;
 perform public.refresh_event_status(eid);
 return eid;
end $$;

create function public.simulate_player_action(p_event_id uuid,p_slot integer,p_action text,p_token text default null,p_winner public.team_side default null,p_score text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare original_actor uuid:=auth.uid(); e public.events%rowtype; bot uuid; response jsonb; status text;
begin
 select * into e from public.events where id=p_event_id for update;
 if original_actor is null or e.simulation_owner_id is distinct from original_actor or not exists(select 1 from public.simulation_operators where user_id=original_actor and enabled) then raise exception 'Solo puedes controlar tus mesas de simulación'; end if;
 select user_id into bot from public.simulation_actors where owner_id=original_actor and slot=p_slot;
 if bot is null or not exists(select 1 from public.profiles where id=bot and is_mock) then raise exception 'Mock no registrado'; end if;
 perform set_config('request.jwt.claim.sub',bot::text,true);
 case p_action
 when 'GENERATE_TOKEN' then response:=public.create_presence_token(p_event_id);
 when 'SCAN_TOKEN' then response:=jsonb_build_object('status',public.submit_presence_token(p_event_id,p_token));
 when 'REPORT' then response:=jsonb_build_object('status',public.submit_team_result(p_event_id,p_winner,p_score));
 when 'LEAVE' then
  delete from public.event_participants where event_id=p_event_id and user_id=bot;
  response:=jsonb_build_object('status','LEFT');
 when 'JOIN' then
  insert into public.event_participants(event_id,user_id,team) values(p_event_id,bot,(case when p_slot=1 then 'A' else 'B' end)::public.team_side);
  response:=jsonb_build_object('status','JOINED');
 else raise exception 'Acción de simulación no admitida';
 end case;
 perform set_config('request.jwt.claim.sub',original_actor::text,true);
 return response;
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(original_actor::text,''),true);raise;
end $$;

create function public.expire_simulation_result(p_event_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype; begin
 select * into e from public.events where id=p_event_id for update;
 if auth.uid() is null or e.simulation_owner_id is distinct from auth.uid() or not exists(select 1 from public.simulation_operators where user_id=auth.uid() and enabled) then raise exception 'Solo puedes controlar tus mesas de simulación'; end if;
 if e.result_status is distinct from 'PENDING' or e.status<>'CLOSED' then raise exception 'Publica primero un único reporte de equipo'; end if;
 update public.events set result_status='DISPUTED',result_resolution_reason='TIMEOUT_REQUIRES_REVIEW',result_pending_since=null,result_pending_deadline=null where id=p_event_id;
end $$;

create function public.get_simulation_state(p_event_id uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype; v_owner uuid:=auth.uid(); players jsonb; ledger jsonb;
begin
 select * into e from public.events where id=p_event_id;
 if v_owner is null or e.simulation_owner_id is distinct from v_owner or not exists(select 1 from public.simulation_operators where user_id=v_owner and enabled) then raise exception 'Mesa de simulación no disponible'; end if;
 select jsonb_agg(jsonb_build_object('user_id',p.id,'username',p.username,'slot',a.slot,'team',coalesce(ep.team,(case when a.slot=1 or a.slot is null then 'A' else 'B' end)::public.team_side),
 'present',ep.id is not null,'attendance_status',ep.attendance_status,'token',case when t.expires_at>now() and t.consumed_at is null then t.token end,'expires_at',t.expires_at,'next_refresh_at',t.created_at+interval '30 seconds') order by coalesce(a.slot,0)) into players
 from public.profiles p left join public.simulation_actors a on a.user_id=p.id and a.owner_id=v_owner
 left join public.event_participants ep on ep.user_id=p.id and ep.event_id=p_event_id
 left join lateral(select * from public.event_presence_tokens t where t.event_id=p_event_id and t.user_id=p.id order by t.created_at desc,t.id desc limit 1)t on true
 where p.id=v_owner or a.owner_id=v_owner;
 select jsonb_agg(to_jsonb(s) order by s.rating_after desc,s.user_id) into ledger from public.simulation_scores s where s.event_id=p_event_id;
 return jsonb_build_object('can_review',exists(select 1 from public.profiles where id=v_owner and is_admin),'event',to_jsonb(e),'players',players,'scores',coalesce(ledger,'[]'::jsonb),'proofs_count',(select count(*) from public.event_presence_proofs where event_id=p_event_id));
end $$;

-- Test games never enter regular history, matchmaking or anti-boost calculations.
create or replace view public.user_match_history with(security_invoker=true) as
select ep.user_id,e.id as match_id,e.title,e.winner_team,e.result_score,e.created_at,ep.team,
 case when e.status='CANCELLED' then 'CANCELLED' when e.result_status is distinct from 'CONFIRMED' then 'PENDING'
 when e.winner_team=ep.team then 'WON' else 'LOST' end as result
from public.event_participants ep join public.events e on e.id=ep.event_id where e.simulation_owner_id is null;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('apply_match_elo_live','apply_match_elo','guard_simulation_identity','guard_simulation_roster','guard_simulation_invitation','create_simulation','simulate_player_action','expire_simulation_result','get_simulation_state') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 if f.proname in ('create_simulation','simulate_player_action','expire_simulation_result','get_simulation_state') then execute format('grant execute on function %s to authenticated,service_role',f.sig); end if;
 end loop;
end $$;
notify pgrst,'reload schema';
-- Convenience scenario uses exactly the same four token generations and validations.
create function public.simulate_all_presence(p_event_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare original_actor uuid:=auth.uid(); e public.events%rowtype; actors uuid[]; codes text[]:='{}'; i integer; target integer; answer text;
begin
 select * into e from public.events where id=p_event_id for update;
 if original_actor is null or e.simulation_owner_id is distinct from original_actor or not exists(select 1 from public.simulation_operators where user_id=original_actor and enabled) then raise exception 'Solo puedes controlar tus mesas de simulación'; end if;
 if exists(select 1 from public.event_presence_proofs where event_id=p_event_id) then raise exception 'Esta mesa ya tiene validaciones: completa los pasos manuales o crea otra prueba'; end if;
 actors:=array[original_actor]||array(select user_id from public.simulation_actors where owner_id=original_actor order by slot);
 if array_length(actors,1)<>4 or (select count(*) from public.event_participants where event_id=p_event_id and user_id=any(actors))<>4 then raise exception 'Faltan jugadores registrados'; end if;
 for i in 1..4 loop
  perform set_config('request.jwt.claim.sub',actors[i]::text,true);
  codes:=array_append(codes,public.create_presence_token(p_event_id)->>'token');
 end loop;
 for i in 1..4 loop
  target:=case i when 1 then 3 when 3 then 1 when 2 then 4 else 2 end;
  perform set_config('request.jwt.claim.sub',actors[i]::text,true);
  answer:=public.submit_presence_token(p_event_id,codes[target]);
  if answer<>'PROOF_ACCEPTED' then raise exception 'No se pudo completar el intercambio: %',answer; end if;
 end loop;
 perform set_config('request.jwt.claim.sub',original_actor::text,true);
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(original_actor::text,''),true);raise;
end $$;
revoke all on function public.simulate_all_presence(uuid) from public,anon,authenticated;
grant execute on function public.simulate_all_presence(uuid) to authenticated,service_role;
