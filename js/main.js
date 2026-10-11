'use strict';
/* REIS – Oppdateringsrytme og oppstart. Lastes sist. */

/* ---------- Oppdatering ----------
   Én rytme for alt som hentes i bakgrunnen. Ingenting hentes mens appen ikke vises. Har ingen
   rørt skjermen på fem minutter (telefonen ligger på bordet), går appen i sparemodus og henter
   tre ganger sjeldnere; første berøring henter alt på nytt med en gang. Nedtellingen på skjermen
   regnes lokalt og bremses aldri, og en reise du følger (live.js) har sin egen rytme. */
const IDLE_MS=300000;
let lastInput=Date.now();
const isIdle=()=>Date.now()-lastInput>IDLE_MS;
function every(ms,fn,{eco=true}={}){
  let n=0;
  return setInterval(()=>{if(document.hidden)return;n++;if(eco&&isIdle()&&n%3)return;fn();},ms);
}
function refreshAll(){
  if(state.pos)loadNearby(...state.pos);else if(state.nearbyAt)loadNearby(...state.nearbyAt);
  loadAlerts();
}
function refreshNow(){loadAlerts();loadDeps(true);refreshVehicles(true);loadEstVehicles(true);}
// I sparemodus står pulsene stille: en animasjon som aldri slutter, holder skjermen i arbeid hele tiden.
const setIdle=on=>document.body.classList.toggle('idle',on);
['pointerdown','keydown','wheel'].forEach(t=>addEventListener(t,()=>{const wasIdle=isIdle();lastInput=Date.now();if(wasIdle){setIdle(false);refreshNow();}},{passive:true,capture:true}));
setInterval(()=>setIdle(isIdle()),15000);

/* ---------- Kartet hviler når arket dekker det ----------
   Med arket helt oppe (mobil) ser du ikke kartet: kjøretøy, beregnede posisjoner og avgangskort
   oppdateres ikke, og pulsene på kartet står stille. Når arket går ned, hentes det som er gammelt. */
function setMapCovered(){
  const on=sheetUI.full&&!wide.matches,was=mapCovered();
  document.body.classList.toggle('map-covered',on);
  if(was&&!on){refreshVehicles();loadEstVehicles();tickEst();loadViewDeps();if(cardMode)renderStopsLayer();}
}
sheetUI.onFull=()=>{setMapCovered();ptrArm();};

every(REFRESH_MS,()=>{
  const n=router.cur.name;
  if(n==='home')loadDeps();
  if(n==='stop'){const id=router.cur.params.id;loadStopDeps(id,true).then(()=>{if(router.cur.name==='stop'&&router.cur.params.id===id)router.refresh();});}
});
every(15000,()=>refreshVehicles());
// Beregnede kjøretøy glir langs linjen (hvert 0,7 sek; i sparemodus hvert 2,1 sek).
every(700,tickEst);
every(30000,()=>loadEstVehicles());
// Avgangskortene på kartet får nye tider hvert 30. sek; minuttene telles ned lokalt hvert 20. sek.
every(30000,()=>loadViewDeps());
every(30000,()=>{if(router.cur.name==='results')loadTripCalls();});
every(180000,()=>loadAlerts());
every(60000,()=>{if(router.cur.name==='home')loadShortcuts();});
every(20000,()=>{if(['home','stop','results','journey'].includes(router.cur.name))router.refresh();},{eco:false});
every(20000,()=>{if(mapLoaded&&!mapCovered()&&map.getZoom()>=CARD_ZOOM-0.5)renderStopsLayer();},{eco:false});
// Nedtellingsringene tømmes jevnt: hvert sekund får ringer med kjent tidspunkt ny fyllgrad.
// Live-boksen har sin egen oppdatering i live.js.
function tickRings(){
  const now=Date.now();
  $$('#sheetPage .ring[data-until]').forEach(r=>{const u=+r.dataset.until;setRing(r,(u-now)/60000,fmtT(u));});
}
every(1000,tickRings,{eco:false});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshNow();});

/* ---------- Dra for å oppdatere (Hjem) ----------
   Når arket er helt oppe og listen står øverst, kan du dra ned for å hente nye avganger. En liten
   buss kjører langs veien i takt med fingeren, og kjører over mens dataene hentes. Oppdater-knappen
   bruker samme visning. Halvt eller lavt ark dras som før. */
