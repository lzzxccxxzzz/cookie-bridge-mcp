import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import schema from "../mod_api/control-schema.js";
import {localBridgeURL, authHeaders} from './bridge-auth.mjs';

const BRIDGE_URL = localBridgeURL(process.env.COOKIE_BRIDGE_URL || "http://127.0.0.1:8000");
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.COOKIE_BRIDGE_TIMEOUT_MS) || 10000);
const RESULT_TIMEOUT_MS = Math.max(0, Math.min(60000, Number(process.env.COOKIE_BRIDGE_RESULT_TIMEOUT_MS) || 10000));
const terminal = new Set(["succeeded", "failed", "awaiting_confirmation", "cancelled", "expired", "indeterminate"]);

class BridgeError extends Error {
  constructor(message, details) { super(message); this.name = "BridgeError"; this.details = details; }
}
async function bridgeRequest(path, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(BRIDGE_URL + path, {
      method, headers: authHeaders(["POST","DELETE"].includes(method) ? { "content-type": "application/json" } : {}), redirect: 'error',
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    if (!response.ok) throw new BridgeError("Cookie Bridge returned HTTP " + response.status, data);
    return data;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError("Cookie Bridge request failed: " + error.message, {
      bridge_url: BRIDGE_URL, delivery_uncertain: method !== "GET",
      next_step: method !== "GET" ? "Check action history before retrying: a timed-out request may already have been accepted." : undefined,
    });
  } finally { clearTimeout(timeout); }
}
function tool(handler) {
  return async (args) => {
    try {
      const value = await handler(args || {});
      return { ...(value && ["failed", "cancelled", "expired", "indeterminate"].includes(value.status) ? { isError: true } : {}),
        content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: error.message, details: error.details, bridge_url: BRIDGE_URL }, null, 2) }] };
    }
  };
}
const pathSegment = value => encodeURIComponent(String(value));
async function controlState() {
  const state = await bridgeRequest("/control/state");
  if (state.api_version !== schema.version) throw new BridgeError("Renderer/MCP version mismatch. Reinstall all Cookie Bridge files and restart the game.", { renderer: state.api_version, mcp: schema.version });
  return state;
}
async function actionResult(id, waitMs = 0) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const receipt = await bridgeRequest("/action/result/" + pathSegment(id));
    if (terminal.has(receipt.status) || Date.now() >= deadline) {
      return { ...receipt, ...(terminal.has(receipt.status) ? {} : { pending: true, next_step: "Poll get_action_result with this ID. Do not resubmit the action." }) };
    }
    await delay(Math.min(200, Math.max(1, deadline - Date.now())));
  }
}
async function queueAction(type, parameters = {}, wait = true) {
  // Do not let generic parameters replace the selected action or receipt identity.
  if (Object.hasOwn(parameters, "type") || Object.hasOwn(parameters, "_bridge")) throw new BridgeError("type and _bridge are not action parameters.");
  const action = schema.validate({ ...parameters, type });
  const capabilities = await bridgeRequest("/capabilities");
  if (capabilities.api_version !== schema.version || capabilities.renderer_version !== schema.version) throw new BridgeError("Matching full-control HTTP server and renderer are required before executing an action.", capabilities);
  const queued = await bridgeRequest("/action/enqueue", { method: "POST", body: action });
  return wait ? actionResult(queued.id, RESULT_TIMEOUT_MS) : queued;
}
function zodField(f) {
  let value;
  if (f.const !== undefined) value = z.literal(f.const);
  else if (f.enum) value = f.type === "string" ? z.enum(f.enum) : z.union(f.enum.map(x => z.literal(x)));
  else if (f.type === "boolean") value = z.boolean();
  else if (f.type === "string") value = z.string().min(f.minLength ?? 0).max(f.maxLength ?? 4000000);
  else { value = z.number(); if (f.type === "integer") value = value.int(); if (f.minimum !== undefined) value = value.min(f.minimum); if (f.maximum !== undefined) value = value.max(f.maximum); }
  value = value.describe(f.description);
  if (f.optional) value = value.optional();
  if (f.default !== undefined) value = value.default(f.default);
  return value;
}

