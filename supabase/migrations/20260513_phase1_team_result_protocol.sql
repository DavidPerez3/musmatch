-- MusMatch Phase 1
-- Team-based result protocol to reduce admin manual workload.

alter table public.events add column if not exists result_team_a_winner public.team_side;
alter table public.events add column if not exists result_team_a_score text;
alter table public.events add column if not exists result_team_a_submitted_at timestamptz;
alter table public.events add column if not exists result_team_b_winner public.team_side;
alter table public.events add column if not exists result_team_b_score text;
alter table public.events add column if not exists result_team_b_submitted_at timestamptz;
alter table public.events add column if not exists result_resolution_reason text;

drop function if exists public.submit_team_result(uuid, public.team_side, text);
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
declare
  v_uid uuid;
  v_my_team public.team_side;
  v_event public.events%rowtype;
  v_status text;
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

  if v_event.status in ('FINISHED', 'CANCELLED') then
    raise exception 'La partida ya esta cerrada';
  end if;

  if v_my_team = 'A' then
    update public.events
    set
      result_team_a_winner = winner_team,
      result_team_a_score = nullif(trim(result_score), ''),
      result_team_a_submitted_at = now(),
      result_status = 'PENDING',
      status = 'CLOSED',
      result_proposed_by = v_uid
    where id = match_id;
  else
    update public.events
    set
      result_team_b_winner = winner_team,
      result_team_b_score = nullif(trim(result_score), ''),
      result_team_b_submitted_at = now(),
      result_status = 'PENDING',
      status = 'CLOSED',
      result_proposed_by = v_uid
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
        result_resolution_reason = 'AUTO_MATCHING_REPORTS'
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