const ptr={el:$('#ptr'),y0:null,pull:0,busy:false};
const PTR_MAX=88,PTR_GO=64;
function ptrShow(px,state){
  ptr.el.style.height=px+'px';ptr.el.style.setProperty('--p',Math.min(1,px/PTR_GO).toFixed(3));
  ptr.el.className='ptr'+(state?' '+state:'');
}
async function refreshHome(){
  if(ptr.busy)return;ptr.busy=true;ptrArm();buzz(10);
  ptrShow(46,'busy');
  try{await Promise.all([loadDeps(true),loadAlerts(),loadShortcuts(true)]);}catch(e){report('oppdater Hjem',e);}
  ptr.busy=false;ptrShow(0,'');ptrArm();
}
// Lytteren som kan stoppe rullingen (touchmove med preventDefault), er bare på når dra-for-oppdatering
// faktisk kan starte: Hjem, fullt ark og listen helt øverst. Ellers ruller listen uten å vente på skriptet.
const ptrCan=()=>!ptr.busy&&router.cur.name==='home'&&sheet.classList.contains('full')&&sheetScroll.scrollTop<=0;
function ptrMove(e){
  if(ptr.y0==null)return;
  const dy=e.touches[0].clientY-ptr.y0;
  if(dy<=0||sheetScroll.scrollTop>0){ptr.y0=null;ptrShow(0,'');return;}
  e.preventDefault();ptr.pull=Math.min(PTR_MAX,dy*.5);ptrShow(ptr.pull,'pulling');
}
let ptrArmed=false;
function ptrArm(){
  const on=ptrCan();if(on===ptrArmed)return;ptrArmed=on;
  if(on)sheetScroll.addEventListener('touchmove',ptrMove,{passive:false});
  else sheetScroll.removeEventListener('touchmove',ptrMove,{passive:false});
}
sheetScroll.addEventListener('scroll',ptrArm,{passive:true});
router.onShow=ptrArm;
sheetScroll.addEventListener('touchstart',e=>{
  if(!ptrCan())return;
  ptr.y0=e.touches[0].clientY;ptr.pull=0;
},{passive:true});
const ptrEnd=()=>{
  if(ptr.y0==null)return;ptr.y0=null;
  if(ptr.pull>=PTR_GO)refreshHome();else ptrShow(0,'');
};
sheetScroll.addEventListener('touchend',ptrEnd);
sheetScroll.addEventListener('touchcancel',ptrEnd);

/* ---------- Språkbytte ----------
   Uten omstart: fast tekst, kartets egne tekster, markørene, siden du står på, avgangskortene på
   kartet (språket er med i nøkkelen) og trafikkmeldingene, som hentes på nytt på valgt språk. */
function applyLang(){
  setLang(resolveLang());document.documentElement.lang=I18N.lang;
  translateStatic();
  if(map._locale)Object.assign(map._locale,mapUiStrings()); // MapLibre har ikke et offentlig API for å bytte språk
  map.getCanvas()?.setAttribute('aria-label',tr('Kart'));
  if(meMarker._map)nameMarker(meMarker,tr('Din posisjon'));
  $('#layerBtn').setAttribute('aria-label',isSat()?tr('Vis kart'):tr('Vis satellitt'));
  if(!$('#netChip').hidden)setNetworkState(false,navigator.onLine?tr('Entur svarer ikke'):tr('Frakoblet'));
  shortcuts.clear();loadShortcuts(true);loadAlerts();
  router.render(null);renderStopsLayer();
}

/* ---------- Velkomst og oppstart ---------- */
function hideOnboard(){
  try{localStorage.setItem('reisOnboarded','1');}catch(e){/* lagring kan være slått av (privat modus) */}
  const ob=$('#onboard');ob.classList.add('leaving');
  setTimeout(()=>{ob.hidden=true;ob.classList.remove('leaving');},reduceMotion.matches?0:420);
}
$('#obAllow').onclick=()=>{buzz(10);hideOnboard();startGeo();startCompass();};
$('#obSkip').onclick=()=>{buzz(6);hideOnboard();loadNearby(OSLO[0],OSLO[1]);};
if(reduceMotion.matches)$('.network .train')?.remove();

paintTheme();
router.show('home',{},'init'); // første visning: kortene kommer etter hverandre
const onboarded=(()=>{try{return!!localStorage.getItem('reisOnboarded');}catch(e){return true;}})();
if(onboarded)startGeo();else $('#onboard').hidden=false;
loadAlerts();
wide.addEventListener('change',()=>{snapTo(sheetUI.snap,false);setMapCovered();});
const hideSplash=()=>$('#splash').classList.add('hide');
addEventListener('load',()=>setTimeout(hideSplash,reduceMotion.matches?0:850));
setTimeout(hideSplash,2500);
