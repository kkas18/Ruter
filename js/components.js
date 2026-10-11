'use strict';
/* REIS – Felles visuelle byggesteiner: ring, linjeskilt, avgangsrader og tidslinjen. */

/* ---------- Visuelle byggesteiner ----------
   Appen skal vise heller enn å forklare: én ring for «hvor lenge», ett merke for
   «avvik», tre figurer for «hvor fullt». Teksten ligger i aria-label og title. */
// until: tidspunktet ringen teller ned mot. Da tømmes den jevnt hvert sekund (tickRings i main.js).
// aria: nøkkelen for ordet under ringen («Gå om», «Går om» …); ringState oversetter den.
const ringCls=r=>`ring ${r.cls}${r.clock?' clock':''}${r.zero?' zero':''}${r.long?' long':''}`;
function ringHtml(min,{win=30,size=44,aria='',clock=null,urg=min,until=0}={}){
  const r=ringState(min,win,clock,urg,aria);
  return`<span class="ring-w"><span class="${ringCls(r)}" style="--s:${size}px;--f:${r.f}" data-win="${win}" data-aria="${esc(aria)}"${until?` data-until="${until}"`:''} role="img" aria-label="${esc(r.label)}">
    <svg viewBox="0 0 44 44" aria-hidden="true"><circle class="trk" cx="22" cy="22" r="19"/><circle class="val" cx="22" cy="22" r="19" pathLength="100"/></svg>
    <b>${esc(r.txt)}</b><small>${esc(r.unit)}</small></span><em class="ring-lab" aria-hidden="true">${esc(r.lab)}</em></span>`;
}
function breathe(el){
  el.classList.remove('breathe');void el.offsetWidth;el.classList.add('breathe');
  el.addEventListener('animationend',()=>el.classList.remove('breathe'),{once:true});
}
// Oppdater en ring på stedet, så fyll, farge og tall glir over i stedet for å blinke.
function setRing(el,min,clock=null,urg=min){
  if(!el)return;
  const w=el.closest('.ring-w');el=el.classList.contains('ring')?el:el.querySelector('.ring');
  const r=ringState(min,+el.dataset.win||30,clock,urg,el.dataset.aria||''),b=el.querySelector('b'),wasGo=el.classList.contains('go'),keep=el.classList.contains('breathe');
  el.className=ringCls(r)+(keep?' breathe':'');el.style.setProperty('--f',String(r.f));
  // Når det blir «gå nå», puster ringen to ganger. Bare ved overgangen, aldri i løkke.
  if(r.cls==='go'&&!wasGo&&min>-1)breathe(el);
  if(b.textContent!==r.txt){b.textContent=r.txt;b.classList.remove('tick');void b.offsetWidth;b.classList.add('tick');}
  el.querySelector('small').textContent=r.unit;
  el.setAttribute('aria-label',r.label);
  const lab=w?.querySelector('.ring-lab');if(lab&&lab.textContent!==r.lab)lab.textContent=r.lab;
}
// Linjer med trafikkmelding får et lite varselmerke på linjeskiltet.
// Avvik for en linje. Planlagte endringer tas bare med når de ber om det (all).
function alertFor(code,{all=false}={}){
  const hits=state.alerts.filter(a=>(a.lines||[]).includes(String(code))&&(all||a.sev!=='info'));
  return hits.sort((a,b)=>SEV_RANK[a.sev]-SEV_RANK[b.sev])[0];
}
// icon: piktogrammet for transportmiddelet foran nummeret (store skilt der det er plass).
function lineBadge(code,mode,cls='',withAlert=true,icon=false){
  const md=modeOf(mode),a=withAlert&&alertFor(code);
  return`<span class="badge ${cls}${icon?' with-icon':''}${a?` has-alert ${a.sev}`:''}" style="--c:${md.c};--o:${md.o}" title="${md.n} ${esc(code)}${a?` – ${esc(a.summary)}`:''}">${icon?modeIcon(mode):''}${esc(code)}</span>`;
}
// Belegg fra operatøren (Ruter deler det foreløpig ikke; da vises ingenting).
const OCC={empty:1,manySeatsAvailable:1,fewSeatsAvailable:2,standingRoomOnly:3,crushedStandingRoomOnly:3,full:3,notAcceptingPassengers:3};
const OCC_TXT=['','God plass','Få ledige seter','Fullt – ståplass'];
function occHtml(status){
  const n=OCC[status];if(!n)return'';
  return`<span class="occ o${n}" role="img" aria-label="${tr(OCC_TXT[n])}" title="${tr(OCC_TXT[n])}">${ico('person')}${ico('person')}${ico('person')}</span>`;
}

