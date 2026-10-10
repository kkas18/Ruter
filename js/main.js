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
  if(ptr.busy)return;ptr.busy=true;buzz(10);
  ptrShow(46,'busy');
  try{await Promise.all([loadDeps(true),loadAlerts(),loadShortcuts(true)]);}catch(e){report('oppdater Hjem',e);}
  ptr.busy=false;ptrShow(0,'');
}
sheetScroll.addEventListener('touchstart',e=>{
  if(ptr.busy||router.cur.name!=='home'||!sheet.classList.contains('full')||sheetScroll.scrollTop>0)return;
  ptr.y0=e.touches[0].clientY;ptr.pull=0;
},{passive:true});
sheetScroll.addEventListener('touchmove',e=>{
  if(ptr.y0==null)return;
  const dy=e.touches[0].clientY-ptr.y0;
  if(dy<=0||sheetScroll.scrollTop>0){ptr.y0=null;ptrShow(0,'');return;}
  e.preventDefault();ptr.pull=Math.min(PTR_MAX,dy*.5);ptrShow(ptr.pull,'pulling');
},{passive:false});
sheetScroll.addEventListener('touchend',()=>{
  if(ptr.y0==null)return;ptr.y0=null;
  if(ptr.pull>=PTR_GO)refreshHome();else ptrShow(0,'');
});

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
wide.addEventListener('change',()=>snapTo(sheetUI.snap,false));
const hideSplash=()=>$('#splash').classList.add('hide');
addEventListener('load',()=>setTimeout(hideSplash,reduceMotion.matches?0:850));
setTimeout(hideSplash,2500);
