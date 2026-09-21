import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {assert,delay,here,bridgeURL,cdpURL,json,until,connectTest} from './test-support.mjs';

let t=await connectTest();
const root=t.cap.test_root;
const report={mode:'isolated Electron process restart',checks:[]};
try {
  const completed=await t.invoke('rename_bakery',{name:'Restart verified'});
  await t.invoke('force_save');
  const before=await t.cdp.evaluate('Game.cookieClicks');
  const oldUI=await t.invoke('get_ui_state');const ref=oldUI.result.elements.find(x=>x.id==='bigCookie').ref;
  await t.cdp.evaluate('Game.bakeryNamePrompt();true');const oldPrompt=(await t.invoke('get_ui_state')).result.prompt.token;
  await t.invoke('prompt_cancel');await t.cdp.evaluate('CookieBridge.pausar();true');
  const lost=await t.invoke('enqueue_game_action',{type:'click_cookie',wait_for_result:false});
  const dispatched=await t.cdp.evaluate(`(async()=>{const c=await cookieBridgeConnection.connect();const r=await fetch('http://127.0.0.1:'+c.port+'/action/next',{headers:{Authorization:'Bearer '+c.token}});return r.json();})()`);assert.equal(dispatched._bridge.id,lost.id); // Simulated lost delivery; no gameplay execution.
  const pending=await t.invoke('enqueue_game_action',{type:'click_cookie',wait_for_result:false});
  await t.cdp.evaluate('setTimeout(()=>Steam.quit(),50)');await t.close();t=null;
  await until(async()=>{try{await json(bridgeURL+'/capabilities');return false;}catch{return true;}});
  const runtime=path.join(root,'runtime');const executable=path.join(runtime,'Cookie Clicker.exe');
  const stdout=fs.openSync(path.join(root,'restart-stdout.log'),'a');const stderr=fs.openSync(path.join(root,'restart-stderr.log'),'a');
  const child=spawn(executable,[`--remote-debugging-port=${new URL(cdpURL).port}`,'--remote-debugging-address=127.0.0.1','--disable-gpu','--disable-background-timer-throttling'],{
    cwd:runtime,env:{...process.env,COOKIE_BRIDGE_TEST_MODE:'1',COOKIE_BRIDGE_TEST_ROOT:root,COOKIE_BRIDGE_PORT:new URL(bridgeURL).port},windowsHide:true,detached:true,stdio:['ignore',stdout,stderr]
  });child.unref();fs.closeSync(stdout);fs.closeSync(stderr);
  await until(()=>json(bridgeURL+'/capabilities'));t=await connectTest();
  await until(()=>t.cdp.evaluate('!!Game.ready && !!window.CookieBridge && Game.bakeryName==="Restart verified"'));
  const restored=await t.invoke('get_action_result',{id:completed.id});assert.equal(restored.status,'succeeded');report.checks.push('completed receipt survives process restart');
  const uncertain=await t.invoke('get_action_result',{id:lost.id},true);assert.equal(uncertain.status,'indeterminate');report.checks.push('dispatched work becomes indeterminate and is not replayed');
  const final=await t.invoke('get_action_result',{id:pending.id,wait_ms:15000});assert.equal(final.status,'succeeded');
  assert.equal(await t.cdp.evaluate('Game.cookieClicks'),before+1);await delay(1000);assert.equal(await t.cdp.evaluate('Game.cookieClicks'),before+1);report.checks.push('queued work resumes once, with one real click');
  const stale=await t.invoke('ui_click',{target:ref},true);assert.equal(stale.error.code,'stale_target');report.checks.push('old element reference is rejected after restart');
  await t.cdp.evaluate('Game.bakeryNamePrompt();true');
  const stalePrompt=await t.invoke('prompt_respond',{expected_prompt:oldPrompt,option:0},true);assert.equal(stalePrompt.error.code,'stale_prompt');await t.invoke('prompt_cancel');report.checks.push('old prompt token is rejected after restart');
  report.status='passed';
} catch(err) {report.status='failed';report.error=err.stack;process.exitCode=1;}
finally {if(t)await t.close();fs.writeFileSync(path.join(here,'output','integration','restart-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
