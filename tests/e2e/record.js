'use strict';
/* Tar opp svarene fra Entur for ende-til-ende-testene: `npm run e2e:record` (krever nett).
   Kjør på nytt når Entur endrer API-et, eller når testene trenger nye data. Svarene lagres i
   fixtures/entur.json sammen med tidspunktet de ble hentet, som testene stiller klokken til. */
const {chromium}=require('@playwright/test');
const {spawn}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const {FILE,keyOf,CONTEXT,initStorage,stubMap}=require('./entur.js');
const flows=require('./flows.js');
const PORT=8131,BASE=`http://localhost:${PORT}`;

// Trafikkmeldingene for hele Ruter er store: behold dem som gjelder linjene i opptaket, og noen til.
function trimAlerts(xml,lines,others=12){
  const all=xml.match(/<PtSituationElement[\s\S]*?<\/PtSituationElement>/g)||[];
  const mine=all.filter(s=>[...lines].some(l=>s.includes(`:Line:${l}<`)));
  const keep=[...mine,...all.filter(s=>!mine.includes(s)).slice(0,others)];
  if(keep.length===all.length)return xml;
  const start=xml.indexOf(all[0]),end=xml.lastIndexOf('</PtSituationElement>')+'</PtSituationElement>'.length;
  return xml.slice(0,start)+keep.join('\n')+xml.slice(end);
}

(async()=>{
  const server=spawn(process.execPath,[path.join(__dirname,'serve.js')],{env:{...process.env,PORT:String(PORT)},stdio:'ignore'});
  await new Promise(r=>setTimeout(r,600));
  const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
  const context=await browser.newContext({...CONTEXT,baseURL:BASE});
  await context.addInitScript(initStorage);
  await stubMap(context);
  const entries=new Map(),recordedAt=Date.now();
  await context.route(/^https:\/\/api\.entur\.io\//,async route=>{
    const r=route.request(),res=await route.fetch(),text=await res.text();
    const k=keyOf(r.method(),r.url(),r.postData());
    if(!entries.has(k))entries.set(k,{method:r.method(),url:r.url(),body:r.postData()||'',status:res.status(),
      type:(res.headers()['content-type']||'application/json').split(';')[0],text});
    await route.fulfill({response:res,body:text});
  });
  const page=await context.newPage();
  try{
    await flows.home(page);await page.waitForTimeout(3000);
    await flows.openStop(page);await flows.openJourney(page);await page.waitForTimeout(2000);
    await flows.home(page);await flows.openStop(page);await flows.openRing(page);await page.waitForTimeout(2000);
    await flows.home(page);await flows.search(page,'Storo');await flows.chooseWithKeyboard(page);
    await flows.fewerChanges(page);await flows.openTrip(page);await page.waitForTimeout(2000);
    await flows.home(page);await flows.alerts(page);
    await flows.home(page);await flows.english(page);await page.waitForTimeout(3000);
  }finally{
    await browser.close();server.kill();
  }
  // Linjene i opptaket, for å beholde trafikkmeldingene som angår dem.
  const lines=new Set();
  for(const e of entries.values())for(const m of e.text.matchAll(/"publicCode":"([^"]+)"/g))lines.add(m[1]);
  for(const e of entries.values())if(e.url.includes('/realtime/v1/rest/sx'))e.text=trimAlerts(e.text,lines);
  const out={recordedAt,recordedIso:new Date(recordedAt).toISOString(),entries:[...entries.values()]};
  fs.mkdirSync(path.dirname(FILE),{recursive:true});
  fs.writeFileSync(FILE,JSON.stringify(out,null,1));
  console.log(`Lagret ${out.entries.length} svar (${Math.round(fs.statSync(FILE).size/1024)} kB) i ${path.relative(process.cwd(),FILE)}`);
})();
