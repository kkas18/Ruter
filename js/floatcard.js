'use strict';
/* REIS – Flytekortet på kartet for holdeplasser og kjøretøy. */

/* =====================================================================
   FLYTEKORT
   Et lite glasskort som hører til et punkt på kartet (holdeplass eller
   kjøretøy) og er koblet til det med en tynn linje. Kortet kan dras dit du
   vil; appen husker retningen og legger det ellers der det ikke dekker din
   posisjon, søkefeltet eller arket. Det følger med når kartet flyttes, og
   følger kjøretøyet mens det kjører.
   ===================================================================== */
const fc$={el:null,svg:null,target:null,off:null,raf:0,drag:null};
const FC_PREF_KEY='reisCardOffset';
function fcEnsure(){
  if(fc$.el)return;
  fc$.svg=document.createElementNS('http://www.w3.org/2000/svg','svg');fc$.svg.setAttribute('class','fc-leader');fc$.svg.setAttribute('aria-hidden','true');
  fc$.svg.innerHTML='<line/><circle r="4"/>';
  fc$.el=document.createElement('section');fc$.el.className='fc';fc$.el.setAttribute('role','dialog');
  $('#app').append(fc$.svg,fc$.el);
  // Dra kortet: hele kortet unntatt knapper og rader er håndtak.
  fc$.el.addEventListener('pointerdown',e=>{
    if(e.target.closest('button,.fc-row'))return;
    fc$.drag={x:e.clientX,y:e.clientY,ox:fc$.off.x,oy:fc$.off.y,moved:false,id:e.pointerId};
    fc$.el.setPointerCapture(e.pointerId);
  });
  fc$.el.addEventListener('pointermove',e=>{
    const d=fc$.drag;if(!d||e.pointerId!==d.id)return;
    const dx=e.clientX-d.x,dy=e.clientY-d.y;
    if(!d.moved&&Math.hypot(dx,dy)<5)return;
    d.moved=true;fc$.el.classList.add('dragging');
    fc$.off={x:d.ox+dx,y:d.oy+dy};fcPlace();
  });
  const end=e=>{const d=fc$.drag;if(!d||e.pointerId!==d.id)return;fc$.drag=null;fc$.el.classList.remove('dragging');
    if(d.moved){buzz(6);fc$.off={...fc$.placed,user:true}; // lagre slik kortet faktisk ligger
      try{localStorage.setItem(FC_PREF_KEY,JSON.stringify(fc$.placed));}catch(_){/* lagring kan være slått av (privat modus) */}}};
  fc$.el.addEventListener('pointerup',end);fc$.el.addEventListener('pointercancel',end);
  map.on('move',fcPlace);
}
function fcAnchor(){const t=fc$.target;if(!t)return null;const ll=t.lngLat();return ll?map.project(ll):null;}
// Første plassering: brukerens foretrukne retning, ellers over (eller under, nær toppen) og litt til siden.
function fcDefaultOffset(a){
  const pref=loadJSON(FC_PREF_KEY,null);
  if(pref&&Number.isFinite(pref.x))return{...pref,user:true};
  const w=fc$.el.offsetWidth,h=fc$.el.offsetHeight,top=safeTop()+72;
  const above=a.y-h-52>top;
  const side=a.x>innerWidth/2?-w-18:18;
  return{x:Math.abs(side)>w?side:-w/2,y:above?-h-52:52};
}
function fcPlace(){
  if(!fc$.target)return;
  const a=fcAnchor();
  if(!a){if(fc$.target.moving)fcClose();return;} // kjøretøyet er borte fra kartet
  const el=fc$.el,w=el.offsetWidth,h=el.offsetHeight;
  if(!fc$.off)fc$.off=fcDefaultOffset(a);
  const minY=safeTop()+68,maxY=innerHeight-(wide.matches?16:sheetUI.visible)-h-10;
  const minX=wide.matches?432:8,maxX=innerWidth-w-8;
  let x=a.x+fc$.off.x,y=a.y+fc$.off.y;
  x=Math.max(minX,Math.min(maxX,x));y=Math.max(minY,Math.min(maxY,y));
  fc$.placed={x:x-a.x,y:y-a.y};
  el.style.transform=`translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  // Linjen går fra punktet til nærmeste kant av kortet.
  const cx=Math.max(x,Math.min(x+w,a.x)),cy=Math.max(y,Math.min(y+h,a.y));
  const inside=a.x>x&&a.x<x+w&&a.y>y&&a.y<y+h;
  const line=fc$.svg.firstChild,dot=fc$.svg.lastChild;
  line.setAttribute('x1',a.x);line.setAttribute('y1',a.y);line.setAttribute('x2',cx);line.setAttribute('y2',cy);
  dot.setAttribute('cx',a.x);dot.setAttribute('cy',a.y);
  fc$.svg.classList.toggle('hidden',inside||Math.hypot(cx-a.x,cy-a.y)<6);
  const offscreen=a.x<-40||a.x>innerWidth+40||a.y<-40||a.y>innerHeight+40;
  el.classList.toggle('far',offscreen);fc$.svg.classList.toggle('far',offscreen);
}
function fcOpen(target,html,{label}={}){
  fcEnsure();
  const same=fc$.target&&fc$.target.key===target.key;
  fc$.target=target;
  fc$.el.classList.toggle('settled',same); // oppdateringer animerer ikke radene på nytt
  fc$.el.innerHTML=html;fc$.el.setAttribute('aria-label',label||'');
  fc$.el.querySelector('.fc-close')?.addEventListener('click',e=>{e.stopPropagation();buzz(6);target.onClose?.();});
  target.bind?.(fc$.el);
  if(!same){
    fc$.off=null;fc$.el.classList.remove('in');fc$.svg.classList.remove('in');void fc$.el.offsetWidth;
    fc$.el.hidden=false;fc$.svg.style.display='';
    fcPlace();
    // Kortet vokser fram fra punktet det hører til.
    const a=fcAnchor(),r=fc$.el.getBoundingClientRect();
    if(a)fc$.el.style.transformOrigin=`${a.x-r.left}px ${a.y-r.top}px`;
    fc$.el.classList.add('in');fc$.svg.classList.add('in');
  }else fcPlace();
  cancelAnimationFrame(fc$.raf);
  if(target.moving){const loop=()=>{fcPlace();fc$.raf=requestAnimationFrame(loop);};fc$.raf=requestAnimationFrame(loop);}
}
function fcClose(){
  if(!fc$.el||!fc$.target)return;
  cancelAnimationFrame(fc$.raf);fc$.target=null;
  fc$.el.classList.remove('in');fc$.el.classList.add('out');fc$.svg.classList.remove('in');
  setTimeout(()=>{if(!fc$.target){fc$.el.hidden=true;fc$.el.classList.remove('out');fc$.svg.style.display='none';}},reduceMotion.matches?0:200);
}
const fcMinKeys=new Map();
function fcMinutes(key,r,big){
  const m=minUntil(r.exp),prev=fcMinKeys.get(key);fcMinKeys.set(key,m);
  const tick=prev!=null&&prev!==m?'tick':'';
  const live=r.rt?liveDot():`<i class="sched" role="img" aria-label="${tr('Rutetid')}" title="${tr('Rutetid')}"></i>`;
  const late=fmtT(r.exp)!==fmtT(r.aimed)&&r.exp>r.aimed?Math.round((r.exp-r.aimed)/60000):0;
  const lateTag=late>0?`<em class="fc-late" title="${tr('{n} min forsinket (rutetid {t})',{n:late,t:fmtT(r.aimed)})}">+${late}</em>`:'';
  if(m<=0)return`<span class="fc-t${big?' big':''}">${live}${lateTag}<b class="fc-now">${tr('nå')}</b></span>`;
  if(m>=60)return`<span class="fc-t${big?' big':''}">${live}${lateTag}<b class="${tick}">${fmtT(r.exp)}</b></span>`;
  return`<span class="fc-t${big?' big':''}">${live}${lateTag}<b class="${tick}">${m}</b><small>min</small></span>`;
}

/* ---------- Flytekort for holdeplass ---------- */
// Når arket med tidslinjen er oppe, viser kortet på kartet bare neste avgang – ellers de fire neste.
function updateStopCallout(id){
  const s=findStop(id);if(!s||!mapLoaded||s.lat==null){fcClose();return;}
  const compact=router.cur.name==='stop'&&sheetUI.snap!=='peek';
  // Avganger du ikke rekker å gå til, står tonet ned i tidslinjen – kortet viser første du rekker.
  const entry=state.deps.get(id),walk=entry?.stale?0:nearWalk(distTo(s));
  const rows=upcoming(id).filter(r=>!walk||minUntil(r.exp)>=walk).slice(0,compact?1:4),anyRt=rows.some(r=>r.rt);
  const first=rows[0],rest=rows.slice(1);
  let body;
  if(!entry)body='<div class="fc-row skel-row"><span class="skel" style="width:34px;height:24px"></span><span class="skel"></span><span class="skel" style="width:40px"></span></div>'.repeat(compact?1:2);
  else if(!first)body=`<p class="fc-empty">${tr('Ingen avganger den neste timen')}</p>`;
  else{
    const tags=[first.quay?quayChip(first.mode,first.quay):'',occHtml(first.occ)].join('');
    body=`<button class="fc-row fc-first" type="button" style="--i:0" data-sj="${esc(first.sj||'')}">${lineBadge(first.pub,first.mode,'badge-l')}
        <span class="fc-dest"><b>${esc(first.dest)}</b>${tags?`<small class="fc-tags">${tags}</small>`:''}</span>
        ${fcMinutes(`${id}|${first.pub}|${first.dest}|${first.aimed}`,first,true)}</button>`+
      rest.map((r,i)=>`<button class="fc-row" type="button" style="--i:${i+1}" data-sj="${esc(r.sj||'')}">${lineBadge(r.pub,r.mode)}
        <span class="fc-dest">${esc(r.dest)}</span>${fcMinutes(`${id}|${r.pub}|${r.dest}|${r.aimed}`,r,false)}</button>`).join('');
  }
  fc$.el?.classList.toggle('compact',compact);
  fcOpen({key:'stop:'+id,lngLat:()=>[s.lon,s.lat],onClose:()=>router.back(),
    bind:el=>el.querySelectorAll('.fc-row').forEach(b=>b.addEventListener('click',()=>{buzz(6);
      if(b.dataset.sj)openJourney(b.dataset.sj,id,b.querySelector('.badge'));else snapTo('half');}))},
    `<header class="fc-head"><span class="fc-grip" aria-hidden="true"></span><div class="fc-title"><b>${esc(s.name)}</b>
      ${anyRt?liveDot():''}</div>
      <button class="fc-close" type="button" aria-label="${tr('Lukk')}">${ico('x')}</button></header><div class="fc-body">${body}</div>`,
    {label:tr('Avganger fra {name}',{name:s.name})});
  fc$.el?.classList.toggle('compact',compact);
}
function removeStopCallout(){if(fc$.target?.key?.startsWith('stop:'))fcClose();}

/* ---------- Flytekort for kjøretøy: følger kjøretøyet ---------- */
function vehicleLngLat(vid){
  if(spreadPos.has(vid))return spreadPos.get(vid);
  const f=gpsFeats.find(x=>x.properties.vid===vid)||estFeats.find(x=>x.properties.vid===vid);
  return f?f.geometry.coordinates:null;
}
function showVehicleCard(p){
  const md=modeOf(p.mode),vid=p.vid;
  const j=p.est?estJ.get(vid):null;
  let next='';
  if(j){const e=estimate(j);const c=e&&j.calls[Math.min(j.calls.length-1,e.at+1)];
    const t=c&&arrT(c);if(t){const m=Math.round((t-Date.now())/60000);
      next=`<div class="fc-meta">${tr('Neste stopp')} <b>${m<=0?tr('nå'):tr('om {n} min',{n:m})}</b></div>`;}}
  fcOpen({key:'veh:'+vid,moving:true,lngLat:()=>vehicleLngLat(vid),onClose:fcClose},
    `<header class="fc-head"><span class="fc-grip" aria-hidden="true"></span><div class="fc-title fc-veh">
      <span class="badge badge-l" style="--c:${md.c}">${esc(p.line||md.n)}</span><b>${p.dest?esc(p.dest):md.n}</b></div>
      <button class="fc-close" type="button" aria-label="${tr('Lukk')}">${ico('x')}</button></header>
     <div class="fc-body"><div class="fc-meta">${md.n}${p.line?' '+esc(p.line):''} · ${p.est?`<span class="fc-src est">${tr('Beregnet fra sanntid')}</span>`:`<span class="fc-src"><i class="live" aria-hidden="true"></i>${tr('GPS-posisjon')}</span>`}</div>${next}</div>`,
    {label:`${md.n} ${p.line||''}`});
}

function toggleFav(id){
  buzz(12);
  const s=findStop(id);if(!s)return;
  const had=favs.some(f=>f.id===id);
  favs=had?favs.filter(f=>f.id!==id):[...favs,{id:s.id,name:s.name,lat:s.lat,lon:s.lon}];
  saveJSON('reisFavs',favs);
  const b=$('#favBtn');if(b){b.setAttribute('aria-pressed',String(!had));if(!had){b.classList.remove('bump');void b.offsetWidth;b.classList.add('bump');}}
  renderStopsLayer();
  toast(had?tr('Fjernet fra favoritter'):tr('Lagt til i favoritter'));
}
