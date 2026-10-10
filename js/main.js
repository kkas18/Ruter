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
['pointerdown','keydown','wheel'].forEach(t=>addEventListener(t,()=>{const wasIdle=isIdle();lastInput=Date.now();if(wasIdle)refreshNow();},{passive:true,capture:true}));

every(REFRESH_MS,()=>{
  const n=router.cur.name;
  if(n==='home')loadDeps();
  if(n==='stop'){const id=router.cur.params.id;loadStopDeps(id,true).then(()=>{if(router.cur.name==='stop'&&router.cur.params.id===id)router.refresh();});}
});
every(15000,()=>refreshVehicles());
every(30000,()=>loadEstVehicles());
// Avgangskortene på kartet får nye tider hvert 30. sek; minuttene telles ned lokalt hvert 20. sek.
every(30000,()=>loadViewDeps());
every(30000,()=>{if(router.cur.name==='results')loadTripCalls();});
every(180000,()=>loadAlerts());
every(60000,()=>{if(router.cur.name==='home')loadShortcuts();});
every(20000,()=>{if(['home','stop','results','journey'].includes(router.cur.name))router.refresh();},{eco:false});
every(20000,()=>{if(mapLoaded&&map.getZoom()>=CARD_ZOOM-0.5)renderStopsLayer();},{eco:false});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshNow();});

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
router.show('home',{},null);
const onboarded=(()=>{try{return!!localStorage.getItem('reisOnboarded');}catch(e){return true;}})();
if(onboarded)startGeo();else $('#onboard').hidden=false;
loadAlerts();
wide.addEventListener('change',()=>snapTo(sheetUI.snap,false));
const hideSplash=()=>$('#splash').classList.add('hide');
addEventListener('load',()=>setTimeout(hideSplash,reduceMotion.matches?0:850));
setTimeout(hideSplash,2500);
