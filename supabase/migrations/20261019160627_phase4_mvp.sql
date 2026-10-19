-- Phase 4: consent-based invitations, protected locations and reviewed resolutions.
create table public.match_invitations (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.events(id) on delete cascade,
 inviter_id uuid not null references auth.users(id),
 invitee_id uuid not null references auth.users(id),
 team public.team_side not null,
 status text not null default 'PENDING' check(status in ('PENDING','ACCEPTED','DECLINED','CANCELLED')),
 created_at timestamptz not null default now(), responded_at timestamptz,
 unique(event_id,invitee_id), check(inviter_id<>invitee_id)
);
create index match_invites_inbox on public.match_invitations(invitee_id,status);
alter table public.match_invitations enable row level security;
revoke all on public.match_invitations from public,anon,authenticated;
grant select on public.match_invitations to authenticated;
create policy invitations_read on public.match_invitations for select to authenticated
 using(inviter_id=(select auth.uid()) or invitee_id=(select auth.uid()));

create table public.venues (
 id uuid primary key default gen_random_uuid(), name text not null,
 status text not null default 'CANDIDATE' check(status in ('CANDIDATE','COLLABORATOR')),
 address text, latitude double precision, longitude double precision,
 conditions text, verified_at timestamptz,
 check ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180)),
 check(status<>'COLLABORATOR' or verified_at is not null)
);
alter table public.venues enable row level security;
revoke all on public.venues from public,anon,authenticated;
grant select on public.venues to authenticated;
create policy venues_read on public.venues for select to authenticated using(true);
insert into public.venues(name,conditions) values
 ('Bar Indartsu','Colaboración pendiente de confirmar. Consulta permiso y disponibilidad con el local.'),
 ('Taberna Txustarra','Colaboración pendiente de confirmar. Consulta permiso y disponibilidad con el local.');

-- Private addresses/coordinates never live in the discoverable events table.
create table public.match_locations (
 event_id uuid primary key references public.events(id) on delete cascade,
 location_type text not null check(location_type in ('PUBLIC_VENUE','PRIVATE_LOCATION')),
 address text not null check(length(address) between 1 and 500),
 authorization_confirmed_at timestamptz not null default now(),
 latitude double precision, longitude double precision,
 osm_ref text check(length(osm_ref)<=80), venue_id uuid references public.venues(id),
 check ((latitude is null and longitude is null) or
 (latitude is not null and longitude is not null and latitude between -90 and 90 and longitude between -180 and 180))
);
alter table public.match_locations enable row level security;
revoke all on public.match_locations from public,anon,authenticated;
grant select on public.match_locations to authenticated;
create policy locations_read on public.match_locations for select to authenticated using(
 location_type='PUBLIC_VENUE' or exists(select 1 from public.events e where e.id=event_id and e.created_by=(select auth.uid()))
 or exists(select 1 from public.event_participants ep where ep.event_id=match_locations.event_id and ep.user_id=(select auth.uid()))
 or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin));

insert into public.match_locations(event_id,location_type,address)
 select id,'PRIVATE_LOCATION',location_text from public.events
 where location_type='PRIVATE_LOCATION' and nullif(trim(location_text),'') is not null;
update public.events set location_text='Lugar privado · zona por confirmar' where location_type='PRIVATE_LOCATION';

create table public.match_reviews (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id),
 reviewer_id uuid not null references auth.users(id),
 decision text not null check(decision in ('A','B','VOID')),
 reason text not null check(length(trim(reason)) between 10 and 1000),
 applied_elo boolean not null, created_at timestamptz not null default now()
);
create index match_reviews_event on public.match_reviews(event_id);
alter table public.match_reviews enable row level security;
revoke all on public.match_reviews from public,anon,authenticated;
grant select on public.match_reviews to authenticated;
create policy reviews_read on public.match_reviews for select to authenticated using(
 exists(select 1 from public.event_participants ep where ep.event_id=match_reviews.event_id and ep.user_id=(select auth.uid()))
 or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.is_admin));

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
    insert into public.match_invitations(event_id,inviter_id,invitee_id,team)
    values(v_event_id,v_creator_id,p_partner_id,'A');
  end if;

  perform public.refresh_event_status(v_event_id);
  return v_event_id;
end;
$$;

