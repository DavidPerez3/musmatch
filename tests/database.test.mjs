import { before, after, beforeEach, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const ids = Array.from({length:6},(_,i)=>`00000000-0000-4000-8000-00000000000${i+1}`);
async function actor(index, query, params=[]) {
  await db.exec(`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${ids[index]}',true);`);
  try { const result=await db.query(query,params); await db.exec('RESET ROLE'); return result; } catch(e) { throw e; }
}
async function denied(index,query,params=[]) {
  await db.exec('SAVEPOINT denied_action');
  try { await actor(index,query,params); assert.fail('Unauthorized operation succeeded'); }
  catch(e) { await db.exec('ROLLBACK TO SAVEPOINT denied_action; RESET ROLE'); if(e.code==='ERR_ASSERTION') throw e; }
}
async function match(mode='COMPETITIVE', checked=true) {
  const {rows}=await db.query(`insert into public.events(created_by,title,starts_at,match_type,pair_mode) values($1,'Test',now(),'${mode}','NEED_PARTNER') returning id`,[ids[0]]);
  const id=rows[0].id;
  for(let i=0;i<4;i++) await db.query('insert into public.event_participants(event_id,user_id,team) values($1,$2,$3)',[id,ids[i],i<2?'A':'B']);
  if(checked) await db.query("update public.event_participants set attendance_status='CHECKED_IN' where event_id=$1",[id]);
  return id;
}
async function scores() { return (await db.query('select elo_rating,reliability_score from public.profiles order by id')).rows; }
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to public;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for(const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) {
    let sql=await readFile(`supabase/migrations/${file}`,'utf8');
    // Neither extension is used by the schema's types. gen_random_uuid is native in PostgreSQL.
    // Cloud retains its installed extensions; all application SQL below runs unchanged.
    sql=sql.replace(/create extension if not exists (pgcrypto|citext);/g,'');
    // Reproduce the active cloud's legacy text columns and extra score fields as a second test run.
    if(process.env.MUSMATCH_TEST_CLOUD_DRIFT === '1' && file==='20260513_phase0_alignment.sql') {
      sql=sql.replaceAll('match_type public.match_type not null', 'match_type text not null').replaceAll('pair_mode public.pair_mode not null','pair_mode text not null');
    }
    try { await db.exec(sql); if(process.env.MUSMATCH_TEST_CLOUD_DRIFT === '1' && file==='20260513_phase0_alignment.sql') await db.exec('alter table public.profiles add column elo integer default 1000, add column wins integer default 0, add column losses integer default 0, add column games_played integer default 0'); } catch(e) { throw new Error(`Migration ${file}: ${e.message}`,{cause:e}); }
  }
}, {timeout:60000});
after(async()=>{ await db?.close(); });
beforeEach(async()=>{
  await db.exec('BEGIN');
  for(let i=0;i<ids.length;i++) await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[ids[i],JSON.stringify({username:`test${i}`})]);
});
afterEach(async()=>{await db.exec('ROLLBACK');});

