'use strict';
// Stegene testene går gjennom. Opptaket (record.js) bruker de samme stegene, så testene ber Entur om
// nøyaktig det som er lagret.
const flows={
  async home(page){
    await page.goto('/');
    await page.locator('.stop-card .sc-body .tl, .stop-card .sc-body .mini .d').first().waitFor({timeout:20000});
  },
  async openStop(page){
    await page.locator('.stop-card').first().click();
    await page.locator('#stopTl .tl').waitFor();
  },
  async openJourney(page){
    await page.locator('#stopTl button.tl-dot').first().click();
    await page.locator('.jv-list .jv-stop').first().waitFor();
  },
  // Ringlinje: en tur med to avganger fra holdeplassen (T-bane 5 kjører Ringen og kommer tilbake).
  // Velger turen som går først, og åpner den andre passeringen. Gir null hvis ingen tur har to.
  async openRing(page){
    const ring=await page.evaluate(()=>{const by=new Map();
      document.querySelectorAll('#sheetPage :is(.dep,button.tl-dot)[data-sj]').forEach(e=>{const sj=e.dataset.sj;
        if(sj)by.set(sj,new Set([...(by.get(sj)||[]),+e.dataset.at]));});
      const two=[...by].filter(([,a])=>a.size>1).map(([sj,a])=>({sj,first:Math.min(...a),at:Math.max(...a)}));
      return two.sort((x,y)=>x.first-y.first)[0]||null;});
    if(!ring)return null;
    await page.locator(`#sheetPage :is(.dep,button.tl-dot)[data-sj="${ring.sj}"][data-at="${ring.at}"]`).first().click();
    await page.locator('.jv-list .jv-stop.mine').waitFor();
    return ring;
  },
  async search(page,text){
    await page.locator('#searchBar').click();
    await page.locator('#toInput').fill(text);
    await page.locator('#suggestList [role="option"]').first().waitFor();
  },
  // Første treff med tastaturet: pil ned og Enter.
  async chooseWithKeyboard(page){
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('.trip[data-p]').first().waitFor({timeout:20000});
  },
  async fewerChanges(page){
    await page.locator('[data-opt="fewerChanges"]').click();
    await page.locator('.trip[data-p]').first().waitFor({timeout:20000});
  },
  async openTrip(page){
    await page.locator('.trip[data-p="0"]').click();
    await page.locator('#tripActions .chip').first().waitFor();
  },
  async english(page){
    await page.locator('#menuBtn').click();
    await page.locator('#langSeg [data-v="en"]').click();
  },
  // Trafikkmeldinger nederst på Hjem: dra-hanken først (arket helt opp), så lenken.
  async alerts(page){
    await page.locator('#sheetHandle').click();
    await page.locator('#alertsAll').click();
    await page.locator('#sheetPage .alert').first().waitFor();
  }
};
module.exports=flows;