/* ---------- Avgangsrader ---------- */
// Sanntidsprikken. Skjermlesere hører «Sanntid»; seende ser den grønne prikken.
const liveDot=()=>`<i class="live" role="img" aria-label="${tr('Sanntid')}" title="${tr('Sanntid')}"></i>`;
// Plattform (buss, trikk) eller spor (tog, T-bane): bokstaven vises, hele navnet leses opp.
function quayChip(mode,code){
  const n=mode==='rail'||mode==='metro'?tr('Spor'):tr('Plattform');
  return`<span class="quay" title="${n} ${esc(code)}"><span class="sr-only">${n} </span>${esc(code)}</span>`;
}
const lastMinutes=new Map();
function whenHtml(key,r){
  const m=minUntil(r.exp),delay=fmtT(r.exp)===fmtT(r.aimed)?0:Math.round((r.exp-r.aimed)/60000);
  const prev=lastMinutes.get(key);lastMinutes.set(key,m);
  const tick=prev!=null&&prev!==m?' tick':'';
  const main=m<=0?`<span class="now">${tr('nå')}</span>`:m<60?`<span class="n${tick}">${m}<small>min</small></span>`:`<span class="n${tick}">${fmtT(r.exp)}</span>`;
  let sub='';
  if(m<60)sub=`${r.rt?liveDot():''}${delay>0?`<s>${fmtT(r.aimed)}</s><span class="late">${fmtT(r.exp)}</span>`:fmtT(r.exp)}`;
  else if(delay>0)sub=`<span class="late">+${delay} min</span>`;
  return`<div class="when">${main}${sub?`<span class="sub">${sub}</span>`:''}</div>`;
}
function depRow(s,r){
  const dist=distTo(s);
  const reach=s.stale?null:reachStatus(dist,r.exp);
  const tags=[r.quay?quayChip(r.mode,r.quay):'',occHtml(r.occ),
    reach?`<span class="reach ${reach.cls}">${esc(reach.label)}</span>`:''].filter(Boolean).join('');
  return`<button class="dep press" type="button" data-sj="${esc(r.sj||'')}" data-at="${r.aimed}" data-stop="${esc(s.id)}">${lineBadge(r.pub,r.mode,'badge-l',false)}
    <span class="dest"><b>${esc(r.dest)}</b>${tags?`<small>${tags}</small>`:''}</span>
    ${whenHtml(`${s.id}|${r.pub}|${r.dest}|${r.aimed}`,r)}</button>`;
}
// Avgangene som tidslinje: én rad per linje og retning, prikkene står der de går.
// Det skraverte feltet er tiden du trenger for å gå dit – avganger inni det rekker du ikke.
// Går en linje så ofte at prikkene ville kollidert, slås de sammen til én prikk med «+n»;
// de sammenslåtte avgangene står i listen under. Returnerer også hvilke avganger som vises.
function stopTimeline(s,rows,{compact=false,maxLanes=compact?2:6,width=0}={}){
  // Bredden på plottet bestemmer hvor tett prikkene kan stå (prikken er ~26 px).
  const plotW=Math.max(150,(width||$('#sheetPage')?.clientWidth||360)-(compact?32+46+24:32+24+46+24));
  const T=layoutTimeline(rows,{now:Date.now(),maxLanes,gapPct:(compact?24:28)/plotW*100});
  const {W,lanes:list,hidden,shown,x}=T;
  if(!list.length)return{html:'',shown,W,hidden:0};
  const walk=s.stale?0:nearWalk(distTo(s)),wp=Math.min(100,walk/W*100);
  const step=W===30?10:20,ticks=Array.from({length:W/step+1},(_,i)=>i*step);
  const tag=compact?'span':'button';
  const lane=(L,li)=>{
    // Samme linje i begge retninger: skiltet står bare én gang.
    const same=li>0&&list[li-1].pub===L.pub&&list[li-1].mode===L.mode,dots=L.dots;
    return`<div class="tl-lane${same?' same':''}" data-k="${esc(L.key)}"><span class="tl-lab">${same?'':lineBadge(L.pub,L.mode,'',false)}</span>
      <div class="tl-plot" style="${modeStyle(L.mode)}"><span class="tl-dest">${esc(L.dest)}</span>
      ${walk?`<span class="tl-walk" style="width:${wp}%"></span>`:''}
      ${dots.map(({r,x:xi,more})=>{const m=Math.max(0,minUntil(r.exp)),late=r.exp-r.aimed>60000;
        const lab=`${tr('{mode} {line} mot {dest}',{mode:modeOf(r.mode).n,line:r.pub,dest:r.dest})}, ${m<=0?tr('nå'):tr('om {n} min',{n:m})}${late?tr(', forsinket'):''}${r.rt?'':tr(', rutetid')}${more.length?tr(', og {n} til rett etter',{n:more.length}):''}`;
        return`${late?`<span class="tl-late" data-sj="${esc(r.sj||'')}" data-at="${r.aimed}" style="left:${x(r.aimed)}%;width:${xi-x(r.aimed)}%"></span>`:''}<${tag} class="tl-dot${r.rt?'':' sched'}${m<walk?' miss':''}"${tag==='button'?' type="button"':' role="img"'}
          style="left:${xi}%" data-sj="${esc(r.sj||'')}" data-at="${r.aimed}" data-exp="${r.exp}" aria-label="${esc(lab)}">${m<=0?tr('nå'):m}${more.length?`<sup>+${more.length}</sup>`:''}</${tag}>`;}).join('')}</div></div>`;
  };
  const html=`<div class="tl${compact?' tl-compact':''}" role="group" aria-label="${tr('Avganger de neste {n} minuttene',{n:W})}">
    ${compact?'':`<div class="tl-axis"><span></span><div>${ticks.map(t=>`<em style="left:${t/W*100}%">${t?t:tr('nå')}</em>`).join('')}</div></div>`}
    ${list.map(lane).join('')}
    ${!compact&&(walk||hidden)?`<div class="tl-legend">${walk?`<span class="tl-walk-key"></span>${ico('walk')}${tr('{n} min å gå',{n:walk})}`:''}${hidden?`<span class="tl-more">${tr('+{n} til i listen',{n:hidden})}</span>`:''}</div>`:''}
    ${compact&&hidden?`<span class="tl-more">+${hidden}</span>`:''}
  </div>`;
  return{html,shown,W,hidden};
}
// Snarveiene Hjem og Jobb. På Hjem viser de neste reise herfra; i søket kan de endres.
function placeTiles({editable=false}={}){
  return`<div class="places" role="group" aria-label="${tr('Snarveier')}">${Object.entries(PLACE_KINDS).map(([k,K])=>{
    const p=places[k],kn=tr(K.n);
    if(!p)return`<button class="place-tile add press" type="button" data-pick="${k}">${ico(K.icon)}<span><b>${kn}</b><small>${tr('Legg til')}</small></span></button>`;
    // Første linje: navn og linjen du tar. Andre linje: når du må gå. Ankomst står i skjermleserteksten.
    const sc=shortcuts.get(k);let info,badge='',arrive='';
    if(sc?.here)info=tr('Du er her');
    else if(sc?.start){const m=minUntil(sc.start);info=m<=0?tr('Gå nå'):tr('Gå om {n} min',{n:m});arrive=tr(', fremme kl. {t}',{t:fmtT(sc.end)});
      if(sc.ride&&!editable)badge=lineBadge(sc.ride.code,sc.ride.mode,'',false);}
    else if(sc?.none)info=tr('Ingen reise funnet');
    else info=state.pos?tr('Henter…'):p.name;
    const urgent=sc?.start&&minUntil(sc.start)<=2;
    return`<span class="place-cell"><button class="place-tile press${urgent?' soon':''}${editable?' editable':''}" type="button" data-place="${k}" aria-label="${kn}: ${esc(p.name)}. ${esc(info+arrive)}">${ico(K.icon)}
      <span><b>${kn}${badge}</b><small>${esc(info)}</small></span></button>${editable?`<button class="place-edit press" type="button" data-pick="${k}" aria-label="${tr('Endre {name}',{name:kn})}">${ico('edit')}</button>`:''}</span>`;
  }).join('')}</div>`;
}
function bindPlaceTiles(root=document){
  $$('[data-place]',root).forEach(b=>b.onclick=()=>{buzz(8);goToPlace(b.dataset.place);});
  $$('[data-pick]',root).forEach(b=>b.onclick=e=>{e.stopPropagation();buzz(6);router.go('search',{pick:b.dataset.pick});});
}
// Oppdater en tidslinje på stedet når de samme avgangene fortsatt vises: prikkene glir i stedet for
// å hoppe. Blir en avgang forsinket, lyser prikken kort opp i rødt og forsinkelsen vokser fram fra
// planlagt tid; kommer den tidligere, lyser den grønt. Én gang per endring, aldri i løkke.
const tlSig=el=>[...el.querySelectorAll('.tl-lane')].map(l=>`${l.dataset.k}:${[...l.querySelectorAll('.tl-dot')].map(d=>d.dataset.sj).join(',')}`).join('|')
  +(el.querySelector('.tl-axis')?.textContent||'')+(el.querySelector('.tl-legend,.tl-compact>.tl-more')?'+':'')+(el.querySelector('.tl-walk')?'w':'');
