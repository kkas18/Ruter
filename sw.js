const CACHE='reis-v23';
const ASSETS=[
  './','./index.html','./manifest.webmanifest','./css/app.css','./js/mapstyle.js',
  './js/i18n.js','./js/core.js','./js/base.js','./js/map.js','./js/sheet.js','./js/components.js','./js/floatcard.js','./js/pages.js','./js/data.js','./js/live.js','./js/main.js',
  './vendor/fonts/schibsted-grotesk-latin.woff2',
  './vendor/maplibre/maplibre-gl.js','./vendor/maplibre/maplibre-gl.css',
  './icons/mark.svg','./icons/icon-192.png','./icons/icon-512.png',
  './icons/maskable-512.png','./icons/apple-touch-icon.png'
];
const MAP_HOSTS=['tiles.openfreemap.org','server.arcgisonline.com'];
const MAX_TILES=2000;

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>Promise.allSettled(ASSETS.map(u=>c.add(u))))
    .then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys()
    .then(ks=>Promise.all(ks.filter(k=>k.startsWith('reis-')&&k!==CACHE&&k!=='reis-map').map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

// Kartdata (fliser, skrift, tilejson): cache først med et tak, så kartet virker
// i områder du har sett, også uten nett.
async function mapAsset(req){
  const c=await caches.open('reis-map');
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
  if(MAP_HOSTS.includes(url.hostname)){
    // tilejson peker på dagens flisversjon: hent fersk når mulig.
    if(url.pathname==='/planet')e.respondWith(fetch(req).then(r=>{const c=r.clone();caches.open('reis-map').then(x=>x.put(req,c));return r;}).catch(()=>caches.match(req)));
    else e.respondWith(mapAsset(req));
    return;
  }
  if(url.origin===self.location.origin){
    // Nett først slik at oppdateringer når fram; cache som reserve når man er frakoblet.
    e.respondWith(fetch(req).then(r=>{
      if(r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(req,c));}
      return r;
    }).catch(()=>caches.match(req).then(h=>h||(req.mode==='navigate'?caches.match('./index.html'):Response.error()))));
  }
});

// Trykk på varselet «Gå nå»: vis appen som allerede er åpen, ellers åpne den.
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    const c=cs.find(x=>'focus' in x);return c?c.focus():self.clients.openWindow('./');}));
});
