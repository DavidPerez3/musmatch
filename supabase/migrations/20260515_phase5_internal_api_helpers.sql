-- MusMatch Phase 5
-- Internal helper functions for backend/API automation testing.

create or replace function public._internal_set_actor(p_actor_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end;
$$;

drop function if exists public.internal_create_event(uuid, text, text, text, timestamptz, text, text);
create or replace function public.internal_create_event(
  p_actor_user_id uuid,
  p_title text,
  p_match_type text,
  p_pair_mode text,
  p_starts_at timestamptz,
  p_location_text text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  insert into public.events (
    created_by,
    title,
    match_type,
    pair_mode,
    starts_at,
    location_text,
    notes,
    status
  )
  values (
    p_actor_user_id,
    coalesce(nullif(trim(p_title), ''), 'Partida de mus'),
    p_match_type::public.match_type,
    p_pair_mode::public.pair_mode,
    p_starts_at,
    nullif(trim(p_location_text), ''),
    nullif(trim(p_notes), ''),
    'OPEN'
  )
  returning id into v_event_id;

  insert into public.event_participants (event_id, user_id, team)
  values (v_event_id, p_actor_user_id, 'A')
  on conflict (event_id, user_id) do nothing;

  perform public.refresh_event_status(v_event_id);
  perform public.recompute_match_confidence(v_event_id);

  return v_event_id;
end;
$$;

drop function if exists public.internal_add_participant(uuid, uuid, public.team_side);
create or replace function public.internal_add_participant(
  p_event_id uuid,
  p_user_id uuid,
  p_team public.team_side default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.event_participants (event_id, user_id, team)
  values (p_event_id, p_user_id, p_team)
  on conflict (event_id, user_id)
  do update set team = excluded.team;

  perform public.refresh_event_status(p_event_id);
  perform public.recompute_match_confidence(p_event_id);
end;
$$;

drop function if exists public.internal_create_presence_token(uuid, uuid);
create or replace function public.internal_create_presence_token(
  p_actor_user_id uuid,
  p_event_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._internal_set_actor(p_actor_user_id);
  return public.create_presence_token(p_event_id);
end;
$$;

drop function if exists public.internal_submit_presence_token(uuid, uuid, text);
create or replace function public.internal_submit_presence_token(
  p_actor_user_id uuid,
  p_event_id uuid,
  p_token text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._internal_set_actor(p_actor_user_id);
  return public.submit_presence_token(p_event_id, p_token);
end;
$$;

drop function if exists public.internal_submit_team_result(uuid, uuid, public.team_side, text);
create or replace function public.internal_submit_team_result(
  p_actor_user_id uuid,
  p_match_id uuid,
  p_winner_team public.team_side,
  p_result_score text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._internal_set_actor(p_actor_user_id);
  return public.submit_team_result(p_match_id, p_winner_team, p_result_score);
end;
$$;

drop function if exists public.internal_admin_resolve_dispute(uuid, uuid, public.team_side, boolean);
create or replace function public.internal_admin_resolve_dispute(
  p_admin_user_id uuid,
  p_match_id uuid,
  p_winner_team public.team_side,
  p_apply_elo boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._internal_set_actor(p_admin_user_id);
  perform public.admin_resolve_dispute(p_match_id, p_winner_team, p_apply_elo);
end;
$$;

drop function if exists public.internal_resolve_timeouts();
create or replace function public.internal_resolve_timeouts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.resolve_pending_results_by_timeout();
end;
$$;

drop function if exists public.internal_get_event(uuid);
create or replace function public.internal_get_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event jsonb;
begin
  select to_jsonb(e) into v_event
  from public.events e
  where e.id = p_event_id;
  return coalesce(v_event, '{}'::jsonb);
end;
$$;

-- Restrict internal helpers to service_role only.
revoke execute on function public._internal_set_actor(uuid) from public, anon, authenticated;
grant execute on function public._internal_set_actor(uuid) to service_role;

revoke execute on function public.internal_create_event(uuid, text, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.internal_create_event(uuid, text, text, text, timestamptz, text, text) to service_role;

revoke execute on function public.internal_add_participant(uuid, uuid, public.team_side) from public, anon, authenticated;
grant execute on function public.internal_add_participant(uuid, uuid, public.team_side) to service_role;

revoke execute on function public.internal_create_presence_token(uuid, uuid) from public, anon, authenticated;
grant execute on function public.internal_create_presence_token(uuid, uuid) to service_role;

revoke execute on function public.internal_submit_presence_token(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.internal_submit_presence_token(uuid, uuid, text) to service_role;

revoke execute on function public.internal_submit_team_result(uuid, uuid, public.team_side, text) from public, anon, authenticated;
grant execute on function public.internal_submit_team_result(uuid, uuid, public.team_side, text) to service_role;

revoke execute on function public.internal_admin_resolve_dispute(uuid, uuid, public.team_side, boolean) from public, anon, authenticated;
grant execute on function public.internal_admin_resolve_dispute(uuid, uuid, public.team_side, boolean) to service_role;

revoke execute on function public.internal_resolve_timeouts() from public, anon, authenticated;
grant execute on function public.internal_resolve_timeouts() to service_role;

revoke execute on function public.internal_get_event(uuid) from public, anon, authenticated;
grant execute on function public.internal_get_event(uuid) to service_role;
