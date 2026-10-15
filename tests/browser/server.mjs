import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('out');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain'};
http.createServer(async(req,res)=>{
 try {
  let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(!pathname.startsWith('/musmatch/')){res.writeHead(404).end();return;}
  pathname=pathname.slice('/musmatch'.length);
  if(pathname.endsWith('/'))pathname+='index.html';
  const target=path.resolve(root, '.'+pathname);
  if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  const data=await readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream'}).end(data);
 }catch{res.writeHead(404).end();}
}).listen(4173,'127.0.0.1');
