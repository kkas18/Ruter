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
    return`<div class="titles"><div class="head-title">${tr('Avganger')}</div><div class="head-sub" id="homeSub">${homeSubText()}</div></div>
      <button class="icon-btn press" id="homeRefresh" type="button" aria-label="${tr('Oppdater avganger')}">${morphIco('refresh','check')}</button>`;
  },
  body(){
    // Bare meldinger som angår deg får plass øverst; resten ligger rolig nederst.
    const rel=relevantAlerts(),n=rel.length,all=state.alerts.length;
    let h=placeTiles();
    if(n)h+=`<button class="notice slim press" id="alertsNotice" type="button">${ico('alert')}<span class="one"><b>${tn(n,'{n} avvik','{n} avvik')}</b> ${esc(rel[0].summary)}</span>${ico('chev')}</button>`;
    if(favs.length)h+=`<div class="label">${tr('Favoritter')}</div>${favs.map(stopCard).join('')}`;
    const near=state.nearby.filter(s=>!favs.some(f=>f.id===s.id)).slice(0,8);
    if(near.length)h+=`<div class="label">${tr('I nærheten')}</div>${near.map(stopCard).join('')}`;
    else if(!favs.length)h+=state.nearbyAt?`<div class="state">${ico('stop')}<b>${tr('Ingen holdeplasser her')}</b>${tr('Flytt kartet eller søk etter et sted.')}</div>`:
      `<div class="mini" style="padding:12px 16px">${'<span class="skel" style="height:40px"></span>'}</div>`;
    if(!state.pos&&state.nearbyAt)h+=`<p class="note">${tr('Slå på posisjon for å se holdeplassene rundt deg.')} <button class="reach" id="geoAsk" type="button">${tr('Bruk posisjonen min')}</button></p>`;
    if(all)h+=`<button class="quiet-link press" id="alertsAll" type="button">${ico('alert')}<span>${tr('Trafikkmeldinger')}</span><em>${all}</em>${ico('chev')}</button>`;
    return h;
  },
  bind(){
    $('#homeRefresh').onclick=()=>{$('#homeRefresh').classList.add('spin');refreshHome().finally(()=>$('#homeRefresh')?.classList.remove('spin'));};
    showLanded($('#sheetPage'));
    $('#alertsNotice')?.addEventListener('click',()=>{buzz(6);router.go('alerts');});
    $('#alertsAll')?.addEventListener('click',()=>{buzz(6);router.go('alerts');});
    $('#geoAsk')?.addEventListener('click',()=>{buzz(8);requestGeoOnce();});
    $$('#sheetPage [data-stop]').forEach(b=>b.onclick=()=>{buzz(6);router.go('stop',{id:b.dataset.stop},{hero:b.querySelector('.top b')});});
    bindPlaceTiles($('#sheetPage'));
  },
  // Tidslinjene oppdateres på stedet; bare nye kort eller endret innhold tegnes på nytt.
  update(){
    const t=document.createElement('div');t.innerHTML=this.body();
    const page=$('#sheetPage'),oc=$$('.stop-card',page),nc=$$('.stop-card',t);
    // Snarveiene oppdateres for seg (minuttene endrer seg hvert minutt).
    const op=$('.places',page),np=$('.places',t);if(op&&np&&op.innerHTML!==np.innerHTML){op.innerHTML=np.innerHTML;bindPlaceTiles(op);showLanded(op);}
    const ids=a=>a.map(c=>c.dataset.stop).join(','),rest=el=>[...el.children].filter(c=>!c.classList.contains('stop-card')&&!c.classList.contains('places')).map(c=>c.outerHTML).join('');
    if(ids(oc)!==ids(nc)||rest(page)!==rest(t)){const st=sheetScroll.scrollTop;router.render(null);sheetScroll.scrollTop=st;return;}
    const sub=$('#homeSub');if(sub)sub.textContent=homeSubText();
    oc.forEach((o,i)=>{const n=nc[i],ot=$('.top',o),nt=$('.top',n);if(ot.innerHTML!==nt.innerHTML)ot.innerHTML=nt.innerHTML;morphTl($('.sc-body',o),$('.sc-body',n));});
  },
  enter(p,dir){clearRoute();clearPins();loadDeps();loadShortcuts();}
};

