'use strict';
/* REIS – Felles visuelle byggesteiner: ring, linjeskilt, avgangsrader og tidslinjen. */

/* ---------- Visuelle byggesteiner ----------
   Appen skal vise heller enn å forklare: én ring for «hvor lenge», ett merke for
   «avvik», tre figurer for «hvor fullt». Teksten ligger i aria-label og title. */
function ringHtml(min,{win=30,size=44,aria='',clock=null,urg=min}={}){
  const r=ringState(min,win,clock,urg);
  return`<span class="ring-w"><span class="ring ${r.cls}${r.clock?' clock':''}" style="--s:${size}px;--f:${r.f}" data-win="${win}" data-aria="${esc(aria)}" role="img" aria-label="${esc(`${aria} ${r.label}`.trim())}">
    <svg viewBox="0 0 44 44" aria-hidden="true"><circle class="trk" cx="22" cy="22" r="19"/><circle class="val" cx="22" cy="22" r="19" pathLength="100"/></svg>
    <b>${r.txt}</b><small>${r.unit}</small></span><em class="ring-lab" aria-hidden="true">${esc(ringWord(aria.toLowerCase(),min))}</em></span>`;
}
// Oppdater en ring på stedet, så fyll, farge og tall glir over i stedet for å blinke.
function setRing(el,min,clock=null,urg=min){
  if(!el)return;
  const w=el.closest('.ring-w');el=el.classList.contains('ring')?el:el.querySelector('.ring');
  const r=ringState(min,+el.dataset.win||30,clock,urg),b=el.querySelector('b');
  el.className=`ring ${r.cls}${r.clock?' clock':''}`;el.style.setProperty('--f',String(r.f));
  if(b.textContent!==r.txt){b.textContent=r.txt;b.classList.remove('tick');void b.offsetWidth;b.classList.add('tick');}
  el.querySelector('small').textContent=r.unit;
  el.setAttribute('aria-label',`${el.dataset.aria||''} ${r.label}`.trim());
  const lab=w?.querySelector('.ring-lab');if(lab)lab.textContent=ringWord((el.dataset.aria||'').toLowerCase(),min);
}
// Linjer med trafikkmelding får et lite varselmerke på linjeskiltet.
// Avvik for en linje. Planlagte endringer tas bare med når de ber om det (all).
function alertFor(code,{all=false}={}){
  const hits=state.alerts.filter(a=>(a.lines||[]).includes(String(code))&&(all||a.sev!=='info'));
  return hits.sort((a,b)=>SEV_RANK[a.sev]-SEV_RANK[b.sev])[0];
}
function lineBadge(code,mode,cls='',withAlert=true){
  const md=modeOf(mode),a=withAlert&&alertFor(code);
  return`<span class="badge ${cls}${a?` has-alert ${a.sev}`:''}" style="--c:${md.c}" title="${md.n} ${esc(code)}${a?` – ${esc(a.summary)}`:''}">${esc(code)}</span>`;
}
// Belegg fra operatøren (Ruter deler det foreløpig ikke; da vises ingenting).
const OCC={empty:1,manySeatsAvailable:1,fewSeatsAvailable:2,standingRoomOnly:3,crushedStandingRoomOnly:3,full:3,notAcceptingPassengers:3};
const OCC_TXT=['','God plass','Få ledige seter','Fullt – ståplass'];
function occHtml(status){
  const n=OCC[status];if(!n)return'';
  return`<span class="occ o${n}" role="img" aria-label="${OCC_TXT[n]}" title="${OCC_TXT[n]}">${ico('person')}${ico('person')}${ico('person')}</span>`;
}

