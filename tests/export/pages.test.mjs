import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import path from 'node:path';
const base=process.env.NEXT_PUBLIC_BASE_PATH || '';
test('exported PWA stays inside its app scope',async()=>{
 const manifest=JSON.parse(await readFile('out/manifest.webmanifest','utf8'));
 assert.equal(manifest.start_url,`${base}/`);assert.equal(manifest.scope,`${base}/`);assert.equal(manifest.id,`${base}/`);
 const html=await readFile('out/index.html','utf8');assert.ok(html.includes(`${base}/manifest.webmanifest`));
 for(const icon of manifest.icons){assert.ok(icon.src.startsWith(`${base}/icons/`));const p=path.join('out',icon.src.slice(base.length));const png=await readFile(p);assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,icon.sizes);}
});
test('every public screen is exported and no private server API is published',async()=>{
 for(const route of ['login','reset-password','create','events','my-matches','profile','rankings','users','admin','simulator','notifications','pilot']) await access(`out/${route}/index.html`);
 await assert.rejects(access('out/api'));
 const worker=await readFile('out/sw.js','utf8');assert.ok(worker.includes('url.origin !== ROOT.origin'));assert.ok(worker.includes('event.request.mode === "navigate"'));
 await access('out/offline.html');
});

test('release worker precaches only public immutable assets and is versioned by build',async()=>{
 const worker=await readFile('out/sw.js','utf8');assert.ok(!worker.includes('__MUSMATCH_BUILD__'));assert.ok(!worker.includes('MUSMATCH_PRECACHE'));
 const version=worker.match(/const VERSION = "([a-f0-9]{16})"/);assert.ok(version);
 const paths=JSON.parse(worker.match(/const PRECACHE = (\[[^;]+\]);/)[1]);assert.ok(paths.length>5);for(const p of paths){assert.ok(p.startsWith('_next/static/'));assert.ok(/\.(js|css)$/.test(p));await access(path.join('out',p));}
 assert.ok(!paths.some(p=>p.includes('events/')||p.includes('profile/')||p.includes('auth/')));
});
