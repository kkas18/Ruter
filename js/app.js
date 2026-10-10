'use strict';
/* =====================================================================
   REIS – sanntid og reisesøk for kollektiv i Oslo og omegn
   Én flate: kartet er hovedskjermen, og alt annet skjer i ett ark med
   en stabel sider (hjem → søk → forslag → reise, holdeplass, meldinger,
   innstillinger). Ingen faner, ingen dobbeltinnganger.
   Data: Entur Journey Planner v3, Geocoder v3, SIRI VM/SX.
   Kart: MapLibre GL med OpenFreeMap-vektorfliser i egen stil.
   ===================================================================== */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ico=(id,cls='')=>`<svg class="g ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
const wide=matchMedia('(min-width: 900px)');

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
const OSLO=[59.9139,10.7522];
const REFRESH_MS=30000;

/* ---------- Lagring ---------- */
function loadJSON(k,f){try{const v=JSON.parse(localStorage.getItem(k));return v??f;}catch(e){return f;}}
function saveJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
let settings=Object.assign({theme:'auto',walkKmh:4.5,showVehicles:true,vibrate:true},loadJSON('reisSettings',{}));
let favs=loadJSON('reisFavs',[]);if(!Array.isArray(favs))favs=[];
let recentTargets=loadJSON('reisRecentTargets',[]);if(!Array.isArray(recentTargets))recentTargets=[];
const saveSettings=()=>saveJSON('reisSettings',settings);

const state={pos:null,acc:0,heading:null,follow:false,nearbyAt:null,nearby:[],viewStops:new Map(),
  deps:new Map(),fromSel:null,dest:null,timeMode:'now',time:'',trips:[],tripIdx:0,alerts:[],updated:null};

/* ---------- Hjelpere ---------- */
function buzz(ms){if(settings.vibrate&&navigator.vibrate)navigator.vibrate(ms);}
let toastTimer=null;
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2800);}
const fmtT=ts=>new Date(ts).toLocaleTimeString('nb-NO',{hour:'2-digit',minute:'2-digit'});
const minUntil=ts=>Math.round((new Date(ts).getTime()-Date.now())/60000);
const plural=(n,one,many)=>n===1?one:many;
const changesText=n=>n===0?'Direkte':`${n} ${plural(n,'bytte','bytter')}`;
const walkMin=m=>Math.max(1,Math.ceil(m*1.3/(settings.walkKmh*16.67))); // luftlinje + 30 % omvei
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
const placeName=(p,fallback)=>{const n=p?.name;return(!n||/^(origin|destination)$/i.test(n))?fallback:n;};
const distTo=s=>state.pos?Math.round(geoDist(state.pos,[s.lat,s.lon])):null;

/* ---------- Nettstatus ---------- */
function setNetworkState(ok,reason=''){
  const chip=$('#netChip');chip.hidden=!!ok;
  if(!ok)chip.textContent=reason||'Reisedata utilgjengelig';
}
if(location.protocol==='file:')$('#setupNotice').hidden=false;
if(!navigator.onLine)setNetworkState(false,'Frakoblet');
addEventListener('offline',()=>setNetworkState(false,'Frakoblet'));
addEventListener('online',()=>{setNetworkState(true);refreshAll();});

/* ---------- Tema ---------- */
const mqDark=matchMedia('(prefers-color-scheme: dark)');
const resolveTheme=()=>settings.theme==='auto'?(mqDark.matches?'dark':'light'):settings.theme;
function paintTheme(){
  const t=resolveTheme();
  document.documentElement.dataset.theme=t;
  $('meta[name="theme-color"]').content=t==='dark'?'#15191C':'#EFEDE7';
  if(mapLoaded){ReisMapStyle.applyTheme(map,t);applyOverlayTheme();}
}
mqDark.addEventListener('change',()=>{if(settings.theme==='auto'){paintTheme();if(router.cur.name==='settings')router.refresh();}});

/* ---------- PWA ---------- */
if(!window.REIS_ANDROID&&'serviceWorker' in navigator&&location.protocol!=='file:')
  addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
let deferredPrompt=null;
addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;});
const canInstall=()=>!window.REIS_ANDROID&&!matchMedia('(display-mode: standalone)').matches;
async function doInstall(){
  buzz(10);
  if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice.catch(()=>{});deferredPrompt=null;}
  else toast('Åpne nettlesermenyen og velg «Legg til på startskjermen».');
}

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
const Q_AUTO=`query($q:String!){autocomplete(queryText:$q,layers:[stopPlace],size:8){id name locality layer latitude longitude}}`;
// Entur endrer av og til skjemaet: start med full detalj og fall tilbake ved valideringsfeil – aldri ved nettfeil.
const Q_TRIP=level=>`query($fl:Float!,$fp:Float!,$tl:Float!,$tp:Float!,$dt:DateTime,$arr:Boolean){
  trip(from:{coordinates:{latitude:$fl,longitude:$fp}},to:{coordinates:{latitude:$tl,longitude:$tp}},
       numTripPatterns:6,dateTime:$dt,arriveBy:$arr){
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

/* =====================================================================
   KART
   ===================================================================== */
const map=new maplibregl.Map({
  container:'map',style:ReisMapStyle.build(resolveTheme()),center:[OSLO[1],OSLO[0]],zoom:13.5,
  attributionControl:false,pitchWithRotate:false,touchPitch:false,dragRotate:true,maxZoom:19,minZoom:5,
  fadeDuration:150,cooperativeGestures:false
});
map.addControl(new maplibregl.AttributionControl({compact:true}),'top-left');
map.touchZoomRotate.enableRotation();
let mapLoaded=false;
const EMPTY={type:'FeatureCollection',features:[]};
const fc=features=>({type:'FeatureCollection',features});
const setData=(id,data)=>{const s=mapLoaded&&map.getSource(id);if(s)s.setData(data);};

function overlayColors(){
  const dark=resolveTheme()==='dark',p=ReisMapStyle.palette(resolveTheme());
  return{case:dark?'#0F1316':'#FFFFFF',stopFill:dark?'#EEECE6':'#FFFFFF',stopRing:dark?'#0F1316':'#14191C',
    label:dark?'#D3D7D9':'#2D3438',halo:p.halo,walk:dark?'#B3BABE':'#465055',me:dark?'#5B8DF5':'#2F6FEB'};
}
function applyOverlayTheme(){
  const c=overlayColors();
  const set=(l,p,v)=>map.getLayer(l)&&map.setPaintProperty(l,p,v);
  set('route-case','line-color',c.case);set('route-walk','line-color',c.walk);
  set('route-stop','circle-color',c.case);set('route-stop-minor','circle-color',c.case);
  set('stops','circle-stroke-color',c.stopRing);
  set('stops','circle-color',['case',['get','fav'],'#FFC800',c.stopFill]);
  set('stops-label','text-color',c.label);set('stops-label','text-halo-color',c.halo);
  set('acc','fill-color',c.me);set('acc-line','line-color',c.me);
}
function vehicleImage(color){
  const s=56,cv=document.createElement('canvas');cv.width=cv.height=s;const g=cv.getContext('2d');
  g.translate(s/2,s/2);g.beginPath();g.moveTo(0,-21);g.lineTo(17,19);g.lineTo(0,10);g.lineTo(-17,19);g.closePath();
  g.lineJoin='round';g.lineWidth=6;g.strokeStyle='#fff';g.stroke();g.fillStyle=color;g.fill();
  return g.getImageData(0,0,s,s);
}
map.on('load',()=>{
  mapLoaded=true;
  const c=overlayColors();
  Object.entries({...MODES,other:{c:'#5D676C'}}).forEach(([k,m])=>map.addImage('veh-'+k,vehicleImage(m.c),{pixelRatio:2}));
  ['acc','route','route-stops','stops','vehicles'].forEach(id=>map.addSource(id,{type:'geojson',data:EMPTY}));
  map.addLayer({id:'acc',type:'fill',source:'acc',paint:{'fill-color':c.me,'fill-opacity':.08}});
  map.addLayer({id:'acc-line',type:'line',source:'acc',paint:{'line-color':c.me,'line-opacity':.3,'line-width':1}});
  map.addLayer({id:'stops',type:'circle',source:'stops',minzoom:12.5,paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],12.5,2.5,15,5.5,18,8],
    'circle-color':['case',['get','fav'],'#FFC800',c.stopFill],
    'circle-stroke-color':c.stopRing,'circle-stroke-width':['interpolate',['linear'],['zoom'],12.5,1.5,16,2.5],
    'circle-opacity':['interpolate',['linear'],['zoom'],12.5,0,13.2,1],'circle-stroke-opacity':['interpolate',['linear'],['zoom'],12.5,0,13.2,1]}});
  map.addLayer({id:'stops-label',type:'symbol',source:'stops',minzoom:15.2,layout:{
    'text-field':['get','name'],'text-font':['Noto Sans Bold'],'text-size':12,'text-offset':[0,1.1],'text-anchor':'top',
    'text-max-width':9,'text-optional':true},paint:{'text-color':c.label,'text-halo-color':c.halo,'text-halo-width':1.5}});
  map.addLayer({id:'route-case',type:'line',source:'route',filter:['!',['get','walk']],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':c.case,'line-width':['interpolate',['linear'],['zoom'],10,6,16,12]}});
  map.addLayer({id:'route-line',type:'line',source:'route',filter:['!',['get','walk']],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['interpolate',['linear'],['zoom'],10,3.5,16,7]}});
  map.addLayer({id:'route-walk',type:'line',source:'route',filter:['get','walk'],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':c.walk,'line-width':['interpolate',['linear'],['zoom'],10,2.5,16,4.5],'line-dasharray':[0,1.8]}});
  map.addLayer({id:'route-stop-minor',type:'circle',source:'route-stops',minzoom:13.5,filter:['get','minor'],paint:{
    'circle-radius':3.2,'circle-color':c.case,'circle-stroke-color':['get','color'],'circle-stroke-width':2}});
  map.addLayer({id:'route-stop',type:'circle',source:'route-stops',filter:['!',['get','minor']],paint:{
    'circle-radius':6,'circle-color':c.case,'circle-stroke-color':['get','color'],'circle-stroke-width':3.5}});
  map.addLayer({id:'vehicles',type:'symbol',source:'vehicles',minzoom:13,layout:{
    'icon-image':['concat','veh-',['get','mode']],'icon-rotate':['get','bearing'],'icon-rotation-alignment':'map',
    'icon-allow-overlap':true,'icon-size':['interpolate',['linear'],['zoom'],13,.75,17,1.05]}});

  map.on('click','stops',e=>{const f=e.features[0];if(!f)return;buzz(6);
    router.go('stop',{id:f.properties.id});});
  map.on('click','vehicles',e=>{const p=e.features[0]?.properties||{};buzz(6);
    toast(`${modeOf(p.mode).n} ${p.line||''}${p.dest?' mot '+p.dest:''}${p.next?' · neste: '+p.next:''}`);});
  map.on('click','route-stop',e=>{const p=e.features[0]?.properties;if(!p)return;
    new maplibregl.Popup({offset:10,closeButton:false}).setLngLat(e.lngLat)
      .setHTML(`<b>${esc(p.name)}</b><br><span style="color:var(--ink-3)">${esc(p.kind)}${p.time?' · kl. '+fmtT(p.time):''}</span>`).addTo(map);});
  ['stops','vehicles','route-stop'].forEach(l=>{
    map.on('mouseenter',l,()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave',l,()=>map.getCanvas().style.cursor='');});

  paintTheme();renderStopsLayer();renderAcc();map.setPadding(mapPadding());
  // Kildehenvisningen starter sammenslått som en ⓘ-knapp.
  $('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  $('.maplibregl-ctrl-attrib')?.removeAttribute('open');
  if(router.cur.name==='results'||router.cur.name==='trip')drawRoute(state.trips[state.tripIdx]);
});
map.on('error',e=>{const msg=e?.error?.message||'';
  if(/Failed to fetch|NetworkError/i.test(msg))setNetworkState(false,'Kartet laster ikke');else console.warn('Kart:',msg);});

// Følg-modus og kompass
function setFollow(on){state.follow=on;$('#locateBtn').setAttribute('aria-pressed',String(on));}
map.on('dragstart',()=>{if(state.follow)setFollow(false);});
map.on('rotate',()=>{const b=map.getBearing();$('#compassBtn').hidden=Math.abs(b)<1;
  $('#compassIcon').style.transform=`rotate(${-b}deg)`;});
$('#compassBtn').onclick=()=>{buzz(6);map.easeTo({bearing:0,duration:reduceMotion.matches?0:400});};
$('#locateBtn').onclick=()=>{buzz(8);
  if(!state.pos){requestGeoOnce();toast('Henter posisjonen din…');return;}
  setFollow(true);
  map.easeTo({center:[state.pos[1],state.pos[0]],zoom:Math.max(map.getZoom(),16),duration:reduceMotion.matches?0:700});};

// Hold inne (eller høyreklikk) for å velge et punkt som start eller mål.
let pressTimer=null,pressAt=null;
map.on('touchstart',e=>{if(e.points.length!==1)return;pressAt=e.point;
  clearTimeout(pressTimer);pressTimer=setTimeout(()=>{buzz(14);showPick(e.lngLat);},520);});
map.on('touchmove',e=>{if(pressAt&&(Math.abs(e.point.x-pressAt.x)>8||Math.abs(e.point.y-pressAt.y)>8))clearTimeout(pressTimer);});
['touchend','touchcancel','movestart'].forEach(ev=>map.on(ev,()=>clearTimeout(pressTimer)));
map.on('contextmenu',e=>showPick(e.lngLat));
let pickPopup=null;
function showPick(ll){
  pickPopup?.remove();
  const el=document.createElement('div');el.className='pick';
  el.innerHTML='<b>Bruk dette punktet</b><div class="row"><button type="button" data-pick="from">Fra her</button><button type="button" class="to" data-pick="to">Til her</button></div>';
  pickPopup=new maplibregl.Popup({offset:12,closeButton:false,maxWidth:'260px'}).setLngLat(ll).setDOMContent(el).addTo(map);
  el.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{
    buzz(8);pickPopup.remove();
    const place={name:'Punkt på kartet',lat:ll.lat,lon:ll.lng};
    if(b.dataset.pick==='from')state.fromSel=place;else state.dest=place;
    if(state.dest&&(state.fromSel||state.pos))startTripSearch();
    else router.go('search',{focus:b.dataset.pick==='from'?'to':'from'});
  });
}

// Posisjonsmarkør, start/mål og byttenumre er DOM-markører; alt annet er kartlag.
const meEl=document.createElement('div');meEl.className='me';
meEl.innerHTML='<div class="halo"></div><div class="cone"></div><div class="core"></div>';
const meMarker=new maplibregl.Marker({element:meEl,rotationAlignment:'map'});
let pinMarkers=[];
function clearPins(){pinMarkers.forEach(m=>m.remove());pinMarkers=[];}
function addPin(lat,lon,html,cls){
  const el=document.createElement('div');el.innerHTML=html;const node=el.firstElementChild;
  const m=new maplibregl.Marker({element:node}).setLngLat([lon,lat]).addTo(map);pinMarkers.push(m);return m;
}
function renderAcc(){
  if(!state.pos||!state.acc){setData('acc',EMPTY);return;}
  const [lat,lon]=state.pos,r=state.acc,pts=[];
  for(let i=0;i<=48;i++){const a=i/48*2*Math.PI;
    pts.push([lon+r*Math.cos(a)/(111320*Math.cos(lat*Math.PI/180)),lat+r*Math.sin(a)/110540]);}
  setData('acc',fc([{type:'Feature',geometry:{type:'Polygon',coordinates:[pts]},properties:{}}]));
}
function renderStopsLayer(){
  const all=new Map();
  for(const s of state.viewStops.values())all.set(s.id,s);
  for(const s of state.nearby)all.set(s.id,s);
  for(const f of favs)all.set(f.id,f);
  const show=router.cur.name!=='results'&&router.cur.name!=='trip';
  setData('stops',show?fc([...all.values()].map(s=>({type:'Feature',
    geometry:{type:'Point',coordinates:[+s.lon,+s.lat]},properties:{id:s.id,name:s.name,fav:favs.some(f=>f.id===s.id)}}))):EMPTY);
}

/* ---------- Kartpolstring: kartet regner med arket ---------- */
function mapPadding(){
  if(wide.matches)return{top:24,bottom:24,left:440,right:24};
  return{top:(router.cur.name==='home'?70:20)+safeTop(),bottom:Math.min(sheetUI.visible,innerHeight*.62)+16,left:24,right:24};
}
const safeTop=()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat'))||0;

/* =====================================================================
   ARKET – tre høyder, dras med fingeren, reagerer på fart
   ===================================================================== */
const sheet=$('#sheet'),sheetScroll=$('#sheetScroll');
const sheetUI={snap:'half',visible:280,snaps:['peek','half','full']};
function snapPx(name){
  const H=sheet.offsetHeight;
  if(name==='full')return H;
  if(name==='half')return Math.round(Math.min(H,innerHeight*.5));
  return router.cur.peek||176;
}
function setVisible(px,animate=true){
  sheetUI.visible=px;
  sheet.classList.toggle('dragging',!animate);
  document.body.classList.toggle('sheet-dragging',!animate);
  document.documentElement.style.setProperty('--sheet-visible',px+'px');
  const H=sheet.offsetHeight;
  sheet.classList.toggle('full',px>=H-2);
  document.body.classList.toggle('sheet-full',px>=H-2);
  document.body.classList.toggle('sheet-tall',px>innerHeight*.62);
}
function snapTo(name,animate=true){
  if(!sheetUI.snaps.includes(name))name=sheetUI.snaps[sheetUI.snaps.length-1];
  sheetUI.snap=name;setVisible(snapPx(name),animate);
  if(mapLoaded)map.setPadding(mapPadding());
}
let drag=null,suppressClick=false;
sheet.addEventListener('pointerdown',e=>{
  if(wide.matches||e.button>0)return;
  if(e.target.closest('input,select,textarea,.seg,.filters,.filter'))return;
  const inHead=!!e.target.closest('.sheet-handle,.sheet-head');
  if(sheet.classList.contains('full')&&!inHead)return; // fullt ark: innholdet ruller
  drag={y:e.clientY,t:performance.now(),start:sheetUI.visible,moved:false,id:e.pointerId,last:e.clientY,lt:performance.now(),v:0};
});
// Bevegelse lyttes på vinduet: dras arket oppover, havner pekeren over kartet før arket følger etter.
addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;
  const dy=e.clientY-drag.y;
  if(!drag.moved){if(Math.abs(dy)<7)return;drag.moved=true;}
  const now=performance.now();drag.v=(e.clientY-drag.last)/Math.max(1,now-drag.lt);drag.last=e.clientY;drag.lt=now;
  const H=sheet.offsetHeight,min=Math.min(...sheetUI.snaps.map(snapPx));
  let v=drag.start-dy;
  if(v>H)v=H+(v-H)/4;           // gummistrikk i toppen
  if(v<min)v=min-(min-v)/2.5;   // og i bunnen
  setVisible(v,false);
});
function endDrag(e){
  if(!drag||e.pointerId!==drag.id)return;
  const d=drag;drag=null;
  if(!d.moved)return;
  suppressClick=true;setTimeout(()=>suppressClick=false,60);
  const cur=sheetUI.visible,v=-d.v; // positiv = opp
  const opts=sheetUI.snaps.map(n=>({n,px:snapPx(n)})).sort((a,b)=>a.px-b.px);
  // Dra langt ned på en side som bare har fullt ark = tilbake.
  if(opts.length===1&&e.clientY-d.y>110){router.back();return;}
  let target;
  if(Math.abs(v)>.5)target=v>0?opts.find(o=>o.px>cur+4)||opts[opts.length-1]:[...opts].reverse().find(o=>o.px<cur-4)||opts[0];
  else target=opts.reduce((a,b)=>Math.abs(b.px-cur)<Math.abs(a.px-cur)?b:a);
  buzz(5);snapTo(target.n);
}
addEventListener('pointerup',endDrag);
addEventListener('pointercancel',e=>{if(drag&&e.pointerId===drag.id){drag=null;snapTo(sheetUI.snap);}});
sheet.addEventListener('click',e=>{if(suppressClick){e.stopPropagation();e.preventDefault();}},true);
$('#sheetHandle').addEventListener('click',()=>{
  const order=sheetUI.snaps,i=order.indexOf(sheetUI.snap);snapTo(order[(i+1)%order.length]);});
$('#sheetHandle').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#sheetHandle').click();}});
addEventListener('resize',()=>snapTo(sheetUI.snap,false));

/* =====================================================================
   SIDER – én stabel, felles tilbake (knapp, Esc, Android-tilbake)
   ===================================================================== */
const pages={};
const router={
  cur:{name:'home',params:{}},stack:[],skipPop:0,
  show(name,params={},dir='fwd',keepSnap=false){
    const prev=this.cur.name;
    if(pages[prev]?.leave)pages[prev].leave();
    this.cur={name,params,...pages[name]};
    document.body.dataset.page=name;
    sheetUI.snaps=pages[name].snaps||['peek','half','full'];
    this.render(dir);
    if(!keepSnap)snapTo(params.snap||pages[name].initial||'half');
    else snapTo(sheetUI.snap);
    pages[name].enter?.(params,dir);
    renderStopsLayer();
  },
  render(dir='fwd'){
    const p=pages[this.cur.name];
    $('#sheetHead').className='sheet-head'+(p.headClass?' '+p.headClass:'');
    $('#sheetHead').innerHTML=p.head(this.cur.params);
    const page=$('#sheetPage');
    page.className='sheet-page'+(dir==='back'?' back':'');
    if(dir)void page.offsetWidth;
    page.innerHTML=p.body(this.cur.params);
    if(dir){sheetScroll.scrollTop=0;}else page.style.animation='none';
    if(dir)page.style.animation='';
    $('#sheetHead .back')?.addEventListener('click',()=>{buzz(6);router.back();});
    p.bind?.(this.cur.params);
  },
  refresh(){ // oppdater innhold uten animasjon og uten å miste rulleposisjon
    const st=sheetScroll.scrollTop,p=pages[this.cur.name];
    if(p.update)p.update(this.cur.params);else{this.render(null);sheetScroll.scrollTop=st;}
  },
  go(name,params={},{replace=false}={}){
    if(name===this.cur.name&&JSON.stringify(params)===JSON.stringify(this.cur.params))return;
    if(!replace){this.stack.push({name:this.cur.name,params:this.cur.params,snap:sheetUI.snap});history.pushState({d:this.stack.length},'');}
    this.show(name,params,'fwd');
  },
  back(){if(this.stack.length)history.back();},
  home(){
    const n=this.stack.length;this.stack.length=0;
    if(n){this.skipPop++;history.go(-n);}
    this.show('home',{},'back');
  }
};
history.replaceState({d:0},'');
addEventListener('popstate',()=>{
  if(router.skipPop){router.skipPop--;return;}
  const prev=router.stack.pop();if(!prev)return;
  router.show(prev.name,prev.params,'back',true);snapTo(prev.snap||'half');
});
addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.target.closest?.('input'))router.back();});
const backBtn='<button class="icon-btn back press" type="button" aria-label="Tilbake">'+ico('back')+'</button>';

