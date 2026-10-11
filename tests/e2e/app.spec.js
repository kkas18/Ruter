'use strict';
/* Ende-til-ende: hovedflytene i en ekte nettleser, med lagrede svar fra Entur og klokken stilt til
   opptakstidspunktet. Hver skjerm sjekkes med axe (WCAG 2.2 AA): ingen alvorlige eller kritiske
   brudd. Etter hver test: ingen skriptfeil og ingen brudd på sikkerhetsreglene (CSP). */
const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const {load,CONTEXT,initStorage,replay}=require('./entur.js');
const flows=require('./flows.js');
const FIX=load();
const AXE=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');

test.use(CONTEXT);

let missing=[];
test.beforeEach(async({context,page})=>{
  missing=await replay(context,FIX);
  await page.clock.setSystemTime(FIX.recordedAt);
  await context.addInitScript(initStorage);
  await context.addInitScript(()=>{window.__csp=[];
    document.addEventListener('securitypolicyviolation',e=>window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));});
  page.errors=[];
  page.on('pageerror',e=>page.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')page.errors.push(m.text());});
});
test.afterEach(async({page})=>{
  // Et kall som ikke finnes i opptaket, ville fått et tomt svar. Da er opptaket for gammelt: npm run e2e:record.
  expect(missing,'kall til Entur som mangler i opptaket').toEqual([]);
  expect(page.errors,'feil i konsollen').toEqual([]);
  expect(await page.evaluate(()=>window.__csp),'brudd på sikkerhetsreglene').toEqual([]);
});

// axe kjøres gjennom DevTools-protokollen, så den ikke trenger unntak fra sikkerhetsreglene. Først
// ventes det til innfadingene er ferdige: midt i en innfading er teksten gjennomsiktig, og axe ville
// målt for lav kontrast. Pulser i løkke og overganger som går hvert sekund (ringen, sporet) teller ikke.
const settled=page=>page.waitForFunction(()=>document.getAnimations().every(a=>!(a instanceof CSSAnimation)||a.playState!=='running'||
  a.effect?.getComputedTiming().iterations===Infinity),null,{timeout:8000});
async function expectAccessible(page,where){
  await settled(page);
  if(!(await page.evaluate(()=>typeof axe!=='undefined')))await page.evaluate(AXE);
  const res=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']},resultTypes:['violations']}));
  const bad=res.violations.filter(v=>v.impact==='serious'||v.impact==='critical')
    .map(v=>`${v.id} (${v.impact}): ${v.nodes.slice(0,3).map(n=>`${n.target.join(' ')} – ${(n.failureSummary||'').replace(/\s+/g,' ').slice(0,160)}`).join(' | ')}`);
  expect(bad,`tilgjengelighet: ${where}`).toEqual([]);
}
const rides=page=>page.evaluate(()=>state.trips.map(p=>p.legs.filter(l=>l.mode!=='foot').length));

test('Hjem viser holdeplassene rundt deg med tidslinje og snarveien Hjem',async({page})=>{
  await flows.home(page);
  await expect(page.locator('#sheetHead .head-title')).toHaveText('Avganger');
  await expect(page.locator('.stop-card').first()).toBeVisible();
  await expect(page.locator('.place-tile[data-place="home"]')).toContainText('Hjem');
  await expect(page.locator('#onboard')).toBeHidden();
  await expectAccessible(page,'Hjem');
});

test('Holdeplass: tidslinje, og en prikk åpner turen med alle stopp',async({page})=>{
  await flows.home(page);
  await flows.openStop(page);
  await expect(page.locator('#stopTl .tl-lane').first()).toBeVisible();
  await expectAccessible(page,'Holdeplass');
  await flows.openJourney(page);
  expect(await page.locator('.jv-list .jv-stop').count()).toBeGreaterThan(3);
  // Linjemerket i toppen har piktogrammet for transportmiddelet.
  await expect(page.locator('#sheetHead .jv-title .badge.with-icon svg')).toBeVisible();
  await expectAccessible(page,'Turen');
});

