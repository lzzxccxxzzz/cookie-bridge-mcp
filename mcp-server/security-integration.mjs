// Security regression against our isolated game only. Credentials never enter
// reports, URLs, game saves, screenshots, or command-line arguments.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import {connectTest,here,bridgeURL,assert,until} from './test-support.mjs';
import {authHeaders,accessToken} from './bridge-auth.mjs';
import schema from '../mod_api/control-schema.js';

const t=await connectTest(),base=new URL(bridgeURL);
const report={version:schema.version,game_version:t.cap.game_version,runtime:t.cap.runtime,mode:'isolated Electron HTTP security regression',started_at:new Date().toISOString(),checks:[]};
const json={'Content-Type':'application/json'};
const authenticated=()=>({...authHeaders(),...json});
function raw(url,method='GET',headers={},body){
  return new Promise((resolve,reject)=>{
    const r=http.request({hostname:base.hostname,port:base.port,path:url,method,headers},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
    });r.setTimeout(10000,()=>r.destroy(new Error('HTTP timeout')));r.on('error',reject);r.end(body);
  });
}
async function check(name,fn){
  try{await fn();report.checks.push({name,status:'passed'});console.log('PASSED '+name);}
  catch(e){report.checks.push({name,status:'failed',error:e.message});console.log('FAILED '+name+': '+e.message);}
}
async function status(url,expected,method='GET',headers={},body){
  const r=await raw(url,method,headers,body);assert.equal(r.status,expected,url+' status');
  assert.notEqual(r.headers['access-control-allow-origin'],'*');return r;
}
let cookie;
try{
  await until(async()=>{const r=await raw('/capabilities','GET',authenticated());return JSON.parse(r.body).renderer_version===schema.version;});
  await check('unauthenticated data and control endpoints are closed',async()=>{
    for(const p of ['/','/capabilities','/state','/control/state','/control/screenshot','/db/saves','/db/save/latest','/action/queue','/history/states','/action/next','/img/icons.png','/assets/chart.umd.js'])await status(p,401);
    for(const p of ['/action/enqueue','/state','/action/results','/backup','/db/save/now'])await status(p,401,'POST',json,'{}');
    for(const p of ['/db/reset','/action/queue'])await status(p,401,'DELETE',json);
  });
  await check('forged Host, Origin, Fetch-Metadata and file-origin client calls are blocked',async()=>{
    await status('/state',403,'GET',{...authenticated(),Host:'rebind.example:8001'});
    for(const Origin of ['https://attacker.invalid','http://localhost:'+base.port,'null'])await status('/state',403,'GET',{...authenticated(),Origin});
    await status('/state',403,'GET',{...authenticated(),'Sec-Fetch-Site':'cross-site'});
  });
  await check('invalid tokens and simple cross-site write body types are rejected',async()=>{
    await status('/state',401,'GET',{Authorization:'Bearer invalid'});
    await status('/action/enqueue',415,'POST',{'Content-Type':'text/plain',...authHeaders()},'{"type":"click_cookie"}');
    await status('/action/enqueue',400,'POST',authenticated(),'{malformed');
  });
  await check('renderer-only state, dispatch and receipt routes reject client credentials',async()=>{
    for(const [method,p] of [['POST','/state'],['GET','/action/next'],['POST','/action/results']])await status(p,403,method,authenticated(),method==='POST'?'{}':undefined);
  });
  await check('encoded traversal and Windows path variations cannot read app files',async()=>{
    for(const p of ['..%2f..%2fpackage.json','..%5c..%5cpackage.json','%2e%2e%2ficons.png','C%3a%5csecret.png','icons.png%3astream','icons.svg','icons.png%00'])await status('/img/'+p,400,'GET',authenticated());
    await status('/img/nonexistent-fixture.png',404,'GET',authenticated());
    const good=await status('/img/icons.png',200,'GET',authenticated());assert.equal(good.headers['content-type'],'image/png');
  });
  await check('preflight does not grant authentication and foreign origins get no CORS permission',async()=>{
    await status('/action/enqueue',403,'OPTIONS',{Origin:'https://attacker.invalid','Access-Control-Request-Method':'POST'});
    const r=await status('/state',204,'OPTIONS',{Origin:'null','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'});
    assert.equal(r.headers['access-control-allow-origin'],'null');await status('/state',403,'POST',{...json,Origin:'null'},'{}');
  });
  await check('dashboards show only a sign-in page without credentials',async()=>{
    for(const p of ['/docs','/docs/pt','/charts','/saves']){
      const r=await status(p,200);assert.ok(r.body.includes('id="login"'));assert.ok(!r.body.includes('save_string'));
      assert.equal(r.headers['x-frame-options'],'DENY');assert.match(r.headers['content-security-policy'],/frame-ancestors 'none'/);
    }
  });
  await check('login requires same Origin and an exact token; oversized bodies fail',async()=>{
    await status('/auth/login',403,'POST',json,'{}');
    await status('/auth/login',401,'POST',{...json,Origin:base.origin},'{"token":"invalid"}');
    await status('/auth/login',413,'POST',{...json,Origin:base.origin},JSON.stringify({token:'x'.repeat(1100)}));
    const r=await status('/auth/login',200,'POST',{...json,Origin:base.origin},JSON.stringify({token:accessToken()}));
    const setCookie=r.headers['set-cookie'][0];assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);cookie=setCookie.split(';')[0];
    assert.ok(!cookie.includes(accessToken()));
  });
  await check('session reads work; session mutations require exact Origin and JSON',async()=>{
    await status('/state',200,'GET',{Cookie:cookie});
    await status('/action/enqueue',403,'POST',{...json,Cookie:cookie},'{"type":"click_cookie"}');
    await status('/action/enqueue',403,'POST',{...json,Cookie:cookie,Origin:'https://attacker.invalid'},'{"type":"click_cookie"}');
    await status('/action/enqueue',400,'POST',{...json,Cookie:cookie,Origin:base.origin},'{"type":"hard_reset","confirm":false}');
    await status('/state',401,'GET',{Cookie:cookie,Authorization:'Bearer invalid'});
  });
  await check('authenticated dashboards compile, use local scripts, and expose no access token',async()=>{
    for(const p of ['/docs','/docs/pt','/charts','/saves']){
      const r=await status(p,200,'GET',{Cookie:cookie});assert.ok(!r.body.includes('id="login"'));assert.ok(!r.body.includes(accessToken()));
      assert.ok(!/<script[^>]+src=["']https?:/i.test(r.body));
      for(const m of r.body.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
    }
    const js=await status('/assets/chart.umd.js',200,'GET',{Cookie:cookie});assert.ok(js.body.includes('Chart.js v4.5.1'));
  });
  await check('save rendering preserves hostile text without creating markup in Chromium',async()=>{
    const html=(await raw('/saves','GET',authenticated())).body;
    const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
    const stop=script.indexOf('async function saveNow');
    const esc="var esc="+(await import('../mod_api/control-security.js')).default.escapeHTML.toString()+";";
    const x='<b data-cb-probe="x">&"fixture</b>';
    const expression='(()=>{'+esc+script.slice(0,stop)+';var x='+JSON.stringify(x)+';var template=document.createElement("template");template.innerHTML=renderEntry({save:x,run:x,total_buildings:x,upgrades_bought:x,legacy_gain:x},0);return {injected:!!template.content.querySelector("[data-cb-probe]"),code:template.content.querySelector("[data-code]").dataset.code,text:template.content.textContent};})()';
    const result=await t.cdp.evaluate(expression);assert.equal(result.injected,false);assert.equal(result.code,x);assert.ok(result.text.includes(x));
  });
  await check('renderer credential is IPC-only, and cannot enqueue commands or reset databases',async()=>{
    const result=await t.cdp.evaluate("(async()=>{var c=await cookieBridgeConnection.connect(),h={Authorization:'Bearer '+c.token,'Content-Type':'application/json'},base='http://127.0.0.1:'+c.port;var read=await fetch(base+'/capabilities',{headers:h});var enqueue=await fetch(base+'/action/enqueue',{method:'POST',headers:h,body:'{\"type\":\"click_cookie\"}'});var reset=await fetch(base+'/db/reset',{method:'DELETE',headers:h});return {read:read.status,enqueue:enqueue.status,reset:reset.status,node:typeof require,tokenInDOM:document.documentElement.outerHTML.includes(c.token),tokenInSave:Game.WriteSave(1).includes(c.token)};})()");
    assert.deepEqual(result,{read:200,enqueue:403,reset:403,node:'undefined',tokenInDOM:false,tokenInSave:false});
  });
  await check('browser session can be revoked without revoking the separate MCP token',async()=>{
    await status('/auth/logout',200,'POST',{...json,Cookie:cookie,Origin:base.origin},'{}');
    await status('/state',401,'GET',{Cookie:cookie});await status('/state',200,'GET',authenticated());
  });
  await check('protected bridge controls and external links are not MCP game targets',async()=>{
    const denied=await t.invoke('ui_click',{target:'cookiebridge-toggle'},true);assert.equal(denied.error.code,'protected_target');
    await t.cdp.evaluate("(()=>{var a=document.createElement('a');a.id='cb-security-external';a.href='https://example.invalid/';a.textContent='security fixture';a.style='position:fixed;top:0;left:0;z-index:999999';document.body.appendChild(a);return true;})()");
    try{
      for(const name of ['ui_click','ui_pointer']){const r=await t.invoke(name,{target:'cb-security-external',...(name==='ui_pointer'?{event:'click',x:0.5,y:0.5}:{})},true);assert.equal(r.error.code,'protected_target');}
    }finally{await t.cdp.evaluate("document.getElementById('cb-security-external').remove();true");}
  });
  await check('confirmed client action still completes once, with a native game delta',async()=>{
    const before=await t.cdp.evaluate('Game.cookieClicks');
    const r=await t.invoke('click_cookie',{count:1});assert.equal(r.status,'succeeded');
    assert.equal(await t.cdp.evaluate('Game.cookieClicks'),before+1);
  });
  report.status=report.checks.every(x=>x.status==='passed')?'passed':'failed';
}catch(e){report.status='failed';report.error=e.message;}
finally{
  report.finished_at=new Date().toISOString();
  await t.close();await fs.mkdir(path.join(here,'output','integration'),{recursive:true});
  // Only sanitized check names/status/errors are written, never raw HTTP replies.
  await fs.writeFile(path.join(here,'output','integration','security-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,passed:report.checks.filter(x=>x.status==='passed').length,total:report.checks.length,error:report.error}));
  if(report.status!=='passed')process.exitCode=1;
}
