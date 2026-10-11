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
  client:'kkas18-reis' // ET-Client-Name: «eier-app», så Entur vet hvem som ringer og kan si fra ved endringer
};
// Fargene fra Oslo-trafikken: rød buss, blå trikk, oransje T-bane, lilla tog. Teksten på fargen (o)
// er hvit, bortsett fra på T-banens lyse oransje, der mørk tekst gir best kontrast (WCAG AA).
// i: piktogrammet for transportmiddelet (symbolene i-m-* i index.html).
const MODES={
  bus:{n:'Buss',c:'#C3302A',i:'bus'}, tram:{n:'Trikk',c:'#1F5CB8',i:'tram'}, metro:{n:'T-bane',c:'#EC700C',o:'#14191C',i:'metro'},
  rail:{n:'Tog',c:'#5845A6',i:'rail'}, water:{n:'Båt',c:'#08737D',i:'water'}, coach:{n:'Ekspress',c:'#8E2F57',i:'bus'},
  funicular:{n:'Bane',c:'#5D676C',i:'rail'}, cableway:{n:'Bane',c:'#5D676C',i:'rail'}, air:{n:'Fly',c:'#5D676C',i:'bus'}
};
// Navnet oversettes når det vises; nøkkelen (bus, tram …) er den samme på alle språk.
const modeOf=m=>{const x=MODES[m]||{n:'Kollektiv',c:'#5D676C',i:'bus'};return{n:tr(x.n),c:x.c,o:x.o||'#fff',i:x.i};};
// Fargen og tekstfargen som CSS-variabler, for style-attributter: --c (flaten) og --o (teksten).
const modeStyle=m=>{const x=modeOf(m);return`--c:${x.c};--o:${x.o}`;};
const modeIcon=(m,cls='')=>ico('m-'+modeOf(m).i,cls);
const OSLO=[59.9139,10.7522];
const REFRESH_MS=30000;

/* ---------- Lagring ---------- */
function loadJSON(k,f){try{const v=JSON.parse(localStorage.getItem(k));return v??f;}catch(e){return f;}}
function saveJSON(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){/* lagring kan være slått av (privat modus) */}}
let settings=Object.assign({theme:'auto',lang:'auto',walkKmh:4.5,showVehicles:true,vibrate:true,basemap:'map',stepFree:false,fewerChanges:false},loadJSON('reisSettings',{}));
coreCfg.walkKmh=settings.walkKmh;
// Språk: «Auto» følger telefonen. Settes før noe tegnes.
const resolveLang=()=>settings.lang==='auto'?detectLang(navigator.languages?.length?navigator.languages:[navigator.language||'nb']):settings.lang;
setLang(resolveLang());document.documentElement.lang=I18N.lang;
const geoLang=()=>I18N.lang==='en'?'en':'no'; // språket Enturs stedssøk svarer på
// Fast tekst i index.html: data-t oversetter innholdet, data-t-attr de nevnte attributtene. Den norske
// originalen huskes, så språket kan byttes fram og tilbake uten omstart.
const staticSrc=new WeakMap();
function translateStatic(){
  $$('[data-t],[data-t-attr]').forEach(el=>{
    let src=staticSrc.get(el);
    if(!src){src={html:el.hasAttribute('data-t')?el.innerHTML.trim():null,attrs:{}};
      (el.dataset.tAttr||'').split(',').filter(Boolean).forEach(a=>{src.attrs[a]=el.getAttribute(a);});staticSrc.set(el,src);}
    if(src.html!=null)el.innerHTML=tr(src.html);
    Object.entries(src.attrs).forEach(([a,v])=>el.setAttribute(a,tr(v)));
  });
  document.title=tr('REIS – kollektiv i Oslo');
}
translateStatic();
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
  diag.errors.unshift({t:Date.now(),where,msg:String(e?.message||e||tr('ukjent feil')).slice(0,240)});
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
// Myk oppbremsing for kartbevegelser, samme kurve som arket.
const easeOut=t=>1-Math.pow(1-t,3);
const distTo=s=>state.pos?Math.round(geoDist(state.pos,[s.lat,s.lon])):null;