test('Ringlinje: begge passeringene vises, og den andre åpner turen der',async({page})=>{
  await flows.home(page);
  await flows.openStop(page);
  const ring=await flows.openRing(page);
  expect(ring,'en tur med to avganger fra holdeplassen (T-bane 5)').not.toBeNull();
  // «Din holdeplass» er den andre gangen turen passerer holdeplassen, ikke den første.
  const stops=await page.locator('.jv-list .jv-stop').evaluateAll(els=>els.map(e=>({i:+e.dataset.i,mine:e.classList.contains('mine'),
    name:e.querySelector('.jv-name').firstChild.textContent})));
  const mine=stops.find(s=>s.mine),same=stops.filter(s=>s.name===mine.name);
  expect(same.length,`turen passerer ${mine.name} to ganger`).toBe(2);
  expect(mine.i,'andre passering').toBe(same[1].i);
});

test('Søk med tastatur, færre bytter og reisen med varsel, deling og billett',async({page})=>{
  await flows.home(page);
  await flows.search(page,'Storo');
  await expect(page.locator('#toInput')).toHaveAttribute('aria-expanded','true');
  await expectAccessible(page,'Søk');
  await flows.chooseWithKeyboard(page);
  await expect(page.locator('#sheetHead .head-title')).toContainText('Storo');
  await expectAccessible(page,'Reiseforslag');
  await flows.fewerChanges(page);
  await expect(page.locator('[data-opt="fewerChanges"]')).toHaveAttribute('aria-pressed','true');
  const r=await rides(page);
  expect(r,'færrest bytter først').toEqual([...r].sort((a,b)=>a-b));
  await flows.openTrip(page);
  await expect(page.locator('#goAlertBtn')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#shareBtn')).toBeVisible();
  await expect(page.locator('#ticketBtn')).toHaveAttribute('href',/ruter\.no|apps\.apple\.com|play\.google\.com/);
  await page.evaluate(()=>{navigator.share=undefined;}); // deling uten delingsark: kopieres
  await page.locator('#shareBtn').click();
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toContain('Er fremme ved');
  await expectAccessible(page,'Reisen');
});

test('Engelsk: språket byttes uten omstart',async({page})=>{
  await flows.home(page);
  await flows.english(page);
  await expect(page.locator('#sheetHead .head-title')).toHaveText('Settings');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.locator('#searchBar span')).toHaveText('Where to?');
  await expectAccessible(page,'Settings');
  await page.evaluate(()=>router.back());
  await expect(page.locator('#sheetHead .head-title')).toHaveText('Departures');
  await expectAccessible(page,'Home (English)');
});

test('Trafikkmeldinger: gruppert, og ingen brudd på tilgjengeligheten',async({page})=>{
  await flows.home(page);
  await flows.alerts(page);
  await expect(page.locator('#sheetHead .head-title')).toHaveText('Trafikkmeldinger');
  await expectAccessible(page,'Trafikkmeldinger');
  // Lange meldinger er kortet ned til to linjer og foldes ut med «Vis mer» (også i en sammenfoldet seksjon).
  const more=page.locator('#sheetPage .alert .more').first();
  if(!(await more.isVisible()))await page.locator('#sheetPage details.alert-sec',{has:page.locator('.more')}).first().locator('summary').click();
  await expect(more).toHaveAttribute('aria-expanded','false');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded','true');
  await expect(more).toHaveText('Vis mindre');
  await expect(page.locator('#'+await more.getAttribute('aria-controls'))).toHaveClass(/open/);
});

test('Frakoblet: tydelig beskjed og ingen feilmeldinger',async({page,context})=>{
  await flows.home(page);
  await context.setOffline(true);
  await expect(page.locator('#netChip')).toHaveText('Frakoblet');
  await context.setOffline(false);
});

test.describe('Mørkt tema',()=>{
  test.use({colorScheme:'dark'});
  test('Hjem og holdeplass har nok kontrast',async({page})=>{
    await flows.home(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    await expectAccessible(page,'Hjem (mørkt)');
    await flows.openStop(page);
    await expectAccessible(page,'Holdeplass (mørkt)');
  });
});
