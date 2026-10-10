const CACHE='reis-v14';
const ASSETS=[
  './','./index.html','./manifest.webmanifest','./css/app.css','./js/app.js',
  './vendor/fonts/schibsted-grotesk-latin.woff2',
  './icons/mark.svg','./icons/icon-192.png','./icons/icon-512.png',
  './icons/maskable-512.png','./icons/apple-touch-icon.png',
  './vendor/leaflet/leaflet.js','./vendor/leaflet/leaflet.css'
];
const TILE_HOSTS=['cache.kartverket.no','arcgisonline.com'];
const MAX_TILES=600;

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>Promise.allSettled(ASSETS.map(u=>c.add(u))))
    .then(()=>self.skipWaiting()));
});

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(ks=>Promise.all(ks.filter(k=>k.startsWith('reis-')&&k!==CACHE&&k!=='reis-tiles').map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

// Kartfliser: cache først, med et enkelt tak så lagringen ikke vokser fritt.
async function tile(req){
  const c=await caches.open('reis-tiles');
  const hit=await c.match(req);
  if(hit)return hit;
  const r=await fetch(req);
  if(r.ok){
    await c.put(req,r.clone());
    const keys=await c.keys();
    if(keys.length>MAX_TILES)await Promise.all(keys.slice(0,keys.length-MAX_TILES).map(k=>c.delete(k)));
  }
  return r;
}

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.hostname.endsWith('entur.io'))return; // sanntid går alltid rett til nettet
  if(TILE_HOSTS.some(h=>url.hostname.endsWith(h))){e.respondWith(tile(req));return;}
  if(url.origin===self.location.origin){
    // Nett først slik at oppdateringer når fram; cache som reserve når man er frakoblet.
    e.respondWith(fetch(req).then(r=>{
      if(r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(req,c));}
      return r;
    }).catch(()=>caches.match(req).then(h=>h||(req.mode==='navigate'?caches.match('./index.html'):Response.error()))));
  }
});
