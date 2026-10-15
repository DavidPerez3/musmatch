import type {Page} from '@playwright/test';
export const userId='10000000-0000-0000-0000-000000000001';
export const eventId='20000000-0000-0000-0000-000000000001';
const profiles=Array.from({length:6},(_,i)=>({
 id:`10000000-0000-0000-0000-00000000000${i+1}`,
 username:i===0?'JugadorConUnNombreEspecialmenteLargoParaProbarElMovil':`Jugador${i+1}`,
 full_name:i===0?'Nombre y apellidos de prueba con bastante longitud':`Persona ${i+1}`,
 elo_rating:1600-i*25,reliability_score:100,is_admin:i===0,avatar_url:null,
}));
const event={rules_version:1,rules_variant:'EIGHT_KINGS',points_per_game:40,games_to_win:3,vacas_to_win:1,house_rules:'Sin juego real',id:eventId,title:'Partida competitiva con un título bastante largo en el centro de Vitoria',description:'Mesa de prueba. Ocho reyes y ocho ases.',starts_at:'2030-10-15T19:00:00Z',location_text:'Cafetería de prueba, dirección con bastante longitud',match_type:'COMPETITIVE',pair_mode:'FIXED_PAIR',created_by:userId,status:'FULL',winner_team:null,result_score:null,result_status:null,result_team_a_submitted_at:null,result_team_b_submitted_at:null,result_proposed_by:null,result_team_a_winner:null,result_team_b_winner:null,result_team_a_score:null,result_team_b_score:null,result_resolution_reason:null,result_pending_since:null,result_pending_deadline:null};
const participants=profiles.slice(0,4).map((p,i)=>({id:`30000000-0000-0000-0000-00000000000${i+1}`,event_id:eventId,user_id:p.id,team:i<2?'A':'B',attendance_status:'CHECKED_IN',joined_at:'2026-10-15T10:00:00Z'}));
const user={id:userId,aud:'authenticated',role:'authenticated',email:'correo.muy.largo.de.pruebas@example.test',email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
export async function mockBackend(page:Page,authenticated=true){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL||'https://example.supabase.co';
 const key=`sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
 if(authenticated){
  const encode=(obj:object)=>Buffer.from(JSON.stringify(obj)).toString('base64url');
  const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:userId,role:'authenticated',aud:'authenticated',exp:4102444800})}.test-signature`;
  await page.addInitScript(({key,user,token})=>localStorage.setItem(key,JSON.stringify({access_token:token,refresh_token:'synthetic-refresh-token',expires_at:4102444800,expires_in:3600,token_type:'bearer',user})),{key,user,token});
 }
 await page.routeWebSocket(/supabase/,socket=>socket.close());
 // Intercept every backend URL, including custom Supabase domains; no synthetic data reaches cloud.
 await page.route(`${new URL(url).origin}/**`,async route=>{
  const request=route.request();const u=new URL(request.url());
  if(u.pathname==='/auth/v1/user'){await route.fulfill({json:user});return;}
  if(!['GET','HEAD'].includes(request.method())){
   if(u.pathname.endsWith('/get_my_presence_token_status')){await route.fulfill({json:{token:'ABCD12',expires_at:new Date(Date.now()+180000).toISOString(),next_refresh_at:new Date(Date.now()+30000).toISOString()}});return;}
   await route.fulfill({status:400,json:{message:'Mutation blocked by isolated UI fixture'}});return;
  }
  const table=u.pathname.split('/').pop();let rows:object[]=[];
  if(table==='profiles'){
   rows=profiles;
   const id=u.searchParams.get('id');if(id?.startsWith('eq.'))rows=profiles.filter(p=>p.id===id.slice(3));
  }else if(table==='events_with_counts'){rows=[{...event,status:'OPEN',players_count:3,participants_count:3}];}
  else if(table==='events'){rows=[event];}
  else if(table==='event_participants'){rows=u.searchParams.has('user_id')?[participants[0]]:participants;}
  else if(table==='friendships'){rows=[{id:'friend-1',user_id:userId,friend_id:profiles[1].id}];}
  else if(table==='user_match_history'){rows=[];}
  else if(table==='admin_event_presence_overview'){rows=[{event_id:eventId,title:event.title,starts_at:event.starts_at,status:'FULL',result_status:null,match_type:'COMPETITIVE',players_count:4,checked_in_count:3,proofs_count:3,pending_checkins:1}];}
  const single=request.headers().accept?.includes('application/vnd.pgrst.object+json');
  await route.fulfill({json:single?(rows[0]||null):rows});
 });
}
