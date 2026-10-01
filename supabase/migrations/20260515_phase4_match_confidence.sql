-- MusMatch Phase 4 (Roadmap Fase 2)
-- Match confidence scoring (0-100) based on presence, proofs, reliability and result state.

alter table public.events add column if not exists match_confidence_score integer not null default 0;
alter table public.events add column if not exists match_confidence_breakdown jsonb not null default '{}'::jsonb;

drop function if exists public.recompute_match_confidence(uuid);
create or replace function public.recompute_match_confidence(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_players integer := 0;
  v_checked integer := 0;
  v_proofs integer := 0;
  v_presence_ratio numeric := 0;
  v_proof_ratio numeric := 0;
  v_reliability_avg numeric := 100;
  v_reliability_factor numeric := 1;
  v_result_component numeric := 0;
  v_presence_component numeric := 0;
  v_proof_component numeric := 0;
  v_reliability_component numeric := 0;
  v_score numeric := 0;
begin
  select * into v_event
  from public.events
  where id = p_event_id;

  if v_event.id is null then
    return;
  end if;

  select count(*)::integer
  into v_players
  from public.event_participants ep
  where ep.event_id = p_event_id
    and ep.team is not null;

  select count(*)::integer
  into v_checked
  from public.event_participants ep
  where ep.event_id = p_event_id
    and ep.team is not null
    and ep.attendance_status = 'CHECKED_IN';

  if v_players > 0 then
    v_presence_ratio := least(1, greatest(0, v_checked::numeric / v_players::numeric));
  else
    v_presence_ratio := 0;
  end if;

  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and table_name = 'event_presence_proofs'
  ) then
    select count(*)::integer
    into v_proofs
    from public.event_presence_proofs pr
    where pr.event_id = p_event_id;
  else
    v_proofs := 0;
  end if;

  if v_players > 0 then
    -- Expected lower bound: roughly one cross-proof per player.
    v_proof_ratio := least(1, greatest(0, v_proofs::numeric / v_players::numeric));
  else
    v_proof_ratio := 0;
  end if;

  select coalesce(avg(p.reliability_score), 100)
  into v_reliability_avg
  from public.event_participants ep
  join public.profiles p on p.id = ep.user_id
  where ep.event_id = p_event_id
    and ep.team is not null;

  v_reliability_factor := least(1, greatest(0, v_reliability_avg / 100.0));

  if v_event.result_status = 'DISPUTED' then
    v_result_component := 0;
  elsif v_event.result_status = 'CONFIRMED' then
    v_result_component := 20;
  elsif v_event.result_status = 'PENDING' then
    if v_event.result_team_a_submitted_at is not null
       and v_event.result_team_b_submitted_at is not null then
      v_result_component := 12;
    elsif v_event.result_team_a_submitted_at is not null
       or v_event.result_team_b_submitted_at is not null then
      v_result_component := 6;
    else
      v_result_component := 3;
    end if;
  else
    v_result_component := 5;
  end if;

  v_presence_component := 45 * v_presence_ratio;
  v_proof_component := 20 * v_proof_ratio;
  v_reliability_component := 15 * v_reliability_factor;

  v_score := v_presence_component + v_proof_component + v_reliability_component + v_result_component;
  v_score := least(100, greatest(0, v_score));

  update public.events
  set
    match_confidence_score = round(v_score),
    match_confidence_breakdown = jsonb_build_object(
      'presence_ratio', round(v_presence_ratio::numeric, 4),
      'proof_ratio', round(v_proof_ratio::numeric, 4),
      'reliability_avg', round(v_reliability_avg::numeric, 2),
      'presence_component', round(v_presence_component::numeric, 2),
      'proof_component', round(v_proof_component::numeric, 2),
      'reliability_component', round(v_reliability_component::numeric, 2),
      'result_component', round(v_result_component::numeric, 2),
      'result_status', v_event.result_status
    )
  where id = p_event_id;
end;
$$;

create or replace function public.trg_recompute_match_confidence_from_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_match_confidence(coalesce(new.event_id, old.event_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_recompute_confidence_participants_insert on public.event_participants;
create trigger trg_recompute_confidence_participants_insert
after insert on public.event_participants
for each row
execute function public.trg_recompute_match_confidence_from_participants();

drop trigger if exists trg_recompute_confidence_participants_update on public.event_participants;
create trigger trg_recompute_confidence_participants_update
after update on public.event_participants
for each row
execute function public.trg_recompute_match_confidence_from_participants();

drop trigger if exists trg_recompute_confidence_participants_delete on public.event_participants;
create trigger trg_recompute_confidence_participants_delete
after delete on public.event_participants
for each row
execute function public.trg_recompute_match_confidence_from_participants();

create or replace function public.trg_recompute_match_confidence_from_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.result_status is distinct from new.result_status)
     or (old.status is distinct from new.status)
     or (old.result_team_a_submitted_at is distinct from new.result_team_a_submitted_at)
     or (old.result_team_b_submitted_at is distinct from new.result_team_b_submitted_at)
     or (old.match_type is distinct from new.match_type) then
    perform public.recompute_match_confidence(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_recompute_confidence_events_update on public.events;
create trigger trg_recompute_confidence_events_update
after update on public.events
for each row
execute function public.trg_recompute_match_confidence_from_events();

create or replace function public.trg_recompute_match_confidence_from_profiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event record;
begin
  if old.reliability_score is distinct from new.reliability_score then
    for v_event in
      select distinct ep.event_id
      from public.event_participants ep
      where ep.user_id = new.id
    loop
      perform public.recompute_match_confidence(v_event.event_id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_recompute_confidence_profiles_update on public.profiles;
create trigger trg_recompute_confidence_profiles_update
after update on public.profiles
for each row
execute function public.trg_recompute_match_confidence_from_profiles();

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and table_name = 'event_presence_proofs'
  ) then
    execute '
      create or replace function public.trg_recompute_match_confidence_from_presence()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      begin
        perform public.recompute_match_confidence(new.event_id);
        return new;
      end;
      $fn$';

    execute 'drop trigger if exists trg_recompute_confidence_presence_insert on public.event_presence_proofs';
    execute 'create trigger trg_recompute_confidence_presence_insert after insert on public.event_presence_proofs for each row execute function public.trg_recompute_match_confidence_from_presence()';
  end if;
end $$;

-- Backfill current events
do $$
declare
  r record;
begin
  for r in select id from public.events loop
    perform public.recompute_match_confidence(r.id);
  end loop;
end $$;
