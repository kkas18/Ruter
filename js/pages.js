'use strict';
/* REIS – Sidene i arket: Hjem, Søk, Reiseforslag, Reisen, Holdeplass, Turen, Meldinger og Innstillinger. */

/* ---------- Side: Hjem ---------- */
// Meldinger som gjelder linjer som går fra holdeplassene rundt deg eller favorittene dine.
function myLines(){
  const codes=new Set();
  [...favs,...state.nearby.slice(0,8)].forEach(s=>upcoming(s.id).forEach(r=>codes.add(String(r.pub))));
  return codes;
}
function relevantAlerts(){const mine=myLines();return state.alerts.filter(a=>a.sev!=='info'&&(a.lines||[]).some(l=>mine.has(l)));}
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
    const sub=$('#homeSub');if(sub)sub.textContent=homeSubText();
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
  await Promise.all(ids.map(async id=>{try{const d=await gql(Q_SJ_CALLS,{id});const c=d.serviceJourney?.estimatedCalls;if(c?.length)tripCalls.set(id,{calls:c,t:Date.now()});}catch(e){report('loadTripCalls',e);}}));
  if(router.cur.name==='results')router.refresh();
}
const firstRide=p=>(p.legs||[]).find(l=>l.mode!=='foot');
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
    return`<span class="seg ride${a?` has-alert ${a.sev}`:''}" style="flex:${w} 1 0;--c:${md.c};${d}" title="${md.n} ${esc(code)}${a?` – ${esc(a.summary)}`:''}"><b>${esc(code)}</b></span>`;
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
        const al=alertFor(code,{all:true});
        if(al)extra=`<button class="leg-alert press${al.sev==='info'?' info':''}" type="button" data-alerts>${ico(al.sev==='info'?'info':'alert')}<span>${esc(al.summary)}</span></button>`;
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
  const e=state.deps.get(id);
  return state.nearby.find(s=>s.id===id)||state.viewStops.get(id)||favs.find(f=>f.id===id)||
    (e?.name&&e.lat!=null?{id,name:e.name,lat:e.lat,lon:e.lon}:null);
}
pages.stop={
  initial:'half',peek:168,
  head({id}){
    const s=findStop(id)||{name:state.deps.get(id)?.name||'Holdeplass'},d=s.lat!=null?distTo(s):null,fav=favs.some(f=>f.id===id);
    const e=state.deps.get(id),sub=e?.stale&&e.t?ageText(e.t):d!=null?`${fmtDist(d)} · ${walkMin(d)} min å gå`:'Holdeplass';
    return`${backBtn}<div class="titles"><div class="head-title">${esc(s.name)}</div><div class="head-sub" id="stopSub">${sub}</div></div>
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
    const e=state.deps.get(params.id),sub=$('#stopSub'),fs=findStop(params.id),d=fs?.lat!=null?distTo(fs):null;
    if(sub)sub.textContent=e?.stale&&e.t?ageText(e.t):d!=null?`${fmtDist(d)} · ${walkMin(d)} min å gå`:'Holdeplass';
    o.top.innerHTML=n.top.innerHTML;o.rest.innerHTML=n.rest.innerHTML;
    morphTl(o.tl,n.tl);
    this.bindRows(params.id);updateStopCallout(params.id);
  },
  leave(){if(mapLoaded){map.setFilter('stop-sel',['==',['get','id'],'']);map.setFilter('stop-cards',['all',['has','card'],['!=',['get','id'],'']]);}removeStopCallout();},
  enter({id}){
    if(mapLoaded){map.setFilter('stop-sel',['==',['get','id'],id]);map.setFilter('stop-cards',['all',['has','card'],['!=',['get','id'],id]]);}
    const s=findStop(id);
    if(s&&mapLoaded){
      // Holdeplassen litt under midten, så boblen med avganger får plass over den.
      map.easeTo({center:[s.lon,s.lat],zoom:Math.max(map.getZoom(),15.5),offset:[0,70],duration:reduceMotion.matches?0:600,padding:mapPadding()});
      setFollow(false);
    }
    loadStopDeps(id,true).then(()=>{if(router.cur.name==='stop'&&router.cur.params.id===id)router.refresh();});
  }
};
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
    // Avvik som rammer linjene rundt deg først, så andre avvik, og planlagte endringer til slutt.
    const now=state.alerts.filter(a=>a.sev!=='info'),planned=state.alerts.filter(a=>a.sev==='info');
    const rel=now.filter(a=>(a.lines||[]).some(l=>mine.has(l))),rest=now.filter(a=>!rel.includes(a));
    let i=0;const sec=(label,list)=>list.length?`<div class="label">${label}</div>${list.map(a=>item(a,i++)).join('')}`:'';
    return sec('Rundt deg',rel)+sec(rel.length?'Andre avvik nå':'Avvik nå',rest)+sec('Planlagte endringer',planned);
  }
};

/* ---------- Side: Innstillinger ---------- */
// Diagnostikk: feil appen har tålt og hvor mange kall den har gjort mot Entur siste time.
function diagHtml(){
  const n=diag.errors.length,calls=diag.calls.filter(t=>t>Date.now()-3600000).length;
  return`<details class="group diag" style="margin-top:14px"><summary class="row-item"><span class="lbl"><b>Diagnostikk</b>
      <small>${diag.count?`${diag.count} ${plural(diag.count,'feil','feil')} denne økten`:'Ingen feil denne økten'} · ${calls} kall til Entur siste time</small></span>${ico('chev')}</summary>
    ${n?`<ol class="diag-list">${diag.errors.map(e=>`<li><time>${fmtT(e.t)}</time><b>${esc(e.where)}</b><span>${esc(e.msg)}</span></li>`).join('')}</ol>`:''}
    <button class="row-item press" id="diagCopy" type="button"><span class="lbl"><b>Kopier diagnostikk</b><small>Lim inn i en feilmelding</small></span></button></details>`;
}
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
    ${diagHtml()}
    <div class="about"><svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect class="m-bg" width="64" height="64" rx="15"/><path class="m-line" d="M19 45h9l13-13V19"/><circle class="m-start" cx="19" cy="45" r="4.5"/><circle class="m-end" cx="41" cy="19" r="6"/></svg>
      <div><b>REIS</b><br>Sanntid og reisesøk fra Entur (åpne data, NLOD). Kart © OpenStreetMap-bidragsytere, OpenMapTiles og OpenFreeMap. Uavhengig app, ikke tilknyttet Ruter AS.</div></div>`;
  },
  bind(){
    $$('#themeSeg button').forEach(b=>b.onclick=()=>{buzz(6);settings.theme=b.dataset.t;saveSettings();paintTheme();
      $$('#themeSeg button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));});
    $('#walkRange').oninput=e=>{settings.walkKmh=coreCfg.walkKmh=+e.target.value;saveSettings();$('#walkVal').textContent=settings.walkKmh.toFixed(1).replace('.',',')+' km/t';};
    $('#vehToggle').onchange=e=>{settings.showVehicles=e.target.checked;saveSettings();if(!settings.showVehicles)setData('vehicles',EMPTY);else{refreshVehicles(true);loadEstVehicles(true);}};
    $('#vibToggle').onchange=e=>{settings.vibrate=e.target.checked;saveSettings();buzz(10);};
    $('#installBtn')?.addEventListener('click',doInstall);
    $('#diagCopy')?.addEventListener('click',async()=>{buzz(6);
      const txt=JSON.stringify({app:'REIS',agent:navigator.userAgent,online:navigator.onLine,callsLastHour:diag.calls.length,errors:diag.errors},null,1);
      try{await navigator.clipboard.writeText(txt);toast('Diagnostikk kopiert');}catch(e){report('kopier diagnostikk',e);toast('Kunne ikke kopiere');}});
    $('#resetBtn').onclick=()=>{
      if(confirm('Slette favoritter, nylige reisemål og innstillinger?')){
        ['reisFavs','reisSettings','reisDepCache','reisRecentTargets','reisOnboarded'].forEach(k=>{try{localStorage.removeItem(k);}catch(e){/* lagring kan være slått av (privat modus) */}});
        location.reload();}};
  }
};
$('#searchBar').onclick=()=>{buzz(8);router.go('search',{focus:'to'});};
$('#menuBtn').onclick=()=>{buzz(6);router.go('settings');};
