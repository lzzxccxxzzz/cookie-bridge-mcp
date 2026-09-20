import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, "server.mjs");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, COOKIE_BRIDGE_URL: process.env.COOKIE_BRIDGE_URL || "http://127.0.0.1:8000" },
});
const client = new Client({ name: "cookie-bridge-smoke-test", version: "0.1.0" });

function textOf(result) {
  const block = result?.content?.find((item) => item.type === "text");
  if (!block) throw new Error(`MCP tool returned no text: ${JSON.stringify(result)}`);
  return JSON.parse(block.text);
}

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name);
  if (!toolNames.includes("get_game_stats") || !toolNames.includes("click_cookie")) {
    throw new Error(`Expected tools were not registered: ${toolNames.join(", ")}`);
  }

  const before = textOf(await client.callTool({ name: "get_game_stats", arguments: {} }));
  const clickResult = textOf(await client.callTool({ name: "click_cookie", arguments: { count: 1 } }));
  await sleep(1200);
  const after = textOf(await client.callTool({ name: "get_game_stats", arguments: {} }));
  const history = textOf(await client.callTool({ name: "get_action_history", arguments: { count: 5 } }));

  const clicksBefore = Number(before.total_cliques);
  const clicksAfter = Number(after.total_cliques);
  const cookiesBefore = Number(before.cookies_na_conta);
  const cookiesAfter = Number(after.cookies_na_conta);
  const clickCountChanged = Number.isFinite(clicksBefore) && Number.isFinite(clicksAfter) && clicksAfter > clicksBefore;
  const cookieCountChanged = Number.isFinite(cookiesBefore) && Number.isFinite(cookiesAfter) && cookiesAfter > cookiesBefore;
  const executedClick = (history.acoes || []).some((action) => action.type === "click_cookie" && action._executed_at);

  console.log(JSON.stringify({
    status: "ok",
    tool_count: toolNames.length,
    tools: toolNames,
    click_result: clickResult,
    before: { total_cliques: clicksBefore, cookies: cookiesBefore },
    after: { total_cliques: clicksAfter, cookies: cookiesAfter },
    history_tail: history.acoes,
    verified: { executed_click: executedClick, click_count_changed: clickCountChanged, cookie_count_changed: cookieCountChanged },
  }, null, 2));

  if (!executedClick) {
    throw new Error("MCP click was queued, but Cookie Bridge did not report it as executed.");
  }
} finally {
  await client.close();
}