test('profile update is limited to own display fields',async()=>{
  await actor(0,'update public.profiles set full_name=$1 where id=$2',['Player',ids[0]]);
  assert.equal((await db.query('select full_name from public.profiles where id=$1',[ids[0]])).rows[0].full_name,'Player');
  for(const column of ['is_admin','elo_rating','reliability_score']) await denied(0,`update public.profiles set ${column}=${column} where id=$1`,[ids[0]]);
  if(process.env.MUSMATCH_TEST_CLOUD_DRIFT === '1') for(const column of ['elo','wins','losses','games_played']) await denied(0,`update public.profiles set ${column}=999 where id=$1`,[ids[0]]);
  const result=await actor(0,'update public.profiles set full_name=$1 where id=$2',['Intruder',ids[1]]);
  assert.equal(result.affectedRows,0);
  await denied(4,'insert into public.profiles(id,is_admin) values($1,true)',[ids[4]]);
});
test('events and friendships cannot be forged by direct browser writes',async()=>{
  const id=await match();
  await denied(0,"update public.events set result_status='CONFIRMED',winner_team='A' where id=$1",[id]);
  await denied(0,'insert into public.friendships(user_id,friend_id) values($1,$2)',[ids[0],ids[1]]);
});
test('internal rating, presence and impersonation functions are not browser APIs',async()=>{
  for(const signature of ['apply_match_elo(uuid,public.team_side)','recalculate_presence_for_event(uuid)','resolve_pending_results_by_timeout()','_internal_set_actor(uuid)','internal_get_event(uuid)']) {
    const {rows}=await db.query('select has_function_privilege($1,$2,$3) as allowed',['authenticated',`public.${signature}`,'EXECUTE']);
    assert.equal(rows[0].allowed,false,signature);
  }
  const {rows}=await db.query("select has_function_privilege('anon','public.submit_team_result(uuid,public.team_side,text)','EXECUTE') as allowed");
  assert.equal(rows[0].allowed,false);
});
test('four seats, two per team, no forged presence or changing another player',async()=>{
  const id=await match('FRIENDLY',false);
  await denied(4,'insert into public.event_participants(event_id,user_id,team) values($1,$2,\'A\')',[id,ids[4]]);
  await denied(0,"update public.event_participants set attendance_status='CHECKED_IN' where event_id=$1 and user_id=$2",[id,ids[0]]);
  const changed=await actor(0,"update public.event_participants set team='A' where event_id=$1 and user_id=$2",[id,ids[2]]);
  assert.equal(changed.affectedRows,0);
  await denied(0,"update public.event_participants set team='B' where event_id=$1 and user_id=$2",[id,ids[0]]);
});
test('joining and queue assignment remain available to participants only',async()=>{
  const {rows}=await actor(0,"select public.create_match_with_rules('Test',null,now(),null,'FRIENDLY','NEED_PARTNER',null,'EIGHT_KINGS',40,3,1,null) as id");
  const id=rows[0].id;
  await denied(4,'select public.assign_team($1)',[id]);
  await actor(1,'select public.join_queue($1)',[id]);
  await actor(1,'select public.assign_team($1)',[id]);
  assert.equal((await db.query('select count(*)::int as n from public.event_participants where event_id=$1',[id])).rows[0].n,2);
});
test('competitive results require presence and complete teams',async()=>{
  const id=await match('COMPETITIVE',false);
  await denied(0,"select public.submit_team_result($1,'A','3-1')",[id]);
  await db.query("update public.event_participants set attendance_status='CHECKED_IN' where event_id=$1",[id]);
  await denied(4,"select public.submit_team_result($1,'A','3-1')",[id]);
  await denied(0,"select public.submit_team_result($1,'A','')",[id]);
});
for(const winner of ['A','B']) test(`matching ${winner} victory changes ELO once; legacy confirmation cannot bypass rival`,async()=>{
  const id=await match();
  await actor(0,'select public.submit_team_result($1,$2,$3)',[id,winner,'3-1']);
  await denied(1,'select public.confirm_match_and_update_elo($1)',[id]);
  await denied(2,'select public.confirm_match_and_update_elo($1)',[id]);
  await actor(2,'select public.submit_team_result($1,$2,$3)',[id,winner,'3-1']);
  const s=await scores();assert.equal(s[0].elo_rating,winner==='A'?1016:984);assert.equal(s[2].elo_rating,winner==='A'?984:1016);
  await denied(2,'select public.submit_team_result($1,$2,$3)',[id,winner,'3-1']);
  assert.deepEqual(await scores(),s);
  assert.ok((await db.query('select elo_applied_at from public.events where id=$1',[id])).rows[0].elo_applied_at);
  await denied(0,'delete from public.event_participants where event_id=$1 and user_id=$2',[id,ids[0]]);
});
test('friendly matches keep ELO unchanged',async()=>{
  const id=await match('FRIENDLY',false);const before=await scores();
  await actor(0,"select public.submit_team_result($1,'A','3-1')",[id]);await actor(2,"select public.submit_team_result($1,'A','3-1')",[id]);
  assert.deepEqual(await scores(),before);
});
test('dispute is neutral and only an admin can resolve it, once',async()=>{
  const id=await match();const before=await scores();
  await actor(0,"select public.submit_team_result($1,'A','3-1')",[id]);await actor(2,"select public.submit_team_result($1,'B','1-3')",[id]);
  assert.deepEqual(await scores(),before);
  await denied(0,"select public.review_match_dispute($1,'A','Reportes y presencia revisados',true)",[id]);
  await db.query('update public.profiles set is_admin=true where id=$1',[ids[5]]);
  await actor(5,"select public.review_match_dispute($1,'A','Reportes y presencia revisados',true)",[id]);const resolved=await scores();
  await denied(5,"select public.review_match_dispute($1,'A','Reportes y presencia revisados',true)",[id]);assert.deepEqual(await scores(),resolved);
});
test('expired unanswered report requires review without rating or reliability penalties',async()=>{
  const id=await match();const before=await scores();await actor(0,"select public.submit_team_result($1,'A','3-1')",[id]);
  await db.query("update public.events set result_pending_deadline=now()-interval '1 minute' where id=$1",[id]);
  assert.equal((await db.query('select public.resolve_pending_results_by_timeout() as n')).rows[0].n,1);
  assert.deepEqual(await scores(),before);
  const e=(await db.query('select result_status,result_resolution_reason from public.events where id=$1',[id])).rows[0];
  assert.equal(e.result_status,'DISPUTED');assert.equal(e.result_resolution_reason,'TIMEOUT_REQUIRES_REVIEW');
  assert.equal((await db.query('select public.resolve_pending_results_by_timeout() as n')).rows[0].n,0);
});
test('presence codes reject own/same-team/reused/expired codes and roster changes invalidate proof',async()=>{
  const id=await match('COMPETITIVE',false);
  const token=(await actor(0,'select public.create_presence_token($1) as data',[id])).rows[0].data.token;
  const attempt=async(i)=> (await actor(i,'select public.submit_presence_token($1,$2) as result',[id,token])).rows[0].result;
  assert.equal(await attempt(0),'TOKEN_OWN_USER');assert.equal(await attempt(1),'TOKEN_SAME_TEAM');
  assert.equal(await attempt(2),'PROOF_ACCEPTED');assert.equal(await attempt(3),'TOKEN_ALREADY_USED');
  await actor(0,'delete from public.event_participants where event_id=$1 and user_id=$2',[id,ids[0]]);
  assert.equal((await db.query('select count(*)::int as n from public.event_presence_proofs where event_id=$1',[id])).rows[0].n,0);
  await actor(0,"insert into public.event_participants(event_id,user_id,team) values($1,$2,'A')",[id,ids[0]]);
  const tokenB=(await actor(2,'select public.create_presence_token($1) as data',[id])).rows[0].data.token;
  await db.query("update public.event_presence_tokens set expires_at=now()-interval '1 minute' where event_id=$1",[id]);
  assert.equal((await actor(1,'select public.submit_presence_token($1,$2) as result',[id,tokenB])).rows[0].result,'TOKEN_EXPIRED');
});
test('admin overview hides rows from regular users and exposes them to admins',async()=>{
  await match();assert.equal((await actor(0,'select * from public.admin_event_presence_overview')).rows.length,0);
  await db.query('update public.profiles set is_admin=true where id=$1',[ids[5]]);
  assert.equal((await actor(5,'select * from public.admin_event_presence_overview')).rows.length,1);
  await db.exec('SAVEPOINT anonymous_read; SET LOCAL ROLE anon');
  await assert.rejects(db.query('select * from public.events_with_counts'));
  await db.exec('ROLLBACK TO SAVEPOINT anonymous_read; RESET ROLE');
});
test('four real cross-code checks unlock competitive reporting',async()=>{
  const id=await match('COMPETITIVE',false);
  for(const [owner,scanner] of [[0,2],[2,0],[1,3],[3,1]]) {
    const token=(await actor(owner,'select public.create_presence_token($1) as data',[id])).rows[0].data.token;
    assert.equal((await actor(scanner,'select public.submit_presence_token($1,$2) as result',[id,token])).rows[0].result,'PROOF_ACCEPTED');
  }
  assert.equal((await db.query("select count(*)::int as n from public.event_participants where event_id=$1 and attendance_status='CHECKED_IN'",[id])).rows[0].n,4);
  await actor(0,"select public.submit_team_result($1,'A','3-1')",[id]);
  await actor(2,"select public.submit_team_result($1,'A','3-1')",[id]);
  assert.equal((await db.query('select result_status from public.events where id=$1',[id])).rows[0].result_status,'CONFIRMED');
});
test('repeated pair-vs-pair matches reduce ELO impact and eventually stop changing it',async()=>{
  for(const multiplier of [1,0.75,0.5,0.25,0]) {
    const id=await match();const prior=await scores();
    await actor(0,"select public.submit_team_result($1,'A','3-1')",[id]);await actor(2,"select public.submit_team_result($1,'A','3-1')",[id]);
    const e=(await db.query('select elo_multiplier,elo_final_delta from public.events where id=$1',[id])).rows[0];
    assert.equal(Number(e.elo_multiplier),multiplier);
    if(multiplier===0) assert.deepEqual(await scores(),prior);
  }
});
test('friend requests and fixed-pair creation still work through authorized RPCs',async()=>{
  await actor(0,'select public.send_friend_request($1)',[ids[1]]);
  const request=(await actor(1,'select id from public.friend_requests')).rows[0].id;
  await denied(0,'select public.accept_friend_request($1)',[request]);
  await actor(1,'select public.accept_friend_request($1)',[request]);
  const id=(await actor(0,"select public.create_match_with_rules('Pair',null,now()+interval '1 hour',null,'FRIENDLY','FIXED_PAIR',$1,'EIGHT_KINGS',40,3,1,null) as id",[ids[1]])).rows[0].id;
  assert.equal((await db.query('select count(*)::int as n from public.event_participants where event_id=$1',[id])).rows[0].n,1);
  const invite=(await actor(1,'select id from public.match_invitations where event_id=$1',[id])).rows[0].id;
  await denied(0,'select public.respond_match_invitation($1,true)',[invite]);
  await actor(1,'select public.respond_match_invitation($1,true)',[invite]);
  assert.equal((await db.query('select count(*)::int as n from public.event_participants where event_id=$1',[id])).rows[0].n,2);
  await actor(0,'select public.remove_friend($1)',[ids[1]]);
  assert.equal((await actor(0,'select * from public.friendships')).rows.length,0);
});
test('only the author can withdraw a legacy proposal and it cannot erase team reports',async()=>{
  const id=await match('FRIENDLY',false);
  await db.query("update public.events set result_status='PENDING',status='CLOSED',result_proposed_by=$2,winner_team='A',result_score='3-1' where id=$1",[id,ids[0]]);
  await denied(2,'select public.withdraw_legacy_result($1)',[id]);
  await actor(0,'select public.withdraw_legacy_result($1)',[id]);
  assert.equal((await db.query('select result_status from public.events where id=$1',[id])).rows[0].result_status,null);
  await actor(0,"select public.submit_team_result($1,'A','3-1')",[id]);
  await denied(0,'select public.withdraw_legacy_result($1)',[id]);
});

