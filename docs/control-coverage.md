# Cookie Bridge 3.2 control coverage

This map targets Cookie Clicker 2.053. The 80-action registry and its 101 MCP
tools share one contract. Implementation follows local game source and native
callbacks; test fixtures are kept outside the production control layer.
See [validation.md](validation.md) for the dated live-test evidence and limits.

## Action map

| Area | Shared action names | Implementation route |
| --- | --- | --- |
| Cookies and shimmers | `click_cookie`, `click_shimmer`, `click_shimmers`, `click_ticker`, `wrinkler_click`, `wrinkler_pop`, `wrinkler_pop_all` | Native click handlers, shimmer callbacks, ticker callback, and wrinkler damage/pop paths |
| Buildings | `buy_building`, `buy_building_max`, `sell_building`, `sell_all_of_type`, `sell_all_buildings`, `mute_building` | `Game.Objects[*]` purchase/sale/mute methods; actual quantity and cookie delta are reported |
| Store and upgrades | `store_mode`, `store_bulk`, `buy_upgrade`, `store_buy_all`, `upgrade_vault`, `upgrade_choices`, `upgrade_choose`, `switch_set` | Native store modes, bulk purchase, upgrade buy/toggle/vault/choice functions, and Golden Switch/Veil/Covenant state |
| Sugar lumps | `sugarlump_use`, `harvest_lump`, `garden_recharge`, `grimoire_recharge`, `pantheon_recharge`, `stock_buy_broker` | Native lump level-up/harvest/refill methods with maturity, cost, and cooldown checks |
| Garden | `garden_select_seed`, `garden_plant`, `garden_click_tile`, `garden_harvest`, `garden_harvest_all`, `garden_soil`, `garden_freeze`, `garden_sacrifice` | Garden `useTool`, `harvest`, `harvestAll`, soil controls, freeze tool, and native sacrifice prompt |
| Stock Market | `stock_buy`, `stock_sell`, `stock_sell_all`, `stock_upgrade_office`, `stock_take_loan`, `stock_graph`, `stock_visibility` | Stock good buy/sell callbacks, office upgrades, loans, graph and visibility controls |
| Pantheon | `pantheon_set`, `pantheon_remove` | Native drag/drop god placement and roster removal, with slot and swap rules |
| Grimoire | `cast_spell` | Native spell cost, failure chance, magic and cooldown validation, then `castSpell` |
| Dragon and Santa | `upgrade_dragon`, `dragon_set_aura`, `dragon_pet`, `upgrade_santa` | Native dragon egg/level/aura selection, dragon pet click, and Santa upgrade/hat methods |
| Seasons and gifts | `set_season`, `gift_create`, `gift_redeem` | Trigger-upgrade season switching, native gift prompt/box flow, and gift code redemption |
| Prestige | `ascend`, `buy_heavenly_upgrade`, `ascension_mode`, `permanent_slot`, `reincarnate` | Native ascension, reincarnation, heavenly purchase, permanent-slot assignment, and mode controls |
| Settings | `rename_bakery`, `toggle_pref`, `set_pref`, `set_volume`, `set_language` | Native bakery-name validation, preferences, volume, language menu and save/reload behavior |
| UI and prompts | `minigame_open`, `click_tiny_cookie`, `special_menu`, `ascension_view`, `show_menu`, `dismiss_notifications`, `prompt_respond`, `prompt_cancel`, `inspect_ui`, `ui_click`, `ui_set_input`, `ui_scroll`, `ui_drag`, `ui_pointer` | Visible DOM inspection, guarded native click/input events, prompt tokens, scrolling/dragging, and relative pointer events |
| Persistence | `force_save`, `export_save`, `import_save`, `hard_reset` | Cookie Clicker's save writer/loader/reset methods; import/reset require explicit confirmation |

## Read surfaces

The MCP read tools expose the same state without writing to the game:

- bridge health/capabilities, complete control state, action result/history and
  queue status;
- cookies, CpS, buffs, shimmers, wrinklers, ticker/news and save metadata;
- buildings, upgrades, achievements, dragon, Santa, prestige and preferences;
- Garden, Stock Market, Pantheon, Grimoire and other minigame snapshots;
- paged catalogs and an optional PNG screenshot of the game window.

The snapshot intentionally includes locked catalog entries and eligibility
metadata so an agent can decide whether to wait, earn resources, or request a
confirmation instead of treating a missing item as an unknown error.

## Safety and semantics

- The queue assigns an id before dispatch and never retries a consumed action
  automatically; this avoids double purchases after an HTTP timeout.
- The renderer uses native game methods and reports actual quantities/deltas
  where the game exposes them.
- `ascend`, import/reset, selling all buildings and Garden sacrifice require
  `confirm: true`. `reincarnate` is itself an explicit action on the ascension
  screen and has no additional confirmation field. Native dialogs are handled
  separately with `prompt_respond` and the returned token.
- Prompt responses are bound to a fresh prompt token, preventing a stale agent
  response from answering a later dialog.
- UI tools do not expose arbitrary JavaScript evaluation. Pointer coordinates
  are relative to an inspected element and remain subject to the game's own
  callbacks and checks.
- Queue records survive process restart. Missing dispatched receipts become
  `indeterminate`, never automatic retries. Completed receipts are idempotent;
  old element refs and prompt tokens are invalid across renderer reloads.
- Click batches are paced to the game's native rate limit and return the actual
  registered count. Building levels have the native increasing lump cost, not
  an invented level-10/20 cap. Pantheon swap timers use the game's 16h/4h/1h rules.

## Native variants exercised

The live suite includes every building type, every Grimoire spell, all Pantheon
spirits, all five Garden soils, all Stock Market goods/offices/loans, every
dragon training level and both aura slots, every Santa level and all five
season switches. Upgrade coverage samples ordinary cookies, research and its
confirmation, seasonal upgrades, vault/buy-all, Golden Switch, Shimmering Veil,
Elder Covenant and lump-spending Sugar frenzy. It is not a purchase of every
individual upgrade in the catalog.

All four shop choice providers are exercised: Milk selector, Background
selector, Golden cookie sound selector and Jukebox. The native clone-customizer
button is discovered from UI inspection and its hair control is clicked through
MCP. Generic pointer and drag behavior is checked against the big cookie and a
Pantheon spirit respectively; this does not certify every canvas gesture.

News coverage includes a fortune unlock. Shimmer coverage includes golden
cookies and reindeer. Wrinkler tests check click damage, payouts and optional
shiny preservation. Random rewards keep their native probability; a successful
tool call is not a promise of a specific drop.

## Deliberately out of scope

The local game source contains names that are not complete gameplay APIs. The
bridge does not fabricate behavior for placeholder Stock Market opportunity or
refill hooks, Steam account operations, OS-native dialogs, or arbitrary
third-party mod APIs. These are different from ordinary in-game controls and
need a platform-specific integration or a separate mod contract.

Full tool coverage is a statement about the registered interface, not an
exhaustive proof over every game state or random outcome. Native operations
still reject missing resources, locked features, cooldowns and invalid targets.
Future Cookie Clicker versions and third-party mods need separate validation.
