'use strict';
// Språk: oppslag, entall/flertall, valg av språk og at den engelske ordlisten er hel.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const I=require('../js/i18n.js');
const C=require('../js/core.js');

const inEnglish=fn=>{I.setLang('en');try{fn();}finally{I.setLang('nb');}};
const vars=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join(',');

test('detectLang følger telefonens språk: norsk først, ellers engelsk',()=>{
  assert.equal(I.detectLang(['nb-NO','en-US']),'nb');
  assert.equal(I.detectLang(['nn']),'nb');
  assert.equal(I.detectLang(['en-GB','nb']),'en');
  assert.equal(I.detectLang(['de-DE','en']),'en');
  assert.equal(I.detectLang(['sv-SE']),'nb','svensk og dansk leser norsk');
  assert.equal(I.detectLang(['fr-FR']),'en');
  assert.equal(I.detectLang([]),'nb');
});

test('tr og tn: norsk er kildeteksten, engelsk slås opp, variabler fylles inn',()=>{
  assert.equal(I.tr('Avganger'),'Avganger');
  assert.equal(I.tr('Ukjent nøkkel {n}',{n:3}),'Ukjent nøkkel 3');
  assert.equal(I.tn(1,'{n} stopp','{n} stopp'),'1 stopp');
  inEnglish(()=>{
    assert.equal(I.tr('Avganger'),'Departures');
    assert.equal(I.tr('Avganger fra {name}',{name:'Storo'}),'Departures from Storo');
    assert.equal(I.tn(1,'{n} stopp','{n} stopp'),'1 stop');
    assert.equal(I.tn(3,'{n} stopp','{n} stopp'),'3 stops');
    assert.equal(I.tr('Finnes ikke i ordlisten'),'Finnes ikke i ordlisten','mangler en oversettelse, vises norsk');
  });
});

test('den engelske ordlisten har samme variabler som den norske teksten, og ingen dobbeltnøkler',()=>{
  for(const [k,v] of Object.entries(I.EN))
    for(const e of Array.isArray(v)?v:[v])assert.equal(vars(e),vars(k),`«${k}» → «${e}»`);
  const src=fs.readFileSync(path.join(__dirname,'../js/i18n.js'),'utf8');
  const keys=[...src.slice(src.indexOf('const EN={'),src.indexOf('};',src.indexOf('const EN={'))).matchAll(/'((?:[^'\\]|\\.)*)':/g)].map(m=>m[1]);
  const dup=keys.filter((k,i)=>keys.indexOf(k)!==i);
  assert.deepEqual(dup,[],'samme nøkkel to ganger: den siste vinner i stillhet');
});

test('kjernelogikken på engelsk: bytter, avstand, «rekker du den» og ringen',()=>{
  inEnglish(()=>{
    assert.equal(C.changesText(0),'Direct');
    assert.equal(C.changesText(1),'1 change');
    assert.equal(C.changesText(2),'2 changes');
    assert.equal(C.fmtDist(1234),'1.2 km');
    const now=Date.UTC(2026,9,10,18,0,0);
    assert.equal(C.reachStatus(100,now+10*60000,now).label,'Leave in 6 min');
    const zero=C.ringState(0,30,null,0,'Gå om');
    assert.deepEqual([zero.txt,zero.unit,zero.label],['Leave','now','Leave now']);
    assert.equal(C.ringState(5,30,null,5,'Går om').label,'Departs in 5 min');
  });
  assert.equal(C.changesText(2),'2 bytter','tilbake på norsk etterpå');
});
