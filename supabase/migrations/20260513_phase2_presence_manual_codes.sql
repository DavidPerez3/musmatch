-- MusMatch Phase 2
-- Manual cross-presence codes (QR-ready backend) for localhost and desktop testing.

create table if not exists public.event_presence_tokens (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_by uuid references auth.users(id) on delete set null,
  consumed_at timestamptz
);

create unique index if not exists event_presence_tokens_event_token_unique
on public.event_presence_tokens(event_id, token);

create index if not exists event_presence_tokens_event_user_idx
on public.event_presence_tokens(event_id, user_id);

create table if not exists public.event_presence_proofs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(event_id, from_user_id, to_user_id),
  check (from_user_id <> to_user_id)
);

create index if not exists event_presence_proofs_event_idx
on public.event_presence_proofs(event_id);

create index if not exists event_presence_proofs_from_idx
on public.event_presence_proofs(from_user_id);

create index if not exists event_presence_proofs_to_idx
on public.event_presence_proofs(to_user_id);

create or replace function public.generate_presence_code(p_len integer default 6)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_result text := '';
  i integer;
begin
  if p_len < 4 then
    p_len := 4;
  end if;

  for i in 1..p_len loop
    v_result := v_result || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
  end loop;

  return v_result;
end;
$$;

create or replace function public.recalculate_presence_for_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.event_participants ep
  set
    attendance_status =
      case
        when ep.team is null then 'PENDING'
        when exists (
          select 1
          from public.event_presence_proofs pr
          join public.event_participants ep_to
            on ep_to.event_id = pr.event_id
           and ep_to.user_id = pr.to_user_id
          where pr.event_id = ep.event_id
            and pr.from_user_id = ep.user_id
            and ep_to.team is not null
            and ep_to.team <> ep.team
        )
        and exists (
          select 1
          from public.event_presence_proofs pr
          join public.event_participants ep_from
            on ep_from.event_id = pr.event_id
           and ep_from.user_id = pr.from_user_id
          where pr.event_id = ep.event_id
            and pr.to_user_id = ep.user_id
            and ep_from.team is not null
            and ep_from.team <> ep.team
        )
        then 'CHECKED_IN'
        else 'PENDING'
      end,
    checked_in_at =
      case
        when
          exists (
            select 1
            from public.event_presence_proofs pr
            join public.event_participants ep_to
              on ep_to.event_id = pr.event_id
             and ep_to.user_id = pr.to_user_id
            where pr.event_id = ep.event_id
              and pr.from_user_id = ep.user_id
              and ep_to.team is not null
              and ep_to.team <> ep.team
          )
          and exists (
            select 1
            from public.event_presence_proofs pr
            join public.event_participants ep_from
              on ep_from.event_id = pr.event_id
             and ep_from.user_id = pr.from_user_id
            where pr.event_id = ep.event_id
              and pr.to_user_id = ep.user_id
              and ep_from.team is not null
              and ep_from.team <> ep.team
          )
        then coalesce(ep.checked_in_at, now())
        else null
      end
  where ep.event_id = p_event_id;
end;
$$;

drop function if exists public.create_presence_token(uuid);
create or replace function public.create_presence_token(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_event public.events%rowtype;
  v_team public.team_side;
  v_token text;
  v_existing text;
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

  select token into v_existing
  from public.event_presence_tokens t
  where t.event_id = p_event_id
    and t.user_id = v_uid
    and t.consumed_at is null
    and t.expires_at > now()
  order by t.created_at desc
  limit 1;

  if v_existing is not null then
    return v_existing;
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
  );

  return v_token;
end;
$$;

drop function if exists public.submit_presence_token(uuid, text);
create or replace function public.submit_presence_token(
  p_event_id uuid,
  p_token text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_event public.events%rowtype;
  v_from_team public.team_side;
  v_to_team public.team_side;
  v_token_row public.event_presence_tokens%rowtype;
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
  into v_from_team
  from public.event_participants ep
  where ep.event_id = p_event_id
    and ep.user_id = v_uid;

  if v_from_team is null then
    raise exception 'Solo participantes con equipo pueden validar codigo';
  end if;

  select *
  into v_token_row
  from public.event_presence_tokens t
  where t.event_id = p_event_id
    and upper(t.token) = upper(trim(p_token))
  order by t.created_at desc
  limit 1
  for update;

  if v_token_row.id is null then
    return 'TOKEN_NOT_FOUND';
  end if;

  if v_token_row.user_id = v_uid then
    return 'TOKEN_OWN_USER';
  end if;

  if v_token_row.expires_at <= now() then
    return 'TOKEN_EXPIRED';
  end if;

  if v_token_row.consumed_at is not null then
    return 'TOKEN_ALREADY_USED';
  end if;

  select ep.team
  into v_to_team
  from public.event_participants ep
  where ep.event_id = p_event_id
    and ep.user_id = v_token_row.user_id;

  if v_to_team is null then
    return 'TOKEN_OWNER_NOT_ACTIVE';
  end if;

  if v_from_team = v_to_team then
    return 'TOKEN_SAME_TEAM';
  end if;

  insert into public.event_presence_proofs (
    event_id,
    from_user_id,
    to_user_id
  )
  values (
    p_event_id,
    v_uid,
    v_token_row.user_id
  )
  on conflict (event_id, from_user_id, to_user_id) do nothing;

  update public.event_presence_tokens
  set
    consumed_by = v_uid,
    consumed_at = now()
  where id = v_token_row.id
    and consumed_at is null;

  perform public.recalculate_presence_for_event(p_event_id);

  return 'PROOF_ACCEPTED';
end;
$$;

-- Enforce presence for competitive result submission.
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

  if v_event.status in ('FINISHED', 'CANCELLED') then
    raise exception 'La partida ya esta cerrada';
  end if;

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

alter table public.event_presence_tokens enable row level security;
alter table public.event_presence_proofs enable row level security;

drop policy if exists event_presence_tokens_select_none on public.event_presence_tokens;
create policy event_presence_tokens_select_none
on public.event_presence_tokens
for select
to authenticated
using (false);

drop policy if exists event_presence_tokens_insert_none on public.event_presence_tokens;
create policy event_presence_tokens_insert_none
on public.event_presence_tokens
for insert
to authenticated
with check (false);

drop policy if exists event_presence_tokens_update_none on public.event_presence_tokens;
create policy event_presence_tokens_update_none
on public.event_presence_tokens
for update
to authenticated
using (false)
with check (false);

drop policy if exists event_presence_proofs_select_none on public.event_presence_proofs;
create policy event_presence_proofs_select_none
on public.event_presence_proofs
for select
to authenticated
using (false);

drop policy if exists event_presence_proofs_insert_none on public.event_presence_proofs;
create policy event_presence_proofs_insert_none
on public.event_presence_proofs
for insert
to authenticated
with check (false);
