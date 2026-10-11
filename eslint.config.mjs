// ESLint for REIS. Appen er vanlige nettleserskript uten byggesteg, og filene deler globalt
// navnerom (lastes i rekkefølgen i index.html). For at no-undef skal fange skrivefeil på tvers av
// filene, leses det hver fil deklarerer på toppnivå, og hver fil får de andre filenes navn som
// globale. Slik oppdages både ukjente navn og navn som ved en feil deklareres i to filer.
import js from '@eslint/js';
import globals from 'globals';
import * as espree from 'espree';
import {readFileSync} from 'node:fs';

const ORDER=['mapstyle','i18n','core','base','map','sheet','components','floatcard','pages','data','live','main'];
const APP=ORDER.map(f=>`js/${f}.js`);

function names(pattern,out,kind){
  if(!pattern)return;
  if(pattern.type==='Identifier')out[pattern.name]=kind;
  else if(pattern.type==='ObjectPattern')pattern.properties.forEach(p=>names(p.value||p.argument,out,kind));
  else if(pattern.type==='ArrayPattern')pattern.elements.forEach(e=>names(e,out,kind));
  else if(pattern.type==='AssignmentPattern')names(pattern.left,out,kind);
  else if(pattern.type==='RestElement')names(pattern.argument,out,kind);
}
function declared(file){
  const ast=espree.parse(readFileSync(file,'utf8'),{ecmaVersion:'latest',sourceType:'script'}),out={};
  for(const n of ast.body){
    if(n.type==='VariableDeclaration')n.declarations.forEach(d=>names(d.id,out,n.kind==='const'?'readonly':'writable'));
    else if((n.type==='FunctionDeclaration'||n.type==='ClassDeclaration')&&n.id)out[n.id.name]='readonly';
  }
  return out;
}
const decl=Object.fromEntries(APP.map(f=>[f,declared(f)]));
const fromOthers=f=>Object.assign({},...APP.filter(g=>g!==f).map(g=>decl[g]));

export default [
  {ignores:['node_modules/**','vendor/**']},
  js.configs.recommended,
  ...APP.map(f=>({
    files:[f],
    languageOptions:{ecmaVersion:'latest',sourceType:'script',
      globals:{...globals.browser,maplibregl:'readonly',ReisMapStyle:'readonly',module:'readonly',...fromOthers(f)}}
  })),
  {
    files:['js/**/*.js'],
    rules:{
      // Toppnivånavn brukes ofte fra andre filer, så bare lokale variabler sjekkes for bruk.
      'no-unused-vars':['error',{vars:'local',args:'none',caughtErrors:'none'}],
      'no-empty':['error',{allowEmptyCatch:false}],
      'no-constant-condition':['error',{checkLoops:false}]
    }
  },
  // Oversettelsesfunksjonene tr() og tn() er globale: et lokalt navn med samme navn ville skygget
  // for dem og gitt feil først når teksten skal vises.
  {files:['js/**/*.js'],ignores:['js/i18n.js'],rules:{'id-denylist':['error','tr','tn']}},
  {files:['sw.js'],languageOptions:{sourceType:'script',globals:globals.serviceworker}},
  {files:['tests/**/*.js','playwright.config.js'],languageOptions:{sourceType:'commonjs',globals:globals.node}},
  // Ende-til-ende-testene kjører kode i nettleseren (page.evaluate): appens navn og nettleserens er globale der.
  {files:['tests/e2e/**/*.js'],languageOptions:{globals:{...globals.browser,...Object.assign({},...APP.map(f=>decl[f])),axe:'readonly'}}},
  {files:['eslint.config.mjs'],languageOptions:{sourceType:'module',globals:globals.node}}
];
