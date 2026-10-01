-- MusMatch Phase 2b
-- Presence UX helpers + admin prioritization view.

drop function if exists public.create_presence_token(uuid);
create or replace function public.create_presence_token(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_event public.events%rowtype;
  v_team public.team_side;
  v_token text;
  v_existing public.event_presence_tokens%rowtype;
  v_cooldown interval := interval '30 seconds';
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_event
  from public.events
  where id = p_event_id;

  if v_event.id is null then
    raise exception 'Partida no encontrada';
  end if;

  if v_event.status in ('FINISHED', 'CANCELLED') then
    raise exception 'La partida ya esta cerrada';
  end if;

  select ep.team
  into v_team
  from public.event_participants ep
  where ep.event_id = p_event_id
    and ep.user_id = v_uid;

  if v_team is null then
    raise exception 'Solo participantes con equipo pueden generar codigo';
  end if;

  select *
  into v_existing
  from public.event_presence_tokens t
  where t.event_id = p_event_id
    and t.user_id = v_uid
    and t.consumed_at is null
    and t.expires_at > now()
  order by t.created_at desc
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'token', v_existing.token,
      'expires_at', v_existing.expires_at,
      'next_refresh_at', v_existing.created_at + v_cooldown,
      'reused', true
    );
  end if;

  loop
    v_token := public.generate_presence_code(6);
    exit when not exists (
      select 1
      from public.event_presence_tokens t
      where t.event_id = p_event_id
        and t.token = v_token
        and t.expires_at > now()
    );
  end loop;

  insert into public.event_presence_tokens (
    event_id,
    user_id,
    token,
    expires_at
  )
  values (
    p_event_id,
    v_uid,
    v_token,
    now() + interval '10 minutes'
  )
  returning * into v_existing;

  return jsonb_build_object(
    'token', v_existing.token,
    'expires_at', v_existing.expires_at,
    'next_refresh_at', v_existing.created_at + v_cooldown,
    'reused', false
  );
end;
$$;

drop function if exists public.get_my_presence_token_status(uuid);
create or replace function public.get_my_presence_token_status(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_token public.event_presence_tokens%rowtype;
  v_cooldown interval := interval '30 seconds';
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select *
  into v_token
  from public.event_presence_tokens t
  where t.event_id = p_event_id
    and t.user_id = v_uid
    and t.consumed_at is null
    and t.expires_at > now()
  order by t.created_at desc
  limit 1;

  if v_token.id is null then
    return jsonb_build_object(
      'token', null,
      'expires_at', null,
      'next_refresh_at', null
    );
  end if;

  return jsonb_build_object(
    'token', v_token.token,
    'expires_at', v_token.expires_at,
    'next_refresh_at', v_token.created_at + v_cooldown
  );
end;
$$;

drop view if exists public.admin_event_presence_overview;
create view public.admin_event_presence_overview as
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
) pr on pr.event_id = e.id;
