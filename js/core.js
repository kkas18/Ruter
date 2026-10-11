'use strict';
/* =====================================================================
   REIS – kjernelogikk
   Ren logikk uten DOM, kart eller nettverk: tid og avstand, gangtid,
   posisjon langs linjen ut fra sanntidstider, tidslinjens oppsett og
   vekting av trafikkmeldinger. Lastes som vanlig skript i nettleseren
   (funksjonene blir globale) og som CommonJS-modul i Node, der den
   testes med node:test (tests/core.test.js).
   ===================================================================== */
// I Node (testene) hentes språkfunksjonene fra i18n.js; i nettleseren er de allerede globale.
if(typeof tr!=='function'&&typeof module==='object')Object.assign(globalThis,module.require('./i18n.js'));
// Innstillinger kjernen trenger; appen setter gangfarten fra brukerens valg.
const coreCfg={walkKmh:4.5};

/* ---------- Tekst og tid ---------- */
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtT=ts=>new Date(ts).toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const minUntil=ts=>Math.round((new Date(ts).getTime()-Date.now())/60000);
const plural=(n,one,many)=>n===1?one:many;
const changesText=n=>n===0?tr('Direkte'):tn(n,'{n} bytte','{n} bytter');
const fmtDec=(x,d=1)=>{const s=x.toFixed(d);return I18N.lang==='en'?s:s.replace('.',',');};
const fmtDist=m=>m<1000?`${Math.round(m/10)*10} m`:`${fmtDec(m/1000)} km`;
// Entur bruker «Origin»/«Destination» for koordinatpunkter; vis brukerens egne navn.
const placeName=(p,fallback)=>{const n=p?.name;return(!n||/^(origin|destination)$/i.test(n))?fallback:n;};

/* ---------- Avstand og gangtid ---------- */
function geoDist(a,b){const R=6371000,rad=x=>x*Math.PI/180;
  const dLa=rad(b[0]-a[0]),dLo=rad(b[1]-a[1]);
  const h=Math.sin(dLa/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));}
const walkMin=m=>Math.max(1,Math.ceil(m*1.3/(coreCfg.walkKmh*16.67))); // luftlinje + 30 % omvei
// Gangtid og «rekker du den?» gir bare mening når du er i nærheten av holdeplassen.
const NEAR_WALK_MAX=20;
const nearWalk=distance=>distance!=null&&walkMin(distance)<=NEAR_WALK_MAX?walkMin(distance):0;
function reachStatus(distance,departure,now=Date.now()){
  if(distance==null||!Number.isFinite(+departure)||!nearWalk(distance))return null;
  const remaining=(+departure-now)/60000;
  if(remaining<0)return null;
  const margin=remaining-walkMin(distance)-2;
  if(margin<-3)return{label:tr('Rekker trolig ikke'),cls:'caution'};
  if(margin<0)return{label:tr('Knapt'),cls:'caution'};
  if(margin<3)return{label:tr('Gå nå'),cls:'now'};
  if(margin<11)return{label:tr('Gå om {n} min',{n:Math.floor(margin)}),cls:'soon'};
  return null;
}

/* ---------- Avganger fra Entur ---------- */
function parseCalls(calls){
  const now=Date.now()-60000,seen=new Set(),rows=[];
  (calls||[]).forEach(c=>{
    if(c.forBoarding===false)return;
    const exp=new Date(c.expectedDepartureTime).getTime();
    if(!Number.isFinite(exp)||exp<now)return;
    const line=c.serviceJourney?.journeyPattern?.line||{};
    const dest=c.destinationDisplay?.frontText||'—';
    const key=c.serviceJourney?.id||`${line.publicCode}|${dest}|${c.aimedDepartureTime}`; // samme tur fra flere plattformer
    if(seen.has(key))return;seen.add(key);
    rows.push({dest,pub:line.publicCode||'?',mode:line.transportMode||'bus',exp,aimed:new Date(c.aimedDepartureTime).getTime(),rt:!!c.realtime,quay:c.quay?.publicCode,sj:c.serviceJourney?.id||'',occ:c.occupancyStatus,date:c.date||null});
  });
  return rows.sort((a,b)=>a.exp-b.exp);
}

