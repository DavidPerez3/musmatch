-- Short-lived, renewable codes; QR and manual entry use the same server-side protocol.
create or replace function public.create_presence_token(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
  where id = p_event_id for update;

  if v_event.id is null then
    raise exception 'Partida no encontrada';
  end if;

  if v_event.status not in ('OPEN','FULL') or v_event.result_status='DISPUTED' then
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

  if (select count(*) from public.event_participants where event_id=p_event_id and team='A')<>2
    or (select count(*) from public.event_participants where event_id=p_event_id and team='B')<>2
    then raise exception 'La presencia requiere dos equipos completos'; end if;

  select *
  into v_existing
  from public.event_presence_tokens t
  where t.event_id = p_event_id
    and t.user_id = v_uid
  order by t.created_at desc
  limit 1;

  if v_existing.id is not null and v_existing.created_at + v_cooldown > now() then
    if v_existing.consumed_at is not null or v_existing.expires_at<=now() then raise exception 'Espera treinta segundos antes de generar otro código'; end if;
    return jsonb_build_object(
      'token', v_existing.token,
      'expires_at', v_existing.expires_at,
      'next_refresh_at', v_existing.created_at + v_cooldown,
      'reused', true
    );
  end if;

  update public.event_presence_tokens set expires_at=now() where event_id=p_event_id and user_id=v_uid and consumed_at is null and expires_at>now();

  loop
    v_token := public.generate_presence_code(6);
    exit when not exists (
      select 1
      from public.event_presence_tokens t
      where t.event_id = p_event_id
        and t.token = v_token
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
    now() + interval '2 minutes'
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

create or replace function public.get_my_presence_token_status(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
    and exists(select 1 from public.event_participants p join public.events e on e.id=p.event_id where p.event_id=p_event_id and p.user_id=v_uid and p.team is not null and e.status in ('OPEN','FULL') and e.result_status is distinct from 'DISPUTED')
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
    'token', case when v_token.consumed_at is null and v_token.expires_at>now() then v_token.token else null end,
    'expires_at', case when v_token.consumed_at is null and v_token.expires_at>now() then v_token.expires_at else null end,
    'next_refresh_at', v_token.created_at + v_cooldown
  );
end;
$$;

create or replace function public.submit_presence_token(
  p_event_id uuid,
  p_token text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
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
  where id = p_event_id for update;

  if v_event.id is null then
    raise exception 'Partida no encontrada';
  end if;

  if v_event.status not in ('OPEN','FULL') or v_event.result_status='DISPUTED' then
    raise exception 'La partida ya esta cerrada';
  end if;

  if (select count(*) from public.event_participants where event_id=p_event_id and team='A')<>2
    or (select count(*) from public.event_participants where event_id=p_event_id and team='B')<>2
    then raise exception 'La presencia requiere dos equipos completos'; end if;

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


revoke execute on function public.create_presence_token(uuid),public.get_my_presence_token_status(uuid),public.submit_presence_token(uuid,text) from public,anon;
grant execute on function public.create_presence_token(uuid),public.get_my_presence_token_status(uuid),public.submit_presence_token(uuid,text) to authenticated,service_role;
notify pgrst, 'reload schema';

-- Existing unconsumed codes also adopt the shorter lifetime. Proofs are preserved.
update public.event_presence_tokens set expires_at=least(expires_at,now()+interval '2 minutes') where consumed_at is null and expires_at>now()+interval '2 minutes';