/* ---------- Avgangsrader ---------- */
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
function depRow(s,r){
  const md=modeOf(r.mode),dist=distTo(s);
  const reach=s.stale?null:reachStatus(dist,r.exp);
  const quay=r.quay?` · ${r.mode==='rail'||r.mode==='metro'?'spor':'plattform'} ${esc(r.quay)}`:'';
  return`<div class="dep"><span class="badge badge-l" style="--c:${md.c}" title="${md.n}">${esc(r.pub)}</span>
    <span class="dest"><b>${esc(r.dest)}</b><small>${md.n}${quay}${reach?` · <span class="reach ${reach.cls}">${esc(reach.label)}</span>`:''}</small></span>
    ${whenHtml(`${s.id}|${r.pub}|${r.dest}|${r.aimed}`,r)}</div>`;
}
function miniRow(s,r){
  const m=minUntil(r.exp),md=modeOf(r.mode);
  const t=m<=0?'<span class="m now">nå</span>':m<60?`<span class="m">${r.rt?'<i class="live"></i>':''}${m}<small>min</small></span>`:`<span class="m">${fmtT(r.exp)}</span>`;
  return`<div class="mini"><span class="badge" style="--c:${md.c}">${esc(r.pub)}</span><span class="d">${esc(r.dest)}</span>${t}</div>`;
}
const upcoming=id=>(state.deps.get(id)?.rows||[]).filter(r=>r.exp>Date.now()-30000);
function stopCard(s){
  const rows=upcoming(s.id),d=distTo(s),fav=favs.some(f=>f.id===s.id),entry=state.deps.get(s.id);
  const body=!entry?'<div class="mini"><span class="skel" style="width:32px;height:22px"></span><span class="skel" style="width:70%"></span><span class="skel" style="width:36px"></span></div>':
    rows.length?rows.slice(0,3).map(r=>miniRow(s,r)).join(''):'<div class="mini"><span class="d" style="grid-column:1/-1;color:var(--ink-3)">Ingen avganger den neste timen</span></div>';
  return`<button class="stop-card" type="button" data-stop="${esc(s.id)}"><div class="top"><b>${esc(s.name)}</b>
    <span class="dist">${fav?ico('star','fav'):''}${d!=null?`${fmtDist(d)} · ${walkMin(d)} min`:''}</span></div>${body}</button>`;
}

