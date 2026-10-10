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
function saveJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){/* lagring kan være slått av (privat modus) */}}
let settings=Object.assign({theme:'auto',walkKmh:4.5,showVehicles:true,vibrate:true,basemap:'map'},loadJSON('reisSettings',{}));
coreCfg.walkKmh=settings.walkKmh;
const asArray=v=>Array.isArray(v)?v:[];
let favs=asArray(loadJSON('reisFavs',[]));
let recentTargets=asArray(loadJSON('reisRecentTargets',[]));
// Faste steder for reiser med ett trykk.
const PLACE_KINDS={home:{n:'Hjem',icon:'home'},work:{n:'Jobb',icon:'work'}};
let places=(v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{})(loadJSON('reisPlaces',{}));
const savePlaces=()=>saveJSON('reisPlaces',places);
const saveSettings=()=>saveJSON('reisSettings',settings);

const state={pos:null,acc:0,heading:null,follow:false,nearbyAt:null,nearby:[],viewStops:new Map(),
  deps:new Map(),fromSel:null,dest:null,timeMode:'now',time:'',trips:[],tripIdx:0,alerts:[],updated:null};

/* ---------- Feil ----------
   Feil appen tåler (nettbrudd, et kall som feiler) svelges ikke stille: de samles her, skrives i
   konsollen og vises under Innstillinger → Diagnostikk, så de kan meldes inn og feilsøkes. */
const diag={errors:[],count:0,calls:[]};
function report(where,e){
  if(e?.name==='AbortError')return; // tidsavbrudd vi selv har satt; vises som nettstatus
  if(!navigator.onLine&&e instanceof TypeError)return; // frakoblet: vises som «Frakoblet», ikke som feil
  diag.count++;
  diag.errors.unshift({t:Date.now(),where,msg:String(e?.message||e||'ukjent feil').slice(0,240)});
  if(diag.errors.length>25)diag.errors.length=25;
  console.warn(`[REIS] ${where}:`,e);
}
addEventListener('error',e=>report('skript',e.error||e.message));
addEventListener('unhandledrejection',e=>report('async',e.reason));

/* ---------- Hjelpere ---------- */
function buzz(ms){if(settings.vibrate&&navigator.vibrate)navigator.vibrate(ms);}
let toastTimer=null;
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2800);}
// Skjermleser: bare det som er verdt å avbryte for (gå nå, gå av), ikke hver oppdatering.
let srTimer=null;
function announce(msg){const el=$('#srLive');if(!el)return;el.textContent='';clearTimeout(srTimer);srTimer=setTimeout(()=>{el.textContent=msg;},60);}
async function fetchWithTimeout(url,opts={},ms=15000){
  const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);
  const now=Date.now();diag.calls.push(now);if(diag.calls[0]<now-3600000)diag.calls=diag.calls.filter(x=>x>now-3600000);
  try{return await fetch(url,{...opts,signal:c.signal});}finally{clearTimeout(t);}
}
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
const Q_DEP=`query($id:String!,$n:Int!){stopPlace(id:$id){id name latitude longitude
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
