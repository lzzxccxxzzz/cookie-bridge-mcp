/* Shared by the renderer, Electron HTTP server and stdio MCP server. */
(function (root, factory) {
  var api = factory();
  if (!root.document && typeof module === 'object' && module.exports) module.exports = api;
  else root.CookieBridgeSchema = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var VERSION = '3.1.0';
  var actions = Object.create(null);
  function field(type, description, options) { return Object.assign({type: type, description: description}, options || {}); }
  function str(description, options) { return field('string', description, Object.assign({minLength: 1, maxLength: 256}, options)); }
  function num(description, min, max, options) { return field('integer', description, Object.assign({minimum: min, maximum: max}, options)); }
  function bool(description, options) { return field('boolean', description, options); }
  function choice(description, values, options) { return field(typeof values[0], description, Object.assign({enum: values}, options)); }
  function def(name, group, description, properties, extra) {
    actions[name] = Object.assign({name: name, group: group, description: description, properties: properties || {}}, extra);
  }
  var name = str('Exact English game name (localized display names are also accepted).');
  var id = num('Game object ID from the catalog.', 0, 100000, {optional: true});
  var upgrade = {id: id, name: Object.assign({}, name, {optional: true})};
  var quantity = num('Units; a purchase may be partially filled. The result reports actual units.', 1, 100000, {default: 1});
  var confirm = bool('Explicitly authorize this destructive game operation.', {const: true});
  var coord = {x: num('Garden column, left to right.', 0, 5), y: num('Garden row, top to bottom.', 0, 5)};
  var seed = num('Seed ID from garden.seeds.', 0, 1000);
  var target = str('An element ref from inspect_ui, or an exact DOM element ID.', {maxLength: 512});
  var checked = bool('Desired state.');
  def('click_cookie', 'cookies', 'Click the big cookie. Fast repeated clicks still obey the game click-rate limit.', {count: num('Attempts.', 1, 1000, {default: 1})});
  def('buy_building', 'buildings', 'Buy any building, applying current discounts and normal unlock rules.', {name: name, quantity: quantity}, {aliases: {quantidade: 'quantity'}});
  def('buy_building_max', 'buildings', 'Buy as many units as affordable, up to the supplied per-call limit.', {name: name, limit: num('Maximum units to buy.', 1, 100000, {default: 10000})});
  def('sell_building', 'buildings', 'Sell a building; triggers normal sell effects including Godzamok and Dragon Orbs.', {name: name, quantity: quantity}, {aliases: {quantidade: 'quantity'}});
  def('sell_all_of_type', 'buildings', 'Sell all units of one building type.', {name: name});
  def('sell_all_buildings', 'buildings', 'Sell every owned building from highest tier to lowest.', {confirm: confirm}, {destructive: true});
  def('sugarlump_use', 'lumps', 'Level up a building once; costs current level + 1 sugar lumps.', {name: name}, {aliases: {build_name: 'name'}});
  def('mute_building', 'buildings', 'Minimize/unminimize a building row using its game mute method.', {name: name, muted: bool('Omit to toggle.', {optional: true})}, {aliases: {nome: 'name'}});
  def('minigame_open', 'ui', 'Open or close an unlocked building minigame.', {name: name, open: bool('Show the minigame.', {default: true})});
  def('store_mode', 'store', 'Set the shop buy/sell mode.', {mode: choice('Store mode.', ['buy', 'sell'])});
  def('store_bulk', 'store', 'Set the shop bulk selector; all is available in sell mode.', {quantity: choice('Bulk quantity; -1 means sell all.', [1, 10, 100, -1])});
  def('buy_upgrade', 'store', 'Buy or activate an unlocked upgrade. Covers research, seasonal cookies, switches, pledge/covenant and sugar frenzy. Confirmation prompts are returned for prompt_respond.', upgrade, {atLeastOne: ['id', 'name']});
  def('store_buy_all', 'store', 'Use the native Buy All button; requires Inspired checklist and respects vault exclusions. Tech and toggle upgrades are excluded by the game.');
  def('upgrade_vault', 'store', 'Vault or unvault an upgrade; requires Inspired checklist.', Object.assign({}, upgrade, {vaulted: checked}), {atLeastOne: ['id', 'name']});
  def('upgrade_choices', 'store', 'Open a selector upgrade (milk, background, chime, jukebox, clone appearance, etc.). Read choices and UI controls in the result.', upgrade, {atLeastOne: ['id', 'name']});
  def('upgrade_choose', 'store', 'Choose a numeric option from a selector upgrade. HTML-based selectors are controlled through inspect_ui/ui_click/ui_set_input.', Object.assign({}, upgrade, {choice_id: num('Original choice index returned by the selector catalog.', 0, 100000)}), {atLeastOne: ['id', 'name']});
  def('switch_set', 'store', 'Set a named store switch through its paid upgrade, if unlocked.', {switch: choice('Switch.', ['golden', 'veil', 'covenant']), enabled: checked});
  def('click_shimmer', 'cookies', 'Click a golden/wrath cookie, reindeer or other shimmer. Prefer stable shimmer_id over a changing array index.', {shimmer_id: num('Stable ID from live.shimmers.', 0, 1000000000, {optional: true}), index: num('Legacy zero-based index, used only when shimmer_id is absent.', 0, 10000, {default: 0}), expected_type: str('Optional type check.', {optional: true})});
  def('click_shimmers', 'cookies', 'Click all currently present matching shimmers.', {kind: choice('Kind to click.', ['all', 'golden', 'wrath', 'reindeer'], {default: 'all'})});
  def('click_ticker', 'cookies', 'Click the actual news ticker, collecting an active fortune or cycling ordinary news.', {fortune_only: bool('Reject if the current ticker is not a fortune.', {default: false})});
  def('click_tiny_cookie', 'ui', 'Click the tiny cookie in the stats screen for its normal achievement.');
  def('harvest_lump', 'lumps', 'Click the growing sugar lump using its real maturity and random harvest rules.');
  def('cast_spell', 'grimoire', 'Cast a Grimoire spell using native cost, fail chance and side effects.', {spell_index: num('Spell ID.', 0, 1000)});
  def('grimoire_recharge', 'grimoire', 'Spend 1 lump to restore up to 100 magic, respecting the shared refill cooldown.');
  def('pantheon_set', 'pantheon', 'Slot or swap a spirit, consuming one worship swap.', {spirit_index: num('Spirit ID.', 0, 1000), slot_index: num('0 diamond, 1 ruby, 2 jade.', 0, 2)});
  def('pantheon_remove', 'pantheon', 'Return a slotted spirit to the roster; removal does not consume a swap.', {slot_index: num('Slot.', 0, 2)});
  def('pantheon_recharge', 'pantheon', 'Spend 1 lump to refill all worship swaps, respecting the shared refill cooldown.');
  def('garden_select_seed', 'garden', 'Select a seed for tile clicks; -1 deselects.', {seed_index: num('Seed ID or -1.', -1, 1000)});
  def('garden_plant', 'garden', 'Plant an unlocked, plantable seed into an empty unlocked tile, paying its current cost.', Object.assign({seed_index: seed}, coord));
  def('garden_click_tile', 'garden', 'Use the selected seed/tool on a tile, just like a tile click.', coord);
  def('garden_harvest', 'garden', 'Harvest or uproot one plant; immature plants do not unlock seeds.', coord);
  def('garden_harvest_all', 'garden', 'Harvest plants with optional seed, maturity and mortality filters.', {seed_index: Object.assign({}, seed, {optional: true}), mature_only: bool('Only mature plants.', {default: false}), mortal_only: bool('Preserve immortal plants.', {default: false})});
  def('garden_soil', 'garden', 'Change soil, respecting Farm count, freeze state and the soil cooldown.', {soil_id: num('Soil ID.', 0, 1000)}, {aliases: {tipo: 'soil_id'}});
  def('garden_freeze', 'garden', 'Freeze or unfreeze through the native garden tool, including Cheapcap side effects.', {frozen: checked});
  def('garden_sacrifice', 'garden', 'Sacrifice a complete seed collection and garden for the normal lump reward.', {confirm: confirm}, {destructive: true});
  def('garden_recharge', 'garden', 'Spend 1 lump for the native garden tick/mutation burst and soil cooldown reset.');
  var good = str('Good symbol, internal key, displayed name, or numeric ID as text.');
  ['buy', 'sell'].forEach(function (op) {
    def('stock_' + op, 'stock', op + ' stock using normal capacity, overhead and per-tick trade limits. 10000 is the game max/all sentinel.', {ticker: good, quantity: num('Units, or 10000 for max/all.', 1, 10000, {default: 1})}, {aliases: {quantidade: 'quantity'}});
  });
  def('stock_sell_all', 'stock', 'Sell all tradable holdings. Reports blocked goods separately; trades are not atomic.');
  def('stock_buy_broker', 'stock', 'Hire brokers using the native button, costs and broker cap.', {count: num('Brokers to hire.', 1, 1000, {default: 1})});
  def('stock_upgrade_office', 'stock', 'Upgrade the office once, sacrificing the required cursors and checking cursor level.');
  def('stock_take_loan', 'stock', 'Take an unlocked loan with the real downpayment, bonus and later interest.', {loan_id: num('Loan number, 1 to 3.', 1, 3)});
  def('stock_graph', 'stock', 'Set stock graph display options.', {lines: bool('Show lines.', {optional: true}), colors: bool('Use colorful graph.', {optional: true})}, {atLeastOne: ['lines', 'colors']});
  def('stock_visibility', 'stock', 'Show/hide a good on the stock graph.', {ticker: good, visible: checked});
  def('upgrade_dragon', 'dragon', 'Advance one dragon egg/training level or bake the dragon cookie, paying the native cookie/building sacrifice.');
  def('dragon_set_aura', 'dragon', 'Select an unlocked aura and confirm its native sacrifice. Secondary slot requires the final dragon level.', {aura_id: num('Aura ID.', 0, 1000), slot: num('0 primary, 1 secondary.', 0, 1, {default: 0})});
  def('dragon_pet', 'dragon', 'Pet Krumblor with native random drops; requires Pet the dragon.', {count: num('Pet attempts.', 1, 1000, {default: 1})});
  def('special_menu', 'ui', 'Show the dragon or Santa menu, or close the special menu.', {tab: choice('Menu.', ['dragon', 'santa', 'close'])});
  def('upgrade_santa', 'santa', 'Upgrade Santa once using normal cookies and random gift drops.');
  def('wrinkler_pop', 'cookies', 'Pop a specific active wrinkler, triggering normal digestion payout and drops.', {id: num('Wrinkler ID.', 0, 10000)});
  def('wrinkler_click', 'cookies', 'Poke a wrinkler once, applying normal click damage and the Wrinkler poker click count.', {id: num('Wrinkler ID.', 0, 10000)});
  def('wrinkler_pop_all', 'cookies', 'Pop active wrinklers, optionally preserving shiny wrinklers.', {include_shiny: bool('Also pop shiny wrinklers.', {default: false})});
  def('set_season', 'seasons', 'Buy the corresponding season biscuit. Empty string cancels the current purchased season.', {season: choice('Season.', ['christmas', 'valentines', 'fools', 'easter', 'halloween', ''])}, {aliases: {nome: 'season'}});
  def('ascend', 'prestige', 'Begin the native ascension animation. Wait for on_ascend before buying heavenly upgrades.', {confirm: confirm}, {aliases: {confirmar: 'confirm'}, destructive: true});
  def('buy_heavenly_upgrade', 'prestige', 'Purchase a heavenly upgrade during ascension; checks parents, visibility and chips.', upgrade, {atLeastOne: ['id', 'name']});
  def('ascension_mode', 'prestige', 'Choose the next run mode while in the ascension screen.', {mode: num('Mode ID from the catalog (0 normal, 1 Born again).', 0, 100)});
  def('permanent_slot', 'prestige', 'Assign an eligible purchased upgrade to an unlocked permanent slot while ascended; -1 clears it.', {slot: num('Slot 0 to 4.', 0, 4), upgrade_id: num('Eligible upgrade ID or -1.', -1, 100000)});
  def('reincarnate', 'prestige', 'Reincarnate from the ascension screen with the selected mode and permanent upgrades.');
  def('ascension_view', 'ui', 'Pan/recenter and zoom the heavenly upgrade tree.', {x: field('number', 'Target horizontal offset.', {minimum: -100000, maximum: 100000, optional: true}), y: field('number', 'Target vertical offset.', {minimum: -100000, maximum: 100000, optional: true}), zoom: field('number', 'Target zoom.', {minimum: 0.1, maximum: 2, optional: true}), recenter: bool('Recenter the tree.', {default: false})});
  def('rename_bakery', 'settings', 'Rename the bakery using native name validation.', {name: str('Bakery name.', {maxLength: 100})});
  def('toggle_pref', 'settings', 'Toggle a known game preference with its UI side effects.', {name: name}, {aliases: {nome: 'name'}});
  def('set_pref', 'settings', 'Set a known game preference with its UI side effects.', {name: name, enabled: checked});
  def('set_volume', 'settings', 'Set SFX, music volume or music filter.', {channel: choice('Audio channel.', ['sfx', 'music', 'filter']), value: field('number', 'Percent.', {minimum: 0, maximum: 100})}, {aliases: {tipo: 'channel', valor: 'value'}});
  def('set_language', 'settings', 'Select an installed game language through the native language screen; saves and schedules a reload.', {language: name});
  def('show_menu', 'ui', 'Open options, stats, info or close the main menu.', {menu: choice('Menu.', ['prefs', 'stats', 'log', ''])});
  def('dismiss_notifications', 'ui', 'Dismiss a notification by ID, or all notifications when ID is omitted.', {id: id});
  def('prompt_respond', 'ui', 'Click one option in the current game prompt. expected_prompt must match the prompt token returned by inspect_ui to prevent stale confirmations.', {option: num('Prompt option index.', 0, 100), expected_prompt: str('Current prompt token.', {maxLength: 128})});
  def('prompt_cancel', 'ui', 'Close the current dismissible prompt without accepting it.');
  def('inspect_ui', 'ui', 'Read visible interactive elements, text, fields, current prompt and selectors directly in the renderer.', {offset: num('Pagination offset.', 0, 100000, {default: 0}), limit: num('Maximum elements.', 1, 1000, {default: 200})}, {readOnly: true});
  def('ui_click', 'ui', 'Click an observed visible in-game control, including selector and achievement controls. Dispatches native DOM events, not arbitrary JavaScript.', {target: target, shift: bool('Hold Shift for this click.', {default: false}), ctrl: bool('Hold Ctrl for this click.', {default: false})});
  def('ui_set_input', 'ui', 'Fill a visible game input, text area, slider or select and dispatch its input/change events.', {target: target, value: str('New field value.', {minLength: 0, maxLength: 4000000})});
  def('ui_scroll', 'ui', 'Scroll an observed game panel.', {target: target, x: field('number', 'Horizontal pixels.', {minimum: -1000000, maximum: 1000000, default: 0}), y: field('number', 'Vertical pixels.', {minimum: -1000000, maximum: 1000000, default: 0})});
  def('ui_drag', 'ui', 'Drag between two observed controls with mouse events (for UI widgets).', {from: target, to: target});
  def('ui_pointer', 'ui', 'Move/press/release/click a point inside a visible game element or canvas. Combine with get_game_screenshot for canvas-only interactions.', {target: target, event: choice('Mouse operation.', ['move', 'down', 'up', 'click']), x: field('number', 'Horizontal fraction of element width.', {minimum: 0, maximum: 1}), y: field('number', 'Vertical fraction of element height.', {minimum: 0, maximum: 1}), shift: bool('Hold Shift.', {default: false}), ctrl: bool('Hold Ctrl.', {default: false})});
  def('gift_create', 'gifts', 'Wrap a gift using the native game UI. Returns the shareable code without sending it to anyone.', {cookies: num('Cookies in the gift.', 1, 1000, {default: 1}), message: str('Gift message.', {minLength: 0, maxLength: 100, default: ''}), design: num('Gift box design ID.', 0, 1000, {default: 0})});
  def('gift_redeem', 'gifts', 'Redeem a gift code through the native validator; respects unlocks, expiration and cooldown.', {code: str('Gift code.', {maxLength: 10000})});
  def('force_save', 'save', 'Save the current game using its configured local/cloud saving behavior.');
  def('export_save', 'save', 'Return a fresh native export save string.', {}, {readOnly: true});
  def('import_save', 'save', 'Import a native Cookie Clicker save, replacing current progress. Returns a backup export of the previous state.', {save: str('Native exported save string.', {maxLength: 4000000}), confirm: confirm}, {destructive: true});
  def('hard_reset', 'save', 'Wipe in-game progress through the native hard reset. Returns a backup export first.', {confirm: confirm}, {destructive: true});

  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.type !== 'string' || !Object.prototype.hasOwnProperty.call(actions, input.type)) throw new Error('Unknown action type. Use get_capabilities.');
    var spec = actions[input.type], values = Object.create(null), out = {type: input.type};
    Object.keys(input).forEach(function (key) {
      if (key === 'type' || key === '_bridge') return;
      var canonical = spec.aliases && spec.aliases[key] || key;
      if (!Object.prototype.hasOwnProperty.call(spec.properties, canonical)) throw new Error('Unknown parameter: ' + key);
      if (Object.prototype.hasOwnProperty.call(values, canonical)) throw new Error('Duplicate parameter: ' + canonical);
      values[canonical] = input[key];
    });
    Object.keys(spec.properties).forEach(function (key) {
      var f = spec.properties[key], v = values[key];
      if (v === undefined && f.default !== undefined) v = f.default;
      if (v === undefined) { if (!f.optional) throw new Error('Required parameter: ' + key); return; }
      var numeric = f.type === 'number' || f.type === 'integer';
      if (numeric ? typeof v !== 'number' || !Number.isFinite(v) || (f.type === 'integer' && !Number.isSafeInteger(v)) : typeof v !== f.type) throw new Error('Invalid type for ' + key);
      if (f.enum && f.enum.indexOf(v) === -1) throw new Error('Invalid choice for ' + key);
      if (f.const !== undefined && v !== f.const) throw new Error(key + ' must be ' + f.const);
      if (numeric && (v < f.minimum || v > f.maximum)) throw new Error('Out of range: ' + key);
      if (typeof v === 'string' && ((f.minLength !== undefined && v.length < f.minLength) || (f.maxLength !== undefined && v.length > f.maxLength))) throw new Error('Invalid length: ' + key);
      out[key] = v;
    });
    if (spec.atLeastOne && !spec.atLeastOne.some(function (key) { return out[key] !== undefined; })) throw new Error('Provide at least one of: ' + spec.atLeastOne.join(', '));
    return out;
  }
  return {version: VERSION, actions: actions, validate: validate, unsupported: [
    {feature: 'stock_opportunities_and_refill', reason: 'The installed vanilla stock market contains only placeholder text; no opportunity gameplay or refill event is implemented.'},
    {feature: 'external_platform_and_arbitrary_mod_code', reason: 'Steam account operations, OS dialogs and arbitrary third-party mod APIs are outside the vanilla game control contract. Visible in-game controls are available through UI tools.'}
  ]};
});
