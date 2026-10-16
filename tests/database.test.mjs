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
  await denied(0,"select public.admin_resolve_dispute($1,'A',true)",[id]);
  await db.query('update public.profiles set is_admin=true where id=$1',[ids[5]]);
  await actor(5,"select public.admin_resolve_dispute($1,'A',true)",[id]);const resolved=await scores();
  await denied(5,"select public.admin_resolve_dispute($1,'A',true)",[id]);assert.deepEqual(await scores(),resolved);
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
  const id=(await actor(0,"select public.create_match_with_rules('Pair',null,now(),null,'FRIENDLY','FIXED_PAIR',$1,'EIGHT_KINGS',40,3,1,null) as id",[ids[1]])).rows[0].id;
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
 await actor(5,"select public.admin_resolve_dispute($1,'A',true)",[id]);
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
