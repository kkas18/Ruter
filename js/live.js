'use strict';
/* REIS – Live reise: kjøretøyet på valgt reise, statusboksen og sporene. */

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
    }catch(e){report('startLive',e);}
  }));
  if(seq!==live.seq)return;
  // Sanntidstider for turen hvert 20. sek, GPS hvert 10. sek, etappene i reisen hvert 30. sek.
  live.timers.push(setInterval(()=>{if(!document.hidden)live.jobs.forEach(async j=>{
    try{const d=await gql(Q_SJ_CALLS,{id:j.sj});const c=d.serviceJourney?.estimatedCalls;if(c&&c.length===j.calls?.length)j.calls=c;}catch(e){report('startLive',e);}});},20000));
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
    }catch(e){report('refreshLegs',e);}
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
  // Varsle skjermleseren én gang når det haster: gå nå, bussen kommer, eller gå av ved neste stopp.
  const left=(until-now)/60000,urgentKey=left<=1.5?`${ringEl.dataset.aria}|${Math.round(until/60000)}`:'';
  if(urgentKey&&live.announced!==urgentKey){live.announced=urgentKey;
    announce((leaveFirst?'Gå nå. ':st.aria==='Gå av om'?'Gå av snart. ':'')+`${st.text}. ${st.sub}`.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&'));}
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
