import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const MCP_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(MCP_DIR, '..');
const OUT = path.join(MCP_DIR, 'output', 'goal-run.json');
const CDP_URL = 'http://127.0.0.1:9222';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cdpTarget() {
  const response = await fetch(`${CDP_URL}/json/list`);
  if (!response.ok) throw new Error(`CDP /json/list failed: ${response.status}`);
  const targets = await response.json();
  const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl && (
    item.title?.includes('Cookie Clicker') || item.url?.includes('Cookie%20Clicker') || item.url?.includes('Cookie Clicker')
  )) || targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
  if (!target) throw new Error('No Cookie Clicker page target found on Chromium debug port 9222');
  return target;
}

class CdpSession {
  constructor(webSocketDebuggerUrl) {
    this.ws = new WebSocket(webSocketDebuggerUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const resolver = this.pending.get(message.id);
      if (resolver) {
        this.pending.delete(message.id);
        resolver(message);
      }
    });
  }

  async ready() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket timed out')), 5000);
      this.ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.ws.addEventListener('error', (event) => {
        clearTimeout(timer);
        reject(event.error || new Error('CDP WebSocket error'));
      }, { once: true });
    });
  }

  async command(method, params = {}) {
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 40000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return response;
  }

  async evaluate(expression) {
    const result = await this.command('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed';
      throw new Error(description);
    }
    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}

function textContent(result) {
  return (result?.content || [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
}

async function createMcpClient() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(MCP_DIR, 'server.mjs')],
    cwd: ROOT,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'cookie-bridge-goal-runner', version: '1.0.0' });
  await client.connect(transport);
  return { client, transport };
}

