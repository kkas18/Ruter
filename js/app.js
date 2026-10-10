'use strict';
/* =====================================================================
   REIS – sanntid og reisesøk for kollektiv i Oslo og omegn
   Datakilder: Entur Journey Planner v3 (GraphQL), Geocoder v3,
   SIRI VM/SX. Kart: Kartverket (gråtone/topo), Esri (flyfoto).
   ===================================================================== */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ico=(id,cls='')=>`<svg class="g ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- Konstanter ---------- */
const API={
  jp:'https://api.entur.io/journey-planner/v3/graphql',
  geocoder:'https://api.entur.io/geocoder/v3/autocomplete',
  reverse:'https://api.entur.io/geocoder/v3/reverse',
  vm:'https://api.entur.io/realtime/v1/rest/vm',
  sx:'https://api.entur.io/realtime/v1/rest/sx',
  client:'nikola-reis-pwa'
};
// Kjente farger for Oslo-trafikken, justert for hvit tekst (WCAG AA).
const MODES={
  bus:{n:'Buss',c:'#C3302A'}, tram:{n:'Trikk',c:'#1F5CB8'}, metro:{n:'T-bane',c:'#B5470B'},
  rail:{n:'Tog',c:'#5845A6'}, water:{n:'Båt',c:'#08737D'}, coach:{n:'Ekspress',c:'#8E2F57'},
  funicular:{n:'Bane',c:'#5D676C'}, cableway:{n:'Bane',c:'#5D676C'}, air:{n:'Fly',c:'#5D676C'}
};
const modeOf=m=>MODES[m]||{n:'Kollektiv',c:'#5D676C'};
const KV='https://cache.kartverket.no/v1/wmts/1.0.0';
const KV_ATTR='&copy; <a href="https://www.kartverket.no/">Kartverket</a>';
const BASEMAPS={
  standard:{url:`${KV}/topograatone/default/webmercator/{z}/{y}/{x}.png`,attr:KV_ATTR,maxNativeZoom:18,invertInDark:true},
  topo:{url:`${KV}/topo/default/webmercator/{z}/{y}/{x}.png`,attr:KV_ATTR,maxNativeZoom:18},
  fly:{url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr:'Tiles &copy; Esri — Maxar, Earthstar Geographics',maxNativeZoom:18}
};
const OSLO=[59.9139,10.7522];
const VEH_MIN_ZOOM=13;
const TITLES={trip:'Reise',dep:'Avganger',map:'Kart',settings:'Mer',alerts:'Trafikkmeldinger'};

/* ---------- Lagring ---------- */
function loadJSON(k,f){try{const v=JSON.parse(localStorage.getItem(k));return v??f;}catch(e){return f;}}
function saveJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
let settings=Object.assign({theme:'auto',walkKmh:4.5,showVehicles:true,showStops:true,
  vibrate:true,refreshSec:45,basemap:'standard'},loadJSON('reisSettings',{}));
if(!BASEMAPS[settings.basemap])settings.basemap='standard'; // «dark» fra tidligere versjon
let favs=loadJSON('reisFavs',[]);
if(!Array.isArray(favs))favs=[];
let recentTargets=loadJSON('reisRecentTargets',[]);
if(!Array.isArray(recentTargets))recentTargets=[];
const saveSettings=()=>saveJSON('reisSettings',settings);

const state={pos:null,heading:null,follow:true,lastNearby:null,stops:[],dest:null,fromSel:null,activeTrip:null,
  activeModes:new Set(Object.keys(MODES)),alerts:[],timeMode:'now'};

/* ---------- Hjelpere ---------- */
function buzz(ms){if(settings.vibrate&&navigator.vibrate)navigator.vibrate(ms);}
let toastTimer=null;
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2800);}
const fmtT=ts=>new Date(ts).toLocaleTimeString('nb-NO',{hour:'2-digit',minute:'2-digit'});
const minUntil=ts=>Math.round((new Date(ts).getTime()-Date.now())/60000);
const plural=(n,one,many)=>n===1?one:many;
const changesText=n=>n===0?'Direkte':`${n} ${plural(n,'bytte','bytter')}`;
// Luftlinje til holdeplass + 30 % omvei.
const walkMin=m=>Math.max(1,Math.ceil(m*1.3/(settings.walkKmh*16.67)));
function reachStatus(distance,departure,now=Date.now()){
  if(distance==null||!Number.isFinite(+departure))return null;
  const remaining=(+departure-now)/60000;
  if(remaining<0)return null;
  const margin=remaining-walkMin(distance)-2;
  if(margin<-3)return{label:'Rekker trolig ikke',cls:'caution'};
  if(margin<0)return{label:'Knapt',cls:'caution'};
  if(margin<3)return{label:'Gå nå',cls:'now'};
  if(margin<11)return{label:`Gå om ${Math.floor(margin)} min`,cls:'soon'};
  return null;
}
function geoDist(a,b){const R=6371000,rad=x=>x*Math.PI/180;
  const dLa=rad(b[0]-a[0]),dLo=rad(b[1]-a[1]);
  const h=Math.sin(dLa/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));}
const fmtDist=m=>m<1000?`${Math.round(m/10)*10} m`:`${(m/1000).toFixed(1).replace('.',',')} km`;
async function fetchWithTimeout(url,opts={},ms=15000){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
  try{return await fetch(url,{...opts,signal:c.signal});}finally{clearTimeout(t);}
}
// Entur bruker «Origin»/«Destination» for koordinatpunkter; vis brukerens egne navn.
function placeName(p,fallback){const n=p?.name;return(!n||/^(origin|destination)$/i.test(n))?fallback:n;}

/* ---------- Nettstatus ---------- */
function setNetworkState(ok,reason=''){
  const chip=$('#netChip');
  chip.hidden=!!ok;
  if(!ok){chip.textContent=reason||'Reisedata utilgjengelig';chip.title='Trykk for å prøve igjen';}
}
function retryConnection(){
  if(state.lastNearby)loadNearby(...state.lastNearby);
  else if(state.pos)loadNearby(...state.pos);
  loadAlerts();applyBasemap(true);
}
$('#netChip').onclick=retryConnection;
if(location.protocol==='file:')$('#setupNotice').hidden=false;
if(!navigator.onLine)setNetworkState(false,'Frakoblet');
addEventListener('offline',()=>setNetworkState(false,'Frakoblet'));
addEventListener('online',retryConnection);

/* ---------- Tema ---------- */
const mqDark=matchMedia('(prefers-color-scheme: dark)');
const resolveTheme=()=>settings.theme==='auto'?(mqDark.matches?'dark':'light'):settings.theme;
let mapReady=false;
function paintTheme(){
  const t=resolveTheme();
  document.documentElement.dataset.theme=t;
  $('meta[name="theme-color"]').content=t==='dark'?'#0F1316':'#F4F2ED';
  $$('#themeSeg button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.t===settings.theme)));
  if(mapReady)applyBasemap();
}
mqDark.addEventListener('change',()=>{if(settings.theme==='auto')paintTheme();});

/* ---------- PWA ---------- */
if(!window.REIS_ANDROID&&'serviceWorker' in navigator&&location.protocol!=='file:')
  addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
let deferredPrompt=null;
addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('#installBtn').hidden=false;});
async function doInstall(){
  buzz(10);
  if(deferredPrompt){deferredPrompt.prompt();const c=await deferredPrompt.userChoice;
    if(c&&c.outcome==='accepted')$('#installBtn').hidden=true;deferredPrompt=null;}
  else toast('Åpne nettlesermenyen og velg «Legg til på startskjermen».');
}
$('#installBtn').onclick=doInstall;
$('#installBtn2').onclick=doInstall;
if(window.REIS_ANDROID||matchMedia('(display-mode: standalone)').matches)$('#installBtn2').hidden=true;

/* ---------- GraphQL ---------- */
async function gql(query,variables={}){
  try{
    const r=await fetchWithTimeout(API.jp,{method:'POST',
      headers:{'Content-Type':'application/json','ET-Client-Name':API.client},
      body:JSON.stringify({query,variables})},20000);
    if(!r.ok)throw new Error(r.status===429?'For mange forespørsler mot Entur. Vent litt.':'Entur svarte '+r.status);
    const j=await r.json();
    if(j.errors&&j.errors.length)throw new Error(j.errors[0].message);
    setNetworkState(true);
    return j.data;
  }catch(e){
    if(e.name==='AbortError'||e instanceof TypeError||!navigator.onLine)
      setNetworkState(false,navigator.onLine?'Entur svarer ikke':'Frakoblet');
    throw e;
  }
}
const Q_DEP=`query($id:String!,$n:Int!){stopPlace(id:$id){id name
  estimatedCalls(numberOfDepartures:$n){
    realtime aimedDepartureTime expectedDepartureTime forBoarding
    destinationDisplay{frontText}
    quay{publicCode}
    serviceJourney{id journeyPattern{line{publicCode transportMode}}}}}}`;
const Q_AUTO=`query($q:String!){
  autocomplete(queryText:$q,layers:[stopPlace],size:8){
    id name locality layer latitude longitude}}`;
// Entur endrer av og til GraphQL-skjemaet. Start med full detalj og fall tilbake trinnvis
// ved valideringsfeil – aldri ved nettfeil.
const Q_TRIP=level=>`query($fl:Float!,$fp:Float!,$tl:Float!,$tp:Float!,$dt:DateTime,$arr:Boolean){
  trip(from:{coordinates:{latitude:$fl,longitude:$fp}},to:{coordinates:{latitude:$tl,longitude:$tp}},
       numTripPatterns:5,dateTime:$dt,arriveBy:$arr){
    tripPatterns{expectedStartTime expectedEndTime duration walkDistance legs{
      mode distance duration expectedStartTime expectedEndTime
      fromPlace{name${level<=1?' quay{publicCode latitude longitude}':''}}
      toPlace{name${level<=1?' quay{publicCode latitude longitude}':''}}
      line{publicCode}
      ${level<=1?'realtime fromEstimatedCall{destinationDisplay{frontText}}':''}
      ${level<3?`intermediateEstimatedCalls{expectedArrivalTime quay{name${level<=1?' latitude longitude':''}}}`:''}
      ${level===0?'pointsOnLink{points}':''}
    }}}}`;
let tripSchemaLevel=0;

/* ---------- Kart ---------- */
const map=L.map('map',{zoomControl:false,attributionControl:false}).setView(OSLO,15);
L.control.attribution({position:'topright',prefix:'<a href="https://leafletjs.com">Leaflet</a>'}).addTo(map);
let tileLayer=null,currentTileKey=null;
const stopsLayer=L.layerGroup().addTo(map);
const vehiclesLayer=L.layerGroup().addTo(map);
const routeLayer=L.layerGroup().addTo(map);
const routeMinorLayer=L.layerGroup().addTo(map);
let userMarker=null,accCircle=null,fromMarker=null,destMarker=null,routeBounds=null;
const vehicleMarkers=new Map();
const mapVisible=()=>$('#view-map').classList.contains('active');

function currentBasemapKey(){return state.activeTrip?'standard':settings.basemap;}
function applyBasemap(force=false){
  const k=currentBasemapKey(),bm=BASEMAPS[k];
  $('#map').classList.toggle('map-dark',resolveTheme()==='dark'&&!!bm.invertInDark);
  if(tileLayer&&currentTileKey===k&&!force)return;
  if(tileLayer)map.removeLayer(tileLayer);
  currentTileKey=k;
  let errors=0;
  $('#mapNotice').hidden=true;
  tileLayer=L.tileLayer(bm.url,{maxZoom:19,maxNativeZoom:bm.maxNativeZoom,attribution:bm.attr})
    .on('tileerror',()=>{if(++errors>=4)$('#mapNotice').hidden=false;})
    .on('tileload',()=>{$('#mapNotice').hidden=true;errors=0;}).addTo(map);
}
$('#retryMapBtn').onclick=()=>applyBasemap(true);
function setFollow(on){state.follow=on;$('#locateBtn').setAttribute('aria-pressed',String(on));}
map.on('dragstart',()=>{if(state.follow)setFollow(false);});
map.on('moveend',()=>debouncedVehicles());
map.on('zoomend',()=>{updateVehHint();updateMinorStops();});
map.on('contextmenu',e=>{
  const ll=e.latlng;buzz(12);
  const popup=L.popup({closeButton:false,className:'pick-popup'}).setLatLng(ll).setContent(
    '<div class="pick"><b>Bruk dette punktet</b><div class="row"><button type="button" data-pick="from">Fra her</button><button type="button" class="to" data-pick="to">Til her</button></div></div>').openOn(map);
  const el=popup.getElement();
  if(!el)return;
  el.querySelectorAll('[data-pick]').forEach(btn=>btn.onclick=()=>{
    buzz(8);tripSearchVersion++;
    const place={name:`Punkt på kartet (${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)})`,lat:ll.lat,lon:ll.lng};
    if(btn.dataset.pick==='from'){state.fromSel=place;setField('#fromInput',place.name);}
    else{state.dest=place;setField('#toInput',place.name);}
    map.closePopup();clearDrawnRoute();setRouteEndpoints();
    if(state.dest&&(state.fromSel||state.pos)){switchView('trip');tripSearch();}
    else toast(btn.dataset.pick==='from'?'Startpunkt valgt. Velg et mål.':'Mål valgt. Velg et startpunkt.');
  });
});
function setField(sel,val){const i=$(sel);i.value=val;i.dataset.set=val?'1':'';}

$('#locateBtn').onclick=()=>{buzz(8);
  if(!state.pos){requestGeoOnce();toast('Henter posisjonen din…');return;}
  setFollow(true);
  map.flyTo(state.pos,Math.max(map.getZoom(),16),{duration:reduceMotion.matches?0:.6});};
function setRouteEndpoints(){
  if(fromMarker){fromMarker.remove();fromMarker=null;}
  if(destMarker){destMarker.remove();destMarker=null;}
  const add=(place,kind)=>{
    if(!place||!Number.isFinite(+place.lat)||!Number.isFinite(+place.lon))return null;
    return L.marker([+place.lat,+place.lon],{title:place.name,icon:L.divIcon({className:'',
      html:`<div class="pin ${kind}">${kind==='from'?'A':'B'}</div>`,iconSize:[30,30],iconAnchor:[15,15]}),zIndexOffset:800}).addTo(map);
  };
  // Når starten er «Min posisjon» er posisjonsmarkøren selve startpunktet.
  fromMarker=add(state.fromSel,'from');
  destMarker=add(state.dest,'to');
}
function clearDrawnRoute(){
  routeLayer.clearLayers();routeMinorLayer.clearLayers();routeBounds=null;
  $('#routeOverview').hidden=true;
  state.activeTrip=null;
  document.body.dataset.route='';
  setSheetOpen(false);
  applyBasemap();applyStops();renderSheet();
}
function fitWholeRoute(){
  if(!routeBounds)return;
  setFollow(false);
  map.invalidateSize();
  map.fitBounds(routeBounds,{paddingTopLeft:[28,90],paddingBottomRight:[28,250],maxZoom:16,animate:!reduceMotion.matches});
}
$('#routeFit').onclick=()=>{buzz(6);fitWholeRoute();};
$('#routeClose').onclick=()=>{buzz(6);clearDrawnRoute();setRouteEndpoints();};
$('#searchFab').onclick=()=>{buzz(8);switchView('trip');setTimeout(()=>$('#toInput').focus(),260);};
function setVehicles(on){
  settings.showVehicles=on;saveSettings();
  if(!on){vehiclesLayer.clearLayers();vehicleMarkers.clear();}
  else refreshVehicles();
  updateVehHint();
}

/* ---------- Posisjon ---------- */
let geoFailed=false;
function handlePos(p){
  geoFailed=false;
  const lat=p.coords.latitude,lon=p.coords.longitude,acc=Math.round(p.coords.accuracy||0);
  state.pos=[lat,lon];
  state.heading=(p.coords.heading!=null&&!isNaN(p.coords.heading))?p.coords.heading:null;
  $('#geoWarn').hidden=true;
  if(!userMarker){
    userMarker=L.marker([lat,lon],{keyboard:false,icon:L.divIcon({className:'',iconSize:[44,44],iconAnchor:[22,22],
      html:'<div class="me"><div class="halo"></div><div class="cone"></div><div class="core"></div></div>'}),zIndexOffset:1000}).addTo(map);
    accCircle=L.circle([lat,lon],{radius:acc||20,color:'#2F6FEB',weight:1,opacity:.3,fillColor:'#2F6FEB',fillOpacity:.07,interactive:false}).addTo(map);
    if(!routeBounds)map.setView([lat,lon],16);
  }else{
    userMarker.setLatLng([lat,lon]);accCircle.setLatLng([lat,lon]).setRadius(acc||20);
  }
  const mk=userMarker.getElement()?.querySelector('.me');
  if(mk){mk.classList.toggle('has-heading',state.heading!=null);
    if(state.heading!=null)mk.querySelector('.cone').style.transform=`rotate(${state.heading}deg)`;}
  userMarker.unbindTooltip().bindTooltip(`Du er her${acc?` · ±${acc} m`:''}`);
  if(state.follow&&!routeBounds)map.panTo([lat,lon],{animate:!reduceMotion.matches});
  if(!state.lastNearby||geoDist(state.lastNearby,[lat,lon])>80)loadNearby(lat,lon);
}
function showGeoWarn(){
  const w=$('#geoWarn');
  w.innerHTML=`<b>Posisjonen er av</b>Avgangene vises for Oslo sentrum. Slå på posisjon i nettleseren for holdeplassene rundt deg.
    <div class="row"><button class="btn btn-ink btn-sm press" id="geoRetry" type="button">Prøv igjen</button>
    <button class="btn btn-line btn-sm press" id="geoClose" type="button">Lukk</button></div>`;
  w.hidden=false;
  $('#geoRetry').onclick=()=>{buzz(8);requestGeoOnce();};
  $('#geoClose').onclick=()=>{buzz(6);w.hidden=true;};
}
function requestGeoOnce(){
  if(!('geolocation' in navigator)){toast('Enheten støtter ikke posisjon.');return;}
  navigator.geolocation.getCurrentPosition(p=>{handlePos(p);startGeo();},
    ()=>toast('Fikk ikke tilgang til posisjon. Sjekk tillatelsene.'),
    {enableHighAccuracy:true,timeout:15000});
}
let geoWatch=null;
function startGeo(){
  if(!('geolocation' in navigator)){geoFallback();return;}
  if(geoWatch!=null)return;
  geoWatch=navigator.geolocation.watchPosition(handlePos,geoFallback,
    {enableHighAccuracy:true,maximumAge:8000,timeout:20000});
}
function geoFallback(err){
  if(err&&err.code===err.PERMISSION_DENIED&&geoWatch!=null){navigator.geolocation.clearWatch(geoWatch);geoWatch=null;}
  if(geoFailed||state.pos)return;geoFailed=true;
  showGeoWarn();
  if(!state.lastNearby)loadNearby(OSLO[0],OSLO[1]);
}

/* ---------- Holdeplasser i nærheten ---------- */
let nearbyVersion=0;
async function loadNearby(lat,lon){
  const version=++nearbyVersion;
  state.lastNearby=[lat,lon];
  const pinned=state.stops.filter(s=>s.pinned);
  try{
    const url=`${API.reverse}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radius=2.5&limit=16&layers=stopPlace&lang=no`;
    const r=await fetchWithTimeout(url,{headers:{'ET-Client-Name':API.client}},15000);
    if(!r.ok)throw new Error(`Stedsøket svarte ${r.status}`);
    const data=await r.json();
    if(version!==nearbyVersion)return;
    const found=(data.features||[]).filter(f=>f.properties?.id?.startsWith('NSR:StopPlace:')&&
      f.geometry?.coordinates?.length>=2).map(f=>{
        const [stopLon,stopLat]=f.geometry.coordinates;
        const distance=Number.isFinite(+f.properties.distance)?Math.round(+f.properties.distance*1000):
          Math.round(geoDist([lat,lon],[stopLat,stopLon]));
        return{id:f.properties.id,name:f.properties.names?.default||f.properties.names?.display||f.properties.name||'Holdeplass',
          lat:stopLat,lon:stopLon,distance,deps:null};
      }).filter(s=>Number.isFinite(s.distance)&&s.distance<=2500);
    state.stops=[...pinned,...found]
      .filter((s,i,arr)=>arr.findIndex(x=>x.id===s.id)===i)
      .sort((a,b)=>(a.distance??Infinity)-(b.distance??Infinity)).slice(0,10);
    setNetworkState(true);
    applyStops();renderSheet();renderDepView();
    if(found.length||pinned.length)await loadAllDeps();
    else errState('Ingen holdeplasser innen 2,5 km','Søk etter en holdeplass under Reise, eller prøv igjen.',()=>loadNearby(lat,lon));
  }catch(e){
    if(version!==nearbyVersion)return;
    const cache=loadJSON('reisDepCache',null);
    if(cache&&cache.stops){
      state.stops=[...pinned,...cache.stops.filter(c=>!pinned.some(p=>p.id===c.id))]
        .map(s=>({...s,depsStale:true}));
      showOfflineBar(cache.t);applyStops();renderSheet();renderDepView();
    }else{
      errState('Fikk ikke hentet holdeplasser',e.message||'Ukjent feil',()=>loadNearby(lat,lon));
    }
  }
}
function showOfflineBar(t){
  const bar=$('#offlineBar');
  bar.innerHTML=`${ico('alert')}<span>Viser lagrede avganger fra kl. ${fmtT(t)}. Tidene kan være utdaterte.</span>`;
  bar.hidden=false;
}
function errState(title,msg,retry){
  $('#stopCards').innerHTML=`<div class="state">${ico('alert')}<b>${esc(title)}</b>${esc(msg)}
    <button class="btn btn-ink press" id="retryBtn" type="button">Prøv igjen</button></div>`;
  $('#retryBtn').onclick=retry;
}
function applyStops(){
  if(!settings.showStops||state.activeTrip){stopsLayer.clearLayers();return;}
  stopsLayer.clearLayers();
  state.stops.forEach(s=>{
    const fav=favs.some(f=>f.id===s.id);
    L.marker([s.lat,s.lon],{title:s.name,icon:L.divIcon({className:'',iconSize:[14,14],iconAnchor:[7,7],
      html:`<div class="stop-dot${fav?' fav':''}"></div>`})})
      .on('click',()=>{buzz(6);openStop(s.id);}).addTo(stopsLayer);
  });
}

/* ---------- Avganger ---------- */
async function fetchStopDeps(s){
  const d=await gql(Q_DEP,{id:s.id,n:10});
  const now=Date.now()-60000,seen=new Set(),rows=[];
  (d.stopPlace?.estimatedCalls||[]).forEach(c=>{
    if(c.forBoarding===false)return;
    const exp=new Date(c.expectedDepartureTime).getTime();
    if(!Number.isFinite(exp)||exp<now)return;
    const line=c.serviceJourney?.journeyPattern?.line||{};
    const dest=c.destinationDisplay?.frontText||'—';
    // Samme tur kan dukke opp på flere plattformer i samme stoppested.
    const key=c.serviceJourney?.id||`${line.publicCode}|${dest}|${c.aimedDepartureTime}`;
    if(seen.has(key))return;seen.add(key);
    rows.push({dest,pub:line.publicCode||'?',mode:line.transportMode||'bus',
      exp,aimed:new Date(c.aimedDepartureTime).getTime(),rt:!!c.realtime,quay:c.quay?.publicCode});
  });
  return rows.sort((a,b)=>a.exp-b.exp).slice(0,6);
}
let depsLoading=false;
async function loadAllDeps(){
  const all=getAllStops();
  if(!all.length||depsLoading)return;
  depsLoading=true;
  $('#refreshBtn').classList.add('spin');
  let failed=0,firstError='';
  const saved=loadJSON('reisDepCache',null)?.stops||[];
  await Promise.all(all.map(async s=>{try{s.deps=await fetchStopDeps(s);s.depsStale=false;}
    catch(e){failed++;firstError=firstError||e.message||'ukjent feil';
      s.deps=s.deps||saved.find(c=>c.id===s.id)?.deps||[];s.depsStale=true;}}));
  depsLoading=false;
  $('#refreshBtn').classList.remove('spin');
  if(!failed){
    saveJSON('reisDepCache',{t:Date.now(),stops:all.map(s=>({id:s.id,name:s.name,lat:s.lat,lon:s.lon,distance:s.distance,deps:s.deps||[]}))});
  }
  const bar=$('#offlineBar');
  bar.hidden=!failed;
  if(failed)bar.innerHTML=`${ico('alert')}<span><b>${failed===all.length?'Avgangene kunne ikke oppdateres.':'Noen avganger kunne ikke oppdateres.'}</b> Lagrede tider vises der de finnes.</span>`;
  $('#updated').textContent=`${failed?'Sist forsøkt':'Oppdatert'} kl. ${fmtT(Date.now())}`;
  renderDepView();renderSheet();
}
$('#refreshBtn').onclick=()=>{buzz(10);loadAllDeps();};

function getAllStops(){
  const favStops=favs.filter(f=>!state.stops.some(s=>s.id===f.id))
    .map(f=>({id:f.id,name:f.name,lat:f.lat,lon:f.lon,distance:null,deps:f.deps||null,favOnly:true}));
  const seen=new Set();
  return [...state.stops,...favStops].filter(s=>seen.has(s.id)?false:(seen.add(s.id),true));
}
const lastMinutes=new Map();
function whenHtml(key,r){
  const m=minUntil(r.exp),delay=Math.round((r.exp-r.aimed)/60000);
  const prev=lastMinutes.get(key);lastMinutes.set(key,m);
  const tick=prev!=null&&prev!==m?' tick':'';
  const main=m<=0?'<span class="now">nå</span>':m<60?`<span class="n${tick}">${m}<small>min</small></span>`:`<span class="n${tick}">${fmtT(r.exp)}</span>`;
  let sub='';
  if(m<60)sub=`${r.rt?'<i class="live" title="Sanntid"></i>':''}${delay>0?`<s>${fmtT(r.aimed)}</s><span class="late">${fmtT(r.exp)}</span>`:fmtT(r.exp)}`;
  else if(delay>0)sub=`<span class="late">+${delay} min</span>`;
  return`<div class="when">${main}${sub?`<span class="sub">${sub}</span>`:''}</div>`;
}
function rowHtml(s,r){
  const md=modeOf(r.mode);
  const reach=s.depsStale?null:reachStatus(s.distance,r.exp);
  const quay=r.quay?` · ${r.mode==='rail'||r.mode==='metro'?'spor':'plattform'} ${esc(r.quay)}`:'';
  return`<div class="dep">
    <span class="badge badge-l" style="--c:${md.c}" title="${md.n}">${esc(r.pub)}</span>
    <span class="dest"><b>${esc(r.dest)}</b><small>${md.n}${quay}${reach?` · <span class="reach ${reach.cls}">${esc(reach.label)}</span>`:''}</small></span>
    ${whenHtml(`${s.id}|${r.pub}|${r.dest}|${r.aimed}`,r)}
  </div>`;
}
function renderDepView(){
  const all=getAllStops();
  const box=$('#stopCards');
  if(!all.length){
    box.innerHTML=`<div class="state">${ico('clock')}<b>Venter på posisjon</b>Avgangene dukker opp her når vi vet hvor du er, eller når du har lagt til favoritter.</div>`;
    renderFavRow();return;
  }
  const first=!box.querySelector('.stop');
  box.innerHTML=all.map((s,i)=>{
    const walk=s.distance!=null?`${fmtDist(s.distance)} · ${walkMin(s.distance)} min å gå`:'';
    const tag=s.pinned?'<span class="tag">Valgt</span>':s.favOnly?'<span class="tag">Favoritt</span>':'';
    const fav=favs.some(f=>f.id===s.id);
    let body;
    if(!s.deps)body='<div class="skel-row"><span class="skel"></span><span class="skel"></span><span class="skel"></span></div>'.repeat(2);
    else{
      const rows=s.deps.filter(r=>state.activeModes.has(r.mode)&&r.exp>Date.now()-60000).map(r=>rowHtml(s,r)).join('');
      body=rows||`<div class="dep-empty">${s.depsStale?'Avganger er ikke tilgjengelige akkurat nå.':'Ingen avganger med valgt filter.'}</div>`;
    }
    return`<article class="card stop" id="card-${i}" style="${first?`animation-delay:${Math.min(i,6)*50}ms`:'animation:none'}">
      <div class="stop-head"><div><h3>${esc(s.name)}</h3><div class="stop-meta">${tag}${walk}</div></div>
        <button class="star press" type="button" data-fav="${esc(s.id)}" aria-pressed="${fav}" aria-label="${fav?'Fjern':'Legg til'} ${esc(s.name)} som favoritt">${ico('star')}</button>
      </div>${body}</article>`;
  }).join('');
  renderFavRow();
  $$('#stopCards [data-fav]').forEach(el=>el.onclick=e=>{e.stopPropagation();toggleFav(el.dataset.fav);});
}
function renderFavRow(){
  $('#favRow').innerHTML=favs.map(f=>
    `<button class="fav-chip press" type="button" data-fgo="${esc(f.id)}">${ico('star')}${esc(f.name)}</button>`).join('');
  $$('#favRow [data-fgo]').forEach(el=>el.onclick=()=>{buzz(6);openStop(el.dataset.fgo);});
  renderFavList();
}
function renderFavList(){
  const box=$('#favList');
  box.innerHTML=favs.length?favs.map(f=>
    `<div class="list-row fav-item">${ico('star')}<span class="lbl"><b>${esc(f.name)}</b></span><button class="rm press" type="button" data-del="${esc(f.id)}">Fjern</button></div>`).join('')
    :'<div class="list-row"><span class="lbl"><small>Trykk på stjernen ved en holdeplass under Avganger for å lagre den her.</small></span></div>';
  $$('#favList [data-del]').forEach(b=>b.onclick=()=>toggleFav(b.dataset.del));
}
function toggleFav(id){
  buzz(12);
  const s=[...state.stops,...favs].find(x=>x.id===id);if(!s)return;
  const had=favs.some(f=>f.id===id);
  if(had)favs=favs.filter(f=>f.id!==id);
  else favs.push({id:s.id,name:s.name,lat:s.lat,lon:s.lon});
  saveJSON('reisFavs',favs);
  renderDepView();applyStops();renderSheet();
  if(!had)$(`#stopCards [data-fav="${CSS.escape(id)}"]`)?.classList.add('bump');
  toast(had?`${s.name} er fjernet fra favoritter`:`${s.name} er lagt til i favoritter`);
}
function openStop(id){
  switchView('dep');
  setTimeout(()=>{
    const i=getAllStops().findIndex(x=>x.id===id);
    const el=i>-1&&document.getElementById('card-'+i);
    if(el)el.scrollIntoView({behavior:reduceMotion.matches?'auto':'smooth',block:'start'});
  },120);
}

