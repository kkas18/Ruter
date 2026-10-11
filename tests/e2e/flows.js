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