/* ---------- Side: Hjem ---------- */
pages.home={
  initial:'half',peek:196,
  head(){
    const loc=state.pos?'Rundt deg':state.nearbyAt?'Rundt kartsenteret':'Henter posisjon…';
    return`<div class="titles"><div class="head-title">Avganger</div><div class="head-sub" id="homeSub">${loc}${state.updated?` · oppdatert ${fmtT(state.updated)}`:''}</div></div>
      <button class="icon-btn press" id="homeRefresh" type="button" aria-label="Oppdater avganger">${ico('refresh')}</button>`;
  },
  body(){
    const n=state.alerts.length;
    let h=n?`<button class="notice press" id="alertsNotice" type="button">${ico('alert')}<span><b>${n} ${plural(n,'trafikkmelding','trafikkmeldinger')}</b><span class="one">${esc(state.alerts[0].summary)}</span></span>${ico('chev')}</button>`:'';
    if(favs.length)h+=`<div class="label">Favoritter</div>${favs.map(stopCard).join('')}`;
    const near=state.nearby.filter(s=>!favs.some(f=>f.id===s.id)).slice(0,8);
    if(near.length)h+=`<div class="label">I nærheten</div>${near.map(stopCard).join('')}`;
    else if(!favs.length)h+=state.nearbyAt?`<div class="state">${ico('stop')}<b>Ingen holdeplasser her</b>Flytt kartet eller søk etter et sted.</div>`:
      `<div class="mini" style="padding:12px 16px">${'<span class="skel" style="height:40px"></span>'}</div>`;
    if(!state.pos&&state.nearbyAt)h+=`<p class="note">Slå på posisjon for å se holdeplassene rundt deg. <button class="reach" id="geoAsk" type="button">Bruk posisjonen min</button></p>`;
    return h;
  },
  bind(){
    $('#homeRefresh').onclick=()=>{buzz(8);$('#homeRefresh').classList.add('spin');loadDeps(true).finally(()=>$('#homeRefresh')?.classList.remove('spin'));};
    $('#alertsNotice')?.addEventListener('click',()=>{buzz(6);router.go('alerts');});
    $('#geoAsk')?.addEventListener('click',()=>{buzz(8);requestGeoOnce();});
    $$('#sheetPage [data-stop]').forEach(b=>b.onclick=()=>{buzz(6);router.go('stop',{id:b.dataset.stop});});
  },
  enter(p,dir){clearRoute();clearPins();loadDeps();}
};

