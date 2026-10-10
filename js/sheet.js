'use strict';
/* REIS – Arket og sidestabelen: dra-gester, høyder og ruteren (frem/tilbake). */

/* =====================================================================
   ARKET – tre høyder, dras med fingeren, reagerer på fart
   ===================================================================== */
const sheet=$('#sheet'),sheetScroll=$('#sheetScroll');
const sheetUI={snap:'half',visible:280,snaps:['peek','half','full']};
function snapPx(name){
  const H=sheet.offsetHeight;
  if(name==='full')return H;
  if(name==='half')return Math.round(Math.min(H,innerHeight*.5));
  return router.cur.peek||176;
}
function setVisible(px,animate=true){
  sheetUI.visible=px;
  sheet.classList.toggle('dragging',!animate);
  document.body.classList.toggle('sheet-dragging',!animate);
  document.documentElement.style.setProperty('--sheet-visible',px+'px');
  const H=sheet.offsetHeight;
  sheet.classList.toggle('full',px>=H-2);
  document.body.classList.toggle('sheet-full',px>=H-2);
  document.body.classList.toggle('sheet-tall',px>innerHeight*.62);
}
function snapTo(name,animate=true){
  if(!sheetUI.snaps.includes(name))name=sheetUI.snaps[sheetUI.snaps.length-1];
  const prev=sheetUI.snap;sheetUI.snap=name;setVisible(snapPx(name),animate);
  if(prev!==name)sheetUI.onSnap?.(name);
  if(mapLoaded)map.setPadding(mapPadding());
}
let drag=null,suppressClick=false;
sheet.addEventListener('pointerdown',e=>{
  if(wide.matches||e.button>0)return;
  if(e.target.closest('input,select,textarea,.seg,.filters,.filter'))return;
  const inHead=!!e.target.closest('.sheet-handle,.sheet-head');
  if(sheet.classList.contains('full')&&!inHead)return; // fullt ark: innholdet ruller
  drag={y:e.clientY,t:performance.now(),start:sheetUI.visible,moved:false,id:e.pointerId,last:e.clientY,lt:performance.now(),v:0};
});
// Bevegelse lyttes på vinduet: dras arket oppover, havner pekeren over kartet før arket følger etter.
addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.id)return;
  const dy=e.clientY-drag.y;
  if(!drag.moved){if(Math.abs(dy)<7)return;drag.moved=true;}
  const now=performance.now();drag.v=(e.clientY-drag.last)/Math.max(1,now-drag.lt);drag.last=e.clientY;drag.lt=now;
  const H=sheet.offsetHeight,min=Math.min(...sheetUI.snaps.map(snapPx));
  let v=drag.start-dy;
  if(v>H)v=H+(v-H)/4;           // gummistrikk i toppen
  if(v<min)v=min-(min-v)/2.5;   // og i bunnen
  setVisible(v,false);
});
function endDrag(e){
  if(!drag||e.pointerId!==drag.id)return;
  const d=drag;drag=null;
  if(!d.moved)return;
  suppressClick=true;setTimeout(()=>suppressClick=false,60);
  const cur=sheetUI.visible,v=-d.v; // positiv = opp
  const opts=sheetUI.snaps.map(n=>({n,px:snapPx(n)})).sort((a,b)=>a.px-b.px);
  // Dra langt ned på en side som bare har fullt ark = tilbake.
  if(opts.length===1&&e.clientY-d.y>110){router.back();return;}
  let target;
  if(Math.abs(v)>.5)target=v>0?opts.find(o=>o.px>cur+4)||opts[opts.length-1]:[...opts].reverse().find(o=>o.px<cur-4)||opts[0];
  else target=opts.reduce((a,b)=>Math.abs(b.px-cur)<Math.abs(a.px-cur)?b:a);
  buzz(5);snapTo(target.n);
}
addEventListener('pointerup',endDrag);
addEventListener('pointercancel',e=>{if(drag&&e.pointerId===drag.id){drag=null;snapTo(sheetUI.snap);}});
sheet.addEventListener('click',e=>{if(suppressClick){e.stopPropagation();e.preventDefault();}},true);
$('#sheetHandle').addEventListener('click',()=>{
  const order=sheetUI.snaps,i=order.indexOf(sheetUI.snap);snapTo(order[(i+1)%order.length]);});
