-- MusMatch Phase 0
-- Align schema + RPC contracts with frontend usage

create extension if not exists pgcrypto;
create extension if not exists citext;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'team_side') then
    create type public.team_side as enum ('A', 'B');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'match_type') then
    create type public.match_type as enum ('FRIENDLY', 'COMPETITIVE');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pair_mode') then
    create type public.pair_mode as enum ('FIXED_PAIR', 'NEED_PARTNER');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'result_status') then
    create type public.result_status as enum ('PENDING', 'CONFIRMED', 'DISPUTED');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  full_name text,
  avatar_url text,
  elo_rating integer not null default 1000,
  reliability_score integer not null default 100,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists elo_rating integer not null default 1000;
alter table public.profiles add column if not exists reliability_score integer not null default 100;
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from (
      select lower(username) as uname, count(*) as c
      from public.profiles
      where username is not null
      group by lower(username)
      having count(*) > 1
    ) d
  ) then
    create unique index if not exists profiles_username_lower_unique
    on public.profiles ((lower(username)))
    where username is not null;
  end if;
end $$;

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  location_type text not null default 'PUBLIC_VENUE',
  location_text text,
  starts_at timestamptz not null,
  notes text,
  match_type public.match_type not null default 'FRIENDLY',
  pair_mode public.pair_mode not null default 'NEED_PARTNER',
  status text not null default 'OPEN',
  winner_team public.team_side,
  result_score text,
  result_proposed_by uuid references auth.users(id),
  result_status public.result_status,
  created_at timestamptz not null default now()
);

alter table public.events add column if not exists title text;
alter table public.events add column if not exists description text;
alter table public.events add column if not exists location_type text not null default 'PUBLIC_VENUE';
alter table public.events add column if not exists location_text text;
alter table public.events add column if not exists starts_at timestamptz;
alter table public.events add column if not exists notes text;
alter table public.events add column if not exists match_type public.match_type;
alter table public.events add column if not exists pair_mode public.pair_mode;
alter table public.events add column if not exists status text;
alter table public.events add column if not exists winner_team public.team_side;
alter table public.events add column if not exists result_score text;
alter table public.events add column if not exists result_proposed_by uuid references auth.users(id);
alter table public.events add column if not exists result_status public.result_status;
alter table public.events add column if not exists created_at timestamptz not null default now();

alter table public.events drop constraint if exists events_location_type_check;
alter table public.events
  add constraint events_location_type_check
  check (location_type in ('PUBLIC_VENUE', 'PRIVATE_LOCATION'))
  not valid;
alter table public.events validate constraint events_location_type_check;

alter table public.events drop constraint if exists events_status_check;
alter table public.events
  add constraint events_status_check
  check (status in ('OPEN', 'FULL', 'CLOSED', 'FINISHED', 'CANCELLED'))
  not valid;
alter table public.events validate constraint events_status_check;

-- Backfill from old schema mode if it existed
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'events'
      and column_name = 'mode'
  ) then
    update public.events
    set
      match_type = coalesce(match_type, case when mode::text = 'PAIRS' then 'COMPETITIVE'::public.match_type else 'FRIENDLY'::public.match_type end),
      pair_mode = coalesce(pair_mode, case when mode::text = 'PAIRS' then 'FIXED_PAIR'::public.pair_mode else 'NEED_PARTNER'::public.pair_mode end);
  end if;
end $$;

update public.events set match_type = 'FRIENDLY' where match_type is null;
update public.events set pair_mode = 'NEED_PARTNER' where pair_mode is null;
update public.events set status = 'OPEN' where status is null;
update public.events set starts_at = coalesce(starts_at, now()) where starts_at is null;

alter table public.events alter column title set not null;
alter table public.events alter column starts_at set not null;
alter table public.events alter column match_type set not null;
alter table public.events alter column pair_mode set not null;
alter table public.events alter column status set not null;

create index if not exists events_starts_at_idx on public.events (starts_at asc);
create index if not exists events_status_idx on public.events (status);

create table if not exists public.event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  team public.team_side,
  attendance_status text not null default 'PENDING',
  checked_in_at timestamptz,
  joined_at timestamptz not null default now(),
  unique(event_id, user_id)
);

alter table public.event_participants add column if not exists team public.team_side;
alter table public.event_participants add column if not exists attendance_status text not null default 'PENDING';
alter table public.event_participants add column if not exists checked_in_at timestamptz;
alter table public.event_participants add column if not exists joined_at timestamptz not null default now();

alter table public.event_participants drop constraint if exists event_participants_attendance_check;
alter table public.event_participants
  add constraint event_participants_attendance_check
  check (attendance_status in ('PENDING', 'CHECKED_IN', 'NO_SHOW', 'CANCELLED_EARLY', 'CANCELLED_LATE'))
  not valid;