/* ---------- Filtre ---------- */
const FILTER_MODES=['bus','tram','metro','rail','water'];
function renderChips(){
  const allOn=state.activeModes.size===Object.keys(MODES).length;
  $('#modeChips').innerHTML=`<button class="filter press" type="button" data-m="all" aria-pressed="${allOn}">Alle</button>`+
    FILTER_MODES.map(m=>`<button class="filter press" type="button" data-m="${m}" style="--c:${MODES[m].c}" aria-pressed="${!allOn&&state.activeModes.has(m)}"><i></i>${MODES[m].n}</button>`).join('');
  $$('#modeChips .filter').forEach(c=>c.onclick=()=>{buzz(6);
    const m=c.dataset.m,allOnNow=state.activeModes.size===Object.keys(MODES).length;
    if(m==='all')state.activeModes=new Set(Object.keys(MODES));
    else if(allOnNow)state.activeModes=new Set(m==='bus'?['bus','coach']:[m]); // første valg = vis bare denne
    else{
      const ms=m==='bus'?['bus','coach']:[m];
      ms.forEach(x=>state.activeModes.has(m)?state.activeModes.delete(x):state.activeModes.add(x));
      if(!FILTER_MODES.some(x=>state.activeModes.has(x)))state.activeModes=new Set(Object.keys(MODES));
    }
    renderChips();renderDepView();});
}