/* ---------- Side: Søk ---------- */
pages.search={
  snaps:['full'],initial:'full',headClass:'search-head',
  head(){
    return`<div class="row">${backBtn}
      <div class="route-card"><div class="route-rail" aria-hidden="true"><span class="a"></span><i></i><span class="b"></span></div>
        <div class="route-field"><input id="fromInput" type="text" placeholder="Min posisjon" autocomplete="off" enterkeyhint="next" aria-label="Fra"
          role="combobox" aria-autocomplete="list" aria-controls="sheetPage" value="${esc(state.fromSel?.name||'')}"></div>
        <div class="route-field"><input id="toInput" type="text" placeholder="Hvor vil du?" autocomplete="off" enterkeyhint="search" aria-label="Til"
          role="combobox" aria-autocomplete="list" aria-controls="sheetPage" value="${esc(state.dest?.name||'')}"></div>
        <button class="swap press" id="swapBtn" type="button" aria-label="Bytt fra og til">${ico('swap')}</button></div></div>
      <div class="when-row"><div class="seg" id="timeSeg" role="group" aria-label="Tidspunkt">
        ${[['now','Nå'],['dep','Avreise'],['arr','Ankomst']].map(([k,l])=>`<button type="button" data-m="${k}" aria-pressed="${state.timeMode===k}">${l}</button>`).join('')}</div>
        <input class="time-input" type="time" id="timeInput" aria-label="Klokkeslett" value="${esc(state.time)}" ${state.timeMode==='now'?'hidden':''}></div>`;
  },
  body(){return'<div id="suggest"></div>';},
  bind(params){
    const from=$('#fromInput'),to=$('#toInput');
    let field=params.focus==='from'?from:to;
    const suggest=()=>renderSuggestions(field);
    [from,to].forEach(inp=>{
      inp.addEventListener('focus',()=>{field=inp;inp.select();suggest();});
      inp.addEventListener('input',()=>{
        if(inp===from)state.fromSel=null;else state.dest=null;
        debounceSearch(inp);});
      inp.addEventListener('keydown',e=>{
        const opts=$$('#suggest .opt:not(:disabled)'),i=opts.findIndex(o=>o.getAttribute('aria-selected')==='true');
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();
          const j=e.key==='ArrowDown'?Math.min(opts.length-1,i+1):Math.max(0,i-1);
          opts.forEach((o,k)=>o.setAttribute('aria-selected',String(k===j)));opts[j]?.scrollIntoView({block:'nearest'});}
        else if(e.key==='Enter'){e.preventDefault();(opts[i]||opts[0])?.click();}
        else if(e.key==='Escape'){router.back();}
      });
    });
    $('#swapBtn').onclick=()=>{buzz(8);const b=$('#swapBtn');b.classList.remove('turn');void b.offsetWidth;b.classList.add('turn');
      const f=state.fromSel;state.fromSel=state.dest;
      state.dest=f||(state.pos?{name:'Min posisjon',lat:state.pos[0],lon:state.pos[1]}:null);
      from.value=state.fromSel?.name||'';to.value=state.dest?.name||'';
      if(state.dest&&(state.fromSel||state.pos))startTripSearch(true);};
    $$('#timeSeg button').forEach(b=>b.onclick=()=>{buzz(6);state.timeMode=b.dataset.m;
      $$('#timeSeg button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
      const ti=$('#timeInput');ti.hidden=state.timeMode==='now';
      if(!ti.hidden&&!ti.value){const d=new Date(Date.now()+15*60000);ti.value=state.time=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}});
    $('#timeInput').onchange=e=>{state.time=e.target.value;};
    // Fokus etter at siden har glidd inn, så tastaturet ikke hopper.
    setTimeout(()=>{field.focus({preventScroll:true});},reduceMotion.matches?0:200);
    suggest();
  }
};
let searchDebounce=null,searchSeq=0;
function debounceSearch(inp){
  clearTimeout(searchDebounce);
  const q=inp.value.trim();
  if(q.length<2){renderSuggestions(inp);return;}
  $('#suggest').innerHTML=`<button class="opt" type="button" disabled><span class="kind">${ico('search')}</span><span>Søker…</span></button>`;
  const seq=++searchSeq;
  searchDebounce=setTimeout(async()=>{
    const fs=await searchPlaces(q);
    if(seq!==searchSeq||router.cur.name!=='search')return;
    if(!fs||!fs.length){$('#suggest').innerHTML=`<button class="opt" type="button" disabled><span class="kind">${ico('search')}</span><span>${fs?'Ingen treff. Prøv gatenavn med husnummer, eller et sted i nærheten.':'Søket er ikke tilgjengelig akkurat nå.'}</span></button>`;return;}
    showOptions(inp,fs.map(f=>({icon:KIND_ICON[f.kind]||'place',title:f.name,sub:[f.kind,f.locality].filter(Boolean).join(' · '),place:f})));
  },240);
}
function renderSuggestions(inp){
  const q=inp.value.trim();
  if(q.length>=2&&!(inp.id==='fromInput'?state.fromSel:state.dest))return debounceSearch(inp);
  const opts=[];
  if(inp.id==='fromInput'&&state.pos)opts.push({icon:'locate',me:true,title:'Min posisjon',sub:'Bruk der du er nå',place:null});
  recentTargets.slice(0,5).forEach(t=>opts.push({icon:'clock',title:t.name,sub:'Nylig',place:t}));
  favs.forEach(f=>opts.push({icon:'star',title:f.name,sub:'Favoritt',place:{...f,kind:'Holdeplass'}}));
  if(!opts.length){$('#suggest').innerHTML='<p class="note">Søk etter adresse, holdeplass eller sted. Du kan også holde fingeren på kartet for å velge et punkt.</p>';return;}
  showOptions(inp,opts);
}
function showOptions(inp,opts){
  $('#suggest').innerHTML=opts.map((o,i)=>`<button class="opt" type="button" role="option" data-i="${i}"><span class="kind${o.me?' me':''}">${ico(o.icon)}</span>
    <span><b>${esc(o.title)}</b>${o.sub?`<small>${esc(o.sub)}</small>`:''}</span></button>`).join('');
  $$('#suggest .opt').forEach(b=>b.onclick=()=>{buzz(6);const o=opts[+b.dataset.i];choosePlace(inp,o.place);});
}
function choosePlace(inp,place){
  const from=inp.id==='fromInput';
  if(from){state.fromSel=place;inp.value=place?.name||'';}
  else{state.dest=place;inp.value=place.name;}
  if(state.dest&&(state.fromSel||state.pos))startTripSearch(true);
  else if(from)$('#toInput').focus();
  else{$('#fromInput').focus();toast('Velg hvor du reiser fra.');}
}
const KIND_ICON={Holdeplass:'stop',Knutepunkt:'stop',Adresse:'place',Gate:'street','Nylig brukt':'clock'};

/* ---------- Side: Reiseforslag ---------- */
pages.results={
  initial:'half',peek:168,
  head(){
    const when=state.timeMode==='now'?'Avreise nå':`${state.timeMode==='arr'?'Fremme':'Avreise'} kl. ${state.time||'--:--'}`;
    return`${backBtn}<button class="titles press" id="editTrip" type="button" aria-label="Endre søket">
      <div class="head-title">Til ${esc(state.dest?.name||'')}</div><div class="head-sub">Fra ${esc(state.fromSel?.name||'Min posisjon')} · ${when}</div></button>`;
  },
  body(){
    if(state.tripsLoading)return'<div class="trip" style="animation:none"><span class="skel" style="width:46%;height:20px"></span><span class="skel" style="margin:14px 0 12px;height:8px"></span><span class="skel" style="width:70%"></span></div>'.repeat(3);
    if(state.tripError)return`<div class="state">${ico('alert')}<b>Reisesøket feilet</b>${esc(state.tripError)}<button class="btn btn-ink press" id="tripRetry" type="button">Prøv igjen</button></div>`;
    if(!state.trips.length)return`<div class="state">${ico('route')}<b>Ingen reiser funnet</b>Prøv et annet tidspunkt eller et sted i nærheten.</div>`;
    const ps=state.trips,fastest=Math.min(...ps.map(p=>p.duration));
    const fastestIdx=ps.some(p=>p.duration>fastest)?ps.findIndex(p=>p.duration===fastest):-1;
    return ps.map((p,i)=>tripCard(p,i,i===fastestIdx)).join('');
  },
  bind(){
    $('#editTrip').onclick=()=>{buzz(6);router.go('search');};
    $('#tripRetry')?.addEventListener('click',()=>startTripSearch(true));
    $$('#sheetPage .trip[data-p]').forEach(el=>el.onclick=()=>{buzz(10);
      state.tripIdx=+el.dataset.p;drawRoute(state.trips[state.tripIdx]);router.go('trip',{i:state.tripIdx});});
  },
  enter(){if(state.trips.length)drawRoute(state.trips[state.tripIdx]);}
};
function tripCard(p,i,isFastest){
  const legs=p.legs||[],rides=legs.filter(l=>l.mode!=='foot'),first=rides[0];
  const total=legs.reduce((s,l)=>s+(l.duration||0),0)||1;
  const bar=legs.map((l,j)=>`<i class="${l.mode==='foot'?'walk':''}" style="flex:${Math.max(.04,(l.duration||0)/total)};--c:${modeOf(l.mode).c};animation-delay:${i*50+j*40}ms"></i>`).join('');
  const chips=legs.filter(l=>l.mode!=='foot'||l.duration>=60).map(l=>l.mode==='foot'
    ?`<span class="walk">${ico('walk')}${Math.round(l.duration/60)}</span>`
    :`<span class="badge" style="--c:${modeOf(l.mode).c}" title="${modeOf(l.mode).n}">${esc(l.line?.publicCode||modeOf(l.mode).n)}</span>`)
    .join(ico('chev','sep'));
  let foot='<span>Gå hele veien</span>';
  if(first){const m=minUntil(first.expectedStartTime);
    const when=m<=0?'nå':m<60?`om ${m} min`:`kl. ${fmtT(first.expectedStartTime)}`;
    foot=`<span>${modeOf(first.mode).n} fra <b>${esc(placeName(first.fromPlace,p.fromName))}</b> <span class="${m<=5?'soon':''}">${when}</span></span>`;}
  return`<button class="trip${i===state.tripIdx?' sel':''}" type="button" data-p="${i}" style="animation-delay:${i*50}ms">
    <div class="trip-top"><span class="t">${fmtT(p.expectedStartTime)}<span>–</span>${fmtT(p.expectedEndTime)}</span>
      <span class="dur">${Math.round(p.duration/60)} min${isFastest?'<span class="fast">Raskest</span>':''}</span></div>
    <div class="bar" aria-hidden="true">${bar}</div><div class="legs">${chips||'<span class="walk">Gange</span>'}</div>
    <div class="trip-foot">${foot}<span>${changesText(Math.max(0,rides.length-1))}</span></div></button>`;
}