async function rulesMatch(variant='EIGHT_KINGS',points=40,games=3,vacas=1,mode='COMPETITIVE',house=null) {
 return (await actor(0,"select public.create_match_with_rules('Rules',null,now(),null,$1,'NEED_PARTNER',null,$2,$3,$4,$5,$6) as id",[mode,variant,points,games,vacas,house])).rows[0].id;
}
async function completeRulesMatch(games=3,vacas=1,mode='COMPETITIVE') {
 const id=await rulesMatch('EIGHT_KINGS',40,games,vacas,mode);
 for(let i=1;i<4;i++){await actor(i,'select public.join_queue($1)',[id]);await actor(i,'select public.assign_team($1)',[id]);}
 await db.query("update public.event_participants set attendance_status='CHECKED_IN' where event_id=$1",[id]);
 return id;
}
test('every supported rules combination is stored and exposed with invoker RLS',async()=>{
 for(const variant of ['EIGHT_KINGS','FOUR_KINGS'])for(const points of [30,40])for(const games of [1,2,3,4])for(const vacas of [1,2,3]){
  const id=await rulesMatch(variant,points,games,vacas,'FRIENDLY','Sin juego real');
  const row=(await actor(1,'select * from public.events_with_counts where id=$1',[id])).rows[0];
  assert.equal(row.rules_version,1);assert.equal(row.rules_variant,variant);assert.equal(row.points_per_game,points);assert.equal(row.games_to_win,games);assert.equal(row.vacas_to_win,vacas);assert.equal(row.house_rules,'Sin juego real');assert.equal(row.players_count,1);
 }
 await db.exec('SAVEPOINT anon_read; SET LOCAL ROLE anon');
 await assert.rejects(db.query('select * from public.events_with_counts'));
 await db.exec('ROLLBACK TO SAVEPOINT anon_read; RESET ROLE');
});
test('invalid or missing rules roll back creation and legacy browser creation is disabled',async()=>{
 const cases=[['TEN_KINGS',40,3,1,null],[null,40,3,1,null],['EIGHT_KINGS',null,3,1,null],['EIGHT_KINGS',35,3,1,null],['EIGHT_KINGS',40,0,1,null],['EIGHT_KINGS',40,5,1,null],['EIGHT_KINGS',40,3,0,null],['EIGHT_KINGS',40,3,4,null],['EIGHT_KINGS',40,3,1,'x'.repeat(1001)]];
 for(const args of cases)await denied(0,"select public.create_match_with_rules('Invalid',null,now(),null,'FRIENDLY','NEED_PARTNER',null,$1,$2,$3,$4,$5)",args);
 await denied(0,"select public.create_match_with_partner('Old',null,now(),null,'FRIENDLY','NEED_PARTNER',null)");
 assert.equal((await db.query('select count(*)::int n from public.events')).rows[0].n,0);
});
test('rules contract and match type are immutable; historical rules remain unknown',async()=>{
 const id=await rulesMatch();
 await denied(0,"update public.events set games_to_win=4 where id=$1",[id]);
 for(const update of ["games_to_win=4","rules_variant='FOUR_KINGS'","points_per_game=30","vacas_to_win=2","house_rules='Otra regla'","match_type='FRIENDLY'","rules_version=0"]){
  await db.exec('SAVEPOINT immutable');await assert.rejects(db.query(`update public.events set ${update} where id=$1`,[id]),/fijados/);await db.exec('ROLLBACK TO SAVEPOINT immutable');
 }
 const old=await match();const row=(await db.query('select rules_version,rules_variant from public.events where id=$1',[old])).rows[0];assert.equal(row.rules_version,0);assert.equal(row.rules_variant,null);
 assert.equal((await db.query("select has_function_privilege('authenticated','public.guard_match_rules()','EXECUTE') allowed")).rows[0].allowed,false);
});
for(const winner of ['A','B'])test(`structured ${winner} result validates score and applies ELO once`,async()=>{
 const id=await completeRulesMatch(2);const score=winner==='A'?'2-1':'1-2';
 for(const invalid of ['3-1','2-2','1-1','0-0','1.5-2','02-1','4-0','text'])await denied(0,'select public.submit_team_result($1,$2,$3)',[id,winner,invalid]);
 await denied(0,'select public.submit_team_result($1,$2,$3)',[id,winner,winner==='A'?'1-2':'2-1']);
 await actor(0,'select public.submit_team_result($1,$2,$3)',[id,winner,score]);
 await actor(1,'select public.submit_team_result($1,$2,$3)',[id,winner,score]);
 const row=(await db.query('select result_status,result_score,winner_team from public.events where id=$1',[id])).rows[0];assert.equal(row.result_status,'CONFIRMED');assert.equal(row.result_score,score);assert.equal(row.winner_team,winner);
 const before=await scores();await denied(1,'select public.submit_team_result($1,$2,$3)',[id,winner,score]);assert.deepEqual(await scores(),before);
});
test('multi-vaca score counts vacas; friendly results do not move ELO',async()=>{
 const id=await completeRulesMatch(4,2,'FRIENDLY');const before=await scores();
 await denied(0,"select public.submit_team_result($1,'A','4-1')",[id]);
 await actor(0,"select public.submit_team_result($1,'A','2-1')",[id]);await actor(1,"select public.submit_team_result($1,'A','2-1')",[id]);assert.deepEqual(await scores(),before);
});
test('structured disputed score is neutral and admin resolution preserves chosen report',async()=>{
 const id=await completeRulesMatch();const before=await scores();
 await actor(0,"select public.submit_team_result($1,'A','3-1')",[id]);await actor(1,"select public.submit_team_result($1,'B','0-3')",[id]);assert.deepEqual(await scores(),before);
 await db.query('update public.profiles set is_admin=true where id=$1',[ids[5]]);
 await actor(5,"select public.review_match_dispute($1,'A','Reportes y presencia revisados',true)",[id]);
 const row=(await db.query('select result_status,result_score,winner_team from public.events where id=$1',[id])).rows[0];assert.deepEqual(row,{result_status:'CONFIRMED',result_score:'3-1',winner_team:'A'});
});