/* ---------- Kjøretøy i sanntid (SIRI VM) ---------- */
const tagText=(el,name)=>{const n=el&&el.getElementsByTagName(name)[0];return n?n.textContent:'';};
let vehDebounce=null,lastVehicleRequest=0,vehicleRequestActive=false;
function debouncedVehicles(){clearTimeout(vehDebounce);vehDebounce=setTimeout(refreshVehicles,1200);}
function updateVehHint(){
  $('#vehHint').hidden=!(settings.showVehicles&&mapVisible()&&!state.activeTrip&&map.getZoom()<VEH_MIN_ZOOM);
}
async function refreshVehicles(){
  if(!settings.showVehicles||document.hidden||!mapVisible()||map.getZoom()<VEH_MIN_ZOOM){updateVehHint();return;}
  if(vehicleRequestActive||Date.now()-lastVehicleRequest<30000)return;
  vehicleRequestActive=true;lastVehicleRequest=Date.now();
  let xml;
  try{
    const r=await fetchWithTimeout(`${API.vm}?datasetId=RUT`,{headers:{'ET-Client-Name':API.client}},18000);
    if(!r.ok)throw new Error('Kjøretøydata svarte '+r.status);
    xml=await r.text();
  }catch(e){return;}finally{vehicleRequestActive=false;}
  try{
    const doc=new DOMParser().parseFromString(xml,'text/xml');
    const b=map.getBounds().pad(0.2),seenNow=new Set();
    for(const va of doc.getElementsByTagName('VehicleActivity')){
      const gj=va.getElementsByTagName('MonitoredVehicleJourney')[0];if(!gj)continue;
      const lat=parseFloat(tagText(gj,'Latitude')),lon=parseFloat(tagText(gj,'Longitude'));
      if(isNaN(lat)||isNaN(lon)||!b.contains([lat,lon]))continue;
      const id=tagText(gj,'VehicleRef')||`${lat.toFixed(4)},${lon.toFixed(4)}`;
      const line=tagText(gj,'LineRef').split(':').pop();
      const bearing=parseFloat(tagText(gj,'Bearing'))||0;
      const mc=gj.getElementsByTagName('MonitoredCall')[0];
      const next=mc?tagText(mc,'StopPointName'):'';
      const destn=tagText(gj,'DestinationName');
      const color=modeOf(tagText(gj,'VehicleMode').toLowerCase()).c;
      seenNow.add(id);
      let mk=vehicleMarkers.get(id);
      if(mk){
        tweenMarker(mk,{lat,lng:lon});
        const el=mk.getElement();
        if(el&&el.firstChild){el.firstChild.style.transform=`rotate(${bearing}deg)`;el.querySelector('path')?.setAttribute('fill',color);}
      }else{
        const html=`<div class="veh" style="transform:rotate(${bearing}deg)"><svg viewBox="0 0 30 30" aria-hidden="true"><path d="M15 3 25 25 15 20 5 25Z" fill="${color}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg></div>`;
        mk=L.marker([lat,lon],{keyboard:false,icon:L.divIcon({className:'',iconSize:[30,30],iconAnchor:[15,15],html}),zIndexOffset:500}).addTo(vehiclesLayer);
        mk.on('click',()=>{const m=mk._meta||{};
          toast(`Linje ${m.line||'?'}${m.destn?' mot '+m.destn:''}${m.next?' · neste: '+m.next:''}`);});
        vehicleMarkers.set(id,mk);
      }
      mk._meta={line,next,destn,t:Date.now()};
    }
    for(const [id,mk] of vehicleMarkers){
      if(!seenNow.has(id)&&Date.now()-((mk._meta&&mk._meta.t)||0)>45000){vehiclesLayer.removeLayer(mk);vehicleMarkers.delete(id);}
    }
  }catch(e){/* sanntid er best-effort */}
}
function tweenMarker(m,to,dur=1100){
  if(reduceMotion.matches){m.setLatLng([to.lat,to.lng]);return;}
  const from=m.getLatLng(),t0=performance.now();
  const step=t=>{const k=Math.min(1,(t-t0)/dur),e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
    m.setLatLng([from.lat+(to.lat-from.lat)*e,from.lng+(to.lng-from.lng)*e]);
    if(k<1)requestAnimationFrame(step);};
  requestAnimationFrame(step);
}

