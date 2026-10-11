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
const Q_SJ=`query($id:String!,$date:Date){serviceJourney(id:$id){id pointsOnLink{points}
  estimatedCalls(date:$date){realtime aimedArrivalTime expectedArrivalTime expectedDepartureTime actualArrivalTime actualDepartureTime aimedDepartureTime
    quay{id name latitude longitude}}}}`;
const Q_SJ_CALLS=`query($id:String!,$date:Date){serviceJourney(id:$id){id
  estimatedCalls(date:$date){realtime aimedArrivalTime expectedArrivalTime expectedDepartureTime actualArrivalTime actualDepartureTime aimedDepartureTime
    quay{id name latitude longitude}}}}`;
const Q_LEG=`query($id:ID!){leg(id:$id){id expectedStartTime expectedEndTime realtime
  intermediateEstimatedCalls{expectedArrivalTime quay{name latitude longitude}}}}`;
const live={trip:null,jobs:[],timers:[],tick:0,seq:0};
async function fetchVehicleGps(sjId){
  try{
    const r=await fetchWithTimeout(VEH_API,{method:'POST',headers:{'Content-Type':'application/json','ET-Client-Name':API.client},
      body:JSON.stringify({query:`{vehicles(serviceJourneyId:"${sjId.replace(/"/g,'')}",maxDataAge:"PT3M"){location{latitude longitude} bearing lastUpdatedEpochSecond}}`})},10000);
    const v=(await r.json())?.data?.vehicles?.[0];
    return v&&Number.isFinite(v.location?.latitude)?{lat:v.location.latitude,lon:v.location.longitude,bearing:v.bearing||0,t:(v.lastUpdatedEpochSecond||0)*1000}:null;
  }catch(e){return null;}
}
function stopLive(){
  live.seq++;live.trip=null;live.timers.forEach(clearInterval);live.timers=[];clearTimeout(live.tick);
  live.jobs.forEach(j=>j.marker?.remove());live.jobs=[];live.followVeh=false;setData('approach',EMPTY);
}
async function startLive(p){
  stopLive();live.trip=p;live.fitted=false;const seq=live.seq;
  const rides=(p.legs||[]).filter(l=>l.mode!=='foot'&&l.serviceJourney?.id);
  live.jobs=rides.map(l=>({leg:l,sj:l.serviceJourney.id,color:modeOf(l.mode).c,code:l.line?.publicCode||modeOf(l.mode).n}));
  await Promise.all(live.jobs.map(async j=>{
    try{const d=await sjQuery(Q_SJ,j.sj);const sj=d.serviceJourney;if(!sj)return;j.date=d.date;
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
    try{const d=await gql(Q_SJ_CALLS,{id:j.sj,date:j.date||null});const c=d.serviceJourney?.estimatedCalls;if(c&&c.length===j.calls?.length)j.calls=c;}catch(e){report('startLive',e);}});},20000));
  live.timers.push(setInterval(()=>{if(!document.hidden)live.jobs.forEach(async j=>{j.gps=await fetchVehicleGps(j.sj);});},10000));
  live.timers.push(setInterval(()=>{if(!document.hidden)refreshLegs(p);},30000));
  tickLive();
}
async function refreshLegs(p){
  const legs=p.legs||[],rides=legs.filter(l=>l.mode!=='foot'),first=rides[0],last=rides[rides.length-1];
  const s0=first&&ts(first.expectedStartTime),e0=last&&ts(last.expectedEndTime);
  await Promise.all(rides.filter(l=>l.id).map(async l=>{
    try{const d=await gql(Q_LEG,{id:l.id});const n=d.leg;if(!n)return;
      Object.assign(l,{expectedStartTime:n.expectedStartTime,expectedEndTime:n.expectedEndTime,realtime:n.realtime,
        intermediateEstimatedCalls:n.intermediateEstimatedCalls||l.intermediateEstimatedCalls});
    }catch(e){report('refreshLegs',e);}
  }));
  // Gangetappene får ikke nye tider fra Entur. Når første eller siste avgang flytter seg, flyttes
  // gangen før og etter like mye, så «gå om», varselet og ankomsttiden følger forsinkelsene.
  if(first){
    const ds=ts(first.expectedStartTime)-s0,de=ts(last.expectedEndTime)-e0,fi=legs.indexOf(first),li=legs.indexOf(last);
    const shift=(o,d)=>{if(!d)return;o.expectedStartTime=new Date(ts(o.expectedStartTime)+d).toISOString();o.expectedEndTime=new Date(ts(o.expectedEndTime)+d).toISOString();};
    legs.forEach((l,i)=>{if(l.mode==='foot'){if(i<fi)shift(l,ds);else if(i>li)shift(l,de);}});
    if(ds)p.expectedStartTime=new Date(ts(p.expectedStartTime)+ds).toISOString();
    if(de)p.expectedEndTime=new Date(ts(p.expectedEndTime)+de).toISOString();
  }
  if(live.trip!==p)return;
  renderRouteStops(p);
  if(router.cur.name==='trip')router.refresh();
}
function vehicleEl(j){
  const el=document.createElement('button');el.type='button';el.className='tveh';el.style.setProperty('--c',j.color);
  el.innerHTML=`<i class="arrow"></i><span>${esc(j.code)}</span>`;
  el.onclick=e=>{e.stopPropagation();buzz(6);const st=liveText(j);toast(st?plainText(st.text):`${modeOf(j.leg.mode).n} ${j.code}`);};
  return el;
}
// Én gang i sekundet: flytt kjøretøyene og oppdater statuslinjen. Et tidsur og ikke en rAF-løkke,
// som ville vekket skriptet 60 ganger i sekundet for å gjøre noe én gang. Dekker arket kartet,
// regnes bare statusen ut; kjøretøyet og sporet på kartet står stille til kartet vises igjen.
function tickLive(){
  clearTimeout(live.tick);if(!live.trip)return;
  live.tick=setTimeout(tickLive,1000);
  if(document.hidden)return;
  const now=Date.now(),approach=[],covered=mapCovered();
  live.jobs.forEach(j=>{
    if(!j.pts||j.pts.length<2)return;
    const e=estimate(j,now);
    const endT=ts(j.leg.expectedEndTime);
    const visible=e&&e.state!=='done'&&now<endT+60000&&now>depT(j.calls[0])-30*60000;
    if(!visible){j.marker?.remove();j.marker=null;return;}
    if(covered&&j.marker){j.now={e,lngLat:j.marker.getLngLat().toArray()};return;}
    let lngLat,bearing,gps=false;
    if(j.gps&&now-j.gps.t<120000){lngLat=[j.gps.lon,j.gps.lat];bearing=j.gps.bearing;gps=true;}
    else{const pt=pointAt(j.pts,j.cum,e.s);lngLat=pt.p;bearing=pt.b;}
    if(!j.marker){j.el=vehicleEl(j);j.marker=nameMarker(new maplibregl.Marker({element:j.el,rotationAlignment:'viewport'}).setLngLat(lngLat).addTo(map),`${modeOf(j.leg.mode).n} ${j.code}`);
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
  if(!covered)setData('approach',fc(approach));
  if(live.followVeh&&!covered){const j=live.jobs.find(x=>x.marker);if(j)map.easeTo({center:j.marker.getLngLat(),duration:reduceMotion.matches?0:900,easing:x=>x});}
  updateLiveBox();
}
// Tekst med HTML-tegn (navn er escapet for innerHTML) gjort om til ren tekst for skjermlesere.
const plainText=h=>{const d=document.createElement('div');d.innerHTML=h;return d.textContent;};
// Statusboksen bygges én gang og oppdateres på stedet, så ring og spor animeres jevnt.
// Ringen viser minutter til det som skjer neste (bussen går / du går av); sporet viser hvor bussen er.
function updateLiveBox(){
  const box=$('#liveStatus');if(!box)return;
  const st=liveStatus();box.hidden=!st;if(!st){placeRailVehicles();return;}
  if(!box.dataset.built){
    box.dataset.built='1';box.setAttribute('role','group');
    box.innerHTML=`${ringHtml(0,{size:52,win:20})}<div class="ls-main"><div class="ls-cap"><b></b><em class="src"></em></div>
      <div class="lt" hidden><div class="lt-rail"><i class="lt-fill"></i></div><div class="lt-dots"></div><span class="lt-veh"></span></div>
      <div class="lt-ends" hidden><em></em><em></em></div></div>
      <button class="ls-follow press" type="button" aria-pressed="false" aria-label="${tr('Følg kjøretøyet på kartet')}" title="${tr('Følg')}">${ico('locate')}</button>`;
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
  // Samme fase, men nytt tidspunkt (bussen er forsinket eller tar inn tid): ringen lyser kort opp.
  const phase=ringEl.dataset.aria,prevUntil=+ringEl.dataset.until;
  if(prevUntil&&live.phase===phase&&Math.abs(until-prevUntil)>=60000)flash(ringEl,until>prevUntil?'flash-late':'flash-early');
  live.phase=phase;ringEl.dataset.until=until;
  setRing(ringEl,(until-now)/60000,fmtT(until));
  // Varsle skjermleseren én gang når det haster: gå nå, bussen kommer, eller gå av ved neste stopp.
  const left=(until-now)/60000,urgentKey=left<=1.5?`${ringEl.dataset.aria}|${Math.round(until/60000)}`:'';
  if(urgentKey&&live.announced!==urgentKey){live.announced=urgentKey;
    breathe(ringEl);buzz([14,90,14]); // kjennes i lomma: gå nå, bussen kommer, eller gå av snart
    announce((leaveFirst?tr('Gå nå')+'. ':st.aria==='Gå av om'?tr('Gå av snart')+'. ':'')+plainText(`${st.text}. ${st.sub}`));}
  box.querySelector('.ls-cap b').innerHTML=st.short;
  const src=box.querySelector('.src');src.textContent=st.gps?'GPS':'≈';src.title=st.gps?tr('GPS-posisjon fra operatøren'):tr('Beregnet fra sanntid');src.hidden=st.gps==null;
  box.setAttribute('aria-label',plainText(`${st.text}. ${st.sub}`));
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
// Navnene settes inn som HTML (den korte teksten vises med innerHTML), derfor esc().
function liveText(j,now=Date.now()){
  const c=j.calls;if(!c||j.board<0)return null;
  const e=estimate(j,now);if(!e)return null;
  const gps=!!(j.gps&&now-j.gps.t<120000),name=esc(`${modeOf(j.leg.mode).n} ${j.code}`),src=gps?'GPS':tr('beregnet fra sanntid');
  const out=(text,sub,short,until,aria)=>({text,sub,short,until,aria,gps});
  const q=x=>esc(x?.quay?.name||'');
  if(j.leg.noStop){ // tur åpnet fra et kjøretøy uten holdeplass i nærheten
    if(e.state==='done')return null;const nx=c[Math.min(c.length-1,e.at+(e.state==='start'?0:1))],end=c[c.length-1];
    return e.state==='start'?out(tr('{name} starter kl. {t}',{name,t:fmtT(depT(c[0]))}),src,tr('Har ikke startet'),depT(c[0]),'Starter om'):
      out(tr('Neste stopp: {stop}',{stop:q(nx)}),`${tr('Fremme ved {stop} kl. {t}',{stop:q(end),t:fmtT(arrT(end))})} · ${src}`,tr('Neste: {stop}',{stop:q(nx)}),arrT(end),'Endestopp om');
  }
  const boardName=esc(c[j.board]?.quay?.name||j.leg.fromPlace?.name||''),alightName=esc(c[j.alight]?.quay?.name||j.leg.toPlace?.name||'');
  const dep=depT(c[j.board]),arr=arrT(c[Math.max(0,j.alight)]);
  if(now<dep){
    const away=j.board-e.at-(e.state==='moving'?1:0);
    const m=Math.max(0,Math.round((dep-now)/60000));
    const text=e.state==='start'?tr('{name} starter fra {stop} kl. {t}',{name,stop:q(c[0]),t:fmtT(depT(c[0]))}):
      away<=0?tr('{name} er ved {stop}',{name,stop:boardName}):tn(away,'{name} er {n} stopp unna {stop}','{name} er {n} stopp unna {stop}',{name,stop:boardName});
    const short=e.state==='start'?tr('Har ikke startet'):away<=0?tr('Ved holdeplassen'):tn(away,'{n} stopp unna','{n} stopp unna');
    return out(text,`${tr('Går kl. {t}',{t:fmtT(dep)})} · ${m?tr('om {n} min',{n:m}):tr('nå')} · ${src}`,short,dep,'Går om');
  }
  if(j.leg.journey){ // enkelttur: etter holdeplassen din er det ingen «gå av»
    const nx=c[Math.min(c.length-1,e.at+1)],end=c[c.length-1];
    if(e.state==='done')return out(tr('{name} er fremme ved {stop}',{name,stop:q(end)}),src,tr('Fremme'),now,'');
    return out(tr('{name} har passert {stop}',{name,stop:boardName}),`${tr('Neste stopp: {stop}',{stop:q(nx)})} · ${tr('Endestopp {stop} kl. {t}',{stop:q(end),t:fmtT(arrT(end))})} · ${src}`,
      tr('Neste: {stop}',{stop:q(nx)}),arrT(end),'Endestopp om');
  }
  if(now<arr){
    const next=esc(c[Math.min(c.length-1,e.at+1)]?.quay?.name||''),left=Math.max(0,j.alight-e.at);
    return out(tr('Neste stopp: {stop}',{stop:next}),`${tr('Gå av ved {stop} kl. {t}',{stop:alightName,t:fmtT(arr)})} · ${tn(left,'{n} stopp igjen','{n} stopp igjen')} · ${src}`,
      tr('Neste: {stop}',{stop:next}),arr,'Gå av om');
  }
  return null;
}
function liveStatus(){
  const now=Date.now();
  for(const j of live.jobs){if(ts(j.leg.expectedEndTime)>now){const s=liveText(j,now);if(s)return s;}}
  const p=live.trip;if(p&&ts(p.expectedEndTime)<now)return{text:tr('Du skal være fremme'),sub:tr('Ankomst kl. {t}',{t:fmtT(p.expectedEndTime)}),short:tr('Fremme'),until:now,aria:''};
  return null;
}

function fitRoute(){
  if(!routeBounds||!mapLoaded)return;
  setFollow(false);
  map.setPadding(mapPadding()); // fitBounds legger sin egen polstring oppå kartets – hold den liten
  map.fitBounds(routeBounds,{padding:{top:28,bottom:28,left:28,right:28},maxZoom:16,duration:reduceMotion.matches?0:900,easing:easeOut});
}

/* =====================================================================
   VARSEL, DELING OG BILLETT FOR VALGT REISE
   ===================================================================== */
/* ---------- Varsel når du må gå ----------
   Et minutt før du må gå, kommer et varsel med linje, holdeplass og tid. Tiden følger forsinkelser
   (refreshLegs). Varselet vises av service workeren, så det kommer også når appen ligger i
   bakgrunnen. En nettside kan ikke vekke seg selv når den er helt lukket; det krever push fra en
   server. Derfor lover appen bare det den kan holde: varsel mens appen er åpen eller i bakgrunnen. */
const goAlert={trip:null,timer:0,fired:false,checked:0};
const canNotify=()=>'Notification' in window&&'serviceWorker' in navigator&&location.protocol!=='file:';
const alertAt=p=>ts(p.expectedStartTime)-60000;
function rideText(l){const md=modeOf(l.mode),n=l.mode==='metro'?md.n:md.n.toLowerCase();return`${n} ${l.line?.publicCode||''}`.trim();}
async function toggleGoAlert(p){
  if(goAlert.trip===p){goAlert.trip=null;clearTimeout(goAlert.timer);toast(tr('Varselet er slått av'));tripActionsUpdate();return;}
  if(!canNotify()){toast(tr('Denne nettleseren kan ikke vise varsler.'));return;}
  let perm=Notification.permission;
  if(perm==='default'){try{perm=await Notification.requestPermission();}catch(e){report('varsel',e);}}
  if(perm!=='granted'){toast(tr('Varsler er slått av for appen. Slå dem på i nettleserens innstillinger.'));tripActionsUpdate();return;}
  if(alertAt(p)<Date.now()-60000){toast(tr('Det er allerede tid for å gå.'));return;}
  goAlert.trip=p;goAlert.fired=false;goAlert.checked=Date.now();buzz(8);
  toast(tr('Du får varsel kl. {t}. Hold appen åpen eller i bakgrunnen.',{t:fmtT(alertAt(p))}));
  scheduleGoAlert();tripActionsUpdate();
}
// Sjekker minst hvert 30. sekund: tidene kan endre seg, og tidsur i bakgrunnen kan bli forsinket.
function scheduleGoAlert(){
  clearTimeout(goAlert.timer);const p=goAlert.trip;if(!p||goAlert.fired)return;
  if(live.trip!==p&&Date.now()-goAlert.checked>60000){goAlert.checked=Date.now();refreshLegs(p);} // reisen vises ikke: hent tidene selv
  const wait=alertAt(p)-Date.now();
  if(wait<=0){fireGoAlert(p);return;}
  goAlert.timer=setTimeout(scheduleGoAlert,Math.min(wait,30000));
}
document.addEventListener('visibilitychange',()=>{if(goAlert.trip&&!goAlert.fired)scheduleGoAlert();});
async function fireGoAlert(p){
  goAlert.fired=true;tripActionsUpdate();
  if(Date.now()>ts(p.expectedStartTime)+120000)return; // for sent: ikke varsle om noe som er passert
  const ride=(p.legs||[]).find(l=>l.mode!=='foot');
  const body=ride?tr('{ride} går fra {stop} kl. {t}.',{ride:rideText(ride),stop:placeName(ride.fromPlace,tr('holdeplassen')),t:fmtT(ride.expectedStartTime)}):tr('Reisen starter kl. {t}.',{t:fmtT(p.expectedStartTime)});
  buzz([14,90,14]);
  // Er appen synlig, sier ringen og vibrasjonen det allerede; et systemvarsel i tillegg blir støy.
  if(!document.hidden){toast(`${tr('Gå nå')}: ${body}`);return;}
  try{const reg=await navigator.serviceWorker.ready;
    await reg.showNotification(tr('Gå nå'),{body,tag:'reis-go',renotify:true,icon:'icons/icon-192.png',badge:'icons/icon-192.png',vibrate:[14,90,14]});}
  catch(e){report('varsel',e);}
}

/* ---------- Del ankomsttid ---------- */
async function shareArrival(p){
  const legs=p.legs||[],ride=legs.find(l=>l.mode!=='foot'),to=placeName(legs[legs.length-1]?.toPlace,p.toName||'');
  let text=tr('Er fremme ved {to} ca. kl. {t}.',{to,t:fmtT(p.expectedEndTime)});
  if(ride)text+=' '+tr('Tar {ride} fra {stop} kl. {t}.',{ride:rideText(ride),stop:placeName(ride.fromPlace,''),t:fmtT(ride.expectedStartTime)});
  buzz(6);
  if(navigator.share){try{await navigator.share({text});}catch(e){if(e.name!=='AbortError')report('del ankomst',e);}return;}
  try{await navigator.clipboard.writeText(text);toast(tr('Kopiert. Lim inn i en melding.'));}catch(e){toast(text);}
}

/* ---------- Billett ----------
   REIS selger ikke billetter. Snarveien åpner Ruter-appen i App Store eller Google Play (der står
   «Åpne» hvis appen er installert), og ellers Ruters side om hvor du kjøper billett. */
function ticketLink(){
  const ua=navigator.userAgent;
  if(/iPhone|iPad|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))
    return{href:'https://apps.apple.com/no/app/ruter/id993620197',where:'App Store'};
  if(/Android/i.test(ua))return{href:'https://play.google.com/store/apps/details?id=no.ruter.reise',where:'Google Play'};
  return{href:'https://ruter.no/billetter/kjope-billett',where:'ruter.no'};
}