/* ---------- Side: Søk ---------- */
pages.search={
  snaps:['full'],initial:'full',headClass:'search-head',
  head(params={}){
    // Velg et fast sted (Hjem/Jobb): bare ett felt, ingen tid.
    if(params.pick){const K=PLACE_KINDS[params.pick],kn=tr(K.n);
      return`<div class="row">${backBtn()}<div class="route-card pick-card"><span class="pick-ico" aria-hidden="true">${ico(K.icon)}</span>
        <div class="route-field"><input id="toInput" type="text" data-pick="${params.pick}" placeholder="${tr('Adresse for {name}',{name:kn.toLowerCase()})}" autocomplete="off" enterkeyhint="search"
          aria-label="${tr('Adresse for {name}',{name:kn})}" role="combobox" aria-autocomplete="list" aria-controls="suggestList" aria-expanded="false" value=""></div></div></div>`;}
    return`<div class="row">${backBtn()}
      <div class="route-card"><div class="route-rail" aria-hidden="true"><span class="a"></span><i></i><span class="b"></span></div>
        <div class="route-field"><input id="fromInput" type="text" placeholder="${tr('Min posisjon')}" autocomplete="off" enterkeyhint="next" aria-label="${tr('Fra')}"
          role="combobox" aria-autocomplete="list" aria-controls="suggestList" aria-expanded="false" value="${esc(state.fromSel?.name||'')}"></div>
        <div class="route-field"><input id="toInput" type="text" placeholder="${tr('Hvor vil du?')}" autocomplete="off" enterkeyhint="search" aria-label="${tr('Til')}"
          role="combobox" aria-autocomplete="list" aria-controls="suggestList" aria-expanded="false" value="${esc(state.dest?.name||'')}"></div>
        <button class="swap press" id="swapBtn" type="button" aria-label="${tr('Bytt fra og til')}">${ico('swap')}</button></div></div>
      <div class="when-row"><div class="segmented" id="timeSeg" role="group" aria-label="${tr('Tidspunkt')}" style="--n:3;--i:${Math.max(0,['now','dep','arr'].indexOf(state.timeMode))}">
        ${[['now','Nå'],['dep','Avreise'],['arr','Ankomst']].map(([k,l])=>`<button type="button" data-m="${k}" aria-pressed="${state.timeMode===k}">${tr(l)}</button>`).join('')}</div>
        <input class="time-input" type="time" id="timeInput" aria-label="${tr('Klokkeslett')}" value="${esc(state.time)}" ${state.timeMode==='now'?'hidden':''}></div>`;
  },
  body(){return'<div id="suggest"><div id="suggestList" role="listbox" hidden></div></div>';},
  bind(params){
    const from=$('#fromInput'),to=$('#toInput');
    let field=params.focus==='from'&&from?from:to;
    const suggest=()=>renderSuggestions(field);
    [from,to].filter(Boolean).forEach(inp=>{
      inp.addEventListener('focus',()=>{field=inp;inp.select();suggest();});
      inp.addEventListener('input',()=>{
        if(!inp.dataset.pick){if(inp===from)state.fromSel=null;else state.dest=null;}
        debounceSearch(inp);});
      // Piltastene flytter markeringen i listen mens fokus blir i feltet (aria-activedescendant).
      inp.addEventListener('keydown',e=>{
        const opts=$$('#suggestList [role="option"]'),i=opts.findIndex(o=>o.getAttribute('aria-selected')==='true');
        if((e.key==='ArrowDown'||e.key==='ArrowUp')&&opts.length){e.preventDefault();
          const j=e.key==='ArrowDown'?Math.min(opts.length-1,i+1):Math.max(0,i-1);
          opts.forEach((o,k)=>o.setAttribute('aria-selected',String(k===j)));
          inp.setAttribute('aria-activedescendant',opts[j].id);opts[j].scrollIntoView({block:'nearest'});}
        else if(e.key==='Enter'){e.preventDefault();(opts[i]||opts[0])?.click();}
        else if(e.key==='Escape'){router.back();}
      });
    });
    $('#swapBtn')&&($('#swapBtn').onclick=()=>{buzz(8);const b=$('#swapBtn');b.classList.remove('turn');void b.offsetWidth;b.classList.add('turn');
      const f=state.fromSel;state.fromSel=state.dest;
      state.dest=f||(state.pos?{name:tr('Min posisjon'),lat:state.pos[0],lon:state.pos[1],me:true}:null);
      from.value=state.fromSel?.name||'';to.value=state.dest?.name||'';
      if(state.dest&&(state.fromSel||state.pos))startTripSearch(true);});
    $$('#timeSeg button').forEach(b=>b.onclick=()=>{buzz(6);state.timeMode=b.dataset.m;segPick($('#timeSeg'),b);
      const ti=$('#timeInput');ti.hidden=state.timeMode==='now';
      if(!ti.hidden&&!ti.value){const d=new Date(Date.now()+15*60000);ti.value=state.time=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}});
    $('#timeInput')&&($('#timeInput').onchange=e=>{state.time=e.target.value;});
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
  showOptions(inp,[],'',optMsg(tr('Søker…')));
  const seq=++searchSeq;
  searchDebounce=setTimeout(async()=>{
    const fs=await searchPlaces(q);
    if(seq!==searchSeq||router.cur.name!=='search')return;
    if(!fs||!fs.length){showOptions(inp,[],'',optMsg(fs?tr('Ingen treff. Prøv gatenavn med husnummer, eller et sted i nærheten.'):tr('Søket er ikke tilgjengelig akkurat nå.')));return;}
    showOptions(inp,fs.map(f=>({icon:KIND_ICON[f.kind]||'place',title:f.name,sub:[tr(f.kind),f.locality].filter(Boolean).join(' · '),place:f})));
  },240);
}
// Før du skriver: snarveiene Hjem og Jobb øverst, så nylige mål og favoritter.
function renderSuggestions(inp){
  const q=inp.value.trim(),pick=inp.dataset.pick;
  if(q.length>=2&&(pick||!(inp.id==='fromInput'?state.fromSel:state.dest)))return debounceSearch(inp);
  const opts=[];
  if(inp.id==='fromInput'&&state.pos)opts.push({icon:'locate',me:true,title:tr('Min posisjon'),sub:tr('Bruk der du er nå'),place:null});
  recentTargets.slice(0,5).forEach(t=>opts.push({icon:'clock',title:t.name,sub:tr('Nylig'),place:t}));
  favs.forEach(f=>opts.push({icon:'star',title:f.name,sub:tr('Favoritt'),place:{...f,kind:'Holdeplass'}}));
  let top='';
  if(pick&&places[pick])top=`<button class="quiet-link press" id="placeRemove" type="button">${ico('x')}<span>${tr('Fjern {kind} ({name})',{kind:tr(PLACE_KINDS[pick].n).toLowerCase(),name:esc(places[pick].name)})}</span></button>`;
  else if(!pick&&inp.id==='toInput')top=placeTiles({editable:true});
  const note=`<p class="note">${tr('Søk etter adresse, holdeplass eller sted. Du kan også holde fingeren på kartet for å velge et punkt.')}</p>`;
  showOptions(inp,opts,top,opts.length?'':note);
  $('#placeRemove')?.addEventListener('click',()=>{buzz(8);const K=PLACE_KINDS[pick],old=places[pick];delete places[pick];savePlaces();shortcuts.delete(pick);
    router.back();
    notify({title:tr('{kind} er fjernet',{kind:tr(K.n)}),sub:old.name,icon:K.icon,action:{run:()=>{
      places[pick]=old;savePlaces();shortcuts.delete(pick);markLanded(`.place-tile[data-place="${pick}"]`);loadShortcuts(true);
      // Bare snarveiene tegnes på nytt (i søket uten å flytte fokus, så tastaturet ikke kommer opp).
      if(router.cur.name==='home')router.refresh();else if(router.cur.name==='search'&&$('#toInput'))renderSuggestions($('#toInput'));}}});});
}
// Beskjed i stedet for treff («Søker…», «Ingen treff»): leses opp, men er ikke et valg i listen.
const optMsg=txt=>`<div class="opt opt-msg" role="status"><span class="kind">${ico('search')}</span><span>${esc(txt)}</span></div>`;
// Forslagene er en listeboks som hører til feltet du skriver i (kombinasjonsboks).
function showOptions(inp,opts,top='',after=''){
  $('#suggest').innerHTML=top+(opts.length&&top&&!inp.dataset.pick?`<div class="label">${tr('Nylige og favoritter')}</div>`:'')+
    `<div id="suggestList" role="listbox" aria-label="${tr('Forslag')}"${opts.length?'':' hidden'}>${opts.map((o,i)=>`<button class="opt" type="button" role="option" id="sg${i}" tabindex="-1" aria-selected="false" data-i="${i}"><span class="kind${o.me?' me':''}">${ico(o.icon)}</span>
    <span><b>${esc(o.title)}</b>${o.sub?`<small>${esc(o.sub)}</small>`:''}</span></button>`).join('')}</div>`+after;
  $$('#suggestList .opt').forEach(b=>b.onclick=()=>{buzz(6);const o=opts[+b.dataset.i];choosePlace(inp,o.place);});
  $$('#fromInput,#toInput').forEach(f=>{f.setAttribute('aria-expanded',String(f===inp&&opts.length>0));f.removeAttribute('aria-activedescendant');});
  bindPlaceTiles($('#suggest'));showLanded($('#suggest'));
}
function choosePlace(inp,place){
  const pick=inp.dataset.pick;
  if(pick){ // lagre fast sted og gå tilbake
    if(!place)return;
    places[pick]={name:String(place.name),lat:+place.lat,lon:+place.lon};savePlaces();shortcuts.delete(pick);
    markLanded(`.place-tile[data-place="${pick}"]`);
    notify({title:tr('{kind} er lagret',{kind:tr(PLACE_KINDS[pick].n)}),sub:places[pick].name,icon:PLACE_KINDS[pick].icon,tone:'ok'});
    router.back();loadShortcuts(true);return;
  }
  const from=inp.id==='fromInput';
  if(from){state.fromSel=place;inp.value=place?.name||'';}
  else{state.dest=place;inp.value=place.name;}
  if(state.dest&&(state.fromSel||state.pos))startTripSearch(true);
  else if(from)$('#toInput').focus();
  else{$('#fromInput').focus();notify({title:tr('Velg hvor du reiser fra'),icon:'place'});}
}
const KIND_ICON={Holdeplass:'stop',Knutepunkt:'stop',Adresse:'place',Gate:'street','Nylig brukt':'clock'};

/* ---------- Side: Reiseforslag ---------- */
pages.results={
  initial:'half',peek:168,
  head(){
    const at=state.time||'--:--',when=state.timeMode==='now'?tr('Avreise nå'):state.timeMode==='arr'?tr('Fremme kl. {t}',{t:at}):tr('Avreise kl. {t}',{t:at});
    return`${backBtn()}<button class="titles press" id="editTrip" type="button" aria-label="${tr('Endre søket')}">
      <div class="head-title">${tr('Til {name}',{name:esc(state.dest?.name||'')})}</div><div class="head-sub">${tr('Fra {name}',{name:esc(state.fromSel?.name||tr('Min posisjon'))})} · ${when}</div></button>`;
  },
  body(){
    const opts=tripOptsHtml();
    if(state.tripsLoading)return opts+'<div class="trip" style="animation:none"><span class="skel" style="width:46%;height:20px"></span><span class="skel" style="margin:14px 0 12px;height:8px"></span><span class="skel" style="width:70%"></span></div>'.repeat(3);
    if(state.tripError)return opts+`<div class="state">${ico('alert')}<b>${tr('Reisesøket feilet')}</b>${esc(state.tripError)}<button class="btn btn-ink press" id="tripRetry" type="button">${tr('Prøv igjen')}</button></div>`;
    if(!state.trips.length)return opts+`<div class="state">${ico('route')}<b>${tr('Ingen reiser funnet')}</b>${tr('Prøv et annet tidspunkt eller et sted i nærheten.')}</div>`;
    const ps=state.trips,fastest=Math.min(...ps.map(p=>p.duration));
    const fastestIdx=ps.some(p=>p.duration>fastest)?ps.findIndex(p=>p.duration===fastest):-1;
    return opts+ps.map((p,i)=>tripCard(p,i,i===fastestIdx)).join('');
  },
  bind(){
    $('#editTrip').onclick=()=>{buzz(6);router.go('search');};
    bindTripOpts();
    $('#tripRetry')?.addEventListener('click',()=>startTripSearch(true));
    $$('#sheetPage .trip[data-p]').forEach(el=>el.onclick=()=>{buzz(10);
      state.tripIdx=+el.dataset.p;drawRoute(state.trips[state.tripIdx]);router.go('trip',{i:state.tripIdx},{hero:el.querySelector('.t')});});
  },
  // Hvert 20. sek: tell ned ringene og flytt kjøretøyene i sporene uten å tegne kortene på nytt.
  update(){
    const cards=$$('#sheetPage .trip[data-p]');
    if(!cards.length||cards.length!==state.trips.length||state.tripsLoading){
      // Reisevalgene beholdes når de er like, så et nytt valg glir over mens forslagene lastes.
      const o=$('#sheetPage .opts'),html=o?.outerHTML;router.render(null);
      const n=$('#sheetPage .opts');if(o&&n&&n.outerHTML===html)n.replaceWith(o);
      return;}
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
  await Promise.all(ids.map(async id=>{try{const d=await sjQuery(Q_SJ_CALLS,id);const c=d.serviceJourney?.estimatedCalls;if(c?.length)tripCalls.set(id,{calls:c,t:Date.now()});}catch(e){report('loadTripCalls',e);}}));
  if(router.cur.name==='results')router.refresh();
}
const firstRide=p=>(p.legs||[]).find(l=>l.mode!=='foot');
// Lite spor: de siste stoppene før påstigning, med kjøretøyet som glir inn mot din holdeplass.
const AP_N=8;
function approachHtml(l){
  const entry=tripCalls.get(l.serviceJourney?.id),place=esc(placeName(l.fromPlace,''));
  const plain=`<span class="ap-name">${place}</span>`,planned=`<span class="ap-name">${place} <time>${fmtT(l.expectedStartTime)}</time></span>`;
  const alone=`<div class="ap">${ico('stop','ap-ico')}${planned}</div>`;
  if(!entry)return alone;
  const c=entry.calls,board=nearestCallIdx(c,l.fromPlace?.quay,l.fromPlace?.name,ts(l.expectedStartTime)),e=callPos(c);
  if(board<0||!e||e.state==='start'||Date.now()>=depT(c[board])||board-e.at>AP_N*2)return alone;
  const pos=e.state==='start'?-1:e.at+e.f,away=Math.max(0,board-pos),start=board-AP_N;
  const pct=Math.max(0,Math.min(100,(pos-start)/AP_N*100)),far=pos<start;
  const n=Math.ceil(away),code=esc(l.line?.publicCode||modeOf(l.mode).n),name=`${modeOf(l.mode).n} ${code}`;
  const label=e.state==='start'?tr('{name} har ikke startet ennå',{name}):n<=0?tr('{name} er ved holdeplassen',{name}):tn(n,'{name} er {n} stopp unna','{name} er {n} stopp unna',{name});
  const dots=Array.from({length:AP_N},(_,i)=>`<i style="left:${i/AP_N*100}%"${start+i<=pos?' class="on"':''}></i>`).join('');
  return`<div class="ap" role="img" aria-label="${esc(label)}" title="${esc(label)}"><span class="ap-track" style="${modeStyle(l.mode)}">
    <span class="ap-rail"><i style="width:${pct}%"></i></span>${dots}<i class="ap-end"></i>
    <span class="ap-veh${far?' far':''}" style="left:${pct}%">${code}</span></span>${plain}</div>`;
}
function tripCard(p,i,isFastest){
  const legs=p.legs||[],rides=legs.filter(l=>l.mode!=='foot'),first=rides[0];
  const total=legs.reduce((s,l)=>s+(l.duration||0),0)||1;
  // Stripen er reisen: lengden er tiden, fargen er linjen, tallet står inni.
  const segs=legs.filter(l=>l.mode!=='foot'||l.duration>=60).map((l,j)=>{
    const w=Math.max(.06,(l.duration||0)/total),d=`animation-delay:${i*50+j*45}ms`;
    if(l.mode==='foot')return`<span class="seg walk" style="flex:${w} 1 0;${d}" title="${tr('Gå {n} min',{n:Math.round(l.duration/60)})}">${ico('walk')}<b>${Math.round(l.duration/60)}</b></span>`;
    const md=modeOf(l.mode),code=l.line?.publicCode||md.n,a=alertFor(code);
    // Piktogrammet får plass når etappen er lang nok i stripen.
    return`<span class="seg ride${a?` has-alert ${a.sev}`:''}" style="flex:${w} 1 0;${modeStyle(l.mode)};${d}" title="${md.n} ${esc(code)}${a?` – ${esc(a.summary)}`:''}">${w>=.22?modeIcon(l.mode):''}<b>${esc(code)}</b></span>`;
  }).join('')||`<span class="seg walk" style="flex:1">${ico('walk')}<b>${Math.round(p.duration/60)}</b></span>`;
  const leave=minUntil(p.expectedStartTime);
  return`<button class="trip${i===state.tripIdx?' sel':''}" type="button" data-p="${i}" style="animation-delay:${i*50}ms">
    ${ringHtml(leave,{aria:'Gå om',clock:fmtT(p.expectedStartTime),until:ts(p.expectedStartTime)})}
    <div class="trip-main"><div class="trip-top"><span class="t">${fmtT(p.expectedStartTime)}<span>–</span>${fmtT(p.expectedEndTime)}</span>
      <span class="dur">${Math.round(p.duration/60)} min</span>${isFastest?`<span class="fast">${tr('Raskest')}</span>`:''}</div>
    <div class="stripe" role="img" aria-label="${esc(changesText(Math.max(0,rides.length-1)))}">${segs}</div>
    ${first?approachHtml(first):''}</div></button>`;
}

/* ---------- Reisevalg ----------
   Øverst i forslagene: færre bytter, trinnfri gange og gangfart. Endres et valg, søkes det på nytt
   med en gang, og valget huskes (også for snarveiene Hjem og Jobb). */
const WALK_STEPS=[[3.5,'Rolig gange'],[4.5,'Vanlig gange'],[5.5,'Rask gange']];
function setTripPref(k,v){settings[k]=v;if(k==='walkKmh')coreCfg.walkKmh=v;saveSettings();shortcuts.clear();}
function tripOptsHtml(){
  const w=settings.walkKmh,steps=WALK_STEPS.some(([v])=>v===w)?WALK_STEPS:[...WALK_STEPS,[w,tr('Gange {x} km/t',{x:fmtDec(w)})]].sort((a,b)=>a[0]-b[0]);
  return`<div class="opts" role="group" aria-label="${tr('Reisevalg')}">
    <button class="chip press" type="button" data-opt="fewerChanges" aria-pressed="${!!settings.fewerChanges}">${morphIco('fewer','check')}${tr('Færre bytter')}</button>
    <button class="chip press" type="button" data-opt="stepFree" aria-pressed="${!!settings.stepFree}">${morphIco('access','check')}${tr('Trinnfritt')}</button>
    <label class="chip chip-sel">${ico('walk')}<select id="walkSel" aria-label="${tr('Gangfart')}">${steps.map(([v,l])=>`<option value="${v}"${v===w?' selected':''}>${tr(l)}</option>`).join('')}</select></label>
  </div>${settings.stepFree?`<p class="opts-note">${tr('Trinnfritt gjelder gangveien. Entur vet ennå ikke om alle holdeplasser og kjøretøy er trinnfrie.')}</p>`:''}`;
}
function bindTripOpts(){
  // Brikken skifter på stedet (hake og farge glir over), så søkes det på nytt.
  $$('#sheetPage [data-opt]').forEach(b=>b.onclick=()=>{buzz(6);const on=!settings[b.dataset.opt];b.setAttribute('aria-pressed',String(on));
    setTripPref(b.dataset.opt,on);startTripSearch();});
  $('#walkSel')&&($('#walkSel').onchange=e=>{setTripPref('walkKmh',+e.target.value);startTripSearch();});
}
/* ---------- Handlinger for valgt reise: varsel, del ankomst og billett ---------- */
function tripActionsHtml(p){
  const rides=(p.legs||[]).some(l=>l.mode!=='foot'),on=goAlert.trip===p&&!goAlert.fired,tk=ticketLink();
  return`<div class="opts trip-actions" role="group" aria-label="${tr('Valg for reisen')}">
    ${canNotify()&&rides?`<button class="chip press" type="button" id="goAlertBtn" aria-pressed="${on}">${morphIco('bell','bell-on')}<span class="lab">${alertLabel(p,on)}</span></button>`:''}
    <button class="chip press" type="button" id="shareBtn">${morphIco('share','check')}<span class="lab">${tr('Del ankomst')}</span></button>
    ${rides?`<a class="chip press" id="ticketBtn" href="${tk.href}" target="_blank" rel="noopener" aria-label="${tr('Billett: kjøp i Ruter-appen ({where})',{where:tk.where})}">${ico('ticket')}${tr('Billett')}</a>`:''}
  </div>`;
}
function bindTripActions(){
  const p=state.trips[state.tripIdx];if(!p)return;
  $('#goAlertBtn')?.addEventListener('click',()=>toggleGoAlert(p));
  $('#shareBtn')?.addEventListener('click',()=>shareArrival(p));
  $('#ticketBtn')?.addEventListener('click',()=>buzz(6));
}
const alertLabel=(p,on)=>on?tr('Varsel kl. {t}',{t:fmtT(alertAt(p))}):tr('Varsle meg');
function tripActionsUpdate(){
  const box=$('#tripActions'),p=state.trips[state.tripIdx];
  if(!box||router.cur.name!=='trip'||!p)return;
  // Varselknappen endres på stedet, så bjella og fargen glir over i stedet for å hoppe.
  const b=$('#goAlertBtn',box),on=goAlert.trip===p&&!goAlert.fired;
  if(b){b.setAttribute('aria-pressed',String(on));$('.lab',b).textContent=alertLabel(p,on);return;}
  box.innerHTML=tripActionsHtml(p);bindTripActions();
}

/* ---------- Side: Reisen ---------- */
pages.trip={
  initial:'half',peek:150,
  head(){
    const p=state.trips[state.tripIdx];if(!p)return backBtn();
    const rides=(p.legs||[]).filter(l=>l.mode!=='foot');
    return`${backBtn()}<div class="titles"><div class="head-title">${fmtT(p.expectedStartTime)}\u2009–\u2009${fmtT(p.expectedEndTime)}</div>
      <div class="head-sub">${Math.round(p.duration/60)} min · ${changesText(Math.max(0,rides.length-1))}${p.walkDistance?' · '+tr('{d} gange',{d:fmtDist(p.walkDistance)}):''}</div></div>
      <button class="icon-btn press" id="fitRoute" type="button" aria-label="${tr('Vis hele reisen')}">${ico('expand')}</button>
      <button class="icon-btn press" id="closeTrip" type="button" aria-label="${tr('Avslutt')}">${ico('x')}</button>`;
  },
  body(){
    const p=state.trips[state.tripIdx];if(!p)return'';
    const legs=p.legs||[];
    const steps=legs.map((l,i)=>{
      const walk=l.mode==='foot',md=modeOf(l.mode);
      const place=esc(i===0?placeName(l.fromPlace,p.fromName):placeName(l.fromPlace,tr('Bytte')));
      let what,extra='';
      if(walk)what=`<span class="wk">${ico('walk')}<b>${Math.max(1,Math.round(l.duration/60))}</b> min</span><small>${fmtDist(l.distance||0)}</small>`;
      else{
        const code=l.line?.publicCode||md.n,toward=l.fromEstimatedCall?.destinationDisplay?.frontText,q=l.fromPlace?.quay?.publicCode;
        what=`${lineBadge(code,l.mode,'badge-l',true,true)}${toward?`<span class="to">${ico('arrow')}<span>${esc(toward)}</span></span>`:''}
          <span class="leg-tags">${q?quayChip(l.mode,q):''}${l.realtime?liveDot():''}${occHtml(l.fromEstimatedCall?.occupancyStatus)}</span>`;
        const al=alertFor(code,{all:true});
        if(al)extra=`<button class="leg-alert press${al.sev==='info'?' info':''}" type="button" data-alerts>${ico(al.sev==='info'?'info':'alert')}<span>${esc(al.summary)}</span></button>`;
      }
      const stops=walk?[]:(l.intermediateEstimatedCalls||[]).filter(c=>c.quay?.name);
      // Stoppene underveis er prikker på skinnen; trykk for navn og tider.
      const details=walk||!p.stopDetailsAvailable||!stops.length?'':`<details><summary><span class="sdots">${'<i></i>'.repeat(Math.min(stops.length,10))}</span>${tn(stops.length,'{n} stopp','{n} stopp')}</summary>
        <ol>${stops.map(c=>`<li><span>${esc(c.quay.name)}</span>${c.expectedArrivalTime?`<time>${fmtT(c.expectedArrivalTime)}</time>`:''}</li>`).join('')}</ol></details>`;
      const done=ts(l.expectedEndTime)<Date.now();
      return`<div class="leg${walk?' walk':''}${done?' done':''}" data-li="${i}" style="${walk?'--c:var(--ink-3)':modeStyle(l.mode)}"><time>${fmtT(l.expectedStartTime)}</time>
        <span class="rail"><span class="node"></span>${walk?'':`<span class="rveh" hidden>${esc(l.line?.publicCode||'')}</span>`}</span>
        <div class="body"><div class="place">${place}</div><div class="what">${what}</div>${extra}${details}</div></div>`;
    }).join('');
    const last=legs[legs.length-1];
    return'<div class="live-status" id="liveStatus" hidden></div>'+`<div id="tripActions">${tripActionsHtml(p)}</div>`+
      (p.schematic?`<div class="jnote">${tr('Kartlinjen er forenklet. Følg stoppene og byttene her.')}</div>`:'')+steps+
      `<div class="leg end"><time>${fmtT(p.expectedEndTime)}</time><span class="rail"><span class="node"></span></span>
      <div class="body"><div class="place">${esc(placeName(last?.toPlace,p.toName))}</div></div></div>`;
  },
  bind(){
    $('#fitRoute')?.addEventListener('click',()=>{buzz(6);fitRoute();});
    $('#closeTrip')?.addEventListener('click',()=>{buzz(6);router.home();});
    bindTripActions();
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
// Undertittel: avstand og gangtid, eller hvor gamle avgangene er når de er hentet fra lageret.
const stopSubText=(e,d)=>e?.stale&&e.t?ageText(e.t):d!=null?`${fmtDist(d)} · ${tr('{n} min å gå',{n:walkMin(d)})}`:tr('Holdeplass');
pages.stop={
  initial:'half',peek:168,
  head({id}){
    const s=findStop(id)||{name:state.deps.get(id)?.name||tr('Holdeplass')},d=s.lat!=null?distTo(s):null,fav=favs.some(f=>f.id===id);
    return`${backBtn()}<div class="titles"><div class="head-title">${esc(s.name)}</div><div class="head-sub" id="stopSub">${stopSubText(state.deps.get(id),d)}</div></div>
      <button class="star press" id="favBtn" type="button" aria-pressed="${fav}" aria-label="${fav?tr('Fjern fra favoritter'):tr('Legg til i favoritter')}">${ico('star')}</button>`;
  },
  body({id}){
    const s=findStop(id)||{id},entry=state.deps.get(id);
    if(!entry)return'<div class="dep"><span class="skel" style="height:28px"></span><span class="skel"></span><span class="skel"></span></div>'.repeat(4);
    const rows=upcoming(id);
    const modes=[...new Set(rows.map(r=>r.mode))];
    const f=stopFilter.get(id);
    const filters=modes.length>1?`<div class="filters" role="group" aria-label="${tr('Filtrer')}">${['all',...modes].map(m=>
      `<button class="filter press" type="button" data-m="${m}" ${m!=='all'?`style="${modeStyle(m)}"`:''} aria-pressed="${(f||'all')===m}">${m==='all'?tr('Alle'):`${modeIcon(m)}${modeOf(m).n}`}</button>`).join('')}</div>`:'';
    const list=rows.filter(r=>!f||r.mode===f),st={...s,stale:entry.stale};
    const al=[...new Set(rows.map(r=>String(r.pub)))].map(c=>alertFor(c)).filter((a,i,arr)=>a&&arr.indexOf(a)===i);
    const alertRow=al.length?`<button class="leg-alert stop-alert press" type="button" data-alerts>${ico('alert')}<span>${esc(al[0].summary)}</span>${al.length>1?`<em>+${al.length-1}</em>`:''}</button>`:'';
    // Tidslinjen viser de nærmeste avgangene; listen tar bare resten, så ingenting står to ganger.
    const tl=stopTimeline(st,list),later=list.filter(r=>!tl.shown.has(r));
    const rest=entry.error&&!rows.length?`<div class="state">${ico('alert')}<b>${tr('Fikk ikke hentet avganger')}</b>${tr('Prøv igjen om litt.')}</div>`:
      !list.length?`<div class="state">${tr('Ingen avganger den neste timen')}.</div>`:
      later.length?(tl.html?`<div class="label">${tl.hidden?tr('Flere avganger'):tr('Senere')}</div>`+later.slice(0,40).map(r=>depRowCompact(st,r)).join(''):later.map(r=>depRow(st,r)).join('')):'';
    return`<div id="stopTop">${alertRow}${filters}</div><div id="stopTl">${tl.html}</div><div id="stopRest">${rest}</div>`+
      `<p class="note">${tr('Trykk på en avgang for å se hvor den er nå. Det skraverte feltet er tiden du trenger for å gå til holdeplassen.')}</p>`;
  },
  bind({id}){
    updateStopCallout(id);
    $('#favBtn').onclick=()=>toggleFav(id);
    this.bindRows(id);
  },
  bindRows(id){
    $$('#sheetPage [data-alerts]').forEach(b=>b.onclick=()=>{buzz(6);router.go('alerts');});
    $$('#sheetPage .filter').forEach(b=>b.onclick=()=>{if(b.getAttribute('aria-pressed')==='true')return;buzz(6);
      // Brikken skifter på stedet, så fargen glir over; avgangene under tones inn som bekreftelse.
      $$('#sheetPage .filter').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
      stopFilter.set(id,b.dataset.m==='all'?null:b.dataset.m);router.refresh();
      ['#stopTl','#stopRest'].forEach(s=>{const el=$(s);if(el){el.classList.remove('refade');void el.offsetWidth;el.classList.add('refade');}});});
    $$('#sheetPage .dep[data-sj],#sheetPage .tl-dot[data-sj]').forEach(b=>b.onclick=()=>{if(!b.dataset.sj)return;buzz(6);
      openJourney(b.dataset.sj,id,b.classList.contains('tl-dot')?b:b.querySelector('.badge'),+b.dataset.at);});
  },
  // Oppdatering på stedet: prikkene glir mot «nå» i stedet for å tegnes på nytt.
  update(params){
    const t=document.createElement('div');t.innerHTML=this.body(params);
    const page=$('#sheetPage'),o={top:$('#stopTop',page),tl:$('#stopTl',page),rest:$('#stopRest',page)};
    const n={top:$('#stopTop',t),tl:$('#stopTl',t),rest:$('#stopRest',t)};
    if(!o.tl||!n.tl){router.render(null);return;}
    const nm=findStop(params.id)?.name||state.deps.get(params.id)?.name,ht=$('#sheetHead .head-title');if(nm&&ht&&ht.textContent!==nm)ht.textContent=nm;
    const sub=$('#stopSub'),fs=findStop(params.id),d=fs?.lat!=null?distTo(fs):null;
    if(sub)sub.textContent=stopSubText(state.deps.get(params.id),d);
    // Filterraden byttes bare når den er endret: da glir valget over, og raden beholder rulleposisjonen.
    if(o.top.innerHTML!==n.top.innerHTML)o.top.innerHTML=n.top.innerHTML;o.rest.innerHTML=n.rest.innerHTML;
    morphTl(o.tl,n.tl);
    this.bindRows(params.id);updateStopCallout(params.id);
  },
  leave(){if(mapLoaded){map.setFilter('stop-sel',['==',['get','id'],'']);map.setFilter('stop-cards',['all',['has','card'],['!=',['get','id'],'']]);}removeStopCallout();},
  enter({id}){
    if(mapLoaded){map.setFilter('stop-sel',['==',['get','id'],id]);map.setFilter('stop-cards',['all',['has','card'],['!=',['get','id'],id]]);}
    const s=findStop(id);
    if(s&&mapLoaded){
      // Holdeplassen litt under midten, så boblen med avganger får plass over den.
      map.easeTo({center:[s.lon,s.lat],zoom:Math.max(map.getZoom(),15.5),offset:[0,70],duration:reduceMotion.matches?0:700,easing:easeOut,padding:mapPadding()});
      setFollow(false);
    }
    loadStopDeps(id,true).then(()=>{if(router.cur.name==='stop'&&router.cur.params.id===id)router.refresh();});
  }
};
/* ---------- Side: Turen ----------
   Én bestemt avgang: hele ruten på kartet (kjørt strekning nedtonet),
   kjøretøyet live, alle stopp med tider, og hvor langt den er fra «din»
   holdeplass – den du trykket på, eller stoppet på ruten nærmest deg. */
const jv={sj:null,job:null,stopIdx:-1,timer:0,fitted:false,loading:false,error:null,hint:null};
// Åpne en tur fra en avgang ved en holdeplass, med linjeskiltet som følger med opp i overskriften.
// at: planlagt tid for avgangen du trykket på. En ringlinje har to avganger med samme tur, og turen
// åpnes på den passeringen du valgte.
function openJourney(sj,stopId,heroEl,at=NaN){
  if(!sj)return;
  const rows=state.deps.get(stopId)?.rows||[],r=rows.find(x=>x.sj===sj&&x.aimed===at)||rows.find(x=>x.sj===sj);
  jv.hint=r?{sj,code:r.pub,mode:r.mode,dest:r.dest}:null;
  const t=r?r.aimed:at;
  router.go('journey',{sj,stop:stopId,...(r?.date?{date:r.date}:{}),...(Number.isFinite(t)?{at:t}:{})},{hero:heroEl});
}
function jvTrip(job,stopIdx){ // pseudo-reise så live-motoren (status, kjøretøy) kan gjenbrukes
  const c=job.calls,b=c[stopIdx]||c[0],last=c[c.length-1];
  const q=x=>({name:x.quay?.name,quay:{latitude:x.quay?.latitude,longitude:x.quay?.longitude}});
  const leg={journey:true,noStop:stopIdx<0,mode:job.mode,line:{publicCode:job.code},serviceJourney:{id:job.sj},fromPlace:q(b),toPlace:q(last),
    expectedStartTime:new Date(depT(b)).toISOString(),expectedEndTime:new Date(arrT(last)).toISOString()};
  return{legs:[leg],expectedStartTime:leg.expectedStartTime,expectedEndTime:leg.expectedEndTime};
}
const Q_SJ_FULL=`query($id:String!,$date:Date){serviceJourney(id:$id){id line{publicCode transportMode} pointsOnLink{points}
  estimatedCalls(date:$date){realtime aimedArrivalTime expectedArrivalTime expectedDepartureTime actualArrivalTime actualDepartureTime aimedDepartureTime
    destinationDisplay{frontText} quay{id name latitude longitude publicCode stopPlace{id parent{id}}}}}}`;
async function loadJourney(sjId,stopId,date=null,at=NaN){
  jv.loading=true;jv.error=null;
  try{
    const d=await sjQuery(Q_SJ_FULL,sjId,date);const sj=d.serviceJourney;if(!sj)throw new Error(tr('Fant ikke turen'));
    const calls=sj.estimatedCalls||[];
    if(!calls.length)throw new Error(tr('Turen har ingen stopp i dag'));
    const pts=sj.pointsOnLink?.points?decodePoly(sj.pointsOnLink.points):calls.filter(c=>c.quay).map(c=>[c.quay.longitude,c.quay.latitude]);
    const cum=prepPath(pts);
    const job={sj:sjId,code:sj.line?.publicCode||'',mode:sj.line?.transportMode||'bus',calls,pts,cum,stopS:projectStops(pts,cum,calls),
      dest:calls[0]?.destinationDisplay?.frontText||calls[calls.length-1]?.quay?.name||''};
    // Knutepunkt (f.eks. Jernbanetorget) har plattformer under et barnestoppested: sjekk også forelder, så navn.
    // Ringlinjer passerer samme holdeplass to ganger: velg passeringen nærmest avgangstiden du trykket på.
    const stopName=stopId&&findStop(stopId)?.name,closest=m=>m.length>1&&Number.isFinite(at)?
      m.reduce((a,b)=>Math.abs(ts(calls[b].aimedDepartureTime||calls[b].aimedArrivalTime)-at)<Math.abs(ts(calls[a].aimedDepartureTime||calls[a].aimedArrivalTime)-at)?b:a):(m[0]??-1);
    const where=f=>calls.map((c,i)=>f(c)?i:-1).filter(i=>i>=0);
    let idx=stopId?closest(where(c=>c.quay?.stopPlace?.id===stopId||c.quay?.stopPlace?.parent?.id===stopId)):-1;
    if(idx<0&&stopName)idx=closest(where(c=>c.quay?.name===stopName));
    if(idx<0&&state.pos){ // nærmeste stopp på ruten fra der du står (innen 1,5 km), og som ikke er passert
      const e=estimate(job);let best=-1,bd=1500;
      calls.forEach((c,i)=>{if(!c.quay||(e&&i<=e.at&&e.state!=='start'))return;const dd=geoDist(state.pos,[c.quay.latitude,c.quay.longitude]);if(dd<bd){bd=dd;best=i;}});
      idx=best;
    }
    jv.job=job;jv.stopIdx=idx;
  }catch(e){jv.error=e.message||tr('Ukjent feil');}
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
  map.fitBounds(b,{padding:{top:50,bottom:50,left:50,right:50},maxZoom:16.5,duration:reduceMotion.matches?0:900,easing:easeOut});
}
pages.journey={
  initial:'half',peek:176,
  head(params={}){
    const j=jv.job,h=jv.hint;
    // Før turen er hentet: linjeskilt og retning fra avgangen du trykket på, så overgangen har et mål.
    if(!j&&h&&h.sj===params.sj){const md=modeOf(h.mode);
      return`${backBtn()}<div class="titles jv-title">${lineBadge(h.code||md.n,h.mode,'badge-l',false,true)}
        <div><div class="head-title">${esc(h.dest)}</div><div class="head-sub">${tr('Henter turen…')}</div></div></div>`;}
    if(!j)return`${backBtn()}<div class="titles"><div class="head-title">${tr('Henter turen…')}</div></div>`;
    const md=modeOf(j.mode);
    return`${backBtn()}<div class="titles jv-title">${lineBadge(j.code||md.n,j.mode,'badge-l',false,true)}
      <div><div class="head-title">${esc(j.dest)}</div><div class="head-sub">${md.n} ${esc(j.code)} · ${tn(j.calls.length,'{n} stopp','{n} stopp')}</div></div></div>
      <button class="icon-btn press" id="jvFit" type="button" aria-label="${tr('Vis hele turen')}">${ico('expand')}</button>`;
  },
  body(){
    if(jv.error)return`<div class="state">${ico('alert')}<b>${tr('Fikk ikke hentet turen')}</b>${esc(jv.error)}</div>`;
    if(jv.loading||!jv.job)return'<div class="dep"><span class="skel" style="height:28px"></span><span class="skel"></span><span class="skel"></span></div>'.repeat(3);
    const j=jv.job,e=estimate(j),sc=j.calls[jv.stopIdx];
    let walk='';
    if(sc?.quay&&state.pos){const d=Math.round(geoDist(state.pos,[sc.quay.latitude,sc.quay.longitude])),reach=reachStatus(d,arrT(sc));
      walk=`<div class="jv-walk">${ico('walk')}<span><b>${walkMin(d)} min</b> <small>${fmtDist(d)}</small><span class="sr-only">${tr(' å gå til {stop}',{stop:esc(sc.quay.name)})}</span></span>${reach?`<span class="reach ${reach.cls}">${esc(reach.label)}</span>`:''}</div>`;}
    const rows=j.calls.map((c,i)=>{
      const passed=e&&e.state!=='start'&&i<=e.at,here=e&&i===e.at&&e.state==='stop',mine=i===jv.stopIdx;
      const t=passed?depT(c):arrT(c),late=Math.round((arrT(c)-ts(c.aimedArrivalTime))/60000);
      const veh=e&&((e.state==='moving'&&i===e.at)||(e.state==='start'&&i===0&&false));
      return`<div class="jv-stop${passed?' passed':''}${mine?' mine':''}${here?' here':''}" data-i="${i}">
        <time>${fmtT(t)}${!passed&&late>0?`<small class="late">+${late}</small>`:''}</time>
        <span class="jv-rail" style="${modeStyle(j.mode)}"><i></i>${here?`<em class="jv-veh">${esc(j.code)}</em>`:''}</span>
        <span class="jv-name">${esc(c.quay?.name||tr('Stopp'))}${mine?`<small>${tr('Din holdeplass')}</small>`:''}</span></div>
        ${veh?`<div class="jv-between"><span></span><span class="jv-rail" style="${modeStyle(j.mode)}"><i></i><em class="jv-veh moving">${esc(j.code)}</em></span><span class="jv-note">${tr('Underveis')}</span></div>`:''}`;
    }).join('');
    return`<div class="jv-sticky"><div class="live-status" id="liveStatus" hidden></div>${walk}</div><div class="jv-list">${rows}</div>
      <p class="note">${e&&e.state==='done'?tr('Turen er fullført.'):tr('Posisjonen er GPS der operatøren deler den, ellers beregnet fra sanntid.')}</p>`;
  },
  bind(){
    $('#jvFit')?.addEventListener('click',()=>{buzz(6);fitJourney();});
    $$('#sheetPage .jv-stop').forEach(r=>r.onclick=()=>{const c=jv.job?.calls[+r.dataset.i];if(!c?.quay)return;buzz(6);
      map.easeTo({center:[c.quay.longitude,c.quay.latitude],zoom:Math.max(map.getZoom(),15.5),duration:reduceMotion.matches?0:600});});
    updateLiveBox();
    // Hold «her er kjøretøyet» i listen i synsfeltet første gang.
    if(!jv.scrolled){const h=$('#sheetPage .jv-stop.here,#sheetPage .jv-between');if(h){jv.scrolled=true;setTimeout(()=>h.scrollIntoView({block:'center'}),60);}}
  },
  async enter({sj,stop,date,at}){
    fcClose();clearRoute();clearPins();setData('vehicles',EMPTY);
    if(jv.sj!==sj||!jv.job){jv.sj=sj;jv.job=null;jv.scrolled=false;jv.loading=true;router.render(null);await loadJourney(sj,stop,date,at);}
    if(router.cur.name!=='journey'||jv.sj!==sj)return;
    router.render(null);
    if(!jv.job)return;
    drawJourney();fitJourney();
    startLive(jvTrip(jv.job,jv.stopIdx));
    // Kjørt strekning og stoppfarger følger kjøretøyet; listen oppdateres hvert 20. sek.
    clearInterval(jv.timer);
    jv.timer=setInterval(()=>{if(document.hidden||mapCovered()||router.cur.name!=='journey')return;
      const job=live.jobs[0];if(job?.calls)jv.job.calls=job.calls;drawJourney();},3000);
  },
  leave(){clearInterval(jv.timer);stopLive();setData('route',EMPTY);setData('route-stops',EMPTY);jv.sj=null;}
};

/* ---------- Side: Trafikkmeldinger ---------- */
pages.alerts={
  snaps:['full'],initial:'full',
  head(){return`${backBtn()}<div class="titles"><div class="head-title">${tr('Trafikkmeldinger')}</div><div class="head-sub">${state.alertsAt?tr('Oppdatert kl. {t}',{t:fmtT(state.alertsAt)}):tr('Henter…')}</div></div>`;},
  body(){
    if(!state.alerts.length)return`<div class="state">${ico('check')}<b>${tr('Ingen avvik')}</b>${tr('Trafikken går som normalt.')}</div>`;
    const fmtWhen=ts=>{const d=new Date(ts),today=d.toDateString()===new Date().toDateString(),at=tr('kl. {t}',{t:fmtT(d)});
      return today?at:`${d.toLocaleDateString(locale(),{day:'numeric',month:'short'})} ${at}`;};
    const mine=myLines();
    // Linjene rundt deg står i linjens farge, når vi vet transportmiddelet fra avgangene vi har hentet.
    const modeByLine=new Map();state.deps.forEach(e=>(e.rows||[]).forEach(r=>modeByLine.set(String(r.pub),r.mode)));
    const badge=l=>mine.has(l)&&modeByLine.has(l)?lineBadge(l,modeByLine.get(l),'',false):`<span class="badge ${mine.has(l)?'neutral':'dim'}">${esc(l)}</span>`;
    const item=(a,i)=>{
      const t=a.start&&a.end?tr('Fra {from} til {to}',{from:fmtWhen(a.start),to:fmtWhen(a.end)}):a.start?tr('Fra {from}',{from:fmtWhen(a.start)}):a.end?tr('Gjelder til {to}',{to:fmtWhen(a.end)}):'';
      const ls=(a.lines||[]).slice(0,6).map(badge).join(''),desc=a.desc&&a.desc!==a.summary?a.desc:'',long=desc.length>140;
      return`<article class="alert" style="animation-delay:${Math.min(i,8)*30}ms"><span class="sev ${a.sev}" aria-hidden="true"></span><div>
        ${ls?`<div class="alert-lines">${ls}</div>`:''}<h4>${esc(a.summary)}</h4>${desc?`<p id="ad${i}"${long?' class="clamp"':''}>${esc(desc)}</p>`:''}
        ${long?`<button class="more press" type="button" aria-expanded="false" aria-controls="ad${i}">${tr('Vis mer')}</button>`:''}${t?`<time>${t}</time>`:''}</div></article>`;};
    // Avvik som rammer linjene rundt deg først, så andre avvik, og planlagte endringer til slutt.
    const now=state.alerts.filter(a=>a.sev!=='info'),planned=state.alerts.filter(a=>a.sev==='info');
    const rel=now.filter(a=>(a.lines||[]).some(l=>mine.has(l))),rest=now.filter(a=>!rel.includes(a));
    // «Rundt deg» står åpent; resten av Ruter-området og planlagte endringer er foldet sammen med antall.
    let i=0;const sec=(label,list,open)=>!list.length?'':open?`<div class="label">${label}</div>${list.map(a=>item(a,i++)).join('')}`:
      `<details class="alert-sec"><summary class="label">${label}<em>${list.length}</em>${ico('chev')}</summary>${list.map(a=>item(a,i++)).join('')}</details>`;
    return sec(tr('Rundt deg'),rel,true)+sec(rel.length?tr('Andre avvik i Ruter-området'):tr('Avvik nå'),rest,!rel.length)+sec(tr('Planlagte endringer'),planned,false);
  },
  bind(){
    $$('#sheetPage .alert .more').forEach(b=>b.onclick=()=>{buzz(6);
      const open=$('#'+b.getAttribute('aria-controls')).classList.toggle('open');
      b.setAttribute('aria-expanded',String(open));b.textContent=open?tr('Vis mindre'):tr('Vis mer');});
  }
};

/* ---------- Side: Innstillinger ---------- */
// Diagnostikk: feil appen har tålt og hvor mange kall den har gjort mot Entur siste time.
function diagHtml(){
  const n=diag.errors.length,calls=diag.calls.filter(t=>t>Date.now()-3600000).length;
  return`<details class="group diag" style="margin-top:14px"><summary class="row-item"><span class="lbl"><b>${tr('Diagnostikk')}</b>
      <small>${diag.count?tn(diag.count,'{n} feil denne økten','{n} feil denne økten'):tr('Ingen feil denne økten')} · ${tn(calls,'{n} kall til Entur siste time','{n} kall til Entur siste time')}</small></span>${ico('chev')}</summary>
    ${n?`<ol class="diag-list">${diag.errors.map(e=>`<li><time>${fmtT(e.t)}</time><b>${esc(e.where)}</b><span>${esc(e.msg)}</span></li>`).join('')}</ol>`:''}
    <button class="row-item press" id="diagCopy" type="button"><span class="lbl"><b class="lab">${tr('Kopier diagnostikk')}</b><small>${tr('Lim inn i en feilmelding')}</small></span>${ico('check','done-ico')}</button></details>`;
}
pages.settings={
  snaps:['full'],initial:'full',
  head(){return`${backBtn()}<div class="titles"><div class="head-title">${tr('Innstillinger')}</div></div>`;},
  body(){
    const walk=fmtDec(settings.walkKmh),seg=(id,label,key,opts)=>`<div class="row-item"><span class="lbl"><b>${label}</b></span><div class="segmented" id="${id}" role="group" aria-label="${label}" style="--n:${opts.length};--i:${Math.max(0,opts.findIndex(([k])=>settings[key]===k))}">
        ${opts.map(([k,l])=>`<button type="button" data-v="${k}" aria-pressed="${settings[key]===k}"${k==='en'?' lang="en"':k==='nb'?' lang="nb"':''}>${l}</button>`).join('')}</div></div>`;
    return`<div class="group">
      ${seg('themeSeg',tr('Utseende'),'theme',[['auto','Auto'],['light',tr('Lys')],['dark',tr('Mørk')]])}
      ${seg('langSeg',tr('Språk'),'lang',[['auto','Auto'],['nb','Norsk'],['en','English']])}
      <div class="row-item"><span class="lbl"><b>${tr('Gangfart')}</b><small id="walkVal">${tr('{x} km/t',{x:walk})}</small></span>
        <input type="range" id="walkRange" min="3" max="6" step="0.5" value="${settings.walkKmh}" aria-label="${tr('Gangfart')}"></div>
      <label class="row-item" for="vehToggle"><span class="lbl"><b>${tr('Kjøretøy i sanntid')}</b><small>${tr('GPS der operatøren deler den (tog, flybuss, regionbusser). Ruter deler ikke posisjoner, så deres kjøretøy beregnes fra sanntid og vises med stiplet ring.')}</small></span>
        <span class="switch"><input type="checkbox" id="vehToggle" ${settings.showVehicles?'checked':''}><span class="tr"></span></span></label>
      <label class="row-item" for="vibToggle"><span class="lbl"><b>${tr('Vibrasjon')}</b><small>${tr('Kort tilbakemelding ved trykk')}</small></span>
        <span class="switch"><input type="checkbox" id="vibToggle" ${settings.vibrate?'checked':''}><span class="tr"></span></span></label>
    </div>
    <div class="label">${tr('Reisesøk')}</div>
    <div class="group">
      <label class="row-item" for="fewerToggle"><span class="lbl"><b>${tr('Færre bytter')}</b><small>${tr('Reiser med færrest bytter står først')}</small></span>
        <span class="switch"><input type="checkbox" id="fewerToggle" ${settings.fewerChanges?'checked':''}><span class="tr"></span></span></label>
      <label class="row-item" for="stepToggle"><span class="lbl"><b>${tr('Trinnfritt')}</b><small>${tr('Unngår trapper på gangveien. Entur vet ennå ikke om alle holdeplasser og kjøretøy er trinnfrie.')}</small></span>
        <span class="switch"><input type="checkbox" id="stepToggle" ${settings.stepFree?'checked':''}><span class="tr"></span></span></label>
    </div>
    <div class="group" style="margin-top:14px">
      ${canInstall()?`<button class="row-item press" id="installBtn" type="button"><span class="lbl"><b>${tr('Legg til på hjemskjermen')}</b><small>${tr('Åpnes i fullskjerm som en vanlig app')}</small></span>${ico('chev')}</button>`:''}
      <button class="row-item press" id="resetBtn" type="button"><span class="lbl"><b style="color:var(--late)">${tr('Nullstill appen')}</b><small>${tr('Sletter favoritter, nylige mål og innstillinger')}</small></span></button>
    </div>
    ${diagHtml()}
    <div class="about"><svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect class="m-bg" width="64" height="64" rx="15"/><path class="m-line" d="M19 45h9l13-13V19"/><circle class="m-start" cx="19" cy="45" r="4.5"/><circle class="m-end" cx="41" cy="19" r="6"/></svg>
      <div><b>REIS</b><br>${tr('Sanntid og reisesøk fra Entur (åpne data, NLOD). Kart © OpenStreetMap-bidragsytere, OpenMapTiles og OpenFreeMap. Uavhengig app, ikke tilknyttet Ruter AS.')}</div></div>`;
  },
  bind(){
    // Markøren glir til valget, og hele appen tones over til det nye temaet.
    $$('#themeSeg button').forEach(b=>b.onclick=()=>{if(settings.theme===b.dataset.v)return;buzz(6);settings.theme=b.dataset.v;saveSettings();
      segPick($('#themeSeg'),b);crossfade(paintTheme);});
    // Språkbytte gjelder med en gang, uten omstart (applyLang i main.js).
    $$('#langSeg button').forEach(b=>b.onclick=()=>{buzz(6);settings.lang=b.dataset.v;saveSettings();applyLang();});
    $('#walkRange').oninput=e=>{setTripPref('walkKmh',+e.target.value);$('#walkVal').textContent=tr('{x} km/t',{x:fmtDec(settings.walkKmh)});};
    $('#fewerToggle').onchange=e=>{setTripPref('fewerChanges',e.target.checked);buzz(6);};
    $('#stepToggle').onchange=e=>{setTripPref('stepFree',e.target.checked);buzz(6);};
    $('#vehToggle').onchange=e=>{settings.showVehicles=e.target.checked;saveSettings();if(!settings.showVehicles)setData('vehicles',EMPTY);else{refreshVehicles(true);loadEstVehicles(true);}};
    $('#vibToggle').onchange=e=>{settings.vibrate=e.target.checked;saveSettings();buzz(10);};
    $('#installBtn')?.addEventListener('click',doInstall);
    $('#diagCopy')?.addEventListener('click',async()=>{buzz(6);
      const txt=JSON.stringify({app:'REIS',agent:navigator.userAgent,online:navigator.onLine,callsLastHour:diag.calls.length,errors:diag.errors},null,1);
      try{await navigator.clipboard.writeText(txt);flashDone($('#diagCopy'),tr('Kopiert'));}catch(e){report('kopier diagnostikk',e);notify({title:tr('Kunne ikke kopiere'),tone:'warn'});}});
    // Nullstill bekreftes i selve knappen: første trykk spør, andre trykk innen fire sekunder sletter.
    $('#resetBtn').onclick=()=>{
      const b=$('#resetBtn'),lab=$('.lbl b',b);
      if(!b.classList.contains('arm')){buzz(10);b.classList.add('arm');lab.textContent=tr('Trykk igjen for å slette alt');announce(lab.textContent);
        clearTimeout(b._arm);b._arm=setTimeout(()=>{b.classList.remove('arm');lab.textContent=tr('Nullstill appen');},4000);return;}
      ['reisFavs','reisSettings','reisDepCache','reisRecentTargets','reisOnboarded','reisPlaces'].forEach(k=>{try{localStorage.removeItem(k);}catch(e){/* lagring kan være slått av (privat modus) */}});
      location.reload();};
  }
};
$('#searchBar').onclick=()=>{buzz(8);router.go('search',{focus:'to'});};
$('#menuBtn').onclick=()=>{buzz(6);router.go('settings');};
