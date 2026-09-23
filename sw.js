const CACHE='reis-v12';
const ASSETS=[
  './','./index.html','./manifest.webmanifest',
  './icons/icon-192.png','./icons/icon-512.png',
  './icons/maskable-512.png','./icons/apple-touch-icon.png',
  './artwork/welcome.png','./artwork/journey.png',
  './vendor/leaflet/leaflet.js','./vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png'
];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(async c=>{
    await Promise.allSettled(ASSETS.map(u=>c.add(u).catch(()=>{})));
  }).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(ks=>Promise.all(ks.filter(k=>k.startsWith('reis-')&&k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);

  if(url.hostname.endsWith('entur.io')){
    e.respondWith(fetch(req));
    return;
  }

  if(url.hostname.includes('cartocdn.com')||url.hostname.includes('opentopomap.org')||
     url.hostname.includes('arcgisonline.com')||url.hostname.includes('openstreetmap')||
     url.hostname.includes('gstatic.com')||url.hostname.includes('googleapis.com')||
     url.hostname.includes('unpkg.com')){
    e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{
      if(r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(req,c));}return r;
    }).catch(()=>hit)));
    return;
  }

  if(url.origin===self.location.origin){
    e.respondWith(fetch(req).catch(()=>caches.match(req).then(h=>h||
      (req.mode==='navigate'?caches.match('./index.html'):Response.error()))));
  }
});