/* ---------- Side: Reisen ---------- */
pages.trip={
  initial:'half',peek:150,
  head(){
    const p=state.trips[state.tripIdx];if(!p)return backBtn;
    const rides=(p.legs||[]).filter(l=>l.mode!=='foot');
    return`${backBtn}<div class="titles"><div class="head-title">${fmtT(p.expectedStartTime)}–${fmtT(p.expectedEndTime)}</div>
      <div class="head-sub">${Math.round(p.duration/60)} min · ${changesText(Math.max(0,rides.length-1))}${p.walkDistance?` · ${fmtDist(p.walkDistance)} gange`:''}</div></div>
      <button class="icon-btn press" id="fitRoute" type="button" aria-label="Vis hele reisen">${ico('expand')}</button>
      <button class="icon-btn press" id="closeTrip" type="button" aria-label="Avslutt">${ico('x')}</button>`;
  },
  body(){
    const p=state.trips[state.tripIdx];if(!p)return'';
    const legs=p.legs||[];
    const steps=legs.map((l,i)=>{
      const walk=l.mode==='foot',md=modeOf(l.mode);
      const place=esc(i===0?placeName(l.fromPlace,p.fromName):placeName(l.fromPlace,'Bytte'));
      let what;
      if(walk)what=`${ico('walk')}<span>Gå ${Math.max(1,Math.round(l.duration/60))} min<small> · ${fmtDist(l.distance||0)}</small></span>`;
      else{const toward=l.fromEstimatedCall?.destinationDisplay?.frontText;
        what=`<span class="badge" style="--c:${md.c}">${esc(l.line?.publicCode||md.n)}</span><span>${md.n}${toward?` mot ${esc(toward)}`:''}</span>`;}
      const meta=walk?'':[l.fromPlace?.quay?.publicCode?`${l.mode==='rail'||l.mode==='metro'?'Spor':'Plattform'} ${esc(l.fromPlace.quay.publicCode)}`:'',
        l.realtime?'Sanntid':'Rutetid'].filter(Boolean).join(' · ');
      const stops=walk?[]:(l.intermediateEstimatedCalls||[]).filter(c=>c.quay?.name);
      const details=walk||!p.stopDetailsAvailable?'':stops.length?`<details${stops.length<=4?' open':''}><summary>${ico('chev')}${stops.length} stopp underveis</summary>
        <ol>${stops.map(c=>`<li><span>${esc(c.quay.name)}</span>${c.expectedArrivalTime?`<time>${fmtT(c.expectedArrivalTime)}</time>`:''}</li>`).join('')}</ol></details>`:'<div class="meta">Ingen stopp underveis</div>';
      return`<div class="leg${walk?' walk':''}" style="--c:${walk?'var(--ink-3)':md.c}"><time>${fmtT(l.expectedStartTime)}</time>
        <span class="rail"><span class="node"></span></span><div class="body"><div class="place">${place}</div><div class="what">${what}</div>${meta?`<div class="meta">${meta}</div>`:''}${details}</div></div>`;
    }).join('');
    const last=legs[legs.length-1];
    return(p.schematic?'<div class="jnote">Kartlinjen er forenklet. Følg stoppene og byttene her.</div>':'')+steps+
      `<div class="leg end"><time>${fmtT(p.expectedEndTime)}</time><span class="rail"><span class="node"></span></span>
      <div class="body"><div class="place">${esc(placeName(last?.toPlace,p.toName))}</div></div></div>`;
  },
  bind(){
    $('#fitRoute')?.addEventListener('click',()=>{buzz(6);fitRoute();});
    $('#closeTrip')?.addEventListener('click',()=>{buzz(6);router.home();});
  },
  enter(){drawRoute(state.trips[state.tripIdx]);}
};

/* ---------- Side: Holdeplass ---------- */
const stopFilter=new Map();
function findStop(id){
  return state.nearby.find(s=>s.id===id)||state.viewStops.get(id)||favs.find(f=>f.id===id)||null;
}
pages.stop={
  initial:'half',peek:168,
  head({id}){
    const s=findStop(id)||{name:'Holdeplass'},d=s.lat!=null?distTo(s):null,fav=favs.some(f=>f.id===id);
    return`${backBtn}<div class="titles"><div class="head-title">${esc(s.name)}</div><div class="head-sub">${d!=null?`${fmtDist(d)} · ${walkMin(d)} min å gå`:'Holdeplass'}</div></div>
      <button class="star press" id="favBtn" type="button" aria-pressed="${fav}" aria-label="${fav?'Fjern fra':'Legg til i'} favoritter">${ico('star')}</button>`;
  },
  body({id}){
    const s=findStop(id)||{id},entry=state.deps.get(id);
    if(!entry)return'<div class="dep"><span class="skel" style="height:28px"></span><span class="skel"></span><span class="skel"></span></div>'.repeat(4);
    const rows=upcoming(id);
    const modes=[...new Set(rows.map(r=>r.mode))];
    const f=stopFilter.get(id);
    const filters=modes.length>1?`<div class="filters" role="group" aria-label="Filtrer">${['all',...modes].map(m=>
      `<button class="filter press" type="button" data-m="${m}" ${m!=='all'?`style="--c:${modeOf(m).c}"`:''} aria-pressed="${(f||'all')===m}">${m==='all'?'Alle':`<i></i>${modeOf(m).n}`}</button>`).join('')}</div>`:'';
    const list=rows.filter(r=>!f||r.mode===f);
    return filters+(entry.error&&!rows.length?`<div class="state">${ico('alert')}<b>Fikk ikke hentet avganger</b>Prøv igjen om litt.</div>`:
      list.length?list.map(r=>depRow({...s,stale:entry.stale},r)).join(''):'<div class="state">Ingen avganger den neste timen.</div>')+
      `<p class="note">Gangtid er anslått fra luftlinje med litt omvei. «Gå nå» gir to minutters margin.</p>`;
  },
  bind({id}){
    $('#favBtn').onclick=()=>toggleFav(id);
    $$('#sheetPage .filter').forEach(b=>b.onclick=()=>{buzz(6);stopFilter.set(id,b.dataset.m==='all'?null:b.dataset.m);router.refresh();});
  },
  enter({id}){
    const s=findStop(id);
    if(s&&mapLoaded){
      const b=map.getBounds();
      if(!b.contains([s.lon,s.lat])||map.getZoom()<15)map.easeTo({center:[s.lon,s.lat],zoom:Math.max(map.getZoom(),16),duration:reduceMotion.matches?0:600,padding:mapPadding()});
      setFollow(false);
    }
    loadStopDeps(id).then(()=>{if(router.cur.name==='stop'&&router.cur.params.id===id)router.refresh();});
  }
};
function toggleFav(id){
  buzz(12);
  const s=findStop(id);if(!s)return;
  const had=favs.some(f=>f.id===id);
  favs=had?favs.filter(f=>f.id!==id):[...favs,{id:s.id,name:s.name,lat:s.lat,lon:s.lon}];
  saveJSON('reisFavs',favs);
  const b=$('#favBtn');if(b){b.setAttribute('aria-pressed',String(!had));if(!had){b.classList.remove('bump');void b.offsetWidth;b.classList.add('bump');}}
  renderStopsLayer();
  toast(had?'Fjernet fra favoritter':'Lagt til i favoritter');
}

/* ---------- Side: Trafikkmeldinger ---------- */
pages.alerts={
  snaps:['full'],initial:'full',
  head(){return`${backBtn}<div class="titles"><div class="head-title">Trafikkmeldinger</div><div class="head-sub">${state.alertsAt?`Oppdatert kl. ${fmtT(state.alertsAt)}`:'Henter…'}</div></div>`;},
  body(){
    if(!state.alerts.length)return`<div class="state">${ico('check')}<b>Ingen avvik</b>Trafikken går som normalt.</div>`;
    const fmtWhen=ts=>{const d=new Date(ts);const today=d.toDateString()===new Date().toDateString();
      return today?`kl. ${fmtT(d)}`:d.toLocaleDateString('nb-NO',{day:'numeric',month:'short'})+` kl. ${fmtT(d)}`;};
    return state.alerts.map((a,i)=>{
      const t=a.start||a.end?`${a.start?'Fra '+fmtWhen(a.start):''}${a.end?`${a.start?' til ':'Til '}${fmtWhen(a.end)}`:''}`:'';
      return`<article class="alert" style="animation-delay:${Math.min(i,8)*30}ms"><span class="sev ${a.sev}" aria-hidden="true"></span><div>
        <h4>${esc(a.summary)}</h4>${a.desc&&a.desc!==a.summary?`<p>${esc(a.desc)}</p>`:''}${t?`<time>${t}</time>`:''}</div></article>`;
    }).join('');
  }
};

