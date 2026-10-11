'use strict';
// Liten statisk server for ende-til-ende-testene, uten avhengigheter: `node tests/e2e/serve.js`.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..','..'),PORT=+process.env.PORT||8130;
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
http.createServer((req,res)=>{
  const url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  let file=path.normalize(path.join(ROOT,url));
  if(!file.startsWith(ROOT+path.sep)&&file!==ROOT){res.writeHead(403).end();return;}
  if(url.endsWith('/'))file=path.join(file,'index.html');
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  });
}).listen(PORT,()=>console.log(`REIS på http://localhost:${PORT}/`));