function copyEl(e,m){
  e.style.cssText=m.style.cssText;e.className=m.className;
  if(e.innerHTML!==m.innerHTML)e.innerHTML=m.innerHTML;
  const al=m.getAttribute('aria-label');if(al)e.setAttribute('aria-label',al);
}
function flash(e,cls){
  e.classList.remove('flash-late','flash-early');void e.offsetWidth;e.classList.add(cls);
  e.addEventListener('animationend',()=>e.classList.remove(cls),{once:true});
}
function morphTl(o,n){
  if(!o||!n)return;
  if(!o.querySelector('.tl')||tlSig(o)!==tlSig(n)){o.innerHTML=n.innerHTML;return;}
  const parts='.tl-walk,.tl-dest,.tl-legend,.tl-compact>.tl-more',np=$$(parts,n);
  $$(parts,o).forEach((e,i)=>{if(np[i])copyEl(e,np[i]);});
  const nl=$$('.tl-lane',n);
  $$('.tl-lane',o).forEach((L,i)=>{
    const N=nl[i],nd=$$('.tl-dot',N);
    $$('.tl-dot',L).forEach((d,k)=>{const m=nd[k],was=+d.dataset.exp,now=+m.dataset.exp;
      copyEl(d,m);d.dataset.exp=m.dataset.exp;
      if(was&&now-was>=60000)flash(d,'flash-late');else if(was&&was-now>=60000)flash(d,'flash-early');});
    // Forsinkelseshaler: de som finnes flyttes, nye vokser fram fra planlagt tid. Nøkkelen er tur og
    // planlagt tid, fordi en ringlinje kan ha to avganger med samme tur.
    const lk=t=>`${t.dataset.sj}|${t.dataset.at}`,plot=$('.tl-plot',L),old=new Map($$('.tl-late',L).map(t=>[lk(t),t]));
    $$('.tl-late',N).forEach(m=>{const t=old.get(lk(m));
      if(t){t.style.cssText=m.style.cssText;old.delete(lk(m));return;}
      const c=m.cloneNode(true),w=c.style.width;c.style.width='0';plot.insertBefore(c,$('.tl-dot',plot));
      requestAnimationFrame(()=>requestAnimationFrame(()=>{c.style.width=w;}));});
    old.forEach(t=>t.remove());
  });
}
// Kompakt rad for avganger lenger fram (under tidslinjen): klokkeslett først, minutter dempet.
function depRowCompact(s,r){
  const m=minUntil(r.exp),late=fmtT(r.exp)!==fmtT(r.aimed)&&r.exp>r.aimed;
  return`<button class="dep compact press" type="button" data-sj="${esc(r.sj||'')}" data-at="${r.aimed}" data-stop="${esc(s.id)}">${lineBadge(r.pub,r.mode,'',false)}
    <span class="dest"><b>${esc(r.dest)}</b></span>
    <span class="ct">${r.rt?liveDot():''}${late?`<s>${fmtT(r.aimed)}</s>`:''}<b class="${late?'late':''}">${fmtT(r.exp)}</b><small>${m<60?`${m} min`:''}</small></span></button>`;
}
function miniRow(s,r){
  const m=minUntil(r.exp);
  const when=m<=0?`<span class="m now">${tr('nå')}</span>`:m<60?`<span class="m">${r.rt?liveDot():''}${m}<small>min</small></span>`:`<span class="m">${fmtT(r.exp)}</span>`;
  return`<div class="mini">${lineBadge(r.pub,r.mode,'',false)}<span class="d">${esc(r.dest)}</span>${when}</div>`;
}
const upcoming=id=>(state.deps.get(id)?.rows||[]).filter(r=>r.exp>Date.now()-30000);
// Holdeplasskort på Hjem: samme tidslinje som på holdeplassen, i liten utgave (to retninger).
function stopCard(s,i=0){
  const rows=upcoming(s.id),d=distTo(s),fav=favs.some(f=>f.id===s.id),entry=state.deps.get(s.id);
  let body;
  if(!entry)body='<div class="mini"><span class="skel" style="width:32px;height:22px"></span><span class="skel" style="width:70%"></span><span class="skel" style="width:36px"></span></div>';
  else if(!rows.length)body=`<div class="mini"><span class="d" style="grid-column:1/-1;color:var(--ink-3)">${tr('Ingen avganger den neste timen')}</span></div>`;
  else body=stopTimeline({...s,stale:entry.stale},rows,{compact:true}).html||rows.slice(0,2).map(r=>miniRow(s,r)).join('');
  return`<button class="stop-card" type="button" data-stop="${esc(s.id)}" style="--i:${i}"><div class="top"><b>${esc(s.name)}</b>
    <span class="dist">${fav?ico('star','fav'):''}${d!=null?`${fmtDist(d)} · ${walkMin(d)} min`:''}</span></div><div class="sc-body">${body}</div></button>`;
}