test('presence codes live two minutes, reuse only in cooldown and rotation invalidates old QR',async()=>{
 const id=await match('COMPETITIVE',false);
 const first=(await actor(0,'select public.create_presence_token($1) as data',[id])).rows[0].data;
 const record=(await db.query('select created_at,expires_at from public.event_presence_tokens where event_id=$1',[id])).rows[0];
 assert.equal(new Date(record.expires_at)-new Date(record.created_at),120000);
 assert.equal((await actor(0,'select public.create_presence_token($1) as data',[id])).rows[0].data.token,first.token);
 await db.query("update public.event_presence_tokens set created_at=now()-interval '31 seconds' where event_id=$1",[id]);
 const second=(await actor(0,'select public.create_presence_token($1) as data',[id])).rows[0].data;
 assert.notEqual(second.token,first.token);
 assert.equal((await actor(2,'select public.submit_presence_token($1,$2) as r',[id,first.token])).rows[0].r,'TOKEN_EXPIRED');
 assert.equal((await actor(2,'select public.submit_presence_token($1,$2) as r',[id,second.token])).rows[0].r,'PROOF_ACCEPTED');
 const status=(await actor(0,'select public.get_my_presence_token_status($1) as data',[id])).rows[0].data;assert.equal(status.token,null);assert.ok(status.next_refresh_at);
 await denied(0,'select public.create_presence_token($1)',[id]);
});
test('presence is bound to game, four assigned seats and active undisputed state',async()=>{
 const id=await match('COMPETITIVE',false);
 const other=await match('COMPETITIVE',false);
 const token=(await actor(0,'select public.create_presence_token($1) as data',[id])).rows[0].data.token;
 assert.equal((await actor(2,'select public.submit_presence_token($1,$2) as r',[other,token])).rows[0].r,'TOKEN_NOT_FOUND');
 await actor(0,'delete from public.event_participants where event_id=$1 and user_id=$2',[other,ids[0]]);
 await denied(2,'select public.create_presence_token($1)',[other]);
 await denied(2,'select public.submit_presence_token($1,$2)',[other,token]);
 await denied(4,'select public.create_presence_token($1)',[id]);
 await denied(4,'select public.submit_presence_token($1,$2)',[id,token]);
 await db.query("update public.events set result_status='DISPUTED' where id=$1",[id]);
 await denied(0,'select public.create_presence_token($1)',[id]);
 await denied(2,'select public.submit_presence_token($1,$2)',[id,token]);
 assert.equal((await actor(0,'select public.get_my_presence_token_status($1) as data',[id])).rows[0].data.token,null);
});
async function locatedMatch(type='PRIVATE_LOCATION',extra={}) {
 return (await actor(0,`select public.create_match_v2('Prueba ubicación','Gazalbide',now()+interval '1 hour',null,'FRIENDLY','NEED_PARTNER',null,'EIGHT_KINGS',40,3,1,null,$1::jsonb) as id`,[JSON.stringify({type,address:'Dirección secreta 42',authorized:true,...extra})])).rows[0].id;
}
test('private addresses require accepted membership and disappear from direct reads after leaving',async()=>{
 const id=await locatedMatch();assert.equal((await actor(0,'select address from public.match_locations where event_id=$1',[id])).rows[0].address,'Dirección secreta 42');
 assert.equal((await actor(4,'select * from public.match_locations where event_id=$1',[id])).rows.length,0);
 assert.equal((await actor(4,'select location_text from public.events where id=$1',[id])).rows[0].location_text,'Lugar privado · Gazalbide');
 await db.query('insert into public.friendships(user_id,friend_id) values($1,$2)',[ids[0],ids[1]]);await actor(0,"select public.invite_match_player($1,$2,'A')",[id,ids[1]]);
 assert.equal((await actor(1,'select * from public.match_locations where event_id=$1',[id])).rows.length,0);
 const inv=(await actor(1,'select id from public.match_invitations')).rows[0].id;await actor(1,'select public.respond_match_invitation($1,true)',[inv]);
 assert.equal((await actor(1,'select * from public.match_locations where event_id=$1',[id])).rows.length,1);
 await actor(1,'delete from public.event_participants where event_id=$1 and user_id=$2',[id,ids[1]]);assert.equal((await actor(1,'select * from public.match_locations where event_id=$1',[id])).rows.length,0);
 await denied(0,"update public.match_locations set address='changed' where event_id=$1",[id]);await denied(4,"insert into public.venues(name,status,verified_at) values('Fake','COLLABORATOR',now())");
});
test('creation rejects missing authorization, invalid coordinates and past dates atomically',async()=>{
 for(const loc of [{type:'PRIVATE_LOCATION',address:'Secret',authorized:false},{type:'PUBLIC_VENUE',address:'Bar',authorized:true,latitude:42},{type:'PUBLIC_VENUE',address:'Bar',authorized:true,latitude:999,longitude:0}])await denied(0,`select public.create_match_v2('Invalid','Zona',now()+interval '1 hour',null,'FRIENDLY','NEED_PARTNER',null,'EIGHT_KINGS',40,3,1,null,$1::jsonb)`,[JSON.stringify(loc)]);
 await denied(0,`select public.create_match_v2('Invalid','Zona',now()-interval '1 hour',null,'FRIENDLY','NEED_PARTNER',null,'EIGHT_KINGS',40,3,1,null,'{"type":"PUBLIC_VENUE","address":"Bar","authorized":true}')`);
 assert.equal((await db.query('select count(*)::int as n from public.events')).rows[0].n,0);
});
test('public locations are discoverable and candidate venues cannot be promoted by clients',async()=>{
 const id=await locatedMatch('PUBLIC_VENUE');assert.equal((await actor(4,'select * from public.match_locations where event_id=$1',[id])).rows.length,1);
 assert.equal((await actor(4,"select * from public.venues where status='COLLABORATOR'")).rows.length,0);await denied(0,"select public.claim_place_search($1,'anything')",[ids[0]]);
 assert.equal((await db.query("select has_table_privilege('anon','public.match_locations','SELECT') as allowed")).rows[0].allowed,false);
});
test('invitation rejection, capacity and replay never enrol players without consent',async()=>{
 const id=await locatedMatch('PUBLIC_VENUE');await db.query('insert into public.friendships(user_id,friend_id) values($1,$2),($1,$3)',[ids[0],ids[1],ids[4]]);
 await denied(2,"select public.invite_match_player($1,$2,'A')",[id,ids[1]]);await actor(0,"select public.invite_match_player($1,$2,'A')",[id,ids[1]]);
 let inv=(await actor(1,'select id from public.match_invitations')).rows[0].id;assert.equal((await actor(2,'select * from public.match_invitations')).rows.length,0);
 await denied(2,'select public.respond_match_invitation($1,true)',[inv]);await actor(1,'select public.respond_match_invitation($1,false)',[inv]);await denied(1,'select public.respond_match_invitation($1,true)',[inv]);
 await actor(0,"select public.invite_match_player($1,$2,'A')",[id,ids[1]]);await actor(0,"select public.invite_match_player($1,$2,'A')",[id,ids[4]]);await actor(1,'select public.respond_match_invitation($1,true)',[inv]);
 inv=(await actor(4,'select id from public.match_invitations')).rows[0].id;await denied(4,'select public.respond_match_invitation($1,true)',[inv]);assert.equal((await db.query('select count(*)::int as n from public.event_participants where event_id=$1',[id])).rows[0].n,2);
});
test('organizer cancellation closes invitations and presence without rating penalties',async()=>{
 const id=await locatedMatch('PUBLIC_VENUE'),before=await scores();await db.query('insert into public.friendships(user_id,friend_id) values($1,$2)',[ids[0],ids[1]]);await actor(0,"select public.invite_match_player($1,$2,'A')",[id,ids[1]]);
 const inv=(await actor(1,'select id from public.match_invitations')).rows[0].id;await denied(1,"select public.cancel_match($1,'Ya no puedo asistir')",[id]);await denied(0,"select public.cancel_match($1,'x')",[id]);await actor(0,"select public.cancel_match($1,'Ya no puedo asistir')",[id]);
 assert.equal((await db.query('select status from public.events where id=$1',[id])).rows[0].status,'CANCELLED');await denied(1,'select public.respond_match_invitation($1,true)',[inv]);await denied(1,"insert into public.event_participants(event_id,user_id,team) values($1,$2,'A')",[id,ids[1]]);assert.deepEqual(await scores(),before);
});
test('review voids without penalties, requires reason and cannot be forged or replayed',async()=>{
 const id=await match();await actor(0,"select public.submit_team_result($1,'A','3-1')",[id]);await actor(2,"select public.submit_team_result($1,'B','1-3')",[id]);const before=await scores();await db.query('update public.profiles set is_admin=true where id=$1',[ids[5]]);
 await denied(0,"select public.review_match_dispute($1,'VOID','No se puede acreditar el resultado',false)",[id]);await denied(5,"select public.review_match_dispute($1,'VOID','x',false)",[id]);await denied(5,"select public.admin_resolve_dispute($1,'A',true)",[id]);
 await actor(5,"select public.review_match_dispute($1,'VOID','No se puede acreditar el resultado',true)",[id]);assert.deepEqual(await scores(),before);assert.equal((await actor(0,'select applied_elo from public.match_reviews where event_id=$1',[id])).rows[0].applied_elo,false);
 assert.equal((await actor(4,'select * from public.match_reviews where event_id=$1',[id])).rows.length,0);await denied(5,"select public.review_match_dispute($1,'A','Repetición no permitida',true)",[id]);await denied(0,"insert into public.match_reviews(event_id,reviewer_id,decision,reason,applied_elo) values($1,$2,'VOID','Motivo falsificado',false)",[id,ids[0]]);
});
test('provider cache and global throttling are shared and cannot be bypassed by browsers',async()=>{
 assert.deepEqual((await db.query("select public.claim_place_search($1,'name:first') as gate",[ids[0]])).rows[0].gate,{});assert.equal((await db.query("select public.claim_place_search($1,'name:second') as gate",[ids[1]])).rows[0].gate.busy,true);
 await db.query("insert into public.place_search_cache(cache_key,results,expires_at) values('name:first','[{\"name\":\"cached\"}]',now()+interval '1 day')");assert.equal((await db.query("select public.claim_place_search($1,'name:first') as gate",[ids[1]])).rows[0].gate.cached[0].name,'cached');await denied(0,'select * from public.place_search_cache');await denied(0,"update public.place_search_limits set next_at=now()-interval '1 day'");
});
test('unreported and cancelled games never count as losses in profile history',async()=>{
 const id=await match('FRIENDLY',false);assert.equal((await actor(0,'select result from public.user_match_history where match_id=$1',[id])).rows[0].result,'PENDING');await actor(0,"select public.cancel_match($1,'No se celebra la partida')",[id]);assert.equal((await actor(0,'select result from public.user_match_history where match_id=$1',[id])).rows[0].result,'CANCELLED');
});

