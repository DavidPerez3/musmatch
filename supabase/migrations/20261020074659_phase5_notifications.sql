-- Transactional inbox + opt-in, per-device Web Push. No emails or simulated activity.
create schema if not exists musmatch_private;
revoke all on schema musmatch_private from public,anon,authenticated;
create table public.notification_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 invitations boolean not null default true, matches boolean not null default true,
 results boolean not null default true, reminders boolean not null default true, friends boolean not null default true,
 push_enabled boolean not null default false
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 event_id uuid references public.events(id) on delete cascade,
 category text not null check(category in ('invitations','matches','results','reminders','friends','test')),
 title text not null, body text not null, dedupe_key text not null,
 created_at timestamptz not null default now(), read_at timestamptz,
 unique(user_id,dedupe_key)
);
create index notifications_inbox on public.notifications(user_id,created_at desc);
create index notifications_unread on public.notifications(user_id) where read_at is null;
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique, p256dh text not null, auth text not null,
 device_name text not null default 'Navegador', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index push_subscriptions_owner on public.push_subscriptions(user_id);
create table musmatch_private.push_runtime (
 singleton boolean primary key default true check(singleton), public_key text, private_secret_id uuid,
 dispatch_token text not null default gen_random_uuid()::text||gen_random_uuid()::text,
 edge_url text, enabled boolean not null default false
);
insert into musmatch_private.push_runtime(singleton) values(true);
create table musmatch_private.push_outbox (
 id uuid primary key default gen_random_uuid(), notification_id uuid not null references public.notifications(id) on delete cascade,
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 state text not null default 'PENDING' check(state in ('PENDING','SENDING','SENT','FAILED','SKIPPED')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz, last_status integer, created_at timestamptz not null default now(),
 unique(notification_id,subscription_id)
);
create index push_outbox_due on musmatch_private.push_outbox(available_at) where state in ('PENDING','SENDING');
-- All client access is own-row reads or constrained RPCs. Endpoints/keys are not readable by browsers.
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table musmatch_private.push_runtime enable row level security;
alter table musmatch_private.push_outbox enable row level security;
revoke all on public.notifications,public.notification_preferences,public.push_subscriptions from public,anon,authenticated;
grant select on public.notifications,public.notification_preferences to authenticated;
grant all on public.notifications,public.notification_preferences,public.push_subscriptions to service_role;
create policy own_notifications on public.notifications for select to authenticated using(user_id=(select auth.uid()));
create policy own_preferences on public.notification_preferences for select to authenticated using(user_id=(select auth.uid()));

create function public.save_notification_preferences(p_preferences jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); begin
 if uid is null then raise exception 'No autenticado'; end if;
 if jsonb_typeof(p_preferences) is distinct from 'object' or exists(select 1 from jsonb_each(p_preferences) x where x.key not in ('invitations','matches','results','reminders','friends','push_enabled') or jsonb_typeof(x.value)<>'boolean') then raise exception 'Preferencias no válidas'; end if;
 insert into public.notification_preferences(user_id) values(uid) on conflict do nothing;
 update public.notification_preferences set
 invitations=coalesce((p_preferences->>'invitations')::boolean,invitations),matches=coalesce((p_preferences->>'matches')::boolean,matches),
 results=coalesce((p_preferences->>'results')::boolean,results),reminders=coalesce((p_preferences->>'reminders')::boolean,reminders),
 friends=coalesce((p_preferences->>'friends')::boolean,friends),push_enabled=coalesce((p_preferences->>'push_enabled')::boolean,push_enabled) where user_id=uid;
 -- Opting out takes effect for already queued messages, too.
 update musmatch_private.push_outbox o set state='SKIPPED',lease_token=null from public.notifications n,public.notification_preferences p
 where o.notification_id=n.id and n.user_id=uid and p.user_id=uid and o.state in ('PENDING','SENDING') and
 (not p.push_enabled or (n.category<>'test' and not coalesce((to_jsonb(p)->>n.category)::boolean,false)));
end $$;
create function public.mark_notifications_read(p_ids uuid[] default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if auth.uid() is null then raise exception 'No autenticado'; end if;
 if cardinality(p_ids)>100 then raise exception 'Demasiados avisos'; end if;
 update public.notifications set read_at=now() where user_id=auth.uid() and read_at is null and (p_ids is null or id=any(p_ids));
end $$;

create function musmatch_private.emit_notification(uid uuid,eid uuid,cat text,heading text,message text,dedupe text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare nid uuid; begin
 if not exists(select 1 from public.profiles where id=uid and not is_mock) then return; end if;
 if eid is not null and not exists(select 1 from public.events where id=eid and simulation_owner_id is null) then return; end if;
 if exists(select 1 from public.notification_preferences p where p.user_id=uid and cat<>'test' and not coalesce((to_jsonb(p)->>cat)::boolean,false)) then return; end if;
 insert into public.notifications(user_id,event_id,category,title,body,dedupe_key) values(uid,eid,cat,heading,case when eid is null then message else message||' · '||(select title from public.events where id=eid) end,dedupe)
 on conflict(user_id,dedupe_key) do nothing returning id into nid;
 if nid is not null then
  insert into musmatch_private.push_outbox(notification_id,subscription_id)
  select nid,s.id from public.push_subscriptions s join public.notification_preferences p on p.user_id=s.user_id
  where s.user_id=uid and p.push_enabled;
 end if;
end $$;
create function musmatch_private.notify_invitation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status='PENDING' and (tg_op='INSERT' or old.status is distinct from new.status or old.created_at is distinct from new.created_at) then
  perform musmatch_private.emit_notification(new.invitee_id,new.event_id,'invitations','Invitación a una partida','Te han invitado. Revisa las reglas y acepta en Mis partidas.','invite:'||new.id||':'||new.created_at);
 elsif tg_op='UPDATE' and new.status='DECLINED' and old.status='PENDING' then
  perform musmatch_private.emit_notification(new.inviter_id,new.event_id,'invitations','Invitación rechazada','Una invitación ha sido rechazada. Puedes invitar a otra persona.','declined:'||new.id||':'||new.created_at);
 end if; return new;
end $$;
create trigger notifications_invitation after insert or update on public.match_invitations for each row execute function musmatch_private.notify_invitation();
create function musmatch_private.notify_roster() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare eid uuid; changed uuid; r record; msg text; begin
 eid:=coalesce(new.event_id,old.event_id); changed:=coalesce(new.user_id,old.user_id);
 if tg_op='UPDATE' and old.team is not distinct from new.team then return new; end if;
 if not exists(select 1 from public.events where id=eid and simulation_owner_id is null and status in ('OPEN','FULL')) then return coalesce(new,old); end if;
 msg:=case tg_op when 'INSERT' then 'Se ha incorporado un jugador a tu partida.' when 'DELETE' then 'Un jugador ha dejado tu partida. Revisa las plazas disponibles.' else 'Un jugador ha cambiado de equipo. Revisa la mesa.' end;
 for r in select user_id from public.event_participants where event_id=eid and user_id<>changed union select created_by from public.events where id=eid and created_by<>changed loop
  perform musmatch_private.emit_notification(r.user_id,eid,'matches','Cambios en tu partida',msg,'roster:'||gen_random_uuid());
 end loop; return coalesce(new,old);
end $$;
create trigger notifications_roster after insert or delete or update of team on public.event_participants for each row execute function musmatch_private.notify_roster();
create function musmatch_private.notify_event() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; heading text; msg text; key text; cat text:='results'; begin
 if new.simulation_owner_id is not null then return new; end if;
 if new.status='CANCELLED' and old.status is distinct from new.status then
  heading:='Partida cancelada'; msg:='Una de tus partidas ha sido cancelada. Consulta el detalle.'; key:='cancelled';cat:='matches';
 elsif new.result_status='CONFIRMED' and old.result_status is distinct from new.result_status then
  heading:='Resultado confirmado';msg:='Ya puedes consultar el resultado y la clasificación de tu partida.';key:='confirmed';
 elsif new.result_status='DISPUTED' and old.result_status is distinct from new.result_status then
  heading:='Partida en revisión';msg:='La partida necesita revisión. No se aplica una derrota por abrir una disputa.';key:='disputed';
 elsif new.result_status='PENDING' and old.result_status is distinct from new.result_status then
  heading:='Resultado pendiente';msg:='El otro equipo ha publicado un resultado. Revisa y publica el de tu equipo.';key:='pending';
 else return new; end if;
 for r in
  select ep.user_id from public.event_participants ep where ep.event_id=new.id and
  (key<>'pending' or (ep.team='A' and new.result_team_a_submitted_at is null) or (ep.team='B' and new.result_team_b_submitted_at is null))
  union select invitee_id from public.match_invitations where event_id=new.id and status='PENDING' and key='cancelled'
  union select created_by from public.events where id=new.id and key<>'pending'
  union select id from public.profiles where is_admin and key='disputed'
 loop perform musmatch_private.emit_notification(r.user_id,new.id,cat,heading,msg,'event:'||new.id||':'||key); end loop;
 -- A final result/cancellation makes previous pending-result and reminder pushes obsolete.
 if key in ('cancelled','confirmed','disputed') then
  update musmatch_private.push_outbox o set state='SKIPPED',lease_token=null from public.notifications n
  where o.notification_id=n.id and n.event_id=new.id and o.state in ('PENDING','SENDING') and (n.category='reminders' or n.dedupe_key='event:'||new.id||':pending');
 end if; return new;
end $$;
create trigger notifications_event after update on public.events for each row execute function musmatch_private.notify_event();
create function musmatch_private.notify_friend() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if tg_op='INSERT' and new.status='PENDING' then
  perform musmatch_private.emit_notification(new.to_user_id,null,'friends','Solicitud de amistad','Tienes una nueva solicitud en tu perfil.','friend:'||new.id);
 elsif tg_op='UPDATE' and new.status='ACCEPTED' and old.status='PENDING' then
  perform musmatch_private.emit_notification(new.from_user_id,null,'friends','Solicitud aceptada','Han aceptado tu solicitud de amistad.','friend-accepted:'||new.id);
 end if; return new;
end $$;
create trigger notifications_friend after insert or update on public.friend_requests for each row execute function musmatch_private.notify_friend();

create function public.get_push_public_key() returns text language sql stable security definer set search_path=public,pg_temp as $$
 select public_key from musmatch_private.push_runtime where singleton and auth.uid() is not null and enabled;
$$;
create function public.register_push_subscription(p_subscription jsonb,p_device_name text default 'Navegador') returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); v_endpoint text:=p_subscription->>'endpoint'; dh text:=p_subscription->'keys'->>'p256dh'; a text:=p_subscription->'keys'->>'auth'; sid uuid; begin
 if uid is null or not exists(select 1 from public.profiles where id=uid and not is_mock) then raise exception 'No autenticado'; end if;
 -- Known browser push services only: never turn the dispatcher into an SSRF proxy.
 if v_endpoint is null or length(v_endpoint)>2048 or v_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-zA-Z0-9-]+\.notify\.windows\.com)/[^#@[:space:]]+$'
 or dh is null or dh !~ '^[A-Za-z0-9_-]{87}$' or a is null or a !~ '^[A-Za-z0-9_-]{22}$' then raise exception 'Suscripción no válida'; end if;
 perform 1 from public.profiles where id=uid for update;
 if (select count(*) from public.push_subscriptions where user_id=uid)>=10 and not exists(select 1 from public.push_subscriptions s where s.endpoint=v_endpoint and s.user_id=uid) then raise exception 'Límite de 10 dispositivos alcanzado'; end if;
 if exists(select 1 from public.push_subscriptions s where s.endpoint=v_endpoint and s.user_id<>uid) then raise exception 'Desactiva las notificaciones de la cuenta anterior en este dispositivo'; end if;
 insert into public.push_subscriptions(user_id,endpoint,p256dh,auth,device_name) values(uid,v_endpoint,dh,a,left(coalesce(nullif(trim(p_device_name),''),'Navegador'),80))
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,updated_at=now(),device_name=excluded.device_name returning id into sid;
 insert into public.notification_preferences(user_id,push_enabled) values(uid,true) on conflict(user_id) do update set push_enabled=true;
 return sid;
end $$;
create function public.list_push_devices() returns table(id uuid,device_name text,updated_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$ select id,device_name,updated_at from public.push_subscriptions where user_id=auth.uid() order by updated_at desc $$;
create function public.get_push_subscription_status(p_endpoint text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid; begin
 if auth.uid() is null then raise exception 'No autenticado'; end if;
 update public.push_subscriptions set updated_at=now() where user_id=auth.uid() and endpoint=p_endpoint returning id into sid;
 return sid;
end $$;
create function public.remove_push_subscription(p_id uuid default null,p_endpoint text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if auth.uid() is null then raise exception 'No autenticado'; end if;
 if p_id is null and p_endpoint is null then raise exception 'Indica el dispositivo'; end if;
 delete from public.push_subscriptions where user_id=auth.uid() and (id=p_id or endpoint=p_endpoint);
 if not exists(select 1 from public.push_subscriptions where user_id=auth.uid()) then update public.notification_preferences set push_enabled=false where user_id=auth.uid(); end if;
end $$;
create function public.request_test_notification() returns void language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if auth.uid() is null then raise exception 'No autenticado'; end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 if not exists(select 1 from public.push_subscriptions where user_id=auth.uid()) or not exists(select 1 from public.notification_preferences where user_id=auth.uid() and push_enabled) then raise exception 'Activa primero las notificaciones'; end if;
 if exists(select 1 from public.notifications where user_id=auth.uid() and category='test' and created_at>now()-interval '1 minute') then raise exception 'Espera un minuto antes de repetir la prueba'; end if;
 perform musmatch_private.emit_notification(auth.uid(),null,'test','Notificaciones activadas','Esta es tu notificación de prueba de MusMatch.','test:'||gen_random_uuid());
end $$;

-- Service-only RPCs. VAPID private key is encrypted in Supabase Vault, never sent to browsers.
create function public.push_runtime_config() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg musmatch_private.push_runtime%rowtype; secret text; begin
 select * into cfg from musmatch_private.push_runtime where singleton;
 if cfg.private_secret_id is not null then execute 'select decrypted_secret from vault.decrypted_secrets where id=$1' into secret using cfg.private_secret_id; end if;
 return jsonb_build_object('public_key',cfg.public_key,'private_key',secret,'dispatch_token',cfg.dispatch_token,'enabled',cfg.enabled);
end $$;
create function public.initialize_push_runtime(p_public_key text,p_private_key text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg musmatch_private.push_runtime%rowtype; sid uuid; begin
 select * into cfg from musmatch_private.push_runtime where singleton for update;
 if cfg.public_key is not null then return; end if;
 if p_public_key !~ '^[A-Za-z0-9_-]{87}$' or p_private_key !~ '^[A-Za-z0-9_-]{43}$' or p_public_key is null or p_private_key is null then raise exception 'Invalid VAPID keys'; end if;
 execute 'select vault.create_secret($1,$2,$3)' into sid using p_private_key,'musmatch_vapid_private','MusMatch VAPID private signing key';
 update musmatch_private.push_runtime set public_key=p_public_key,private_secret_id=sid where singleton;
end $$;
create function public.claim_push_batch(p_limit integer default 30) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare batch jsonb; begin
 update musmatch_private.push_outbox set state='FAILED' where state in ('PENDING','SENDING') and (created_at<now()-interval '1 day' or attempts>=5);
 -- Re-check preference, readership and ownership at dispatch time.
 update musmatch_private.push_outbox o set state='SKIPPED',lease_token=null from public.notifications n, public.push_subscriptions s
 where o.notification_id=n.id and o.subscription_id=s.id and o.state in ('PENDING','SENDING') and
 (n.read_at is not null or s.user_id<>n.user_id or not exists(select 1 from public.notification_preferences p where p.user_id=n.user_id and p.push_enabled and (n.category='test' or coalesce((to_jsonb(p)->>n.category)::boolean,false))));
 update musmatch_private.push_outbox o set state='SKIPPED',lease_token=null from public.notifications n
 where o.notification_id=n.id and o.state in ('PENDING','SENDING') and (
 (n.category='reminders' and not exists(select 1 from public.events e join public.event_participants ep on ep.event_id=e.id where e.id=n.event_id and ep.user_id=n.user_id and e.status in ('OPEN','FULL') and e.starts_at>now() and e.result_status is null)) or
 (n.dedupe_key like 'invite:%' and not exists(select 1 from public.match_invitations i join public.events e on e.id=i.event_id where i.event_id=n.event_id and i.invitee_id=n.user_id and i.status='PENDING' and e.status in ('OPEN','FULL') and e.starts_at>now())));
 with picked as (
 select id from musmatch_private.push_outbox where (state='PENDING' and available_at<=now()) or (state='SENDING' and lease_until<=now()) order by available_at limit least(greatest(p_limit,1),30) for update skip locked
 ), claimed as (
 update musmatch_private.push_outbox o set state='SENDING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes' from picked where o.id=picked.id returning o.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease_token',c.lease_token,'endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth),
 'notification_id',n.id,'event_id',n.event_id,'category',n.category)), '[]'::jsonb) into batch from claimed c join public.push_subscriptions s on s.id=c.subscription_id join public.notifications n on n.id=c.notification_id;
 return batch;
end $$;
create function public.finish_push_delivery(p_id uuid,p_lease_token uuid,p_status integer) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare job musmatch_private.push_outbox%rowtype; begin
 select * into job from musmatch_private.push_outbox where id=p_id and lease_token=p_lease_token and state='SENDING' for update;
 if not found then return; end if;
 if p_status in (404,410) then delete from public.push_subscriptions where id=job.subscription_id; return; end if;
 update musmatch_private.push_outbox set state=case when p_status between 200 and 299 then 'SENT' when attempts>=5 or (p_status between 400 and 499 and p_status not in (408,429)) then 'FAILED' else 'PENDING' end,
 last_status=p_status,available_at=now()+make_interval(secs=>least(3600,60*power(2,attempts)::int)),lease_token=null,lease_until=null where id=p_id;
end $$;
create function public.enqueue_match_reminders() returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; begin
 for r in select ep.user_id,e.id,e.starts_at from public.events e join public.event_participants ep on ep.event_id=e.id
 where e.simulation_owner_id is null and e.status in ('OPEN','FULL') and e.result_status is null and e.starts_at>now() and e.starts_at<=now()+interval '1 hour'
 loop perform musmatch_private.emit_notification(r.user_id,r.id,'reminders','Tu partida se acerca','Tu partida empieza en menos de una hora. Comprueba la mesa y el lugar antes de ir.','reminder:'||r.id||':'||r.starts_at); end loop;
 delete from public.notifications where created_at<now()-interval '90 days';
 delete from public.push_subscriptions where updated_at<now()-interval '90 days';
end $$;
create function public.dispatch_push_notifications() returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg musmatch_private.push_runtime%rowtype; rid bigint; begin
 perform public.enqueue_match_reminders();
 select * into cfg from musmatch_private.push_runtime where singleton;
 if not cfg.enabled or cfg.edge_url is null then return null; end if;
 if cfg.public_key is not null and not exists(select 1 from musmatch_private.push_outbox where (state='PENDING' and available_at<=now()) or (state='SENDING' and lease_until<=now())) then return null; end if;
 execute 'select net.http_post(url:=$1,headers:=$2,body:=$3,timeout_milliseconds:=10000)' into rid using cfg.edge_url,jsonb_build_object('Content-Type','application/json','x-dispatch-token',cfg.dispatch_token),'{}'::jsonb;
 return rid;
end $$;
-- Deny inherited function privileges, including internal trigger/helpers.
revoke all on all functions in schema musmatch_private from public,anon,authenticated;
do $$ declare f record; begin
 for f in select p.oid::regprocedure sig,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('save_notification_preferences','mark_notifications_read','get_push_public_key','register_push_subscription','list_push_devices','get_push_subscription_status','remove_push_subscription','request_test_notification','push_runtime_config','initialize_push_runtime','claim_push_batch','finish_push_delivery','enqueue_match_reminders','dispatch_push_notifications') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.sig);
 execute format('grant execute on function %s to service_role',f.sig);
 if f.proname in ('save_notification_preferences','mark_notifications_read','get_push_public_key','register_push_subscription','list_push_devices','get_push_subscription_status','remove_push_subscription','request_test_notification') then execute format('grant execute on function %s to authenticated',f.sig); end if;
 end loop;
end $$;
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_net') then create extension if not exists pg_net with schema extensions; end if;
 if exists(select 1 from pg_extension where extname='pg_cron') then
 perform cron.schedule('musmatch-push-dispatch','*/2 * * * *','select public.dispatch_push_notifications();');
 end if;
end $$;