/* ---------- Nettstatus ---------- */
function setNetworkState(ok,reason=''){
  const chip=$('#netChip');chip.hidden=!!ok;
  if(!ok)chip.textContent=reason||tr('Reisedata utilgjengelig');
}
if(location.protocol==='file:')$('#setupNotice').hidden=false;
if(!navigator.onLine)setNetworkState(false,tr('Frakoblet'));
addEventListener('offline',()=>setNetworkState(false,tr('Frakoblet')));
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
  else toast(tr('Åpne nettlesermenyen og velg «Legg til på startskjermen».'));
}

/* ---------- GraphQL ---------- */
// Driftsdøgn: en tur som startet før midnatt, hører til gårsdagens dato hos Entur, og uten riktig
// dato svarer serviceJourney uten stopp. Kjenner vi ikke datoen, prøves i dag og så i går.
const osloDate=(t=Date.now())=>new Date(t).toLocaleDateString('sv-SE',{timeZone:'Europe/Oslo'});
async function sjQuery(query,id,date=null){
  let d=await gql(query,{id,date});
  if(!date&&!d.serviceJourney?.estimatedCalls?.length){
    const y=osloDate(Date.now()-864e5),dy=await gql(query,{id,date:y});
    if(dy.serviceJourney?.estimatedCalls?.length)return{...dy,date:y};
  }
  return{...d,date};
}
async function gql(query,variables={}){
  try{
    const r=await fetchWithTimeout(API.jp,{method:'POST',
      headers:{'Content-Type':'application/json','ET-Client-Name':API.client},
      body:JSON.stringify({query,variables})},20000);
    if(!r.ok)throw new Error(r.status===429?tr('For mange forespørsler mot Entur. Vent litt.'):tr('Entur svarte {s}',{s:r.status}));
    const j=await r.json();
    if(j.errors&&j.errors.length)throw new Error(j.errors[0].message);
    setNetworkState(true);
    return j.data;
  }catch(e){
    if(e.name==='AbortError'||e instanceof TypeError||!navigator.onLine)
      setNetworkState(false,navigator.onLine?tr('Entur svarer ikke'):tr('Frakoblet'));
    throw e;
  }
}
const Q_DEP=`query($id:String!,$n:Int!){stopPlace(id:$id){id name latitude longitude
  estimatedCalls(numberOfDepartures:$n){
    date realtime aimedDepartureTime expectedDepartureTime forBoarding occupancyStatus
    destinationDisplay{frontText}
    quay{publicCode}
    serviceJourney{id journeyPattern{line{publicCode transportMode}}}}}}`;
const Q_AUTO=`query($q:String!){autocomplete(queryText:$q,layers:[stopPlace],size:8){id name locality layer latitude longitude}}`;
// Reisevalg som gjelder alle søk, også snarveiene Hjem og Jobb: gangfarten din, trinnfri gange
// (Entur tar foreløpig bare hensyn til det på gangveien) og færre bytter. Det siste gir et lite
// tillegg per bytte hos Entur; i tillegg sorteres reiser med færrest bytter først (data.js).
const tripPrefs=()=>({walk:+(settings.walkKmh/3.6).toFixed(2),wheel:!!settings.stepFree,xfer:settings.fewerChanges?600:0});
const TRIP_ARGS='$walk:Float!,$wheel:Boolean!,$xfer:Int!',TRIP_OPTS='walkSpeed:$walk,wheelchairAccessible:$wheel,transferPenalty:$xfer';
// Entur endrer av og til skjemaet: start med full detalj og fall tilbake ved valideringsfeil – aldri ved nettfeil.
const Q_TRIP=level=>`query($fl:Float!,$fp:Float!,$tl:Float!,$tp:Float!,$dt:DateTime,$arr:Boolean,$n:Int!,${TRIP_ARGS}){
  trip(from:{coordinates:{latitude:$fl,longitude:$fp}},to:{coordinates:{latitude:$tl,longitude:$tp}},
       numTripPatterns:$n,dateTime:$dt,arriveBy:$arr,${TRIP_OPTS}){
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