export function createServer() {
  const server = new McpServer({ name: "cookie-bridge-mcp", version: schema.version });
  const register = (name, description, inputSchema, handler, readOnly = true) => server.registerTool(name, {
    title: name.replaceAll("_", " "), description, inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false },
  }, tool(handler));

  server.registerTool('get_game_screenshot', {
    title: 'Capture the Cookie Clicker window', description: 'Capture the game window as a PNG image for visual controls and canvas interactions.', inputSchema: {},
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
  }, async () => {
    try { const capture = await bridgeRequest('/control/screenshot'); return {content: [{type: 'image', mimeType: capture.mimeType, data: capture.data}, {type: 'text', text: JSON.stringify({timestamp: capture.timestamp, size: capture.size})}]}; }
    catch (error) { return {isError: true, content: [{type: 'text', text: error.message}]}; }
  });

  register("get_bridge_status", "Check HTTP server connection, renderer API version and state freshness.", {}, async () => ({ ...await bridgeRequest("/"), capabilities: await bridgeRequest("/capabilities").then(c => ({api_version: c.api_version, renderer_version: c.renderer_version, state_age_ms: c.state_age_ms})) }));
  register("get_capabilities", "Discover every typed action and its parameters, version compatibility, and explicitly unsupported game features.", {group: z.string().optional()}, async ({group}) => {
    const live = await bridgeRequest("/capabilities");
    return {...live, actions: live.actions.filter(a => !group || a.group === group)};
  });
  register("get_game_state", "Read the latest full game snapshot. Catalogs and export save can be requested separately to keep the response compact.", {include_save: z.boolean().default(false), include_catalog: z.boolean().default(false)}, async ({include_save, include_catalog}) => {
    const state = await bridgeRequest("/state");
    if (!include_save) delete state.save_string;
    if (!include_catalog && state.control) { delete state.control.upgrades; delete state.control.achievements; }
    state.state_age_ms = Date.now() - state.timestamp;
    return state;
  });
  register("get_game_stats", "Read compact cookie, production and run statistics.", {}, () => bridgeRequest("/stats"));
  register("get_building", "Inspect a building's actual native prices, amounts, level and minigame availability.", {name: z.string().min(1)}, async ({name}) => {
    const state = await controlState();
    const b = state.buildings.find(b => [b.name, b.display_name, String(b.id)].some(n => n?.toLowerCase() === name.toLowerCase()));
    if (!b) throw new BridgeError("Building not found.");
    return {snapshot_at: state.snapshot_at, building: b};
  });
  register("get_upgrades", "List the current upgrade shop. For locked, owned, heavenly and selector upgrades use get_game_catalog.", {}, () => bridgeRequest("/upgrades"));
  register("get_golden_cookies", "List live golden/wrath cookies and reindeer with stable shimmer IDs.", {}, async () => { const s = await controlState(); return {timestamp: s.live.timestamp, shimmers: s.live.shimmers}; });
  register("get_active_effects", "Read active buffs and remaining frame timers.", {}, async () => (await controlState()).live.buffs);
  register("get_game_catalog", "Search the current game catalog, including locked and owned items. IDs are the canonical parameters for actions.", {
    kind: z.enum(["buildings", "upgrades", "achievements", "dragon_auras", "dragon_levels", "seasons", "ascension_modes", "languages", "mods", "preferences"]),
    search: z.string().default(""), pool: z.string().optional(), unlocked: z.boolean().optional(), bought: z.boolean().optional(),
    offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(1000).default(100),
  }, async ({kind, search, pool, unlocked, bought, offset, limit}) => {
    const s = await controlState();
    if (kind === "preferences") return s.preferences;
    const source = kind === "dragon_auras" ? s.dragon.auras : kind === "dragon_levels" ? s.dragon.levels : s[kind];
    const list = source.filter(item => (!search || JSON.stringify(item).toLowerCase().includes(search.toLowerCase())) && (pool === undefined || item.pool === pool) && (unlocked === undefined || item.unlocked === unlocked) && (bought === undefined || item.bought === bought));
    return {snapshot_at: s.snapshot_at, total: list.length, offset, items: list.slice(offset, offset + limit)};
  });
  register("get_minigame_state", "Read full actionable Garden, Pantheon, Grimoire or Stock Market state, including choices, costs and cooldowns.", {minigame: z.enum(["all", "garden", "pantheon", "grimoire", "stock"]).default("all")}, async ({minigame}) => { const s = await controlState(); return {timestamp: s.live.timestamp, lumps: s.live.lumps, minigames: minigame === "all" ? s.live.minigames : s.live.minigames[minigame]}; });
  register("get_dragon_state", "Read dragon egg/training levels, all auras, aura unlocks and Santa progression.", {}, async () => { const s = await controlState(); return {dragon: s.dragon, santa: s.santa, snapshot_at: s.snapshot_at}; });
  register("get_prestige_state", "Read ascension phase, chips, modes, permanent slots and eligible upgrades.", {}, async () => { const s = await controlState(); return {on_ascend: s.live.on_ascend, ascend_timer: s.live.ascend_timer, reincarnate_timer: s.live.reincarnate_timer, ...s.live.prestige, modes: s.ascension_modes, upgrades: s.upgrades.filter(u => u.pool === "prestige"), permanent_candidates: s.upgrades.filter(u => u.permanent_eligible)}; });
  register("get_news_state", "Read current ticker text and whether a clickable fortune is present.", {}, async () => (await controlState()).live.ticker);
  register("get_ui_state", "Inspect the fresh renderer UI, including prompts, stable element refs and editable field values. Uses a read-only queued inspection.", {offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(1000).default(200)}, args => queueAction("inspect_ui", args));
  register("get_action_queue", "Read pending actions; queue acceptance does not imply game execution.", {}, () => bridgeRequest("/action/queue"));
  register("get_action_history", "Read action receipts with queued/dispatched/succeeded/failed/awaiting_confirmation status and game errors.", {count: z.number().int().min(1).max(200).default(10)}, ({count}) => bridgeRequest("/history/actions?n=" + count));
  register("get_action_result", "Read or wait for a specific action receipt. Poll the same ID after a timeout; do not repeat a possibly executed purchase.", {id: z.string().min(1), wait_ms: z.number().int().min(0).max(60000).default(0)}, ({id, wait_ms}) => actionResult(id, wait_ms));
  register("clear_action_queue", "Cancel pending actions. Already dispatched actions cannot be cancelled or rolled back.", {}, () => bridgeRequest("/action/queue", {method: "DELETE"}), false);

  // One contract provides dedicated MCP schemas, REST validation and dispatch.
  for (const spec of Object.values(schema.actions)) {
    const fields = Object.fromEntries(Object.entries(spec.properties).map(([key, field]) => [key, zodField(field)]));
    fields.wait_for_result = z.boolean().default(true).describe("Wait for the renderer receipt. If false, returns an action ID for get_action_result.");
    register(spec.name, spec.description + " Returns an execution receipt; pending/awaiting_confirmation is not completed gameplay.", fields, ({wait_for_result, ...args}) => queueAction(spec.name, args, wait_for_result), !!spec.readOnly);
  }
  register("click_golden_cookie", "Compatibility alias for click_shimmer; prefer its stable shimmer_id when available.", {index: z.number().int().min(0).default(0)}, args => queueAction("click_shimmer", args), false);
  register("enqueue_game_action", "Queue any catalog action. Legacy Portuguese field aliases are accepted. Use get_capabilities for its exact parameter schema.", {
    type: z.enum(Object.keys(schema.actions)), parameters: z.record(z.string(), z.unknown()).default({}), wait_for_result: z.boolean().default(false),
  }, ({type, parameters, wait_for_result}) => queueAction(type, parameters, wait_for_result), false);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createServer().connect(new StdioServerTransport());
}
