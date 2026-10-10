'use strict';
// Enhetstester for kjernelogikken i js/core.js. Kjøres med `npm test` (node:test, ingen avhengigheter).
const test=require('node:test');
const assert=require('node:assert/strict');
const C=require('../js/core.js');

const MIN=60000,T0=Date.UTC(2026,9,10,18,0,0);
const iso=t=>new Date(t).toISOString();

test('fmtDist runder til ti meter under én km og viser km med komma over',()=>{
  assert.equal(C.fmtDist(947),'950 m');
  assert.equal(C.fmtDist(1234),'1,2 km');
});

test('esc gjør tekst trygg i HTML',()=>{
  assert.equal(C.esc('<b a="1">&\'</b>'),'&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;');
  assert.equal(C.esc(null),'');
});

test('walkMin bruker gangfarten og 30 % omvei, minst ett minutt',()=>{
  C.coreCfg.walkKmh=4.5;
  assert.equal(C.walkMin(100),2);
  assert.equal(C.walkMin(5),1);
  C.coreCfg.walkKmh=6;
  assert.equal(C.walkMin(1000),13);
  C.coreCfg.walkKmh=4.5;
});

test('nearWalk gir gangtid bare når holdeplassen er i nærheten',()=>{
  assert.equal(C.nearWalk(100),2);
  assert.equal(C.nearWalk(3100),0,'3 km unna skal ikke skravere hele tidslinjen');
  assert.equal(C.nearWalk(null),0);
});

test('reachStatus: «Gå nå», «Knapt», «Rekker trolig ikke» og ingenting langt unna',()=>{
  const now=T0;
  assert.equal(C.reachStatus(100,now+5*MIN,now).label,'Gå nå');
  assert.equal(C.reachStatus(100,now+3*MIN,now).label,'Knapt');
  assert.equal(C.reachStatus(100,now+10*MIN,now).label,'Gå om 6 min');
  assert.equal(C.reachStatus(500,now+2*MIN,now).label,'Rekker trolig ikke');
  assert.equal(C.reachStatus(100,now+30*MIN,now),null,'god tid: ingen beskjed');
  assert.equal(C.reachStatus(3100,now+5*MIN,now),null,'for langt unna til å si noe');
  assert.equal(C.reachStatus(100,now-MIN,now),null,'allerede gått');
});

test('parseCalls hopper over avstigning og gamle avganger, slår sammen samme tur og sorterer',()=>{
  const now=Date.now();
  const call=(min,sj,extra={})=>({expectedDepartureTime:iso(now+min*MIN),aimedDepartureTime:iso(now+min*MIN),realtime:true,
    destinationDisplay:{frontText:'Skullerud'},quay:{publicCode:'A'},serviceJourney:{id:sj,journeyPattern:{line:{publicCode:'70',transportMode:'bus'}}},...extra});
  const rows=C.parseCalls([call(9,'b'),call(2,'a'),call(2,'a',{quay:{publicCode:'B'}}),call(-5,'old'),call(4,'c',{forBoarding:false})]);
  assert.deepEqual(rows.map(r=>r.sj),['a','b']);
  assert.equal(rows[0].pub,'70');assert.equal(rows[0].mode,'bus');assert.equal(rows[0].quay,'A');assert.equal(rows[0].rt,true);
});

