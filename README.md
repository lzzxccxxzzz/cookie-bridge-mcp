# Cookie Bridge + MCP

Cookie Bridge is a local HTTP bridge and in-game control panel for the Steam
version of Cookie Clicker. This repository also contains a stdio MCP server so
an AI agent can inspect the game and enqueue validated gameplay actions.

> 当前状态：这是一个功能覆盖面已经大幅扩展、但仍需要继续做实机回归的半成品。代码已把普通游戏操作统一到 v3 控制层，并提供离线语法、Schema 和 MCP 工具注册检查；本次整理没有修改或测试用户当前的游戏存档。

## What is included

- A patched `start.js` HTTP server with a versioned action queue, result
  receipts, capability discovery, full control-state access, and screenshot
  capture.
- A `mod_api` renderer mod that executes actions through Cookie Clicker's own
  native methods instead of directly rewriting game state where possible.
- A shared action schema used by the MCP server, HTTP queue, and renderer.
- A stdio MCP server with generated action tools plus read-only state/catalog
  tools.
- A coverage document mapping gameplay areas to action names:
  [`docs/control-coverage.md`](docs/control-coverage.md).

## Current coverage

The v3 registry covers the normal gameplay surface, including:

- cookie clicks, golden cookies, shimmers, news ticker, wrinklers, buildings,
  upgrades, store mode/bulk purchases, switches, save/import/reset;
- sugar lumps and minigames: Garden, Stock Market, Pantheon, and Grimoire;
- dragon egg, dragon auras, dragon pet actions, Santa, seasons, seasonal
  stores, gifts, preferences, bakery name and language;
- ascension, reincarnation, heavenly upgrades, permanent slots, and ascension
  mode;
- generic inspected-UI clicks, input changes, scrolling, dragging, pointer
  events, and game screenshot retrieval for controls that are not conveniently
  represented by a dedicated action.

The exact action/tool count is generated from the shared schema. Run
`npm run check` inside `mcp-server` to print it and verify that every declared
action has a runtime handler and a registered MCP tool.

## Important limitations

This repository does not claim that every registered action has already passed
a full live-game regression suite. The current snapshot has had targeted live
work in earlier iterations, but the broad v3 control layer still needs a
dedicated end-to-end pass against a disposable save.

Some names visible in the game source are placeholders or platform-owned
operations rather than executable vanilla gameplay. The bridge intentionally
does not invent behavior for stock-market opportunity/refill stubs, Steam
account/OS dialogs, arbitrary JavaScript evaluation, or third-party mod APIs.
The UI inspection and pointer tools are the escape hatch for ordinary visible
game controls, while destructive actions require explicit confirmation.

## Install into Cookie Clicker

Close Cookie Clicker before replacing its Electron entrypoint. From an elevated
PowerShell prompt:

```powershell
.\install.ps1 -GameAppPath 'D:\SteamLibrary\steamapps\common\Cookie Clicker\resources\app' -NoPause
```

The installer backs up the original `start.js` as `start.js.original`, copies
the patched server, and installs the five `mod_api` files. Start the game again
after installation; the bridge listens on `http://127.0.0.1:8000` by default.

The MCP package is not installed into the game directory:

```powershell
cd mcp-server
npm install
npm run check
npm start
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "cookie-bridge": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\cookie-bridge\\mcp-server\\server.mjs"],
      "env": {
        "COOKIE_BRIDGE_URL": "http://127.0.0.1:8000"
      }
    }
  }
}
```

## Safe verification commands

`npm run check` is offline: it parses the source, compares the schema against
runtime handlers, and checks MCP tool registration without touching the game.

The repository also retains the older live smoke/CDP scripts for future tests:
`npm run smoke-test`, `npm run chromium-debug-test`, and `npm run goal-run`.
Those commands require a running bridge and can change the active save. Use a
disposable test save and run them only when live testing is intended.

## HTTP endpoints

The patched server retains the original dashboard and REST compatibility routes
and adds the v3 control surface:

```text
GET  /capabilities
GET  /control/state
GET  /control/screenshot
POST /action/enqueue
GET  /action/next
POST /action/results
GET  /action/result/:id
GET  /history/actions
```

The MCP server checks the bridge and renderer versions before enqueueing an
action. Results are explicit: `queued`, `dispatched`, `succeeded`, `failed`,
`awaiting_confirmation`, `expired`, or `cancelled`; a timeout is never treated
as a successful purchase.

## License and game ownership

Cookie Clicker is owned by its original creators and publisher. This project is
an unofficial local automation/modification layer and is not affiliated with
the Cookie Clicker developers.
