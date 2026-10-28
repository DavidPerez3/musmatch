import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const base=process.env.NEXT_PUBLIC_BASE_PATH||'';
const origin='https://davidperez3.github.io';
const html=p=>readFile(`out/${p}`,'utf8');
test('public discovery pages have unique titles, descriptions and scoped canonicals',async()=>{
 for(const [path,title] of [['index.html','Organiza tu próxima'],['help/index.html','Ayuda y preguntas']]){
  const s=await html(path);assert.match(s,new RegExp(`<title>${title}`));assert.match(s,/<meta name="description" content="[^"]+"/);
  assert.ok(s.includes(`rel="canonical" href="${origin}${base}/${path.startsWith('help')?'help/':''}"`));
  assert.match(s,/<meta property="og:locale" content="es_ES"/);assert.match(s,/<meta property="og:url" content="https:\/\/davidperez3.github.io/);
  assert.match(s,/<meta name="robots" content="index, follow"/);
 }
 assert.match(await html('index.html'),/Cuatro personas/);
});
test('account, player and parameterized match pages cannot be indexed and leak no match OG data',async()=>{
 for(const route of ['login','reset-password','create','events','my-matches','profile','rankings','users','admin','simulator','notifications','pilot','privacy','terms']){
  const s=await html(`${route}/index.html`);assert.match(s,/<meta name="robots" content="noindex, nofollow"/);assert.ok(!s.includes('rel="canonical"'));
  assert.ok(!s.includes('20000000-0000'));assert.ok(!s.includes('correo.muy.largo'));
 }
});
test('sitemap is a strict public allowlist and robots advertises the scoped sitemap',async()=>{
 const sitemap=await html('sitemap.xml');assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(m=>m[1]),[`${origin}${base}/`,`${origin}${base}/help/`]);
 const robots=await html('robots.txt');assert.ok(robots.includes(`Sitemap: ${origin}${base}/sitemap.xml`));assert.ok(!robots.includes('Disallow:'));
});
test('Pages 404 is exported with absolute scoped recovery links and no indexing',async()=>{
 const s=await html('404.html');assert.match(s,/Esta carta no está en la mesa/);assert.match(s,/noindex/);
 assert.ok(s.includes(`href="${base}/"`));assert.ok(s.includes(`href="${base}/?buscar=1#partidas"`));
 assert.ok(s.includes(`${base}/_next/static/`));assert.ok(!s.includes('window.location.replace'));
});
