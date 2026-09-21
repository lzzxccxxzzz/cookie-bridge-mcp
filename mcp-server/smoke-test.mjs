import {assert,connectTest} from './test-support.mjs';
const t=await connectTest();
try {
  const before=await t.cdp.evaluate('Game.cookieClicks');
  const r=await t.invoke('click_cookie',{count:1});
  assert.equal(r.status,'succeeded');
  assert.equal(r.result.clicks_registered,1);
  assert.equal(await t.cdp.evaluate('Game.cookieClicks'),before+1);
  const history=await t.invoke('get_action_result',{id:r.id});
  assert.equal(history.status,'succeeded');
  console.log(JSON.stringify({status:'passed',tool_count:(await t.client.listTools()).tools.length,receipt_id:r.id,click_delta:1}));
} finally {await t.close();}
