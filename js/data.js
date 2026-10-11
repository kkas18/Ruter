'use strict';
/* REIS – Data: posisjon, holdeplasser, avganger, kjøretøy, trafikkmeldinger, søk og ruten på kartet. */

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
  if(!meMarker._map)nameMarker(meMarker.setLngLat([lon,lat]).addTo(map),tr('Din posisjon'));
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
// Er avgangene hentet fra lageret (frakoblet), sies det hvor gamle de er.
const ageText=t=>{const m=Math.round((Date.now()-t)/60000);return tr('data fra kl. {t}',{t:fmtT(t)})+(m>=1?tr(' ({n} min siden)',{n:m}):'');};
const homeSubText=()=>{
  const stale=state.nearby.map(s=>state.deps.get(s.id)).find(e=>e?.stale&&e.t);
  if(stale)return`${navigator.onLine?tr('Får ikke kontakt'):tr('Frakoblet')} · ${ageText(stale.t)}`;
  return`${state.pos?`${tr('Rundt deg')}${state.acc>50?` · ±${state.acc} m`:''}`:state.nearbyAt?tr('Rundt kartsenteret'):tr('Henter posisjon…')}${state.updated?tr(' · oppdatert {t}',{t:fmtT(state.updated)}):''}`;
};
function requestGeoOnce(){
  if(!('geolocation' in navigator)){toast(tr('Enheten støtter ikke posisjon.'));return;}
  navigator.geolocation.getCurrentPosition(p=>{handlePos(p);startGeo();},
    ()=>toast(tr('Fikk ikke tilgang til posisjon. Sjekk tillatelsene.')),{enableHighAccuracy:true,timeout:15000});
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
  const url=`${API.reverse}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radius=${radiusKm}&limit=${limit}&layers=stopPlace&lang=${geoLang()}`;
  const r=await fetchWithTimeout(url,{headers:{'ET-Client-Name':API.client}},15000);
  if(!r.ok)throw new Error(tr('Stedsøket svarte {s}',{s:r.status}));
  const data=await r.json();
  return(data.features||[]).filter(f=>f.properties?.id?.startsWith('NSR:StopPlace:')&&f.geometry?.coordinates?.length>=2)
    .map(f=>({id:f.properties.id,name:f.properties.names?.default||f.properties.name||tr('Holdeplass'),lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0]}));
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
    loadShortcuts();
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
    if(mapCovered())return;
    refreshVehicles(true);loadEstVehicles(true);tickEst();loadViewDeps(true);
    if(cardMode)renderStopsLayer(); // kort for holdeplasser som nå er i utsnittet, med tidene vi har
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
    }catch(e){report('holdeplasser i utsnittet',e);}
  },500);
});

/* ---------- Avganger ---------- */
async function fetchStopDeps(id,n=14){
  const d=await gql(Q_DEP,{id,n});
  return parseCalls(d.stopPlace?.estimatedCalls);
}
// Holdeplass-siden: opptil fire avganger per linje og retning den neste timen, så tidslinjen
// også dekker store knutepunkt (Jernbanetorget har over hundre avganger i timen).
const Q_DEP_ALL=Q_DEP.replace('$n:Int!)','$n:Int!,$per:Int!)')
  .replace('estimatedCalls(numberOfDepartures:$n)','estimatedCalls(numberOfDepartures:$n,numberOfDeparturesPerLineAndDestinationDisplay:$per,timeRange:3600)');
