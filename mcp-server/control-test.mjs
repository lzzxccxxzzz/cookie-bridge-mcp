import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import schema from '../mod_api/control-schema.js';
import queueModule from '../mod_api/control-queue.js';
const {createQueue} = queueModule;

test('validation rejects ambiguous, unknown and destructive inputs', () => {
  for (const input of [{type:'missing'},{type:'click_cookie',count:NaN},{type:'click_cookie',count:1.2},{type:'ascend'},{type:'hard_reset',confirm:false},{type:'buy_building',name:'Farm',quantity:1,quantidade:1},{type:'garden_soil',soil_id:-1}]) assert.throws(()=>schema.validate(input));
  assert.deepEqual(schema.validate({type:'buy_building',name:'Farm',quantidade:2}),{type:'buy_building',name:'Farm',quantity:2});
  assert.throws(()=>schema.validate({type:'buy_upgrade'}));
});
test('FIFO dispatch and receipt replay never duplicate the purchase', () => {
  const q=createQueue();const a=q.enqueue({type:'buy_building',name:'Farm'});const b=q.enqueue({type:'click_cookie'});
  assert.equal(q.next()._bridge.id,a.id);assert.equal(q.get(a.id).status,'dispatched');
  const receipt={id:a.id,type:'buy_building',status:'succeeded',finished_at:9,result:{units:1}};
  q.acknowledge([receipt]);q.acknowledge([{...receipt,result:{units:100}}]);
  assert.equal(q.get(a.id).result.units,1);assert.equal(q.next()._bridge.id,b.id);assert.equal(q.next(),null);
});
test('expiry is visible even without a connected renderer; cancellation excludes dispatched',()=>{
  let clock=1;const q=createQueue({now:()=>clock});const a=q.enqueue({type:'click_cookie'},{ttl_ms:10});
  clock=20;assert.equal(q.get(a.id).status,'expired');assert.equal(q.next(),null);
  const b=q.enqueue({type:'click_cookie'});q.next();const c=q.enqueue({type:'click_cookie'});
  assert.deepEqual(q.clear().cancelled,[c.id]);assert.equal(q.get(b.id).status,'dispatched');
});
test('lost receipt becomes indeterminate, and a late receipt resolves it',()=>{
  let clock=1;const q=createQueue({now:()=>clock,dispatchTimeoutMs:10});const a=q.enqueue({type:'click_cookie'});q.next();clock=20;
  assert.equal(q.get(a.id).status,'indeterminate');assert.equal(q.next(),null);
  q.acknowledge([{id:a.id,type:'click_cookie',status:'succeeded'}]);assert.equal(q.get(a.id).status,'succeeded');
});
test('receipt batches are atomic and require an actually dispatched action',()=>{
  const q=createQueue();const a=q.enqueue({type:'click_cookie'});const b=q.enqueue({type:'force_save'});q.next();
  assert.throws(()=>q.acknowledge([{...a,status:'succeeded'},{...b,status:'succeeded'}]));assert.equal(q.get(a.id).status,'dispatched');
  assert.throws(()=>q.acknowledge([{...a,type:'force_save',status:'succeeded'}]));
});
test('journal restores accepted work and completed results without replaying dispatched work',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cookie-bridge-queue-'));const file=path.join(dir,'actions.json');
  try {
    const a=createQueue({storagePath:file});const completed=a.enqueue({type:'click_cookie'});a.next();a.acknowledge([{...completed,status:'succeeded',result:{clicks_registered:1}}]);
    const uncertain=a.enqueue({type:'buy_building',name:'Farm'});a.next();const queued=a.enqueue({type:'force_save'});
    const b=createQueue({storagePath:file});assert.equal(b.get(completed.id).result.clicks_registered,1);assert.equal(b.get(uncertain.id).status,'indeterminate');assert.equal(b.next()._bridge.id,queued.id);assert.equal(b.next(),null);
    b.acknowledge([{...uncertain,status:'succeeded'}]);assert.equal(b.get(uncertain.id).status,'succeeded');
  } finally {fs.rmSync(file,{force:true});fs.rmdirSync(dir);}
});
test('an invalid journal fails closed instead of losing action identities',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cookie-bridge-corrupt-'));const file=path.join(dir,'actions.json');
  try {fs.writeFileSync(file,'broken');assert.throws(()=>createQueue({storagePath:file}));assert.equal(fs.readFileSync(file,'utf8'),'broken');}
  finally {fs.rmSync(file);fs.rmdirSync(dir);}
});
test('backpressure and bounded history preserve pending action IDs',()=>{
  const q=createQueue({maxPending:2,maxHistory:2});const a=q.enqueue({type:'click_cookie'});q.enqueue({type:'click_cookie'});assert.throws(()=>q.enqueue({type:'click_cookie'}));
  q.next();q.acknowledge([{...a,status:'succeeded'}]);q.clear();
  for(let i=0;i<10;i++){const r=q.enqueue({type:'force_save'});q.next();q.acknowledge([{...r,status:'succeeded'}]);}
  assert.equal(q.history(100).length,2);
});
test('save payloads are redacted from the queue view',()=>{
  const q=createQueue();q.enqueue({type:'import_save',save:'secret-save',confirm:true});q.enqueue({type:'gift_redeem',code:'private-gift'});
  assert.ok(!JSON.stringify(q.view()).includes('secret-save'));assert.ok(!JSON.stringify(q.view()).includes('private-gift'));
});

