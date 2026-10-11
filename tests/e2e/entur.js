'use strict';
/* Lagrede svar fra Entur for ende-til-ende-testene. record.js tar dem opp fra det ekte API-et, og
   replay() spiller dem av, så testene gir samme svar hver gang uten nett og uavhengig av hva som
   kjører akkurat nå. Klokken i nettleseren settes til opptakstidspunktet (recordedAt), så minuttene
   stemmer med dataene. Kartflisene erstattes med tomme fliser. */
const fs=require('node:fs');
const path=require('node:path');
const FILE=path.join(__dirname,'fixtures','entur.json');
const keyOf=(method,url,body)=>`${method} ${url} ${body||''}`;
// Spørringer med koordinater fra kartutsnittet kan skille seg på siste desimal mellom kjøringer.
// «Formen» er spørringen uten tall; den brukes når det ikke finnes et nøyaktig treff.
const shape=k=>k.replace(/-?\d+(\.\d+)?/g,'#');
const load=()=>JSON.parse(fs.readFileSync(FILE,'utf8'));
// Felles oppsett for opptak og avspilling: samme sted, skjerm, språk og lagrede valg.
const HOME={latitude:59.92598,longitude:10.77757,accuracy:6}; // Carl Berners plass
const CONTEXT={viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'nb-NO',timezoneId:'Europe/Oslo',
  geolocation:HOME,permissions:['geolocation','clipboard-read','clipboard-write'],serviceWorkers:'block'};
function initStorage(){
  localStorage.setItem('reisOnboarded','1');
  localStorage.setItem('reisPlaces',JSON.stringify({home:{name:'Storo',lat:59.94527,lon:10.778637}}));
  // Kjøretøy av: posisjonene endrer seg hvert sekund og hører ikke hjemme i lagrede svar.
  localStorage.setItem('reisSettings',JSON.stringify({showVehicles:false}));
}
const TILEJSON={tilejson:'3.0.0',tiles:['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf'],minzoom:0,maxzoom:14};
async function stubMap(context){
  await context.route(/^https:\/\/tiles\.openfreemap\.org\//,route=>/\/planet$/.test(route.request().url())?
    route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(TILEJSON)}):
    route.fulfill({status:200,contentType:'application/x-protobuf',body:Buffer.alloc(0)}));
  await context.route(/^https:\/\/server\.arcgisonline\.com\//,route=>route.fulfill({status:404,body:''}));
}
const nums=k=>(k.match(/-?\d+(\.\d+)?/g)||[]).map(Number);
// Uten nøyaktig treff: samme form, og av dem den med nærmest tall (typisk et litt annet kartutsnitt).
function nearest(list,k){
  const n=nums(k),dist=e=>e.nums.reduce((s,x,i)=>s+Math.abs(x-(n[i]??0)),0);
  return list.reduce((a,b)=>dist(b)<dist(a)?b:a).entry;
}
async function replay(context,fixtures=load()){
  const exact=new Map(),byShape=new Map(),missing=[];
  for(const e of fixtures.entries){
    const k=keyOf(e.method,e.url,e.body);exact.set(k,e);
    const s=shape(k);if(!byShape.has(s))byShape.set(s,[]);byShape.get(s).push({nums:nums(k),entry:e});
  }
  await context.route(/^https:\/\/api\.entur\.io\//,route=>{
    const r=route.request(),k=keyOf(r.method(),r.url(),r.postData()),same=byShape.get(shape(k));
    const e=exact.get(k)||(same&&nearest(same,k));
    if(!e){missing.push(k.slice(0,160));return route.fulfill({status:200,contentType:'application/json',body:'{"data":{}}'});}
    return route.fulfill({status:e.status,contentType:e.type,body:e.text});
  });
  await stubMap(context);
  return missing;
}
module.exports={FILE,keyOf,shape,load,HOME,CONTEXT,initStorage,stubMap,replay};
