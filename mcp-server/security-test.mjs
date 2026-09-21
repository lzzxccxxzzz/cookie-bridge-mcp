import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import security from '../mod_api/control-security.js';
import schema from '../mod_api/control-schema.js';
import {localBridgeURL,accessToken} from './bridge-auth.mjs';

const token = 'a'.repeat(64), origin = 'http://127.0.0.1:8001';
const make = options => security.createSecurity({port:8001,clientToken:token,...options});
const request = (url='/state', method='GET', headers={}) => ({url,method,headers:{host:'127.0.0.1:8001',...headers}});
const response = () => ({headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},writeHead(s){this.status=s;},end(){}});
const bearer = t => ({authorization:'Bearer '+t});
const json = {'content-type':'application/json'};
function denied(fn,status){assert.throws(fn,e=>e.status===status);}
function temp(fn) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cookie-bridge-security-'));
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('token is random, persisted locally, and not regenerated on a normal restart',()=>temp(dir=>{
  const a=security.loadToken(dir), b=security.loadToken(dir);
  assert.match(a,/^[0-9a-f]{64}$/);assert.equal(a,b);
  if(process.platform!=='win32')assert.equal(fs.statSync(path.join(dir,'access-token')).mode&0o777,0o600);
}));
test('malformed token and non-file token fail closed',()=>temp(dir=>{
  const file=path.join(dir,'access-token');fs.writeFileSync(file,'invalid');
  assert.throws(()=>security.loadToken(dir),/refusing to start/);
  fs.unlinkSync(file);fs.mkdirSync(file);assert.throws(()=>security.loadToken(dir),/regular file/);
}));
test('every data, asset, and action route requires authentication',()=>{
  const s=make();
  for(const [method,url] of [['GET','/'],['GET','/state'],['GET','/db/saves'],['GET','/action/next'],['GET','/img/icons.png'],['GET','/assets/chart.umd.js'],['POST','/action/enqueue'],['POST','/state'],['POST','/action/results'],['DELETE','/db/reset']])denied(()=>s.guard(request(url,method,json),response()),401);
  for(const p of ['/docs','/docs/pt','/charts','/saves'])assert.equal(s.guard(request(p),response()).loginPage,true);
});
test('security headers never include wildcard CORS or caching of private data',()=>{
  const res=response();make().guard(request('/state','GET',bearer(token)),res);
  assert.equal(res.headers['cache-control'],'no-store');assert.equal(res.headers['x-frame-options'],'DENY');
  assert.equal(res.headers['x-content-type-options'],'nosniff');assert.equal(res.headers['referrer-policy'],'no-referrer');
  assert.equal(res.headers['access-control-allow-origin'],undefined);
});
test('Host allowlist rejects DNS rebinding, alternate ports, and invalid request targets',()=>{
  const s=make();
  for(const host of ['evil.test:8001','127.0.0.1.evil.test:8001','localhost:8000','localhost','127.1:8001','[::1]:8001'])denied(()=>s.guard(request('/state','GET',{...bearer(token),host}),response()),403);
  assert.equal(s.guard(request('/state','GET',{...bearer(token),host:'localhost:8001'}),response()).role,'client');
  for(const p of ['http://evil.test/state','//evil.test/state'])denied(()=>s.guard(request(p,'GET',bearer(token)),response()),400);
});
test('foreign Origin and cross-site browser requests cannot use even a valid client token',()=>{
  const s=make();
  for(const o of ['https://evil.test','http://localhost:8001','null'])denied(()=>s.guard(request('/state','GET',{...bearer(token),origin:o}),response()),403);
  denied(()=>s.guard(request('/state','GET',{...bearer(token),'sec-fetch-site':'cross-site'}),response()),403);
  assert.equal(s.guard(request('/state','GET',{...bearer(token),origin}),response()).role,'client');
});
test('renderer has a separate ephemeral credential and cannot enqueue or administer the bridge',()=>{
  const a=make(),b=make();assert.notEqual(a.rendererToken,b.rendererToken);assert.notEqual(a.rendererToken,token);
  for(const [method,url] of [['POST','/state'],['GET','/action/next'],['POST','/action/results']]){
    denied(()=>a.guard(request(url,method,{...json,...bearer(token)}),response()),403);
    assert.equal(a.guard(request(url,method,{...json,...bearer(a.rendererToken),origin:'null'}),response()).role,'renderer');
  }
  for(const [method,url] of [['POST','/action/enqueue'],['DELETE','/db/reset'],['POST','/backup'],['GET','/db/saves']])denied(()=>a.guard(request(url,method,{...json,...bearer(a.rendererToken)}),response()),403);
  denied(()=>b.guard(request('/state','POST',{...json,...bearer(a.rendererToken)}),response()),401);
});
test('old Electron file fetch without Origin still requires the renderer credential',()=>{
  const s=make(),res=response();
  const h={...bearer(s.rendererToken),'sec-fetch-site':'cross-site'};
  assert.equal(s.guard(request('/action/next','GET',h),res).role,'renderer');
  denied(()=>s.guard(request('/action/next','GET',{'sec-fetch-site':'cross-site'}),response()),403);
});
test('preflight is narrow and does not authenticate the following request',()=>{
  const s=make(),res=response();
  const h={origin:'null','access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'};
  assert.equal(s.guard(request('/state','OPTIONS',h),res).handled,true);assert.equal(res.status,204);assert.equal(res.headers['access-control-allow-origin'],'null');
  denied(()=>s.guard(request('/state','POST',{...json,origin:'null'}),response()),403);
  for(const extra of [{origin:'https://evil.test'},{'access-control-request-headers':'x-secret'}])denied(()=>s.guard(request('/state','OPTIONS',{...h,...extra}),response()),403);
  denied(()=>s.guard(request('/state','OPTIONS',{...h,'access-control-request-method':'PUT'}),response()),405);
});
test('writes reject form and text bodies before any action can run',()=>{
  const s=make();
  for(const ct of ['', 'text/plain','application/x-www-form-urlencoded','multipart/form-data'])denied(()=>s.guard(request('/action/enqueue','POST',{...bearer(token),'content-type':ct}),response()),415);
  assert.equal(s.guard(request('/action/enqueue','POST',{...bearer(token),'content-type':'application/json; charset=utf-8'}),response()).role,'client');
});
test('dashboard login is same-origin, HttpOnly, bounded, expiring and revocable',()=>{
  let now=100;const s=make({now:()=>now}),res=response();
  denied(()=>s.guard(request('/auth/login','POST',json),response()),403);
  assert.equal(s.guard(request('/auth/login','POST',{...json,origin}),response()).login,true);
  denied(()=>s.login('wrong',res),401);s.login(token,res);
  const cookie=res.headers['set-cookie'];assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
  assert.ok(!cookie.includes(token));const h={cookie:cookie.split(';')[0]};
  assert.equal(s.guard(request('/state','GET',h),response()).role,'session');
  denied(()=>s.guard(request('/action/enqueue','POST',{...h,...json}),response()),403);
  assert.equal(s.guard(request('/action/enqueue','POST',{...h,...json,origin}),response()).role,'session');
  denied(()=>s.guard(request('/state','GET',{...h,...bearer('wrong')}),response()),401);
  s.logout(request('/auth/logout','POST',{...h,origin,...json}),response());
  denied(()=>s.guard(request('/state','GET',h),response()),401);
  s.login(token,res);const expired={cookie:res.headers['set-cookie'].split(';')[0]};now+=3600001;
  denied(()=>s.guard(request('/state','GET',expired),response()),401);
  now=100;s.login(token,res);const first={cookie:res.headers['set-cookie'].split(';')[0]};
  for(let i=0;i<16;i++)s.login(token,response());
  denied(()=>s.guard(request('/state','GET',first),response()),401);
});
test('asset allowlist rejects traversal, separators, encoded paths and non-media files',()=>temp(dir=>{
  fs.writeFileSync(path.join(dir,'icons.png'),'fixture');
  assert.equal(security.resolveAsset(dir,'icons.png'),fs.realpathSync(path.join(dir,'icons.png')));
  for(const name of ['../package.json','..\\package.json','..%2fpackage.json','a/../icons.png','C:\\secret.png','file:icons.png','icons.svg','..png','a..png','icons.png:stream'])denied(()=>security.resolveAsset(dir,name),400);
  denied(()=>security.resolveAsset(dir,'missing.png'),404);
  fs.mkdirSync(path.join(dir,'folder.png'));denied(()=>security.resolveAsset(dir,'folder.png'),403);
}));
test('canonical asset path must remain under its root even with a filesystem alias',()=>temp(dir=>{
  const root=path.join(dir,'assets');fs.mkdirSync(root);const outside=path.join(dir,'outside.png');fs.writeFileSync(outside,'fixture');
  // Mock only canonicalization: this exercises the post-realpath check on
  // Windows without requiring privilege to create a file symlink.
  const original=fs.realpathSync;
  fs.realpathSync=p=>p===path.join(root,'alias.png')?outside:original(p);
  try{denied(()=>security.resolveAsset(root,'alias.png'),403);}finally{fs.realpathSync=original;}
}));
test('IPC validates exact game URL, WebContents identity and modern main-frame identity',()=>{
  const file=path.resolve('fixture/src/index.html'),url=pathToFileURL(file).href;
  const mainFrame={url},contents={mainFrame};
  assert.equal(security.trustedSender({sender:contents,senderFrame:mainFrame},contents,file),true);
  assert.equal(security.trustedSender({sender:contents,senderFrame:{url}},contents,file),false);
  assert.equal(security.trustedSender({sender:{},senderFrame:mainFrame},contents,file),false);
  for(const u of ['https://evil.test/','file:///untrusted.html',url.replace('index.html','other.html')])assert.equal(security.trustedGameURL(u,file),false);
  assert.equal(security.trustedGameURL(url+'?bridgePort=8001',file),true);
});
test('legacy Electron IPC requires native main-frame routing and process IDs, plus committed URL',()=>{
  const file=path.resolve('fixture/src/index.html'),url=pathToFileURL(file).href;
  const frame={url,processId:3,frameId:4},contents={getURL:()=>url},e={sender:contents,processId:3,frameId:4};
  assert.equal(security.trustedSender(e,contents,file,frame),true);
  for(const bad of [{...e,frameId:5},{...e,processId:8},{sender:contents}])assert.equal(security.trustedSender(bad,contents,file,frame),false);
  assert.equal(security.trustedSender(e,contents,file,null),false);
  contents.getURL=()=> 'https://evil.test';assert.equal(security.trustedSender(e,contents,file,frame),false);
});
test('MCP cannot forward its credential to non-loopback URLs',()=>{
  for(const url of ['https://127.0.0.1:8000','http://evil.test:8000','http://user:pass@localhost:8000','http://localhost:8000/path','http://localhost:8000/?token=x','http://localhost:8000/#x'])assert.throws(()=>localBridgeURL(url));
  assert.equal(localBridgeURL('http://127.0.0.1:8000/'),'http://127.0.0.1:8000');
  const old=process.env.COOKIE_BRIDGE_TOKEN;
  try{process.env.COOKIE_BRIDGE_TOKEN='not-a-token';assert.throws(()=>accessToken(),/format/);}finally{if(old===undefined)delete process.env.COOKIE_BRIDGE_TOKEN;else process.env.COOKIE_BRIDGE_TOKEN=old;}
});
const source=fs.readFileSync(new URL('../start.js',import.meta.url),'utf8');
function dashboardContext(){
  const elements=new Map();
  const doc={getElementById:id=>{if(!elements.has(id))elements.set(id,{style:{},value:'10',options:[],textContent:'',innerHTML:''});return elements.get(id);},querySelectorAll:()=>[],addEventListener(){}};
  const c={document:doc,navigator:{userAgent:'unit-test'},localStorage:{getItem(){},setItem(){}},setInterval(){},setTimeout(){},fetch:()=>new Promise(()=>{}),console,esc:security.escapeHTML,location:{origin},window:null};
  c.window=c;return vm.createContext(c);
}
function runScripts(html,c){for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],c);}
export function renderedPages(){
  const c=vm.createContext({API_PORT:8001,CONTROL_SCHEMA:schema});
  const constants=source.slice(source.indexOf('const BUILDINGS ='),source.indexOf('function _res('));
  const templates=source.slice(source.indexOf('const _SAVES_HTML ='),source.indexOf('const _os '));
  const docs=source.slice(source.indexOf('const _PT_ROUTES ='),source.indexOf('const _server ='));
  vm.runInContext(constants+'\n'+templates+'\n'+docs,c);
  return {saves:vm.runInContext('_SAVES_HTML',c),charts:vm.runInContext('_CHARTS_HTML',c),docs:vm.runInContext("_buildDocs('en')",c),portuguese:vm.runInContext("_buildDocs('pt')",c)};
}
test('dashboard inline scripts parse and use only local JavaScript assets',()=>{
  for(const html of Object.values(renderedPages())){
    assert.ok(!/<script[^>]+src=["']https?:/i.test(html));
    for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
  }
});
test('stored save fields and attributes are escaped without changing the saved code',()=>{
  const c=dashboardContext();runScripts(renderedPages().saves,c);
  const attack='<b data-probe="x">&\'fixture</b>';
  const html=c.renderEntry({save:attack,run:attack,total_buildings:attack,upgrades_bought:attack,legacy_gain:attack,ts:new Date().toISOString()},0);
  assert.ok(!html.includes('<b data-probe'));assert.ok(html.includes(security.escapeHTML(attack)));assert.ok(!html.includes('title="'+attack));
});
test('minigame names, counts, prestige labels and option strings are escaped',()=>{
  const c=dashboardContext();runScripts(renderedPages().docs,c);const x='<b data-probe="x">fixture</b>';
  const htmls=[c.renderGrimoire({spells:[{name:x,cost:x,failChance:x}]}),c.renderPantheon({spirits:[{id:0,name:x,slot:-1}],slots:[0,-1,-1]}),c.renderGarden({width:1,height:1,grid:[[{seedName:x,growthPct:x}]]}),c.renderStock({goods:{a:{name:x,price:1,delta:0,portfolio:x,maxPortfolio:x}}}),c.renderLegado({ascensoes:x,upgrades:[{name:x,canAfford:true}]})];
  for(const html of htmls)assert.ok(!html.includes('<b data-probe'),html);
  assert.equal(c.fmt(x),'?');
});
test('vendored Chart.js matches the audited pinned npm package',()=>{
  const vendored=fs.readFileSync(new URL('../mod_api/vendor/chart.umd.js',import.meta.url),'utf8').replaceAll('\r\n','\n').trimEnd();
  const installed=fs.readFileSync(new URL('./node_modules/chart.js/dist/chart.umd.js',import.meta.url),'utf8').replaceAll('\r\n','\n').trimEnd();
  assert.equal(vendored,installed);assert.ok(vendored.includes('Chart.js v4.5.1'));
});