async function simulation(){
 await db.query('insert into public.simulation_operators(user_id) values($1)',[ids[0]]);
 for(let i=1;i<4;i++) {await db.query('update public.profiles set is_mock=true where id=$1',[ids[i]]);await db.query('insert into public.simulation_actors(user_id,owner_id,slot) values($1,$2,$3)',[ids[i],ids[0],i]);}
 return (await actor(0,'select public.create_simulation() as id')).rows[0].id;
}
async function simAction(id,slot,action,token=null,winner=null,score=null){return (await actor(0,'select public.simulate_player_action($1,$2,$3,$4,$5,$6) as result',[id,slot,action,token,winner,score])).rows[0].result;}
test('simulator capability cannot be self-granted, targets only registered mocks and never a real match',async()=>{
 await denied(0,'select public.create_simulation()');
 await denied(0,'insert into public.simulation_operators(user_id) values($1)',[ids[0]]);
 const real=await match();const id=await simulation();
 await denied(4,'select public.get_simulation_state($1)',[id]);
 await denied(4,"select public.simulate_player_action($1,2,'GENERATE_TOKEN')",[id]);
 await denied(0,"select public.simulate_player_action($1,2,'GENERATE_TOKEN')",[real]);
 await denied(0,"select public.simulate_player_action($1,4,'GENERATE_TOKEN')",[id]);
 await denied(0,"select public.simulate_player_action($1,2,'BECOME_ADMIN')",[id]);
 await denied(4,"insert into public.event_participants(event_id,user_id,team) values($1,$2,'B')",[id,ids[4]]);
 assert.equal((await actor(4,'select * from public.events where id=$1',[id])).rows.length,0);
 assert.equal((await actor(4,'select * from public.event_participants where event_id=$1',[id])).rows.length,0);
 assert.equal((await actor(0,'select * from public.events_with_counts where id=$1',[id])).rows.length,0);
 await denied(0,'update public.events set simulation_owner_id=$2 where id=$1',[real,ids[0]]);
 for(const name of ['apply_match_elo_live(uuid,public.team_side)','guard_simulation_roster()'])assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') as ok",['public.'+name])).rows[0].ok,false);
});
test('manual mock QR follows rival, expiry and single-use rules and restores caller identity',async()=>{
 const id=await simulation();const rival=await simAction(id,2,'GENERATE_TOKEN');
 assert.equal((await simAction(id,2,'SCAN_TOKEN',rival.token)).status,'TOKEN_OWN_USER');
 assert.equal((await simAction(id,3,'SCAN_TOKEN',rival.token)).status,'TOKEN_SAME_TEAM');
 const own=(await actor(0,'select public.create_presence_token($1) as token',[id])).rows[0].token;
 assert.equal((await simAction(id,2,'SCAN_TOKEN',own.token)).status,'PROOF_ACCEPTED');
 assert.equal((await simAction(id,2,'SCAN_TOKEN',own.token)).status,'TOKEN_ALREADY_USED');
 await actor(0,'select public.submit_presence_token($1,$2)',[id,rival.token]);
 assert.equal((await actor(0,'select auth.uid() as id')).rows[0].id,ids[0]);
 // Catch and roll back the rejected operation; the outer actor must still be the owner.
 await denied(0,"select public.simulate_player_action($1,1,'REPORT',null,'A','3-1')",[id]);
 assert.equal((await actor(0,'select auth.uid() as id')).rows[0].id,ids[0]);
 const expired=await simAction(id,3,'GENERATE_TOKEN');
 await db.query("update public.event_presence_tokens set expires_at=now()-interval '1 second' where event_id=$1 and token=$2",[id,expired.token]);
 assert.equal((await simAction(id,1,'SCAN_TOKEN',expired.token)).status,'TOKEN_EXPIRED');
 const snapshot=(await actor(0,'select public.get_simulation_state($1) state',[id])).rows[0].state;
 assert.equal(snapshot.players.find(p=>p.slot===3).token,null);
});
for(const winner of ['A','B'])test(`simulated ${winner} win updates only private ELO preview and leaves real profiles untouched`,async()=>{
 const id=await simulation(),before=await scores();
 await actor(0,'select public.simulate_all_presence($1)',[id]);
 assert.equal((await db.query("select count(*)::int n from public.event_participants where event_id=$1 and attendance_status='CHECKED_IN'",[id])).rows[0].n,4);
 const score=winner==='A'?'3-1':'1-3';
 await actor(0,'select public.submit_team_result($1,$2,$3)',[id,winner,score]);
 await simAction(id,2,'REPORT',null,winner,score);
 const state=(await actor(0,'select public.get_simulation_state($1) as state',[id])).rows[0].state;
 assert.equal(state.event.result_status,'CONFIRMED');assert.equal(state.event.elo_applied_at,null);
 assert.equal(state.scores.find(s=>s.user_id===ids[0]).delta,winner==='A'?16:-16);
 assert.deepEqual(await scores(),before);
 assert.equal((await actor(0,'select * from public.user_match_history where match_id=$1',[id])).rows.length,0);
 await denied(0,"select public.simulate_player_action($1,2,'REPORT',null,'A','3-1')",[id]);
 assert.deepEqual(await scores(),before);
});
test('simulated incompatible reports require real admin review, neutral cancellation and no ELO leakage',async()=>{
 const id=await simulation(),before=await scores();await actor(0,'select public.simulate_all_presence($1)',[id]);
 await actor(0,"select public.submit_team_result($1,'A','3-1')",[id]);await simAction(id,2,'REPORT',null,'B','1-3');
 await denied(0,"select public.review_match_dispute($1,'VOID','Pruebas insuficientes',false)",[id]);
 await db.query('update public.profiles set is_admin=true where id=$1',[ids[0]]);
 await actor(0,"select public.review_match_dispute($1,'VOID','Pruebas insuficientes',false)",[id]);
 assert.equal((await db.query('select status from public.events where id=$1',[id])).rows[0].status,'CANCELLED');assert.deepEqual(await scores(),before);
});
test('simulated timeout is scoped to the owners trial and does not run the global scheduler',async()=>{
 const real=await match(),id=await simulation();await actor(0,'select public.simulate_all_presence($1)',[id]);
 await actor(0,"select public.submit_team_result($1,'A','3-1')",[id]);
 await denied(4,'select public.expire_simulation_result($1)',[id]);await denied(0,'select public.expire_simulation_result($1)',[real]);
 await actor(0,'select public.expire_simulation_result($1)',[id]);
 assert.equal((await db.query('select result_status from public.events where id=$1',[id])).rows[0].result_status,'DISPUTED');assert.equal((await db.query('select result_status from public.events where id=$1',[real])).rows[0].result_status,null);
});
test('mock leaving invalidates presence, incomplete tables cannot validate, and new trials preserve old evidence',async()=>{
 const id=await simulation();await actor(0,'select public.simulate_all_presence($1)',[id]);await simAction(id,3,'LEAVE');
 assert.equal((await db.query('select count(*)::int n from public.event_presence_proofs where event_id=$1',[id])).rows[0].n,0);
 await denied(0,'select public.simulate_all_presence($1)',[id]);await simAction(id,3,'JOIN');
 await actor(0,'select public.simulate_all_presence($1)',[id]);
 const next=(await actor(0,'select public.create_simulation() as id')).rows[0].id;assert.notEqual(next,id);
 assert.equal((await db.query('select count(*)::int n from public.event_presence_proofs where event_id=$1',[id])).rows[0].n,4);
 assert.equal((await db.query('select count(*)::int n from public.event_presence_proofs where event_id=$1',[next])).rows[0].n,0);
 await db.query('update public.simulation_operators set enabled=false where user_id=$1',[ids[0]]);
 await denied(0,'select public.get_simulation_state($1)',[id]);
});
test('simulated review victory computes private points; trial identity and mock role stay protected',async()=>{
 const id=await simulation(),before=await scores();await actor(0,'select public.simulate_all_presence($1)',[id]);await actor(0,"select public.submit_team_result($1,'A','3-1')",[id]);await simAction(id,2,'REPORT',null,'B','1-3');
 await db.query('update public.profiles set is_admin=true where id=$1',[ids[0]]);await actor(0,"select public.review_match_dispute($1,'B','Se acepta el reporte del equipo B',true)",[id]);
 assert.deepEqual(await scores(),before);assert.equal((await actor(0,'select public.get_simulation_state($1) s',[id])).rows[0].s.scores.find(s=>s.user_id===ids[0]).delta,-16);
 await denied(0,'update public.profiles set is_mock=false where id=$1',[ids[1]]);
 await db.exec('SAVEPOINT immutable_simulation');await assert.rejects(db.query('update public.events set simulation_owner_id=null where id=$1',[id]));await db.exec('ROLLBACK TO SAVEPOINT immutable_simulation');
 const real=(await actor(4,"select public.create_match_with_rules('Real',null,now(),null,'FRIENDLY','NEED_PARTNER',null,'EIGHT_KINGS',40,3,1,null) id")).rows[0].id;
 await denied(1,"insert into public.event_participants(event_id,user_id,team) values($1,$2,'B')",[real,ids[1]]);
});

