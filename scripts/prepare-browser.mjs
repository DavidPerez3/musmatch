// Bundled npm Chromium avoids a separate browser-CDN download in restricted environments.
import {readFile, writeFile, mkdir, chmod} from 'node:fs/promises';
import {brotliDecompressSync} from 'node:zlib';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const entry=require.resolve('@sparticuz/chromium');
const binary=new URL('../bin/chromium.br', `file://${entry}`);
await mkdir('.browser', {recursive:true});
await writeFile('.browser/chromium', brotliDecompressSync(await readFile(binary)));
await chmod('.browser/chromium', 0o755);