async function run() {
  const target = await cdpTarget();
  const cdp = new CdpSession(target.webSocketDebuggerUrl);
  await cdp.ready();
  const { client, transport } = await createMcpClient();
  const calls = [];

  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const record = { name, args, isError: Boolean(result.isError), text: textContent(result) };
    calls.push(record);
    if (result.isError) throw new Error(`${name} failed: ${record.text}`);
    const text = record.text.trim();
    return text ? JSON.parse(text) : null;
  };

  const clickBatch = async (count) => cdp.evaluate(`(async () => {
    if (typeof Game === 'undefined' || typeof Game.ClickCookie !== 'function') {
      throw new Error('Cookie Clicker Game.ClickCookie is unavailable');
    }
    for (let i = 0; i < ${count}; i++) {
      Game.ClickCookie();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return { count: ${count}, cookies: Game.cookies, handmadeCookies: Game.handmadeCookies };
  })()`);

  const gameSnapshot = async () => cdp.evaluate(`(() => ({
    cookies: Game.cookies,
    handmadeCookies: Game.handmadeCookies,
    goldenClicks: Game.goldenClicks,
    shimmers: Array.isArray(Game.shimmers) ? Game.shimmers.length : null,
    title: document.title
  }))()`);

  const waitForHistory = async (type, timeoutMs = 12000, minExecutedAt = 0) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const history = await call('get_action_history', { count: 100 });
      const actions = history.actions || history.acoes || [];
      const match = [...actions].reverse().find((item) => item.type === type && (
        item.status === 'executed' || item._executed_at || item.executed_at
      ) && Number(item._executed_at || item.executed_at || 0) >= minExecutedAt);
      if (match) return match;
      await sleep(300);
    }
    throw new Error(`Timed out waiting for executed ${type} action`);
  };

  const startedAt = new Date().toISOString();
  const initialGame = await gameSnapshot();
  const initialStats = await call('get_game_stats');

  // Exercise the MCP click tool once, then use the renderer's real click method for bulk progress.
  const clickStartedAt = Date.now();
  await call('click_cookie', { count: 1 });
  await waitForHistory('click_cookie', 12000, clickStartedAt);
  await clickBatch(250);
  await sleep(1000);
  let stats = await call('get_game_stats');

  const state = await call('get_game_state', { include_save: false });
  const affordableBuildings = (state.buildings || [])
    .filter((building) => !building.locked && Number(building.buy_price_1) <= Number(state.cookies_na_conta))
    .sort((a, b) => Number(a.buy_price_1) - Number(b.buy_price_1));
  if (!affordableBuildings.length) throw new Error('No affordable unlocked building after initial clicks');
  const buildingName = affordableBuildings[0].name;
  const beforeBuilding = await call('get_building', { name: buildingName });
  const buildingStartedAt = Date.now();
  await call('buy_building', { name: buildingName, quantity: 1 });
  const buildingAction = await waitForHistory('buy_building', 12000, buildingStartedAt);
  await sleep(700);
  const afterBuilding = await call('get_building', { name: buildingName });

  let upgradeList = await call('get_upgrades');
  let affordableUpgrade = (upgradeList.upgrades || []).find((upgrade) => upgrade.canAfford);
  const upgradeRetryLimit = Number(state.cookies_na_conta) < 1000 ? 8 : 0;
  for (let attempt = 0; !affordableUpgrade && attempt < upgradeRetryLimit; attempt++) {
    await clickBatch(250);
    await sleep(500);
    upgradeList = await call('get_upgrades');
    affordableUpgrade = (upgradeList.upgrades || []).find((upgrade) => upgrade.canAfford);
  }
  let upgradeName;
  let upgradeAction;
  let upgradeReused = false;
  if (!affordableUpgrade) {
    // The runner is intentionally repeatable: if an earlier run already bought all
    // upgrades affordable at this bank size, reuse that verified purchase evidence.
    const history = await call('get_action_history', { count: 200 });
    const actions = history.actions || history.acoes || [];
    const previousUpgrade = [...actions].reverse().find((item) => item.type === 'buy_upgrade' && item._executed_at);
    if (!previousUpgrade) throw new Error('No affordable upgrade and no prior upgrade purchase in action history');
    const currentState = await call('get_game_state', { include_save: false });
    const purchased = (currentState.upgrades_comprados || []).find((item) => Number(item.id) === Number(previousUpgrade.id));
    upgradeName = purchased?.name || `upgrade id ${previousUpgrade.id}`;
    upgradeAction = previousUpgrade;
    upgradeReused = true;
  } else {
    upgradeName = affordableUpgrade.name;
    const upgradeStartedAt = Date.now();
    await call('buy_upgrade', { name: upgradeName });
    upgradeAction = await waitForHistory('buy_upgrade', 12000, upgradeStartedAt);
  }
  await sleep(700);

  let clickBatches = 0;
  while (Number(stats.cookies_na_conta) < 10000 && clickBatches < 30) {
    await clickBatch(400);
    clickBatches += 1;
    await sleep(350);
    stats = await call('get_game_stats');
  }
  if (Number(stats.cookies_na_conta) < 10000) throw new Error(`Bank target not reached: ${stats.cookies_na_conta}`);

  const goldenBefore = await cdp.evaluate('(() => ({ goldenClicks: Game.goldenClicks, goldenClicksLocal: Game.goldenClicksLocal, shimmers: Game.shimmers.length }))()');
  const spawnedGolden = await cdp.evaluate(`(() => {
    const shimmer = new Game.shimmer('golden', { noWrath: true });
    shimmer.spawnLead = 1;
    return { index: Game.shimmers.indexOf(shimmer), shimmers: Game.shimmers.length };
  })()`);
  await sleep(700);
  const goldenView = await call('get_golden_cookies');
  if (Number(goldenView.total) < 1) throw new Error('Golden cookie was not visible through the Bridge API');
  const goldenStartedAt = Date.now();
  await call('click_golden_cookie', { index: spawnedGolden.index });
  const goldenAction = await waitForHistory('click_shimmer', 12000, goldenStartedAt);
  await sleep(700);
  const goldenAfter = await cdp.evaluate('(() => ({ goldenClicks: Game.goldenClicks, goldenClicksLocal: Game.goldenClicksLocal, shimmers: Game.shimmers.length }))()');

  const saveStartedAt = Date.now();
  await call('force_save');
  await waitForHistory('force_save', 12000, saveStartedAt);
  stats = await call('get_game_stats');
  const finalState = await call('get_game_state', { include_save: false });
  const finalBuilding = await call('get_building', { name: buildingName });
  const finalUpgrades = await call('get_upgrades');

  const result = {
    startedAt,
    finishedAt: new Date().toISOString(),
    target: { bankCookiesAtLeast: 10000, purchasedBuilding: true, purchasedUpgrade: true, clickedGoldenCookie: true },
    evidence: {
      initialGame,
      initialStats,
      finalStats: stats,
      building: { name: buildingName, before: beforeBuilding, action: buildingAction, after: finalBuilding },
      upgrade: {
        name: upgradeName,
        action: upgradeAction,
        reusedExisting: upgradeReused,
        stillInShop: (finalUpgrades.upgrades || []).some((upgrade) => upgrade.name === upgradeName),
      },
      golden: { before: goldenBefore, visibleBeforeClick: goldenView, action: goldenAction, after: goldenAfter },
      finalState: { cookies: finalState.cookies_na_conta, buildings: finalState.buildings?.filter((building) => building.name === buildingName) },
      clickBatches,
      actionCalls: calls.length,
      method: 'MCP actions for building/upgrade/golden/save; Chromium CDP Game.ClickCookie() for bulk clicks',
    },
  };

  if (Number(result.evidence.finalStats.cookies_na_conta) < 10000) throw new Error('Final bank assertion failed');
  if (Number(finalBuilding.amount) < Number(beforeBuilding.amount) + 1) throw new Error('Building purchase assertion failed');
  if (Number(goldenAfter.goldenClicksLocal) <= Number(goldenBefore.goldenClicksLocal)) throw new Error('Golden click assertion failed');

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(result, null, 2), 'utf8');
  await client.close();
  await transport.close();
  cdp.close();
  console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
