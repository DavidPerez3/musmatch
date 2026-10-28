import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=await readFile('src/lib/authReturn.ts','utf8');
function setup(blocked=false){
 const values=new Map();const exports={};
 const sessionStorage={getItem:k=>values.get(k),setItem:(k,v)=>{if(blocked)throw Error('Denied');values.set(k,v)},removeItem:k=>values.delete(k)};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,sessionStorage,Date});
 return {api:exports,values};
}
const match='/events/?id=20000000-0000-0000-0000-000000000001';
test('auth returns accept only fixed app destinations and a single UUID match',()=>{
 const {api}=setup();for(const v of [match,'/create/','/?buscar=1#partidas'])assert.equal(api.safeReturnPath(v),v);
 for(const v of [null,'https://evil.test/','//evil.test','/admin/','/events/?id=bad',match+'&next=https://evil.test',match+'#token','/%2f%2fevil','/musmatch'+match,42,{}]) assert.equal(api.safeReturnPath(v),null);
});
test('OAuth destination is one-shot, expires and tolerates unavailable storage',()=>{
 const {api,values}=setup();api.rememberAuthReturn(match);assert.equal(api.consumeAuthReturn(),match);assert.equal(api.consumeAuthReturn(),null);
 values.set('musmatch-auth-return',JSON.stringify({path:match,expires:Date.now()-1}));assert.equal(api.consumeAuthReturn(),null);
 values.set('musmatch-auth-return',JSON.stringify({path:'https://evil.test',expires:Date.now()+99999}));assert.equal(api.consumeAuthReturn(),null);
 values.set('musmatch-auth-return','bad json');assert.equal(api.consumeAuthReturn(),null);
 api.rememberAuthReturn(match);api.rememberAuthReturn(null);assert.equal(api.consumeAuthReturn(),null);
 assert.doesNotThrow(()=>setup(true).api.rememberAuthReturn(match));
});