/* ---------- Trafikkmeldinger (SIRI SX) ---------- */
// SX har ofte samme tekst på flere språk. Velg norsk, deretter språkløs, deretter første.
function langText(el,tag){
  const ns=[...el.getElementsByTagName(tag)];
  const lang=n=>(n.getAttribute('xml:lang')||n.getAttribute('lang')||'').toLowerCase();
  const pick=ns.find(n=>['no','nb','nor','nob'].includes(lang(n)))||ns.find(n=>!lang(n))||ns[0];
  return pick?pick.textContent.trim():'';
}
const SEV_RANK={high:0,med:1,low:2};
function sevClass(s){
  s=(s||'').toLowerCase();
  if(s==='severe'||s==='verysevere'||s==='high')return'high';
  if(s==='normal'||s==='medium'||s==='warning')return'med';
  return'low';
}
async function loadAlerts(){
  try{
    const r=await fetchWithTimeout(`${API.sx}?datasetId=RUT`,{headers:{'ET-Client-Name':API.client}},25000);
    if(!r.ok)throw new Error('Trafikkmeldinger svarte '+r.status);
    const doc=new DOMParser().parseFromString(await r.text(),'text/xml');
    const now=Date.now(),list=[];
    for(const el of doc.getElementsByTagName('PtSituationElement')){
      if(tagText(el,'Progress').toLowerCase()==='closed')continue;
      const vp=el.getElementsByTagName('ValidityPeriod')[0];
      const start=tagText(vp,'StartTime'),end=tagText(vp,'EndTime');
      if(end&&new Date(end).getTime()<now)continue;
      if(start&&new Date(start).getTime()>now+864e5)continue;
      const summary=langText(el,'Summary');
      if(!summary)continue;
      list.push({sev:sevClass(tagText(el,'Severity')),summary,desc:langText(el,'Description'),start,end});
    }
    list.sort((a,b)=>SEV_RANK[a.sev]-SEV_RANK[b.sev]||(new Date(b.start)-new Date(a.start)));
    state.alerts=list.slice(0,40);
    renderAlerts();renderTicker();
    const n=state.alerts.length;
    $('#alertBadge').hidden=!n;$('#alertBadge').textContent=n;
    $('#tabDot').hidden=!state.alerts.some(a=>a.sev==='high');
    $('#alertsEntrySub').textContent=n?`${n} aktive ${plural(n,'melding','meldinger')}`:'Ingen aktive avvik';
    $('#alertsUpdated').textContent=`Oppdatert kl. ${fmtT(Date.now())}`;
  }catch(e){
    $('#alertsUpdated').textContent='Kunne ikke oppdatere';
    if(!state.alerts.length)$('#alertsList').innerHTML=`<div class="state">${ico('alert')}<b>Fikk ikke hentet meldinger</b>Sjekk nettforbindelsen og prøv igjen.</div>`;
  }
}
function renderAlerts(){
  const box=$('#alertsList');
  if(!state.alerts.length){box.innerHTML=`<div class="state">${ico('check')}<b>Ingen avvik</b>Trafikken går som normalt.</div>`;return;}
  const fmtWhen=ts=>{const d=new Date(ts);const today=d.toDateString()===new Date().toDateString();
    return today?`kl. ${fmtT(d)}`:d.toLocaleDateString('nb-NO',{day:'numeric',month:'short'})+` kl. ${fmtT(d)}`;};
  box.innerHTML=state.alerts.map((a,i)=>{
    const t=a.start||a.end?`${a.start?'Fra '+fmtWhen(a.start):''}${a.end?`${a.start?' til ':'Til '}${fmtWhen(a.end)}`:''}`:'';
    return`<article class="alert" style="animation-delay:${Math.min(i,8)*35}ms"><span class="sev ${a.sev}" aria-hidden="true"></span><div>
      <h4>${esc(a.summary)}</h4>${a.desc&&a.desc!==a.summary?`<p>${esc(a.desc)}</p>`:''}${t?`<time>${t}</time>`:''}</div></article>`;
  }).join('');
}
function renderTicker(){
  const t=$('#ticker'),n=state.alerts.length;
  if(!n){t.hidden=true;return;}
  t.innerHTML=`${ico('alert')}<span><b>${n} ${plural(n,'trafikkmelding','trafikkmeldinger')}</b><span class="one">${esc(state.alerts[0].summary)}</span></span>${ico('chev')}`;
  t.hidden=false;
}
$('#ticker').onclick=()=>{buzz(6);switchView('alerts');};
$('#alertsRefresh').onclick=()=>{buzz(8);$('#alertsRefresh').classList.add('spin');
  loadAlerts().finally(()=>setTimeout(()=>$('#alertsRefresh').classList.remove('spin'),400));};

