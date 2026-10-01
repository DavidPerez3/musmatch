-- MusMatch Phase 3b (Roadmap observability)
-- Structured audit logs for critical state/rating changes.

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action_type text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists audit_logs_created_at_idx on public.audit_logs(created_at desc);
create index if not exists audit_logs_action_idx on public.audit_logs(action_type);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_user_id);

create or replace function public.is_admin_uid(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_uid
      and p.is_admin = true
  );
$$;

create or replace function public.log_audit_event(
  p_action_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_user_id uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    actor_user_id,
    action_type,
    entity_type,
    entity_id,
    metadata
  )
  values (
    p_actor_user_id,
    p_action_type,
    p_entity_type,
    p_entity_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.trg_audit_events_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (old.status is distinct from new.status)
     or (old.result_status is distinct from new.result_status)
     or (old.winner_team is distinct from new.winner_team)
     or (old.result_score is distinct from new.result_score)
     or (old.elo_multiplier is distinct from new.elo_multiplier)
     or (old.elo_final_delta is distinct from new.elo_final_delta)
     or (old.result_resolution_reason is distinct from new.result_resolution_reason) then

    perform public.log_audit_event(
      'EVENT_STATE_CHANGED',
      'event',
      new.id,
      jsonb_build_object(
        'old_status', old.status,
        'new_status', new.status,
        'old_result_status', old.result_status,
        'new_result_status', new.result_status,
        'old_winner_team', old.winner_team,
        'new_winner_team', new.winner_team,
        'old_result_score', old.result_score,
        'new_result_score', new.result_score,
        'old_elo_multiplier', old.elo_multiplier,
        'new_elo_multiplier', new.elo_multiplier,
        'old_elo_final_delta', old.elo_final_delta,
        'new_elo_final_delta', new.elo_final_delta,
        'result_resolution_reason', new.result_resolution_reason
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_audit_events_update on public.events;
create trigger trg_audit_events_update
after update on public.events
for each row
execute function public.trg_audit_events_update();

create or replace function public.trg_audit_profiles_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elo_delta integer := coalesce(new.elo_rating, 0) - coalesce(old.elo_rating, 0);
  v_reliability_delta integer := coalesce(new.reliability_score, 0) - coalesce(old.reliability_score, 0);
begin
  if v_elo_delta <> 0 or v_reliability_delta <> 0 then
    perform public.log_audit_event(
      'PROFILE_SCORE_CHANGED',
      'profile',
      new.id,
      jsonb_build_object(
        'old_elo', old.elo_rating,
        'new_elo', new.elo_rating,
        'elo_delta', v_elo_delta,
        'old_reliability', old.reliability_score,
        'new_reliability', new.reliability_score,
        'reliability_delta', v_reliability_delta
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_audit_profiles_update on public.profiles;
create trigger trg_audit_profiles_update
after update on public.profiles
for each row
execute function public.trg_audit_profiles_update();

create or replace function public.trg_audit_presence_proof_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.log_audit_event(
    'PRESENCE_PROOF_CREATED',
    'event',
    new.event_id,
    jsonb_build_object(
      'from_user_id', new.from_user_id,
      'to_user_id', new.to_user_id,
      'proof_id', new.id
    )
  );

  return new;
end;
$$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and table_name = 'event_presence_proofs'
  ) then
    execute 'drop trigger if exists trg_audit_presence_proof_insert on public.event_presence_proofs';
    execute 'create trigger trg_audit_presence_proof_insert after insert on public.event_presence_proofs for each row execute function public.trg_audit_presence_proof_insert()';
  end if;
end $$;

alter table public.audit_logs enable row level security;

drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_admin
on public.audit_logs
for select
to authenticated
using (public.is_admin_uid(auth.uid()));
