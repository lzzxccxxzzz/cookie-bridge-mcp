import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {authHeaders,localBridgeURL} from './bridge-auth.mjs';

export { assert, delay };
export const here = path.dirname(fileURLToPath(import.meta.url));
export const bridgeURL = process.env.COOKIE_BRIDGE_URL || 'http://127.0.0.1:8001';
export const cdpURL = process.env.CHROMIUM_DEBUG_URL || 'http://127.0.0.1:9223';
export async function json(url, options) {
  const headers=new URL(url).origin===localBridgeURL(bridgeURL)?authHeaders(options?.headers):options?.headers;
  const r = await fetch(url, {...options, headers, redirect:'error', signal: AbortSignal.timeout(15000)});
  const body = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(body)}`);
  return body;
}
export async function until(fn, timeout = 20000) {
  const start = Date.now(); let last;
  do { try { const value = await fn(); if (value) return value; } catch (e) { last = e; } await delay(150); } while (Date.now() - start < timeout);
  throw new Error('Condition timed out' + (last ? ': ' + last.message : ''));
}
export class CDP {
  constructor(socket) { this.socket = socket; this.pending = new Map(); this.sequence = 0; this.exceptions = []; }
  static async connect() {
    const target = await until(async () => (await json(cdpURL + '/json/list')).find(t => t.type === 'page' && /\/src\/index\.html/.test(t.url)));
    const c = new CDP(new WebSocket(target.webSocketDebuggerUrl)); c.target = target;
    await new Promise((resolve, reject) => { c.socket.addEventListener('open', resolve, {once: true}); c.socket.addEventListener('error', reject, {once: true}); });
    c.socket.addEventListener('message', e => {
      const m = JSON.parse(String(e.data));
      if (m.method === 'Runtime.exceptionThrown') c.exceptions.push(m.params.exceptionDetails);
      const p = c.pending.get(m.id); if (!p) return;
      clearTimeout(p.timer); c.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    });
    c.socket.addEventListener('close', () => { for (const p of c.pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP connection closed')); } c.pending.clear(); });
    await c.command('Runtime.enable'); return c;
  }
  command(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {this.pending.delete(id); reject(new Error('CDP timeout: ' + method));}, 30000);
      this.pending.set(id, {resolve, reject, timer}); this.socket.send(JSON.stringify({id, method, params}));
    });
  }
  async evaluate(expression) {
    const r = await this.command('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  }
  close() { this.socket.close(); }
}
export async function connectTest() {
  if(!process.env.COOKIE_BRIDGE_TOKEN_FILE && !process.env.COOKIE_BRIDGE_TOKEN)process.env.COOKIE_BRIDGE_TOKEN_FILE=path.join(here,'output','integration','bridge-data','access-token');
  const cap = await json(bridgeURL + '/capabilities');
  assert.equal(cap.test_mode, true, 'Live regression is allowed only in isolated test mode');
  const cdp = await CDP.connect();
  assert.ok(decodeURIComponent(cdp.target.url).replaceAll('\\', '/').toLowerCase().includes(cap.test_root.replaceAll('\\', '/').toLowerCase()), 'CDP must point at the isolated copy');
  const client = new Client({name: 'cookie-bridge-integration', version: cap.api_version});
  const transport = new StdioClientTransport({command: process.execPath, args: [path.join(here, 'server.mjs')], env: {...process.env, COOKIE_BRIDGE_URL: bridgeURL, COOKIE_BRIDGE_RESULT_TIMEOUT_MS: '15000'}});
  await client.connect(transport);
  const invoke = async (name, args = {}, allowError = false) => {
    const raw = await client.callTool({name, arguments: args}, undefined, {timeout: 90000});
    if (raw.content?.some(c => c.type === 'image')) return raw;
    const text = raw.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    let value; try { value = JSON.parse(text); } catch { value = {error: text}; }
    if (raw.isError && !allowError) throw new Error(`${name}: ${JSON.stringify(value)}`);
    if (value.id && ['queued', 'dispatched'].includes(value.status) && args.wait_for_result !== false && name !== 'get_action_result') {
      value = await invoke('get_action_result', {id: value.id, wait_ms: 60000}, allowError);
    }
    return value;
  };
  return {cap, cdp, client, invoke, close: async () => {await client.close(); cdp.close();}};
}
// A CLI diagnostic confined to the isolated test renderer. Not an MCP tool.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t = await connectTest();
  try { console.log(JSON.stringify(await t.cdp.evaluate(process.argv[2] || '({ready:Game.ready,version:Game.version,bridge:!!window.CookieBridge})'), null, 2)); }
  finally { await t.close(); }
}