/* ---------- Bunnark ---------- */
const sheet=$('#sheet'),grip=$('#sheetGrip');
let sDrag=null;
function setSheetOpen(open){sheet.classList.toggle('open',open);grip.setAttribute('aria-expanded',String(open));}
const toggleSheet=()=>setSheetOpen(!sheet.classList.contains('open'));
grip.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleSheet();}});
const sheetPeek=()=>{const s=getComputedStyle(sheet);
  return sheet.offsetHeight-parseFloat(s.paddingBottom)-parseFloat(s.getPropertyValue('--peek')||132);};
grip.addEventListener('pointerdown',e=>{
  sDrag={y:e.clientY,t:performance.now(),open:sheet.classList.contains('open'),peek:sheetPeek()};
  sheet.classList.add('drag');grip.setPointerCapture(e.pointerId);});
grip.addEventListener('pointermove',e=>{
  if(!sDrag)return;
  const base=sDrag.open?0:sDrag.peek;
  let y=base+(e.clientY-sDrag.y);
  if(y<0)y=y/4; // gummistrikk over toppen
  sheet.style.transform=`translateY(${Math.min(sDrag.peek,y)}px)`;});
grip.addEventListener('pointerup',e=>{
  if(!sDrag)return;
  const dy=e.clientY-sDrag.y,v=dy/Math.max(1,performance.now()-sDrag.t);
  const base=sDrag.open?0:sDrag.peek,y=base+dy;
  sheet.classList.remove('drag');sheet.style.transform='';
  // Kort trykk veksler; ellers avgjør fart først, så posisjon.
  const open=Math.abs(dy)<6?!sDrag.open:Math.abs(v)>.45?v<0:y<sDrag.peek/2;
  setSheetOpen(open);sDrag=null;buzz(6);
});
grip.addEventListener('pointercancel',()=>{if(sDrag){sheet.classList.remove('drag');sheet.style.transform='';sDrag=null;}});

function renderSheet(){
  if(state.activeTrip){renderJourneySheet();return;}
  $('#sheetBody').dataset.trip='0';
  const stops=state.stops.slice(0,8);
  sheet.hidden=!stops.length;
  document.body.classList.toggle('has-sheet',!sheet.hidden);
  if(!stops.length)return;
  $('#sheetTitle').textContent='I nærheten';
  $('#sheetDist').textContent=state.pos?'':'Oslo sentrum';
  $('#sheetBody').innerHTML=stops.map(s=>{
    const next=(s.deps||[]).find(r=>r.exp>Date.now()-30000);
    const m=next?minUntil(next.exp):null;
    const nx=next?`<span class="badge" style="--c:${modeOf(next.mode).c}">${esc(next.pub)}</span>${m<=0?'nå':m<60?`${m}<em>min</em>`:fmtT(next.exp)}`:
      s.deps?'<em>Ingen avganger</em>':'<span class="skel" style="width:60px"></span>';
    return`<button class="near" type="button" data-near="${esc(s.id)}"><span class="lbl"><b>${esc(s.name)}</b>
      <small>${s.distance!=null?`${fmtDist(s.distance)} · ${walkMin(s.distance)} min å gå`:'Valgt holdeplass'}</small></span><span class="nx">${nx}</span></button>`;
  }).join('');
  $$('#sheetBody [data-near]').forEach(b=>b.onclick=()=>{buzz(6);openStop(b.dataset.near);});
}
function renderJourneySheet(){
  sheet.hidden=false;
  document.body.classList.add('has-sheet');
  if($('#sheetBody').dataset.trip==='1')return;
  const p=state.activeTrip,legs=p.legs||[];
  const rides=legs.filter(l=>l.mode!=='foot');
  const changes=Math.max(0,rides.length-1);
  $('#sheetTitle').textContent='Reisen din';
  $('#sheetDist').textContent=`${fmtT(p.expectedStartTime)}–${fmtT(p.expectedEndTime)}`;
  const chips=[`${Math.round(p.duration/60)} min`,changesText(changes),
    p.walkDistance?`${fmtDist(p.walkDistance)} gange`:null].filter(Boolean);
  const steps=legs.map((l,i)=>{
    const walk=l.mode==='foot',md=modeOf(l.mode);
    const place=esc(i===0?placeName(l.fromPlace,p.fromName):placeName(l.fromPlace,'Bytte'));
    const color=walk?'var(--ink-3)':md.c;
    let what;
    if(walk)what=`${ico('walk')}<span>Gå ${Math.max(1,Math.round(l.duration/60))} min<small> · ${fmtDist(l.distance||0)}</small></span>`;
    else{
      const toward=l.fromEstimatedCall?.destinationDisplay?.frontText;
      what=`<span class="badge" style="--c:${md.c}">${esc(l.line?.publicCode||md.n)}</span><span>${md.n}${toward?` mot ${esc(toward)}`:''}</span>`;
    }
    const meta=walk?'':[l.fromPlace?.quay?.publicCode?`${l.mode==='rail'||l.mode==='metro'?'Spor':'Plattform'} ${esc(l.fromPlace.quay.publicCode)}`:'',
      l.realtime?'Sanntid':'Rutetid'].filter(Boolean).join(' · ');
    const stops=walk?[]:(l.intermediateEstimatedCalls||[]).filter(c=>c.quay?.name);
    const details=walk||!p.stopDetailsAvailable?'':stops.length?`<details${stops.length<=4?' open':''}><summary>${ico('chev')}${stops.length} ${plural(stops.length,'stopp','stopp')} underveis</summary>
        <ol>${stops.map(c=>`<li><span>${esc(c.quay.name)}</span>${c.expectedArrivalTime?`<time>${fmtT(c.expectedArrivalTime)}</time>`:''}</li>`).join('')}</ol></details>`:
      '<div class="meta">Ingen stopp underveis</div>';
    return`<div class="leg${walk?' walk':''}" style="--c:${color}"><time>${fmtT(l.expectedStartTime)}</time>
      <span class="rail"><span class="node"></span></span>
      <div class="body"><div class="place">${place}</div><div class="what">${what}</div>${meta?`<div class="meta">${meta}</div>`:''}${details}</div></div>`;
  }).join('');
  const last=legs[legs.length-1];
  const end=`<div class="leg end"><time>${fmtT(p.expectedEndTime)}</time><span class="rail"><span class="node"></span></span>
    <div class="body"><div class="place">${esc(placeName(last?.toPlace,p.toName))}</div></div></div>`;
  $('#sheetBody').innerHTML=`<div class="jsum">${chips.map(c=>`<span>${c}</span>`).join('')}</div>`+
    (p.schematic?'<div class="jnote">Kartlinjen er forenklet. Følg stoppene og byttene her.</div>':'')+
    steps+end+`<div class="jactions"><button class="btn btn-line btn-sm press" id="showAlternatives" type="button">Andre forslag</button>
      <button class="btn btn-ink btn-sm press" id="endTrip" type="button">Ferdig</button></div>`;
  $('#sheetBody').dataset.trip='1';
  $('#showAlternatives').onclick=()=>{buzz(6);switchView('trip');};
  $('#endTrip').onclick=()=>{buzz(6);clearDrawnRoute();setRouteEndpoints();};
}

