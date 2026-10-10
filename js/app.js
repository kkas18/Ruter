'use strict';
/* =====================================================================
   REIS – sanntid og reisesøk for kollektiv i Oslo og omegn
   Én flate: kartet er hovedskjermen, og alt annet skjer i ett ark med
   en stabel sider (hjem → søk → forslag → reise, holdeplass, meldinger,
   innstillinger). Ingen faner, ingen dobbeltinnganger.
   Data: Entur Journey Planner v3, Geocoder v3, SIRI VM/SX.
   Kart: MapLibre GL med OpenFreeMap-vektorfliser i egen stil.
   ===================================================================== */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
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
let settings=Object.assign({theme:'auto',walkKmh:4.5,showVehicles:true,vibrate:true,basemap:'map'},loadJSON('reisSettings',{}));
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
  if(mapLoaded){ReisMapStyle.applyTheme(map,t,isSat());applyOverlayTheme();}
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
    realtime aimedDepartureTime expectedDepartureTime forBoarding occupancyStatus
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
      ${level<=1?'id realtime serviceJourney{id} fromEstimatedCall{occupancyStatus destinationDisplay{frontText}}':''}
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

const isSat=()=>settings.basemap==='sat';
function overlayColors(){
  const dark=resolveTheme()==='dark',p=ReisMapStyle.palette(resolveTheme());
  // Over flybilder trengs hvit kontur og hvit tekst med mørk kant, uansett tema.
  if(isSat())return{case:'#FFFFFF',stopFill:'#FFFFFF',stopRing:'#14191C',label:'#FFFFFF',halo:'rgba(0,0,0,0.8)',walk:'#FFFFFF',me:'#5B8DF5'};
  return{case:dark?'#0F1316':'#FFFFFF',stopFill:dark?'#EEECE6':'#FFFFFF',stopRing:dark?'#0F1316':'#14191C',
    label:dark?'#D3D7D9':'#2D3438',halo:p.halo,walk:dark?'#B3BABE':'#465055',me:dark?'#5B8DF5':'#2F6FEB'};
}
function applyOverlayTheme(){
  const c=overlayColors();
  const set=(l,p,v)=>map.getLayer(l)&&map.setPaintProperty(l,p,v);
  set('route-case','line-color',c.case);set('route-walk','line-color',c.walk);
  set('route-stop','circle-color',c.case);set('route-stop-minor','circle-color',c.case);
  ['stops-label','stops-label-major'].forEach(l=>{set(l,'text-color',c.label);set(l,'text-halo-color',c.halo);});
  set('acc','fill-color',c.me);set('acc-line','line-color',c.me);
  set('route-stop-label','text-color',c.label);set('route-stop-label','text-halo-color',c.halo);
  renderStopsLayer(); // avgangskortene har egne farger for lys, mørk og satellitt
}
// Én knapp på kartet veksler mellom kart og satellitt (hybrid med navn oppå).
function setBasemap(mode){
  settings.basemap=mode;saveSettings();
  $('#layerBtn').setAttribute('aria-pressed',String(mode==='sat'));
  $('#layerBtn').setAttribute('aria-label',mode==='sat'?'Vis kart':'Vis satellitt');
  document.body.classList.toggle('sat',mode==='sat');
  if(mapLoaded){ReisMapStyle.applyTheme(map,resolveTheme(),mode==='sat');applyOverlayTheme();}
}
$('#layerBtn').onclick=()=>{buzz(8);setBasemap(isSat()?'map':'sat');toast(isSat()?'Satellitt':'Kart');};
// Kjøretøymerke med linjenummeret tegnet inn i bildet, så merker som overlapper legger
// seg pent oppå hverandre (tekst i eget lag ville blandet tallene). Lages ved behov per
// transportmiddel + linje; GPS-kjøretøy får en grønn live-prikk.
function badgeImage(mode,line,gps){
  const color=modeOf(mode).c,label=line||'•',font='800 30px "Schibsted Grotesk", system-ui, sans-serif';
  const m=document.createElement('canvas').getContext('2d');m.font=font;
  const H=60,W=Math.max(60,Math.ceil(m.measureText(label).width)+34)+(gps?10:0);
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;const g=cv.getContext('2d');
  const top=gps?8:4,bw=W-(gps?12:8);
  g.beginPath();g.roundRect(4,top,bw,H-top-4,(H-top-4)/2);g.fillStyle=color;g.fill();g.lineWidth=5;g.strokeStyle='#fff';g.stroke();
  g.font=font;g.fillStyle='#fff';g.textAlign='center';g.textBaseline='middle';g.fillText(label,4+bw/2,top+(H-top-4)/2+1);
  if(gps){g.beginPath();g.arc(W-11,11,8,0,Math.PI*2);g.fillStyle='#2FD07A';g.fill();g.lineWidth=3.5;g.strokeStyle='#fff';g.stroke();}
  return g.getImageData(0,0,W,H);
}
map.on('styleimagemissing',e=>{
  const m=/^vb\|(\w+)\|(.*)\|([01])$/.exec(e.id);if(!m||map.hasImage(e.id))return;
  map.addImage(e.id,badgeImage(m[1],m[2],m[3]==='1'),{pixelRatio:2});
});
// Retningspil som roterer rundt merket.
function headingImage(color){
  const S=112,cv=document.createElement('canvas');cv.width=cv.height=S;const g=cv.getContext('2d');
  g.translate(S/2,0);g.beginPath();g.moveTo(0,4);g.lineTo(13,22);g.lineTo(-13,22);g.closePath();
  g.lineJoin='round';g.lineWidth=5;g.strokeStyle='#fff';g.stroke();g.fillStyle=color;g.fill();
  return g.getImageData(0,0,S,S);
}
function vehicleImage(color,est=false){
  const s=56,cv=document.createElement('canvas');cv.width=cv.height=s;const g=cv.getContext('2d');
  g.translate(s/2,s/2);
  if(est){g.beginPath();g.arc(0,0,25,0,Math.PI*2);g.setLineDash([5,4]);g.lineWidth=2.5;g.strokeStyle=color;g.stroke();g.setLineDash([]);}
  g.beginPath();g.moveTo(0,-21);g.lineTo(17,19);g.lineTo(0,10);g.lineTo(-17,19);g.closePath();
  g.lineJoin='round';g.lineWidth=6;g.strokeStyle='#fff';g.stroke();g.fillStyle=color;g.fill();
  return g.getImageData(0,0,s,s);
}
map.on('load',()=>{
  mapLoaded=true;
  const c=overlayColors();
  Object.entries({...MODES,other:{c:'#5D676C'}}).forEach(([k,m])=>{map.addImage('veh-'+k,vehicleImage(m.c),{pixelRatio:2});
    map.addImage('veh-est-'+k,vehicleImage(m.c,true),{pixelRatio:2});
    map.addImage('dir-'+k,headingImage(m.c),{pixelRatio:2});});
  ['acc','route','route-stops','stops','vehicles','approach'].forEach(id=>map.addSource(id,{type:'geojson',data:EMPTY}));
  map.addLayer({id:'acc',type:'fill',source:'acc',paint:{'fill-color':c.me,'fill-opacity':.08}});
  map.addLayer({id:'acc-line',type:'line',source:'acc',paint:{'line-color':c.me,'line-opacity':.3,'line-width':1}});
  // Holdeplasser: stasjoner (tog, T-bane, trikk, båt) er større og får navn først;
  // bussholdeplasser får navn når du zoomer inn. Navn som kolliderer sorteres bort.
  // Holdeplasser: zoomet ut som små prikker i transportmiddelets farge, nærmere som
  // piktogram (buss, trikk, T-bane, tog, båt) – gjenkjennelig på et øyeblikk.
  ['bus','tram','metro','rail','water'].forEach(m=>{map.addImage('stop-'+m,stopIcon(m,false),{pixelRatio:2});map.addImage('stop-'+m+'-fav',stopIcon(m,true),{pixelRatio:2});});
  map.addLayer({id:'stops',type:'circle',source:'stops',minzoom:12,maxzoom:STOP_ICON_ZOOM,paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],12,['case',['get','major'],3.5,2.2],STOP_ICON_ZOOM,['case',['get','major'],6,4.5]],
    'circle-color':['get','color'],'circle-stroke-color':'#FFFFFF','circle-stroke-width':['interpolate',['linear'],['zoom'],12,1,14,1.8],
    'circle-opacity':['interpolate',['linear'],['zoom'],12,0,12.5,1],'circle-stroke-opacity':['interpolate',['linear'],['zoom'],12,0,12.5,1]}});
  map.addLayer({id:'stop-icons',type:'symbol',source:'stops',minzoom:STOP_ICON_ZOOM,layout:{
    'icon-image':['concat','stop-',['get','icon'],['case',['get','fav'],'-fav','']],
    'icon-size':['interpolate',['linear'],['zoom'],STOP_ICON_ZOOM,['case',['get','major'],.8,.7],16,['case',['get','major'],1.05,.95],18,['case',['get','major'],1.3,1.2]],
    'icon-allow-overlap':true,'icon-ignore-placement':true,'symbol-sort-key':['get','rank']},
    paint:{'icon-opacity':['interpolate',['linear'],['zoom'],STOP_ICON_ZOOM,0,STOP_ICON_ZOOM+.25,1]}});
  map.addLayer({id:'stop-sel',type:'circle',source:'stops',filter:['==',['get','id'],''],paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],12,9,16,13],'circle-color':'rgba(255,200,0,0.25)',
    'circle-stroke-color':'#FFC800','circle-stroke-width':3.5}},'stops');
  const stopLabel=(id,minzoom,filter,size)=>map.addLayer({id,type:'symbol',source:'stops',minzoom,filter,layout:{
    'text-field':['get','name'],'text-font':['Noto Sans Bold'],'text-size':size,
    'text-variable-anchor':['top','bottom','right','left'],'text-radial-offset':['interpolate',['linear'],['zoom'],12,.85,STOP_ICON_ZOOM,1.6,17,1.9],'text-justify':'auto',
    'text-max-width':9,'text-optional':true,'symbol-sort-key':['get','rank'],'text-padding':3},
    paint:{'text-color':c.label,'text-halo-color':c.halo,'text-halo-width':1.6,
      'text-opacity':['interpolate',['linear'],['zoom'],minzoom,0,minzoom+.4,1]}});
  // Holdeplasser med avgangskort (fra gatenivå) viser navnet i kortet i stedet for som lapp.
  stopLabel('stops-label-major',12,['all',['==',['get','major'],true],['!',['has','card']]],['interpolate',['linear'],['zoom'],12,11,15,12.5,18,14]);
  stopLabel('stops-label',13.6,['all',['!=',['get','major'],true],['!',['has','card']]],['interpolate',['linear'],['zoom'],13.6,10.5,16,12,18,13]);
  // Bussens vei fram til holdeplassen din: stiplet i linjefargen, med stoppene den har igjen.
  map.addLayer({id:'approach-line',type:'line',source:'approach',filter:['==',['geometry-type'],'LineString'],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['interpolate',['linear'],['zoom'],10,2.5,16,5],
    'line-opacity':.75,'line-dasharray':[1.2,1.6]}});
  map.addLayer({id:'approach-stops',type:'circle',source:'approach',filter:['==',['geometry-type'],'Point'],paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],10,2,15,4],'circle-color':c.case,'circle-stroke-color':['get','color'],'circle-stroke-width':2,'circle-opacity':.9}});
  map.addLayer({id:'route-case',type:'line',source:'route',filter:['!',['get','walk']],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':c.case,'line-width':['interpolate',['linear'],['zoom'],10,6,16,12]}});
  map.addLayer({id:'route-line',type:'line',source:'route',filter:['!',['get','walk']],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['interpolate',['linear'],['zoom'],10,3.5,16,7]}});
  map.addLayer({id:'route-walk',type:'line',source:'route',filter:['get','walk'],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':c.walk,'line-width':['interpolate',['linear'],['zoom'],10,2.5,16,4.5],'line-dasharray':[0,1.8]}});
  // Alle holdeplasser langs valgt rute: små prikker for stopp underveis, store for på/av og bytte.
  map.addLayer({id:'route-stop-minor',type:'circle',source:'route-stops',filter:['get','minor'],paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],10,2,14,3.6,17,5],'circle-color':c.case,'circle-stroke-color':['get','color'],
    'circle-stroke-width':['interpolate',['linear'],['zoom'],10,1.5,15,2.5]}});
  map.addLayer({id:'route-stop',type:'circle',source:'route-stops',filter:['!',['get','minor']],paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],10,4.5,15,7],'circle-color':c.case,'circle-stroke-color':['get','color'],'circle-stroke-width':3.5}});
  map.addLayer({id:'route-stop-label',type:'symbol',source:'route-stops',
    filter:['any',['!',['get','minor']],['>=',['zoom'],13.5]],layout:{
    'text-field':['format',['get','name'],{'font-scale':1},['case',['!=',['get','clock'],''],['concat','  ',['get','clock']],''],{'font-scale':.92,'text-font':['literal',['Noto Sans Regular']]}],
    'text-font':['Noto Sans Bold'],'text-size':['case',['get','minor'],11,12.5],'text-anchor':'left','text-offset':[.9,0],
    'text-max-width':14,'text-optional':true,'symbol-sort-key':['case',['get','minor'],2,1]},
    paint:{'text-color':c.label,'text-halo-color':c.halo,'text-halo-width':1.6}});
  // Kjøretøy: retningspil under, farget merke med linjenummer over. Vokser når du zoomer inn.
  const vehScale=['interpolate',['linear'],['zoom'],11.5,.75,14,.95,17,1.2];
  map.addLayer({id:'vehicles-dir',type:'symbol',source:'vehicles',minzoom:11.5,layout:{
    'icon-image':['concat','dir-',['get','mode']],'icon-rotate':['get','bearing'],'icon-rotation-alignment':'map',
    'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-size':vehScale}});
  map.addLayer({id:'vehicles',type:'symbol',source:'vehicles',minzoom:11.5,layout:{
    'icon-image':['concat','vb|',['get','mode'],'|',['get','line'],'|',['case',['==',['get','est'],true],'0','1']],
    'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-rotation-alignment':'viewport','icon-size':vehScale,
    'symbol-sort-key':['case',['==',['get','est'],true],1,0]}});

  // Trykk nær en holdeplass – eller på navnet – åpner avgangstavlen. Fingre bommer,
  // så vi leter i en firkant rundt trykket og velger nærmeste holdeplass.
  map.on('click',e=>{
    if(router.cur.name==='results'||router.cur.name==='trip')return;
    const {x,y}=e.point;
    const card=map.queryRenderedFeatures([x,y],{layers:['stop-cards']})[0];
    if(card){buzz(6);
      // Traff du én bestemt avgang i kortet, vis den turen; ellers holdeplassen.
      const spec=cardSpecs.get(card.properties.card),pt=map.project(card.geometry.coordinates);
      const rel=x-(pt.x-(spec?.w||0)/2),hit=spec?.hits?.find(h=>rel>=h.x0&&rel<=h.x1&&h.sj);
      if(hit)router.go('journey',{sj:hit.sj,stop:card.properties.id});
      else router.go('stop',{id:card.properties.id,snap:'peek'});
      return;}
    const hits=map.queryRenderedFeatures([[x-18,y-18],[x+18,y+18]],{layers:['stops','stop-icons','stops-label-major','stops-label']});
    const best=hits.map(f=>{const pt=map.project(f.geometry.coordinates);return{f,d:Math.hypot(pt.x-x,pt.y-y)-(f.layer.id==='stops'||f.layer.id==='stop-icons'?0:4)};})
      .sort((a,b)=>a.d-b.d)[0];
    // Nær en holdeplass vinner den, selv om et kjøretøy står oppå (vanlig ved travle stopp).
    const veh=map.queryRenderedFeatures([[x-4,y-4],[x+4,y+4]],{layers:['vehicles','vehicles-dir']})[0];
    if(best&&(best.d<=12||!veh)){buzz(6);router.go('stop',{id:best.f.properties.id,snap:'peek'});return;}
    if(veh)vehClick({features:[veh]});
    else if(fc$.target?.key?.startsWith('veh:'))fcClose();
  });
  const vehClick=e=>{const p=e.features[0]?.properties||{};buzz(6);
    if(p.sj)router.go('journey',{sj:p.sj});else showVehicleCard(p);}; // med kjent tur: vis hele ruten

  map.on('click','route-stop-minor',e=>{const p=e.features[0]?.properties;if(!p)return;
    new maplibregl.Popup({offset:8,closeButton:false}).setLngLat(e.lngLat)
      .setHTML(`<b>${esc(p.name)}</b><br><span style="color:var(--ink-3)">${esc(p.kind)}${p.time?' · kl. '+fmtT(p.time):''}</span>`).addTo(map);});
  map.on('click','route-stop',e=>{const p=e.features[0]?.properties;if(!p)return;
    new maplibregl.Popup({offset:10,closeButton:false}).setLngLat(e.lngLat)
      .setHTML(`<b>${esc(p.name)}</b><br><span style="color:var(--ink-3)">${esc(p.kind)}${p.time?' · kl. '+fmtT(p.time):''}</span>`).addTo(map);});
  ['stops','stop-icons','stops-label','stops-label-major','stop-cards','vehicles','vehicles-dir','route-stop'].forEach(l=>{
    map.on('mouseenter',l,()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave',l,()=>map.getCanvas().style.cursor='');});

  map.addLayer({id:'stop-cards',type:'symbol',source:'stops',minzoom:CARD_ZOOM,filter:['all',['has','card'],['!=',['get','id'],'']],layout:{
    'icon-image':['get','card'],'icon-anchor':'bottom','icon-offset':[0,-14],'icon-padding':4,'symbol-sort-key':['get','rank'],
    'icon-allow-overlap':false},paint:{'icon-opacity':['interpolate',['linear'],['zoom'],CARD_ZOOM,0,CARD_ZOOM+.3,1]}});
  map.moveLayer('stop-sel'); // valgt holdeplass øverst, også over kjøretøy
  setBasemap(settings.basemap);paintTheme();renderStopsLayer();renderAcc();map.setPadding(mapPadding());
  // Kildehenvisningen starter sammenslått som en ⓘ-knapp.
  $('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  $('.maplibregl-ctrl-attrib')?.removeAttribute('open');
  if(router.cur.name==='results'||router.cur.name==='trip')drawRoute(state.trips[state.tripIdx]);
});
map.on('error',e=>{const msg=e?.error?.message||'';
  if(/Failed to fetch|NetworkError/i.test(msg))setNetworkState(false,'Kartet laster ikke');else console.warn('Kart:',msg);});

// Følg-modus og kompass
function setFollow(on){state.follow=on;$('#locateBtn').setAttribute('aria-pressed',String(on));}
map.on('dragstart',()=>{if(state.follow)setFollow(false);if(live.followVeh){live.followVeh=false;updateLiveBox();}});
map.on('rotate',()=>{const b=map.getBearing();$('#compassBtn').hidden=Math.abs(b)<1;
  $('#compassIcon').style.transform=`rotate(${-b}deg)`;});
$('#compassBtn').onclick=()=>{buzz(6);map.easeTo({bearing:0,duration:reduceMotion.matches?0:400});};
$('#locateBtn').onclick=()=>{buzz(8);startCompass();
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
/* ---------- Holdeplassikoner ----------
   Avrundet kvadrat i transportmiddelets farge med hvitt piktogram, tegnet i
   24-enhets rutenett (samme som appens ikoner). Favoritter får en gul stjerne. */
const STOP_ICON_ZOOM=14;
function stopIcon(mode,fav){
  const S=64,cv=document.createElement('canvas');cv.width=cv.height=S;const g=cv.getContext('2d');
  g.shadowColor='rgba(0,0,0,.28)';g.shadowBlur=5;g.shadowOffsetY=1.5;
  g.beginPath();g.roundRect(8,6,48,48,13);g.fillStyle='#fff';g.fill();g.shadowColor='transparent';
  g.beginPath();g.roundRect(11,9,42,42,10.5);g.fillStyle=modeOf(mode).c;g.fill();
  // piktogram i 24-rutenett, sentrert i den fargede flaten
  g.save();g.translate(14,12);g.scale(1.5,1.5);g.fillStyle='#fff';g.strokeStyle='#fff';g.lineCap='round';g.lineJoin='round';
  const C=modeOf(mode).c,rr=(x,y,w,h,r,fill)=>{g.beginPath();g.roundRect(x,y,w,h,r);g.fillStyle=fill;g.fill();};
  const dot=(x,y,r,fill)=>{g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fillStyle=fill;g.fill();};
  if(mode==='bus'){rr(4.5,3.5,15,15,3,'#fff');rr(6.5,5.5,11,5.2,1.2,C);dot(7.8,14.6,1.1,C);dot(16.2,14.6,1.1,C);rr(6,18,3.2,2.6,1,'#fff');rr(14.8,18,3.2,2.6,1,'#fff');}
  else if(mode==='tram'){g.lineWidth=1.6;g.beginPath();g.moveTo(8.5,2.8);g.lineTo(15.5,2.8);g.moveTo(12,2.8);g.lineTo(12,5.5);g.stroke();
    rr(5.5,5.5,13,13,3.2,'#fff');rr(7.5,7.5,9,4.6,1.2,C);dot(9.2,15.2,1.1,C);dot(14.8,15.2,1.1,C);
    g.lineWidth=1.6;g.beginPath();g.moveTo(8,18.5);g.lineTo(6.5,21);g.moveTo(16,18.5);g.lineTo(17.5,21);g.stroke();}
  else if(mode==='metro'){g.beginPath();g.arc(12,12,9,0,Math.PI*2);g.fillStyle='#fff';g.fill();
    g.fillStyle=C;g.font='900 13px "Schibsted Grotesk", system-ui, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('T',12,12.8);}
  else if(mode==='rail'){rr(5.5,3,13,15,4,'#fff');rr(7.5,5.2,9,4.4,1.2,C);dot(9,14,1.1,C);dot(15,14,1.1,C);
    g.lineWidth=1.6;g.beginPath();g.moveTo(8.5,18);g.lineTo(6,21.5);g.moveTo(15.5,18);g.lineTo(18,21.5);g.moveTo(7.2,20.2);g.lineTo(16.8,20.2);g.stroke();}
  else{g.beginPath();g.moveTo(3.5,14);g.lineTo(20.5,14);g.lineTo(17.5,19);g.lineTo(6.5,19);g.closePath();g.fill();
    rr(8,8.5,8,5,1.2,'#fff');rr(11,5,2,4,.6,'#fff');g.lineWidth=1.4;g.beginPath();g.moveTo(4,21.5);g.quadraticCurveTo(6,20.3,8,21.5);g.quadraticCurveTo(10,22.7,12,21.5);g.quadraticCurveTo(14,20.3,16,21.5);g.quadraticCurveTo(18,22.7,20,21.5);g.stroke();}
  g.restore();
  if(fav){ // gul stjerne i hjørnet
    g.save();g.translate(52,10);g.beginPath();for(let i=0;i<10;i++){const r=i%2?4.2:9.5,a=-Math.PI/2+i*Math.PI/5;g.lineTo(Math.cos(a)*r,Math.sin(a)*r);}g.closePath();
    g.fillStyle='#FFC800';g.fill();g.lineWidth=2;g.strokeStyle='#14191C';g.stroke();g.restore();
  }
  return g.getImageData(0,0,S,S);
}

/* ---------- Avgangskort på kartet ----------
   Fra gatenivå får hver holdeplass et lite kort med navn og de tre neste
   avgangene. Avgangene for hele utsnittet hentes i én forespørsel. Kortene
   tegnes som bilder i et symbollag, så kartet selv rydder bort kort som ville
   overlappet (stasjoner og favoritter først). Nøkkelen inneholder innholdet,
   så et kort tegnes på nytt bare når minuttene endrer seg. */
const CARD_ZOOM=15.3;
const cardSpecs=new Map();
function cardKey(s){
  if(!mapLoaded||map.getZoom()<CARD_ZOOM)return null;
  const entry=state.deps.get(s.id);if(!entry)return null;
  const items=upcoming(s.id).slice(0,3).map(r=>{const m=minUntil(r.exp);return{pub:r.pub,mode:r.mode,t:m<=0?'nå':m<60?String(m):fmtT(r.exp),rt:r.rt,now:m<=0,sj:r.sj};});
  if(!items.length)return null; // uten avganger: bare prikk og navn
  const theme=isSat()?'sat':resolveTheme();
  const key=`sc|${theme}|${s.id}|${items.map(i=>i.pub+':'+i.t+(i.rt?'*':'')).join(',')}`;
  if(!cardSpecs.has(key))cardSpecs.set(key,{id:s.id,name:s.name,items,theme});
  return key;
}
function cardImage(spec){
  const dark=spec.theme==='dark',X=2,font=(w,px)=>`${w} ${px*X}px "Schibsted Grotesk", system-ui, sans-serif`;
  const col=dark?{bg:'#171C20',line:'rgba(255,255,255,.10)',name:'#8D969B',text:'#EEECE6',sub:'#8D969B'}:
    {bg:'#FFFFFF',line:'rgba(20,25,28,.10)',name:'#687175',text:'#14191C',sub:'#687175'};
  const m=document.createElement('canvas').getContext('2d');
  const PAD=8*X,GAP=8*X,BH=18*X,M=6*X,TIP=6*X;
  // mål opp innholdet
  m.font=font(700,11);let name=spec.name;const maxName=170*X;
  while(m.measureText(name).width>maxName&&name.length>3)name=name.slice(0,-2);
  if(name!==spec.name)name=name.trimEnd()+'…';
  const nameW=m.measureText(name).width;
  const chips=spec.items.map(i=>{m.font=font(800,11.5);const bw=Math.max(24*X,m.measureText(i.pub).width+10*X);
    m.font=font(750,12.5);let tw=m.measureText(i.t).width+(i.now?10*X:0)+(i.rt?9*X:0);
    const unit=!i.now&&/^\d+$/.test(i.t);let uw=0;if(unit){m.font=font(600,9.5);uw=m.measureText('min').width+2*X;}
    return{...i,bw,tw,uw,unit,w:bw+5*X+tw+uw};});
  const chipsW=chips.length?chips.reduce((a,c)=>a+c.w,0)+GAP*(chips.length-1):(m.font=font(500,11),m.measureText('Ingen avganger').width);
  const W=Math.ceil(Math.max(nameW,chipsW)+PAD*2),H=PAD+13*X+5*X+BH+PAD;
  const cv=document.createElement('canvas');cv.width=W+M*2;cv.height=H+TIP+M*2;const g=cv.getContext('2d');
  // kort med pil ned mot holdeplassen
  g.shadowColor='rgba(0,0,0,.18)';g.shadowBlur=6*X;g.shadowOffsetY=1*X;
  g.beginPath();g.roundRect(M,M,W,H,10*X);g.moveTo(M+W/2-TIP,M+H);g.lineTo(M+W/2,M+H+TIP);g.lineTo(M+W/2+TIP,M+H);g.closePath();
  g.fillStyle=col.bg;g.fill();g.shadowColor='transparent';g.lineWidth=1*X;g.strokeStyle=col.line;g.stroke();
  g.textBaseline='middle';
  g.font=font(700,11);g.fillStyle=col.name;g.fillText(name,M+PAD,M+PAD+6.5*X);
  let x=M+PAD;const cy=M+PAD+13*X+5*X+BH/2;
  if(!chips.length){g.font=font(500,11);g.fillStyle=col.sub;g.fillText('Ingen avganger',x,cy);}
  spec.w=cv.width/X;spec.hits=[]; // for trykk: hvor hver avgang ligger i bildet (CSS-px fra venstre kant)
  chips.forEach(c=>{const x0=x;
    g.beginPath();g.roundRect(x,cy-BH/2,c.bw,BH,5*X);g.fillStyle=modeOf(c.mode).c;g.fill();
    g.font=font(800,11.5);g.fillStyle='#fff';g.textAlign='center';g.fillText(c.pub,x+c.bw/2,cy+.5*X);g.textAlign='left';
    x+=c.bw+5*X;
    // Sanntid: grønn prikk foran tiden, som i resten av appen.
    if(c.rt){g.beginPath();g.arc(x+3*X,cy,3*X,0,Math.PI*2);g.fillStyle=dark?'#4FC48C':'#1C7F52';g.fill();x+=9*X;}
    const tw=c.tw-(c.rt?9*X:0);
    if(c.now){g.beginPath();g.roundRect(x,cy-8*X,tw,16*X,4*X);g.fillStyle='#FFC800';g.fill();
      g.font=font(800,11);g.fillStyle='#14191C';g.fillText(c.t,x+5*X,cy+.5*X);}
    else{g.font=font(750,12.5);g.fillStyle=col.text;g.fillText(c.t,x,cy+.5*X);
      if(c.unit){g.font=font(600,9.5);g.fillStyle=col.sub;g.fillText('min',x+tw+2*X,cy+1.5*X);}}
    x+=tw+c.uw+GAP;
    spec.hits.push({x0:(x0-GAP/2)/X,x1:(x-GAP/2)/X,sj:c.sj,stop:spec.id});
  });
  return g.getImageData(0,0,cv.width,cv.height);
}
map.on('styleimagemissing',e=>{
  if(!e.id.startsWith('sc|')||map.hasImage(e.id))return;
  const spec=cardSpecs.get(e.id);
  // Et kort som nettopp er ryddet bort kan etterspørres ett bilde til: gi et tomt bilde i stedet for en advarsel.
  if(spec)map.addImage(e.id,cardImage(spec),{pixelRatio:2});else{map.addImage(e.id,{width:1,height:1,data:new Uint8Array(4)});cardSpecs.set(e.id,null);}
});
// Fjern kortbilder som ikke lenger er i bruk, så minnet ikke vokser.
function pruneCards(used){
  for(const k of cardSpecs.keys())if(!used.has(k)){cardSpecs.delete(k);if(mapLoaded&&map.hasImage(k))map.removeImage(k);}
}
let cardMode=false;
map.on('zoom',()=>{const on=map.getZoom()>=CARD_ZOOM;if(on!==cardMode){cardMode=on;renderStopsLayer();}});
let viewDepsBusy=false,viewDepsAt=0;
async function loadViewDeps(force=false){
  if(!mapLoaded||map.getZoom()<CARD_ZOOM-0.5||!['home','stop'].includes(router.cur.name))return;
  if(viewDepsBusy||(!force&&Date.now()-viewDepsAt<25000))return;
  viewDepsBusy=true;viewDepsAt=Date.now();
  try{
    const b=map.getBounds();
    const d=await gql(`{stopPlacesByBbox(minimumLatitude:${b.getSouth()},minimumLongitude:${b.getWest()},maximumLatitude:${b.getNorth()},maximumLongitude:${b.getEast()}){
      id name latitude longitude transportMode estimatedCalls(numberOfDepartures:5,timeRange:5400){realtime aimedDepartureTime expectedDepartureTime forBoarding
      destinationDisplay{frontText} quay{publicCode} serviceJourney{id journeyPattern{line{publicCode transportMode}}}}}}`);
    const now=Date.now();
    (d.stopPlacesByBbox||[]).forEach(sp=>{
      if(!state.viewStops.has(sp.id)&&Number.isFinite(sp.latitude))
        state.viewStops.set(sp.id,{id:sp.id,name:sp.name,lat:sp.latitude,lon:sp.longitude,modes:sp.transportMode||[]});
      const old=state.deps.get(sp.id);
      // Ikke overskriv en fyldigere tavle som nettopp er hentet for holdeplassen.
      if(!old||now-old.t>20000||(old.rows||[]).length<=5)state.deps.set(sp.id,{rows:parseCalls(sp.estimatedCalls),t:now});
    });
    renderStopsLayer();
  }catch(e){}finally{viewDepsBusy=false;}
}

// Rangering for navn på kartet: favoritter, så tog, T-bane, trikk/båt, så buss.
function stopProps(s){
  const fav=favs.some(f=>f.id===s.id),m=s.modes||[];
  const rank=fav?0:m.includes('rail')?1:m.includes('metro')?2:(m.includes('tram')||m.includes('water'))?3:4;
  const icon=m.includes('rail')?'rail':m.includes('metro')?'metro':m.includes('tram')?'tram':m.includes('water')?'water':'bus';
  const p={id:s.id,name:s.name,fav,rank,major:rank<4,icon,color:modeOf(icon).c};
  const card=cardKey(s);if(card)p.card=card;
  return p;
}
function renderStopsLayer(){
  const all=new Map();
  for(const s of state.viewStops.values())all.set(s.id,s);
  for(const s of [...state.nearby,...favs])all.set(s.id,{...s,modes:s.modes||all.get(s.id)?.modes}); // behold transportmiddel fra utsnittet
  const show=!['results','trip','journey'].includes(router.cur.name);
  const feats=show?[...all.values()].map(s=>({type:'Feature',geometry:{type:'Point',coordinates:[+s.lon,+s.lat]},properties:stopProps(s)})):[];
  setData('stops',fc(feats));
  pruneCards(new Set(feats.map(f=>f.properties.card).filter(Boolean)));
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
  const prev=sheetUI.snap;sheetUI.snap=name;setVisible(snapPx(name),animate);
  if(prev!==name)sheetUI.onSnap?.(name);
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
    renderStopsLayer();renderVehicleLayer();
    if(name==='home'||name==='stop')setTimeout(()=>{refreshVehicles(true);loadEstVehicles(true);loadViewDeps();},300);
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
sheetUI.onSnap=()=>{if(router.cur.name==='stop')updateStopCallout(router.cur.params.id);};
addEventListener('popstate',()=>{
  if(router.skipPop){router.skipPop--;return;}
  const prev=router.stack.pop();if(!prev)return;
  router.show(prev.name,prev.params,'back',true);snapTo(prev.snap||'half');
});
addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.target.closest?.('input'))router.back();});
const backBtn='<button class="icon-btn back press" type="button" aria-label="Tilbake">'+ico('back')+'</button>';

/* ---------- Visuelle byggesteiner ----------
   Appen skal vise heller enn å forklare: én ring for «hvor lenge», ett merke for
   «avvik», tre figurer for «hvor fullt». Teksten ligger i aria-label og title. */
// Nedtellingsring: tallet i midten, ringen tømmes mot null og skifter farge når det haster.
// Et lite ord under ringen sier hva tallet betyr («gå om», «går om», «gå av om»).
// urg: minuttene som bestemmer fargen, når det ikke er selve tallet (f.eks. avgang minus gangtid).
function ringState(min,win,clock,urg=min){
  const m=Math.max(0,Math.round(min)),u=Math.round(urg),big=m>=100&&clock;
  return{cls:u<=1?'go':u<=5?'soon':'',f:Math.min(1,m/win),txt:m<=0?'nå':big?clock:String(m),unit:m>0&&!big?'min':'',clock:!!big,
    label:m<=0?'nå':big?`kl. ${clock}`:`${m} min`};
}
// «gå om» + «nå» leses «gå nå»: ved null faller «om» bort.
const ringWord=(lab,m)=>!lab?'':Math.round(m)<=0?lab.replace(/ om$/,''):lab;
function ringHtml(min,{win=30,size=44,aria='',clock=null,urg=min}={}){
  const r=ringState(min,win,clock,urg);
  return`<span class="ring-w"><span class="ring ${r.cls}${r.clock?' clock':''}" style="--s:${size}px;--f:${r.f}" data-win="${win}" data-aria="${esc(aria)}" role="img" aria-label="${esc(`${aria} ${r.label}`.trim())}">
    <svg viewBox="0 0 44 44" aria-hidden="true"><circle class="trk" cx="22" cy="22" r="19"/><circle class="val" cx="22" cy="22" r="19" pathLength="100"/></svg>
    <b>${r.txt}</b><small>${r.unit}</small></span><em class="ring-lab" aria-hidden="true">${esc(ringWord(aria.toLowerCase(),min))}</em></span>`;
}
// Oppdater en ring på stedet, så fyll, farge og tall glir over i stedet for å blinke.
function setRing(el,min,clock=null,urg=min){
  if(!el)return;
  const w=el.closest('.ring-w');el=el.classList.contains('ring')?el:el.querySelector('.ring');
  const r=ringState(min,+el.dataset.win||30,clock,urg),b=el.querySelector('b');
  el.className=`ring ${r.cls}${r.clock?' clock':''}`;el.style.setProperty('--f',String(r.f));
  if(b.textContent!==r.txt){b.textContent=r.txt;b.classList.remove('tick');void b.offsetWidth;b.classList.add('tick');}
  el.querySelector('small').textContent=r.unit;
  el.setAttribute('aria-label',`${el.dataset.aria||''} ${r.label}`.trim());
  const lab=w?.querySelector('.ring-lab');if(lab)lab.textContent=ringWord((el.dataset.aria||'').toLowerCase(),min);
}
// Linjer med trafikkmelding får et lite varselmerke på linjeskiltet.
function alertFor(code){return state.alerts.find(a=>(a.lines||[]).includes(String(code)));}
function lineBadge(code,mode,cls='',withAlert=true){
  const md=modeOf(mode),a=withAlert&&alertFor(code);
  return`<span class="badge ${cls}${a?' has-alert':''}" style="--c:${md.c}" title="${md.n} ${esc(code)}${a?` – ${esc(a.summary)}`:''}">${esc(code)}</span>`;
}
// Belegg fra operatøren (Ruter deler det foreløpig ikke; da vises ingenting).
const OCC={empty:1,manySeatsAvailable:1,fewSeatsAvailable:2,standingRoomOnly:3,crushedStandingRoomOnly:3,full:3,notAcceptingPassengers:3};
const OCC_TXT=['','God plass','Få ledige seter','Fullt – ståplass'];
function occHtml(status){
  const n=OCC[status];if(!n)return'';
  return`<span class="occ o${n}" role="img" aria-label="${OCC_TXT[n]}" title="${OCC_TXT[n]}">${ico('person')}${ico('person')}${ico('person')}</span>`;
}

/* ---------- Avgangsrader ---------- */
const lastMinutes=new Map();
function whenHtml(key,r){
  const m=minUntil(r.exp),delay=fmtT(r.exp)===fmtT(r.aimed)?0:Math.round((r.exp-r.aimed)/60000);
  const prev=lastMinutes.get(key);lastMinutes.set(key,m);
  const tick=prev!=null&&prev!==m?' tick':'';
  const main=m<=0?'<span class="now">nå</span>':m<60?`<span class="n${tick}">${m}<small>min</small></span>`:`<span class="n${tick}">${fmtT(r.exp)}</span>`;
  let sub='';
  if(m<60)sub=`${r.rt?'<i class="live" title="Sanntid"></i>':''}${delay>0?`<s>${fmtT(r.aimed)}</s><span class="late">${fmtT(r.exp)}</span>`:fmtT(r.exp)}`;
  else if(delay>0)sub=`<span class="late">+${delay} min</span>`;
  return`<div class="when">${main}${sub?`<span class="sub">${sub}</span>`:''}</div>`;
}
function depRow(s,r){
  const dist=distTo(s);
  const reach=s.stale?null:reachStatus(dist,r.exp);
  const qn=r.mode==='rail'||r.mode==='metro'?'Spor':'Plattform';
  const tags=[r.quay?`<span class="quay" title="${qn} ${esc(r.quay)}" aria-label="${qn} ${esc(r.quay)}">${esc(r.quay)}</span>`:'',occHtml(r.occ),
    reach?`<span class="reach ${reach.cls}">${esc(reach.label)}</span>`:''].filter(Boolean).join('');
  return`<button class="dep press" type="button" data-sj="${esc(r.sj||'')}" data-stop="${esc(s.id)}">${lineBadge(r.pub,r.mode,'badge-l',false)}
    <span class="dest"><b>${esc(r.dest)}</b>${tags?`<small>${tags}</small>`:''}</span>
    ${whenHtml(`${s.id}|${r.pub}|${r.dest}|${r.aimed}`,r)}</button>`;
}
// Avgangene som tidslinje: én rad per linje og retning, prikkene står der de går.
// Det skraverte feltet er tiden du trenger for å gå dit – avganger inni det rekker du ikke.
// Går en linje så ofte at prikkene ville kollidert, slås de sammen til én prikk med «+n»;
// de sammenslåtte avgangene står i listen under. Returnerer også hvilke avganger som vises.
function stopTimeline(s,rows,{compact=false,maxLanes=compact?2:6,width=0}={}){
  const now=Date.now(),shown=new Set();
  let W=30;if(rows.filter(r=>r.exp-now<=30*60000).length<3)W=60;
  const inWin=rows.filter(r=>r.exp-now<=W*60000);if(!inWin.length)return{html:'',shown,W};
  const lanes=new Map();
  inWin.forEach(r=>{const k=`${r.pub}|${r.dest}`;if(!lanes.has(k))lanes.set(k,{key:k,pub:r.pub,mode:r.mode,dest:r.dest,rows:[]});lanes.get(k).rows.push(r);});
  const list=[...lanes.values()].slice(0,maxLanes),hidden=lanes.size-list.length;
  const x=t=>Math.max(0,Math.min(100,(t-now)/(W*60000)*100));
  const d=distTo(s),walk=d!=null&&!s.stale?walkMin(d):0,wp=Math.min(100,walk/W*100);
  // Bredden på plottet bestemmer hvor tett prikkene kan stå (prikken er ~26 px).
  const plotW=Math.max(150,(width||$('#sheetPage')?.clientWidth||360)-(compact?32+46+24:32+24+46+24)),gap=(compact?24:28)/plotW*100;
  const step=W===30?10:20,ticks=Array.from({length:W/step+1},(_,i)=>i*step);
  const tag=compact?'span':'button';
  const lane=L=>{
    const dots=[];
    L.rows.forEach(r=>{const xi=x(r.exp),last=dots[dots.length-1];
      if(last&&xi-last.x<gap){last.more.push(r);return;}
      dots.push({r,x:xi,more:[]});shown.add(r);});
    return`<div class="tl-lane" data-k="${esc(L.key)}"><span class="tl-lab">${lineBadge(L.pub,L.mode,'',false)}</span>
      <div class="tl-plot" style="--c:${modeOf(L.mode).c}"><span class="tl-dest">${esc(L.dest)}</span>
      ${walk?`<span class="tl-walk" style="width:${wp}%"></span>`:''}
      ${dots.map(({r,x:xi,more})=>{const m=Math.max(0,minUntil(r.exp)),late=r.exp-r.aimed>60000;
        const lab=`${modeOf(r.mode).n} ${r.pub} mot ${r.dest}, ${m<=0?'nå':`om ${m} min`}${late?', forsinket':''}${r.rt?'':', rutetid'}${more.length?`, og ${more.length} til rett etter`:''}`;
        return`${late?`<span class="tl-late" data-sj="${esc(r.sj||'')}" style="left:${x(r.aimed)}%;width:${xi-x(r.aimed)}%"></span>`:''}<${tag} class="tl-dot${r.rt?'':' sched'}${m<walk?' miss':''}"${tag==='button'?' type="button"':''}
          style="left:${xi}%" data-sj="${esc(r.sj||'')}" aria-label="${esc(lab)}">${m<=0?'nå':m}${more.length?`<sup>+${more.length}</sup>`:''}</${tag}>`;}).join('')}</div></div>`;
  };
  const html=`<div class="tl${compact?' tl-compact':''}" role="group" aria-label="Avganger de neste ${W} minuttene">
    ${compact?'':`<div class="tl-axis"><span></span><div>${ticks.map(t=>`<em style="left:${t/W*100}%">${t?t:'nå'}</em>`).join('')}</div></div>`}
    ${list.map(lane).join('')}
    ${!compact&&(walk||hidden)?`<div class="tl-legend">${walk?`<span class="tl-walk-key"></span>${ico('walk')}${walk} min å gå`:''}${hidden?`<span class="tl-more">+${hidden} til i listen</span>`:''}</div>`:''}
    ${compact&&hidden?`<span class="tl-more">+${hidden}</span>`:''}
  </div>`;
  return{html,shown,W,hidden};
}
// Oppdater en tidslinje på stedet når de samme avgangene fortsatt vises: prikkene glir i stedet for å hoppe.
const tlSig=el=>[...el.querySelectorAll('.tl-lane')].map(l=>`${l.dataset.k}:${[...l.querySelectorAll('.tl-dot,.tl-late')].map(d=>d.className.split(' ')[0]+d.dataset.sj).join(',')}`).join('|')
  +(el.querySelector('.tl-axis')?.textContent||'')+(el.querySelector('.tl-legend,.tl-compact>.tl-more')?'+':'');
function morphTl(o,n){
  if(!o||!n)return;
  if(!o.querySelector('.tl')||tlSig(o)!==tlSig(n)){o.innerHTML=n.innerHTML;return;}
  const parts='.tl-dot,.tl-late,.tl-walk,.tl-dest,.tl-legend,.tl-more',od=$$(parts,o),nd=$$(parts,n);
  od.forEach((e,i)=>{const m=nd[i];if(!m)return;e.style.cssText=m.style.cssText;e.className=m.className;
    if(e.innerHTML!==m.innerHTML)e.innerHTML=m.innerHTML;const al=m.getAttribute('aria-label');if(al)e.setAttribute('aria-label',al);});
}
function miniRow(s,r){
  const m=minUntil(r.exp);
  const t=m<=0?'<span class="m now">nå</span>':m<60?`<span class="m">${r.rt?'<i class="live"></i>':''}${m}<small>min</small></span>`:`<span class="m">${fmtT(r.exp)}</span>`;
  return`<div class="mini">${lineBadge(r.pub,r.mode,'',false)}<span class="d">${esc(r.dest)}</span>${t}</div>`;
}
const upcoming=id=>(state.deps.get(id)?.rows||[]).filter(r=>r.exp>Date.now()-30000);
// Holdeplasskort på Hjem: samme tidslinje som på holdeplassen, i liten utgave (to retninger).
function stopCard(s){
  const rows=upcoming(s.id),d=distTo(s),fav=favs.some(f=>f.id===s.id),entry=state.deps.get(s.id);
  let body;
  if(!entry)body='<div class="mini"><span class="skel" style="width:32px;height:22px"></span><span class="skel" style="width:70%"></span><span class="skel" style="width:36px"></span></div>';
  else if(!rows.length)body='<div class="mini"><span class="d" style="grid-column:1/-1;color:var(--ink-3)">Ingen avganger den neste timen</span></div>';
  else body=stopTimeline({...s,stale:entry.stale},rows,{compact:true}).html||rows.slice(0,2).map(r=>miniRow(s,r)).join('');
  return`<button class="stop-card" type="button" data-stop="${esc(s.id)}"><div class="top"><b>${esc(s.name)}</b>
    <span class="dist">${fav?ico('star','fav'):''}${d!=null?`${fmtDist(d)} · ${walkMin(d)} min`:''}</span></div><div class="sc-body">${body}</div></button>`;
}

/* ---------- Side: Hjem ---------- */
// Meldinger som gjelder linjer som går fra holdeplassene rundt deg eller favorittene dine.
function myLines(){
  const codes=new Set();
  [...favs,...state.nearby.slice(0,8)].forEach(s=>upcoming(s.id).forEach(r=>codes.add(String(r.pub))));
  return codes;
}
function relevantAlerts(){const mine=myLines();return state.alerts.filter(a=>(a.lines||[]).some(l=>mine.has(l)));}
pages.home={
  initial:'half',peek:196,
  head(){
    return`<div class="titles"><div class="head-title">Avganger</div><div class="head-sub" id="homeSub">${homeSubText()}</div></div>
      <button class="icon-btn press" id="homeRefresh" type="button" aria-label="Oppdater avganger">${ico('refresh')}</button>`;
  },
  body(){
    // Bare meldinger som angår deg får plass øverst; resten ligger rolig nederst.
    const rel=relevantAlerts(),n=rel.length,all=state.alerts.length;
    let h=n?`<button class="notice press" id="alertsNotice" type="button">${ico('alert')}<span><b>${n} ${plural(n,'melding','meldinger')} for linjer rundt deg</b><span class="one">${esc(rel[0].summary)}</span></span>${ico('chev')}</button>`:'';
    if(favs.length)h+=`<div class="label">Favoritter</div>${favs.map(stopCard).join('')}`;
    const near=state.nearby.filter(s=>!favs.some(f=>f.id===s.id)).slice(0,8);
    if(near.length)h+=`<div class="label">I nærheten</div>${near.map(stopCard).join('')}`;
    else if(!favs.length)h+=state.nearbyAt?`<div class="state">${ico('stop')}<b>Ingen holdeplasser her</b>Flytt kartet eller søk etter et sted.</div>`:
      `<div class="mini" style="padding:12px 16px">${'<span class="skel" style="height:40px"></span>'}</div>`;
    if(!state.pos&&state.nearbyAt)h+=`<p class="note">Slå på posisjon for å se holdeplassene rundt deg. <button class="reach" id="geoAsk" type="button">Bruk posisjonen min</button></p>`;
    if(all)h+=`<button class="quiet-link press" id="alertsAll" type="button">${ico('alert')}<span>Trafikkmeldinger</span><em>${all}</em>${ico('chev')}</button>`;
    return h;
  },
  bind(){
    $('#homeRefresh').onclick=()=>{buzz(8);$('#homeRefresh').classList.add('spin');loadDeps(true).finally(()=>$('#homeRefresh')?.classList.remove('spin'));};
    $('#alertsNotice')?.addEventListener('click',()=>{buzz(6);router.go('alerts');});
    $('#alertsAll')?.addEventListener('click',()=>{buzz(6);router.go('alerts');});
    $('#geoAsk')?.addEventListener('click',()=>{buzz(8);requestGeoOnce();});
    $$('#sheetPage [data-stop]').forEach(b=>b.onclick=()=>{buzz(6);router.go('stop',{id:b.dataset.stop});});
  },
  // Tidslinjene oppdateres på stedet; bare nye kort eller endret innhold tegnes på nytt.
  update(){
    const t=document.createElement('div');t.innerHTML=this.body();
    const page=$('#sheetPage'),oc=$$('.stop-card',page),nc=$$('.stop-card',t);
    const ids=a=>a.map(c=>c.dataset.stop).join(','),rest=el=>[...el.children].filter(c=>!c.classList.contains('stop-card')).map(c=>c.outerHTML).join('');
    if(ids(oc)!==ids(nc)||rest(page)!==rest(t)){const st=sheetScroll.scrollTop;router.render(null);sheetScroll.scrollTop=st;return;}
    oc.forEach((o,i)=>{const n=nc[i],ot=$('.top',o),nt=$('.top',n);if(ot.innerHTML!==nt.innerHTML)ot.innerHTML=nt.innerHTML;morphTl($('.sc-body',o),$('.sc-body',n));});
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
  // Hvert 20. sek: tell ned ringene og flytt kjøretøyene i sporene uten å tegne kortene på nytt.
  update(){
    const cards=$$('#sheetPage .trip[data-p]');
    if(!cards.length||cards.length!==state.trips.length||state.tripsLoading){router.render(null);return;}
    cards.forEach(el=>{const p=state.trips[+el.dataset.p],f=firstRide(p);
      setRing(el.querySelector('.ring'),minUntil(p.expectedStartTime),fmtT(p.expectedStartTime));
      const ap=el.querySelector('.ap');if(!ap||!f)return;
      // Samme spor som sist: flytt bussen og fyllet, så den glir videre i stedet for å hoppe.
      const t=document.createElement('div');t.innerHTML=approachHtml(f);const n=t.firstElementChild;
      if(ap.querySelector('.ap-track')&&n.querySelector('.ap-track')){
        ['title','aria-label'].forEach(a=>ap.setAttribute(a,n.getAttribute(a)||''));
        ap.querySelector('.ap-rail i').style.width=n.querySelector('.ap-rail i').style.width;
        const ov=ap.querySelector('.ap-veh'),nv=n.querySelector('.ap-veh');ov.style.left=nv.style.left;ov.className=nv.className;
        const od=$$('.ap-track>i:not(.ap-end)',ap),nd=$$('.ap-track>i:not(.ap-end)',n);od.forEach((d,k)=>d.className=nd[k]?.className||'');
      }else ap.replaceWith(n);});
  },
  enter(){if(state.trips.length){drawRoute(state.trips[state.tripIdx]);loadTripCalls();}}
};
// Første kjøretøy i hvert reiseforslag: hvor er det nå i forhold til holdeplassen du skal gå på?
const tripCalls=new Map(); // serviceJourney-id → {calls,t}
async function loadTripCalls(){
  const ids=[...new Set(state.trips.map(p=>firstRide(p)).filter(l=>l?.serviceJourney?.id&&minUntil(l.expectedStartTime)<90)
    .map(l=>l.serviceJourney.id))].filter(id=>!(Date.now()-(tripCalls.get(id)?.t||0)<25000));
  if(!ids.length)return;
  await Promise.all(ids.map(async id=>{try{const d=await gql(Q_SJ_CALLS,{id});const c=d.serviceJourney?.estimatedCalls;if(c?.length)tripCalls.set(id,{calls:c,t:Date.now()});}catch(e){}}));
  if(router.cur.name==='results')router.refresh();
}
const firstRide=p=>(p.legs||[]).find(l=>l.mode!=='foot');
// Som estimate(), men uten kartgeometri: siste passerte stopp og andelen av strekningen videre.
function callPos(c,now=Date.now()){
  if(!c||c.length<2)return null;
  if(now<depT(c[0]))return{at:0,f:0,state:'start'};
  for(let i=0;i<c.length-1;i++){
    const a=arrT(c[i]),d=depT(c[i]),n=arrT(c[i+1]);
    if(now>=a&&now<d)return{at:i,f:0,state:'stop'};
    if(now>=d&&now<n)return{at:i,f:(now-d)/((n-d)||1),state:'moving'};
  }
  return{at:c.length-1,f:0,state:'done'};
}
// Lite spor: de siste stoppene før påstigning, med kjøretøyet som glir inn mot din holdeplass.
const AP_N=8;
function approachHtml(l){
  const entry=tripCalls.get(l.serviceJourney?.id),place=esc(placeName(l.fromPlace,''));
  const plain=`<span class="ap-name">${place}</span>`,planned=`<span class="ap-name">${place} <time>${fmtT(l.expectedStartTime)}</time></span>`;
  if(!entry)return`<div class="ap">${planned}</div>`;
  const c=entry.calls,board=nearestCallIdx(c,l.fromPlace?.quay,l.fromPlace?.name),e=callPos(c);
  if(board<0||!e||e.state==='start'||Date.now()>=depT(c[board])||board-e.at>AP_N*2)return`<div class="ap">${planned}</div>`;
  const pos=e.state==='start'?-1:e.at+e.f,away=Math.max(0,board-pos),start=board-AP_N;
  const pct=Math.max(0,Math.min(100,(pos-start)/AP_N*100)),far=pos<start;
  const n=Math.ceil(away),code=esc(l.line?.publicCode||modeOf(l.mode).n);
  const label=e.state==='start'?`${modeOf(l.mode).n} ${code} har ikke startet ennå`:n<=0?`${modeOf(l.mode).n} ${code} er ved holdeplassen`:`${modeOf(l.mode).n} ${code} er ${n} ${plural(n,'stopp','stopp')} unna`;
  const dots=Array.from({length:AP_N},(_,i)=>`<i style="left:${i/AP_N*100}%"${start+i<=pos?' class="on"':''}></i>`).join('');
  return`<div class="ap" role="img" aria-label="${esc(label)}" title="${esc(label)}"><span class="ap-track" style="--c:${modeOf(l.mode).c}">
    <span class="ap-rail"><i style="width:${pct}%"></i></span>${dots}<i class="ap-end"></i>
    <span class="ap-veh${far?' far':''}" style="left:${pct}%">${code}</span></span>${plain}</div>`;
}
function tripCard(p,i,isFastest){
  const legs=p.legs||[],rides=legs.filter(l=>l.mode!=='foot'),first=rides[0];
  const total=legs.reduce((s,l)=>s+(l.duration||0),0)||1;
  // Stripen er reisen: lengden er tiden, fargen er linjen, tallet står inni.
  const segs=legs.filter(l=>l.mode!=='foot'||l.duration>=60).map((l,j)=>{
    const w=Math.max(.06,(l.duration||0)/total),d=`animation-delay:${i*50+j*45}ms`;
    if(l.mode==='foot')return`<span class="seg walk" style="flex:${w} 1 0;${d}" title="Gå ${Math.round(l.duration/60)} min">${ico('walk')}<b>${Math.round(l.duration/60)}</b></span>`;
    const md=modeOf(l.mode),code=l.line?.publicCode||md.n,a=alertFor(code);
    return`<span class="seg ride${a?' has-alert':''}" style="flex:${w} 1 0;--c:${md.c};${d}" title="${md.n} ${esc(code)}${a?` – ${esc(a.summary)}`:''}"><b>${esc(code)}</b></span>`;
  }).join('')||`<span class="seg walk" style="flex:1">${ico('walk')}<b>${Math.round(p.duration/60)}</b></span>`;
  const leave=minUntil(p.expectedStartTime);
  return`<button class="trip${i===state.tripIdx?' sel':''}" type="button" data-p="${i}" style="animation-delay:${i*50}ms">
    ${ringHtml(leave,{aria:'Gå om',clock:fmtT(p.expectedStartTime)})}
    <div class="trip-main"><div class="trip-top"><span class="t">${fmtT(p.expectedStartTime)}<span>–</span>${fmtT(p.expectedEndTime)}</span>
      <span class="dur">${Math.round(p.duration/60)} min</span>${isFastest?'<span class="fast">Raskest</span>':''}</div>
    <div class="stripe" aria-label="${esc(changesText(Math.max(0,rides.length-1)))}">${segs}</div>
    ${first?approachHtml(first):''}</div></button>`;
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
      let what,extra='';
      if(walk)what=`<span class="wk">${ico('walk')}<b>${Math.max(1,Math.round(l.duration/60))}</b> min</span><small>${fmtDist(l.distance||0)}</small>`;
      else{
        const code=l.line?.publicCode||md.n,toward=l.fromEstimatedCall?.destinationDisplay?.frontText,q=l.fromPlace?.quay?.publicCode;
        const qn=l.mode==='rail'||l.mode==='metro'?'Spor':'Plattform';
        what=`${lineBadge(code,l.mode,'badge-l')}${toward?`<span class="to">${ico('arrow')}<span>${esc(toward)}</span></span>`:''}
          <span class="leg-tags">${q?`<span class="quay" title="${qn} ${esc(q)}" aria-label="${qn} ${esc(q)}">${esc(q)}</span>`:''}${l.realtime?'<i class="live" title="Sanntid" aria-label="Sanntid"></i>':''}${occHtml(l.fromEstimatedCall?.occupancyStatus)}</span>`;
        const al=alertFor(code);
        if(al)extra=`<button class="leg-alert press" type="button" data-alerts>${ico('alert')}<span>${esc(al.summary)}</span></button>`;
      }
      const stops=walk?[]:(l.intermediateEstimatedCalls||[]).filter(c=>c.quay?.name);
      // Stoppene underveis er prikker på skinnen; trykk for navn og tider.
      const details=walk||!p.stopDetailsAvailable||!stops.length?'':`<details><summary><span class="sdots">${'<i></i>'.repeat(Math.min(stops.length,10))}</span>${stops.length} stopp</summary>
        <ol>${stops.map(c=>`<li><span>${esc(c.quay.name)}</span>${c.expectedArrivalTime?`<time>${fmtT(c.expectedArrivalTime)}</time>`:''}</li>`).join('')}</ol></details>`;
      const done=ts(l.expectedEndTime)<Date.now();
      return`<div class="leg${walk?' walk':''}${done?' done':''}" data-li="${i}" style="--c:${walk?'var(--ink-3)':md.c}"><time>${fmtT(l.expectedStartTime)}</time>
        <span class="rail"><span class="node"></span>${walk?'':`<span class="rveh" hidden>${esc(l.line?.publicCode||'')}</span>`}</span>
        <div class="body"><div class="place">${place}</div><div class="what">${what}</div>${extra}${details}</div></div>`;
    }).join('');
    const last=legs[legs.length-1];
    return'<div class="live-status" id="liveStatus" hidden></div>'+(p.schematic?'<div class="jnote">Kartlinjen er forenklet. Følg stoppene og byttene her.</div>':'')+steps+
      `<div class="leg end"><time>${fmtT(p.expectedEndTime)}</time><span class="rail"><span class="node"></span></span>
      <div class="body"><div class="place">${esc(placeName(last?.toPlace,p.toName))}</div></div></div>`;
  },
  bind(){
    $('#fitRoute')?.addEventListener('click',()=>{buzz(6);fitRoute();});
    $('#closeTrip')?.addEventListener('click',()=>{buzz(6);router.home();});
    $$('#sheetPage [data-alerts]').forEach(b=>b.onclick=()=>{buzz(6);router.go('alerts');});
    updateLiveBox();
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
    const s=findStop(id)||{name:state.deps.get(id)?.name||'Holdeplass'},d=s.lat!=null?distTo(s):null,fav=favs.some(f=>f.id===id);
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
    const list=rows.filter(r=>!f||r.mode===f),st={...s,stale:entry.stale};
    const al=[...new Set(rows.map(r=>String(r.pub)))].map(c=>alertFor(c)).filter((a,i,arr)=>a&&arr.indexOf(a)===i);
    const alertRow=al.length?`<button class="leg-alert stop-alert press" type="button" data-alerts>${ico('alert')}<span>${esc(al[0].summary)}</span>${al.length>1?`<em>+${al.length-1}</em>`:''}</button>`:'';
    // Tidslinjen viser de nærmeste avgangene; listen tar bare resten, så ingenting står to ganger.
    const tl=stopTimeline(st,list),later=list.filter(r=>!tl.shown.has(r));
    const rest=entry.error&&!rows.length?`<div class="state">${ico('alert')}<b>Fikk ikke hentet avganger</b>Prøv igjen om litt.</div>`:
      !list.length?'<div class="state">Ingen avganger den neste timen.</div>':
      later.length?(tl.html?`<div class="label">${tl.hidden?'Flere avganger':'Senere'}</div>`:'')+later.slice(0,40).map(r=>depRow(st,r)).join(''):'';
    return`<div id="stopTop">${alertRow}${filters}</div><div id="stopTl">${tl.html}</div><div id="stopRest">${rest}</div>`+
      `<p class="note">Trykk på en avgang for å se hvor den er nå. Det skraverte feltet er tiden du trenger for å gå til holdeplassen.</p>`;
  },
  bind({id}){
    updateStopCallout(id);
    $('#favBtn').onclick=()=>toggleFav(id);
    this.bindRows(id);
  },
  bindRows(id){
    $$('#sheetPage [data-alerts]').forEach(b=>b.onclick=()=>{buzz(6);router.go('alerts');});
    $$('#sheetPage .filter').forEach(b=>b.onclick=()=>{buzz(6);stopFilter.set(id,b.dataset.m==='all'?null:b.dataset.m);router.refresh();});
    $$('#sheetPage .dep[data-sj],#sheetPage .tl-dot[data-sj]').forEach(b=>b.onclick=()=>{if(!b.dataset.sj)return;buzz(6);router.go('journey',{sj:b.dataset.sj,stop:id});});
  },
  // Oppdatering på stedet: prikkene glir mot «nå» i stedet for å tegnes på nytt.
  update(params){
    const t=document.createElement('div');t.innerHTML=this.body(params);
    const page=$('#sheetPage'),o={top:$('#stopTop',page),tl:$('#stopTl',page),rest:$('#stopRest',page)};
    const n={top:$('#stopTop',t),tl:$('#stopTl',t),rest:$('#stopRest',t)};
    if(!o.tl||!n.tl){router.render(null);return;}
    const nm=findStop(params.id)?.name||state.deps.get(params.id)?.name,ht=$('#sheetHead .head-title');if(nm&&ht&&ht.textContent!==nm)ht.textContent=nm;
    o.top.innerHTML=n.top.innerHTML;o.rest.innerHTML=n.rest.innerHTML;
    morphTl(o.tl,n.tl);
    this.bindRows(params.id);updateStopCallout(params.id);
  },
  leave(){if(mapLoaded){map.setFilter('stop-sel',['==',['get','id'],'']);map.setFilter('stop-cards',['all',['has','card'],['!=',['get','id'],'']]);}removeStopCallout();},
  enter({id}){
    if(mapLoaded){map.setFilter('stop-sel',['==',['get','id'],id]);map.setFilter('stop-cards',['all',['has','card'],['!=',['get','id'],id]]);}
    const s=findStop(id);
    if(s&&mapLoaded){
      const b=map.getBounds();
      // Holdeplassen litt under midten, så boblen med avganger får plass over den.
      map.easeTo({center:[s.lon,s.lat],zoom:Math.max(map.getZoom(),15.5),offset:[0,70],duration:reduceMotion.matches?0:600,padding:mapPadding()});
      setFollow(false);
    }
    loadStopDeps(id).then(()=>{if(router.cur.name==='stop'&&router.cur.params.id===id)router.refresh();});
  }
};
/* =====================================================================
   FLYTEKORT
   Et lite glasskort som hører til et punkt på kartet (holdeplass eller
   kjøretøy) og er koblet til det med en tynn linje. Kortet kan dras dit du
   vil; appen husker retningen og legger det ellers der det ikke dekker din
   posisjon, søkefeltet eller arket. Det følger med når kartet flyttes, og
   følger kjøretøyet mens det kjører.
   ===================================================================== */
