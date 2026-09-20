# Cookie Bridge MCP

This package is a stdio MCP server for the local Cookie Bridge v3 HTTP bridge.
It generates action-specific MCP tools from `../mod_api/control-schema.js`, so
the schema, queue, renderer, REST API and MCP layer share the same action names
and validation rules.

## Current state

The implementation is broad but not yet fully live-regression-tested. The
offline check verifies JavaScript syntax, schema/runtime handler parity, and MCP
tool registration. It does not open Cookie Clicker or change a save.

```powershell
npm install
npm run check
```

The check prints the exact action and tool counts for the checkout. It is the
recommended low-cost verification command when working under limited quota.

## Run

Cookie Clicker must be running with the patched Cookie Bridge installed:

```powershell
npm start
```

The default bridge URL is `http://127.0.0.1:8000`. Override it with
`COOKIE_BRIDGE_URL`. `COOKIE_BRIDGE_TIMEOUT_MS` controls HTTP request timeout;
`COOKIE_BRIDGE_RESULT_TIMEOUT_MS` controls how long a synchronous tool call
waits for an action receipt.

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

## Tool groups

The server exposes read tools for bridge capabilities, live state, stats,
catalogs, buildings, upgrades, effects, golden cookies, minigames, dragon,
prestige, news, UI inspection, screenshots, and action history.

Generated write tools cover the shared v3 registry: cookie/shimmer/wrinkler
actions; buildings and store; upgrades, vault and switches; sugar lumps;
Garden, Stock Market, Pantheon and Grimoire; dragon, Santa, seasons and gifts;
preferences and save management; ascension, heavenly upgrades, permanent
slots and reincarnation. `ui_click`, `ui_set_input`, `ui_scroll`, `ui_drag` and
`ui_pointer` cover ordinary visible controls that do not need a dedicated
wrapper.

Mutation tools return a receipt rather than guessing that an action succeeded.
Destructive actions require `confirm: true`, and prompt-driven operations use
an explicit prompt token so an old confirmation cannot be applied to a new
dialog.

## Live tests (opt-in)

These scripts can mutate the active game and are not part of `npm run check`:

```powershell
npm run smoke-test
npm run chromium-debug-test
npm run goal-run
```

Run them only against a disposable save. The Chromium script requires Cookie
Clicker to be launched with remote debugging enabled. Existing reports in
`output/` are historical artifacts from earlier iterations, not a complete
claim that every v3 action has passed.
