import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, "server.mjs");
const cdpBaseUrl = process.env.CHROMIUM_DEBUG_URL || "http://127.0.0.1:9222";

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}: ${text}`);
  return JSON.parse(text);
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = (event) => {
        cleanup();
        reject(new Error(`CDP WebSocket error: ${event.message || "unknown error"}`));
      };
      const cleanup = () => {
        this.socket.removeEventListener("open", onOpen);
        this.socket.removeEventListener("error", onError);
      };
      this.socket.addEventListener("open", onOpen);
      this.socket.addEventListener("error", onError);
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else waiter.resolve(message.result);
    });
  }

  command(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    return result.result?.value;
  }

  close() {
    this.socket.close();
  }
}

async function connectToCookieClicker() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`${cdpBaseUrl}/json/list`);
      const target = targets.find((item) => item.type === "page" && /Cookie Clicker/i.test(item.title || ""));
      if (target?.webSocketDebuggerUrl) {
        const connection = new CdpConnection(target.webSocketDebuggerUrl);
        await connection.connect();
        return { connection, target };
      }
    } catch {
      // The Electron renderer can take a moment to publish its page target.
    }
    await sleep(250);
  }
  throw new Error(`Cookie Clicker CDP target not found at ${cdpBaseUrl}/json/list`);
}

async function readGameObjects(connection) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const data = await connection.evaluate(`(() => {
      if (typeof Game === "undefined" || !Game.ready) return { ready: false };
      const buildings = Object.values(Game.Objects || {}).map((building) => ({
        name: building.name,
        amount: Number(building.amount || 0),
        locked: !!building.locked,
        buyPrice: Number(typeof building.getPrice === "function" ? building.getPrice() : building.price || 0),
      }));
      const upgrades = Object.values(Game.UpgradesById || {})
        .filter((upgrade) => upgrade && !upgrade.bought)
        .map((upgrade) => ({
          id: Number(upgrade.id),
          name: upgrade.name,
          price: Number(upgrade.basePrice || upgrade.price || 0),
        }))
        .filter((upgrade) => upgrade.name)
        .sort((a, b) => b.price - a.price);
      return {
        ready: true,
        version: Game.version,
        cookies: Number(Game.cookies || 0),
        handmadeCookies: Number(Game.handmadeCookies || 0),
        buildings,
        upgrades,
        shimmers: Array.isArray(Game.shimmers) ? Game.shimmers.length : 0,
      };
    })()`);
    if (data?.ready) return data;
    await sleep(250);
  }
  throw new Error("Cookie Clicker Game object did not become ready through CDP.");
}

function textOf(result) {
  const block = result?.content?.find((item) => item.type === "text");
  if (!block) return { raw: result };
  try {
    return JSON.parse(block.text);
  } catch {
    return { text: block.text };
  }
}

function summarize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return { array_length: value.length, first: value[0] };
  if (typeof value !== "object") return value;
  const keys = Object.keys(value);
  const summary = { keys };
  for (const key of ["status", "message", "error", "ok", "total", "tipo", "jogo_conectado", "total_cliques"]) {
    if (key in value) summary[key] = value[key];
  }
  if (Array.isArray(value.acoes)) summary.action_types = value.acoes.map((action) => action.type);
  if (Array.isArray(value.fila)) summary.queue_types = value.fila.map((action) => action.type);
  return summary;
}

const { connection, target } = await connectToCookieClicker();
let client;
const results = [];
try {
  const game = await readGameObjects(connection);
  const buildingWithStock = game.buildings.find((building) => building.amount > 0);
  const emptyBuilding = game.buildings.find((building) => building.amount === 0);
  const protectedBuilding = [...game.buildings].sort((a, b) => b.buyPrice - a.buyPrice)[0];
  const expensiveUpgrade = game.upgrades[0];

  const testObjects = [
    { tool: "get_bridge_status", arguments: {}, purpose: "health check" },
    { tool: "get_game_state", arguments: { include_save: false }, purpose: "live state without export save" },
    { tool: "get_game_stats", arguments: {}, purpose: "compact live stats" },
    { tool: "get_building", arguments: { name: buildingWithStock?.name || "Cursor" }, purpose: "building read from CDP" },
    { tool: "get_upgrades", arguments: {}, purpose: "upgrade list" },
    { tool: "get_golden_cookies", arguments: {}, purpose: "shimmer read" },
    { tool: "get_active_effects", arguments: {}, purpose: "buff read" },
    { tool: "get_action_queue", arguments: {}, purpose: "queue read" },
    { tool: "get_action_history", arguments: { count: 5 }, purpose: "executed action read" },
    { tool: "click_cookie", arguments: { count: 1 }, purpose: "one real click" },
    { tool: "buy_building", arguments: { name: protectedBuilding?.name || "You", quantity: 1 }, purpose: "protected/high-price purchase probe" },
    { tool: "sell_building", arguments: { name: emptyBuilding?.name || "You", quantity: 1 }, purpose: "empty-stock sale probe" },
    { tool: "buy_upgrade", arguments: { name: expensiveUpgrade?.name || "__missing_upgrade__" }, purpose: "highest-price upgrade probe" },
    { tool: "click_golden_cookie", arguments: { index: 0 }, purpose: "shimmer action probe" },
    { tool: "force_save", arguments: {}, purpose: "save action" },
    { tool: "enqueue_game_action", arguments: { type: "force_save", parameters: {} }, purpose: "validated advanced action" },
  ];

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { ...process.env, COOKIE_BRIDGE_URL: process.env.COOKIE_BRIDGE_URL || "http://127.0.0.1:8000" },
  });
  client = new Client({ name: "cookie-bridge-chromium-debug-test", version: "0.1.0" });
  await client.connect(transport);
  const listed = await client.listTools();
  const available = new Set(listed.tools.map((tool) => tool.name));

  for (const testObject of testObjects) {
    const started = performance.now();
    let transportOk = true;
    let isError = false;
    let response;
    try {
      if (!available.has(testObject.tool)) throw new Error("Tool was not registered by MCP server");
      const raw = await client.callTool({ name: testObject.tool, arguments: testObject.arguments });
      isError = !!raw.isError;
      response = summarize(textOf(raw));
    } catch (error) {
      transportOk = false;
      response = { error: error.message };
    }
    results.push({
      tool: testObject.tool,
      arguments: testObject.arguments,
      purpose: testObject.purpose,
      transport_ok: transportOk,
      business_error: isError,
      latency_ms: Math.round((performance.now() - started) * 10) / 10,
      response,
    });
    await sleep(150);
  }

  await sleep(1200);
  const gameAfter = await readGameObjects(connection);
  const transportFailures = results.filter((result) => !result.transport_ok);
  const report = {
    generated_at: new Date().toISOString(),
    cdp_target: { title: target.title, url: target.url, id: target.id },
    cdp_game_snapshot: {
      version: game.version,
      cookies_before: game.cookies,
      handmade_cookies_before: game.handmadeCookies,
      buildings_seen: game.buildings.length,
      upgrades_seen: game.upgrades.length,
      shimmers_before: game.shimmers,
    },
    cdp_game_snapshot_after: {
      cookies_after: gameAfter.cookies,
      handmade_cookies_after: gameAfter.handmadeCookies,
      shimmers_after: gameAfter.shimmers,
    },
    registered_tool_count: listed.tools.length,
    registered_tools: listed.tools.map((tool) => tool.name),
    test_object_count: testObjects.length,
    transport_failure_count: transportFailures.length,
    all_tools_responded: transportFailures.length === 0,
    tests: results,
  };

  const outputDir = path.join(here, "output");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "chromium-debug-tool-test.json");
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`REPORT_FILE=${outputPath}`);

  if (!report.all_tools_responded) process.exitCode = 1;
} finally {
  if (client) await client.close();
  connection.close();
}