/* ---------- Stedssøk ---------- */
const PLACE_TYPES={stopPlace:'Holdeplass',groupOfStopPlaces:'Knutepunkt',address:'Adresse',street:'Gate',poi:'Sted',place:'Område'};
const KIND_ICON={Holdeplass:'stop',Knutepunkt:'stop',Adresse:'place',Gate:'street','Nylig brukt':'clock'};
function placeFromFeature(f){
  const p=f?.properties,c=f?.geometry?.coordinates;
  if(!p||!Array.isArray(c)||!Number.isFinite(+c[0])||!Number.isFinite(+c[1]))return null;
  const name=p.names?.default||p.names?.display||p.name||[p.address?.streetName,p.address?.houseNumber].filter(Boolean).join(' ');
  if(!name)return null;
  return{id:p.id||'',name,locality:p.address?.locality||p.locality||'',kind:PLACE_TYPES[p.layer]||'Sted',lat:+c[1],lon:+c[0]};
}
async function searchPlaces(q){
  const focus=state.pos||OSLO;
  // Eget adressesøk sørger for at et gatenavn treffer også uten husnummer.
  const common=`q=${encodeURIComponent(q)}&limit=16&lang=no&lat=${focus[0]}&lon=${focus[1]}&radius=100`;
  const searches=[
    `${API.geocoder}?${common}&layers=stopPlace,groupOfStopPlaces,street,address,poi,place`,
    `${API.geocoder}?${common}&layers=street,address&sources=kartverket-matrikkelenadresse`
  ];
  const responses=await Promise.allSettled(searches.map(async url=>{
    const r=await fetchWithTimeout(url,{headers:{'ET-Client-Name':API.client}},12000);
    if(!r.ok)throw new Error('Stedssøk svarte '+r.status);
    return(await r.json()).features||[];
  }));
  const reached=responses.some(r=>r.status==='fulfilled');
  if(reached){
    setNetworkState(true);
    const unique=new Map();
    responses.forEach(r=>{if(r.status==='fulfilled')r.value.map(placeFromFeature).filter(Boolean).forEach(f=>{
      const key=f.id||`${f.name.toLocaleLowerCase('nb-NO')}:${f.lat.toFixed(4)}:${f.lon.toFixed(4)}`;
      if(!unique.has(key))unique.set(key,f);
    });});
    if(unique.size){
      const needle=q.toLocaleLowerCase('nb-NO').trim();
      const score=f=>{const n=f.name.toLocaleLowerCase('nb-NO');
        return(n===needle?100:n.startsWith(needle)?45:n.includes(needle)?20:0)+(f.kind==='Gate'||f.kind==='Adresse'?16:0);};
      return[...unique.values()].sort((a,b)=>score(b)-score(a)).slice(0,12);
    }
  }
  try{
    const d=await gql(Q_AUTO,{q});
    const list=(d.autocomplete||[]).filter(f=>f.latitude!=null&&f.longitude!=null)
      .map(f=>({id:f.id,name:f.name||'',locality:f.locality||'',kind:'Holdeplass',lat:f.latitude,lon:f.longitude}));
    if(list.length)return list;
  }catch(e){}
  const cached=loadJSON('reisDepCache',null)?.stops||[];
  const needle=q.toLocaleLowerCase('nb-NO');
  const local=[...favs,...recentTargets,...cached].filter((f,i,a)=>f?.name&&f.lat!=null&&f.lon!=null&&
    f.name.toLocaleLowerCase('nb-NO').includes(needle)&&a.findIndex(x=>x?.name===f.name&&x?.lat===f.lat)===i)
    .slice(0,8).map(f=>({id:f.id||'',name:f.name,locality:'Lagret på enheten',kind:'Nylig brukt',lat:f.lat,lon:f.lon}));
  if(local.length)return local;
  return reached?[]:null;
}
function bindAuto(input,drop,onPick){
  let acDebounce=null,results=[],active=-1;
  const show=on=>{drop.hidden=!on;input.setAttribute('aria-expanded',String(on));};
  const highlight=i=>{active=i;drop.querySelectorAll('[data-i]').forEach((b,j)=>{
    b.setAttribute('aria-selected',String(j===i));b.style.background=j===i?'var(--surface-2)':'';});};
  const pick=i=>{const f=results[i];if(!f)return;buzz(6);input.value=f.name;show(false);onPick(f);};
  input.addEventListener('input',()=>{
    tripSearchVersion++;
    input.dataset.set='';
    if(input.id==='fromInput')state.fromSel=null;
    if(input.id==='toInput'){state.dest=null;$('#tripResults').innerHTML='';$('#tripIntro').hidden=false;renderQuickTargets();}
    if(state.activeTrip)clearDrawnRoute();
    setRouteEndpoints();
    clearTimeout(acDebounce);const q=input.value.trim();
    if(q.length<2){show(false);return;}
    show(true);
    drop.innerHTML=`<button type="button" disabled>${ico('search')} Søker…</button>`;
    acDebounce=setTimeout(async()=>{
      const fs=await searchPlaces(q);
      if(input.value.trim()!==q)return; // utdatert svar
      results=fs||[];active=-1;
      if(!results.length){
        drop.innerHTML=`<button type="button" disabled>${fs?'Ingen treff. Prøv gatenavn med husnummer, eller et sted i nærheten.':'Søket er ikke tilgjengelig akkurat nå. Sjekk nettforbindelsen.'}</button>`;
        return;
      }
      drop.innerHTML=results.map((f,i)=>`<button type="button" role="option" data-i="${i}"><span class="kind">${ico(KIND_ICON[f.kind]||'place')}</span>
        <span><b>${esc(f.name)}</b><small>${esc([f.kind,f.locality].filter(Boolean).join(' · '))}</small></span></button>`).join('');
      drop.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>pick(+b.dataset.i));
    },260);
  });
  input.addEventListener('keydown',e=>{
    if(drop.hidden||!results.length)return;
    if(e.key==='ArrowDown'){e.preventDefault();highlight(Math.min(results.length-1,active+1));}
    else if(e.key==='ArrowUp'){e.preventDefault();highlight(Math.max(0,active-1));}
    else if(e.key==='Enter'){e.preventDefault();pick(active<0?0:active);}
    else if(e.key==='Escape'){show(false);}
  });
  input.addEventListener('blur',()=>setTimeout(()=>show(false),200));
  input.addEventListener('focus',()=>{if(drop.innerHTML&&input.value.trim().length>=2&&!input.dataset.set)show(true);});
}
bindAuto($('#fromInput'),$('#fromDrop'),f=>{
  state.fromSel=f;$('#fromInput').dataset.set='1';setRouteEndpoints();tripSearch();});
bindAuto($('#toInput'),$('#toDrop'),f=>{
  state.dest=f;$('#toInput').dataset.set='1';$('#toInput').blur();
  setRouteEndpoints();tripSearch();});
