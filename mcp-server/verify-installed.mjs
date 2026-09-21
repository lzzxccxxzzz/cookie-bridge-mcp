// Read-only verification of the installed (non-test) bridge. No CDP or actions.
import fs from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import schema from '../mod_api/control-schema.js';
import {assert,here,json,until} from './test-support.mjs';
import {authHeaders} from './bridge-auth.mjs';

const url=process.env.COOKIE_BRIDGE_URL || 'http://127.0.0.1:8000';
await until(async()=>{const c=await json(url+'/capabilities',{headers:authHeaders()});return c.renderer_version===schema.version && c.state_age_ms<3000;},30000);
const client=new Client({name:'cookie-bridge-installed-check',version:schema.version});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(here,'server.mjs')],env:{...process.env,COOKIE_BRIDGE_URL:url}});
try {
  await client.connect(transport);
  async function read(name,args={}) {
    const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));
    return JSON.parse(result.content.find(c=>c.type==='text').text);
  }
  const cap=await read('get_capabilities');assert.equal(cap.test_mode,false);assert.equal(cap.api_version,schema.version);assert.equal(cap.renderer_version,schema.version);
  const state=await read('get_game_state');assert.equal(state.control.live.ready,true);assert.ok(state.state_age_ms<5000);assert.ok(!state.save_string);
  const buildings=await read('get_game_catalog',{kind:'buildings'});assert.equal(buildings.total,20);
  const stats=await read('get_game_stats');assert.ok(Number.isFinite(stats.cookies_na_conta));
  for(const language of ['','/pt']) {const response=await fetch(url+'/docs'+language,{headers:authHeaders()});assert.equal(response.status,200);assert.ok((await response.text()).includes('v'+schema.version));}
  const report={status:'passed',time:new Date().toISOString(),game_version:state.control.game_version,bridge_version:cap.api_version,renderer_version:cap.renderer_version,tools:(await client.listTools()).tools.length,buildings:buildings.total,read_only:true,gameplay_actions:0,test_mode:cap.test_mode};
  await fs.mkdir(path.join(here,'output'),{recursive:true});await fs.writeFile(path.join(here,'output','installed-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await client.close();}