/* ---------- Side: Innstillinger ---------- */
pages.settings={
  snaps:['full'],initial:'full',
  head(){return`${backBtn}<div class="titles"><div class="head-title">Innstillinger</div></div>`;},
  body(){
    const walk=settings.walkKmh.toFixed(1).replace('.',',');
    return`<div class="group">
      <div class="row-item"><span class="lbl"><b>Utseende</b></span><div class="seg" id="themeSeg" role="group" aria-label="Utseende">
        ${[['auto','Auto'],['light','Lys'],['dark','Mørk']].map(([k,l])=>`<button type="button" data-t="${k}" aria-pressed="${settings.theme===k}">${l}</button>`).join('')}</div></div>
      <div class="row-item"><span class="lbl"><b>Gangfart</b><small id="walkVal">${walk} km/t</small></span>
        <input type="range" id="walkRange" min="3" max="6" step="0.5" value="${settings.walkKmh}" aria-label="Gangfart"></div>
      <label class="row-item" for="vehToggle"><span class="lbl"><b>Kjøretøy i sanntid</b><small>Vises på kartet når du zoomer inn</small></span>
        <span class="switch"><input type="checkbox" id="vehToggle" ${settings.showVehicles?'checked':''}><span class="tr"></span></span></label>
      <label class="row-item" for="vibToggle"><span class="lbl"><b>Vibrasjon</b><small>Kort tilbakemelding ved trykk</small></span>
        <span class="switch"><input type="checkbox" id="vibToggle" ${settings.vibrate?'checked':''}><span class="tr"></span></span></label>
    </div>
    <div class="group" style="margin-top:14px">
      ${canInstall()?`<button class="row-item press" id="installBtn" type="button"><span class="lbl"><b>Legg til på hjemskjermen</b><small>Åpnes i fullskjerm som en vanlig app</small></span>${ico('chev')}</button>`:''}
      <button class="row-item press" id="resetBtn" type="button"><span class="lbl"><b style="color:var(--late)">Nullstill appen</b><small>Sletter favoritter, nylige mål og innstillinger</small></span></button>
    </div>
    <div class="about"><svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect class="m-bg" width="64" height="64" rx="15"/><path class="m-line" d="M19 45h9l13-13V19"/><circle class="m-start" cx="19" cy="45" r="4.5"/><circle class="m-end" cx="41" cy="19" r="6"/></svg>
      <div><b>reis</b><br>Sanntid og reisesøk fra Entur (åpne data, NLOD). Kart © OpenStreetMap-bidragsytere, OpenMapTiles og OpenFreeMap. Uavhengig app, ikke tilknyttet Ruter AS.</div></div>`;
  },
  bind(){
    $$('#themeSeg button').forEach(b=>b.onclick=()=>{buzz(6);settings.theme=b.dataset.t;saveSettings();paintTheme();
      $$('#themeSeg button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});
    $('#walkRange').oninput=e=>{settings.walkKmh=+e.target.value;saveSettings();$('#walkVal').textContent=settings.walkKmh.toFixed(1).replace('.',',')+' km/t';};
    $('#vehToggle').onchange=e=>{settings.showVehicles=e.target.checked;saveSettings();if(!settings.showVehicles)setData('vehicles',EMPTY);else refreshVehicles(true);};
    $('#vibToggle').onchange=e=>{settings.vibrate=e.target.checked;saveSettings();buzz(10);};
    $('#installBtn')?.addEventListener('click',doInstall);
    $('#resetBtn').onclick=()=>{
      if(confirm('Slette favoritter, nylige reisemål og innstillinger?')){
        ['reisFavs','reisSettings','reisDepCache','reisRecentTargets','reisOnboarded'].forEach(k=>{try{localStorage.removeItem(k);}catch(e){}});
        location.reload();}};
  }
};
$('#searchBar').onclick=()=>{buzz(8);router.go('search',{focus:'to'});};
$('#menuBtn').onclick=()=>{buzz(6);router.go('settings');};

/* =====================================================================
   DATA
   ===================================================================== */

/* ---------- Posisjon ---------- */
let geoWatch=null,firstFix=true;
function handlePos(p){
  const lat=p.coords.latitude,lon=p.coords.longitude;
  state.pos=[lat,lon];state.acc=Math.round(p.coords.accuracy||0);
  state.heading=(p.coords.heading!=null&&!isNaN(p.coords.heading))?p.coords.heading:null;
  meMarker.setLngLat([lon,lat]);if(!meMarker._map)meMarker.addTo(map);
  meEl.classList.toggle('has-heading',state.heading!=null);
  if(state.heading!=null)meEl.querySelector('.cone').style.transform=`rotate(${state.heading}deg)`;
  renderAcc();
  if(firstFix){firstFix=false;setFollow(true);
    if(router.cur.name==='home'||router.cur.name==='search')map.jumpTo({center:[lon,lat],zoom:15.5});}
  else if(state.follow&&router.cur.name!=='trip'&&router.cur.name!=='results')map.easeTo({center:[lon,lat],duration:reduceMotion.matches?0:800});
  if(!state.nearbyAt||geoDist(state.nearbyAt,[lat,lon])>120)loadNearby(lat,lon,true);
}
function requestGeoOnce(){
  if(!('geolocation' in navigator)){toast('Enheten støtter ikke posisjon.');return;}
  navigator.geolocation.getCurrentPosition(p=>{handlePos(p);startGeo();},
    ()=>toast('Fikk ikke tilgang til posisjon. Sjekk tillatelsene.'),{enableHighAccuracy:true,timeout:15000});
}
function startGeo(){
  if(!('geolocation' in navigator)){geoFallback();return;}
  if(geoWatch!=null)return;
  geoWatch=navigator.geolocation.watchPosition(handlePos,geoFallback,{enableHighAccuracy:true,maximumAge:8000,timeout:20000});
}
function geoFallback(err){
  if(err&&err.code===err.PERMISSION_DENIED&&geoWatch!=null){navigator.geolocation.clearWatch(geoWatch);geoWatch=null;}
  if(!state.pos&&!state.nearbyAt)loadNearby(OSLO[0],OSLO[1],true);
}

/* ---------- Holdeplasser ---------- */
async function reverseStops(lat,lon,radiusKm,limit){
  const url=`${API.reverse}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radius=${radiusKm}&limit=${limit}&layers=stopPlace&lang=no`;
  const r=await fetchWithTimeout(url,{headers:{'ET-Client-Name':API.client}},15000);
  if(!r.ok)throw new Error(`Stedsøket svarte ${r.status}`);
  const data=await r.json();
  return(data.features||[]).filter(f=>f.properties?.id?.startsWith('NSR:StopPlace:')&&f.geometry?.coordinates?.length>=2)
    .map(f=>({id:f.properties.id,name:f.properties.names?.default||f.properties.name||'Holdeplass',lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0]}));
}
let nearbySeq=0;
async function loadNearby(lat,lon){
  const seq=++nearbySeq;
  state.nearbyAt=[lat,lon];
  try{
    const found=await reverseStops(lat,lon,1.5,12);
    if(seq!==nearbySeq)return;
    state.nearby=found.map(s=>({...s,_d:geoDist([lat,lon],[s.lat,s.lon])})).sort((a,b)=>a._d-b._d).slice(0,10);
    setNetworkState(true);
    renderStopsLayer();
    if(router.cur.name==='home')router.refresh();
    await loadDeps(true);
  }catch(e){
    if(seq!==nearbySeq)return;
    const cache=loadJSON('reisDepCache',null);
    if(cache?.stops?.length&&!state.nearby.length){
      state.nearby=cache.stops;cache.stops.forEach(s=>s.rows&&state.deps.set(s.id,{rows:s.rows,t:cache.t,stale:true}));
      if(router.cur.name==='home')router.refresh();
    }
  }
}
// Holdeplasser der du ser på kartet, så du kan utforske uten å søke.
let viewTimer=null;
map.on('moveend',()=>{
  clearTimeout(viewTimer);
  viewTimer=setTimeout(async()=>{
    if(map.getZoom()<14.2||router.cur.name==='results'||router.cur.name==='trip')return;
    const c=map.getCenter(),b=map.getBounds();
    const r=Math.min(1.5,geoDist([b.getNorth(),b.getWest()],[b.getSouth(),b.getEast()])/2000);
    try{
      const found=await reverseStops(c.lat,c.lng,Math.max(.3,r),40);
      found.forEach(s=>state.viewStops.set(s.id,s));
      if(state.viewStops.size>400)state.viewStops=new Map([...state.viewStops].slice(-300));
      renderStopsLayer();
      // Uten posisjon følger «I nærheten» kartet.
      if(!state.pos&&(!state.nearbyAt||geoDist(state.nearbyAt,[c.lat,c.lng])>500))loadNearby(c.lat,c.lng);
    }catch(e){}
    refreshVehicles();
  },500);
});

/* ---------- Avganger ---------- */
async function fetchStopDeps(id,n=14){
  const d=await gql(Q_DEP,{id,n});
  const now=Date.now()-60000,seen=new Set(),rows=[];
  (d.stopPlace?.estimatedCalls||[]).forEach(c=>{
    if(c.forBoarding===false)return;
    const exp=new Date(c.expectedDepartureTime).getTime();
    if(!Number.isFinite(exp)||exp<now)return;
    const line=c.serviceJourney?.journeyPattern?.line||{};
    const dest=c.destinationDisplay?.frontText||'—';
    const key=c.serviceJourney?.id||`${line.publicCode}|${dest}|${c.aimedDepartureTime}`; // samme tur fra flere plattformer
    if(seen.has(key))return;seen.add(key);
    rows.push({dest,pub:line.publicCode||'?',mode:line.transportMode||'bus',exp,aimed:new Date(c.aimedDepartureTime).getTime(),rt:!!c.realtime,quay:c.quay?.publicCode});
  });
  return rows.sort((a,b)=>a.exp-b.exp);
}
async function loadStopDeps(id){
  try{state.deps.set(id,{rows:await fetchStopDeps(id),t:Date.now()});}
  catch(e){const old=state.deps.get(id);state.deps.set(id,{rows:old?.rows||[],t:old?.t,stale:true,error:true});}
}
let depsBusy=false;
async function loadDeps(force=false){
  if(depsBusy)return;
  const ids=[...new Set([...favs.map(f=>f.id),...state.nearby.slice(0,8).map(s=>s.id)])]
    .filter(id=>force||!state.deps.get(id)||Date.now()-state.deps.get(id).t>REFRESH_MS);
  if(!ids.length)return;
  depsBusy=true;
  await Promise.all(ids.map(loadStopDeps));
  depsBusy=false;
  state.updated=Date.now();
  saveJSON('reisDepCache',{t:Date.now(),stops:state.nearby.slice(0,8).map(s=>({id:s.id,name:s.name,lat:s.lat,lon:s.lon,rows:state.deps.get(s.id)?.rows||[]}))});
  if(router.cur.name==='home')router.refresh();
}

/* ---------- Kjøretøy (SIRI VM) ---------- */
const tagText=(el,name)=>{const n=el&&el.getElementsByTagName(name)[0];return n?n.textContent:'';};
let vehBusy=false,vehAt=0,vehData=EMPTY;
async function refreshVehicles(force=false){
  const show=settings.showVehicles&&!document.hidden&&mapLoaded&&map.getZoom()>=13&&['home','stop'].includes(router.cur.name);
  if(!show){if(router.cur.name==='results'||router.cur.name==='trip')setData('vehicles',EMPTY);return;}
  if(vehBusy||(!force&&Date.now()-vehAt<25000)){setData('vehicles',vehData);return;}
  vehBusy=true;vehAt=Date.now();
  try{
    const r=await fetchWithTimeout(`${API.vm}?datasetId=RUT`,{headers:{'ET-Client-Name':API.client}},18000);
    if(!r.ok)throw new Error();
    const doc=new DOMParser().parseFromString(await r.text(),'text/xml');
    const feats=[];
    for(const va of doc.getElementsByTagName('VehicleActivity')){
      const gj=va.getElementsByTagName('MonitoredVehicleJourney')[0];if(!gj)continue;
      const lat=parseFloat(tagText(gj,'Latitude')),lon=parseFloat(tagText(gj,'Longitude'));
      if(isNaN(lat)||isNaN(lon))continue;
      const mode=tagText(gj,'VehicleMode').toLowerCase();
      const mc=gj.getElementsByTagName('MonitoredCall')[0];
      feats.push({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{
        mode:MODES[mode]?mode:'other',bearing:parseFloat(tagText(gj,'Bearing'))||0,line:tagText(gj,'LineRef').split(':').pop(),
        dest:tagText(gj,'DestinationName'),next:mc?tagText(mc,'StopPointName'):''}});
    }
    vehData=fc(feats);
    if(['home','stop'].includes(router.cur.name)&&settings.showVehicles)setData('vehicles',vehData);
  }catch(e){}finally{vehBusy=false;}
}

/* ---------- Trafikkmeldinger (SIRI SX) ---------- */
function langText(el,tag){ // velg norsk, så språkløs, så første
  const ns=[...el.getElementsByTagName(tag)];
  const lang=n=>(n.getAttribute('xml:lang')||n.getAttribute('lang')||'').toLowerCase();
  const pick=ns.find(n=>['no','nb','nor','nob'].includes(lang(n)))||ns.find(n=>!lang(n))||ns[0];
  return pick?pick.textContent.trim():'';
}
const SEV_RANK={high:0,med:1,low:2};
function sevClass(s){s=(s||'').toLowerCase();
  if(s==='severe'||s==='verysevere'||s==='high')return'high';
  if(s==='normal'||s==='medium'||s==='warning')return'med';return'low';}
async function loadAlerts(){
  try{
    const r=await fetchWithTimeout(`${API.sx}?datasetId=RUT`,{headers:{'ET-Client-Name':API.client}},25000);
    if(!r.ok)throw new Error();
    const doc=new DOMParser().parseFromString(await r.text(),'text/xml');
    const now=Date.now(),list=[];
    for(const el of doc.getElementsByTagName('PtSituationElement')){
      if(tagText(el,'Progress').toLowerCase()==='closed')continue;
      const vp=el.getElementsByTagName('ValidityPeriod')[0];
      const start=tagText(vp,'StartTime'),end=tagText(vp,'EndTime');
      if(end&&new Date(end).getTime()<now)continue;
      if(start&&new Date(start).getTime()>now+864e5)continue;
      const summary=langText(el,'Summary');if(!summary)continue;
      list.push({sev:sevClass(tagText(el,'Severity')),summary,desc:langText(el,'Description'),start,end});
    }
    list.sort((a,b)=>SEV_RANK[a.sev]-SEV_RANK[b.sev]||(new Date(b.start)-new Date(a.start)));
    state.alerts=list.slice(0,40);state.alertsAt=Date.now();
    if(router.cur.name==='home'||router.cur.name==='alerts')router.refresh();
  }catch(e){}
}

/* ---------- Stedssøk ---------- */
const PLACE_TYPES={stopPlace:'Holdeplass',groupOfStopPlaces:'Knutepunkt',address:'Adresse',street:'Gate',poi:'Sted',place:'Område'};
function placeFromFeature(f){
  const p=f?.properties,c=f?.geometry?.coordinates;
  if(!p||!Array.isArray(c)||!Number.isFinite(+c[0])||!Number.isFinite(+c[1]))return null;
  const name=p.names?.default||p.names?.display||p.name||[p.address?.streetName,p.address?.houseNumber].filter(Boolean).join(' ');
  if(!name)return null;
  return{id:p.id||'',name,locality:p.address?.locality||p.locality||'',kind:PLACE_TYPES[p.layer]||'Sted',lat:+c[1],lon:+c[0]};
}
async function searchPlaces(q){
  const focus=state.pos||(mapLoaded?[map.getCenter().lat,map.getCenter().lng]:OSLO);
  // Eget adressesøk sørger for at et gatenavn treffer også uten husnummer.
  const common=`q=${encodeURIComponent(q)}&limit=16&lang=no&lat=${focus[0]}&lon=${focus[1]}&radius=100`;
  const searches=[`${API.geocoder}?${common}&layers=stopPlace,groupOfStopPlaces,street,address,poi,place`,
    `${API.geocoder}?${common}&layers=street,address&sources=kartverket-matrikkelenadresse`];
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
      if(!unique.has(key))unique.set(key,f);});});
    if(unique.size){
      const needle=q.toLocaleLowerCase('nb-NO').trim();
      // Navnetreff først, deretter nærhet: «Holtet» skal gi holdeplassen i Oslo før adressen i Skien.
      const score=f=>{const n=f.name.toLocaleLowerCase('nb-NO'),km=geoDist(focus,[f.lat,f.lon])/1000;
        return(n===needle?100:n.startsWith(needle)?45:n.includes(needle)?20:0)+(f.kind==='Holdeplass'||f.kind==='Knutepunkt'?14:f.kind==='Gate'||f.kind==='Adresse'?6:0)+
          (km<15?40:km<60?20:km<150?6:0);};
      return[...unique.values()].sort((a,b)=>score(b)-score(a)).slice(0,12);
    }
  }
  try{
    const d=await gql(Q_AUTO,{q});
    const list=(d.autocomplete||[]).filter(f=>f.latitude!=null&&f.longitude!=null)
      .map(f=>({id:f.id,name:f.name||'',locality:f.locality||'',kind:'Holdeplass',lat:f.latitude,lon:f.longitude}));
    if(list.length)return list;
  }catch(e){}
  const needle=q.toLocaleLowerCase('nb-NO');
  const local=[...favs,...recentTargets].filter((f,i,a)=>f?.name&&f.lat!=null&&f.name.toLocaleLowerCase('nb-NO').includes(needle)&&
    a.findIndex(x=>x?.name===f.name&&x?.lat===f.lat)===i).slice(0,8)
    .map(f=>({id:f.id||'',name:f.name,locality:'Lagret på enheten',kind:'Nylig brukt',lat:f.lat,lon:f.lon}));
  if(local.length)return local;
  return reached?[]:null;
}
function rememberTarget(t){
  if(!t||!Number.isFinite(+t.lat)||!Number.isFinite(+t.lon)||t.name==='Punkt på kartet'||t.name==='Min posisjon')return;
  recentTargets=[{name:String(t.name),lat:+t.lat,lon:+t.lon},...recentTargets.filter(x=>x&&(+x.lat!==+t.lat||+x.lon!==+t.lon))].slice(0,6);
  saveJSON('reisRecentTargets',recentTargets);
}