function renderQuickTargets(){
  const box=$('#quickTargets');
  const valid=recentTargets.filter(t=>t&&typeof t.name==='string'&&Number.isFinite(+t.lat)&&Number.isFinite(+t.lon)).slice(0,4);
  box.hidden=!valid.length||!!state.dest;
  box.innerHTML=valid.length?`<div class="section-label">Nylige</div><div class="card">${valid.map((t,i)=>
    `<button class="list-row press" type="button" data-recent="${i}">${ico('clock')}<span class="lbl"><b>${esc(t.name)}</b></span>${ico('chev','chev')}</button>`).join('')}</div>`:'';
  box.querySelectorAll('[data-recent]').forEach(el=>el.onclick=()=>{
    buzz(6);const t=valid[+el.dataset.recent];state.dest=t;setField('#toInput',t.name);
    setRouteEndpoints();tripSearch();
  });
}
function rememberTarget(t){
  if(!t||!Number.isFinite(+t.lat)||!Number.isFinite(+t.lon)||/^Punkt på kartet/.test(t.name||''))return;
  recentTargets=[{name:String(t.name),lat:+t.lat,lon:+t.lon},
    ...recentTargets.filter(x=>x&&(+x.lat!==+t.lat||+x.lon!==+t.lon))].slice(0,6);
  saveJSON('reisRecentTargets',recentTargets);
}
$('#swapBtn').onclick=()=>{buzz(8);
  const btn=$('#swapBtn');btn.classList.remove('turn');void btn.offsetWidth;btn.classList.add('turn');
  tripSearchVersion++;
  const f=state.fromSel,t=state.dest;
  // Fra «Min posisjon» bytter vi til faktisk koordinat, aldri et tomt startpunkt.
  state.fromSel=t;state.dest=f||(state.pos?{name:'Min posisjon',lat:state.pos[0],lon:state.pos[1]}:null);
  setField('#fromInput',state.fromSel?state.fromSel.name:'');
  setField('#toInput',state.dest?state.dest.name:'');
  clearDrawnRoute();setRouteEndpoints();tripSearch();};
