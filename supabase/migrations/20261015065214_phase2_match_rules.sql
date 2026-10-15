-- Legacy rows retain unknown rules; do not infer a contract for existing games.
alter table public.events
 add column rules_version smallint not null default 0,
 add column rules_variant text,
 add column points_per_game smallint,
 add column games_to_win smallint,
 add column vacas_to_win smallint,
 add column house_rules text;
alter table public.events add constraint events_rules_contract check (
 (rules_version=0 and rules_variant is null and points_per_game is null and games_to_win is null and vacas_to_win is null and house_rules is null)
 or (rules_version=1 and rules_variant is not null and rules_variant in ('FOUR_KINGS','EIGHT_KINGS')
 and points_per_game is not null and points_per_game in (30,40)
 and games_to_win is not null and games_to_win between 1 and 4
 and vacas_to_win is not null and vacas_to_win between 1 and 3
 and coalesce(length(house_rules),0)<=1000));
create or replace function public.create_match_with_rules(
  p_title text,
  p_location_text text,
  p_starts_at timestamptz,
  p_notes text,
  p_match_type text,
  p_pair_mode text,
  p_partner_id uuid,
  p_rules_variant text,
  p_points_per_game integer,
  p_games_to_win integer,
  p_vacas_to_win integer,
  p_house_rules text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_creator_id uuid;
  v_match_type public.match_type;
  v_pair_mode public.pair_mode;
begin
  v_creator_id := auth.uid();
  if v_creator_id is null then
    raise exception 'No autenticado';
  end if;

  if p_rules_variant is null or p_rules_variant not in ('FOUR_KINGS','EIGHT_KINGS')
    or p_points_per_game is null or p_points_per_game not in (30,40)
    or p_games_to_win is null or p_games_to_win not between 1 and 4
    or p_vacas_to_win is null or p_vacas_to_win not between 1 and 3
    or coalesce(length(p_house_rules),0)>1000 then raise exception 'Reglas o formato no válidos'; end if;
  if p_starts_at is null or p_match_type is null or p_pair_mode is null then raise exception 'Datos de partida incompletos'; end if;
  if p_partner_id=v_creator_id then raise exception 'El compañero debe ser otra persona'; end if;
  v_match_type := p_match_type::public.match_type;
  v_pair_mode := p_pair_mode::public.pair_mode;

  if v_pair_mode = 'FIXED_PAIR' and p_partner_id is null then
    raise exception 'Debes seleccionar pareja para FIXED_PAIR';
  end if;

  if v_pair_mode = 'FIXED_PAIR' and p_partner_id is not null then
    if not exists (
      select 1
      from public.friendships
      where user_id = v_creator_id and friend_id = p_partner_id
    ) then
      raise exception 'El usuario seleccionado no es tu amigo';
    end if;
  end if;

  insert into public.events (
    created_by,
    title,
    location_text,
    starts_at,
    notes,
    match_type,
    pair_mode,
    status, rules_version, rules_variant, points_per_game, games_to_win, vacas_to_win, house_rules
  )
  values (
    v_creator_id,
    coalesce(nullif(trim(p_title), ''), 'Partida de mus'),
    nullif(trim(p_location_text), ''),
    p_starts_at,
    nullif(trim(p_notes), ''),
    v_match_type,
    v_pair_mode,
    'OPEN', 1, p_rules_variant, p_points_per_game, p_games_to_win, p_vacas_to_win, nullif(trim(p_house_rules),'')
  )
  returning id into v_event_id;

  insert into public.event_participants (event_id, user_id, team)
  values (v_event_id, v_creator_id, 'A');

  if v_pair_mode = 'FIXED_PAIR' and p_partner_id is not null then
    insert into public.event_participants (event_id, user_id, team)
    values (v_event_id, p_partner_id, 'A')
    on conflict (event_id, user_id) do nothing;
  end if;

  perform public.refresh_event_status(v_event_id);
  return v_event_id;
end;
$$;

-- Old browser versions must reload rather than silently create unspecified rules.
create or replace function public.create_match_with_partner(p_title text,p_location_text text,p_starts_at timestamptz,p_notes text,p_match_type text,p_pair_mode text,p_partner_id uuid)
returns uuid language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Actualiza la aplicación para elegir las reglas de la partida'; end; $$;

create function public.guard_match_rules() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare r record; a integer; b integer; target integer;
begin
 if tg_op='UPDATE' and row(new.rules_version,new.rules_variant,new.points_per_game,new.games_to_win,new.vacas_to_win,new.house_rules,new.match_type)
   is distinct from row(old.rules_version,old.rules_variant,old.points_per_game,old.games_to_win,old.vacas_to_win,old.house_rules,old.match_type)
 then raise exception 'Las reglas y el tipo de partida quedan fijados al crearla'; end if;
 if new.rules_version=1 then
  target:=case when new.vacas_to_win=1 then new.games_to_win else new.vacas_to_win end;
  for r in select * from (values (new.result_team_a_score,new.result_team_a_winner::text),(new.result_team_b_score,new.result_team_b_winner::text)) as reports(score,winner) loop
   if r.score is null then continue; end if;
   if r.score !~ '^[0-4]-[0-4]$' then raise exception 'Marcador inválido: usa equipo A-equipo B'; end if;
   a:=split_part(r.score,'-',1)::integer; b:=split_part(r.score,'-',2)::integer;
   if not coalesce((r.winner='A' and a=target and b<target) or (r.winner='B' and b=target and a<target),false)
    then raise exception 'El marcador y el ganador no coinciden con el formato acordado'; end if;
  end loop;
  -- Resolution keeps the score from the report matching the chosen winner.
  if new.result_status='CONFIRMED' then
   if new.result_team_a_winner=new.winner_team and new.result_team_a_score is not null then new.result_score:=new.result_team_a_score;
   elsif new.result_team_b_winner=new.winner_team and new.result_team_b_score is not null then new.result_score:=new.result_team_b_score;
   else raise exception 'No hay un reporte válido para ese ganador'; end if;
  end if;
 end if;
 return new;
end; $$;
create trigger guard_match_rules before insert or update on public.events for each row execute function public.guard_match_rules();
revoke all on function public.guard_match_rules() from public,anon,authenticated;
revoke all on function public.create_match_with_rules(text,text,timestamptz,text,text,text,uuid,text,integer,integer,integer,text) from public,anon;
grant execute on function public.create_match_with_rules(text,text,timestamptz,text,text,text,uuid,text,integer,integer,integer,text) to authenticated,service_role;
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
from public.events e;


notify pgrst, 'reload schema';
