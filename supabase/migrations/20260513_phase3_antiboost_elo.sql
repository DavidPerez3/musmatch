-- MusMatch Phase 3 (Roadmap-aligned backend hardening)
-- Anti-boost ELO: reduce or nullify ELO impact when the same pairs repeat too often.

alter table public.events add column if not exists elo_multiplier numeric(5,2) not null default 1.00;
alter table public.events add column if not exists elo_base_delta integer;
alter table public.events add column if not exists elo_final_delta integer;
alter table public.events add column if not exists elo_antiboost_reason text;

drop function if exists public.apply_match_elo(uuid, public.team_side);
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
    elo_multiplier = v_multiplier,
    elo_base_delta = v_base_delta_a,
    elo_final_delta = v_final_delta_a,
    elo_antiboost_reason = v_reason
  where id = p_match_id;
end;
$$;
