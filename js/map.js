'use strict';
/* REIS – Kartet: MapLibre-stil, lag for rute, holdeplasser og kjøretøy, piktogrammer og avgangskort. */

/* =====================================================================
   KART
   ===================================================================== */
// Kartets egne tekster (skjermleser og verktøytips) på appens språk.
const mapUiStrings=()=>({'Map.Title':tr('Kart'),'Marker.Title':tr('Markør'),'Popup.Close':tr('Lukk'),
  'AttributionControl.ToggleAttribution':tr('Vis kildehenvisning'),'AttributionControl.MapFeedback':tr('Meld feil i kartet')});
const map=new maplibregl.Map({
  container:'map',style:ReisMapStyle.build(resolveTheme()),center:[OSLO[1],OSLO[0]],zoom:13.5,
  attributionControl:false,pitchWithRotate:false,touchPitch:false,dragRotate:true,maxZoom:19,minZoom:5,
  fadeDuration:150,cooperativeGestures:false,locale:mapUiStrings()
});
map.addControl(new maplibregl.AttributionControl({compact:true}),'top-left');
map.touchZoomRotate.enableRotation();
let mapLoaded=false;
const EMPTY={type:'FeatureCollection',features:[]};
const fc=features=>({type:'FeatureCollection',features});
const setData=(id,data)=>{const s=mapLoaded&&map.getSource(id);if(s)s.setData(data);};

