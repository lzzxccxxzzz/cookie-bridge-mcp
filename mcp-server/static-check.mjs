// Offline contract/parse checks only. No bridge URL, CDP or game actions are used.
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import schema from '../mod_api/control-schema.js';
import { createServer } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const files = ['start.js', 'mod_api/main.js', 'mod_api/control-schema.js', 'mod_api/control-runtime.js', 'mod_api/control-queue.js', 'mcp-server/server.mjs', 'mcp-server/static-check.mjs', 'mcp-server/control-test.mjs', 'mcp-server/test-support.mjs', 'mcp-server/integration-test.mjs', 'mcp-server/restart-test.mjs', 'mcp-server/verify-installed.mjs', 'mcp-server/smoke-test.mjs', 'mcp-server/chromium-debug-test.mjs', 'mcp-server/goal-run.mjs'];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {encoding: 'utf8'});
  assert.equal(result.status, 0, file + ': ' + result.stderr);
}
const source = await readFile(path.join(root, 'mod_api/control-runtime.js'), 'utf8');
const handlers = new Set([...source.matchAll(/handlers\.([a-z0-9_]+)\s*=/g)].map(m => m[1]));
const actions = Object.keys(schema.actions);
assert.deepEqual([...handlers].sort(), actions.slice().sort(), 'Every schema action must have exactly one runtime handler');
const server = createServer();
const client = new Client({name: 'cookie-bridge-offline-schema-check', version: schema.version});
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = (await client.listTools()).tools;
  assert.equal(new Set(tools.map(t => t.name)).size, tools.length, 'MCP tool names must be unique');
  for (const action of actions) {
    const tool = tools.find(t => t.name === action);
    assert.ok(tool, 'Missing MCP action: ' + action);
    assert.equal(tool.inputSchema.type, 'object');
    for (const field of Object.keys(schema.actions[action].properties)) assert.ok(tool.inputSchema.properties[field], action + '.' + field);
  }
  const groups = {};
  for (const a of Object.values(schema.actions)) (groups[a.group] ??= []).push(a.name);
  console.log(JSON.stringify({status: 'ok', mode: 'offline schemas and syntax only', version: schema.version, parsed_files: files.length, action_count: actions.length, mcp_tool_count: tools.length, game_actions_executed: 0, groups}, null, 2));
} finally {
  await client.close();
  await server.close();
}