// Hjem trenger de nærmeste avgangene i hver retning; holdeplass-siden henter hele timen.
async function loadStopDeps(id,full=false){
  try{const d=await gql(Q_DEP_ALL,full?{id,n:150,per:4}:{id,n:16,per:3});
    const sp=d.stopPlace;state.deps.set(id,{rows:parseCalls(sp?.estimatedCalls),t:Date.now(),name:sp?.name,lat:sp?.latitude,lon:sp?.longitude});}
  catch(e){const old=state.deps.get(id);state.deps.set(id,{rows:old?.rows||[],t:old?.t,stale:true,error:true});}
}
let depsBusy=false;
async function loadDeps(force=false){
  if(depsBusy)return;
  const ids=[...new Set([...favs.map(f=>f.id),...state.nearby.slice(0,8).map(s=>s.id)])]
    .filter(id=>force||!state.deps.get(id)||Date.now()-state.deps.get(id).t>REFRESH_MS);
  if(!ids.length)return;
  depsBusy=true;
  await Promise.all(ids.map(id=>loadStopDeps(id)));
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
  if(mapCovered())return; // står stille til kartet vises igjen
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
  }catch(e){report('refreshVehicles',e);}finally{vehBusy=false;}
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
  if(!['home','stop'].includes(router.cur.name)||!settings.showVehicles){setData('vehicles',EMPTY);spreadPos.clear();return;}
  setData('vehicles',fc(spreadVehicles(gpsFeats.concat(estFeats))));
}
// Står flere kjøretøy nesten oppå hverandre (typisk ved et knutepunkt), legges de i en liten
// ring rundt punktet, så alle linjenumrene og holdeplassikonet i midten kan leses.
// Bare visningen flyttes; den virkelige posisjonen ligger fortsatt i dataene.
const spreadPos=new Map();
function spreadVehicles(feats){
  spreadPos.clear();
  if(!mapLoaded||!feats.length||map.getZoom()<14)return feats;
  const NEAR=34,pts=feats.map(f=>map.project(f.geometry.coordinates)),used=new Array(feats.length).fill(false),out=feats.slice();
  // Holdeplassikonene i utsnittet: kjøretøy som står på en holdeplass, legges rundt ikonet, ikke oppå.
  const bb=map.getBounds(),stops=map.getZoom()>=STOP_ICON_ZOOM?[...state.viewStops.values()]
    .filter(st=>bb.contains([st.lon,st.lat])).map(st=>map.project([st.lon,st.lat])):[];
  const nearStop=(x,y,lim)=>{let best=null,bd=lim;stops.forEach(q=>{const d=Math.hypot(q.x-x,q.y-y);if(d<bd){bd=d;best=q;}});return best;};
  const place=(k,x,y)=>{const ll=map.unproject([x,y]),c=[ll.lng,ll.lat];out[k]={...feats[k],geometry:{type:'Point',coordinates:c}};spreadPos.set(feats[k].properties.vid,c);};
  for(let i=0;i<feats.length;i++){
    if(used[i])continue;const grp=[i];used[i]=true;
    for(let j=i+1;j<feats.length;j++)if(!used[j]&&Math.hypot(pts[i].x-pts[j].x,pts[i].y-pts[j].y)<NEAR){grp.push(j);used[j]=true;}
    let cx=grp.reduce((a,k)=>a+pts[k].x,0)/grp.length,cy=grp.reduce((a,k)=>a+pts[k].y,0)/grp.length;
    // Ett kjøretøy som står på holdeplassen (ikke bare kjører forbi), legges rett ved siden av ikonet.
    const st=nearStop(cx,cy,grp.length<2?10:26);
    if(grp.length<2){if(st)place(i,st.x+32,st.y);continue;}
    if(st){cx=st.x;cy=st.y;}
    const r=Math.max(st?34:28,grp.length*46/(2*Math.PI));
    grp.forEach((k,m)=>{const a=-Math.PI/2+2*Math.PI*m/grp.length;place(k,cx+r*Math.cos(a),cy+r*Math.sin(a));});
  }
  return out;
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
  if(mapCovered())return;
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
  }catch(e){report('loadEstVehicles',e);}finally{estBusy=false;}
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
  if(mapCovered())return;
  if(!estWanted()){if(estFeats.length){estFeats=[];renderVehicleLayer();}return;}
  const now=Date.now(),b=map.getBounds(),feats=[];
  estView.forEach(id=>{const j=estJ.get(id);if(!j||!prepEst(j))return;
    const e=estimate(j,now);if(!e||e.state==='start'||e.state==='done')return;
    const pt=pointAt(j.pts,j.cum,e.s);if(!b.contains(pt.p))return;
    const mode=MODES[j.mode]?j.mode:'other';
    feats.push({type:'Feature',geometry:{type:'Point',coordinates:pt.p},properties:{vid:id,sj:id,mode,bearing:pt.b,line:j.code,dest:j.dest,est:true}});});
  estFeats=feats;renderVehicleLayer();
}

