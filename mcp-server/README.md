# Cookie Bridge MCP

Stdio MCP adapter for Cookie Bridge **3.1.0**: 80 schema-generated actions and 21 read, queue-management, and compatibility tools (101 total). The renderer, HTTP server and MCP share `../mod_api/control-schema.js`.

## Run and configure

Use Node.js 22+ on the host; do not replace the game's bundled Electron runtime.

```powershell
npm ci
npm run check
npm test
npm start
```

Install the bridge with the repository's `install.ps1` and start Cookie Clicker first. Configure your MCP client to execute `node /absolute/path/to/mcp-server/server.mjs`.

Environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| COOKIE_BRIDGE_URL | http://127.0.0.1:8000 | Target bridge |
| COOKIE_BRIDGE_TIMEOUT_MS | 10000 | Per-HTTP-request timeout |
| COOKIE_BRIDGE_RESULT_TIMEOUT_MS | 10000 | Initial receipt wait (up to 60000 ms) |
| COOKIE_BRIDGE_PORT | 8000 | HTTP listen port, used by the game process |

Game startup passes the configured port to the renderer, overriding an old saved bridge port. A protocol mismatch or stale renderer rejects new actions. Read timestamps before making decisions.

## Agent workflow

1. Read `get_capabilities`, `get_game_state`, and catalogs to discover IDs, unlocks, costs and eligibility.
2. Invoke the dedicated tool. Use `wait_for_result: false` only when you intend to poll its ID.
3. Handle native prompts with `prompt_respond(expected_prompt, option)`; do not treat `awaiting_confirmation` as a completed purchase.
4. Check actual result deltas and fresh state. Spell failures and random rewards remain native outcomes.
5. After a pending response, poll `get_action_result` with the same ID. Never blindly resubmit uncertain work.

Terminal statuses are `succeeded`, `failed`, `awaiting_confirmation`, `cancelled`, `expired`, `indeterminate`. A dispatched action can have side effects even if its receipt is lost. A late receipt can resolve an indeterminate result; the bridge itself never replays it.

Queue acceptance/results survive process restarts in `CookieBridge/actions.json` (or the test root). Renderer acknowledgements also survive page reload through session storage. This provides at-most-once dispatch, not a distributed exactly-once guarantee. A caller retrying a new enqueue request gets a new action ID.

UI refs come from `get_ui_state` / `inspect_ui`. Use observed refs or exact DOM IDs; stale or hidden targets are rejected. Clone customization and jukebox use ordinary inspected controls; there is no public eval tool.

## Offline tests

`npm run check` parses sources and compares all registered tools/handlers with the schema. `npm test` runs 10 tests covering schemas, FIFO/backpressure, expiry/cancellation, receipt replay, journal restart, indeterminate results, invalid journals, redaction and MCP version/stale-state errors against a local HTTP mock. Neither contacts the game.

After installation, `npm run verify:installed` is a separate read-only MCP check
against the normal bridge on port 8000. It verifies versions, fresh game state,
catalogs and documentation pages without issuing gameplay actions or using CDP.

## Isolated live regression

From this directory:

```powershell
.\prepare-test.ps1 -GameDirectory 'D:\SteamLibrary\steamapps\common\Cookie Clicker' -Launch
npm run test:integration
npm run test:restart
npm run smoke-test
```

Preparation copies the installed game into `output/integration/runtime`, excluding its save and user mods. No paid game assets are committed. The process uses its own user profile, game save and bridge database, runs hidden, disables background timer throttling, and skips Steam SDK initialization. Disk use is approximately another game installation. Stop that exact copied game process before rerunning preparation.

The harness verifies both `capabilities.test_mode` and that the CDP page is inside the reported test root **before any fixture mutation**. Defaults are bridge port 8001 and CDP port 9223; override `COOKIE_BRIDGE_URL` and `CHROMIUM_DEBUG_URL` together when using custom preparation ports. Use the default name for reproducible report paths (`output/integration/`).

- `test:integration`: full tool matrix, 10K actual-click run, all 20 buildings, minigames, dragon/Santa, seasons/store/UI, prestige, negative cases and save/language reload.
- `test:restart`: actual Electron process exit/restart, receipt recovery, no replay, pending execution once and stale UI/prompt rejection.
- `smoke-test`: one real MCP click and independent click-counter assertion.
- `chromium-debug-test`: compatibility entry point for the full suite, no longer the old 16-tool probe.
- `goal-run`: only the isolated 10K scenario.

Run a subset with `$env:TEST_GROUP='garden,stock'` then `npm run test:integration`; clear it with `Remove-Item Env:TEST_GROUP` before full acceptance. Subset reports are not 101-tool acceptance reports.

All gameplay operations under test go through the real stdio MCP client, HTTP queue and renderer. CDP only seeds synthetic fixtures and reads independent native state. The suite uses synthetic late-game resources, unlocks, mature crops, timers and shimmers. The 10K scenario starts from a reset test save and earns its cookies via native clicks/production; the golden-cookie spawn is controlled.

Raw reports contain calls, receipts, fixture expressions, assertions, coverage and renderer exceptions. Export strings and gift codes are redacted from test arguments. `output/` is ignored by Git. Public, sanitized results belong in [../docs/validation.md](../docs/validation.md).

## Limits

The suite proves registered tools and selected native behavior, not every possible state, random drop, upgrade combination or third-party mod. Read [the coverage map](../docs/control-coverage.md) before extending it. Native Steam account/OS dialogs and unfinished game hooks are excluded.