test('MCP rejects version mismatches, propagates stale-state errors and never re-enqueues pending work',async()=>{
  const {createServer: httpServer}=await import('node:http');
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
  const {InMemoryTransport}=await import('@modelcontextprotocol/sdk/inMemory.js');
  let mode='server-mismatch', enqueues=0;
  const http=httpServer((req,res)=>{
    res.setHeader('content-type','application/json');
    let body;
    if(req.url==='/capabilities') body={api_version:mode==='server-mismatch'?'old':schema.version,renderer_version:mode==='renderer-mismatch'?'old':schema.version};
    else if(req.url==='/action/enqueue') {enqueues++;res.statusCode=503;body={error:'Game state is stale; no action was queued.'};}
    else if(req.url==='/action/result/existing') body={id:'existing',type:'click_cookie',status:mode==='uncertain'?'indeterminate':'dispatched'};
    else {res.statusCode=404;body={error:'not found'};}
    req.resume();res.end(JSON.stringify(body));
  });
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  const oldURL=process.env.COOKIE_BRIDGE_URL;
  process.env.COOKIE_BRIDGE_URL='http://127.0.0.1:'+http.address().port;
  let client,server;
  try {
    const {createServer}=await import('./server.mjs');server=createServer();
    client=new Client({name:'offline-protocol-test',version:schema.version});
    const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([client.connect(a),server.connect(b)]);
    for(const mismatch of ['server-mismatch','renderer-mismatch']) {
      mode=mismatch;const r=await client.callTool({name:'click_cookie',arguments:{}});assert.equal(r.isError,true);assert.equal(enqueues,0);
    }
    mode='stale';const stale=await client.callTool({name:'click_cookie',arguments:{}});assert.equal(stale.isError,true);assert.match(stale.content[0].text,/stale/);assert.equal(enqueues,1);
    const pending=await client.callTool({name:'get_action_result',arguments:{id:'existing'}});assert.equal(JSON.parse(pending.content[0].text).pending,true);assert.equal(enqueues,1);
    mode='uncertain';const uncertain=await client.callTool({name:'get_action_result',arguments:{id:'existing'}});assert.equal(uncertain.isError,true);assert.equal(JSON.parse(uncertain.content[0].text).status,'indeterminate');assert.equal(enqueues,1);
  } finally {
    if(client)await client.close();if(server)await server.close();
    if(oldURL===undefined)delete process.env.COOKIE_BRIDGE_URL;else process.env.COOKIE_BRIDGE_URL=oldURL;
    await new Promise(resolve=>http.close(resolve));
  }
});