/* ---------- Trafikkmeldinger (SIRI SX) ---------- */
// Ruter skriver meldingene på norsk og ofte også på engelsk: velg appens språk, så norsk, så det som finnes.
const SX_LANG={nb:['no','nb','nor','nob'],en:['en','eng']};
function langText(el,tag){
  const ns=[...el.getElementsByTagName(tag)];
  const lang=n=>(n.getAttribute('xml:lang')||n.getAttribute('lang')||'').toLowerCase();
  const pick=ns.find(n=>SX_LANG[I18N.lang].includes(lang(n)))||ns.find(n=>SX_LANG.nb.includes(lang(n)))||ns.find(n=>!lang(n))||ns[0];
  return pick?pick.textContent.trim():'';
}
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
      list.push({sev:alertLevel(tagText(el,'ReportType'),tagText(el,'Severity'),summary),summary,desc:langText(el,'Description'),start,end,lines});
    }
    list.sort((a,b)=>SEV_RANK[a.sev]-SEV_RANK[b.sev]||(new Date(b.start)-new Date(a.start)));
    state.alerts=list.slice(0,150);state.alertsAt=Date.now();
    if(router.cur.name==='home'||router.cur.name==='alerts')router.refresh();
  }catch(e){report('loadAlerts',e);}
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
  const common=`q=${encodeURIComponent(q)}&limit=16&lang=${geoLang()}&lat=${focus[0]}&lon=${focus[1]}&radius=100`;
  const searches=[`${API.geocoder}?${common}&layers=stopPlace,groupOfStopPlaces,street,address,poi,place`,
    `${API.geocoder}?${common}&layers=street,address&sources=kartverket-matrikkelenadresse`];
  const responses=await Promise.allSettled(searches.map(async url=>{
    const r=await fetchWithTimeout(url,{headers:{'ET-Client-Name':API.client}},12000);
    if(!r.ok)throw new Error(tr('Stedsøket svarte {s}',{s:r.status}));
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
  }catch(e){report('searchPlaces',e);}
  const needle=q.toLocaleLowerCase('nb-NO');
  const local=[...favs,...recentTargets].filter((f,i,a)=>f?.name&&f.lat!=null&&f.name.toLocaleLowerCase('nb-NO').includes(needle)&&
    a.findIndex(x=>x?.name===f.name&&x?.lat===f.lat)===i).slice(0,8)
    .map(f=>({id:f.id||'',name:f.name,locality:tr('Lagret på enheten'),kind:'Nylig brukt',lat:f.lat,lon:f.lon}));
  if(local.length)return local;
  return reached?[]:null;
}
function rememberTarget(t){
  if(!t||t.pin||t.me||!Number.isFinite(+t.lat)||!Number.isFinite(+t.lon))return; // punkt på kartet og «min posisjon» huskes ikke
  recentTargets=[{name:String(t.name),lat:+t.lat,lon:+t.lon},...recentTargets.filter(x=>x&&(+x.lat!==+t.lat||+x.lon!==+t.lon))].slice(0,6);
  saveJSON('reisRecentTargets',recentTargets);
}

/* ---------- Reisesøk ---------- */
let tripSeq=0;
const rideCount=p=>(p.legs||[]).filter(l=>l.mode!=='foot').length;
/* ---------- Snarveier: Hjem og Jobb ----------
   For hvert fast sted hentes neste reise herfra (lett spørring, hvert annet minutt), så Hjem kan
   vise «gå om 6 min · fremme 17:42» uten at du søker. */
const Q_SHORT=`query($fl:Float!,$fp:Float!,$tl:Float!,$tp:Float!,${TRIP_ARGS}){
  trip(from:{coordinates:{latitude:$fl,longitude:$fp}},to:{coordinates:{latitude:$tl,longitude:$tp}},numTripPatterns:4,${TRIP_OPTS}){
    tripPatterns{expectedStartTime expectedEndTime legs{mode line{publicCode}}}}}`;
const shortcuts=new Map(); // nøkkel → {t,lat,lon,here|start,end,ride}
async function loadShortcuts(force=false){
  if(!state.pos)return;
  const keys=Object.keys(PLACE_KINDS).filter(k=>places[k]);
  let changed=false;
  await Promise.all(keys.map(async k=>{
    const p=places[k],old=shortcuts.get(k),same=old&&old.lat===p.lat&&old.lon===p.lon;
    if(!force&&same&&Date.now()-old.t<120000&&(!old.start||old.start>Date.now()))return;
    if(geoDist(state.pos,[p.lat,p.lon])<150){shortcuts.set(k,{t:Date.now(),lat:p.lat,lon:p.lon,here:true});changed=true;return;}
    try{
      const d=await gql(Q_SHORT,{fl:state.pos[0],fp:state.pos[1],tl:p.lat,tp:p.lon,...tripPrefs()});
      let ps=(d.trip?.tripPatterns||[]).map(x=>({...x,s:ts(x.expectedStartTime)})).filter(x=>x.s>Date.now()-30000).sort((a,b)=>a.s-b.s);
      if(settings.fewerChanges){const few=Math.min(...ps.map(rideCount));ps=ps.filter(x=>rideCount(x)===few);}
      const best=ps[0];
      const ride=best?.legs?.find(l=>l.mode!=='foot');
      shortcuts.set(k,best?{t:Date.now(),lat:p.lat,lon:p.lon,start:best.s,end:ts(best.expectedEndTime),
        ride:ride?{code:ride.line?.publicCode||modeOf(ride.mode).n,mode:ride.mode}:null}:{t:Date.now(),lat:p.lat,lon:p.lon,none:true});
      changed=true;
    }catch(e){report('snarveier',e);}
  }));
  if(changed&&router.cur.name==='home')router.refresh();
}
function goToPlace(k){
  const p=places[k];if(!p)return;
  state.dest={name:p.name,lat:p.lat,lon:p.lon};state.fromSel=null;state.timeMode='now';
  startTripSearch(router.cur.name==='search');
}

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
  if(!from){state.tripsLoading=false;state.tripError=tr('Velg hvor du reiser fra, eller slå på posisjon.');router.refresh();return;}
  const fromName=state.fromSel?.name||tr('Min posisjon'),toName=state.dest.name||tr('Mål');
  const vars={fl:from[0],fp:from[1],tl:state.dest.lat,tp:state.dest.lon,dt:null,arr:false,n:settings.fewerChanges?8:6,...tripPrefs()};
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
    // Færre bytter: reiser med færrest bytter først, ellers i Enturs rekkefølge (sorteringen er stabil).
    if(settings.fewerChanges)ps.sort((a,b)=>rideCount(a)-rideCount(b));
    state.trips=ps;state.tripsLoading=false;
    if(ps.length){rememberTarget(state.dest);loadTripCalls();}
  }catch(e){
    if(seq!==tripSeq)return;
    state.tripsLoading=false;state.tripError=e.message||tr('Ukjent feil');
  }
  if(router.cur.name==='results'){router.render(null);if(state.trips.length)drawRoute(state.trips[0]);}
}