$('#sheetHandle').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#sheetHandle').click();}});
addEventListener('resize',()=>snapTo(sheetUI.snap,false));

/* =====================================================================
   SIDER – én stabel, felles tilbake (knapp, Esc, Android-tilbake)
   ===================================================================== */
const pages={};
const router={
  cur:{name:'home',params:{}},stack:[],skipPop:0,
  show(name,params={},dir='fwd',keepSnap=false){
    const prev=this.cur.name;
    if(pages[prev]?.leave)pages[prev].leave();
    this.cur={name,params,...pages[name]};
    document.body.dataset.page=name;
    sheetUI.snaps=pages[name].snaps||['peek','half','full'];
    this.render(dir);
    if(!keepSnap)snapTo(params.snap||pages[name].initial||'half');
    else snapTo(sheetUI.snap);
    pages[name].enter?.(params,dir);
    // Ved bytte av side flyttes fokus til overskriften, så skjermlesere leser hvor du er.
    if(dir)requestAnimationFrame(()=>{const h=$('#sheetHead .head-title');if(h){h.tabIndex=-1;h.focus({preventScroll:true});}});
    renderStopsLayer();renderVehicleLayer();
    if(name==='home'||name==='stop')setTimeout(()=>{refreshVehicles(true);loadEstVehicles(true);loadViewDeps();},300);
  },
  render(dir='fwd'){
    const p=pages[this.cur.name];
    $('#sheetHead').className='sheet-head'+(p.headClass?' '+p.headClass:'');
    $('#sheetHead').innerHTML=p.head(this.cur.params);
    const page=$('#sheetPage');
    page.className='sheet-page'+(dir==='back'?' back':'');
    if(dir)void page.offsetWidth;
    page.innerHTML=p.body(this.cur.params);
    if(dir){sheetScroll.scrollTop=0;}else page.style.animation='none';
    if(dir)page.style.animation='';
    $('#sheetHead .back')?.addEventListener('click',()=>{buzz(6);router.back();});
    p.bind?.(this.cur.params);
  },
  refresh(){ // oppdater innhold uten animasjon og uten å miste rulleposisjon
    const st=sheetScroll.scrollTop,p=pages[this.cur.name];
    if(p.update)p.update(this.cur.params);else{this.render(null);sheetScroll.scrollTop=st;}
  },
  go(name,params={},{replace=false}={}){
    if(name===this.cur.name&&JSON.stringify(params)===JSON.stringify(this.cur.params))return;
    if(!replace){this.stack.push({name:this.cur.name,params:this.cur.params,snap:sheetUI.snap});history.pushState({d:this.stack.length},'');}
    this.show(name,params,'fwd');
  },
  back(){if(this.stack.length)history.back();},
  home(){
    const n=this.stack.length;this.stack.length=0;
    if(n){this.skipPop++;history.go(-n);}
    this.show('home',{},'back');
  }
};
history.replaceState({d:0},'');
sheetUI.onSnap=()=>{if(router.cur.name==='stop')updateStopCallout(router.cur.params.id);};
addEventListener('popstate',()=>{
  if(router.skipPop){router.skipPop--;return;}
  const prev=router.stack.pop();if(!prev)return;
  router.show(prev.name,prev.params,'back',true);snapTo(prev.snap||'half');
});
addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.target.closest?.('input'))router.back();});
const backBtn='<button class="icon-btn back press" type="button" aria-label="Tilbake">'+ico('back')+'</button>';
