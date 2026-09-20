# Cookie Bridge v3 control coverage

This is an implementation map, not a live-test certificate. The v3 layer was
designed by reading the local Cookie Clicker source and routing normal actions
through the game's own methods. `npm run check` validates the offline contract;
a separate disposable-save regression run is still required for runtime
acceptance.

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
- `ascend`, `reincarnate`, import/reset, selling all buildings, Garden
  sacrifice, and other destructive operations use explicit confirmation.
- Prompt responses are bound to a fresh prompt token, preventing a stale agent
  response from answering a later dialog.
- UI tools do not expose arbitrary JavaScript evaluation. Pointer coordinates
  are relative to an inspected element and remain subject to the game's own
  callbacks and checks.

## Deliberately out of scope

The local game source contains names that are not complete gameplay APIs. The
bridge does not fabricate behavior for placeholder Stock Market opportunity or
refill hooks, Steam account operations, OS-native dialogs, or arbitrary
third-party mod APIs. These are different from ordinary in-game controls and
need a platform-specific integration or a separate mod contract.

Likewise, the action registry being complete does not mean every action has
been demonstrated in a live regression run. The next validation step is to
install this snapshot, create a disposable save, and execute a matrix covering
each action group while checking the returned receipts and state deltas.