/* ---------- Rute på kartet ---------- */
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
    try{if(l.pointsOnLink?.points)pts=decodePoly(l.pointsOnLink.points);}catch(e){report('rutegeometri',e);}
    if(!pts||pts.length<2){ // mangler geometri: koble kjente stopp skjematisk
      pts=[l.fromPlace?.quay,...(l.intermediateEstimatedCalls||[]).map(c=>c.quay),l.toPlace?.quay]
        .filter(q=>q&&Number.isFinite(+q.latitude)&&+q.latitude).map(q=>[+q.longitude,+q.latitude]);
      if(pts.length<2)return;
    }else drawn++;
    legs.push({pts,walk:l.mode==='foot',color:modeOf(l.mode).c});coords.push(...pts);
  });
  p.schematic=rides.length>0&&!drawn;
  rides.forEach((l,i)=>{
    if(i<rides.length-1){const q=l.toPlace?.quay;if(+q?.latitude)addPin(+q.latitude,+q.longitude,`<div class="xfer" style="--c:${modeOf(l.mode).c}">${i+1}</div>`,tr('Bytte {n}: {name}',{n:i+1,name:placeName(l.toPlace,'')}));}
  });
  const start=state.fromSel?[state.fromSel.lat,state.fromSel.lon]:state.pos;
  if(state.fromSel)addPin(state.fromSel.lat,state.fromSel.lon,'<div class="pin from">A</div>',tr('Start: {name}',{name:state.fromSel.name}));
  if(state.dest)addPin(state.dest.lat,state.dest.lon,'<div class="pin to">B</div>',tr('Mål: {name}',{name:state.dest.name}));
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
      properties:{name:name||tr('Stopp'),time:time||'',clock:time?fmtT(time):'',color,kind,minor}});
  };
  rides.forEach((l,i)=>{
    const c=modeOf(l.mode).c;
    add(l.fromPlace?.quay,l.fromPlace?.name,l.expectedStartTime,c,i?'Bytte':'Påstigning',false);
    (l.intermediateEstimatedCalls||[]).forEach(s=>add(s.quay,s.quay?.name,s.expectedArrivalTime,c,'Stopp underveis',true));
    add(l.toPlace?.quay,l.toPlace?.name,l.expectedEndTime,c,i<rides.length-1?'Bytte':'Avstigning',false);
  });
  setData('route-stops',fc(stops));
}