$$('#timeSeg button').forEach(b=>b.onclick=()=>{buzz(6);
  $$('#timeSeg button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
  state.timeMode=b.dataset.m;
  const ti=$('#timeInput');ti.hidden=state.timeMode==='now';
  if(!ti.hidden&&!ti.value){const d=new Date(Date.now()+15*60000);ti.value=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
  if(state.dest)tripSearch();});
$('#timeInput').addEventListener('change',()=>{if(state.dest)tripSearch();});

let tripSearchVersion=0;
async function tripSearch(){
  renderQuickTargets();
  if(!state.dest||!$('#toInput').dataset.set){$('#tripIntro').hidden=false;$('#tripResults').innerHTML='';return;}
  $('#tripIntro').hidden=true;
  const version=++tripSearchVersion;
  const box=$('#tripResults');
  if(!state.fromSel&&!state.pos){box.innerHTML=`<div class="state">${ico('place')}<b>Hvor reiser du fra?</b>Skriv et startsted i «Fra», eller slå på posisjon.</div>`;return;}
  const from=state.fromSel?[state.fromSel.lat,state.fromSel.lon]:state.pos;
  const fromName=state.fromSel?.name||'Min posisjon',toName=state.dest.name||'Mål';
  box.innerHTML='<div class="card trip" style="animation:none"><span class="skel" style="width:46%;height:20px"></span><span class="skel" style="margin:14px 0 12px;height:8px"></span><span class="skel" style="width:70%"></span></div>'.repeat(3);
  const vars={fl:from[0],fp:from[1],tl:state.dest.lat,tp:state.dest.lon,dt:null,arr:false};
  if(state.timeMode!=='now'){
    const tv=$('#timeInput').value;
    if(tv){
      const d=new Date();const [hh,mm]=tv.split(':');
      d.setHours(+hh,+mm,0,0);
      if(d.getTime()<Date.now()-60000)d.setDate(d.getDate()+1);
      vars.dt=d.toISOString();vars.arr=state.timeMode==='arr';
    }
  }
  try{
    let d,level=tripSchemaLevel;
    while(true){
      try{d=await gql(Q_TRIP(level),vars);tripSchemaLevel=level;break;}
      catch(e){
        if(level>=3||!(/validation error|field .*undefined|unknown type/i).test(e.message||''))throw e;
        level++;tripSchemaLevel=level;
      }
    }
    if(version!==tripSearchVersion)return;
    const ps=(d.trip&&d.trip.tripPatterns)||[];
    if(!ps.length){box.innerHTML=`<div class="state">${ico('route')}<b>Ingen reiser funnet</b>Prøv et annet tidspunkt eller et sted i nærheten.</div>`;return;}
    ps.forEach(p=>{p.stopDetailsAvailable=level<3;p.fromName=fromName;p.toName=toName;});
    rememberTarget(state.dest);
    // «Raskest» bare når den faktisk skiller seg ut.
    const fastest=Math.min(...ps.map(p=>p.duration));
    const fastestIdx=ps.some(p=>p.duration>fastest)?ps.findIndex(p=>p.duration===fastest):-1;
    box.innerHTML=`<div class="section-label"><span>${ps.length} forslag</span><span>${esc(toName)}</span></div>`+ps.map((p,i)=>{
      const legs=p.legs||[];
      const rides=legs.filter(l=>l.mode!=='foot'),first=rides[0];
      const total=legs.reduce((s,l)=>s+(l.duration||0),0)||1;
      const bar=legs.map((l,j)=>`<i class="${l.mode==='foot'?'walk':''}" style="flex:${Math.max(.04,(l.duration||0)/total)};--c:${modeOf(l.mode).c};animation-delay:${i*60+j*40}ms"></i>`).join('');
      const chips=legs.filter(l=>l.mode!=='foot'||l.duration>=60).map(l=>l.mode==='foot'
        ?`<span class="walk">${ico('walk')}${Math.round(l.duration/60)}</span>`
        :`<span class="badge" style="--c:${modeOf(l.mode).c}" title="${modeOf(l.mode).n}">${esc(l.line?.publicCode||modeOf(l.mode).n)}</span>`)
        .join(`<svg class="g sep" style="width:12px;height:12px" aria-hidden="true"><use href="#i-chev"/></svg>`);
      let foot;
      if(first){
        const m=minUntil(first.expectedStartTime);
        const when=m<=0?'nå':m<60?`om ${m} min`:`kl. ${fmtT(first.expectedStartTime)}`;
        foot=`<span>${modeOf(first.mode).n} fra <b>${esc(placeName(first.fromPlace,fromName))}</b> <span class="${m<=5?'soon':''}">${when}</span></span>`;
      }else foot='<span>Gå hele veien</span>';
      return`<button class="card trip press" type="button" data-p="${i}" style="animation-delay:${i*60}ms">
        <div class="trip-top"><span class="t">${fmtT(p.expectedStartTime)}<span>–</span>${fmtT(p.expectedEndTime)}</span>
          <span class="dur">${Math.round(p.duration/60)} min${i===fastestIdx?' · raskest':''}</span></div>
        <div class="bar" aria-hidden="true">${bar}</div>
        <div class="legs">${chips||'<span class="walk">Gange</span>'}</div>
        <div class="trip-foot">${foot}<span>${changesText(Math.max(0,rides.length-1))}</span></div>
      </button>`;
    }).join('');
    box.querySelectorAll('.trip[data-p]').forEach(el=>el.onclick=()=>{buzz(10);
      const p=ps[+el.dataset.p];
      switchView('map');
      setTimeout(()=>{if(mapVisible())drawRoute(p);},140);});
  }catch(e){
    if(version!==tripSearchVersion)return;
    box.innerHTML=`<div class="state">${ico('alert')}<b>Reisesøket feilet</b>${esc(e.message)}<button class="btn btn-ink press" id="tripRetry" type="button">Prøv igjen</button></div>`;
    $('#tripRetry').onclick=()=>tripSearch();
  }
}
function decodePoly(enc){
  const pts=[];let i=0,lat=0,lng=0;
  while(i<enc.length){
    let res=0,sh=0,b;
    do{b=enc.charCodeAt(i++)-63;res|=(b&31)<<sh;sh+=5;}while(b>=32);
    lat+=(res&1)?~(res>>1):(res>>1);
    res=0;sh=0;
    do{b=enc.charCodeAt(i++)-63;res|=(b&31)<<sh;sh+=5;}while(b>=32);
    lng+=(res&1)?~(res>>1):(res>>1);
    pts.push([lat/1e5,lng/1e5]);
  }
  return pts;
}
const minorStops=[];
function updateMinorStops(){
  routeMinorLayer.clearLayers();
  if(state.activeTrip&&map.getZoom()>=15)minorStops.forEach(m=>routeMinorLayer.addLayer(m));
}
// Tegn linjen inn fra start til mål. pathLength gjør animasjonen uavhengig av zoom.
function animatePath(layer,delay){
  const el=layer.getElement&&layer.getElement();
  if(!el||reduceMotion.matches)return;
  el.setAttribute('pathLength','1');el.style.strokeDasharray='1';el.style.animationDelay=`${delay}ms`;
  el.classList.add('route-draw');
  el.addEventListener('animationend',()=>{el.removeAttribute('pathLength');el.style.strokeDasharray='';el.classList.remove('route-draw');},{once:true});
}
function drawRoute(p){
  clearDrawnRoute();minorStops.length=0;
  state.activeTrip=p;document.body.dataset.route='active';applyBasemap();applyStops();
  const bounds=[];let drawn=0,delay=0;
  const rides=(p.legs||[]).filter(l=>l.mode!=='foot');
  (p.legs||[]).forEach(l=>{
    const enc=l.pointsOnLink?.points;
    if(!enc)return;
    let pts;
    try{pts=decodePoly(enc);}catch(e){return;}
    if(pts.length<2||pts.some(x=>!Number.isFinite(x[0])||!Number.isFinite(x[1])))return;
    const walk=l.mode==='foot',stroke=walk?'#5D676C':modeOf(l.mode).c;
    if(!walk){
      const casing=L.polyline(pts,{color:'#fff',weight:10,opacity:.95,interactive:false,lineCap:'round',lineJoin:'round'}).addTo(routeLayer);
      animatePath(casing,delay);
    }
    const line=L.polyline(pts,{color:stroke,weight:walk?4:6,opacity:1,dashArray:walk?'1 9':null,lineCap:'round',lineJoin:'round'}).addTo(routeLayer);
    if(!walk)animatePath(line,delay);
    const code=l.line?.publicCode;
    line.bindTooltip(walk?`Gå ${Math.max(1,Math.round(l.duration/60))} min`:`${modeOf(l.mode).n}${code?' '+code:''}`,{sticky:true});
    drawn++;delay+=walk?80:220;
    bounds.push(...pts);
  });
  const plotted=new Set();
  const addRouteStop=(quay,label,time,color,kind,transferNumber)=>{
    const lat=+quay?.latitude,lon=+quay?.longitude;
    if(!quay||!Number.isFinite(lat)||!Number.isFinite(lon)||!lat||!lon)return;
    const key=`${lat.toFixed(5)},${lon.toFixed(5)}`;
    if(plotted.has(key))return;
    plotted.add(key);
    const transfer=kind==='Bytte',minor=kind==='Stopp underveis';
    const size=transfer?22:minor?9:14;
    const marker=L.marker([lat,lon],{keyboard:false,icon:L.divIcon({className:'',
      html:`<div class="rstop${transfer?' transfer':''}${minor?' minor':''}" style="--c:${color}">${transfer?transferNumber:''}</div>`,
      iconSize:[size,size],iconAnchor:[size/2,size/2]}),zIndexOffset:transfer?650:minor?100:450});
    if(minor)minorStops.push(marker);else routeLayer.addLayer(marker);
    marker.bindPopup(`<b>${esc(label)}</b><br>${esc(kind)}${time?' · kl. '+fmtT(time):''}`);
    bounds.push([lat,lon]);
  };
  rides.forEach((l,i)=>{
    const color=modeOf(l.mode).c;
    addRouteStop(l.fromPlace?.quay,l.fromPlace?.name||'Påstigning',l.expectedStartTime,color,i?'Stopp underveis':'Påstigning');
    (l.intermediateEstimatedCalls||[]).forEach(c=>addRouteStop(c.quay,c.quay?.name||'Stopp',c.expectedArrivalTime,color,'Stopp underveis'));
    addRouteStop(l.toPlace?.quay,l.toPlace?.name||'Avstigning',l.expectedEndTime,color,i<rides.length-1?'Bytte':'Avstigning',i+1);
  });
  // Mangler Entur geometri: koble kjente stopp skjematisk, uten å late som det er gatenøyaktig.
  if(!drawn)rides.forEach(l=>{
    const coords=[l.fromPlace?.quay,...(l.intermediateEstimatedCalls||[]).map(c=>c.quay),l.toPlace?.quay]
      .map(q=>[+q?.latitude,+q?.longitude]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&a&&b);
    if(coords.length>=2){
      routeLayer.addLayer(L.polyline(coords,{color:'#fff',weight:8,opacity:.85,interactive:false}));
      routeLayer.addLayer(L.polyline(coords,{color:modeOf(l.mode).c,weight:4,dashArray:'7 9',opacity:.95,interactive:false}));
    }
  });
  p.schematic=!drawn;
  const start=state.fromSel?[state.fromSel.lat,state.fromSel.lon]:state.pos;
  if(start)bounds.push(start);
  if(state.dest)bounds.push([state.dest.lat,state.dest.lon]);
  setRouteEndpoints();
  $('#sheetBody').dataset.trip='0';renderSheet();updateMinorStops();updateVehHint();
  routeBounds=bounds.length>=2?L.latLngBounds(bounds):null;
  $('#geoWarn').hidden=true;
  $('#routeOverviewText').innerHTML=`<b>${fmtT(p.expectedStartTime)}–${fmtT(p.expectedEndTime)} · ${changesText(Math.max(0,rides.length-1))}</b><span>${esc(p.fromName)} → ${esc(p.toName)}</span>`;
  $('#routeOverview').hidden=false;
  if(routeBounds)fitWholeRoute();
}

/* ---------- Innstillinger ---------- */
$$('#themeSeg button').forEach(b=>b.onclick=()=>{buzz(6);settings.theme=b.dataset.t;saveSettings();paintTheme();});
const walkLabel=()=>settings.walkKmh.toFixed(1).replace('.',',')+' km/t';
$('#walkRange').value=settings.walkKmh;
$('#walkVal').textContent=walkLabel();
$('#walkRange').oninput=e=>{settings.walkKmh=+e.target.value;$('#walkVal').textContent=walkLabel();saveSettings();renderDepView();};
$('#vibToggle').checked=settings.vibrate;
$('#vibToggle').onchange=e=>{settings.vibrate=e.target.checked;saveSettings();buzz(10);};
$('#refreshSel').value=String(settings.refreshSec);
$('#refreshSel').onchange=e=>{settings.refreshSec=+e.target.value;saveSettings();restartAutoRefresh();};
$('#basemapSelect').value=settings.basemap;
$('#basemapSelect').onchange=e=>{settings.basemap=e.target.value;saveSettings();applyBasemap();};
$('#mapStopsToggle').checked=settings.showStops;
$('#mapStopsToggle').onchange=e=>{settings.showStops=e.target.checked;saveSettings();applyStops();};
$('#mapVehiclesToggle').checked=settings.showVehicles;
$('#mapVehiclesToggle').onchange=e=>setVehicles(e.target.checked);
$('#alertsEntry').onclick=()=>{buzz(6);switchView('alerts');};
$('#backBtn').onclick=()=>{buzz(6);switchView('settings');};
$('#resetBtn').onclick=()=>{
  if(confirm('Slette favoritter, nylige reisemål og innstillinger?')){
    ['reisFavs','reisSettings','reisDepCache','reisRecentTargets','reisOnboarded'].forEach(k=>localStorage.removeItem(k));
    location.reload();}
};

/* ---------- Navigasjon ---------- */
function updateScrolled(){
  const panel=$('.view.active .panel');
  document.body.classList.toggle('scrolled',!!panel&&panel.scrollTop>36);
}
$$('.panel').forEach(p=>p.addEventListener('scroll',updateScrolled,{passive:true}));
function switchView(v){
  if(!TITLES[v])v='trip';
  const prev=document.body.dataset.view;
  document.body.dataset.view=v;
  $$('.view').forEach(x=>x.classList.toggle('active',x.dataset.view===v));
  $$('.tabbar button').forEach(b=>{
    if(b.dataset.go===(v==='alerts'?'settings':v))b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('#appbarTitle').textContent=TITLES[v];
  $('#backBtn').hidden=v!=='alerts';
  $('#brand').hidden=v==='alerts';
  updateScrolled();
  if(v==='map'){setTimeout(()=>map.invalidateSize(),60);updateVehHint();refreshVehicles();}
  if(prev!==v)history.replaceState(null,'','#'+v);
  if(v==='dep'&&!getAllStops().some(s=>s.deps))loadAllDeps();
}
$$('.tabbar button').forEach(b=>b.onclick=()=>{
  buzz(6);
  // Trykk på aktiv fane ruller til toppen, som i native apper.
  if(b.getAttribute('aria-current')==='page'){$('.view.active .panel')?.scrollTo({top:0,behavior:reduceMotion.matches?'auto':'smooth'});return;}
  switchView(b.dataset.go);});
addEventListener('keydown',e=>{if(e.key==='Escape'&&sheet.classList.contains('open'))setSheetOpen(false);});

/* ---------- Oppdatering ---------- */
setInterval(()=>{
  if(document.hidden)return;
  if(document.body.dataset.view==='dep'&&getAllStops().some(s=>s.deps))renderDepView();
  if(mapVisible()&&!state.activeTrip)renderSheet();
},20000);
let autoTimer=null;
function restartAutoRefresh(){
  clearInterval(autoTimer);
  autoTimer=setInterval(()=>{if(!document.hidden&&getAllStops().length)loadAllDeps();},settings.refreshSec*1000);
}
setInterval(()=>{if(!document.hidden)refreshVehicles();},15000);
setInterval(()=>{if(!document.hidden)loadAlerts();},180000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshVehicles();loadAlerts();
  if(getAllStops().length)loadAllDeps();}});

/* ---------- Velkomst og oppstart ---------- */
function hideOnboard(){
  try{localStorage.setItem('reisOnboarded','1');}catch(e){}
  const ob=$('#onboard');ob.classList.add('leaving');
  setTimeout(()=>{ob.hidden=true;ob.classList.remove('leaving');},reduceMotion.matches?0:420);
}
$('#obAllow').onclick=()=>{buzz(10);hideOnboard();startGeo();};
$('#obSkip').onclick=()=>{buzz(6);hideOnboard();geoFailed=true;loadNearby(OSLO[0],OSLO[1]);};
if(reduceMotion.matches)$('.network .train')?.remove();

paintTheme();
applyBasemap();
mapReady=true;
renderChips();renderFavRow();renderQuickTargets();
const onboarded=(()=>{try{return!!localStorage.getItem('reisOnboarded');}catch(e){return true;}})();
if(onboarded)startGeo();else $('#onboard').hidden=false;
loadAlerts();restartAutoRefresh();
const startView=location.hash.slice(1);
switchView(TITLES[startView]?startView:'trip');
const hideSplash=()=>$('#splash').classList.add('hide');
addEventListener('load',()=>setTimeout(hideSplash,reduceMotion.matches?0:850));
setTimeout(hideSplash,2500);