/* ---------- Avgangsrader ---------- */
const lastMinutes=new Map();
function whenHtml(key,r){
  const m=minUntil(r.exp),delay=fmtT(r.exp)===fmtT(r.aimed)?0:Math.round((r.exp-r.aimed)/60000);
  const prev=lastMinutes.get(key);lastMinutes.set(key,m);
  const tick=prev!=null&&prev!==m?' tick':'';
  const main=m<=0?'<span class="now">nå</span>':m<60?`<span class="n${tick}">${m}<small>min</small></span>`:`<span class="n${tick}">${fmtT(r.exp)}</span>`;
  let sub='';
  if(m<60)sub=`${r.rt?'<i class="live" title="Sanntid"></i>':''}${delay>0?`<s>${fmtT(r.aimed)}</s><span class="late">${fmtT(r.exp)}</span>`:fmtT(r.exp)}`;
  else if(delay>0)sub=`<span class="late">+${delay} min</span>`;
  return`<div class="when">${main}${sub?`<span class="sub">${sub}</span>`:''}</div>`;
}
function depRow(s,r){
  const dist=distTo(s);
  const reach=s.stale?null:reachStatus(dist,r.exp);
  const qn=r.mode==='rail'||r.mode==='metro'?'Spor':'Plattform';
  const tags=[r.quay?`<span class="quay" title="${qn} ${esc(r.quay)}" aria-label="${qn} ${esc(r.quay)}">${esc(r.quay)}</span>`:'',occHtml(r.occ),
    reach?`<span class="reach ${reach.cls}">${esc(reach.label)}</span>`:''].filter(Boolean).join('');
  return`<button class="dep press" type="button" data-sj="${esc(r.sj||'')}" data-stop="${esc(s.id)}">${lineBadge(r.pub,r.mode,'badge-l',false)}
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
      <div class="tl-plot" style="--c:${modeOf(L.mode).c}"><span class="tl-dest">${esc(L.dest)}</span>
      ${walk?`<span class="tl-walk" style="width:${wp}%"></span>`:''}
      ${dots.map(({r,x:xi,more})=>{const m=Math.max(0,minUntil(r.exp)),late=r.exp-r.aimed>60000;
        const lab=`${modeOf(r.mode).n} ${r.pub} mot ${r.dest}, ${m<=0?'nå':`om ${m} min`}${late?', forsinket':''}${r.rt?'':', rutetid'}${more.length?`, og ${more.length} til rett etter`:''}`;
        return`${late?`<span class="tl-late" data-sj="${esc(r.sj||'')}" style="left:${x(r.aimed)}%;width:${xi-x(r.aimed)}%"></span>`:''}<${tag} class="tl-dot${r.rt?'':' sched'}${m<walk?' miss':''}"${tag==='button'?' type="button"':''}
          style="left:${xi}%" data-sj="${esc(r.sj||'')}" aria-label="${esc(lab)}">${m<=0?'nå':m}${more.length?`<sup>+${more.length}</sup>`:''}</${tag}>`;}).join('')}</div></div>`;
  };
  const html=`<div class="tl${compact?' tl-compact':''}" role="group" aria-label="Avganger de neste ${W} minuttene">
    ${compact?'':`<div class="tl-axis"><span></span><div>${ticks.map(t=>`<em style="left:${t/W*100}%">${t?t:'nå'}</em>`).join('')}</div></div>`}
    ${list.map(lane).join('')}
    ${!compact&&(walk||hidden)?`<div class="tl-legend">${walk?`<span class="tl-walk-key"></span>${ico('walk')}${walk} min å gå`:''}${hidden?`<span class="tl-more">+${hidden} til i listen</span>`:''}</div>`:''}
    ${compact&&hidden?`<span class="tl-more">+${hidden}</span>`:''}
  </div>`;
  return{html,shown,W,hidden};
}
// Oppdater en tidslinje på stedet når de samme avgangene fortsatt vises: prikkene glir i stedet for å hoppe.
const tlSig=el=>[...el.querySelectorAll('.tl-lane')].map(l=>`${l.dataset.k}:${[...l.querySelectorAll('.tl-dot,.tl-late')].map(d=>d.className.split(' ')[0]+d.dataset.sj).join(',')}`).join('|')
  +(el.querySelector('.tl-axis')?.textContent||'')+(el.querySelector('.tl-legend,.tl-compact>.tl-more')?'+':'');
function morphTl(o,n){
  if(!o||!n)return;
  if(!o.querySelector('.tl')||tlSig(o)!==tlSig(n)){o.innerHTML=n.innerHTML;return;}
  const parts='.tl-dot,.tl-late,.tl-walk,.tl-dest,.tl-legend,.tl-more',od=$$(parts,o),nd=$$(parts,n);
  od.forEach((e,i)=>{const m=nd[i];if(!m)return;e.style.cssText=m.style.cssText;e.className=m.className;
    if(e.innerHTML!==m.innerHTML)e.innerHTML=m.innerHTML;const al=m.getAttribute('aria-label');if(al)e.setAttribute('aria-label',al);});
}
function miniRow(s,r){
  const m=minUntil(r.exp);
  const t=m<=0?'<span class="m now">nå</span>':m<60?`<span class="m">${r.rt?'<i class="live"></i>':''}${m}<small>min</small></span>`:`<span class="m">${fmtT(r.exp)}</span>`;
  return`<div class="mini">${lineBadge(r.pub,r.mode,'',false)}<span class="d">${esc(r.dest)}</span>${t}</div>`;
}
const upcoming=id=>(state.deps.get(id)?.rows||[]).filter(r=>r.exp>Date.now()-30000);
// Holdeplasskort på Hjem: samme tidslinje som på holdeplassen, i liten utgave (to retninger).
function stopCard(s){
  const rows=upcoming(s.id),d=distTo(s),fav=favs.some(f=>f.id===s.id),entry=state.deps.get(s.id);
  let body;
  if(!entry)body='<div class="mini"><span class="skel" style="width:32px;height:22px"></span><span class="skel" style="width:70%"></span><span class="skel" style="width:36px"></span></div>';
  else if(!rows.length)body='<div class="mini"><span class="d" style="grid-column:1/-1;color:var(--ink-3)">Ingen avganger den neste timen</span></div>';
  else body=stopTimeline({...s,stale:entry.stale},rows,{compact:true}).html||rows.slice(0,2).map(r=>miniRow(s,r)).join('');
  return`<button class="stop-card" type="button" data-stop="${esc(s.id)}"><div class="top"><b>${esc(s.name)}</b>
    <span class="dist">${fav?ico('star','fav'):''}${d!=null?`${fmtDist(d)} · ${walkMin(d)} min`:''}</span></div><div class="sc-body">${body}</div></button>`;
}