/* ---------- Linjegeometri ---------- */
function decodePoly(enc){
  const pts=[];let i=0,lat=0,lng=0;
  while(i<enc.length){
    let res=0,sh=0,b;
    do{b=enc.charCodeAt(i++)-63;res|=(b&31)<<sh;sh+=5;}while(b>=32);
    lat+=(res&1)?~(res>>1):(res>>1);res=0;sh=0;
    do{b=enc.charCodeAt(i++)-63;res|=(b&31)<<sh;sh+=5;}while(b>=32);
    lng+=(res&1)?~(res>>1):(res>>1);
    pts.push([lng/1e5,lat/1e5]);
  }
  return pts;
}
const mPerDeg=lat=>[111320*Math.cos(lat*Math.PI/180),110540];
function prepPath(pts){ // kumulativ avstand i meter langs linjen
  const cum=[0];
  for(let i=1;i<pts.length;i++){const [kx,ky]=mPerDeg(pts[i][1]);
    cum.push(cum[i-1]+Math.hypot((pts[i][0]-pts[i-1][0])*kx,(pts[i][1]-pts[i-1][1])*ky));}
  return cum;
}
function projectStops(pts,cum,calls){ // finn hvert stopp sin plass langs linjen, alltid fremover
  let from=0;
  return calls.map(c=>{
    const q=c.quay;if(!q)return null;
    let best=from,bd=Infinity;
    for(let i=from;i<pts.length;i++){const d=(pts[i][0]-q.longitude)**2+(pts[i][1]-q.latitude)**2;if(d<bd){bd=d;best=i;}}
    from=best;return cum[best];
  });
}
function pointAt(pts,cum,s){
  if(s<=0)return{p:pts[0],b:bearingOf(pts[0],pts[1])};
  const last=cum[cum.length-1];if(s>=last)return{p:pts[pts.length-1],b:bearingOf(pts[pts.length-2],pts[pts.length-1])};
  let i=cum.findIndex(c=>c>=s);i=Math.max(1,i);
  const t=(s-cum[i-1])/((cum[i]-cum[i-1])||1),a=pts[i-1],b=pts[i];
  return{p:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],b:bearingOf(a,b)};
}
function bearingOf(a,b){if(!a||!b)return 0;const [kx,ky]=mPerDeg(a[1]);return(Math.atan2((b[0]-a[0])*kx,(b[1]-a[1])*ky)*180/Math.PI+360)%360;}

/* ---------- Hvor er kjøretøyet? (fra sanntidstider) ---------- */
const ts=v=>v?new Date(v).getTime():NaN;
function depT(c){return ts(c.actualDepartureTime)||ts(c.expectedDepartureTime)||ts(c.aimedDepartureTime)||ts(c.actualArrivalTime)||ts(c.expectedArrivalTime);}
const arrT=c=>ts(c.actualArrivalTime)||ts(c.expectedArrivalTime)||ts(c.aimedArrivalTime)||depT(c);
// Hvor er kjøretøyet nå, ut fra tidene? Returnerer posisjon og hvilket stopp det sist passerte.
function estimate(job,now=Date.now()){
  const c=job.calls,S=job.stopS;if(!c||c.length<2||!job.pts)return null;
  if(now<depT(c[0]))return{at:0,s:S[0]??0,state:'start'};
  for(let i=0;i<c.length-1;i++){
    const a=arrT(c[i]),d=depT(c[i]),n=arrT(c[i+1]);
    if(now>=a&&now<d)return{at:i,s:S[i],state:'stop'};
    if(now>=d&&now<n){const f=(now-d)/((n-d)||1);return{at:i,s:S[i]+(S[i+1]-S[i])*f,state:'moving'};}
  }
  return{at:c.length-1,s:S[c.length-1],state:'done'};
}
// Som estimate(), men uten kartgeometri: siste passerte stopp og andelen av strekningen videre.
function callPos(c,now=Date.now()){
  if(!c||c.length<2)return null;
  if(now<depT(c[0]))return{at:0,f:0,state:'start'};
  for(let i=0;i<c.length-1;i++){
    const a=arrT(c[i]),d=depT(c[i]),n=arrT(c[i+1]);
    if(now>=a&&now<d)return{at:i,f:0,state:'stop'};
    if(now>=d&&now<n)return{at:i,f:(now-d)/((n-d)||1),state:'moving'};
  }
  return{at:c.length-1,f:0,state:'done'};
}
function nearestCallIdx(calls,q,name){
  if(q&&+q.latitude){let best=-1,bd=Infinity;calls.forEach((c,i)=>{if(!c.quay)return;
    const d=(c.quay.latitude-q.latitude)**2+(c.quay.longitude-q.longitude)**2;if(d<bd){bd=d;best=i;}});if(best>=0)return best;}
  return calls.findIndex(c=>c.quay?.name===name);
}

