-- MusMatch Phase 1c
-- Reliability penalties for non-response, including friendly matches.

drop function if exists public.resolve_pending_results_by_timeout();
create or replace function public.resolve_pending_results_by_timeout()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
  v_resolved integer := 0;
  v_winner public.team_side;
  v_score text;
  v_non_reporting_team public.team_side;
  v_reliability_penalty integer := 6;
begin
  for v_event in
    select e.*
    from public.events e
    where e.result_status = 'PENDING'
      and e.status = 'CLOSED'
      and e.result_pending_deadline is not null
      and e.result_pending_deadline <= now()
      and (
        (e.result_team_a_submitted_at is not null and e.result_team_b_submitted_at is null)
        or
        (e.result_team_b_submitted_at is not null and e.result_team_a_submitted_at is null)
      )
    for update
  loop
    if v_event.result_team_a_submitted_at is not null then
      v_winner := v_event.result_team_a_winner;
      v_score := v_event.result_team_a_score;
      v_non_reporting_team := 'B';
    else
      v_winner := v_event.result_team_b_winner;
      v_score := v_event.result_team_b_score;
      v_non_reporting_team := 'A';
    end if;

    -- Friendly matches do not modify ELO, but non-response still affects reliability.
    if v_winner is not null and v_event.match_type = 'COMPETITIVE' then
      perform public.apply_match_elo(v_event.id, v_winner);
    end if;

    update public.profiles p
    set reliability_score = greatest(0, p.reliability_score - v_reliability_penalty)
    where p.id in (
      select ep.user_id
      from public.event_participants ep
      where ep.event_id = v_event.id
        and ep.team = v_non_reporting_team
    );

    update public.events
    set
      winner_team = v_winner,
      result_score = v_score,
      result_status = 'CONFIRMED',
      status = 'FINISHED',
      result_resolution_reason = 'AUTO_TIMEOUT_NO_RESPONSE',
      result_pending_since = null,
      result_pending_deadline = null
    where id = v_event.id;

    v_resolved := v_resolved + 1;
  end loop;

  return v_resolved;
end;
$$;
