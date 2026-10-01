-- ============================================
-- Email Notifications Setup
-- ============================================
-- This script sets up email notifications using pg_net + Resend API
-- 
-- PREREQUISITES:
-- 1. Sign up at resend.com and get API key
-- 2. Verify your domain or use test domain
-- 3. Replace YOUR_RESEND_API_KEY below with your actual key
-- 4. Enable pg_net extension in Supabase dashboard
-- ============================================

-- Enable pg_net extension for HTTP requests
create extension if not exists pg_net;

-- ============================================
-- Helper Function: Send Email
-- ============================================
create or replace function send_email(
  p_to text,
  p_subject text,
  p_html text
)
returns void
language plpgsql
security definer
as $$
begin
  perform
    net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer YOUR_RESEND_API_KEY'
      ),
      body := jsonb_build_object(
        'from', 'Musmatch <noreply@musmatch.com>',
        'to', p_to,
        'subject', p_subject,
        'html', p_html
      )
    );
end;
$$;

-- ============================================
-- 1. Friend Request Received
-- ============================================
create or replace function notify_friend_request()
returns trigger
language plpgsql
security definer
as $$
declare
  v_to_email text;
  v_from_username text;
  v_html text;
begin
  -- Only notify on new PENDING requests
  if NEW.status != 'PENDING' then
    return NEW;
  end if;

  -- Get recipient email
  select email into v_to_email
  from auth.users
  where id = NEW.to_user_id;
  
  -- Get sender username
  select username into v_from_username
  from profiles
  where id = NEW.from_user_id;
  
  -- Build email HTML
  v_html := '
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background: #0f3d3e; color: #fff; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { 
      display: inline-block;
      background: #4ade80; 
      color: #0f3d3e; 
      padding: 12px 24px; 
      text-decoration: none; 
      border-radius: 8px;
      font-weight: bold;
    }
    h1 { color: #4ade80; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎯 Nueva solicitud de amistad</h1>
    <p><strong>@' || v_from_username || '</strong> quiere ser tu amigo en Musmatch.</p>
    <p><a href="https://musmatch.com/profile" class="button">Ver solicitud</a></p>
  </div>
</body>
</html>
  ';
  
  -- Send email
  perform send_email(
    v_to_email,
    'Nueva solicitud de amistad de @' || v_from_username,
    v_html
  );
  
  return NEW;
end;
$$;

create trigger on_friend_request_created
  after insert on friend_requests
  for each row
  execute function notify_friend_request();

-- ============================================
-- 2. Friend Request Accepted
-- ============================================
create or replace function notify_friend_accepted()
returns trigger
language plpgsql
security definer
as $$
declare
  v_to_email text;
  v_accepter_username text;
  v_html text;
begin
  -- Only notify when status changes to ACCEPTED
  if NEW.status != 'ACCEPTED' or OLD.status = 'ACCEPTED' then
    return NEW;
  end if;

  -- Get original sender email
  select email into v_to_email
  from auth.users
  where id = NEW.from_user_id;
  
  -- Get accepter username
  select username into v_accepter_username
  from profiles
  where id = NEW.to_user_id;
  
  -- Build email HTML
  v_html := '
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background: #0f3d3e; color: #fff; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { 
      display: inline-block;
      background: #4ade80; 
      color: #0f3d3e; 
      padding: 12px 24px; 
      text-decoration: none; 
      border-radius: 8px;
      font-weight: bold;
    }
    h1 { color: #4ade80; }
  </style>
</head>
<body>
  <div class="container">
    <h1>✅ Solicitud aceptada</h1>
    <p><strong>@' || v_accepter_username || '</strong> aceptó tu solicitud de amistad.</p>
    <p><a href="https://musmatch.com/profile" class="button">Ver amigos</a></p>
  </div>
</body>
</html>
  ';
  
  -- Send email
  perform send_email(
    v_to_email,
    '@' || v_accepter_username || ' aceptó tu solicitud de amistad',
    v_html
  );
  
  return NEW;
end;
$$;

create trigger on_friend_request_accepted
  after update on friend_requests
  for each row
  execute function notify_friend_accepted();

-- ============================================
-- 3. Match Invite (when invited to match)
-- ============================================
create or replace function notify_match_invite()
returns trigger
language plpgsql
security definer
as $$
declare
  v_to_email text;
  v_inviter_username text;
  v_match_title text;
  v_match_date text;
  v_html text;
begin
  -- Get invited user email
  select email into v_to_email
  from auth.users
  where id = NEW.user_id;
  
  -- Get match creator username
  select p.username into v_inviter_username
  from events e
  join profiles p on p.id = e.created_by
  where e.id = NEW.event_id;
  
  -- Get match details
  select title, to_char(starts_at, 'DD/MM/YYYY HH24:MI') into v_match_title, v_match_date
  from events
  where id = NEW.event_id;
  
  -- Build email HTML
  v_html := '
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background: #0f3d3e; color: #fff; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { 
      display: inline-block;
      background: #4ade80; 
      color: #0f3d3e; 
      padding: 12px 24px; 
      text-decoration: none; 
      border-radius: 8px;
      font-weight: bold;
    }
    h1 { color: #4ade80; }
    .details { background: #1a4d4e; padding: 15px; border-radius: 8px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎮 Invitación a partida</h1>
    <p><strong>@' || v_inviter_username || '</strong> te invitó a jugar.</p>
    <div class="details">
      <p><strong>Partida:</strong> ' || v_match_title || '</p>
      <p><strong>Fecha:</strong> ' || v_match_date || '</p>
    </div>
    <p><a href="https://musmatch.com/events/' || NEW.event_id || '" class="button">Ver partida</a></p>
  </div>
</body>
</html>
  ';
  
  -- Send email (only if user was invited, not if they joined themselves)
  -- Check if this is an invite by seeing if creator is different from participant
  if exists (
    select 1 from events 
    where id = NEW.event_id 
    and created_by != NEW.user_id
    and pair_mode = 'FIXED_PAIR'
  ) then
    perform send_email(
      v_to_email,
      '@' || v_inviter_username || ' te invitó a una partida',
      v_html
    );
  end if;
  
  return NEW;
end;
$$;

create trigger on_match_participant_added
  after insert on event_participants
  for each row
  execute function notify_match_invite();

-- ============================================
-- 4. Match Result Posted
-- ============================================
create or replace function notify_match_result()
returns trigger
language plpgsql
security definer
as $$
declare
  v_participant record;
  v_proposer_username text;
  v_match_title text;
  v_result text;
  v_html text;
begin
  -- Only notify when result status changes to PENDING
  if NEW.result_status != 'PENDING' or OLD.result_status = 'PENDING' then
    return NEW;
  end if;

  -- Get proposer username
  select username into v_proposer_username
  from profiles
  where id = NEW.result_proposed_by;
  
  -- Get match title and result
  select title into v_match_title from events where id = NEW.id;
  v_result := 'Equipo ' || NEW.winner_team || ' ganó';
  
  -- Build email HTML
  v_html := '
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; background: #0f3d3e; color: #fff; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .button { 
      display: inline-block;
      background: #4ade80; 
      color: #0f3d3e; 
      padding: 12px 24px; 
      text-decoration: none; 
      border-radius: 8px;
      font-weight: bold;
    }
    h1 { color: #4ade80; }
    .details { background: #1a4d4e; padding: 15px; border-radius: 8px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Resultado pendiente</h1>
    <p><strong>@' || v_proposer_username || '</strong> propuso un resultado para la partida.</p>
    <div class="details">
      <p><strong>Partida:</strong> ' || v_match_title || '</p>
      <p><strong>Resultado:</strong> ' || v_result || '</p>
    </div>
    <p><a href="https://musmatch.com/events/' || NEW.id || '" class="button">Confirmar o disputar</a></p>
  </div>
</body>
</html>
  ';
  
  -- Notify all participants
  for v_participant in
    select u.email
    from event_participants ep
    join auth.users u on u.id = ep.user_id
    where ep.event_id = NEW.id
    and ep.user_id != NEW.result_proposed_by
  loop
    perform send_email(
      v_participant.email,
      'Resultado de partida pendiente: ' || v_match_title,
      v_html
    );
  end loop;
  
  return NEW;
end;
$$;

create trigger on_match_result_posted
  after update on events
  for each row
  execute function notify_match_result();

-- ============================================
-- SETUP COMPLETE
-- ============================================
-- Next steps:
-- 1. Replace YOUR_RESEND_API_KEY with your actual Resend API key
-- 2. Update domain in 'from' field (noreply@musmatch.com)
-- 3. Update URLs to your actual domain
-- 4. Test by triggering each event
-- ============================================