create function public.create_match_v2(
 p_title text,p_location_text text,p_starts_at timestamptz,p_notes text,p_match_type text,p_pair_mode text,
 p_partner_id uuid,p_rules_variant text,p_points_per_game integer,p_games_to_win integer,p_vacas_to_win integer,
 p_house_rules text,p_location jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare eid uuid; kind text; address text; vid uuid; lat double precision; lon double precision;
begin
 if auth.uid() is null then raise exception 'No autenticado'; end if;
 if p_starts_at<=now() then raise exception 'Elige una fecha futura'; end if;
 if length(trim(p_title)) not between 3 and 120 or coalesce(length(p_notes),0)>2000 then raise exception 'Revisa título y notas'; end if;
 kind:=coalesce(p_location->>'type','PUBLIC_VENUE');
 address:=nullif(trim(p_location->>'address'),'');
 if kind not in ('PUBLIC_VENUE','PRIVATE_LOCATION') or address is null or length(address)>500 then raise exception 'Indica una ubicación válida'; end if;
 if kind='PRIVATE_LOCATION' and (length(trim(coalesce(p_location_text,''))) not between 3 and 150) then raise exception 'Indica solo la zona pública del lugar privado'; end if;
 if coalesce((p_location->>'authorized')::boolean,false) is not true then raise exception 'Confirma permiso y disponibilidad del lugar'; end if;
 vid:=nullif(p_location->>'venue_id','')::uuid;
 if vid is not null and (kind<>'PUBLIC_VENUE' or not exists(select 1 from public.venues where id=vid)) then raise exception 'Local no válido'; end if;
 lat:=nullif(p_location->>'latitude','')::double precision; lon:=nullif(p_location->>'longitude','')::double precision;
 eid:=public.create_match_with_rules(p_title,case when kind='PRIVATE_LOCATION' then 'Lugar privado · '||trim(p_location_text) else address end,
 p_starts_at,p_notes,p_match_type,p_pair_mode,p_partner_id,p_rules_variant,p_points_per_game,p_games_to_win,p_vacas_to_win,p_house_rules);
 update public.events set location_type=kind where id=eid;
 insert into public.match_locations(event_id,location_type,address,latitude,longitude,osm_ref,venue_id)
 values(eid,kind,address,lat,lon,p_location->>'osm_ref',vid);
 return eid;
end $$;

create function public.invite_match_player(p_event_id uuid,p_invitee_id uuid,p_team public.team_side)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype; begin
 select * into e from public.events where id=p_event_id for update;
 if auth.uid() is null or e.created_by is distinct from auth.uid() then raise exception 'Solo el organizador puede invitar'; end if;
 if e.status not in ('OPEN','FULL') or e.result_status is not null or e.starts_at<=now() then raise exception 'La partida ya no admite invitaciones'; end if;
 if p_team is null or p_invitee_id=auth.uid() or not exists(select 1 from public.friendships where user_id=auth.uid() and friend_id=p_invitee_id)
 then raise exception 'Selecciona a un amigo'; end if;
 if exists(select 1 from public.event_participants where event_id=p_event_id and user_id=p_invitee_id) then raise exception 'Ya está apuntado'; end if;
 if (select count(*) from public.event_participants where event_id=p_event_id)>=4 or
 (select count(*) from public.event_participants where event_id=p_event_id and team=p_team)>=2 then raise exception 'No quedan plazas en ese equipo'; end if;
 insert into public.match_invitations(event_id,inviter_id,invitee_id,team) values(p_event_id,auth.uid(),p_invitee_id,p_team)
 on conflict(event_id,invitee_id) do update set status='PENDING',team=excluded.team,created_at=now(),responded_at=null;
end $$;

create function public.respond_match_invitation(p_invitation_id uuid,p_accept boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare inv public.match_invitations%rowtype; e public.events%rowtype; eid uuid;
begin
 -- All roster writes lock event first, then invitation, to avoid deadlocks.
 select event_id into eid from public.match_invitations where id=p_invitation_id;
 select * into e from public.events where id=eid for update;
 select * into inv from public.match_invitations where id=p_invitation_id for update;
 if auth.uid() is null or inv.invitee_id is distinct from auth.uid() then raise exception 'Invitación no disponible'; end if;
 if inv.status<>'PENDING' then raise exception 'La invitación ya fue respondida'; end if;
 if p_accept is null then raise exception 'Respuesta no válida'; end if;
 if p_accept then
  if e.status not in ('OPEN','FULL') or e.result_status is not null or e.starts_at<=now() then raise exception 'La partida ya no admite incorporaciones'; end if;
  if not exists(select 1 from public.event_participants where event_id=inv.event_id and user_id=auth.uid()) then
   insert into public.event_participants(event_id,user_id,team) values(inv.event_id,auth.uid(),inv.team);
  else raise exception 'Ya estás apuntado: revisa tu equipo en la partida'; end if;
 end if;
 update public.match_invitations set status=case when p_accept then 'ACCEPTED' else 'DECLINED' end,responded_at=now() where id=inv.id;
 perform public.refresh_event_status(inv.event_id);
end $$;

create function public.cancel_match(p_event_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype; begin
 select * into e from public.events where id=p_event_id for update;
 if auth.uid() is null or e.created_by is distinct from auth.uid() then raise exception 'Solo el organizador puede cancelar'; end if;
 if e.status not in ('OPEN','FULL') or e.result_status is not null or e.elo_applied_at is not null then raise exception 'No se puede cancelar una partida con resultado o ya cerrada'; end if;
 if coalesce(length(trim(p_reason)),0) not between 5 and 500 then raise exception 'Indica el motivo de cancelación (5–500 caracteres)'; end if;
 update public.events set status='CANCELLED',result_resolution_reason='Cancelada: '||trim(p_reason) where id=p_event_id;
 update public.match_invitations set status='CANCELLED',responded_at=now() where event_id=p_event_id and status='PENDING';
 update public.event_presence_tokens set expires_at=least(expires_at,now()) where event_id=p_event_id;
 perform public.log_audit_event('MATCH_CANCELLED','event',p_event_id,jsonb_build_object('reason',trim(p_reason)));
end $$;

create function public.review_match_dispute(p_event_id uuid,p_decision text,p_reason text,p_apply_elo boolean default false)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.events%rowtype; rating boolean; begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and is_admin) then raise exception 'Solo admin'; end if;
 if p_decision is null or p_decision not in ('A','B','VOID') or coalesce(length(trim(p_reason)),0) not between 10 and 1000 then raise exception 'Indica decisión y motivo (10–1000 caracteres)'; end if;
 select * into e from public.events where id=p_event_id for update;
 if e.id is null or e.result_status is distinct from 'DISPUTED' or e.status in ('FINISHED','CANCELLED') or e.elo_applied_at is not null then raise exception 'Solo se pueden revisar disputas abiertas sin ELO aplicado'; end if;
 rating:=coalesce(p_apply_elo,false) and e.match_type='COMPETITIVE' and p_decision<>'VOID';
 if p_decision='VOID' then
  update public.events set status='CANCELLED',winner_team=null,result_score=null,result_resolution_reason='Anulada: '||trim(p_reason),result_pending_since=null,result_pending_deadline=null where id=p_event_id;
 else
  perform public.admin_resolve_dispute(p_event_id,p_decision::public.team_side,rating);
  update public.events set result_resolution_reason=trim(p_reason),result_pending_since=null,result_pending_deadline=null where id=p_event_id;
 end if;
 insert into public.match_reviews(event_id,reviewer_id,decision,reason,applied_elo) values(p_event_id,auth.uid(),p_decision,trim(p_reason),rating);
end $$;
-- Old admin UI cannot bypass the mandatory review record.
revoke execute on function public.admin_resolve_dispute(uuid,public.team_side,boolean) from authenticated;

-- Explicit API grants: new functions do not inherit PUBLIC/anon execution.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('create_match_v2','invite_match_player','respond_match_invitation','cancel_match','review_match_dispute')
 loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 execute format('grant execute on function %s to authenticated,service_role',f.sig); end loop;
end $$;
-- Shared provider limits/cache are server-only; no location searches are stored on profiles.
create table public.place_search_cache (cache_key text primary key, results jsonb not null, expires_at timestamptz not null);
create table public.place_search_limits (key text primary key,next_at timestamptz not null);
alter table public.place_search_cache enable row level security;
alter table public.place_search_limits enable row level security;
revoke all on public.place_search_cache,public.place_search_limits from public,anon,authenticated;
grant all on public.place_search_cache,public.place_search_limits to service_role;
create function public.claim_place_search(p_user_id uuid,p_key text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare cached jsonb; deadline timestamptz;
begin
 select results into cached from public.place_search_cache where cache_key=p_key and expires_at>now();
 if cached is not null then return jsonb_build_object('cached',cached); end if;
 insert into public.place_search_limits(key,next_at) values('global',now()) on conflict do nothing;
 select next_at into deadline from public.place_search_limits where key='global' for update;
 if deadline>now() then return jsonb_build_object('busy',true); end if;
 insert into public.place_search_limits(key,next_at) values(p_user_id::text,now()) on conflict do nothing;
 select next_at into deadline from public.place_search_limits where key=p_user_id::text for update;
 if deadline>now() then return jsonb_build_object('busy',true); end if;
 update public.place_search_limits set next_at=now()+interval '2 seconds' where key='global';
 update public.place_search_limits set next_at=now()+interval '5 seconds' where key=p_user_id::text;
 delete from public.place_search_cache where expires_at<now();
 delete from public.place_search_limits where key<>'global' and next_at<now()-interval '1 day';
 return '{}'::jsonb;
end $$;
revoke all on function public.claim_place_search(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_place_search(uuid,text) to service_role;
-- A cancelled or unanswered game is never a defeat in profile history.
create or replace view public.user_match_history with(security_invoker=true) as
select ep.user_id,e.id as match_id,e.title,e.winner_team,e.result_score,e.created_at,ep.team,
 case when e.status='CANCELLED' then 'CANCELLED'
 when e.result_status is distinct from 'CONFIRMED' then 'PENDING'
 when e.winner_team=ep.team then 'WON' else 'LOST' end as result
from public.event_participants ep join public.events e on e.id=ep.event_id;

