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

/* ---------- Bekreftelse ----------
   Én brikke øverst på skjermen, over kartet, så den ikke dekker arket (på Hjem under søkefeltet): ikon, kort
   tittel, ev. en undertekst og en handling (Angre). Den står lenge nok til å bli lest (etter lengden,
   og lenger med en handling), står stille mens du holder eller peker på den, og forsvinner når du
   trykker på den eller sveiper den oppover.
   tone: ok (grønn hake), warn (gul), go (signalgul, «Gå nå») eller info (ikonet for det som skjedde). */
const TONE_ICON={ok:'check',warn:'alert',go:'walk',info:'info'};
const toastState={timer:0,left:0,at:0,y0:null,dy:0,moved:0};
function notify({title,sub='',icon='',tone='info',action=null}){
  const t=$('#toast'),ic=icon||TONE_ICON[tone]||'info';
  t.className=`toast tone-${tone}`;
  t.innerHTML=`<span class="t-ico">${ico(ic,ic==='check'?'draw':'')}</span><span class="t-txt"><b>${esc(title)}</b>${sub?`<small>${esc(sub)}</small>`:''}</span>`+
    (action?`<button class="t-act press" type="button">${esc(action.label||tr('Angre'))}</button>`:'');
  // Etter Angre med tastaturet går fokus til sidetittelen, ikke tilbake til toppen av dokumentet.
  if(action)$('.t-act',t).onclick=e=>{e.stopPropagation();buzz(6);const kb=document.activeElement===e.currentTarget;hideToast();action.run();
    if(kb)$('#sheetHead .head-title')?.focus({preventScroll:true});};
  t.style.transform='';void t.offsetWidth;t.classList.add('show');
  toastState.left=Math.min(7000,Math.max(action?5000:2600,1400+(title.length+sub.length)*55));
  runToast();
}
function runToast(){clearTimeout(toastState.timer);toastState.at=Date.now();toastState.timer=setTimeout(hideToast,toastState.left);}
function pauseToast(){clearTimeout(toastState.timer);toastState.left=Math.max(1500,toastState.left-(Date.now()-toastState.at));}
function hideToast(){
  clearTimeout(toastState.timer);const t=$('#toast');t.classList.remove('show','drag');t.style.transform='';
  // Handlingen fjernes når brikken er borte, så den ikke kan nås med tastaturet.
  setTimeout(()=>{if(!t.classList.contains('show'))$('.t-act',t)?.remove();},320);
}
{
  const t=$('#toast'),shown=()=>t.classList.contains('show');
  t.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'&&shown())pauseToast();});
  t.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&shown())runToast();});
  t.addEventListener('focusin',()=>{if(shown())pauseToast();});
  t.addEventListener('focusout',()=>{if(shown())runToast();});
  // Hold for å lese; trykk eller sveip opp for å fjerne.
  t.addEventListener('pointerdown',e=>{if(e.target.closest('.t-act')||!shown())return;
    toastState.y0=e.clientY;toastState.dy=0;toastState.moved=0;pauseToast();t.classList.add('drag');t.setPointerCapture?.(e.pointerId);});
  t.addEventListener('pointermove',e=>{if(toastState.y0==null)return;const d=e.clientY-toastState.y0;
    toastState.moved=Math.max(toastState.moved,Math.abs(d));toastState.dy=Math.min(0,d);t.style.transform=`translate(-50%,${toastState.dy}px)`;});
  const up=e=>{if(toastState.y0==null)return;toastState.y0=null;t.classList.remove('drag');
    if(toastState.dy<-24||(e.type==='pointerup'&&toastState.moved<6))hideToast();else{t.style.transform='';runToast();}};
  t.addEventListener('pointerup',up);t.addEventListener('pointercancel',up);
}
// Segmentvalg: marker knappen og la markøren gli dit (--i er plassen til valgt knapp).
function segPick(seg,btn){const bs=[...seg.children];bs.forEach(x=>x.setAttribute('aria-pressed',String(x===btn)));seg.style.setProperty('--i',bs.indexOf(btn));}
// To ikoner i ett: det andre tar over når knappen er på (aria-pressed) eller ferdig (.done).
const morphIco=(a,b)=>`<span class="morph" aria-hidden="true">${ico(a,'ma')}${ico(b,'mb')}</span>`;
// Knappen bekrefter selv: hake og ev. en kort tekst (i .lab) i to sekunder, så tilbake.
function flashDone(btn,label=''){
  if(!btn)return;const lab=$('.lab',btn);
  if(lab&&label&&btn.dataset.lab==null)btn.dataset.lab=lab.textContent;
  clearTimeout(btn._done);btn.classList.add('done');if(lab&&label)lab.textContent=label;
  btn._done=setTimeout(()=>{btn.classList.remove('done');
    if(lab&&btn.dataset.lab!=null){lab.textContent=btn.dataset.lab;delete btn.dataset.lab;}},2000);
}
// «Her havnet det»: det du nettopp lagret, lyser kort opp der det havnet, neste gang det vises
// (innen et minutt). Tegnes siden på nytt mens det lyser, fortsetter lyset der det var.
const LANDED_MS=1800;
let landing=null;
function markLanded(sel){landing={sel,t:Date.now(),at:0};}
function showLanded(root=document){
  if(!landing)return;const now=Date.now();
  if(!landing.at&&now-landing.t>60000){landing=null;return;}
  const el=$(landing.sel,root);if(!el)return;
  if(!landing.at)landing.at=now;
  const gone=now-landing.at;if(gone>=LANDED_MS){landing=null;return;}
  el.style.animationDelay=`-${gone}ms`;el.classList.add('landed');
  el.addEventListener('animationend',()=>{el.classList.remove('landed');el.style.animationDelay='';},{once:true});
}
// Myk overgang for endringer som gjelder hele skjermen (tema): krysstoning der nettleseren kan det.
function crossfade(fn){
  if(!document.startViewTransition||reduceMotion.matches||document.hidden){fn();return;}
  const html=document.documentElement;html.classList.add('vt-fade');
  document.startViewTransition(fn).finished.finally(()=>html.classList.remove('vt-fade'));
}
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
mqDark.addEventListener('change',()=>{if(settings.theme==='auto'){crossfade(paintTheme);if(router.cur.name==='settings')router.refresh();}});

/* ---------- PWA ---------- */
if(!window.REIS_ANDROID&&'serviceWorker' in navigator&&location.protocol!=='file:')
  addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
let deferredPrompt=null;
addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;});
const canInstall=()=>!window.REIS_ANDROID&&!matchMedia('(display-mode: standalone)').matches;
async function doInstall(){
  buzz(10);
  if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice.catch(()=>{});deferredPrompt=null;}
  else notify({title:tr('Legg til på hjemskjermen'),sub:tr('Åpne nettlesermenyen og velg «Legg til på startskjermen».'),icon:'download'});
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