const isSat=()=>settings.basemap==='sat';
// Arket dekker kartet (helt oppe på mobil): da trengs ingen kartoppdateringer. Settes i main.js.
const mapCovered=()=>document.body.classList.contains('map-covered');
function overlayColors(){
  const dark=resolveTheme()==='dark',p=ReisMapStyle.palette(resolveTheme());
  // Over flybilder trengs hvit kontur og hvit tekst med mørk kant, uansett tema.
  if(isSat())return{case:'#FFFFFF',stopFill:'#FFFFFF',stopRing:'#14191C',label:'#FFFFFF',halo:'rgba(0,0,0,0.8)',walk:'#FFFFFF',me:'#5B8DF5'};
  return{case:dark?'#0F1316':'#FFFFFF',stopFill:dark?'#EEECE6':'#FFFFFF',stopRing:dark?'#0F1316':'#14191C',
    label:dark?'#D3D7D9':'#2D3438',halo:p.halo,walk:dark?'#B3BABE':'#465055',me:dark?'#5B8DF5':'#2F6FEB'};
}
function applyOverlayTheme(){
  const c=overlayColors();
  const set=(l,p,v)=>map.getLayer(l)&&map.setPaintProperty(l,p,v);
  set('route-case','line-color',c.case);set('route-walk','line-color',c.walk);
  set('route-stop','circle-color',c.case);set('route-stop-minor','circle-color',c.case);
  ['stops-label','stops-label-major'].forEach(l=>{set(l,'text-color',c.label);set(l,'text-halo-color',c.halo);});
  set('acc','fill-color',c.me);set('acc-line','line-color',c.me);
  set('route-stop-label','text-color',c.label);set('route-stop-label','text-halo-color',c.halo);
  renderStopsLayer(); // avgangskortene har egne farger for lys, mørk og satellitt
}
// Én knapp på kartet veksler mellom kart og satellitt (hybrid med navn oppå).
function setBasemap(mode){
  settings.basemap=mode;saveSettings();
  $('#layerBtn').setAttribute('aria-pressed',String(mode==='sat'));
  $('#layerBtn').setAttribute('aria-label',mode==='sat'?tr('Vis kart'):tr('Vis satellitt'));
  document.body.classList.toggle('sat',mode==='sat');
  if(mapLoaded){ReisMapStyle.applyTheme(map,resolveTheme(),mode==='sat');applyOverlayTheme();}
}
$('#layerBtn').onclick=()=>{buzz(8);setBasemap(isSat()?'map':'sat');toast(isSat()?tr('Satellitt'):tr('Kart'));};
// Bildene til kartet tegnes på et lerret og leses tilbake med getImageData. willReadFrequently gir et
// lerret i vanlig minne, så tilbakelesingen ikke må hente pikslene fra skjermkortet hver gang.
function imageCtx(w,h){const cv=document.createElement('canvas');cv.width=w;cv.height=h;return cv.getContext('2d',{willReadFrequently:true});}
let measureCtx$=null;
const measureCtx=()=>measureCtx$||(measureCtx$=imageCtx(1,1));
// Kjøretøymerke med linjenummeret tegnet inn i bildet, så merker som overlapper legger
// seg pent oppå hverandre (tekst i eget lag ville blandet tallene). Lages ved behov per
// transportmiddel + linje; GPS-kjøretøy får en grønn live-prikk.
function badgeImage(mode,line,gps){
  const color=modeOf(mode).c,label=line||'•',font='800 30px "Schibsted Grotesk", system-ui, sans-serif';
  const m=measureCtx();m.font=font;
  const H=60,W=Math.max(60,Math.ceil(m.measureText(label).width)+34)+(gps?10:0);
  const g=imageCtx(W,H);
  const top=gps?8:4,bw=W-(gps?12:8);
  g.beginPath();g.roundRect(4,top,bw,H-top-4,(H-top-4)/2);g.fillStyle=color;g.fill();g.lineWidth=5;g.strokeStyle='#fff';g.stroke();
  g.font=font;g.fillStyle=modeOf(mode).o;g.textAlign='center';g.textBaseline='middle';g.fillText(label,4+bw/2,top+(H-top-4)/2+1);
  if(gps){g.beginPath();g.arc(W-11,11,8,0,Math.PI*2);g.fillStyle='#2FD07A';g.fill();g.lineWidth=3.5;g.strokeStyle='#fff';g.stroke();}
  return g.getImageData(0,0,W,H);
}
map.on('styleimagemissing',e=>{
  const m=/^vb\|(\w+)\|(.*)\|([01])$/.exec(e.id);if(!m||map.hasImage(e.id))return;
  map.addImage(e.id,badgeImage(m[1],m[2],m[3]==='1'),{pixelRatio:2});
});
// Retningspil som roterer rundt merket.
function headingImage(color){
  const S=112,g=imageCtx(S,S);
  g.translate(S/2,0);g.beginPath();g.moveTo(0,4);g.lineTo(13,22);g.lineTo(-13,22);g.closePath();
  g.lineJoin='round';g.lineWidth=5;g.strokeStyle='#fff';g.stroke();g.fillStyle=color;g.fill();
  return g.getImageData(0,0,S,S);
}
function vehicleImage(color,est=false){
  const s=56,g=imageCtx(s,s);
  g.translate(s/2,s/2);
  if(est){g.beginPath();g.arc(0,0,25,0,Math.PI*2);g.setLineDash([5,4]);g.lineWidth=2.5;g.strokeStyle=color;g.stroke();g.setLineDash([]);}
  g.beginPath();g.moveTo(0,-21);g.lineTo(17,19);g.lineTo(0,10);g.lineTo(-17,19);g.closePath();
  g.lineJoin='round';g.lineWidth=6;g.strokeStyle='#fff';g.stroke();g.fillStyle=color;g.fill();
  return g.getImageData(0,0,s,s);
}
map.on('load',()=>{
  mapLoaded=true;
  const c=overlayColors();
  Object.entries({...MODES,other:{c:'#5D676C'}}).forEach(([k,m])=>{map.addImage('veh-'+k,vehicleImage(m.c),{pixelRatio:2});
    map.addImage('veh-est-'+k,vehicleImage(m.c,true),{pixelRatio:2});
    map.addImage('dir-'+k,headingImage(m.c),{pixelRatio:2});});
  ['acc','route','route-stops','stops','vehicles','approach'].forEach(id=>map.addSource(id,{type:'geojson',data:EMPTY}));
  map.addLayer({id:'acc',type:'fill',source:'acc',paint:{'fill-color':c.me,'fill-opacity':.08}});
  map.addLayer({id:'acc-line',type:'line',source:'acc',paint:{'line-color':c.me,'line-opacity':.3,'line-width':1}});
  // Holdeplasser: stasjoner (tog, T-bane, trikk, båt) er større og får navn først;
  // bussholdeplasser får navn når du zoomer inn. Navn som kolliderer sorteres bort.
  // Holdeplasser: zoomet ut som små prikker i transportmiddelets farge, nærmere som
  // piktogram (buss, trikk, T-bane, tog, båt) – gjenkjennelig på et øyeblikk.
  ['bus','tram','metro','rail','water'].forEach(m=>{map.addImage('stop-'+m,stopIcon(m,false),{pixelRatio:2});map.addImage('stop-'+m+'-fav',stopIcon(m,true),{pixelRatio:2});});
  map.addLayer({id:'stops',type:'circle',source:'stops',minzoom:12,maxzoom:STOP_ICON_ZOOM,paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],12,['case',['get','major'],3.5,2.2],STOP_ICON_ZOOM,['case',['get','major'],6,4.5]],
    'circle-color':['get','color'],'circle-stroke-color':'#FFFFFF','circle-stroke-width':['interpolate',['linear'],['zoom'],12,1,14,1.8],
    'circle-opacity':['interpolate',['linear'],['zoom'],12,0,12.5,1],'circle-stroke-opacity':['interpolate',['linear'],['zoom'],12,0,12.5,1]}});
  map.addLayer({id:'stop-icons',type:'symbol',source:'stops',minzoom:STOP_ICON_ZOOM,layout:{
    'icon-image':['concat','stop-',['get','icon'],['case',['get','fav'],'-fav','']],
    'icon-size':['interpolate',['linear'],['zoom'],STOP_ICON_ZOOM,['case',['get','major'],.8,.7],16,['case',['get','major'],1.05,.95],18,['case',['get','major'],1.3,1.2]],
    'icon-allow-overlap':true,'icon-ignore-placement':true,'symbol-sort-key':['get','rank']},
    paint:{'icon-opacity':['interpolate',['linear'],['zoom'],STOP_ICON_ZOOM,0,STOP_ICON_ZOOM+.25,1]}});
  map.addLayer({id:'stop-sel',type:'circle',source:'stops',filter:['==',['get','id'],''],paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],12,9,16,13],'circle-color':'rgba(255,200,0,0.25)',
    'circle-stroke-color':'#FFC800','circle-stroke-width':3.5}},'stops');
  const stopLabel=(id,minzoom,filter,size)=>map.addLayer({id,type:'symbol',source:'stops',minzoom,filter,layout:{
    'text-field':['get','name'],'text-font':['Noto Sans Bold'],'text-size':size,
    'text-variable-anchor':['top','bottom','right','left'],'text-radial-offset':['interpolate',['linear'],['zoom'],12,.85,STOP_ICON_ZOOM,1.6,17,1.9],'text-justify':'auto',
    'text-max-width':9,'text-optional':true,'symbol-sort-key':['get','rank'],'text-padding':3},
    paint:{'text-color':c.label,'text-halo-color':c.halo,'text-halo-width':1.6,
      'text-opacity':['interpolate',['linear'],['zoom'],minzoom,0,minzoom+.4,1]}});
  // Holdeplasser med avgangskort (fra gatenivå) viser navnet i kortet i stedet for som lapp.
  stopLabel('stops-label-major',12,['all',['==',['get','major'],true],['!',['has','card']]],['interpolate',['linear'],['zoom'],12,11,15,12.5,18,14]);
  stopLabel('stops-label',13.6,['all',['!=',['get','major'],true],['!',['has','card']]],['interpolate',['linear'],['zoom'],13.6,10.5,16,12,18,13]);
  // Bussens vei fram til holdeplassen din: stiplet i linjefargen, med stoppene den har igjen.
  map.addLayer({id:'approach-line',type:'line',source:'approach',filter:['==',['geometry-type'],'LineString'],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['interpolate',['linear'],['zoom'],10,2.5,16,5],
    'line-opacity':.75,'line-dasharray':[1.2,1.6]}});
  map.addLayer({id:'approach-stops',type:'circle',source:'approach',filter:['==',['geometry-type'],'Point'],paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],10,2,15,4],'circle-color':c.case,'circle-stroke-color':['get','color'],'circle-stroke-width':2,'circle-opacity':.9}});
  map.addLayer({id:'route-case',type:'line',source:'route',filter:['!',['get','walk']],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':c.case,'line-width':['interpolate',['linear'],['zoom'],10,6,16,12]}});
  map.addLayer({id:'route-line',type:'line',source:'route',filter:['!',['get','walk']],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':['interpolate',['linear'],['zoom'],10,3.5,16,7]}});
  map.addLayer({id:'route-walk',type:'line',source:'route',filter:['get','walk'],
    layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':c.walk,'line-width':['interpolate',['linear'],['zoom'],10,2.5,16,4.5],'line-dasharray':[0,1.8]}});
  // Alle holdeplasser langs valgt rute: små prikker for stopp underveis, store for på/av og bytte.
  map.addLayer({id:'route-stop-minor',type:'circle',source:'route-stops',filter:['get','minor'],paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],10,2,14,3.6,17,5],'circle-color':c.case,'circle-stroke-color':['get','color'],
    'circle-stroke-width':['interpolate',['linear'],['zoom'],10,1.5,15,2.5]}});
  map.addLayer({id:'route-stop',type:'circle',source:'route-stops',filter:['!',['get','minor']],paint:{
    'circle-radius':['interpolate',['linear'],['zoom'],10,4.5,15,7],'circle-color':c.case,'circle-stroke-color':['get','color'],'circle-stroke-width':3.5}});
  map.addLayer({id:'route-stop-label',type:'symbol',source:'route-stops',
    filter:['any',['!',['get','minor']],['>=',['zoom'],13.5]],layout:{
    'text-field':['format',['get','name'],{'font-scale':1},['case',['!=',['get','clock'],''],['concat','  ',['get','clock']],''],{'font-scale':.92,'text-font':['literal',['Noto Sans Regular']]}],
    'text-font':['Noto Sans Bold'],'text-size':['case',['get','minor'],11,12.5],'text-anchor':'left','text-offset':[.9,0],
    'text-max-width':14,'text-optional':true,'symbol-sort-key':['case',['get','minor'],2,1]},
    paint:{'text-color':c.label,'text-halo-color':c.halo,'text-halo-width':1.6}});
  // Kjøretøy: retningspil under, farget merke med linjenummer over. Vokser når du zoomer inn.
  const vehScale=['interpolate',['linear'],['zoom'],11.5,.75,14,.95,17,1.2];
  map.addLayer({id:'vehicles-dir',type:'symbol',source:'vehicles',minzoom:11.5,layout:{
    'icon-image':['concat','dir-',['get','mode']],'icon-rotate':['get','bearing'],'icon-rotation-alignment':'map',
    'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-size':vehScale}});
  map.addLayer({id:'vehicles',type:'symbol',source:'vehicles',minzoom:11.5,layout:{
    'icon-image':['concat','vb|',['get','mode'],'|',['get','line'],'|',['case',['==',['get','est'],true],'0','1']],
    'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-rotation-alignment':'viewport','icon-size':vehScale,
    'symbol-sort-key':['case',['==',['get','est'],true],1,0]}});

  // Trykk nær en holdeplass – eller på navnet – åpner avgangstavlen. Fingre bommer,
  // så vi leter i en firkant rundt trykket og velger nærmeste holdeplass.
  map.on('click',e=>{
    if(router.cur.name==='results'||router.cur.name==='trip')return;
    const {x,y}=e.point;
    const card=map.queryRenderedFeatures([x,y],{layers:['stop-cards']})[0];
    if(card){buzz(6);
      // Traff du én bestemt avgang i kortet, vis den turen; ellers holdeplassen.
      const spec=cardSpecs.get(card.properties.card),pt=map.project(card.geometry.coordinates);
      const rel=x-(pt.x-(spec?.w||0)/2),hit=spec?.hits?.find(h=>rel>=h.x0&&rel<=h.x1&&h.sj);
      if(hit)router.go('journey',{sj:hit.sj,stop:card.properties.id,...(hit.at?{at:hit.at}:{})});
      else router.go('stop',{id:card.properties.id,snap:'peek'});
      return;}
    const hits=map.queryRenderedFeatures([[x-18,y-18],[x+18,y+18]],{layers:['stops','stop-icons','stops-label-major','stops-label']});
    const best=hits.map(f=>{const pt=map.project(f.geometry.coordinates);return{f,d:Math.hypot(pt.x-x,pt.y-y)-(f.layer.id==='stops'||f.layer.id==='stop-icons'?0:4)};})
      .sort((a,b)=>a.d-b.d)[0];
    // Nær en holdeplass vinner den, selv om et kjøretøy står oppå (vanlig ved travle stopp).
    const veh=map.queryRenderedFeatures([[x-4,y-4],[x+4,y+4]],{layers:['vehicles','vehicles-dir']})[0];
    if(best&&(best.d<=12||!veh)){buzz(6);router.go('stop',{id:best.f.properties.id,snap:'peek'});return;}
    if(veh)vehClick({features:[veh]});
    else if(fc$.target?.key?.startsWith('veh:'))fcClose();
  });
  const vehClick=e=>{const p=e.features[0]?.properties||{};buzz(6);
    if(p.sj)router.go('journey',{sj:p.sj});else showVehicleCard(p);}; // med kjent tur: vis hele ruten

  map.on('click','route-stop-minor',e=>{const p=e.features[0]?.properties;if(!p)return;
    new maplibregl.Popup({offset:8,closeButton:false}).setLngLat(e.lngLat)
      .setHTML(stopPopup(p)).addTo(map);});
  map.on('click','route-stop',e=>{const p=e.features[0]?.properties;if(!p)return;
    new maplibregl.Popup({offset:10,closeButton:false}).setLngLat(e.lngLat)
      .setHTML(stopPopup(p)).addTo(map);});
  ['stops','stop-icons','stops-label','stops-label-major','stop-cards','vehicles','vehicles-dir','route-stop'].forEach(l=>{
    map.on('mouseenter',l,()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave',l,()=>map.getCanvas().style.cursor='');});

  map.addLayer({id:'stop-cards',type:'symbol',source:'stops',minzoom:CARD_ZOOM,filter:['all',['has','card'],['!=',['get','id'],'']],layout:{
    'icon-image':['get','card'],'icon-anchor':'bottom','icon-offset':[0,-14],'icon-padding':4,'symbol-sort-key':['get','rank'],
    'icon-allow-overlap':false},paint:{'icon-opacity':['interpolate',['linear'],['zoom'],CARD_ZOOM,0,CARD_ZOOM+.12,1]}});
  map.moveLayer('stop-sel'); // valgt holdeplass øverst, også over kjøretøy
  setBasemap(settings.basemap);paintTheme();renderStopsLayer();renderAcc();map.setPadding(mapPadding());
  // Kildehenvisningen starter sammenslått som en ⓘ-knapp.
  $('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  $('.maplibregl-ctrl-attrib')?.removeAttribute('open');
  if(router.cur.name==='results'||router.cur.name==='trip')drawRoute(state.trips[state.tripIdx]);
});
map.on('error',e=>{const msg=e?.error?.message||'';
  if(/Failed to fetch|NetworkError/i.test(msg))setNetworkState(false,tr('Kartet laster ikke'));else console.warn('Kart:',msg);});
// Holdeplass på valgt rute eller tur: navn, hva slags stopp og klokkeslett.
const stopPopup=p=>`<b>${esc(p.name)}</b><br><span style="color:var(--ink-3)">${esc(tr(p.kind))}${p.time?' · '+tr('kl. {t}',{t:fmtT(p.time)}):''}</span>`;

// Følg-modus og kompass
function setFollow(on){state.follow=on;$('#locateBtn').setAttribute('aria-pressed',String(on));}
map.on('dragstart',()=>{if(state.follow)setFollow(false);if(live.followVeh){live.followVeh=false;updateLiveBox();}});
map.on('rotate',()=>{const b=map.getBearing();$('#compassBtn').hidden=Math.abs(b)<1;
  $('#compassIcon').style.transform=`rotate(${-b}deg)`;});
$('#compassBtn').onclick=()=>{buzz(6);map.easeTo({bearing:0,duration:reduceMotion.matches?0:400});};
$('#locateBtn').onclick=()=>{buzz(8);startCompass();
  if(!state.pos){requestGeoOnce();toast(tr('Henter posisjonen din…'));return;}
  setFollow(true);
  map.easeTo({center:[state.pos[1],state.pos[0]],zoom:Math.max(map.getZoom(),16),duration:reduceMotion.matches?0:700});};

// Hold inne (eller høyreklikk) for å velge et punkt som start eller mål.
let pressTimer=null,pressAt=null;
map.on('touchstart',e=>{if(e.points.length!==1)return;pressAt=e.point;
  clearTimeout(pressTimer);pressTimer=setTimeout(()=>{buzz(14);showPick(e.lngLat);},520);});
map.on('touchmove',e=>{if(pressAt&&(Math.abs(e.point.x-pressAt.x)>8||Math.abs(e.point.y-pressAt.y)>8))clearTimeout(pressTimer);});
['touchend','touchcancel','movestart'].forEach(ev=>map.on(ev,()=>clearTimeout(pressTimer)));
map.on('contextmenu',e=>showPick(e.lngLat));
let pickPopup=null;
function showPick(ll){
  pickPopup?.remove();
  const el=document.createElement('div');el.className='pick';
  el.innerHTML=`<b>${tr('Bruk dette punktet')}</b><div class="row"><button type="button" data-pick="from">${tr('Fra her')}</button><button type="button" class="to" data-pick="to">${tr('Til her')}</button></div>`;
  pickPopup=new maplibregl.Popup({offset:12,closeButton:false,maxWidth:'260px'}).setLngLat(ll).setDOMContent(el).addTo(map);
  el.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{
    buzz(8);pickPopup.remove();
    const place={name:tr('Punkt på kartet'),lat:ll.lat,lon:ll.lng,pin:true};
    if(b.dataset.pick==='from')state.fromSel=place;else state.dest=place;
    if(state.dest&&(state.fromSel||state.pos))startTripSearch();
    else router.go('search',{focus:b.dataset.pick==='from'?'to':'from'});
  });
}

// Posisjonsmarkør, start/mål og byttenumre er DOM-markører; alt annet er kartlag.
// MapLibre kaller alle markører «Map marker» når de legges på kartet: gi dem et navn som sier hva de er.
function nameMarker(m,label){
  const el=m.getElement();if(el.tagName!=='BUTTON')el.setAttribute('role','img');
  el.setAttribute('aria-label',label);return m;
}
const meEl=document.createElement('div');meEl.className='me';
meEl.innerHTML='<div class="halo"></div><div class="cone"></div><div class="core"></div>';
const meMarker=new maplibregl.Marker({element:meEl,rotationAlignment:'map'});
let pinMarkers=[];
function clearPins(){pinMarkers.forEach(m=>m.remove());pinMarkers=[];}
function addPin(lat,lon,html,label){
  const el=document.createElement('div');el.innerHTML=html;const node=el.firstElementChild;
  const m=nameMarker(new maplibregl.Marker({element:node}).setLngLat([lon,lat]).addTo(map),label);pinMarkers.push(m);return m;
}
function renderAcc(){
  if(!state.pos||!state.acc){setData('acc',EMPTY);return;}
  const [lat,lon]=state.pos,r=state.acc,pts=[];
  for(let i=0;i<=48;i++){const a=i/48*2*Math.PI;
    pts.push([lon+r*Math.cos(a)/(111320*Math.cos(lat*Math.PI/180)),lat+r*Math.sin(a)/110540]);}
  setData('acc',fc([{type:'Feature',geometry:{type:'Polygon',coordinates:[pts]},properties:{}}]));
}
/* ---------- Holdeplassikoner ----------
   Avrundet kvadrat i transportmiddelets farge med hvitt piktogram, tegnet i
   24-enhets rutenett (samme som appens ikoner). Favoritter får en gul stjerne. */
const STOP_ICON_ZOOM=14;
function stopIcon(mode,fav){
  const S=64,g=imageCtx(S,S);
  g.shadowColor='rgba(0,0,0,.28)';g.shadowBlur=5;g.shadowOffsetY=1.5;
  g.beginPath();g.roundRect(8,6,48,48,13);g.fillStyle='#fff';g.fill();g.shadowColor='transparent';
  g.beginPath();g.roundRect(11,9,42,42,10.5);g.fillStyle=modeOf(mode).c;g.fill();
  // piktogram i 24-rutenett, sentrert i den fargede flaten
  g.save();g.translate(14,12);g.scale(1.5,1.5);g.fillStyle='#fff';g.strokeStyle='#fff';g.lineCap='round';g.lineJoin='round';
  const C=modeOf(mode).c,rr=(x,y,w,h,r,fill)=>{g.beginPath();g.roundRect(x,y,w,h,r);g.fillStyle=fill;g.fill();};
  const dot=(x,y,r,fill)=>{g.beginPath();g.arc(x,y,r,0,Math.PI*2);g.fillStyle=fill;g.fill();};
  if(mode==='bus'){rr(4.5,3.5,15,15,3,'#fff');rr(6.5,5.5,11,5.2,1.2,C);dot(7.8,14.6,1.1,C);dot(16.2,14.6,1.1,C);rr(6,18,3.2,2.6,1,'#fff');rr(14.8,18,3.2,2.6,1,'#fff');}
  else if(mode==='tram'){g.lineWidth=1.6;g.beginPath();g.moveTo(8.5,2.8);g.lineTo(15.5,2.8);g.moveTo(12,2.8);g.lineTo(12,5.5);g.stroke();
    rr(5.5,5.5,13,13,3.2,'#fff');rr(7.5,7.5,9,4.6,1.2,C);dot(9.2,15.2,1.1,C);dot(14.8,15.2,1.1,C);
    g.lineWidth=1.6;g.beginPath();g.moveTo(8,18.5);g.lineTo(6.5,21);g.moveTo(16,18.5);g.lineTo(17.5,21);g.stroke();}
  else if(mode==='metro'){g.beginPath();g.arc(12,12,9,0,Math.PI*2);g.fillStyle='#fff';g.fill();
    g.fillStyle=C;g.font='900 13px "Schibsted Grotesk", system-ui, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('T',12,12.8);}
  else if(mode==='rail'){rr(5.5,3,13,15,4,'#fff');rr(7.5,5.2,9,4.4,1.2,C);dot(9,14,1.1,C);dot(15,14,1.1,C);
    g.lineWidth=1.6;g.beginPath();g.moveTo(8.5,18);g.lineTo(6,21.5);g.moveTo(15.5,18);g.lineTo(18,21.5);g.moveTo(7.2,20.2);g.lineTo(16.8,20.2);g.stroke();}
  else{g.beginPath();g.moveTo(3.5,14);g.lineTo(20.5,14);g.lineTo(17.5,19);g.lineTo(6.5,19);g.closePath();g.fill();
    rr(8,8.5,8,5,1.2,'#fff');rr(11,5,2,4,.6,'#fff');g.lineWidth=1.4;g.beginPath();g.moveTo(4,21.5);g.quadraticCurveTo(6,20.3,8,21.5);g.quadraticCurveTo(10,22.7,12,21.5);g.quadraticCurveTo(14,20.3,16,21.5);g.quadraticCurveTo(18,22.7,20,21.5);g.stroke();}
  g.restore();
  if(fav){ // gul stjerne i hjørnet
    g.save();g.translate(52,10);g.beginPath();for(let i=0;i<10;i++){const r=i%2?4.2:9.5,a=-Math.PI/2+i*Math.PI/5;g.lineTo(Math.cos(a)*r,Math.sin(a)*r);}g.closePath();
    g.fillStyle='#FFC800';g.fill();g.lineWidth=2;g.strokeStyle='#14191C';g.stroke();g.restore();
  }
  return g.getImageData(0,0,S,S);
}

/* ---------- Avgangskort på kartet ----------
   Fra gatenivå får hver holdeplass et lite kort med navn og de tre neste
   avgangene. Avgangene for hele utsnittet hentes i én forespørsel. Kortene
   tegnes som bilder i et symbollag, så kartet selv rydder bort kort som ville
   overlappet (stasjoner og favoritter først). Nøkkelen inneholder innholdet,
   så et kort tegnes på nytt bare når minuttene endrer seg. */
const CARD_ZOOM=15.3;
const cardSpecs=new Map();
// Kort lages bare for holdeplasser i utsnittet (med litt margin for små flytt). Kartet ville ellers
// bedt om bilder for alle holdeplasser i flisene rundt, og tegnet dem på nytt hvert minutt.
function cardBounds(){
  if(!mapLoaded||map.getZoom()<CARD_ZOOM)return null;
  const b=map.getBounds(),dx=(b.getEast()-b.getWest())*.15,dy=(b.getNorth()-b.getSouth())*.15;
  return{w:b.getWest()-dx,e:b.getEast()+dx,s:b.getSouth()-dy,n:b.getNorth()+dy};
}
function cardKey(s,vb){
  if(!vb||s.lon<vb.w||s.lon>vb.e||s.lat<vb.s||s.lat>vb.n)return null;
  const entry=state.deps.get(s.id);if(!entry)return null;
  const items=upcoming(s.id).slice(0,3).map(r=>{const m=minUntil(r.exp);return{pub:r.pub,mode:r.mode,t:m<=0?tr('nå'):m<60?String(m):fmtT(r.exp),rt:r.rt,now:m<=0,sj:r.sj,at:r.aimed};});
  if(!items.length)return null; // uten avganger: bare prikk og navn
  const theme=isSat()?'sat':resolveTheme();
  const key=`sc|${theme}|${I18N.lang}|${s.id}|${items.map(i=>i.pub+':'+i.t+(i.rt?'*':'')).join(',')}`;
  if(!cardSpecs.has(key))cardSpecs.set(key,{id:s.id,name:s.name,items,theme});
  return key;
}
function cardImage(spec){
  const dark=spec.theme==='dark',X=2,font=(w,px)=>`${w} ${px*X}px "Schibsted Grotesk", system-ui, sans-serif`;
  const col=dark?{bg:'#171C20',line:'rgba(255,255,255,.10)',name:'#9AA2A7',text:'#EEECE6',sub:'#9AA2A7'}:
    {bg:'#FFFFFF',line:'rgba(20,25,28,.10)',name:'#5B6468',text:'#14191C',sub:'#5B6468'};
  const m=measureCtx();
  const PAD=8*X,GAP=8*X,BH=18*X,M=6*X,TIP=6*X;
  // mål opp innholdet
  m.font=font(700,11);let name=spec.name;const maxName=170*X;
  while(m.measureText(name).width>maxName&&name.length>3)name=name.slice(0,-2);
  if(name!==spec.name)name=name.trimEnd()+'…';
  const nameW=m.measureText(name).width;
  const chips=spec.items.map(i=>{m.font=font(800,11.5);const bw=Math.max(24*X,m.measureText(i.pub).width+10*X);
    m.font=font(750,12.5);let tw=m.measureText(i.t).width+(i.now?10*X:0)+(i.rt?9*X:0);
    const unit=!i.now&&/^\d+$/.test(i.t);let uw=0;if(unit){m.font=font(600,9.5);uw=m.measureText('min').width+2*X;}
    return{...i,bw,tw,uw,unit,w:bw+5*X+tw+uw};});
  const chipsW=chips.length?chips.reduce((a,c)=>a+c.w,0)+GAP*(chips.length-1):(m.font=font(500,11),m.measureText(tr('Ingen avganger')).width);
  const W=Math.ceil(Math.max(nameW,chipsW)+PAD*2),H=PAD+13*X+5*X+BH+PAD;
  const g=imageCtx(W+M*2,H+TIP+M*2),cv=g.canvas;
  // Kort med pil ned mot holdeplassen. Skyggen er to tynne lag under kortet i stedet for uskarphet
  // (shadowBlur), som er det dyreste et lerret tegner – og kortene tegnes på nytt hvert minutt.
  const shape=(dy,grow)=>{g.beginPath();g.roundRect(M-grow,M+dy-grow,W+grow*2,H+grow*2,10*X+grow);
    g.moveTo(M+W/2-TIP-grow,M+dy+H+grow);g.lineTo(M+W/2,M+dy+H+TIP+grow*1.4);g.lineTo(M+W/2+TIP+grow,M+dy+H+grow);g.closePath();};
  g.fillStyle='rgba(0,0,0,.06)';shape(1.5*X,1.5*X);g.fill();
  g.fillStyle='rgba(0,0,0,.09)';shape(1*X,.5*X);g.fill();
  shape(0,0);g.fillStyle=col.bg;g.fill();g.lineWidth=1*X;g.strokeStyle=col.line;g.stroke();
  g.textBaseline='middle';
  g.font=font(700,11);g.fillStyle=col.name;g.fillText(name,M+PAD,M+PAD+6.5*X);
  let x=M+PAD;const cy=M+PAD+13*X+5*X+BH/2;
  if(!chips.length){g.font=font(500,11);g.fillStyle=col.sub;g.fillText(tr('Ingen avganger'),x,cy);}
  spec.w=cv.width/X;spec.hits=[]; // for trykk: hvor hver avgang ligger i bildet (CSS-px fra venstre kant)
  chips.forEach(c=>{const x0=x;
    g.beginPath();g.roundRect(x,cy-BH/2,c.bw,BH,5*X);g.fillStyle=modeOf(c.mode).c;g.fill();
    g.font=font(800,11.5);g.fillStyle=modeOf(c.mode).o;g.textAlign='center';g.fillText(c.pub,x+c.bw/2,cy+.5*X);g.textAlign='left';
    x+=c.bw+5*X;
    // Sanntid: grønn prikk foran tiden, som i resten av appen.
    if(c.rt){g.beginPath();g.arc(x+3*X,cy,3*X,0,Math.PI*2);g.fillStyle=dark?'#4FC48C':'#1C7F52';g.fill();x+=9*X;}
    const tw=c.tw-(c.rt?9*X:0);
    if(c.now){g.beginPath();g.roundRect(x,cy-8*X,tw,16*X,4*X);g.fillStyle='#FFC800';g.fill();
      g.font=font(800,11);g.fillStyle='#14191C';g.fillText(c.t,x+5*X,cy+.5*X);}
    else{g.font=font(750,12.5);g.fillStyle=col.text;g.fillText(c.t,x,cy+.5*X);
      if(c.unit){g.font=font(600,9.5);g.fillStyle=col.sub;g.fillText('min',x+tw+2*X,cy+1.5*X);}}
    x+=tw+c.uw+GAP;
    spec.hits.push({x0:(x0-GAP/2)/X,x1:(x-GAP/2)/X,sj:c.sj,stop:spec.id,at:c.at});
  });
  return g.getImageData(0,0,cv.width,cv.height);
}
map.on('styleimagemissing',e=>{
  if(!e.id.startsWith('sc|')||map.hasImage(e.id))return;
  const spec=cardSpecs.get(e.id);
  // Et kort som nettopp er ryddet bort kan etterspørres ett bilde til: gi et tomt bilde i stedet for en advarsel.
  if(spec)map.addImage(e.id,cardImage(spec),{pixelRatio:2});else{map.addImage(e.id,{width:1,height:1,data:new Uint8Array(4)});cardSpecs.set(e.id,null);}
});
// Fjern kortbilder som ikke lenger er i bruk, så minnet ikke vokser.
function pruneCards(used){
  for(const k of cardSpecs.keys())if(!used.has(k)){cardSpecs.delete(k);if(mapLoaded&&map.hasImage(k))map.removeImage(k);}
}
let cardMode=false;
map.on('zoom',()=>{const on=map.getZoom()>=CARD_ZOOM;if(on!==cardMode){cardMode=on;renderStopsLayer();}});
let viewDepsBusy=false,viewDepsAt=0;
async function loadViewDeps(force=false){
  if(!mapLoaded||mapCovered()||map.getZoom()<CARD_ZOOM-0.5||!['home','stop'].includes(router.cur.name))return;
  if(viewDepsBusy||(!force&&Date.now()-viewDepsAt<25000))return;
  viewDepsBusy=true;viewDepsAt=Date.now();
  try{
    const b=map.getBounds();
    const d=await gql(`{stopPlacesByBbox(minimumLatitude:${b.getSouth()},minimumLongitude:${b.getWest()},maximumLatitude:${b.getNorth()},maximumLongitude:${b.getEast()}){
      id name latitude longitude transportMode estimatedCalls(numberOfDepartures:5,timeRange:5400){realtime aimedDepartureTime expectedDepartureTime forBoarding
      destinationDisplay{frontText} quay{publicCode} serviceJourney{id journeyPattern{line{publicCode transportMode}}}}}}`);
    const now=Date.now();
    (d.stopPlacesByBbox||[]).forEach(sp=>{
      if(!state.viewStops.has(sp.id)&&Number.isFinite(sp.latitude))
        state.viewStops.set(sp.id,{id:sp.id,name:sp.name,lat:sp.latitude,lon:sp.longitude,modes:sp.transportMode||[]});
      const old=state.deps.get(sp.id);
      // Ikke overskriv en fyldigere tavle som nettopp er hentet for holdeplassen.
      if(!old||now-old.t>20000||(old.rows||[]).length<=5)state.deps.set(sp.id,{rows:parseCalls(sp.estimatedCalls),t:now});
    });
    renderStopsLayer();
  }catch(e){report('loadViewDeps',e);}finally{viewDepsBusy=false;}
}

// Rangering for navn på kartet: favoritter, så tog, T-bane, trikk/båt, så buss.
function stopProps(s,vb){
  const fav=favs.some(f=>f.id===s.id),m=s.modes||[];
  const rank=fav?0:m.includes('rail')?1:m.includes('metro')?2:(m.includes('tram')||m.includes('water'))?3:4;
  const icon=m.includes('rail')?'rail':m.includes('metro')?'metro':m.includes('tram')?'tram':m.includes('water')?'water':'bus';
  const p={id:s.id,name:s.name,fav,rank,major:rank<4,icon,color:modeOf(icon).c};
  const card=cardKey(s,vb);if(card)p.card=card;
  return p;
}
function renderStopsLayer(){
  const all=new Map();
  for(const s of state.viewStops.values())all.set(s.id,s);
  for(const s of [...state.nearby,...favs])all.set(s.id,{...s,modes:s.modes||all.get(s.id)?.modes}); // behold transportmiddel fra utsnittet
  const show=!['results','trip','journey'].includes(router.cur.name),vb=cardBounds();
  const feats=show?[...all.values()].map(s=>({type:'Feature',geometry:{type:'Point',coordinates:[+s.lon,+s.lat]},properties:stopProps(s,vb)})):[];
  setData('stops',fc(feats));
  pruneCards(new Set(feats.map(f=>f.properties.card).filter(Boolean)));
}

/* ---------- Kartpolstring: kartet regner med arket ---------- */
function mapPadding(){
  if(wide.matches)return{top:24,bottom:24,left:440,right:24};
  return{top:(router.cur.name==='home'?70:20)+safeTop(),bottom:Math.min(sheetUI.visible,innerHeight*.62)+16,left:24,right:24};
}
const safeTop=()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat'))||0;