const fc$={el:null,svg:null,target:null,off:null,raf:0,drag:null};
const FC_PREF_KEY='reisCardOffset';
function fcEnsure(){
  if(fc$.el)return;
  fc$.svg=document.createElementNS('http://www.w3.org/2000/svg','svg');fc$.svg.setAttribute('class','fc-leader');fc$.svg.setAttribute('aria-hidden','true');
  fc$.svg.innerHTML='<line/><circle r="4"/>';
  fc$.el=document.createElement('section');fc$.el.className='fc';fc$.el.setAttribute('role','dialog');
  $('#app').append(fc$.svg,fc$.el);
  // Dra kortet: hele kortet unntatt knapper og rader er håndtak.
  fc$.el.addEventListener('pointerdown',e=>{
    if(e.target.closest('button,.fc-row'))return;
    fc$.drag={x:e.clientX,y:e.clientY,ox:fc$.off.x,oy:fc$.off.y,moved:false,id:e.pointerId};
    fc$.el.setPointerCapture(e.pointerId);
  });
  fc$.el.addEventListener('pointermove',e=>{
    const d=fc$.drag;if(!d||e.pointerId!==d.id)return;
    const dx=e.clientX-d.x,dy=e.clientY-d.y;
    if(!d.moved&&Math.hypot(dx,dy)<5)return;
    d.moved=true;fc$.el.classList.add('dragging');
    fc$.off={x:d.ox+dx,y:d.oy+dy};fcPlace();
  });
  const end=e=>{const d=fc$.drag;if(!d||e.pointerId!==d.id)return;fc$.drag=null;fc$.el.classList.remove('dragging');
    if(d.moved){buzz(6);fc$.off={...fc$.placed,user:true}; // lagre slik kortet faktisk ligger
      try{localStorage.setItem(FC_PREF_KEY,JSON.stringify(fc$.placed));}catch(_){}}};
  fc$.el.addEventListener('pointerup',end);fc$.el.addEventListener('pointercancel',end);
  map.on('move',fcPlace);
}
function fcAnchor(){const t=fc$.target;if(!t)return null;const ll=t.lngLat();return ll?map.project(ll):null;}
// Første plassering: brukerens foretrukne retning, ellers over (eller under, nær toppen) og litt til siden.
function fcDefaultOffset(a){
  const pref=loadJSON(FC_PREF_KEY,null);
  if(pref&&Number.isFinite(pref.x))return{...pref,user:true};
  const w=fc$.el.offsetWidth,h=fc$.el.offsetHeight,top=safeTop()+72;
  const above=a.y-h-52>top;
  const side=a.x>innerWidth/2?-w-18:18;
  return{x:Math.abs(side)>w?side:-w/2,y:above?-h-52:52};
}
function fcPlace(){
  if(!fc$.target)return;
  const a=fcAnchor();
  if(!a){if(fc$.target.moving)fcClose();return;} // kjøretøyet er borte fra kartet
  const el=fc$.el,w=el.offsetWidth,h=el.offsetHeight;
  if(!fc$.off)fc$.off=fcDefaultOffset(a);
  const minY=safeTop()+68,maxY=innerHeight-(wide.matches?16:sheetUI.visible)-h-10;
  const minX=wide.matches?432:8,maxX=innerWidth-w-8;
  let x=a.x+fc$.off.x,y=a.y+fc$.off.y;
  x=Math.max(minX,Math.min(maxX,x));y=Math.max(minY,Math.min(maxY,y));
  fc$.placed={x:x-a.x,y:y-a.y};
  el.style.transform=`translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  // Linjen går fra punktet til nærmeste kant av kortet.
  const cx=Math.max(x,Math.min(x+w,a.x)),cy=Math.max(y,Math.min(y+h,a.y));
  const inside=a.x>x&&a.x<x+w&&a.y>y&&a.y<y+h;
  const line=fc$.svg.firstChild,dot=fc$.svg.lastChild;
  line.setAttribute('x1',a.x);line.setAttribute('y1',a.y);line.setAttribute('x2',cx);line.setAttribute('y2',cy);
  dot.setAttribute('cx',a.x);dot.setAttribute('cy',a.y);
  fc$.svg.classList.toggle('hidden',inside||Math.hypot(cx-a.x,cy-a.y)<6);
  const offscreen=a.x<-40||a.x>innerWidth+40||a.y<-40||a.y>innerHeight+40;
  el.classList.toggle('far',offscreen);fc$.svg.classList.toggle('far',offscreen);
}
function fcOpen(target,html,{label}={}){
  fcEnsure();
  const same=fc$.target&&fc$.target.key===target.key;
  fc$.target=target;
  fc$.el.classList.toggle('settled',same); // oppdateringer animerer ikke radene på nytt
  fc$.el.innerHTML=html;fc$.el.setAttribute('aria-label',label||'');
  fc$.el.querySelector('.fc-close')?.addEventListener('click',e=>{e.stopPropagation();buzz(6);target.onClose?.();});
  target.bind?.(fc$.el);
  if(!same){
    fc$.off=null;fc$.el.classList.remove('in');fc$.svg.classList.remove('in');void fc$.el.offsetWidth;
    fc$.el.hidden=false;fc$.svg.style.display='';
    fcPlace();
    // Kortet vokser fram fra punktet det hører til.
    const a=fcAnchor(),r=fc$.el.getBoundingClientRect();
    if(a)fc$.el.style.transformOrigin=`${a.x-r.left}px ${a.y-r.top}px`;
    fc$.el.classList.add('in');fc$.svg.classList.add('in');
  }else fcPlace();
  cancelAnimationFrame(fc$.raf);
  if(target.moving){const loop=()=>{fcPlace();fc$.raf=requestAnimationFrame(loop);};fc$.raf=requestAnimationFrame(loop);}
}
function fcClose(){
  if(!fc$.el||!fc$.target)return;
  cancelAnimationFrame(fc$.raf);fc$.target=null;
  fc$.el.classList.remove('in');fc$.el.classList.add('out');fc$.svg.classList.remove('in');
  setTimeout(()=>{if(!fc$.target){fc$.el.hidden=true;fc$.el.classList.remove('out');fc$.svg.style.display='none';}},reduceMotion.matches?0:200);
}
const fcMinKeys=new Map();
function fcMinutes(key,r,big){
  const m=minUntil(r.exp),prev=fcMinKeys.get(key);fcMinKeys.set(key,m);
  const tick=prev!=null&&prev!==m?'tick':'';
  const live=r.rt?'<i class="live" title="Sanntid"></i>':'<i class="sched" title="Rutetid"></i>';
  const late=fmtT(r.exp)!==fmtT(r.aimed)&&r.exp>r.aimed?Math.round((r.exp-r.aimed)/60000):0;
  const lateTag=late>0?`<em class="fc-late" title="${late} min forsinket (rutetid ${fmtT(r.aimed)})">+${late}</em>`:'';
  if(m<=0)return`<span class="fc-t${big?' big':''}">${live}${lateTag}<b class="fc-now">nå</b></span>`;
  if(m>=60)return`<span class="fc-t${big?' big':''}">${live}${lateTag}<b class="${tick}">${fmtT(r.exp)}</b></span>`;
  return`<span class="fc-t${big?' big':''}">${live}${lateTag}<b class="${tick}">${m}</b><small>min</small></span>`;
}

/* ---------- Flytekort for holdeplass ---------- */
// Når arket med tidslinjen er oppe, viser kortet på kartet bare neste avgang – ellers de fire neste.
function updateStopCallout(id){
  const s=findStop(id);if(!s||!mapLoaded||s.lat==null){fcClose();return;}
  const compact=router.cur.name==='stop'&&sheetUI.snap!=='peek';
  const entry=state.deps.get(id),rows=upcoming(id).slice(0,compact?1:4),anyRt=rows.some(r=>r.rt);
  const first=rows[0],rest=rows.slice(1);
  let body;
  if(!entry)body='<div class="fc-row skel-row"><span class="skel" style="width:34px;height:24px"></span><span class="skel"></span><span class="skel" style="width:40px"></span></div>'.repeat(compact?1:2);
  else if(!first)body='<p class="fc-empty">Ingen avganger den neste timen</p>';
  else{
    const qn=first.mode==='rail'||first.mode==='metro'?'Spor':'Plattform';
    const tags=[first.quay?`<span class="quay" title="${qn} ${esc(first.quay)}" aria-label="${qn} ${esc(first.quay)}">${esc(first.quay)}</span>`:'',occHtml(first.occ)].join('');
    body=`<button class="fc-row fc-first" type="button" style="--i:0" data-sj="${esc(first.sj||'')}">${lineBadge(first.pub,first.mode,'badge-l')}
        <span class="fc-dest"><b>${esc(first.dest)}</b>${tags?`<small class="fc-tags">${tags}</small>`:''}</span>
        ${fcMinutes(`${id}|${first.pub}|${first.dest}|${first.aimed}`,first,true)}</button>`+
      rest.map((r,i)=>`<button class="fc-row" type="button" style="--i:${i+1}" data-sj="${esc(r.sj||'')}">${lineBadge(r.pub,r.mode)}
        <span class="fc-dest">${esc(r.dest)}</span>${fcMinutes(`${id}|${r.pub}|${r.dest}|${r.aimed}`,r,false)}</button>`).join('');
  }
  fc$.el?.classList.toggle('compact',compact);
  fcOpen({key:'stop:'+id,lngLat:()=>[s.lon,s.lat],onClose:()=>router.back(),
    bind:el=>el.querySelectorAll('.fc-row').forEach(b=>b.addEventListener('click',()=>{buzz(6);
      if(b.dataset.sj)router.go('journey',{sj:b.dataset.sj,stop:id});else snapTo('half');}))},
    `<header class="fc-head"><span class="fc-grip" aria-hidden="true"></span><div class="fc-title"><b>${esc(s.name)}</b>
      ${anyRt?'<i class="live" title="Sanntid" aria-label="Sanntid"></i>':''}</div>
      <button class="fc-close" type="button" aria-label="Lukk">${ico('x')}</button></header><div class="fc-body">${body}</div>`,
    {label:`Avganger fra ${s.name}`});
  fc$.el?.classList.toggle('compact',compact);
}
function removeStopCallout(){if(fc$.target?.key?.startsWith('stop:'))fcClose();}

/* ---------- Flytekort for kjøretøy: følger kjøretøyet ---------- */
function vehicleLngLat(vid){
  const f=gpsFeats.find(x=>x.properties.vid===vid)||estFeats.find(x=>x.properties.vid===vid);
  return f?f.geometry.coordinates:null;
}
function showVehicleCard(p){
  const md=modeOf(p.mode),vid=p.vid;
  const j=p.est?estJ.get(vid):null;
  let next='';
  if(j){const e=estimate(j);const c=e&&j.calls[Math.min(j.calls.length-1,e.at+1)];
    const t=c&&arrT(c);if(t){const m=Math.round((t-Date.now())/60000);
      next=`<div class="fc-meta">Neste stopp <b>${m<=0?'nå':`om ${m} min`}</b></div>`;}}
  fcOpen({key:'veh:'+vid,moving:true,lngLat:()=>vehicleLngLat(vid),onClose:fcClose},
    `<header class="fc-head"><span class="fc-grip" aria-hidden="true"></span><div class="fc-title fc-veh">
      <span class="badge badge-l" style="--c:${md.c}">${esc(p.line||md.n)}</span><b>${p.dest?esc(p.dest):md.n}</b></div>
      <button class="fc-close" type="button" aria-label="Lukk">${ico('x')}</button></header>
     <div class="fc-body"><div class="fc-meta">${md.n}${p.line?' '+esc(p.line):''} · ${p.est?'<span class="fc-src est">Beregnet fra sanntid</span>':'<span class="fc-src"><i class="live"></i>GPS-posisjon</span>'}</div>${next}</div>`,
    {label:`${md.n} ${p.line||''}`});
}

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

/* ---------- Side: Turen ----------
   Én bestemt avgang: hele ruten på kartet (kjørt strekning nedtonet),
   kjøretøyet live, alle stopp med tider, og hvor langt den er fra «din»
   holdeplass – den du trykket på, eller stoppet på ruten nærmest deg. */
const jv={sj:null,job:null,stopIdx:-1,timer:0,fitted:false,loading:false,error:null};
function jvTrip(job,stopIdx){ // pseudo-reise så live-motoren (status, kjøretøy) kan gjenbrukes
  const c=job.calls,b=c[stopIdx]||c[0],last=c[c.length-1];
  const q=x=>({name:x.quay?.name,quay:{latitude:x.quay?.latitude,longitude:x.quay?.longitude}});
  const leg={journey:true,noStop:stopIdx<0,mode:job.mode,line:{publicCode:job.code},serviceJourney:{id:job.sj},fromPlace:q(b),toPlace:q(last),
    expectedStartTime:new Date(depT(b)).toISOString(),expectedEndTime:new Date(arrT(last)).toISOString()};
  return{legs:[leg],expectedStartTime:leg.expectedStartTime,expectedEndTime:leg.expectedEndTime};
}
const Q_SJ_FULL=`query($id:String!){serviceJourney(id:$id){id line{publicCode transportMode} pointsOnLink{points}
  estimatedCalls{realtime aimedArrivalTime expectedArrivalTime expectedDepartureTime actualArrivalTime actualDepartureTime aimedDepartureTime
    destinationDisplay{frontText} quay{id name latitude longitude publicCode stopPlace{id parent{id}}}}}}`;
async function loadJourney(sjId,stopId){
  jv.loading=true;jv.error=null;
  try{
    const d=await gql(Q_SJ_FULL,{id:sjId});const sj=d.serviceJourney;if(!sj)throw new Error('Fant ikke turen');
    const calls=sj.estimatedCalls||[];
    const pts=sj.pointsOnLink?.points?decodePoly(sj.pointsOnLink.points):calls.filter(c=>c.quay).map(c=>[c.quay.longitude,c.quay.latitude]);
    const cum=prepPath(pts);
    const job={sj:sjId,code:sj.line?.publicCode||'',mode:sj.line?.transportMode||'bus',calls,pts,cum,stopS:projectStops(pts,cum,calls),
      dest:calls[0]?.destinationDisplay?.frontText||calls[calls.length-1]?.quay?.name||''};
    // Knutepunkt (f.eks. Jernbanetorget) har plattformer under et barnestoppested: sjekk også forelder, så navn.
    const stopName=stopId&&findStop(stopId)?.name;
    let idx=stopId?calls.findIndex(c=>c.quay?.stopPlace?.id===stopId||c.quay?.stopPlace?.parent?.id===stopId):-1;
    if(idx<0&&stopName)idx=calls.findIndex(c=>c.quay?.name===stopName);
    if(idx<0&&state.pos){ // nærmeste stopp på ruten fra der du står (innen 1,5 km), og som ikke er passert
      const e=estimate(job);let best=-1,bd=1500;
      calls.forEach((c,i)=>{if(!c.quay||(e&&i<=e.at&&e.state!=='start'))return;const dd=geoDist(state.pos,[c.quay.latitude,c.quay.longitude]);if(dd<bd){bd=dd;best=i;}});
      idx=best;
    }
    jv.job=job;jv.stopIdx=idx;
  }catch(e){jv.error=e.message||'Ukjent feil';}
  jv.loading=false;
}
// Ruten: kjørt strekning grå, resten i linjens farge. Stoppene med navn og tid.
function drawJourney(){
  const j=jv.job;if(!j||!mapLoaded)return;
  const e=estimate(j),s=e?Math.max(0,e.s):0,col=modeOf(j.mode).c;
  const cut=pointAt(j.pts,j.cum,s).p,k=Math.max(1,j.cum.findIndex(c=>c>=s));
  const done=[...j.pts.slice(0,k),cut],todo=[cut,...j.pts.slice(k)];
  const feats=[];
  if(done.length>1&&s>0)feats.push({type:'Feature',geometry:{type:'LineString',coordinates:done},properties:{walk:false,color:'#9AA3A8'}});
  if(todo.length>1)feats.push({type:'Feature',geometry:{type:'LineString',coordinates:todo},properties:{walk:false,color:col}});
  setData('route',fc(feats));
  const passed=i=>e&&e.state!=='start'&&i<=e.at;
  setData('route-stops',fc(j.calls.filter(c=>c.quay).map((c,i)=>({type:'Feature',geometry:{type:'Point',coordinates:[c.quay.longitude,c.quay.latitude]},
    properties:{name:c.quay.name,time:new Date(passed(i)?depT(c):arrT(c)).toISOString(),clock:fmtT(passed(i)?depT(c):arrT(c)),
      color:passed(i)?'#9AA3A8':col,kind:i===jv.stopIdx?'Din holdeplass':passed(i)?'Passert':'Stopp',minor:i!==jv.stopIdx&&i!==0&&i!==j.calls.length-1}}))));
}
function fitJourney(){
  const j=jv.job;if(!j||!mapLoaded)return;
  const e=estimate(j),pts=[];
  if(e)pts.push(pointAt(j.pts,j.cum,e.s).p);
  const sc=j.calls[jv.stopIdx];if(sc?.quay)pts.push([sc.quay.longitude,sc.quay.latitude]);
  if(state.pos)pts.push([state.pos[1],state.pos[0]]);
  if(pts.length<2)j.pts.forEach(p=>pts.push(p));
  const b=new maplibregl.LngLatBounds(pts[0],pts[0]);pts.forEach(p=>b.extend(p));
  map.setPadding(mapPadding());setFollow(false);
  map.fitBounds(b,{padding:{top:50,bottom:50,left:50,right:50},maxZoom:16.5,duration:reduceMotion.matches?0:800});
}
pages.journey={
  initial:'half',peek:176,
  head(){
    const j=jv.job;
    if(!j)return`${backBtn}<div class="titles"><div class="head-title">Henter turen…</div></div>`;
    const md=modeOf(j.mode);
    return`${backBtn}<div class="titles jv-title"><span class="badge badge-l" style="--c:${md.c}">${esc(j.code||md.n)}</span>
      <div><div class="head-title">${esc(j.dest)}</div><div class="head-sub">${md.n} ${esc(j.code)} · ${j.calls.length} stopp</div></div></div>
      <button class="icon-btn press" id="jvFit" type="button" aria-label="Vis hele turen">${ico('expand')}</button>`;
  },
  body(){
    if(jv.error)return`<div class="state">${ico('alert')}<b>Fikk ikke hentet turen</b>${esc(jv.error)}</div>`;
    if(jv.loading||!jv.job)return'<div class="dep"><span class="skel" style="height:28px"></span><span class="skel"></span><span class="skel"></span></div>'.repeat(3);
    if(false)return`<div class="state">${ico('alert')}<b>Fikk ikke hentet turen</b>${esc(jv.error)}</div>`;
    const j=jv.job,e=estimate(j),sc=j.calls[jv.stopIdx];
    let walk='';
    if(sc?.quay&&state.pos){const d=Math.round(geoDist(state.pos,[sc.quay.latitude,sc.quay.longitude])),reach=reachStatus(d,arrT(sc));
      walk=`<div class="jv-walk" aria-label="${esc(`${fmtDist(d)} til ${sc.quay.name}, ${walkMin(d)} min å gå`)}">${ico('walk')}<span><b>${walkMin(d)} min</b> <small>${fmtDist(d)}</small></span>${reach?`<span class="reach ${reach.cls}">${esc(reach.label)}</span>`:''}</div>`;}
    const rows=j.calls.map((c,i)=>{
      const passed=e&&e.state!=='start'&&i<=e.at,here=e&&i===e.at&&e.state==='stop',mine=i===jv.stopIdx;
      const t=passed?depT(c):arrT(c),late=Math.round((arrT(c)-ts(c.aimedArrivalTime))/60000);
      const veh=e&&((e.state==='moving'&&i===e.at)||(e.state==='start'&&i===0&&false));
      return`<div class="jv-stop${passed?' passed':''}${mine?' mine':''}${here?' here':''}" data-i="${i}">
        <time>${fmtT(t)}${!passed&&late>0?`<small class="late">+${late}</small>`:''}</time>
        <span class="jv-rail" style="--c:${modeOf(j.mode).c}"><i></i>${here?`<em class="jv-veh" style="--c:${modeOf(j.mode).c}">${esc(j.code)}</em>`:''}</span>
        <span class="jv-name">${esc(c.quay?.name||'Stopp')}${mine?'<small>Din holdeplass</small>':''}</span></div>
        ${veh?`<div class="jv-between"><span></span><span class="jv-rail" style="--c:${modeOf(j.mode).c}"><i></i><em class="jv-veh moving" style="--c:${modeOf(j.mode).c}">${esc(j.code)}</em></span><span class="jv-note">Underveis</span></div>`:''}`;
    }).join('');
    return`<div class="jv-sticky"><div class="live-status" id="liveStatus" hidden></div>${walk}</div><div class="jv-list">${rows}</div>
      <p class="note">${e&&e.state==='done'?'Turen er fullført.':'Posisjonen er GPS der operatøren deler den, ellers beregnet fra sanntid.'}</p>`;
  },
  bind(){
    $('#jvFit')?.addEventListener('click',()=>{buzz(6);fitJourney();});
    $$('#sheetPage .jv-stop').forEach(r=>r.onclick=()=>{const c=jv.job?.calls[+r.dataset.i];if(!c?.quay)return;buzz(6);
      map.easeTo({center:[c.quay.longitude,c.quay.latitude],zoom:Math.max(map.getZoom(),15.5),duration:reduceMotion.matches?0:600});});
    updateLiveBox();
    // Hold «her er kjøretøyet» i listen i synsfeltet første gang.
    if(!jv.scrolled){const h=$('#sheetPage .jv-stop.here,#sheetPage .jv-between');if(h){jv.scrolled=true;setTimeout(()=>h.scrollIntoView({block:'center'}),60);}}
  },
  async enter({sj,stop}){
    fcClose();clearRoute();clearPins();setData('vehicles',EMPTY);
    if(jv.sj!==sj||!jv.job){jv.sj=sj;jv.job=null;jv.scrolled=false;jv.loading=true;router.render(null);await loadJourney(sj,stop);}
    if(router.cur.name!=='journey'||jv.sj!==sj)return;
    router.render(null);
    if(!jv.job)return;
    drawJourney();fitJourney();
    startLive(jvTrip(jv.job,jv.stopIdx));
    // Kjørt strekning og stoppfarger følger kjøretøyet; listen oppdateres hvert 20. sek.
    clearInterval(jv.timer);
    jv.timer=setInterval(()=>{if(document.hidden||router.cur.name!=='journey')return;
      const job=live.jobs[0];if(job?.calls)jv.job.calls=job.calls;drawJourney();},3000);
  },
  leave(){clearInterval(jv.timer);stopLive();setData('route',EMPTY);setData('route-stops',EMPTY);jv.sj=null;}
};

/* ---------- Side: Trafikkmeldinger ---------- */
pages.alerts={
  snaps:['full'],initial:'full',
  head(){return`${backBtn}<div class="titles"><div class="head-title">Trafikkmeldinger</div><div class="head-sub">${state.alertsAt?`Oppdatert kl. ${fmtT(state.alertsAt)}`:'Henter…'}</div></div>`;},
  body(){
    if(!state.alerts.length)return`<div class="state">${ico('check')}<b>Ingen avvik</b>Trafikken går som normalt.</div>`;
    const fmtWhen=ts=>{const d=new Date(ts);const today=d.toDateString()===new Date().toDateString();
      return today?`kl. ${fmtT(d)}`:d.toLocaleDateString('nb-NO',{day:'numeric',month:'short'})+` kl. ${fmtT(d)}`;};
    const mine=myLines();
    const item=(a,i)=>{
      const t=a.start||a.end?`${a.start?'Fra '+fmtWhen(a.start):''}${a.end?`${a.start?' til ':'Til '}${fmtWhen(a.end)}`:''}`:'';
      const ls=(a.lines||[]).slice(0,6).map(l=>`<span class="badge${mine.has(l)?'':' dim'}">${esc(l)}</span>`).join('');
      return`<article class="alert" style="animation-delay:${Math.min(i,8)*30}ms"><span class="sev ${a.sev}" aria-hidden="true"></span><div>
        ${ls?`<div class="alert-lines">${ls}</div>`:''}<h4>${esc(a.summary)}</h4>${a.desc&&a.desc!==a.summary?`<p>${esc(a.desc)}</p>`:''}${t?`<time>${t}</time>`:''}</div></article>`;};
    const rel=state.alerts.filter(a=>(a.lines||[]).some(l=>mine.has(l))),rest=state.alerts.filter(a=>!rel.includes(a));
    return(rel.length?`<div class="label">Rundt deg</div>${rel.map(item).join('')}`:'')+
      (rest.length?`<div class="label">${rel.length?'Øvrige':'Alle'} i Ruter-området</div>${rest.map((a,i)=>item(a,i+rel.length)).join('')}`:'');
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
      <label class="row-item" for="vehToggle"><span class="lbl"><b>Kjøretøy i sanntid</b><small>GPS der operatøren deler den (tog, flybuss, regionbusser). Ruter deler ikke posisjoner, så deres kjøretøy beregnes fra sanntid og vises med stiplet ring.</small></span>
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
    $('#vehToggle').onchange=e=>{settings.showVehicles=e.target.checked;saveSettings();if(!settings.showVehicles)setData('vehicles',EMPTY);else{refreshVehicles(true);loadEstVehicles(true);}};
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
  // GPS-retning gjelder bare i fart; ellers brukes kompasset.
  const moving=(p.coords.speed||0)>1.2&&p.coords.heading!=null&&!isNaN(p.coords.heading);
  if(moving)state.heading=p.coords.heading;
  if(!meMarker._map)meMarker.setLngLat([lon,lat]).addTo(map);
  else tweenLngLat(meMarker,[lon,lat],700); // glir mellom målingene i stedet for å hoppe
  paintHeading();
  renderAcc();
  if(router.cur.name==='home'){const sub=$('#homeSub');if(sub)sub.textContent=homeSubText();}
  if(firstFix){firstFix=false;setFollow(true);
    if(router.cur.name==='home'||router.cur.name==='search')map.jumpTo({center:[lon,lat],zoom:15.5});}
  else if(state.follow&&router.cur.name!=='trip'&&router.cur.name!=='results')map.easeTo({center:[lon,lat],duration:reduceMotion.matches?0:800});
  if(!state.nearbyAt||geoDist(state.nearbyAt,[lat,lon])>120)loadNearby(lat,lon,true);
}
function paintHeading(){
  meEl.classList.toggle('has-heading',state.heading!=null);
  if(state.heading!=null)meEl.querySelector('.cone').style.transform=`rotate(${state.heading}deg)`;
}
// Kompass: viser hvilken vei du peker når du står stille. iOS krever at brukeren gir lov ved et trykk.
let compassOn=false;
function startCompass(){
  if(compassOn)return;
  const listen=()=>{compassOn=true;
    const on=e=>{const h=e.webkitCompassHeading!=null?e.webkitCompassHeading:(e.absolute&&e.alpha!=null?360-e.alpha:null);
      if(h==null)return;const sc=screen.orientation?.angle||0;state.heading=(h+sc)%360;
      if(!headingRaf)headingRaf=requestAnimationFrame(()=>{headingRaf=0;paintHeading();});};
    addEventListener('ondeviceorientationabsolute' in window?'deviceorientationabsolute':'deviceorientation',on);};
  const D=window.DeviceOrientationEvent;
  if(D&&typeof D.requestPermission==='function')D.requestPermission().then(r=>{if(r==='granted')listen();}).catch(()=>{});
  else if(D)listen();
}
let headingRaf=0;
const homeSubText=()=>`${state.pos?`Rundt deg${state.acc?` · ±${state.acc} m`:''}`:state.nearbyAt?'Rundt kartsenteret':'Henter posisjon…'}${state.updated?` · oppdatert ${fmtT(state.updated)}`:''}`;
function requestGeoOnce(){
  if(!('geolocation' in navigator)){toast('Enheten støtter ikke posisjon.');return;}
  navigator.geolocation.getCurrentPosition(p=>{handlePos(p);startGeo();},
    ()=>toast('Fikk ikke tilgang til posisjon. Sjekk tillatelsene.'),{enableHighAccuracy:true,timeout:15000});
}
function startGeo(){
  if(!('geolocation' in navigator)){geoFallback();return;}
  if(geoWatch!=null)return;
  geoWatch=navigator.geolocation.watchPosition(handlePos,geoFallback,{enableHighAccuracy:true,maximumAge:0,timeout:20000});
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
    refreshVehicles(true);loadEstVehicles(true);tickEst();loadViewDeps(true);
    if(map.getZoom()<12||router.cur.name==='results'||router.cur.name==='trip')return;
    const c=map.getCenter(),b=map.getBounds();
    try{
      // Alle holdeplasser i utsnittet (navn, posisjon, transportmiddel) i én lett forespørsel.
      const d=await gql(`{stopPlacesByBbox(minimumLatitude:${b.getSouth()},minimumLongitude:${b.getWest()},maximumLatitude:${b.getNorth()},maximumLongitude:${b.getEast()}){id name latitude longitude transportMode}}`);
      (d.stopPlacesByBbox||[]).forEach(sp=>{if(!Number.isFinite(sp.latitude))return;
        state.viewStops.set(sp.id,{id:sp.id,name:sp.name,lat:sp.latitude,lon:sp.longitude,modes:sp.transportMode||[]});});
      if(state.viewStops.size>2500)state.viewStops=new Map([...state.viewStops].slice(-1500));
      renderStopsLayer();
      // Uten posisjon følger «I nærheten» kartet.
      if(!state.pos&&(!state.nearbyAt||geoDist(state.nearbyAt,[c.lat,c.lng])>500))loadNearby(c.lat,c.lng);
    }catch(e){}
  },500);
});

/* ---------- Avganger ---------- */
async function fetchStopDeps(id,n=14){
  const d=await gql(Q_DEP,{id,n});
  return parseCalls(d.stopPlace?.estimatedCalls);
}
// Holdeplass-siden: opptil fire avganger per linje og retning den neste timen, så tidslinjen
// også dekker store knutepunkt (Jernbanetorget har over hundre avganger i timen).
const Q_DEP_ALL=Q_DEP.replace('estimatedCalls(numberOfDepartures:$n)','estimatedCalls(numberOfDepartures:$n,numberOfDeparturesPerLineAndDestinationDisplay:4,timeRange:3600)');
function parseCalls(calls){
  const now=Date.now()-60000,seen=new Set(),rows=[];
  (calls||[]).forEach(c=>{
    if(c.forBoarding===false)return;
    const exp=new Date(c.expectedDepartureTime).getTime();
    if(!Number.isFinite(exp)||exp<now)return;
    const line=c.serviceJourney?.journeyPattern?.line||{};
    const dest=c.destinationDisplay?.frontText||'—';
    const key=c.serviceJourney?.id||`${line.publicCode}|${dest}|${c.aimedDepartureTime}`; // samme tur fra flere plattformer
    if(seen.has(key))return;seen.add(key);
    rows.push({dest,pub:line.publicCode||'?',mode:line.transportMode||'bus',exp,aimed:new Date(c.aimedDepartureTime).getTime(),rt:!!c.realtime,quay:c.quay?.publicCode,sj:c.serviceJourney?.id||'',occ:c.occupancyStatus});
  });
  return rows.sort((a,b)=>a.exp-b.exp);
}
async function loadStopDeps(id){
  try{const d=await gql(Q_DEP_ALL,{id,n:150});
    state.deps.set(id,{rows:parseCalls(d.stopPlace?.estimatedCalls),t:Date.now(),name:d.stopPlace?.name});}
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

/* ---------- Kjøretøy med GPS (Enturs kjøretøy-API) ----------
   Henter bare utsnittet du ser på, hvert 10. sek, og lar kjøretøyene gli
   mellom oppdateringene. Ruter deler ikke posisjoner; deres kjøretøy vises
   for valgt reise, beregnet fra sanntid (se LIVE REISE). */
const tagText=(el,name)=>{const n=el&&el.getElementsByTagName(name)[0];return n?n.textContent:'';};
const VEH_MODE={BUS:'bus',TRAM:'tram',METRO:'metro',RAIL:'rail',WATER:'water',FERRY:'water',COACH:'coach'};
let vehBusy=false,vehAt=0,vehPrev=new Map(),vehAnim=0;
const vehiclesWanted=()=>settings.showVehicles&&!document.hidden&&mapLoaded&&map.getZoom()>=11.5&&['home','stop'].includes(router.cur.name);
async function refreshVehicles(force=false){
  if(!vehiclesWanted()){if(mapLoaded&&!['home','stop'].includes(router.cur.name))setData('vehicles',EMPTY);return;}
  if(vehBusy||(!force&&Date.now()-vehAt<9000))return;
  vehBusy=true;vehAt=Date.now();
  try{
    const b=map.getBounds().toArray(),pad=.01;
    const q=`{vehicles(boundingBox:{minLat:${b[0][1]-pad},minLon:${b[0][0]-pad},maxLat:${b[1][1]+pad},maxLon:${b[1][0]+pad}},maxDataAge:"PT3M"){
      vehicleId mode bearing lastUpdatedEpochSecond destinationName location{latitude longitude} line{publicCode} serviceJourney{id}}}`;
    const r=await fetchWithTimeout(VEH_API,{method:'POST',headers:{'Content-Type':'application/json','ET-Client-Name':API.client},body:JSON.stringify({query:q})},12000);
    const list=(await r.json())?.data?.vehicles||[];
    const next=new Map();
    list.forEach(v=>{if(!Number.isFinite(v.location?.latitude))return;
      const mode=VEH_MODE[v.mode]||'other';
      next.set(v.vehicleId,{lon:v.location.longitude,lat:v.location.latitude,bearing:v.bearing||0,mode,line:v.line?.publicCode||'',dest:v.destinationName||'',sj:v.serviceJourney?.id||''});});
    animateVehicles(next);
  }catch(e){}finally{vehBusy=false;}
}
function animateVehicles(next){
  cancelAnimationFrame(vehAnim);
  const from=vehPrev,t0=performance.now(),dur=reduceMotion.matches?0:1200;
  const frame=t=>{
    const k=dur?Math.min(1,(t-t0)/dur):1,e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
    const feats=[];
    next.forEach((v,id)=>{const o=from.get(id);
      const lon=o?o.lon+(v.lon-o.lon)*e:v.lon,lat=o?o.lat+(v.lat-o.lat)*e:v.lat;
      feats.push({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{vid:id,sj:v.sj,mode:v.mode,bearing:v.bearing,line:v.line,dest:v.dest}});});
    gpsFeats=feats;renderVehicleLayer();
    if(k<1)vehAnim=requestAnimationFrame(frame);else vehPrev=next;
  };
  vehAnim=requestAnimationFrame(frame);
}

let gpsFeats=[],estFeats=[];
function renderVehicleLayer(){
  if(!['home','stop'].includes(router.cur.name)||!settings.showVehicles){setData('vehicles',EMPTY);return;}
  setData('vehicles',fc(gpsFeats.concat(estFeats)));
}

/* ---------- Ruter-kjøretøy i utsnittet, beregnet fra sanntid ----------
   Ruter deler ikke GPS. Vi henter turene som skal til holdeplassene du ser
   på, og plasserer hvert kjøretøy langs linjen ut fra faktiske og forventede
   tider ved hvert stopp. Turen hentes én gang (stopp og posisjoner), deretter
   bare tidene hvert 30. sek; linjegeometrien caches per rutemønster. */
const EST_MIN_ZOOM=13.8,EST_MAX=70;
const estJ=new Map(),patterns=new Map();
let estBusy=false,estAt=0,estView=new Set();
const estWanted=()=>vehiclesWanted()&&map.getZoom()>=EST_MIN_ZOOM;
async function gqlBatch(parts){ // flere spørringer i én forespørsel via aliaser
  if(!parts.length)return{};
  return gql('{'+parts.join(' ')+'}');
}
const qid=id=>JSON.stringify(String(id));
async function loadEstVehicles(force=false){
  if(!estWanted()){if(estFeats.length){estFeats=[];renderVehicleLayer();}return;}
  if(estBusy||(!force&&Date.now()-estAt<25000))return;
  estBusy=true;estAt=Date.now();
  try{
    const b=map.getBounds(),pad=.004;
    const d=await gql(`{stopPlacesByBbox(minimumLatitude:${b.getSouth()-pad},minimumLongitude:${b.getWest()-pad},maximumLatitude:${b.getNorth()+pad},maximumLongitude:${b.getEast()+pad}){
      estimatedCalls(timeRange:900,numberOfDepartures:12){destinationDisplay{frontText} serviceJourney{id}}}}`);
    const dest=new Map();
    (d.stopPlacesByBbox||[]).forEach(sp=>(sp.estimatedCalls||[]).forEach(c=>{const id=c.serviceJourney?.id;
      if(id&&id.startsWith('RUT:')&&!dest.has(id))dest.set(id,c.destinationDisplay?.frontText||'');}));
    estView=new Set([...dest.keys()].slice(0,EST_MAX));
    // Nye turer: stopp med posisjon og tider, i bolker på 15.
    const fresh=[...estView].filter(id=>!estJ.has(id));
    for(let i=0;i<fresh.length;i+=15){
      const chunk=fresh.slice(i,i+15);
      const r=await gqlBatch(chunk.map((id,k)=>`s${k}:serviceJourney(id:${qid(id)}){line{publicCode transportMode} journeyPattern{id}
        estimatedCalls{expectedArrivalTime expectedDepartureTime actualArrivalTime actualDepartureTime quay{latitude longitude}}}`));
      chunk.forEach((id,k)=>{const sj=r['s'+k];if(!sj)return;
        estJ.set(id,{id,code:sj.line?.publicCode||'',mode:(sj.line?.transportMode||'bus'),dest:dest.get(id),
          pattern:sj.journeyPattern?.id,calls:sj.estimatedCalls||[],t:Date.now()});});
    }
    // Eksisterende turer: bare oppdaterte tider.
    const stale=[...estView].filter(id=>estJ.has(id)&&Date.now()-estJ.get(id).t>20000);
    for(let i=0;i<stale.length;i+=25){
      const chunk=stale.slice(i,i+25);
      const r=await gqlBatch(chunk.map((id,k)=>`s${k}:serviceJourney(id:${qid(id)}){estimatedCalls{expectedArrivalTime expectedDepartureTime actualArrivalTime actualDepartureTime}}`));
      chunk.forEach((id,k)=>{const j=estJ.get(id),c=r['s'+k]?.estimatedCalls;
        if(j&&c&&c.length===j.calls.length){c.forEach((x,n)=>Object.assign(j.calls[n],x));j.t=Date.now();}});
    }
    // Linjegeometri per rutemønster, hentet én gang.
    // (Enturs API har ikke journeyPattern på toppnivå, så vi går via én tur per mønster.)
    const sample=new Map();
    estView.forEach(id=>{const pt=estJ.get(id)?.pattern;if(pt&&!patterns.has(pt)&&!sample.has(pt))sample.set(pt,id);});
    const pats=[...sample.keys()];
    for(let i=0;i<pats.length;i+=10){
      const chunk=pats.slice(i,i+10);
      const r=await gqlBatch(chunk.map((pt,k)=>`p${k}:serviceJourney(id:${qid(sample.get(pt))}){journeyPattern{pointsOnLink{points}}}`));
      chunk.forEach((id,k)=>{const enc=r['p'+k]?.journeyPattern?.pointsOnLink?.points;
        try{patterns.set(id,enc?decodePoly(enc):null);}catch(e){patterns.set(id,null);}});
    }
    estJ.forEach((j,id)=>{if(!estView.has(id)&&Date.now()-j.t>180000)estJ.delete(id);});
  }catch(e){}finally{estBusy=false;}
  tickEst();
}
function prepEst(j){ // geometri og stoppenes plass langs linjen, beregnet én gang per tur
  if(j.pts)return true;
  let pts=j.pattern&&patterns.get(j.pattern);
  if(pts===undefined)return false;
  if(!pts||pts.length<2)pts=j.calls.filter(c=>c.quay).map(c=>[c.quay.longitude,c.quay.latitude]);
  if(pts.length<2)return false;
  j.pts=pts;j.cum=prepPath(pts);j.stopS=projectStops(pts,j.cum,j.calls);return true;
}
function tickEst(){
  if(!estWanted()){if(estFeats.length){estFeats=[];renderVehicleLayer();}return;}
  const now=Date.now(),b=map.getBounds(),feats=[];
  estView.forEach(id=>{const j=estJ.get(id);if(!j||!prepEst(j))return;
    const e=estimate(j,now);if(!e||e.state==='start'||e.state==='done')return;
    const pt=pointAt(j.pts,j.cum,e.s);if(!b.contains(pt.p))return;
    const mode=MODES[j.mode]?j.mode:'other';
    feats.push({type:'Feature',geometry:{type:'Point',coordinates:pt.p},properties:{vid:id,sj:id,mode,bearing:pt.b,line:j.code,dest:j.dest,est:true}});});
  estFeats=feats;renderVehicleLayer();
}
setInterval(()=>{if(!document.hidden)tickEst();},700);
setInterval(()=>{if(!document.hidden)loadEstVehicles();},30000);

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
      // Hvilke linjer gjelder meldingen? (RUT:Line:70 → «70»)
      const aff=el.getElementsByTagName('Affects')[0];
      const lines=[...new Set([...(aff?aff.getElementsByTagName('LineRef'):[])].map(n=>n.textContent.split(':').pop()))];
      list.push({sev:sevClass(tagText(el,'Severity')),summary,desc:langText(el,'Description'),start,end,lines});
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
      let list=[...unique.values()].sort((a,b)=>score(b)-score(a));
      // Med nok treff i nærheten (60 km) tas fjerne treff (Halden, Lillehammer …) bort, og adresser begrenses til fem.
      const km=f=>geoDist(focus,[f.lat,f.lon])/1000;
      if(list.filter(f=>km(f)<60).length>=3)list=list.filter(f=>km(f)<60);
      let addr=0;list=list.filter(f=>!(f.kind==='Adresse'||f.kind==='Gate')||++addr<=5);
      return list.slice(0,12);
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
    if(ps.length){rememberTarget(state.dest);loadTripCalls();}
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
  setData('route',EMPTY);setData('route-stops',EMPTY);clearPins();stopLive();
}
function drawRoute(p){
  if(!p||!mapLoaded)return;
  if(drawnTrip===p){fitRoute();return;}
  clearRoute();drawnTrip=p;setData('vehicles',EMPTY);
  const legs=[],coords=[];let drawn=0;
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
  rides.forEach((l,i)=>{
    if(i<rides.length-1){const q=l.toPlace?.quay;if(+q?.latitude)addPin(+q.latitude,+q.longitude,`<div class="xfer" style="--c:${modeOf(l.mode).c}">${i+1}</div>`);}
  });
  const start=state.fromSel?[state.fromSel.lat,state.fromSel.lon]:state.pos;
  if(state.fromSel)addPin(state.fromSel.lat,state.fromSel.lon,'<div class="pin from">A</div>');
  if(state.dest)addPin(state.dest.lat,state.dest.lon,'<div class="pin to">B</div>');
  if(start)coords.push([start[1],start[0]]);
  if(state.dest)coords.push([state.dest.lon,state.dest.lat]);
  if(coords.length>=2){
    const b=new maplibregl.LngLatBounds(coords[0],coords[0]);coords.forEach(c=>b.extend(c));routeBounds=b;fitRoute();
  }
  renderRouteStops(p);
  startLive(p);
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
// Holdeplassene langs ruten med sanntidsklokkeslett. Kalles på nytt når tidene oppdateres.
function renderRouteStops(p){
  const stops=[],seen=new Set(),rides=(p.legs||[]).filter(l=>l.mode!=='foot');
  const add=(q,name,time,color,kind,minor)=>{
    const lat=+q?.latitude,lon=+q?.longitude;if(!lat||!lon)return;
    const k=lat.toFixed(5)+lon.toFixed(5);if(seen.has(k))return;seen.add(k);
    stops.push({type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},
      properties:{name:name||'Stopp',time:time||'',clock:time?fmtT(time):'',color,kind,minor}});
  };
  rides.forEach((l,i)=>{
    const c=modeOf(l.mode).c;
    add(l.fromPlace?.quay,l.fromPlace?.name,l.expectedStartTime,c,i?'Bytte':'Påstigning',false);
    (l.intermediateEstimatedCalls||[]).forEach(s=>add(s.quay,s.quay?.name,s.expectedArrivalTime,c,'Stopp underveis',true));
    add(l.toPlace?.quay,l.toPlace?.name,l.expectedEndTime,c,i<rides.length-1?'Bytte':'Avstigning',false);
  });
  setData('route-stops',fc(stops));
}

/* =====================================================================
   LIVE REISE
   For hver etappe hentes hele turen (alle stopp med faktiske/forventede
   tider + geometri). Har operatøren GPS i Enturs kjøretøy-API brukes den;
   ellers (f.eks. Ruter, som ikke deler posisjoner) beregnes posisjonen langs
   linjen fra sanntidstidene, og merkes som beregnet.
   ===================================================================== */
const VEH_API='https://api.entur.io/realtime/v2/vehicles/graphql';
const Q_SJ=`query($id:String!){serviceJourney(id:$id){id pointsOnLink{points}
  estimatedCalls{realtime aimedArrivalTime expectedArrivalTime expectedDepartureTime actualArrivalTime actualDepartureTime aimedDepartureTime
    quay{id name latitude longitude}}}}`;
const Q_SJ_CALLS=`query($id:String!){serviceJourney(id:$id){id
  estimatedCalls{realtime aimedArrivalTime expectedArrivalTime expectedDepartureTime actualArrivalTime actualDepartureTime aimedDepartureTime
    quay{id name latitude longitude}}}}`;
const Q_LEG=`query($id:ID!){leg(id:$id){id expectedStartTime expectedEndTime realtime
  intermediateEstimatedCalls{expectedArrivalTime quay{name latitude longitude}}}}`;
const live={trip:null,jobs:[],timers:[],raf:0,seq:0};
const ts=v=>v?new Date(v).getTime():NaN;
const mPerDeg=lat=>[111320*Math.cos(lat*Math.PI/180),110540];
function prepPath(pts){ // kumulativ avstand i meter langs linjen
  const cum=[0];
  for(let i=1;i<pts.length;i++){const [kx,ky]=mPerDeg(pts[i][1]);
    cum.push(cum[i-1]+Math.hypot((pts[i][0]-pts[i-1][0])*kx,(pts[i][1]-pts[i-1][1])*ky));}
  return cum;
}
function projectStops(pts,cum,calls){ // finn hvert stopp sin plass langs linjen, alltid fremover
  let from=0;
  return calls.map(c=>{
    const q=c.quay;if(!q)return null;
    let best=from,bd=Infinity;
    for(let i=from;i<pts.length;i++){const d=(pts[i][0]-q.longitude)**2+(pts[i][1]-q.latitude)**2;if(d<bd){bd=d;best=i;}}
    from=best;return cum[best];
  });
}
function pointAt(pts,cum,s){
  if(s<=0)return{p:pts[0],b:bearingOf(pts[0],pts[1])};
  const last=cum[cum.length-1];if(s>=last)return{p:pts[pts.length-1],b:bearingOf(pts[pts.length-2],pts[pts.length-1])};
  let i=cum.findIndex(c=>c>=s);i=Math.max(1,i);
  const t=(s-cum[i-1])/((cum[i]-cum[i-1])||1),a=pts[i-1],b=pts[i];
  return{p:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],b:bearingOf(a,b)};
}
function bearingOf(a,b){if(!a||!b)return 0;const [kx,ky]=mPerDeg(a[1]);return(Math.atan2((b[0]-a[0])*kx,(b[1]-a[1])*ky)*180/Math.PI+360)%360;}
const arrT=c=>ts(c.actualArrivalTime)||ts(c.expectedArrivalTime)||ts(c.aimedArrivalTime)||depT(c);
function depT(c){return ts(c.actualDepartureTime)||ts(c.expectedDepartureTime)||ts(c.aimedDepartureTime)||ts(c.actualArrivalTime)||ts(c.expectedArrivalTime);}
// Hvor er kjøretøyet nå, ut fra tidene? Returnerer posisjon og hvilket stopp det sist passerte.
function estimate(job,now=Date.now()){
  const c=job.calls,S=job.stopS;if(!c||c.length<2||!job.pts)return null;
  if(now<depT(c[0]))return{at:0,s:S[0]??0,state:'start'};
  for(let i=0;i<c.length-1;i++){
    const a=arrT(c[i]),d=depT(c[i]),n=arrT(c[i+1]);
    if(now>=a&&now<d)return{at:i,s:S[i],state:'stop'};
    if(now>=d&&now<n){const f=(now-d)/((n-d)||1);return{at:i,s:S[i]+(S[i+1]-S[i])*f,state:'moving'};}
  }
  return{at:c.length-1,s:S[c.length-1],state:'done'};
}
function nearestCallIdx(calls,q,name){
  if(q&&+q.latitude){let best=-1,bd=Infinity;calls.forEach((c,i)=>{if(!c.quay)return;
    const d=(c.quay.latitude-q.latitude)**2+(c.quay.longitude-q.longitude)**2;if(d<bd){bd=d;best=i;}});if(best>=0)return best;}
  return calls.findIndex(c=>c.quay?.name===name);
}
async function fetchVehicleGps(sjId){
  try{
    const r=await fetchWithTimeout(VEH_API,{method:'POST',headers:{'Content-Type':'application/json','ET-Client-Name':API.client},
      body:JSON.stringify({query:`{vehicles(serviceJourneyId:"${sjId.replace(/"/g,'')}",maxDataAge:"PT3M"){location{latitude longitude} bearing lastUpdatedEpochSecond}}`})},10000);
    const v=(await r.json())?.data?.vehicles?.[0];
    return v&&Number.isFinite(v.location?.latitude)?{lat:v.location.latitude,lon:v.location.longitude,bearing:v.bearing||0,t:(v.lastUpdatedEpochSecond||0)*1000}:null;
  }catch(e){return null;}
}
function stopLive(){
  live.seq++;live.trip=null;live.timers.forEach(clearInterval);live.timers=[];cancelAnimationFrame(live.raf);
  live.jobs.forEach(j=>j.marker?.remove());live.jobs=[];live.followVeh=false;setData('approach',EMPTY);
}
async function startLive(p){
  stopLive();live.trip=p;live.fitted=false;const seq=live.seq;
  const rides=(p.legs||[]).filter(l=>l.mode!=='foot'&&l.serviceJourney?.id);
  live.jobs=rides.map(l=>({leg:l,sj:l.serviceJourney.id,color:modeOf(l.mode).c,code:l.line?.publicCode||modeOf(l.mode).n}));
  await Promise.all(live.jobs.map(async j=>{
    try{const d=await gql(Q_SJ,{id:j.sj});const sj=d.serviceJourney;if(!sj)return;
      j.calls=sj.estimatedCalls||[];
      j.pts=sj.pointsOnLink?.points?decodePoly(sj.pointsOnLink.points):j.calls.filter(c=>c.quay).map(c=>[c.quay.longitude,c.quay.latitude]);
      j.cum=prepPath(j.pts);j.stopS=projectStops(j.pts,j.cum,j.calls);
      j.board=nearestCallIdx(j.calls,j.leg.fromPlace?.quay,j.leg.fromPlace?.name);
      j.alight=nearestCallIdx(j.calls,j.leg.toPlace?.quay,j.leg.toPlace?.name);
      j.gps=await fetchVehicleGps(j.sj);
    }catch(e){}
  }));
  if(seq!==live.seq)return;
  // Sanntidstider for turen hvert 20. sek, GPS hvert 10. sek, etappene i reisen hvert 30. sek.
  live.timers.push(setInterval(()=>{if(!document.hidden)live.jobs.forEach(async j=>{
    try{const d=await gql(Q_SJ_CALLS,{id:j.sj});const c=d.serviceJourney?.estimatedCalls;if(c&&c.length===j.calls?.length)j.calls=c;}catch(e){}});},20000));
  live.timers.push(setInterval(()=>{if(!document.hidden)live.jobs.forEach(async j=>{j.gps=await fetchVehicleGps(j.sj);});},10000));
  live.timers.push(setInterval(()=>{if(!document.hidden)refreshLegs(p);},30000));
  tickLive();
}
async function refreshLegs(p){
  const ids=(p.legs||[]).filter(l=>l.id&&l.mode!=='foot');
  let changed=false;
  await Promise.all(ids.map(async l=>{
    try{const d=await gql(Q_LEG,{id:l.id});const n=d.leg;if(!n)return;
      if(n.expectedStartTime!==l.expectedStartTime||n.expectedEndTime!==l.expectedEndTime)changed=true;
      Object.assign(l,{expectedStartTime:n.expectedStartTime,expectedEndTime:n.expectedEndTime,realtime:n.realtime,
        intermediateEstimatedCalls:n.intermediateEstimatedCalls||l.intermediateEstimatedCalls});
    }catch(e){}
  }));
  if(live.trip!==p)return;
  if(changed){const legs=p.legs||[];p.expectedStartTime=legs[0]?.expectedStartTime||p.expectedStartTime;p.expectedEndTime=legs[legs.length-1]?.expectedEndTime||p.expectedEndTime;}
  renderRouteStops(p);
  if(router.cur.name==='trip')router.refresh();
}
function vehicleEl(j){
  const el=document.createElement('button');el.type='button';el.className='tveh';el.style.setProperty('--c',j.color);
  el.innerHTML=`<i class="arrow"></i><span>${esc(j.code)}</span>`;
  el.onclick=e=>{e.stopPropagation();buzz(6);const st=liveText(j);toast(st?st.text:`${modeOf(j.leg.mode).n} ${j.code}`);};
  return el;
}
// Én gang per sekund: flytt kjøretøyene og oppdater statuslinjen.
let lastTick=0;
function tickLive(t=performance.now()){
  if(!live.trip)return;
  live.raf=requestAnimationFrame(tickLive);
  if(t-lastTick<1000)return;lastTick=t;
  const now=Date.now(),approach=[];
  live.jobs.forEach(j=>{
    if(!j.pts||j.pts.length<2)return;
    const e=estimate(j,now);
    const endT=ts(j.leg.expectedEndTime);
    const visible=e&&e.state!=='done'&&now<endT+60000&&now>depT(j.calls[0])-30*60000;
    if(!visible){j.marker?.remove();j.marker=null;return;}
    let lngLat,bearing,gps=false;
    if(j.gps&&now-j.gps.t<120000){lngLat=[j.gps.lon,j.gps.lat];bearing=j.gps.bearing;gps=true;}
    else{const pt=pointAt(j.pts,j.cum,e.s);lngLat=pt.p;bearing=pt.b;}
    if(!j.marker){j.el=vehicleEl(j);j.marker=new maplibregl.Marker({element:j.el,rotationAlignment:'viewport'}).setLngLat(lngLat).addTo(map);
      // Første gang: ta med kjøretøyet i utsnittet hvis det er på vei mot deg utenfor ruten.
      if(!live.fitted&&routeBounds&&!routeBounds.contains(lngLat)&&now<depT(j.calls[j.board]||j.calls[0])){
        live.fitted=true;routeBounds.extend(lngLat);fitRoute();}}
    else tweenLngLat(j.marker,lngLat,900);
    j.el.classList.toggle('est',!gps);j.el.classList.toggle('waiting',e.state==='start');
    j.el.querySelector('.arrow').style.transform=`rotate(${bearing-map.getBearing()}deg)`;
    j.el.title=gps?'GPS-posisjon':'Beregnet fra sanntid';
    j.now={e,lngLat};
    // Strekningen bussen har igjen før holdeplassen din.
    if(j.board>=0&&now<depT(j.calls[j.board])&&e.state!=='done'){
      const s0=gps?e.s:e.s,s1=j.stopS[j.board];
      if(s1>s0){const k0=Math.max(1,j.cum.findIndex(c=>c>=s0)),k1=Math.max(k0,j.cum.findIndex(c=>c>=s1));
        approach.push({type:'Feature',geometry:{type:'LineString',coordinates:[lngLat,...j.pts.slice(k0,k1),pointAt(j.pts,j.cum,s1).p]},properties:{color:j.color}});
        for(let i=e.at+1;i<j.board;i++){const q=j.calls[i]?.quay;if(q)approach.push({type:'Feature',geometry:{type:'Point',coordinates:[q.longitude,q.latitude]},properties:{color:j.color}});}}
    }
  });
  setData('approach',fc(approach));
  if(live.followVeh){const j=live.jobs.find(x=>x.marker);if(j)map.easeTo({center:j.marker.getLngLat(),duration:reduceMotion.matches?0:900,easing:x=>x});}
  updateLiveBox();
}
// Statusboksen bygges én gang og oppdateres på stedet, så ring og spor animeres jevnt.
// Ringen viser minutter til det som skjer neste (bussen går / du går av); sporet viser hvor bussen er.
function updateLiveBox(){
  const box=$('#liveStatus');if(!box)return;
  const st=liveStatus();box.hidden=!st;if(!st){placeRailVehicles();return;}
  if(!box.dataset.built){
    box.dataset.built='1';
    box.innerHTML=`${ringHtml(0,{size:52,win:20})}<div class="ls-main"><div class="ls-cap"><b></b><em class="src"></em></div>
      <div class="lt" hidden><div class="lt-rail"><i class="lt-fill"></i></div><div class="lt-dots"></div><span class="lt-veh"></span></div>
      <div class="lt-ends" hidden><em></em><em></em></div></div>
      <button class="ls-follow press" type="button" aria-pressed="false" aria-label="Følg kjøretøyet på kartet" title="Følg">${ico('locate')}</button>`;
    box.querySelector('.ls-follow').onclick=e=>{e.stopPropagation();buzz(8);
      live.followVeh=!live.followVeh;setFollow(false);
      const j=live.jobs.find(x=>x.marker);if(live.followVeh&&j)map.easeTo({center:j.marker.getLngLat(),zoom:Math.max(map.getZoom(),15.5),duration:reduceMotion.matches?0:700});
      updateLiveBox();};
    box.querySelector('.ls-main').onclick=()=>{const j=live.jobs.find(x=>x.marker);if(!j)return;buzz(6);setFollow(false);
      map.easeTo({center:j.marker.getLngLat(),zoom:Math.max(map.getZoom(),15),duration:reduceMotion.matches?0:700});};
  }
  const now=Date.now();
  // Før du har gått hjemmefra er det avgangstiden din som teller – samme ring som i reiseforslagene.
  const tripStart=router.cur.name==='trip'&&live.trip?ts(live.trip.expectedStartTime):NaN,leaveFirst=now<tripStart&&tripStart<st.until;
  const until=leaveFirst?tripStart:st.until,ringEl=box.querySelector('.ring');
  ringEl.dataset.aria=leaveFirst?'Gå om':st.aria||'';
  setRing(ringEl,(until-now)/60000,fmtT(until));
  box.querySelector('.ls-cap b').innerHTML=st.short;
  const src=box.querySelector('.src');src.textContent=st.gps?'GPS':'≈';src.title=st.gps?'GPS-posisjon fra operatøren':'Beregnet fra sanntid';src.hidden=st.gps==null;
  box.setAttribute('aria-label',`${st.text}. ${st.sub}`.replace(/<[^>]+>/g,''));
  const fb=box.querySelector('.ls-follow');fb.setAttribute('aria-pressed',String(!!live.followVeh));fb.hidden=!live.jobs.some(x=>x.marker);
  placeRailVehicles();
  // Sporet: de siste stoppene fram til holdeplassen din (eller fram til der du skal av).
  const j=live.jobs.find(x=>x.now&&x.calls&&ts(x.leg.expectedEndTime)>now),track=box.querySelector('.lt'),ends=box.querySelector('.lt-ends');
  if(!j||j.board<0){track.hidden=ends.hidden=true;return;}
  const e=j.now.e,before=now<depT(j.calls[j.board]);
  const S=j.stopS,frac=e.state==='moving'?(e.s-S[e.at])/((S[e.at+1]-S[e.at])||1):0;
  const end=before?j.board:Math.max(j.board,j.alight);
  // Sporet starter der bussen er (opptil 8 stopp før), så den alltid står i sporet når den er nær.
  const start=before?Math.max(0,Math.min(end-2,Math.max(end-8,e.state==='start'?0:e.at))):j.board;
  if(end<=start){track.hidden=ends.hidden=true;return;}
  const pos=e.state==='start'?start-0.6:e.at+Math.max(0,Math.min(1,frac));
  const pct=Math.max(-4,Math.min(100,(pos-start)/(end-start)*100));
  track.hidden=ends.hidden=false;track.style.setProperty('--c',j.color);
  const n=end-start,dots=box.querySelector('.lt-dots');
  if(dots.dataset.key!==`${start}-${end}`){dots.dataset.key=`${start}-${end}`;
    dots.innerHTML=Array.from({length:n+1},(_,i)=>`<i style="left:${i/n*100}%" class="${i===n?'end':''}"></i>`).join('');}
  [...dots.children].forEach((d,i)=>d.classList.toggle('on',start+i<=e.at&&e.state!=='start'));
  track.querySelector('.lt-fill').style.width=Math.max(0,pct)+'%';
  const v=track.querySelector('.lt-veh');v.textContent=j.code;v.style.left=pct+'%';v.classList.toggle('far',pos<start);
  const [a,b]=ends.children;
  a.textContent=e.state==='start'?(j.calls[0]?.quay?.name||''):(j.calls[Math.max(start,Math.min(end,e.at))]?.quay?.name||'');
  b.textContent=j.calls[end]?.quay?.name||'';
}
// Reisesiden: kjøretøyet glir langs skinnen til etappen du sitter på; fullførte etapper tones ned.
function placeRailVehicles(){
  const p=live.trip;if(router.cur.name!=='trip'||!p)return;
  const now=Date.now();
  $$('#sheetPage .leg[data-li]').forEach(el=>{
    const l=p.legs[+el.dataset.li];if(!l)return;
    el.classList.toggle('done',ts(l.expectedEndTime)<now);
    const v=el.querySelector('.rveh');if(!v)return;
    const j=live.jobs.find(x=>x.leg===l);
    if(!j?.now||!j.calls||j.board<0||j.alight<=j.board){v.hidden=true;return;}
    const e=j.now.e,S=j.stopS,frac=e.state==='moving'?(e.s-S[e.at])/((S[e.at+1]-S[e.at])||1):0,pos=e.at+frac;
    const onboard=now>=depT(j.calls[j.board])&&now<arrT(j.calls[j.alight]);
    v.hidden=!onboard;el.classList.toggle('riding',onboard);if(!onboard)return;
    v.style.setProperty('--k',String(Math.max(0,Math.min(1,(pos-j.board)/(j.alight-j.board)))));
  });
}
function tweenLngLat(m,to,dur){
  const from=m.getLngLat();if(reduceMotion.matches||Math.abs(from.lng-to[0])+Math.abs(from.lat-to[1])>0.05){m.setLngLat(to);return;}
  const t0=performance.now();
  const step=t=>{const k=Math.min(1,(t-t0)/dur);m.setLngLat([from.lng+(to[0]-from.lng)*k,from.lat+(to[1]-from.lat)*k]);if(k<1)requestAnimationFrame(step);};
  requestAnimationFrame(step);
}
// Status for ett kjøretøy: lang tekst (skjermleser, varsel) og kort tekst + tidspunkt til ringen.
function liveText(j,now=Date.now()){
  const c=j.calls;if(!c||j.board<0)return null;
  const e=estimate(j,now);if(!e)return null;
  const gps=!!(j.gps&&now-j.gps.t<120000),name=`${modeOf(j.leg.mode).n} ${j.code}`,src=gps?'GPS':'beregnet fra sanntid';
  const out=(text,sub,short,until,aria)=>({text,sub,short,until,aria,gps});
  if(j.leg.noStop){ // tur åpnet fra et kjøretøy uten holdeplass i nærheten
    if(e.state==='done')return null;const nx=c[Math.min(c.length-1,e.at+(e.state==='start'?0:1))],end=c[c.length-1];
    return e.state==='start'?out(`${name} starter kl. ${fmtT(depT(c[0]))}`,src,'Har ikke startet',depT(c[0]),'Starter om'):
      out(`Neste stopp: ${esc(nx?.quay?.name||'')}`,`Fremme ved ${esc(end?.quay?.name||'')} kl. ${fmtT(arrT(end))} · ${src}`,`Neste: ${esc(nx?.quay?.name||'')}`,arrT(end),'Endestopp om');
  }
  const boardName=c[j.board]?.quay?.name||j.leg.fromPlace?.name,alightName=c[j.alight]?.quay?.name||j.leg.toPlace?.name;
  const dep=depT(c[j.board]),arr=arrT(c[Math.max(0,j.alight)]);
  if(now<dep){
    const away=j.board-e.at-(e.state==='moving'?1:0);
    const m=Math.max(0,Math.round((dep-now)/60000));
    const where=e.state==='start'?`starter fra ${esc(c[0].quay?.name||'')} kl. ${fmtT(depT(c[0]))}`:
      away<=0?`er ved ${esc(boardName)}`:`er ${away} ${plural(away,'stopp','stopp')} unna ${esc(boardName)}`;
    const short=e.state==='start'?'Har ikke startet':away<=0?'Ved holdeplassen':`${away} ${plural(away,'stopp','stopp')} unna`;
    return out(`${name} ${where}`,`Går kl. ${fmtT(dep)}${m?` · om ${m} min`:' · nå'} · ${src}`,short,dep,'Går om');
  }
  if(j.leg.journey){ // enkelttur: etter holdeplassen din er det ingen «gå av»
    const nx=c[Math.min(c.length-1,e.at+1)],end=c[c.length-1];
    if(e.state==='done')return out(`${name} er fremme ved ${esc(end?.quay?.name||'')}`,src,'Fremme',now,'');
    return out(`${name} har passert ${esc(boardName)}`,`Neste stopp: ${esc(nx?.quay?.name||'')} · Endestopp ${esc(end?.quay?.name||'')} kl. ${fmtT(arrT(end))} · ${src}`,
      `Neste: ${esc(nx?.quay?.name||'')}`,arrT(end),'Endestopp om');
  }
  if(now<arr){
    const next=c[Math.min(c.length-1,e.at+1)]?.quay?.name,left=Math.max(0,j.alight-e.at);
    return out(`Neste stopp: ${esc(next||'')}`,`Gå av ved ${esc(alightName)} kl. ${fmtT(arr)} · ${left} ${plural(left,'stopp','stopp')} igjen · ${src}`,
      `Neste: ${esc(next||'')}`,arr,'Gå av om');
  }
  return null;
}
function liveStatus(){
  const now=Date.now();
  for(const j of live.jobs){if(ts(j.leg.expectedEndTime)>now){const s=liveText(j,now);if(s)return s;}}
  const p=live.trip;if(p&&ts(p.expectedEndTime)<now)return{text:'Du skal være fremme',sub:`Ankomst kl. ${fmtT(p.expectedEndTime)}`,short:'Fremme',until:now,aria:''};
  return null;
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
},REFRESH_MS);
setInterval(()=>refreshVehicles(),10000);
setInterval(()=>{if(!document.hidden&&['home','stop','results','journey'].includes(router.cur.name))router.refresh();},20000);
// Avgangskortene: nye tider hvert 30. sek, og minuttene telles ned hvert 20. sek.
setInterval(()=>{if(!document.hidden)loadViewDeps();},30000);
setInterval(()=>{if(!document.hidden&&router.cur.name==='results')loadTripCalls();},30000);
setInterval(()=>{if(!document.hidden&&mapLoaded&&map.getZoom()>=CARD_ZOOM-0.5)renderStopsLayer();},20000);
setInterval(()=>{if(!document.hidden)loadAlerts();},180000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){loadAlerts();loadDeps(true);refreshVehicles(true);}});

/* ---------- Velkomst og oppstart ---------- */
function hideOnboard(){
  try{localStorage.setItem('reisOnboarded','1');}catch(e){}
  const ob=$('#onboard');ob.classList.add('leaving');
  setTimeout(()=>{ob.hidden=true;ob.classList.remove('leaving');},reduceMotion.matches?0:420);
}
$('#obAllow').onclick=()=>{buzz(10);hideOnboard();startGeo();startCompass();};
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