const subscription=(suffix='one')=>({endpoint:`https://fcm.googleapis.com/fcm/send/${suffix}`,keys:{p256dh:'B'.repeat(87),auth:'A'.repeat(22)}});
async function device(i=0,suffix='one') {return (await actor(i,'select public.register_push_subscription($1,$2) as id',[JSON.stringify(subscription(suffix)),'Synthetic device'])).rows[0].id;}
async function inbox(i=0) {return (await actor(i,'select * from public.notifications order by created_at,id')).rows;}
async function enqueue(i=0) {await actor(i,'select public.request_test_notification()');}
async function claim(){return (await db.query('select public.claim_push_batch(30) as jobs')).rows[0].jobs;}
test('notifications are own-row only, read state is scoped, and server secrets/endpoints stay private',async()=>{
 await device();await enqueue();const rows=await inbox();assert.equal(rows.length,1);assert.equal((await inbox(1)).length,0);
 await actor(1,'select public.mark_notifications_read($1)',[[rows[0].id]]);assert.equal((await inbox())[0].read_at,null);
 await actor(0,'select public.mark_notifications_read($1)',[[rows[0].id]]);assert.ok((await inbox())[0].read_at);
 for(const table of ['notifications','notification_preferences','push_subscriptions']) await denied(0,`delete from public.${table}`);
 await denied(0,'select endpoint from public.push_subscriptions');await denied(0,'select * from musmatch_private.push_runtime');
 for(const f of ['push_runtime_config()','claim_push_batch(integer)','initialize_push_runtime(text,text)','finish_push_delivery(uuid,uuid,integer)','dispatch_push_notifications()']) {
  assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') as allowed",['public.'+f])).rows[0].allowed,false);
 }
 await db.exec('savepoint no_anon; set local role anon');await assert.rejects(db.query('select * from public.notifications'));await db.exec('rollback to savepoint no_anon; reset role');
});
test('subscription validation prevents SSRF, endpoint theft, forged preferences and unbounded devices',async()=>{
 const sid=await device();assert.equal(await device(),sid);
 await denied(1,'select public.register_push_subscription($1)',[JSON.stringify(subscription())]);
 for(const url of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://fcm.googleapis.com.evil.test/x','https://fcm.googleapis.com@127.0.0.1/x','https://fcm.googleapis.com:444/x']) await denied(0,'select public.register_push_subscription($1)',[JSON.stringify({...subscription(),endpoint:url})]);
 await denied(0,'select public.save_notification_preferences($1)',[JSON.stringify({user_id:ids[1]})]);
 await denied(0,'select public.save_notification_preferences($1)',[JSON.stringify({push_enabled:'true'})]);
 for(let i=2;i<=10;i++)await device(0,String(i));await denied(0,'select public.register_push_subscription($1)',[JSON.stringify(subscription('eleven'))]);
 await actor(1,'select public.remove_push_subscription($1)',[sid]);assert.equal((await db.query('select count(*)::int n from public.push_subscriptions')).rows[0].n,10);
 await actor(0,'select public.remove_push_subscription($1)',[sid]);assert.equal((await db.query('select count(*)::int n from public.push_subscriptions')).rows[0].n,9);
});
test('invitations and roster events produce inbox notices without unsolicited push opt-in',async()=>{
 const eid=await match('FRIENDLY',false);
 await db.query('delete from public.event_participants where event_id=$1 and user_id=$2',[eid,ids[1]]);
 await db.query("update public.events set starts_at=now()+interval '3 hours' where id=$1",[eid]);
 await db.query('insert into public.friendships(user_id,friend_id) values($1,$2)',[ids[0],ids[1]]);
 await actor(0,"select public.invite_match_player($1,$2,'A')",[eid,ids[1]]);
 const invites=(await inbox(1)).filter(x=>x.category==='invitations');assert.equal(invites.length,1);
 assert.equal((await db.query('select count(*)::int n from musmatch_private.push_outbox')).rows[0].n,0);
 const inv=(await db.query('select id from public.match_invitations where event_id=$1',[eid])).rows[0].id;
 await actor(1,'select public.respond_match_invitation($1,true)',[inv]);
 assert.ok((await inbox(0)).some(x=>x.body.includes('incorporado')));
});
test('results notify only missing rival reporters; final results and cancellation supersede pending pushes',async()=>{
 const eid=await match();await db.exec('delete from public.notifications');await device(2,'rival');
 await actor(0,"select public.submit_team_result($1,'A','3-1')",[eid]);
 assert.equal((await inbox(0)).length,0);assert.equal((await inbox(1)).length,0);
 assert.equal((await inbox(2)).filter(n=>n.category==='results').length,1);assert.equal((await inbox(3)).length,1);
 await actor(2,"select public.submit_team_result($1,'A','3-1')",[eid]);
 assert.equal((await inbox(2)).filter(n=>n.title==='Resultado confirmado').length,1);
 const jobs=await claim();assert.equal(jobs.length,1);assert.equal(jobs[0].category,'results');
 assert.equal((await db.query("select count(*)::int n from musmatch_private.push_outbox where state='SKIPPED'")).rows[0].n,1);
});
test('dispute, reasoned review and cancellation notifications preserve neutrality and pending invitees',async()=>{
 const eid=await match();await db.exec('delete from public.notifications');
 await db.query('update public.profiles set is_admin=true where id=$1',[ids[5]]);
 await actor(0,"select public.submit_team_result($1,'A','3-1')",[eid]);await actor(2,"select public.submit_team_result($1,'B','1-3')",[eid]);
 assert.equal((await inbox(5)).filter(n=>n.title==='Partida en revisión').length,1);
 await actor(5,"select public.review_match_dispute($1,'VOID','No hay pruebas suficientes',false)",[eid]);
 for(let i=0;i<4;i++) assert.ok((await inbox(i)).some(n=>n.title==='Partida cancelada'));
 assert.equal((await scores())[0].elo_rating,1000);
});
test('push leases prevent duplicate claims, stale acknowledgements and retry terminal failures',async()=>{
 await device();await enqueue();const [job]=await claim();assert.ok(job.lease_token);assert.equal((await claim()).length,0);
 await db.query('select public.finish_push_delivery($1,$2,201)',[job.id,'00000000-0000-4000-8000-000000000099']);
 assert.equal((await db.query('select state from musmatch_private.push_outbox')).rows[0].state,'SENDING');
 await db.query('select public.finish_push_delivery($1,$2,503)',[job.id,job.lease_token]);
 assert.equal((await db.query('select state from musmatch_private.push_outbox')).rows[0].state,'PENDING');
 await db.exec("update musmatch_private.push_outbox set available_at=now()-interval '1 second'");
 const [retry]=await claim();assert.notEqual(retry.lease_token,job.lease_token);
 await db.query('select public.finish_push_delivery($1,$2,410)',[retry.id,retry.lease_token]);
 assert.equal((await db.query('select count(*)::int n from public.push_subscriptions')).rows[0].n,0);
});
test('preferences opt out of queued push, read notices skip delivery, test sends are rate limited',async()=>{
 await device();await enqueue();await denied(0,'select public.request_test_notification()');
 await actor(0,'select public.save_notification_preferences($1)',[JSON.stringify({push_enabled:false})]);assert.equal((await claim()).length,0);
 await actor(0,'select public.save_notification_preferences($1)',[JSON.stringify({push_enabled:true,matches:false})]);
 const eid=await match();assert.equal((await inbox(0)).filter(n=>n.category==='matches').length,0);
 await db.exec('delete from public.notifications');await enqueue();await actor(0,'select public.mark_notifications_read()');assert.equal((await claim()).length,0);
 await db.query("update public.events set starts_at=now()+interval '20 minutes' where id=$1",[eid]);
 await actor(0,'select public.save_notification_preferences($1)',[JSON.stringify({reminders:false})]);
 await db.query('select public.enqueue_match_reminders()');assert.equal((await inbox(0)).filter(n=>n.category==='reminders').length,0);
});
test('reminders are deduplicated and leaving the table invalidates queued reminders',async()=>{
 const eid=await match('FRIENDLY',false);await db.query("update public.events set starts_at=now()+interval '30 minutes' where id=$1",[eid]);
 await db.exec('delete from public.notifications');await device(1,'leaver');
 await db.query('select public.enqueue_match_reminders()');await db.query('select public.enqueue_match_reminders()');
 assert.equal((await inbox(1)).filter(n=>n.category==='reminders').length,1);
 await actor(1,'delete from public.event_participants where event_id=$1 and user_id=$2',[eid,ids[1]]);
 assert.equal((await claim()).length,0);
});
test('simulator trials and mock actions never generate real inbox or push traffic',async()=>{
 await db.query('insert into public.simulation_operators(user_id) values($1)',[ids[0]]);
 for(let i=1;i<4;i++){
  await db.query('update public.profiles set is_mock=true where id=$1',[ids[i]]);
  await db.query('insert into public.simulation_actors(owner_id,user_id,slot) values($1,$2,$3)',[ids[0],ids[i],i]);
 }
 await device();const eid=(await actor(0,'select public.create_simulation() id')).rows[0].id;
 await actor(0,'select public.simulate_all_presence($1)',[eid]);
 await actor(0,"select public.submit_team_result($1,'A','3-1')",[eid]);
 await actor(0,"select public.simulate_player_action($1,2,'REPORT',null,'A','3-1')",[eid]);
 assert.equal((await db.query('select count(*)::int n from public.notifications')).rows[0].n,0);assert.equal((await claim()).length,0);
});

async function pilotMatch(mode='COMPETITIVE') {
 const eid=(await actor(0,"select public.create_match_with_rules('Field pilot',null,now()+interval '2 hours',null,$1,'NEED_PARTNER',null,'EIGHT_KINGS',40,3,1,null) id",[mode])).rows[0].id;
 for(let i=1;i<4;i++)await actor(i,'insert into public.event_participants(event_id,user_id,team) values($1,$2,$3)',[eid,ids[i],i<2?'A':'B']);
 return eid;
}
async function pilotState(i,eid){return (await actor(i,'select public.get_pilot_match_state($1) data',[eid])).rows[0].data;}
async function reportIssue(i=0,{eid=null,title='Camera unavailable',env={platform:'ANDROID',browser:'CHROME',display:'APP'}}={}){
 return (await actor(i,'select public.report_pilot_issue($1,$2,$3,$4,$5,$6,$7,$8) id',[eid,'PRESENCE','NORMAL',title,'Open the scanner and allow camera','The QR scanner starts','The camera does not start',JSON.stringify(env)])).rows[0].id;
}
test('pilot opt-in is organizer-only and does not alter match rules, roster, rating or status',async()=>{
 const eid=await pilotMatch();const before=(await db.query('select * from public.events where id=$1',[eid])).rows[0],rating=await scores();
 assert.equal(await pilotState(0,eid),null);await denied(1,'select public.enroll_pilot_match($1)',[eid]);
 await actor(0,'select public.enroll_pilot_match($1)',[eid]);await actor(0,'select public.enroll_pilot_match($1)',[eid]);
 assert.equal((await db.query('select count(*)::int n from public.pilot_matches')).rows[0].n,1);assert.deepEqual((await db.query('select * from public.events where id=$1',[eid])).rows[0],before);assert.deepEqual(await scores(),rating);
 assert.equal((await pilotState(1,eid)).players.length,4);assert.equal(await pilotState(4,eid),null);
 await db.query('update public.profiles set is_admin=true where id=$1',[ids[5]]);assert.ok(await pilotState(5,eid));
 await actor(1,'delete from public.event_participants where event_id=$1 and user_id=$2',[eid,ids[1]]);assert.equal(await pilotState(1,eid),null);
});
test('pilot excludes legacy, cancelled and mock games instead of claiming simulated field validation',async()=>{
 const legacy=await match();await denied(0,'select public.enroll_pilot_match($1)',[legacy]);
 const eid=await pilotMatch();await db.query('update public.profiles set is_mock=true where id=$1',[ids[1]]);await denied(0,'select public.enroll_pilot_match($1)',[eid]);
 await db.query('update public.profiles set is_mock=false where id=$1',[ids[1]]);await actor(0,'select public.cancel_match($1,$2)',[eid,'No real pilot this evening']);await denied(0,'select public.enroll_pilot_match($1)',[eid]);
 await db.query('insert into public.simulation_operators(user_id) values($1)',[ids[0]]);for(let i=1;i<4;i++){await db.query('update public.profiles set is_mock=true where id=$1',[ids[i]]);await db.query('insert into public.simulation_actors(owner_id,user_id,slot) values($1,$2,$3)',[ids[0],ids[i],i]);}
 const sim=(await actor(0,'select public.create_simulation() id')).rows[0].id;await denied(0,'select public.enroll_pilot_match($1)',[sim]);
});
test('pilot state follows real cross-checks and matching reports without exposing tokens or private locations',async()=>{
 const eid=await pilotMatch();await actor(0,'select public.enroll_pilot_match($1)',[eid]);
 assert.equal((await pilotState(0,eid)).players.filter(p=>p.checked_in).length,0);
 for(const [owner,scanner] of [[0,2],[2,0],[1,3],[3,1]]){const token=(await actor(owner,'select public.create_presence_token($1) data',[eid])).rows[0].data.token;await actor(scanner,'select public.submit_presence_token($1,$2)',[eid,token]);}
 let state=await pilotState(0,eid);assert.equal(state.players.filter(p=>p.checked_in).length,4);assert.ok(!JSON.stringify(state).includes('token'));assert.ok(!JSON.stringify(state).includes('address'));
 await actor(0,"select public.submit_team_result($1,'A','3-1')",[eid]);state=await pilotState(1,eid);assert.equal(state.report_a,true);assert.equal(state.report_b,false);assert.equal(state.elo_applied,false);
 await actor(2,"select public.submit_team_result($1,'A','3-1')",[eid]);state=await pilotState(0,eid);assert.equal(state.result_status,'CONFIRMED');assert.equal(state.elo_applied,true);
});
test('pilot issue content is private to reporter and admin; event references and metadata cannot be forged',async()=>{
 const eid=await pilotMatch();const iid=await reportIssue(0,{eid});assert.equal((await actor(0,'select * from public.pilot_issues')).rows.length,1);assert.equal((await actor(1,'select * from public.pilot_issues')).rows.length,0);
 await denied(4,'select public.report_pilot_issue($1,$2,$3,$4,$5,$6,$7,$8)',[eid,'OTHER','NORMAL','Foreign match','Steps to reproduce','Expected result','Actual result','{}']);
 for(const env of [{token:'private'},{platform:'ANDROID',browser:'CHROME',display:'BAD'},{platform:null},{browser:{jwt:'secret'}},{platform:'user-defined-value'}])await denied(0,'select public.report_pilot_issue(null,$1,$2,$3,$4,$5,$6,$7)',['OTHER','NORMAL','Bad metadata','Steps to reproduce','Expected','Actual result',JSON.stringify(env)]);
 await denied(0,"update public.pilot_issues set status='RESOLVED' where id=$1",[iid]);await denied(0,'delete from public.pilot_issues where id=$1',[iid]);await denied(0,'delete from public.pilot_matches');
 await db.query('update public.profiles set is_admin=true where id=$1',[ids[5]]);assert.equal((await actor(5,'select * from public.pilot_issues')).rows.length,1);
 await db.exec('savepoint pilot_anon;set local role anon');await assert.rejects(db.query('select * from public.pilot_issues'));await db.exec('rollback to savepoint pilot_anon;reset role');
});
test('incident retries deduplicate and rate limiting cannot be bypassed by direct writes',async()=>{
 const iid=await reportIssue();assert.equal(await reportIssue(),iid);
 for(let i=1;i<5;i++)await reportIssue(0,{title:'Different issue '+i});
 await denied(0,'select public.report_pilot_issue(null,$1,$2,$3,$4,$5,$6,$7)',['OTHER','NORMAL','Sixth report','Steps to reproduce','Expected','Actual result','{}']);
 await denied(0,'insert into public.pilot_issues(reporter_id,category,severity,title,steps,expected,actual) values($1,$2,$3,$4,$5,$6,$7)',[ids[0],'OTHER','NORMAL','Direct insert','Steps to reproduce','Expected','Actual result']);
 assert.equal((await db.query('select count(*)::int n from public.pilot_issues')).rows[0].n,5);
});
test('only a current admin can triage; notes are mandatory and stale reviews do not overwrite a newer revision',async()=>{
 const iid=await reportIssue();await denied(0,'select public.review_pilot_issue($1,$2,$3,0)',[iid,'RESOLVED','Issue fixed and retested']);
 await db.query('update public.profiles set is_admin=true where id=$1',[ids[5]]);await denied(5,'select public.review_pilot_issue($1,$2,$3,0)',[iid,'RESOLVED','short']);
 await actor(5,'select public.review_pilot_issue($1,$2,$3,0)',[iid,'IN_PROGRESS','Investigating the reported camera problem']);
 await denied(5,'select public.review_pilot_issue($1,$2,$3,0)',[iid,'DISMISSED','Stale browser request must not win']);
 await actor(5,'select public.review_pilot_issue($1,$2,$3,1)',[iid,'RESOLVED','Fixed and verified with the reporter']);const row=(await actor(0,'select status,revision,review_note from public.pilot_issues where id=$1',[iid])).rows[0];assert.equal(row.status,'RESOLVED');assert.equal(row.revision,2);assert.ok(row.review_note.includes('verified'));
 await db.query('update public.profiles set is_admin=false where id=$1',[ids[5]]);await denied(5,'select public.review_pilot_issue($1,$2,$3,2)',[iid,'OPEN','Attempt after administrative role removal']);
});