/* ---------- Tidslinje for avganger ---------- */
// Avgangene fordeles på rader (én per linje og retning) langs en akse på 30 minutter – eller 60
// når det går færre enn tre avganger den første halvtimen. Prikker som ville kollidert
// (nærmere enn gapPct prosent av bredden) slås sammen: den første står, resten telles i «more».
// Returnerer posisjoner i prosent, radene som vises, hvor mange rader som ikke fikk plass, og
// hvilke avganger som faktisk vises (resten hører hjemme i listen under).
function layoutTimeline(rows,{now=Date.now(),maxLanes=6,gapPct=8}={}){
  let W=30;if(rows.filter(r=>r.exp-now<=30*60000).length<3)W=60;
  const x=t=>Math.max(0,Math.min(100,(t-now)/(W*60000)*100)),shown=new Set();
  const byLane=new Map();
  rows.filter(r=>r.exp-now<=W*60000).forEach(r=>{const k=`${r.pub}|${r.dest}`;
    if(!byLane.has(k))byLane.set(k,{key:k,pub:r.pub,mode:r.mode,dest:r.dest,rows:[]});byLane.get(k).rows.push(r);});
  const lanes=[...byLane.values()].slice(0,maxLanes);
  lanes.forEach(L=>{L.dots=[];L.rows.forEach(r=>{const xi=x(r.exp),last=L.dots[L.dots.length-1];
    if(last&&xi-last.x<gapPct){last.more.push(r);return;}
    L.dots.push({r,x:xi,more:[]});shown.add(r);});});
  return{W,x,lanes,hidden:byLane.size-lanes.length,shown};
}

/* ---------- Nedtellingsring ---------- */
// Tallet står i midten, ringen tømmes mot null og skifter farge når det haster. Ordet under ringen
// sier hva tallet betyr («gå om», «går om», «gå av om»). Ved null flyttes verbet inn i ringen med
// «nå» under, så ringen leses «Gå nå». Ord som er for lange for ringen, står ikke der; da står «nå».
// word: nøkkelen for ordet («Gå om» osv.); teksten oversettes her.
// urg: minuttene som bestemmer fargen, når det ikke er selve tallet (f.eks. avgang minus gangtid).
const RING_WORDS={
  'Gå om':{at:'Gå kl. {t}',now:'Gå nå',verb:'Gå'},
  'Går om':{at:'Går kl. {t}',now:'Går nå',verb:'Går'},
  'Gå av om':{at:'Gå av kl. {t}',now:'Gå av nå',verb:'Gå av'},
  'Starter om':{at:'Starter kl. {t}',now:'Starter nå',verb:''},
  'Endestopp om':{at:'Endestopp kl. {t}',now:'Endestopp nå',verb:''}
};
function ringState(min,win,clock,urg=min,word=''){
  const m=Math.max(0,Math.round(min)),u=Math.round(urg),W=RING_WORDS[word];
  const r={cls:u<=1?'go':u<=5?'soon':'',f:Math.min(1,Math.max(0,min)/win),clock:false,zero:false,long:false};
  if(m<=0){const verb=W?.verb?tr(W.verb):'';
    return{...r,zero:!!verb,long:verb.length>3,txt:verb||tr('nå'),unit:verb?tr('nå'):'',lab:'',label:W?tr(W.now):tr('nå')};}
  if(m>=100&&clock)
    return{...r,clock:true,txt:clock,unit:'',lab:W?tr(W.at,{t:''}).trim().toLowerCase():'',label:W?tr(W.at,{t:clock}):tr('kl. {t}',{t:clock})};
  return{...r,txt:String(m),unit:tr('min'),lab:word?tr(word).toLowerCase():'',label:`${word?tr(word)+' ':''}${m} ${tr('min')}`};
}

/* ---------- Trafikkmeldinger ---------- */
// Hendelser (ReportType «incident») påvirker reisen nå; «general» er planlagte endringer som
// «Fra 4. oktober: Buss 70 får minuttjusteringer». De siste vises rolig, uten varselfarge.
const SEV_RANK={high:0,med:1,info:2,low:2};
const SEVERE_RX=/innstilt|stengt|stopper ikke|kjører ikke|ulykke|brudd|buss for (bane|trikk|tog)/i;
function sevClass(s){s=(s||'').toLowerCase();
  if(s==='severe'||s==='verysevere'||s==='high')return'high';
  if(s==='normal'||s==='medium'||s==='warning')return'med';return'low';}
function alertLevel(reportType,severity,summary){
  const sev=sevClass(severity);
  if((reportType||'').toLowerCase()==='general'&&sev!=='high')return'info';
  return sev==='high'||SEVERE_RX.test(summary||'')?'high':'med';
}

if(typeof module==='object'&&module.exports)module.exports={coreCfg,esc,fmtT,minUntil,plural,changesText,fmtDec,fmtDist,placeName,
  geoDist,walkMin,NEAR_WALK_MAX,nearWalk,reachStatus,parseCalls,decodePoly,mPerDeg,prepPath,projectStops,pointAt,bearingOf,
  ts,depT,arrT,estimate,callPos,nearestCallIdx,layoutTimeline,RING_WORDS,ringState,SEV_RANK,SEVERE_RX,sevClass,alertLevel};
