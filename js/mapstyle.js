'use strict';
/* =====================================================================
   REIS kartstil – vektorkart (OpenMapTiles-skjema via OpenFreeMap)
   tegnet i appens egen palett. Bevisst rolig: ingen POI-ikoner, dempede
   veier og bare de stedsnavnene som hjelper deg å orientere deg.
   Kollektivlinjer og holdeplasser legges oppå av appen selv.
   ===================================================================== */
(function(){
const PALETTE={
  light:{
    bg:'#EFEDE7',wood:'#E3E7DA',park:'#DCE4D1',water:'#C3D6DE',waterline:'#AFC7D1',
    building:'#E4E0D8',buildingLine:'#D8D3C9',roadCase:'#DDD7CB',road:'#FFFFFF',
    motorway:'#FBF4E4',motorwayCase:'#E3D6BA',rail:'#BDB7AB',path:'#D2CBBE',
    label:'#6A7276',halo:'rgba(244,242,237,0.92)',place:'#2D3438',waterLabel:'#5F8492'
  },
  dark:{
    bg:'#15191C',wood:'#171E1A',park:'#18211C',water:'#0E1D25',waterline:'#163240',
    building:'#1D2327',buildingLine:'#242B30',roadCase:'#15191C',road:'#272E34',
    motorway:'#323A40',motorwayCase:'#15191C',rail:'#363E44',path:'#283036',
    label:'#8D969B',halo:'rgba(21,25,28,0.92)',place:'#D3D7D9',waterLabel:'#5B7D8A'
  }
};
const FONT=['Noto Sans Regular'],FONT_B=['Noto Sans Bold'];
const z=(...stops)=>['interpolate',['exponential',1.5],['zoom'],...stops];
const cls=(...c)=>['match',['get','class'],c,true,false];
const notTunnel=['!=',['get','brunnel'],'tunnel'];
// Bredde per veiklasse: zoom-interpolasjonen må ligge ytterst, klassevalget inni hvert stopp.
const byClass=(...stops)=>['interpolate',['exponential',1.5],['zoom'],...stops.flatMap(([zoom,major,mid,minor])=>
  [zoom,['match',['get','class'],['primary','trunk'],major,['secondary','tertiary'],mid,minor]])];
const NAME=['coalesce',['get','name:nor'],['get','name:no'],['get','name']];

// Hvert lag oppgir hvilke palettnøkler det bruker, så tema kan byttes uten å laste stilen på nytt.
const LAYERS=[
  {id:'bg',type:'background',pal:{'background-color':'bg'}},
  {id:'wood',type:'fill','source-layer':'landcover',filter:cls('wood','grass','forest'),pal:{'fill-color':'wood'}},
  {id:'park',type:'fill','source-layer':'park',pal:{'fill-color':'park'}},
  {id:'water',type:'fill','source-layer':'water',pal:{'fill-color':'water'}},
  {id:'waterway',type:'line','source-layer':'waterway',minzoom:11,pal:{'line-color':'waterline'},
    paint:{'line-width':z(11,.5,16,2.5)}},
  {id:'building',type:'fill','source-layer':'building',minzoom:14,pal:{'fill-color':'building','fill-outline-color':'buildingLine'},
    paint:{'fill-opacity':z(14,0,15,1)}},
  {id:'path',type:'line','source-layer':'transportation',minzoom:15,filter:['all',cls('path','track'),notTunnel],
    pal:{'line-color':'path'},paint:{'line-width':z(15,.6,18,1.6),'line-dasharray':[2,1.5]}},
  {id:'road-case',type:'line','source-layer':'transportation',minzoom:13,
    filter:['all',cls('primary','secondary','tertiary','minor','service','trunk'),notTunnel],
    layout:{'line-cap':'round','line-join':'round'},pal:{'line-color':'roadCase'},
    paint:{'line-width':byClass([13,4,3,1.5],[18,26,22,14])}},
  {id:'road',type:'line','source-layer':'transportation',minzoom:10,
    filter:['all',cls('primary','secondary','tertiary','minor','service','trunk'),notTunnel],
    layout:{'line-cap':'round','line-join':'round'},pal:{'line-color':'road'},
    paint:{'line-width':byClass([10,.8,.4,.1],[13,2.5,1.8,.6],[18,22,18,11])}},
  {id:'motorway-case',type:'line','source-layer':'transportation',minzoom:8,filter:['all',cls('motorway'),notTunnel],
    layout:{'line-cap':'round','line-join':'round'},pal:{'line-color':'motorwayCase'},paint:{'line-width':z(8,1.5,13,4,18,28)}},
  {id:'motorway',type:'line','source-layer':'transportation',minzoom:8,filter:['all',cls('motorway'),notTunnel],
    layout:{'line-cap':'round','line-join':'round'},pal:{'line-color':'motorway'},paint:{'line-width':z(8,.8,13,2.6,18,24)}},
  {id:'rail',type:'line','source-layer':'transportation',minzoom:10,filter:['all',cls('rail','transit'),notTunnel],
    pal:{'line-color':'rail'},paint:{'line-width':z(10,.6,16,2),'line-dasharray':[3,2]}},
  {id:'road-label',type:'symbol','source-layer':'transportation_name',minzoom:15,
    filter:cls('primary','secondary','tertiary','minor','trunk'),
    layout:{'symbol-placement':'line','text-field':NAME,'text-font':FONT,'text-size':z(15,10.5,18,13),'text-max-angle':30},
    pal:{'text-color':'label','text-halo-color':'halo'},paint:{'text-halo-width':1.4}},
  {id:'water-label',type:'symbol','source-layer':'water_name',minzoom:11,
    layout:{'text-field':NAME,'text-font':['Noto Sans Italic'],'text-size':12,'text-letter-spacing':.04},
    pal:{'text-color':'waterLabel','text-halo-color':'halo'},paint:{'text-halo-width':1.2}},
  {id:'place-minor',type:'symbol','source-layer':'place',minzoom:12,filter:cls('suburb','quarter','neighbourhood','village','hamlet'),
    layout:{'text-field':NAME,'text-font':FONT,'text-size':z(12,11,16,13.5),'text-max-width':8},
    pal:{'text-color':'label','text-halo-color':'halo'},paint:{'text-halo-width':1.4}},
  {id:'place-major',type:'symbol','source-layer':'place',maxzoom:14,filter:cls('city','town'),
    layout:{'text-field':NAME,'text-font':FONT_B,'text-size':z(6,11,12,17),'text-letter-spacing':.02},
    pal:{'text-color':'place','text-halo-color':'halo'},paint:{'text-halo-width':1.6}}
];

function build(theme){
  const p=PALETTE[theme]||PALETTE.light;
  return{
    version:8,
    glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources:{
      sat:{type:'raster',tileSize:256,maxzoom:19,
        tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution:'Satellitt © <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics'},
      omt:{type:'vector',url:'https://tiles.openfreemap.org/planet',
      attribution:'<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}},
    layers:[LAYERS[0],{id:'sat',type:'raster',source:'sat',layout:{visibility:'none'},paint:{'raster-fade-duration':150}},...LAYERS.slice(1)].map(l=>{
      const {pal,...spec}=l;
      const out={...spec,paint:{...(spec.paint||{})}};
      if(spec.type!=='background'&&!spec.source)out.source='omt';
      for(const [prop,key] of Object.entries(pal||{}))out.paint[prop]=p[key];
      return out;
    })
  };
}
// Satellitt er en hybrid: flybildet under, bare navn oppå (hvit tekst med mørk kant).
const SAT_TEXT={text:'#FFFFFF',halo:'rgba(0,0,0,0.78)'};
function applyTheme(map,theme,sat=false){
  const p=PALETTE[theme]||PALETTE.light;
  if(map.getLayer('sat'))map.setLayoutProperty('sat','visibility',sat?'visible':'none');
  for(const l of LAYERS){
    if(!map.getLayer(l.id))continue;
    const isText=l.type==='symbol';
    if(l.type!=='background')map.setLayoutProperty(l.id,'visibility',sat&&!isText?'none':'visible');
    for(const [prop,key] of Object.entries(l.pal||{})){
      let v=p[key];
      if(sat&&isText)v=prop==='text-halo-color'?SAT_TEXT.halo:SAT_TEXT.text;
      map.setPaintProperty(l.id,prop,v);
    }
  }
}
window.ReisMapStyle={build,applyTheme,palette:t=>PALETTE[t]||PALETTE.light};
})();