alter table public.event_participants validate constraint event_participants_attendance_check;

create index if not exists event_participants_event_idx on public.event_participants (event_id);
create index if not exists event_participants_user_idx on public.event_participants (user_id);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_user_id <> to_user_id),
  check (status in ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'))
);

create unique index if not exists friend_requests_unique_pending
on public.friend_requests(from_user_id, to_user_id)
where status = 'PENDING';

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_id <> friend_id),
  unique(user_id, friend_id)
);

create index if not exists friendships_user_idx on public.friendships (user_id);

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_friend_requests_updated_at on public.friend_requests;
create trigger trg_friend_requests_updated_at
before update on public.friend_requests
for each row
execute function public.update_updated_at_column();

drop view if exists public.events_with_counts;
create view public.events_with_counts as
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
  ) as players_count
from public.events e;

drop view if exists public.user_match_history;
create view public.user_match_history as
select
  ep.user_id,
  e.id as match_id,
  e.title,
  e.winner_team,
  e.result_score,
  e.created_at,
  ep.team,
  case
    when e.result_status <> 'CONFIRMED' then 'PENDING'
    when e.winner_team = ep.team then 'WON'
    else 'LOST'
  end as result
from public.event_participants ep
join public.events e on e.id = ep.event_id;

create or replace function public.ensure_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, nullif(new.raw_user_meta_data ->> 'username', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row
execute function public.ensure_profile_for_new_user();

create or replace function public.refresh_event_status(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.event_participants
  where event_id = p_event_id;

  update public.events
  set status = case when v_count >= 4 then 'FULL' else 'OPEN' end
  where id = p_event_id
    and status in ('OPEN', 'FULL');
end;
$$;

create or replace function public.trg_refresh_event_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_event_status(coalesce(new.event_id, old.event_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists event_participants_refresh_status_insert on public.event_participants;
create trigger event_participants_refresh_status_insert
after insert on public.event_participants
for each row
execute function public.trg_refresh_event_status();

drop trigger if exists event_participants_refresh_status_update on public.event_participants;
create trigger event_participants_refresh_status_update
after update of team on public.event_participants
for each row
execute function public.trg_refresh_event_status();

drop trigger if exists event_participants_refresh_status_delete on public.event_participants;
create trigger event_participants_refresh_status_delete
after delete on public.event_participants
for each row
execute function public.trg_refresh_event_status();

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
  v_delta_a integer;
  v_k integer := 32;
begin
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
    v_delta_a := round(v_k * (1.0 - v_expected_a));
  else
    v_delta_a := round(v_k * (0.0 - v_expected_a));
  end if;

  update public.profiles
  set elo_rating = elo_rating + v_delta_a
  where id in (
    select user_id
    from public.event_participants
    where event_id = p_match_id and team = 'A'
  );

  update public.profiles
  set elo_rating = elo_rating - v_delta_a
  where id in (
    select user_id
    from public.event_participants
    where event_id = p_match_id and team = 'B'
  );
end;
$$;

drop function if exists public.create_match_with_partner(text, text, timestamptz, text, text, text, uuid);
create or replace function public.create_match_with_partner(
  p_title text,
  p_location_text text,
  p_starts_at timestamptz,
  p_notes text,
  p_match_type text,
  p_pair_mode text,
  p_partner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
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
    status
  )
  values (
    v_creator_id,
    coalesce(nullif(trim(p_title), ''), 'Partida de mus'),
    nullif(trim(p_location_text), ''),
    p_starts_at,
    nullif(trim(p_notes), ''),
    v_match_type,
    v_pair_mode,
    'OPEN'
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

drop function if exists public.join_queue(uuid);
create or replace function public.join_queue(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_pair_mode public.pair_mode;
  v_status text;
  v_count integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select pair_mode, status into v_pair_mode, v_status
  from public.events
  where id = p_event_id;

  if v_pair_mode is null then
    raise exception 'Partida no encontrada';
  end if;

  if v_pair_mode <> 'NEED_PARTNER' then
    raise exception 'Esta partida no usa cola de emparejamiento';
  end if;

  if v_status in ('CLOSED', 'FINISHED', 'CANCELLED') then
    raise exception 'La partida no admite mas jugadores';
  end if;

  select count(*)::integer into v_count
  from public.event_participants
  where event_id = p_event_id;

  if v_count >= 4 and not exists (
    select 1 from public.event_participants where event_id = p_event_id and user_id = v_uid
  ) then
    raise exception 'La partida esta completa';
  end if;

  insert into public.event_participants (event_id, user_id, team)
  values (p_event_id, v_uid, null)
  on conflict (event_id, user_id) do nothing;

  perform public.refresh_event_status(p_event_id);
end;
$$;

drop function if exists public.assign_team(uuid);
create or replace function public.assign_team(p_event_id uuid)
returns public.team_side
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pair_mode public.pair_mode;
  v_target_id uuid;
  v_count_a integer;
  v_count_b integer;
  v_side public.team_side;
begin
  select pair_mode into v_pair_mode
  from public.events
  where id = p_event_id;

  if v_pair_mode is null then
    raise exception 'Partida no encontrada';
  end if;

  if v_pair_mode <> 'NEED_PARTNER' then
    raise exception 'Esta partida no usa cola de emparejamiento';
  end if;

  select id into v_target_id
  from public.event_participants
  where event_id = p_event_id and team is null
  order by joined_at asc
  limit 1
  for update skip locked;

  if v_target_id is null then
    return null;
  end if;

  select count(*)::integer into v_count_a
  from public.event_participants
  where event_id = p_event_id and team = 'A';

  select count(*)::integer into v_count_b
  from public.event_participants
  where event_id = p_event_id and team = 'B';

  if v_count_a >= 2 and v_count_b >= 2 then
    return null;
  end if;

  if v_count_a <= v_count_b and v_count_a < 2 then
    v_side := 'A';
  elsif v_count_b < 2 then
    v_side := 'B';
  else
    v_side := 'A';
  end if;

  update public.event_participants
  set team = v_side
  where id = v_target_id;

  perform public.refresh_event_status(p_event_id);
  return v_side;
end;
$$;

drop function if exists public.confirm_match_and_update_elo(uuid, public.team_side);
drop function if exists public.confirm_match_and_update_elo(uuid);
create or replace function public.confirm_match_and_update_elo(match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_event public.events%rowtype;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  select * into v_event
  from public.events
  where id = match_id
  for update;

  if v_event.id is null then
    raise exception 'Partida no encontrada';
  end if;

  if not exists (
    select 1 from public.event_participants
    where event_id = match_id and user_id = v_uid
  ) then
    raise exception 'Solo participantes pueden confirmar';
  end if;

  if v_event.result_status <> 'PENDING' then
    raise exception 'No hay resultado pendiente para confirmar';
  end if;

  if v_event.result_proposed_by = v_uid then
    raise exception 'El mismo usuario no puede proponer y confirmar';
  end if;

  if v_event.winner_team is null then
    raise exception 'Resultado invalido: falta equipo ganador';
  end if;

  if v_event.match_type = 'COMPETITIVE' then
    perform public.apply_match_elo(match_id, v_event.winner_team);
  end if;

  update public.events
  set
    result_status = 'CONFIRMED',
    status = 'FINISHED'
  where id = match_id;
end;
$$;

drop function if exists public.dispute_match(uuid);
create or replace function public.dispute_match(match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  if not exists (
    select 1
    from public.event_participants
    where event_id = match_id and user_id = v_uid
  ) then
    raise exception 'Solo participantes pueden disputar';
  end if;

  update public.events
  set
    result_status = 'DISPUTED',
    status = 'CLOSED'
  where id = match_id
    and result_status = 'PENDING';

  if not found then
    raise exception 'No hay resultado pendiente para disputar';
  end if;
end;
$$;

drop function if exists public.send_friend_request(uuid);
create or replace function public.send_friend_request(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  if target_user_id is null or target_user_id = v_uid then
    raise exception 'Objetivo invalido';
  end if;

  if exists (
    select 1
    from public.friendships
    where user_id = v_uid and friend_id = target_user_id
  ) then
    raise exception 'Ya sois amigos';
  end if;

  if exists (
    select 1
    from public.friend_requests
    where (
      from_user_id = v_uid and to_user_id = target_user_id
    ) or (
      from_user_id = target_user_id and to_user_id = v_uid
    )
    and status = 'PENDING'
  ) then
    raise exception 'Ya existe una solicitud pendiente';
  end if;

  insert into public.friend_requests (from_user_id, to_user_id, status)
  values (v_uid, target_user_id, 'PENDING');
end;
$$;

drop function if exists public.accept_friend_request(uuid);
create or replace function public.accept_friend_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_from uuid;
  v_to uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  update public.friend_requests
  set status = 'ACCEPTED'
  where id = request_id
    and to_user_id = v_uid
    and status = 'PENDING'
  returning from_user_id, to_user_id
  into v_from, v_to;

  if v_from is null then
    raise exception 'Solicitud no encontrada o ya procesada';
  end if;

  insert into public.friendships (user_id, friend_id)
  values (v_from, v_to), (v_to, v_from)
  on conflict (user_id, friend_id) do nothing;
end;
$$;

drop function if exists public.reject_friend_request(uuid);
create or replace function public.reject_friend_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  update public.friend_requests
  set status = 'REJECTED'
  where id = request_id
    and to_user_id = v_uid
    and status = 'PENDING';

  if not found then
    raise exception 'Solicitud no encontrada o ya procesada';
  end if;
end;
$$;

drop function if exists public.remove_friend(uuid);
create or replace function public.remove_friend(target_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  delete from public.friendships
  where (user_id = v_uid and friend_id = target_friend_id)
     or (user_id = target_friend_id and friend_id = v_uid);
end;
$$;

drop function if exists public.admin_adjust_user(uuid, integer, integer);
create or replace function public.admin_adjust_user(
  target_user_id uuid,
  elo_delta integer,
  reliability_delta integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_uid and is_admin = true
  ) then
    raise exception 'Solo admin';
  end if;

  update public.profiles
  set
    elo_rating = greatest(0, elo_rating + coalesce(elo_delta, 0)),
    reliability_score = greatest(0, reliability_score + coalesce(reliability_delta, 0))
  where id = target_user_id;

  if not found then
    raise exception 'Usuario no encontrado';
  end if;
end;
$$;

drop function if exists public.admin_resolve_dispute(uuid, public.team_side, boolean);
drop function if exists public.admin_resolve_dispute(uuid, text, boolean);
create or replace function public.admin_resolve_dispute(
  match_id uuid,
  winner_team public.team_side,
  apply_elo boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_event public.events%rowtype;
  v_winner public.team_side;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'No autenticado';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_uid and is_admin = true
  ) then
    raise exception 'Solo admin';
  end if;

  select * into v_event
  from public.events
  where id = match_id
  for update;

  if v_event.id is null then
    raise exception 'Partida no encontrada';
  end if;

  v_winner := winner_team;

  if v_event.match_type = 'COMPETITIVE' and apply_elo then
    perform public.apply_match_elo(match_id, v_winner);
  end if;

  update public.events
  set
    winner_team = v_winner,
    result_status = 'CONFIRMED',
    result_proposed_by = v_uid,
    status = 'FINISHED'
  where id = match_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.event_participants enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;

drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all
on public.profiles
for select
to authenticated
using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists events_select_all on public.events;
create policy events_select_all
on public.events
for select
to authenticated
using (true);

drop policy if exists events_insert_auth on public.events;
create policy events_insert_auth
on public.events
for insert
to authenticated
with check (auth.uid() = created_by);

drop policy if exists events_update_participants on public.events;
create policy events_update_participants
on public.events
for update
to authenticated
using (
  auth.uid() = created_by
  or exists (
    select 1 from public.event_participants ep
    where ep.event_id = events.id and ep.user_id = auth.uid()
  )
  or exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.is_admin = true
  )
)
with check (
  auth.uid() = created_by
  or exists (
    select 1 from public.event_participants ep
    where ep.event_id = events.id and ep.user_id = auth.uid()
  )
  or exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.is_admin = true
  )
);

drop policy if exists participants_select_all on public.event_participants;
create policy participants_select_all
on public.event_participants
for select
to authenticated
using (true);

drop policy if exists participants_insert_allowed on public.event_participants;
create policy participants_insert_allowed
on public.event_participants
for insert
to authenticated
with check (
  auth.uid() = user_id
  or exists (
    select 1 from public.events e
    where e.id = event_id and e.created_by = auth.uid()
  )
  or exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.is_admin = true
  )
);

drop policy if exists participants_update_allowed on public.event_participants;
create policy participants_update_allowed
on public.event_participants
for update
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.events e
    where e.id = event_id and e.created_by = auth.uid()
  )
  or exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.is_admin = true
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1 from public.events e
    where e.id = event_id and e.created_by = auth.uid()
  )
  or exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.is_admin = true
  )
);

drop policy if exists participants_delete_allowed on public.event_participants;
create policy participants_delete_allowed
on public.event_participants
for delete
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.events e
    where e.id = event_id and e.created_by = auth.uid()
  )
  or exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.is_admin = true
  )
);

drop policy if exists friendships_select_own on public.friendships;
create policy friendships_select_own
on public.friendships
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists friendships_insert_own on public.friendships;
create policy friendships_insert_own
on public.friendships
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists friendships_delete_own on public.friendships;
create policy friendships_delete_own
on public.friendships
for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists friend_requests_select_involved on public.friend_requests;
create policy friend_requests_select_involved
on public.friend_requests
for select
to authenticated
using (auth.uid() = from_user_id or auth.uid() = to_user_id);

drop policy if exists friend_requests_insert_sender on public.friend_requests;
create policy friend_requests_insert_sender
on public.friend_requests
for insert
to authenticated
with check (auth.uid() = from_user_id);

drop policy if exists friend_requests_update_involved on public.friend_requests;
create policy friend_requests_update_involved
on public.friend_requests
for update
to authenticated
using (auth.uid() = from_user_id or auth.uid() = to_user_id)
with check (auth.uid() = from_user_id or auth.uid() = to_user_id);