/* ---------- Reisesøk ---------- */
let tripSeq=0;
function startTripSearch(fromSearch=false){
  if(!state.dest)return;
  state.tripsLoading=true;state.tripError=null;state.trips=[];state.tripIdx=0;
  clearRoute();
  if(router.cur.name==='results')router.refresh();
  // Fra søket: gå tilbake til forslagene hvis de ligger under, ellers erstatt søkesiden.
  else if(router.cur.name==='search'&&router.stack[router.stack.length-1]?.name==='results')router.back();
  else router.go('results',{},{replace:fromSearch&&router.cur.name==='search'});
  runTripSearch();
}
async function runTripSearch(){
  const seq=++tripSeq;
  const from=state.fromSel?[state.fromSel.lat,state.fromSel.lon]:state.pos;
  if(!from){state.tripsLoading=false;state.tripError='Velg hvor du reiser fra, eller slå på posisjon.';router.refresh();return;}
  const fromName=state.fromSel?.name||'Min posisjon',toName=state.dest.name||'Mål';
  const vars={fl:from[0],fp:from[1],tl:state.dest.lat,tp:state.dest.lon,dt:null,arr:false};
  if(state.timeMode!=='now'&&state.time){
    const d=new Date();const [hh,mm]=state.time.split(':');d.setHours(+hh,+mm,0,0);
    if(d.getTime()<Date.now()-60000)d.setDate(d.getDate()+1);
    vars.dt=d.toISOString();vars.arr=state.timeMode==='arr';
  }
  try{
    let d,level=tripSchemaLevel;
    for(;;){
      try{d=await gql(Q_TRIP(level),vars);tripSchemaLevel=level;break;}
      catch(e){if(level>=3||!(/validation error|field .*undefined|unknown type/i).test(e.message||''))throw e;level++;}
    }
    if(seq!==tripSeq)return;
    const ps=d.trip?.tripPatterns||[];
    ps.forEach(p=>{p.stopDetailsAvailable=tripSchemaLevel<3;p.fromName=fromName;p.toName=toName;});
    state.trips=ps;state.tripsLoading=false;
    if(ps.length)rememberTarget(state.dest);
  }catch(e){
    if(seq!==tripSeq)return;
    state.tripsLoading=false;state.tripError=e.message||'Ukjent feil';
  }
  if(router.cur.name==='results'){router.render(null);if(state.trips.length)drawRoute(state.trips[0]);}
}