test('decodePoly leser Google-polylinjer som [lengde, bredde]',()=>{
  const pts=C.decodePoly('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.deepEqual(pts,[[-120.2,38.5],[-120.95,40.7],[-126.453,43.252]]);
});

test('pointAt finner punktet midt på en rett linje',()=>{
  const pts=[[10.0,59.9],[10.01,59.9]],cum=C.prepPath(pts);
  assert.ok(Math.abs(cum[1]-557)<5,'0,01° øst ved 59,9° N er ~557 m');
  const mid=C.pointAt(pts,cum,cum[1]/2);
  assert.ok(Math.abs(mid.p[0]-10.005)<1e-9);
  assert.ok(Math.abs(mid.b-90)<1,'retning øst');
});

// Tre stopp: avgang 18:00, ankomst/avgang 18:05–18:06, ankomst 18:10.
const calls=[
  {aimedDepartureTime:iso(T0),quay:{latitude:59.90,longitude:10.80,name:'A'}},
  {aimedArrivalTime:iso(T0+5*MIN),aimedDepartureTime:iso(T0+6*MIN),quay:{latitude:59.91,longitude:10.81,name:'B'}},
  {aimedArrivalTime:iso(T0+10*MIN),quay:{latitude:59.92,longitude:10.82,name:'C'}}
];

test('callPos: før start, underveis, ved holdeplass og fremme',()=>{
  assert.equal(C.callPos(calls,T0-MIN).state,'start');
  const mid=C.callPos(calls,T0+2.5*MIN);
  assert.equal(mid.state,'moving');assert.equal(mid.at,0);assert.ok(Math.abs(mid.f-.5)<1e-9);
  assert.deepEqual(C.callPos(calls,T0+5.5*MIN),{at:1,f:0,state:'stop'});
  assert.equal(C.callPos(calls,T0+11*MIN).state,'done');
});

test('estimate følger tidene langs linjegeometrien',()=>{
  const pts=calls.map(c=>[c.quay.longitude,c.quay.latitude]),cum=C.prepPath(pts);
  const job={calls,pts,cum,stopS:C.projectStops(pts,cum,calls)};
  const e=C.estimate(job,T0+8*MIN);
  assert.equal(e.state,'moving');assert.equal(e.at,1);
  assert.ok(e.s>job.stopS[1]&&e.s<job.stopS[2]);
});

test('nearestCallIdx finner holdeplassen på koordinater og faller tilbake på navn',()=>{
  assert.equal(C.nearestCallIdx(calls,{latitude:59.9101,longitude:10.8099},''),1);
  assert.equal(C.nearestCallIdx(calls,null,'C'),2);
});

test('layoutTimeline: rader per linje og retning, 30 eller 60 minutter, sammenslåtte prikker',()=>{
  const now=T0,row=(min,pub,dest,sj)=>({exp:now+min*MIN,aimed:now+min*MIN,pub,dest,mode:'bus',sj});
  const rows=[row(1,'70','Skullerud','a'),row(2,'70','Skullerud','b'),row(15,'70','Skullerud','c'),row(5,'70','Nationaltheatret','d'),row(40,'70','Skullerud','e')];
  const L=C.layoutTimeline(rows,{now,gapPct:8});
  assert.equal(L.W,30);
  assert.deepEqual(L.lanes.map(l=>l.key),['70|Skullerud','70|Nationaltheatret']);
  const sk=L.lanes[0];
  assert.equal(sk.dots.length,2,'1 og 2 min ligger for tett og slås sammen');
  assert.equal(sk.dots[0].more.length,1);
  assert.ok(!L.shown.has(rows[1]),'den sammenslåtte avgangen havner i listen');
  assert.ok(!L.shown.has(rows[4]),'40 min er utenfor 30-minuttersvinduet');
  const sparse=C.layoutTimeline([row(20,'1','X','x'),row(50,'1','X','y')],{now});
  assert.equal(sparse.W,60,'færre enn tre avganger den første halvtimen gir en time');
  const many=C.layoutTimeline(Array.from({length:8},(_,i)=>row(i+1,String(i),'D'+i,'s'+i)),{now,maxLanes:6});
  assert.equal(many.lanes.length,6);assert.equal(many.hidden,2);
});

test('alertLevel skiller planlagte endringer fra avvik og alvorlige avvik',()=>{
  assert.equal(C.alertLevel('general','normal','Fra 4. oktober: Buss 70 får minuttjusteringer'),'info');
  assert.equal(C.alertLevel('incident','normal','Buss 21: Omkjøring mellom Riddervolds plass og Hegdehaugsveien'),'med');
  assert.equal(C.alertLevel('incident','normal','Linje 63 er innstilt'),'high');
  assert.equal(C.alertLevel('incident','normal','Buss 30 stopper ikke på holdeplass Sandaker'),'high');
  assert.equal(C.alertLevel('general','severe','Sognsvann stasjon er stengt'),'high');
});

test('ringState: farge etter hastverk, klokkeslett ved lange ventetider',()=>{
  assert.equal(C.ringState(0,30,null).txt,'nå');
  assert.equal(C.ringState(1,30,null).cls,'go');
  assert.equal(C.ringState(4,30,null).cls,'soon');
  assert.equal(C.ringState(12,30,null).cls,'');
  assert.equal(C.ringState(12,30,null,1).cls,'go','hastverk kan styres av gangtid, ikke bare tallet');
  assert.equal(C.ringState(4.5,30,null).f,.15,'ringen tømmes jevnt, ikke ett minutt av gangen');
  assert.equal(C.ringState(-2,30,null).f,0);
  const far=C.ringState(120,30,'20:00');assert.equal(far.txt,'20:00');assert.equal(far.f,1);
  assert.equal(C.ringWord('gå om',0),'gå');assert.equal(C.ringWord('gå av om',3),'gå av om');
});