/* ---------- Rute på kartet ---------- */
function decodePoly(enc){
  const pts=[];let i=0,lat=0,lng=0;
  while(i<enc.length){
    let res=0,sh=0,b;
    do{b=enc.charCodeAt(i++)-63;res|=(b&31)<<sh;sh+=5;}while(b>=32);
    lat+=(res&1)?~(res>>1):(res>>1);res=0;sh=0;
    do{b=enc.charCodeAt(i++)-63;res|=(b&31)<<sh;sh+=5;}while(b>=32);
    lng+=(res&1)?~(res>>1):(res>>1);
    pts.push([lng/1e5,lat/1e5]);
  }
  return pts;
}
let routeAnim=null,routeBounds=null,drawnTrip=null;
function clearRoute(){
  cancelAnimationFrame(routeAnim);drawnTrip=null;routeBounds=null;
  setData('route',EMPTY);setData('route-stops',EMPTY);clearPins();
}
function drawRoute(p){
  if(!p||!mapLoaded)return;
  if(drawnTrip===p){fitRoute();return;}
  clearRoute();drawnTrip=p;setData('vehicles',EMPTY);
  const legs=[],stops=[],coords=[];let drawn=0;
  const rides=(p.legs||[]).filter(l=>l.mode!=='foot');
  (p.legs||[]).forEach(l=>{
    let pts=null;
    try{if(l.pointsOnLink?.points)pts=decodePoly(l.pointsOnLink.points);}catch(e){}
    if(!pts||pts.length<2){ // mangler geometri: koble kjente stopp skjematisk
      pts=[l.fromPlace?.quay,...(l.intermediateEstimatedCalls||[]).map(c=>c.quay),l.toPlace?.quay]
        .filter(q=>q&&Number.isFinite(+q.latitude)&&+q.latitude).map(q=>[+q.longitude,+q.latitude]);
      if(pts.length<2)return;
    }else drawn++;
    legs.push({pts,walk:l.mode==='foot',color:modeOf(l.mode).c});coords.push(...pts);
  });
  p.schematic=rides.length>0&&!drawn;
  const seen=new Set();
  const addStop=(q,name,time,color,kind,minor)=>{
    const lat=+q?.latitude,lon=+q?.longitude;if(!lat||!lon)return;
    const k=lat.toFixed(5)+lon.toFixed(5);if(seen.has(k))return;seen.add(k);
    stops.push({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{name,time:time||'',color,kind,minor}});
  };
  rides.forEach((l,i)=>{
    const c=modeOf(l.mode).c;
    addStop(l.fromPlace?.quay,l.fromPlace?.name,l.expectedStartTime,c,i?'Bytte':'Påstigning',false);
    (l.intermediateEstimatedCalls||[]).forEach(s=>addStop(s.quay,s.quay?.name,s.expectedArrivalTime,c,'Stopp underveis',true));
    addStop(l.toPlace?.quay,l.toPlace?.name,l.expectedEndTime,c,i<rides.length-1?'Bytte':'Avstigning',false);
    if(i<rides.length-1){const q=l.toPlace?.quay;if(+q?.latitude)addPin(+q.latitude,+q.longitude,`<div class="xfer" style="--c:${c}">${i+1}</div>`);}
  });
  const start=state.fromSel?[state.fromSel.lat,state.fromSel.lon]:state.pos;
  if(state.fromSel)addPin(state.fromSel.lat,state.fromSel.lon,'<div class="pin from">A</div>');
  if(state.dest)addPin(state.dest.lat,state.dest.lon,'<div class="pin to">B</div>');
  if(start)coords.push([start[1],start[0]]);
  if(state.dest)coords.push([state.dest.lon,state.dest.lat]);
  if(coords.length>=2){
    const b=new maplibregl.LngLatBounds(coords[0],coords[0]);coords.forEach(c=>b.extend(c));routeBounds=b;fitRoute();
  }
  setData('route-stops',fc(stops));
  // Tegn linjene inn fra start til mål, etappe for etappe.
  const lens=legs.map(l=>{let s=0;const cum=[0];for(let i=1;i<l.pts.length;i++){s+=Math.hypot(l.pts[i][0]-l.pts[i-1][0],l.pts[i][1]-l.pts[i-1][1]);cum.push(s);}return{cum,total:s};});
  const total=lens.reduce((s,l)=>s+l.total,0)||1;
  const featuresAt=f=>{let left=f*total;const out=[];
    legs.forEach((l,i)=>{if(left<=0)return;const L=lens[i];let pts=l.pts;
      if(left<L.total){const j=L.cum.findIndex(c=>c>=left);const k=Math.max(1,j);const t=(left-L.cum[k-1])/((L.cum[k]-L.cum[k-1])||1);
        pts=[...l.pts.slice(0,k),[l.pts[k-1][0]+(l.pts[k][0]-l.pts[k-1][0])*t,l.pts[k-1][1]+(l.pts[k][1]-l.pts[k-1][1])*t]];}
      left-=L.total;out.push({type:'Feature',geometry:{type:'LineString',coordinates:pts},properties:{walk:l.walk,color:l.color}});});
    return fc(out);};
  if(reduceMotion.matches){setData('route',featuresAt(1));return;}
  const t0=performance.now(),dur=Math.min(1400,600+legs.length*150);
  const step=t=>{const k=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k,3);setData('route',featuresAt(e));if(k<1)routeAnim=requestAnimationFrame(step);};
  routeAnim=requestAnimationFrame(step);
}
function fitRoute(){
  if(!routeBounds||!mapLoaded)return;
  setFollow(false);
  map.setPadding(mapPadding()); // fitBounds legger sin egen polstring oppå kartets – hold den liten
  map.fitBounds(routeBounds,{padding:{top:28,bottom:28,left:28,right:28},maxZoom:16,duration:reduceMotion.matches?0:800});
}

/* ---------- Oppdatering ---------- */
function refreshAll(){
  if(state.pos)loadNearby(...state.pos);else if(state.nearbyAt)loadNearby(...state.nearbyAt);
  loadAlerts();
}
setInterval(()=>{
  if(document.hidden)return;
  const n=router.cur.name;
  if(n==='home')loadDeps();
  if(n==='stop'){const id=router.cur.params.id;loadStopDeps(id).then(()=>{if(router.cur.name==='stop'&&router.cur.params.id===id)router.refresh();});}
  refreshVehicles();
},REFRESH_MS);
setInterval(()=>{if(!document.hidden&&['home','stop','results'].includes(router.cur.name))router.refresh();},20000);
setInterval(()=>{if(!document.hidden)loadAlerts();},180000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){loadAlerts();loadDeps(true);refreshVehicles(true);}});

/* ---------- Velkomst og oppstart ---------- */
function hideOnboard(){
  try{localStorage.setItem('reisOnboarded','1');}catch(e){}
  const ob=$('#onboard');ob.classList.add('leaving');
  setTimeout(()=>{ob.hidden=true;ob.classList.remove('leaving');},reduceMotion.matches?0:420);
}
$('#obAllow').onclick=()=>{buzz(10);hideOnboard();startGeo();};
$('#obSkip').onclick=()=>{buzz(6);hideOnboard();loadNearby(OSLO[0],OSLO[1]);};
if(reduceMotion.matches)$('.network .train')?.remove();

paintTheme();
router.show('home',{},null);
const onboarded=(()=>{try{return!!localStorage.getItem('reisOnboarded');}catch(e){return true;}})();
if(onboarded)startGeo();else $('#onboard').hidden=false;
loadAlerts();
wide.addEventListener('change',()=>snapTo(sheetUI.snap,false));
const hideSplash=()=>$('#splash').classList.add('hide');
addEventListener('load',()=>setTimeout(hideSplash,reduceMotion.matches?0:850));
setTimeout(hideSplash,2500);
