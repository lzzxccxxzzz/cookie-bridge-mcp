(function (root, factory) {
  if (!root.document && typeof module === 'object' && module.exports) module.exports = factory(require('./control-schema.js'));
  else root.CookieBridgeControl = factory(root.CookieBridgeSchema);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (schema) {
  'use strict';

  function create(Game, env) {
    env = env || globalThis;
    var doc = env.document, handlers = Object.create(null);
    var refs = new Map(), refIds = new WeakMap(), refSerial = 0, promptSerial = 0, promptNode = null;
    var epoch = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    var aliases = {lumpConfirm: 'askLumps', screenReader: 'screenreader', fastNotes: 'notifs', scary: 'notScary'};
    function fail(code, message) { var e = new Error(message); e.code = code; throw e; }
    function need(condition, message, code) { if (!condition) fail(code || 'precondition_failed', message); }
    function call(object, method) {
      need(object && typeof object[method] === 'function', 'Game method unavailable: ' + method, 'unsupported_version');
      return object[method].apply(object, Array.prototype.slice.call(arguments, 2));
    }
    function find(list, value) {
      var text = String(value).toLowerCase();
      return Object.values(list || {}).find(function (x) { return x && [x.id, x.name, x.dname, x.key, x.symbol].some(function (v) { return v !== undefined && String(v).toLowerCase() === text; }); });
    }
    function building(name) { var b = find(Game.ObjectsById, name); need(b, 'Building not found: ' + name, 'not_found'); return b; }
    function upgrade(a) {
      var u = a.id !== undefined ? (Game.UpgradesById || [])[a.id] : find(Game.UpgradesById, a.name);
      need(u, 'Upgrade not found.', 'not_found');
      if (a.id !== undefined && a.name !== undefined) need(find([u], a.name), 'Upgrade ID and name refer to different upgrades.');
      return u;
    }
    function mini(name) {
      var b = building(name);
      need(b.level > 0 && b.minigame && b.minigameLoaded, name + ' minigame is not loaded/unlocked.', 'locked');
      need(b.amount > 0, name + ' requires at least one building.');
      return b.minigame;
    }
    function owned(name) { return !!call(Game, 'Has', name); }
    function playing() { need(!Game.OnAscend && !Game.AscendTimer && !Game.ReincarnateTimer, 'Wait until the normal run is active.', 'wrong_phase'); }
    function ascended() { need(Game.OnAscend && !Game.AscendTimer && !Game.ReincarnateTimer, 'Wait until the ascension screen is ready.', 'wrong_phase'); }
    function freePrompt() { need(!Game.promptOn, 'Resolve the existing prompt first with prompt_respond or prompt_cancel.', 'prompt_open'); }
    function visible(el) {
      if (!el || !el.isConnected || !el.getClientRects().length) return false;
      var css = env.getComputedStyle(el);
      return css.display !== 'none' && css.visibility !== 'hidden' && css.visibility !== 'collapse';
    }
    function element(target, allowHidden) {
      var el = typeof target === 'string' ? (refs.get(target) || doc.getElementById(target)) : target;
      need(el && el.isConnected, 'UI element is missing or stale. Run inspect_ui again.', 'stale_target');
      need(!el.closest('#cookiebridge-panel,#cookiebridge-toggle'), 'Bridge administration is not a game control.', 'protected_target');
      var link = el.closest('a[href]'), href = link && link.getAttribute('href');
      need(!href || href.startsWith('#') || href.startsWith('javascript:'), 'External navigation is not an in-game control.', 'protected_target');
      need(el.type !== 'file' && el.type !== 'password', 'Sensitive/system fields are not game controls.', 'protected_target');
      need(allowHidden || visible(el), 'UI element is not visible.', 'not_visible');
      return el;
    }
    function click(target, allowHidden) {
      var el = element(target, allowHidden);
      // Native minigame callbacks recheck live prerequisites. Their CSS may be
      // stale while the panel is closed; UI tools still reject disabled controls.
      need(!el.disabled && (allowHidden || (el.getAttribute('aria-disabled') !== 'true' && !el.classList.contains('disabled'))), 'UI control is disabled.');
      el.dispatchEvent(new env.MouseEvent('click', {bubbles: true, cancelable: true, view: env, button: 0, shiftKey: !!Game.keys[16], ctrlKey: !!Game.keys[17]}));
    }
    function modifiers(a, fn) {
      var shift = Game.keys[16], ctrl = Game.keys[17];
      try { Game.keys[16] = !!a.shift; Game.keys[17] = !!a.ctrl; return fn(); }
      finally { Game.keys[16] = shift; Game.keys[17] = ctrl; }
    }
    function input(target, value) {
      var el = element(target);
      need(['INPUT', 'TEXTAREA', 'SELECT'].indexOf(el.tagName) !== -1 && !el.readOnly && !el.disabled, 'Target is not an editable field.');
      need(['file', 'password'].indexOf(el.type) === -1, 'This field type is not supported.');
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = ['true', '1', 'on'].indexOf(value) !== -1;
      else el.value = value;
      el.dispatchEvent(new env.Event('input', {bubbles: true}));
      el.dispatchEvent(new env.Event('change', {bubbles: true}));
      el.dispatchEvent(new env.KeyboardEvent('keyup', {bubbles: true}));
      return {value: el.value, checked: el.checked};
    }
    function prompt() {
      if (!Game.promptOn) { promptNode = null; return null; }
      var node = Game.promptL && Game.promptL.firstElementChild;
      if (node !== promptNode) { promptNode = node; promptSerial++; }
      return {token: 'prompt-' + epoch + '-' + promptSerial, text: (Game.promptL.textContent || '').slice(0, 20000), dismissible: !Game.promptNoClose,
        options: Array.from(Game.promptL.querySelectorAll('[id^="promptOption"]')).filter(visible).map(function (el) { return {index: Number(el.id.replace('promptOption', '')), text: el.textContent, disabled: el.classList.contains('disabled')}; })};
    }
    function confirmFirst() {
      var p = prompt(); need(p && p.options.some(function (o) { return o.index === 0 && !o.disabled; }), 'Expected confirmation option is unavailable.');
      click('promptOption0');
    }
    function spendLump(fn) {
      freePrompt(); var previous = Game.prefs.askLumps;
      try { Game.prefs.askLumps = 0; return fn(); } finally { Game.prefs.askLumps = previous; }
    }
    function refill(M, target, condition) {
      need(condition !== false, 'This resource is already full.');
      need(Game.lumps >= 1, 'At least one sugar lump is required.', 'insufficient_resources');
      need(call(Game, 'canRefillLump'), 'Shared sugar-lump refill is on cooldown.', 'cooldown');
      var before = Game.lumps;
      spendLump(function () { click(target, true); });
      need(Game.lumps < before, 'The game did not spend a lump.');
      return {lumps_spent: before - Game.lumps, refill_remaining_frames: Game.lumpRefill};
    }
    function refresh() { Game.recalculateGains = 1; Game.upgradesToRebuild = 1; Game.storeToRefresh = 1; }
    function uiRef(el) {
      var ref = refIds.get(el);
      if (!ref) { ref = 'cb-element-' + epoch + '-' + (++refSerial); refIds.set(el, ref); refs.set(ref, el); }
      return ref;
    }
    function inspectUI(a) {
      refs.forEach(function (el, key) { if (!el.isConnected) refs.delete(key); });
      var candidates = Array.from(doc.querySelectorAll('button,a,input,textarea,select,[id],[onclick],[onmousedown],[role="button"],[tabindex],.crate,.gardenSeed,.gardenTile,.templeGod,.bankButton,.langSelectButton'));
      var list = candidates.filter(function (el) { return visible(el) && !el.closest('#cookiebridge-panel,#cookiebridge-toggle'); });
      return {menu: Game.onMenu, prompt: prompt(), choice_selector: Game.choiceSelectorOn, total: list.length, offset: a.offset,
        elements: list.slice(a.offset, a.offset + a.limit).map(function (el) {
          var r = el.getBoundingClientRect();
          return {ref: uiRef(el), id: el.id || null, tag: el.tagName.toLowerCase(), text: (el.innerText || el.textContent || el.getAttribute('aria-label') || el.title || '').slice(0, 1000),
            type: el.type, value: el.type === 'password' ? undefined : el.value, checked: el.checked, read_only: !!el.readOnly, disabled: !!el.disabled || el.classList.contains('disabled'),
            bounds: {x: r.x, y: r.y, width: r.width, height: r.height}};
        })};
    }

    handlers.click_cookie = async function (a) {
      var before = Game.cookieClicks;
      for (var i = 0; i < a.count; i++) {
        var wait = Math.max(0, 21 - (Date.now() - Game.lastClick));
        if (wait) await new Promise(function (resolve) { env.setTimeout(resolve, wait); });
        playing(); call(Game, 'ClickCookie');
      }
      return {attempted: a.count, clicks_registered: Game.cookieClicks - before};
    };
    function tradeBuilding(a, sell) {
      var b = building(a.name); need(!b.locked || sell, 'Building is locked.', 'locked');
      var before = b.amount, cookies = Game.cookies, mode = Game.buyMode;
      need(sell ? before > 0 : Game.cookies >= call(b, 'getPrice'), sell ? 'No buildings to sell.' : 'Not enough cookies.', 'insufficient_resources');
      try { if (!sell) Game.buyMode = 1; call(b, sell ? 'sell' : 'buy', a.quantity); }
      finally { Game.buyMode = mode; Game.storeToRefresh = 1; }
      need(b.amount !== before, 'The game did not trade any buildings.');
      return {name: b.name, before: before, after: b.amount, units: Math.abs(b.amount - before), cookie_delta: Game.cookies - cookies};
    }
    handlers.buy_building = function (a) { return tradeBuilding(a, false); };
    handlers.buy_building_max = function (a) { return tradeBuilding({name: a.name, quantity: a.limit}, false); };
    handlers.sell_building = function (a) { return tradeBuilding(a, true); };
    handlers.sell_all_of_type = function (a) { return tradeBuilding({name: a.name, quantity: building(a.name).amount}, true); };
    handlers.sell_all_buildings = function () { return {sales: Game.ObjectsById.slice().reverse().filter(function (b) { return b.amount > 0; }).map(function (b) { return handlers.sell_all_of_type({name: b.name}); })}; };
    handlers.sugarlump_use = function (a) {
      var b = building(a.name), before = b.level, lumps = Game.lumps;
      need(call(Game, 'canLumps') && lumps >= b.level + 1, 'Level-up requires ' + (b.level + 1) + ' sugar lumps.', 'insufficient_resources');
      spendLump(function () { call(b, 'levelUp'); });
      need(b.level === before + 1, 'Building did not level up.');
      return {name: b.name, level: b.level, lumps_spent: lumps - Game.lumps};
    };
    handlers.mute_building = function (a) { var b = building(a.name); need(b.id !== 0, 'Cursor has no minimizable row.'); call(b, 'mute', a.muted === undefined ? !b.muted : a.muted); return {muted: !!b.muted}; };
    handlers.minigame_open = function (a) { var b = building(a.name); mini(b.name); call(b, 'switchMinigame', a.open); return {open: !!b.onMinigame}; };
    handlers.store_mode = function (a) { call(Game, 'storeBulkButton', a.mode === 'buy' ? 0 : 1); return {mode: Game.buyMode}; };
    handlers.store_bulk = function (a) { need(a.quantity !== -1 || Game.buyMode === -1, 'All is only available in sell mode.'); call(Game, 'storeBulkButton', {1: 2, 10: 3, 100: 4, '-1': 5}[a.quantity]); return {quantity: Game.buyBulk}; };
    function buyUpgrade(u) {
      freePrompt();
      need(u.pool !== 'prestige' && u.pool !== 'prestigeDecor', 'Use buy_heavenly_upgrade.');
      need(u.unlocked, 'Upgrade is locked.', 'locked');
      need(!u.bought || u.clickFunction || u.activateFunction || u.choicesFunction, 'Upgrade is already owned.');
      if (!u.bought && !u.choicesFunction) need(call(u, 'canBuy'), 'Upgrade cannot currently be afforded or purchased.', 'insufficient_resources');
      var cookies = Game.cookies, bought = u.bought, season = Game.season;
      var result = call(u, 'buy');
      if (Game.promptOn) return {id: u.id, awaiting_confirmation: true, prompt: prompt()};
      need(result || bought !== u.bought || season !== Game.season || u.activateFunction || u.choicesFunction, 'Upgrade action was rejected by the game.');
      return {id: u.id, name: u.name, bought: !!u.bought, cookie_delta: Game.cookies - cookies, choices: choices(u)};
    }
    handlers.buy_upgrade = function (a) { return buyUpgrade(upgrade(a)); };
    handlers.store_buy_all = function () { freePrompt(); need(owned('Inspired checklist'), 'Inspired checklist is required.', 'locked'); var before = Game.UpgradesOwned; call(Game, 'storeBuyAll'); return {upgrades_bought: Game.UpgradesOwned - before}; };
    handlers.upgrade_vault = function (a) {
      var u = upgrade(a); need(owned('Inspired checklist'), 'Inspired checklist is required.', 'locked');
      need(['toggle', 'tech', 'prestige', 'prestigeDecor'].indexOf(u.pool) === -1, 'This upgrade cannot be vaulted.');
      call(u, a.vaulted ? 'vault' : 'unvault'); Game.upgradesToRebuild = 1; return {vaulted: call(u, 'isVaulted')};
    };
    function choices(u) {
      if (!u.choicesFunction) return null;
      var list = call(u, 'choicesFunction');
      if (typeof list === 'string') return {kind: 'html', next_action: 'inspect_ui'};
      return {kind: 'list', options: list.map(function (x, i) { return {id: i, name: x.name, selected: !!x.selected}; })};
    }
    handlers.upgrade_choices = function (a) { var u = upgrade(a); need(u.unlocked && u.choicesFunction, 'Selector is locked or unavailable.'); freePrompt(); if (Game.choiceSelectorOn !== u.id) call(u, 'buy'); return {id: u.id, choices: choices(u), ui: inspectUI({offset: 0, limit: 200})}; };
    handlers.upgrade_choose = function (a) {
      freePrompt();
      var u = upgrade(a); need(u.unlocked && u.choicesFunction && u.choicesPick, 'Selector is locked or unavailable.');
      var list = call(u, 'choicesFunction'); need(Array.isArray(list) && list[a.choice_id], 'Choice is unavailable; HTML selectors require UI tools.');
      call(u, 'choicesPick', a.choice_id); Game.choiceSelectorOn = -1; call(u, 'buy'); return {id: u.id, choices: choices(u)};
    };
    handlers.switch_set = function (a) {
      var switches = {golden: ['Golden switch [off]', 'Golden switch [on]'], veil: ['Shimmering veil [off]', 'Shimmering veil [on]'], covenant: ['Elder Covenant', 'Revoke Elder Covenant']};
      var names = switches[a.switch], desired = names[a.enabled ? 0 : 1];
      if (owned(names[0]) === a.enabled) return {enabled: a.enabled, unchanged: true};
      return buyUpgrade(upgrade({name: desired}));
    };
    handlers.click_shimmer = function (a) {
      var s = a.shimmer_id !== undefined ? (Game.shimmers || []).find(function (s) { return s.id === a.shimmer_id; }) : (Game.shimmers || [])[a.index];
      need(s, 'Shimmer has expired or does not exist.', 'not_found'); need(!a.expected_type || s.type === a.expected_type, 'Shimmer type changed.', 'stale_target');
      var result = {id: s.id, type: s.type, wrath: !!s.wrath}; call(s, 'pop'); return result;
    };
    handlers.click_shimmers = function (a) {
      var selected = (Game.shimmers || []).filter(function (s) { return a.kind === 'all' || (a.kind === 'wrath' ? s.type === 'golden' && s.wrath : s.type === a.kind && (a.kind !== 'golden' || !s.wrath)); });
      return {clicked: selected.map(function (s) { var id = s.id; call(s, 'pop'); return id; })};
    };
    handlers.click_ticker = function (a) {
      var effect = Game.TickerEffect;
      need(!a.fortune_only || effect && effect.type === 'fortune', 'No fortune is currently active.', 'not_found');
      click(Game.tickerL); return {fortune_collected: !!(effect && effect.type === 'fortune'), ticker_clicks: Game.TickerClicks};
    };
    handlers.click_tiny_cookie = function () { if (Game.onMenu !== 'stats') call(Game, 'ShowMenu', 'stats'); call(Game, 'ClickTinyCookie'); return {won: call(Game, 'HasAchiev', 'Tiny cookie')}; };
    handlers.harvest_lump = function () {
      need(call(Game, 'canLumps'), 'Sugar lumps are locked.', 'locked'); var age = Date.now() - Game.lumpT;
      need(age >= Game.lumpMatureAge && age < Game.lumpOverripeAge, 'Lump is not manually harvestable; wait for maturity or the automatic harvest.');
      var before = Game.lumps; call(Game, 'clickLump'); return {lumps_gained: Game.lumps - before, next_type: Game.lumpCurrentType};
    };
    handlers.cast_spell = function (a) { var M = mini('Wizard tower'), s = M.spellsById[a.spell_index]; need(s, 'Spell not found.', 'not_found'); need(M.magic >= call(M, 'getSpellCost', s), 'Not enough magic.', 'insufficient_resources'); var before = M.magic; need(call(M, 'castSpell', s), 'Spell was rejected.'); return {spell: s.name, magic_spent: before - M.magic, magic: M.magic}; };
    handlers.grimoire_recharge = function () { var M = mini('Wizard tower'); return refill(M, M.lumpRefill, M.magic < M.magicM); };
    function slotGod(M, god, slot) {
      need(god, 'Spirit not found.', 'not_found'); if (god.slot === slot) return {unchanged: true};
      need(slot === -1 || M.swaps >= 1, 'No worship swaps available.', 'insufficient_resources');
      var previousHover = M.slotHovered;
      try { call(M, 'dragGod', god); M.slotHovered = slot; call(M, 'dropGod'); }
      finally { M.slotHovered = previousHover; }
      need(god.slot === slot, 'Spirit was not moved.'); return {slots: M.slot.slice(), swaps: M.swaps};
    }
    handlers.pantheon_set = function (a) { var M = mini('Temple'); return slotGod(M, M.godsById[a.spirit_index], a.slot_index); };
    handlers.pantheon_remove = function (a) { var M = mini('Temple'); need(M.slot[a.slot_index] >= 0, 'Slot is already empty.'); return slotGod(M, M.godsById[M.slot[a.slot_index]], -1); };
    handlers.pantheon_recharge = function () { var M = mini('Temple'); return refill(M, M.lumpRefill, M.swaps < 3); };
    function tile(M, a) { need(call(M, 'isTileUnlocked', a.x, a.y), 'Garden tile is locked at this Farm level.', 'locked'); return M.plot[a.y][a.x]; }
    function plant(M, index) { var p = M.plantsById[index]; need(p && p.unlocked && p.plantable, 'Seed is locked or not plantable.', 'locked'); return p; }
    handlers.garden_select_seed = function (a) { var M = mini('Farm'); if (a.seed_index >= 0) plant(M, a.seed_index); M.seedSelected = a.seed_index; call(M, 'buildPanel'); return {selected: M.seedSelected}; };
    handlers.garden_plant = function (a) {
      var M = mini('Farm'), p = plant(M, a.seed_index); need(tile(M, a)[0] === 0, 'Tile is occupied.'); need(call(M, 'canPlant', p), 'Not enough cookies to plant.', 'insufficient_resources');
      need(call(M, 'useTool', p.id, a.x, a.y), 'Planting was rejected.'); M.toCompute = true; return {x: a.x, y: a.y, tile: M.plot[a.y][a.x].slice()};
    };
    handlers.garden_click_tile = function (a) { var M = mini('Farm'); tile(M, a); if (M.seedSelected >= 0) plant(M, M.seedSelected); call(M, 'clickTile', a.x, a.y); return {tile: M.plot[a.y][a.x].slice()}; };
    handlers.garden_harvest = function (a) { var M = mini('Farm'); need(tile(M, a)[0] > 0, 'Tile is empty.'); need(call(M, 'harvest', a.x, a.y, 1), 'Harvest was rejected.'); return {tile: M.plot[a.y][a.x].slice()}; };
    handlers.garden_harvest_all = function (a) { var M = mini('Farm'), p = a.seed_index === undefined ? null : M.plantsById[a.seed_index]; need(a.seed_index === undefined || p, 'Seed not found.'); var before = M.harvestsTotal; call(M, 'harvestAll', p, a.mature_only, a.mortal_only); return {mature_harvests: M.harvestsTotal - before}; };
    handlers.garden_soil = function (a) {
      var M = mini('Farm'), s = M.soilsById[a.soil_id]; need(s, 'Soil not found.', 'not_found'); if (M.soil === s.id) return {unchanged: true};
      need(!M.freeze && Date.now() >= M.nextSoil, 'Garden is frozen or soil change is on cooldown.', 'cooldown'); need(M.parent.amount >= s.req, 'Not enough Farms for this soil.', 'locked');
      click('gardenSoil-' + s.id, true); need(M.soil === s.id, 'Soil change was rejected.'); return {soil: M.soil, next_soil: M.nextSoil};
    };
    handlers.garden_freeze = function (a) { var M = mini('Farm'); if (!!M.freeze !== a.frozen) click('gardenTool-' + M.tools.freeze.id, true); need(!!M.freeze === a.frozen, 'Freeze was rejected.'); return {frozen: !!M.freeze}; };
    handlers.garden_sacrifice = function () { var M = mini('Farm'); need(M.plantsUnlockedN >= M.plantsN, 'Complete the seed collection first.', 'locked'); freePrompt(); call(M, 'askConvert'); confirmFirst(); return {sacrifices: M.convertTimes, lumps: Game.lumps}; };
    handlers.garden_recharge = function () { var M = mini('Farm'); return refill(M, M.lumpRefill); };

    function good(M, name) { var g = find(M.goodsById, name) || M.goodsById.find(function (g) { return g.building.name.toLowerCase() === String(name).toLowerCase(); }); need(g, 'Stock good not found: ' + name, 'not_found'); need(g.active !== false && g.active !== 0, 'Good is not unlocked.', 'locked'); return g; }
    function tradeGood(a, sell) { var M = mini('Bank'), g = good(M, a.ticker), before = g.stock; need(call(M, sell ? 'sellGood' : 'buyGood', g.id, a.quantity), 'Trade rejected: check funds, capacity, and buy/sell direction during this tick.'); return {id: g.id, before: before, after: g.stock, units: Math.abs(g.stock - before), profit: M.profit}; }
    handlers.stock_buy = function (a) { return tradeGood(a, false); };
    handlers.stock_sell = function (a) { return tradeGood(a, true); };
    handlers.stock_sell_all = function () { var M = mini('Bank'), sold = [], blocked = []; M.goodsById.filter(function (g) { return g.stock > 0; }).forEach(function (g) { if (call(M, 'sellGood', g.id, 10000)) sold.push(g.id); else blocked.push(g.id); }); return {sold: sold, blocked: blocked}; };
    handlers.stock_buy_broker = function (a) { var M = mini('Bank'), before = M.brokers; for (var i = 0; i < a.count && M.brokers < call(M, 'getMaxBrokers') && Game.cookies >= call(M, 'getBrokerPrice'); i++) click('bankBrokersBuy', true); need(M.brokers > before, 'Cannot afford another broker or broker cap reached.'); return {hired: M.brokers - before, brokers: M.brokers}; };
    handlers.stock_upgrade_office = function () { var M = mini('Bank'), before = M.officeLevel, cost = M.offices[before].cost, cursor = building('Cursor'); need(cost && cursor.amount >= cost[0] && cursor.level >= cost[1], 'Office maxed or cursor requirements not met.'); click('bankOfficeUpgrade', true); need(M.officeLevel > before, 'Office upgrade was rejected.'); return {office_level: M.officeLevel, cursors_sacrificed: cost[0]}; };
    handlers.stock_take_loan = function (a) { var M = mini('Bank'); need(M.officeLevel >= [0, 1, 3, 5][a.loan_id], 'Office level does not unlock this loan.', 'locked'); need(call(M, 'takeLoan', a.loan_id), 'Loan or its interest is already active.'); return {loan_id: a.loan_id}; };
    handlers.stock_graph = function (a) { var M = mini('Bank'); if (a.lines !== undefined && !!M.graphLines !== a.lines) click('bankGraphLines', true); if (a.colors !== undefined && !!M.graphCols !== a.colors) click('bankGraphCols', true); return {lines: !!M.graphLines, colors: !!M.graphCols}; };
    handlers.stock_visibility = function (a) { var M = mini('Bank'), g = good(M, a.ticker); if (!!g.hidden === a.visible) modifiers({}, function () { click('bankGood-' + g.id + '-viewHide', true); }); return {visible: !g.hidden}; };

    handlers.special_menu = function (a) { if (a.tab === 'close') { call(Game, 'ToggleSpecialMenu', 0); return {open: false}; } need(owned(a.tab === 'dragon' ? 'A crumbly egg' : 'A festive hat'), 'Special character is not unlocked.', 'locked'); Game.specialTab = a.tab; call(Game, 'ToggleSpecialMenu', 1); return {tab: Game.specialTab}; };
    handlers.upgrade_dragon = function () { need(owned('A crumbly egg'), 'Buy A crumbly egg first.', 'locked'); var before = Game.dragonLevel; need(before < Game.dragonLevels.length - 1 && Game.dragonLevels[before].cost(), 'Dragon upgrade unavailable or cannot be afforded.'); handlers.special_menu({tab: 'dragon'}); call(Game, 'UpgradeDragon'); need(Game.dragonLevel > before, 'Dragon did not upgrade.'); return {level: Game.dragonLevel}; };
    handlers.dragon_set_aura = function (a) {
      need(owned('A crumbly egg') && Game.dragonAuras[a.aura_id] && Game.dragonLevel >= a.aura_id + 4, 'Aura is not unlocked.', 'locked');
      need(a.slot === 0 || Game.dragonLevel === Game.dragonLevels.length - 1, 'Secondary aura requires the final dragon level.', 'locked');
      need(a.aura_id === 0 || a.aura_id !== (a.slot === 0 ? Game.dragonAura2 : Game.dragonAura), 'Both slots cannot use the same aura.');
      freePrompt(); call(Game, 'SelectDragonAura', a.slot); call(Game, 'SetDragonAura', a.aura_id, a.slot); confirmFirst(); refresh();
      return {primary: Game.dragonAura, secondary: Game.dragonAura2};
    };
    handlers.dragon_pet = function (a) { need(owned('Pet the dragon') && Game.dragonLevel >= 4, 'Pet the dragon and a hatched dragon are required.', 'locked'); handlers.special_menu({tab: 'dragon'}); for (var i = 0; i < a.count; i++) call(Game, 'ClickSpecialPic'); return {attempts: a.count, drops: ['Dragon scale', 'Dragon claw', 'Dragon fang', 'Dragon teddy bear'].map(function (n) { return {name: n, unlocked: !!Game.Upgrades[n].unlocked}; })}; };
    handlers.upgrade_santa = function () { need(owned('A festive hat'), 'Buy A festive hat first.', 'locked'); var before = Game.santaLevel; need(before < Game.santaLevels.length - 1 && Game.cookies > Math.pow(before + 1, before + 1), 'Santa maxed or not enough cookies.'); handlers.special_menu({tab: 'santa'}); call(Game, 'UpgradeSanta'); need(Game.santaLevel > before, 'Santa did not upgrade.'); return {level: Game.santaLevel}; };
    handlers.wrinkler_pop = function (a) { var w = (Game.wrinklers || [])[a.id]; need(w && w.phase > 0 && w.hp > 0, 'Wrinkler is not active.', 'not_found'); w.hp = 0; return {id: a.id, payout_pending: true}; };
    handlers.wrinkler_click = function (a) { var w = (Game.wrinklers || [])[a.id]; need(w && w.phase > 0 && w.hp > 0.5, 'Wrinkler is not active.', 'not_found'); call(Game, 'playWrinklerSquishSound'); w.clicks++; w.hurt = 1; w.hp -= 0.75; if (w.clicks >= 50) call(Game, 'Win', 'Wrinkler poker'); return {id: a.id, clicks: w.clicks, hp: w.hp, payout_pending: w.hp <= 0.5}; };
    handlers.wrinkler_pop_all = function (a) { var ids = []; (Game.wrinklers || []).forEach(function (w, i) { if (w.phase > 0 && w.hp > 0 && (a.include_shiny || w.type !== 1)) { w.hp = 0; ids.push(i); } }); return {popped: ids, payout_pending: ids.length > 0}; };
    handlers.set_season = function (a) {
      if (!a.season) { need(Game.season && Game.seasons[Game.season], 'No season is active.'); var u = Game.seasons[Game.season].triggerUpgrade; need(u.bought, 'A natural base season cannot be cancelled.'); return buyUpgrade(u); }
      need(Game.seasons[a.season], 'Season is not supported.'); if (Game.season === a.season) return {season: Game.season, unchanged: true};
      return buyUpgrade(Game.seasons[a.season].triggerUpgrade);
    };

    handlers.ascend = function () { playing(); freePrompt(); call(Game, 'Ascend', 1); return {phase: 'ascending', wait_for: 'live.on_ascend'}; };
    function heavenlyAvailable(u) { return (!u.showIf || u.showIf()) && (u.parents || []).every(function (p) { return p === -1 || (typeof p === 'string' ? owned(p) : !!p.bought); }); }
    handlers.buy_heavenly_upgrade = function (a) { ascended(); freePrompt(); var u = upgrade(a); need(u.pool === 'prestige', 'This is not a heavenly upgrade.'); need(!u.bought && heavenlyAvailable(u), 'Heavenly upgrade is owned or its prerequisites are unmet.', 'locked'); need(Game.heavenlyChips >= call(u, 'getPrice'), 'Not enough heavenly chips.', 'insufficient_resources'); call(Game, 'PurchaseHeavenlyUpgrade', u.id); need(u.bought, 'Heavenly upgrade was not purchased.'); return {id: u.id, bought: true, chips: Game.heavenlyChips, awaiting_confirmation: !!Game.promptOn, prompt: prompt()}; };
    handlers.ascension_mode = function (a) { ascended(); need(Game.ascensionModes[a.mode], 'Ascension mode does not exist.'); Game.nextAscensionMode = a.mode; return {mode: a.mode}; };
    handlers.permanent_slot = function (a) {
      ascended(); freePrompt(); need(owned('Permanent upgrade slot ' + ['I', 'II', 'III', 'IV', 'V'][a.slot]), 'Permanent slot is locked.', 'locked');
      if (a.upgrade_id !== -1) { var u = upgrade({id: a.upgrade_id}); need(u.bought && u.unlocked && !u.noPerm && ['', 'cookie'].indexOf(u.pool) !== -1, 'Upgrade is not eligible for a permanent slot.'); need(Game.permanentUpgrades.every(function (id, i) { return i === a.slot || id !== a.upgrade_id; }), 'Upgrade is already in another permanent slot.'); }
      call(Game, 'AssignPermanentSlot', a.slot); call(Game, 'PutUpgradeInPermanentSlot', a.upgrade_id, a.slot); confirmFirst(); return {slots: Game.permanentUpgrades.slice()};
    };
    handlers.reincarnate = function () { ascended(); freePrompt(); call(Game, 'Reincarnate', 1); return {phase: 'reincarnating', mode: Game.ascensionMode}; };
    handlers.ascension_view = function (a) { ascended(); if (a.recenter) call(Game, 'AscendRefocus'); if (a.x !== undefined) Game.AscendOffXT = a.x; if (a.y !== undefined) Game.AscendOffYT = a.y; if (a.zoom !== undefined) Game.AscendZoomT = a.zoom; return {x: Game.AscendOffXT, y: Game.AscendOffYT, zoom: Game.AscendZoomT}; };

    // Settings and native UI adapters.
    handlers.rename_bakery = function (a) { call(Game, 'bakeryNameSet', a.name); return {name: Game.bakeryName}; };
    function preference(a, toggle) {
      var key = aliases[a.name] || a.name; need(Object.prototype.hasOwnProperty.call(Game.prefs, key), 'Preference does not exist.', 'not_found');
      var value = toggle ? !Game.prefs[key] : (a.name === 'scary' ? !a.enabled : a.enabled);
      Game.prefs[key] = value ? 1 : 0;
      var effects = {fancy: 'ToggleFancy', filters: 'ToggleFilters', extraButtons: 'ToggleExtraButtons', fullscreen: 'ToggleFullscreen'};
      if (effects[key]) call(Game, effects[key]);
      if (key === 'discordPresence' && env.Steam && typeof env.Steam.toggleRichPresence === 'function') env.Steam.toggleRichPresence(value);
      if (Game.onMenu) call(Game, 'UpdateMenu');
      return {name: key, enabled: !!Game.prefs[key], requires_reload: key === 'screenreader'};
    }
    handlers.toggle_pref = function (a) { return preference(a, true); };
    handlers.set_pref = function (a) { return preference(a, false); };
    handlers.set_volume = function (a) { call(Game, {sfx: 'setVolume', music: 'setVolumeMusic', filter: 'setWubMusic'}[a.channel], a.value); return {channel: a.channel, value: a.value}; };
    handlers.set_language = function (a) {
      freePrompt(); var langs = env.Langs || {}, key = Object.keys(langs).find(function (key) { return [key, langs[key].file, langs[key].name].some(function (s) { return String(s).toLowerCase() === a.language.toLowerCase(); }); });
      need(key !== undefined, 'Language is not installed.', 'not_found'); call(Game, 'showLangSelection'); click('langSelect-' + key); return {language: key, reload_scheduled: true};
    };
    handlers.show_menu = function (a) { if (Game.onMenu !== a.menu) call(Game, 'ShowMenu', a.menu); return {menu: Game.onMenu}; };
    handlers.dismiss_notifications = function (a) { if (a.id === undefined) call(Game, 'CloseNotes'); else call(Game, 'CloseNote', a.id); return {dismissed: a.id === undefined ? 'all' : a.id}; };
    handlers.prompt_respond = function (a) { var p = prompt(); need(p && p.token === a.expected_prompt, 'Prompt changed. Inspect the UI again.', 'stale_prompt'); need(p.options.some(function (o) { return o.index === a.option && !o.disabled; }), 'Prompt option is unavailable.'); click('promptOption' + a.option); return {prompt: prompt()}; };
    handlers.prompt_cancel = function () { need(!Game.promptNoClose, 'Current prompt cannot be dismissed.'); call(Game, 'ClosePrompt'); return {prompt: prompt()}; };
    handlers.inspect_ui = inspectUI;
    handlers.ui_click = function (a) { var el = element(a.target); need(!el.href || el.getAttribute('href').startsWith('#') || el.getAttribute('href').startsWith('javascript:'), 'External navigation is not an in-game control.'); modifiers(a, function () { click(el); }); return {clicked: a.target, prompt: prompt()}; };
    handlers.ui_set_input = function (a) { return input(a.target, a.value); };
    handlers.ui_scroll = function (a) { var el = element(a.target); el.scrollBy(a.x, a.y); return {left: el.scrollLeft, top: el.scrollTop}; };
    handlers.ui_drag = function (a) {
      var from = element(a.from), to = element(a.to), r1 = from.getBoundingClientRect(), r2 = to.getBoundingClientRect();
      function event(el, type, r, buttons) { el.dispatchEvent(new env.MouseEvent(type, {bubbles: true, cancelable: true, view: env, button: 0, buttons: buttons, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2})); }
      event(from, 'mousedown', r1, 1); event(from, 'mouseout', r1, 1); event(to, 'mouseover', r2, 1); event(to, 'mousemove', r2, 1); event(to, 'mouseup', r2, 0);
      return {dragged: true};
    };
    handlers.ui_pointer = function (a) {
      var el = element(a.target), r = el.getBoundingClientRect();
      modifiers(a, function () {
        function dispatch(type, buttons) { el.dispatchEvent(new env.MouseEvent(type, {bubbles: true, cancelable: true, view: env, button: 0, buttons: buttons, clientX: r.x + a.x * r.width, clientY: r.y + a.y * r.height, shiftKey: a.shift, ctrlKey: a.ctrl})); }
        dispatch('mousemove', a.event === 'down' ? 1 : 0);
        if (a.event === 'down' || a.event === 'click') dispatch('mousedown', 1);
        if (a.event === 'up' || a.event === 'click') dispatch('mouseup', 0);
        if (a.event === 'click') dispatch('click', 0);
      });
      return {event: a.event, target: a.target, native_frame_processing_pending: true};
    };
    function giftReady() { playing(); freePrompt(); need(owned('Wrapping paper') && Game.ascensionMode === 0 && Game.cookies >= 1e9, 'Wrapping paper, normal mode and one billion banked cookies are required.', 'locked'); need(!call(Game, 'hasBuff', 'Gifted out'), 'Gift actions are on cooldown.', 'cooldown'); }
    handlers.gift_create = function (a) {
      giftReady(); need(Game.giftBoxDesigns[a.design], 'Gift box design does not exist.'); call(Game, 'promptGiftSend'); call(Game, 'UpdatePrompt');
      input('giftAmount', String(a.cookies)); input('giftMessage', a.message); click('giftBoxDesignButton'); click('giftSelector-' + a.design); click('promptOption0');
      var code = doc.getElementById('giftCode'); need(code && code.value, 'Gift wrapping failed.'); return {code: code.value, cookies: a.cookies};
    };
    handlers.gift_redeem = function (a) { giftReady(); call(Game, 'promptGiftRedeem'); input('giftCode', a.code); var before = Game.cookiesReceived; click('promptOption0'); need(Game.cookiesReceived > before, 'Gift was not redeemed.'); return {cookies_received: Game.cookiesReceived - before}; };
    handlers.force_save = async function () { call(Game, 'WriteSave'); var deadline = Date.now() + 10000; while (Game.isSaving && Date.now() < deadline) await new Promise(function (resolve) { env.setTimeout(resolve, 25); }); need(!Game.isSaving, 'Native save completion timed out.', 'save_timeout'); return {saved: true}; };
    handlers.export_save = function () { return {save: call(Game, 'WriteSave', 1)}; };
    handlers.import_save = function (a) { freePrompt(); var backup = call(Game, 'WriteSave', 1); need(call(Game, 'LoadSave', a.save), 'Save import was rejected by the native parser.'); return {imported: true, previous_save: backup}; };
    handlers.hard_reset = function () { freePrompt(); var backup = call(Game, 'WriteSave', 1); call(Game, 'HardReset', 2); return {reset: true, previous_save: backup}; };

    // Live action-discovery data. Never serialize Game objects: they contain cycles,
    // DOM nodes and functions. Catalogs deliberately include locked items too.
    function read(fn, fallback) { try { return fn(); } catch (e) { return fallback === undefined ? null : fallback; } }
    function textHTML(value) { if (typeof value !== 'string') return ''; var el = doc.createElement('template'); el.innerHTML = value; return el.content.textContent || ''; }
    function upgradesCatalog() {
      return Object.values(Game.UpgradesById || {}).map(function (u) {
        var prestige = u.pool === 'prestige';
        return {id: u.id, name: u.name, display_name: u.dname, pool: u.pool, unlocked: !!u.unlocked, bought: !!u.bought,
          price: read(function () { return u.getPrice(); }), lump_price: u.priceLumps || 0,
          can_buy: read(function () { return !u.bought && (prestige ? !!Game.OnAscend && heavenlyAvailable(u) && Game.heavenlyChips >= u.getPrice() : !!u.unlocked && u.canBuy()); }, false),
          vaulted: read(function () { return u.isVaulted(); }, false), has_choices: !!u.choicesFunction, has_activation: !!u.activateFunction,
          requires_confirmation: !!u.clickFunction, toggle_into: u.toggleInto || null,
          permanent_eligible: !!u.bought && !!u.unlocked && !u.noPerm && ['', 'cookie'].indexOf(u.pool) !== -1,
          parents: (u.parents || []).map(function (p) { return p === -1 ? -1 : (typeof p === 'string' ? p : p.id); }),
          visible: read(function () { return !u.showIf || !!u.showIf(); }, false),
          description: textHTML(u.desc), icon: u.icon};
      });
    }
    function buildingsCatalog() {
      return (Game.ObjectsById || []).map(function (b) {
        var prices = {};
        [1, 10, 100].forEach(function (n) { prices['buy_price_' + n] = read(function () { return b.getSumPrice(n); }); prices['sell_price_' + n] = read(function () { return b.getReverseSumPrice(n); }); });
        return Object.assign({id: b.id, name: b.name, display_name: b.dname, amount: b.amount, level: b.level, highest: b.highest, free: b.free,
          locked: !!b.locked, muted: !!b.muted, baseCps: b.baseCps, cps: b.storedTotalCps, totalCookiesPushed: b.totalCookies,
          has_minigame: !!b.minigame, minigame_name: b.minigameName || null, minigame_loaded: !!b.minigameLoaded, minigame_open: !!b.onMinigame,
          next_level_lumps: b.level + 1, can_level: read(function () { return Game.canLumps() && Game.lumps >= b.level + 1; }, false)}, prices);
      });
    }
    function minigamesState() {
      var out = {};
      [['garden', 'Farm'], ['pantheon', 'Temple'], ['grimoire', 'Wizard tower'], ['stock', 'Bank']].forEach(function (pair) {
        var b = (Game.Objects || {})[pair[1]], M = b && b.minigame;
        out[pair[0]] = {available: !!(M && b.minigameLoaded && b.level > 0 && b.amount > 0), loaded: !!(M && b.minigameLoaded), building: pair[1], building_level: b && b.level};
        if (!M || !b.minigameLoaded) return;
        try {
          var extra = {};
          if (pair[0] === 'garden') {
            extra = {frozen: !!M.freeze, selected_seed: M.seedSelected, soil: M.soil, next_soil: M.nextSoil, next_step: M.nextStep, step_seconds: M.stepT,
              width: 6, height: 6, plot: M.plot.map(function (row, y) { return row.map(function (cell, x) { var p = cell[0] ? M.plantsById[cell[0] - 1] : null; return {x: x, y: y, unlocked: M.isTileUnlocked(x, y), seed_id: p ? p.id : null, age: cell[1], mature: !!p && cell[1] >= p.mature, name: p ? p.name : null}; }); }),
              seeds: M.plantsById.map(function (p) { return {id: p.id, key: p.key, name: p.name, unlocked: !!p.unlocked, plantable: !!p.plantable, cost: M.getCost(p), mature: p.mature, immortal: !!p.immortal, age_tick: p.ageTick, age_tick_random: p.ageTickR, description: textHTML(p.effsStr || p.desc)}; }),
              soils: M.soilsById.map(function (s) { return {id: s.id, key: s.key, name: s.name, required_farms: s.req, tick_minutes: s.tick, available: b.amount >= s.req, description: textHTML(s.effsStr || s.desc)}; }),
              effects: Object.assign({}, M.effs), seeds_unlocked: M.plantsUnlockedN, seed_count: M.plantsN, harvests: M.harvests, harvests_total: M.harvestsTotal, sacrifices: M.convertTimes, can_sacrifice: M.plantsUnlockedN >= M.plantsN};
          } else if (pair[0] === 'pantheon') {
            extra = {slots: M.slot.slice(), swaps: M.swaps, swap_time: M.swapT, swap_cooldown_ms: [16 * 3600000, 4 * 3600000, 3600000, 0][M.swaps],
              spirits: M.godsById.map(function (g) { return {id: g.id, key: g.key, name: g.name, slot: g.slot, description: textHTML(g.desc), diamond: textHTML(g.desc1), ruby: textHTML(g.desc2), jade: textHTML(g.desc3)}; })};
          } else if (pair[0] === 'grimoire') {
            extra = {magic: M.magic, magic_max: M.magicM, spells_cast: M.spellsCast, spells_cast_total: M.spellsCastTotal,
              spells: M.spellsById.map(function (s) { var cost = M.getSpellCost(s); return {id: s.id, name: s.name, description: textHTML(s.desc), fail_description: textHTML(s.failDesc), cost: cost, fail_chance: M.getFailChance(s), can_cast: M.magic >= cost}; })};
          } else {
            extra = {profit: M.profit, office_level: M.officeLevel, offices: M.offices.map(function (o, i) { return {id: i, name: o.name, upgrade_cost: o.cost, description: textHTML(o.desc)}; }), brokers: M.brokers, broker_price: M.getBrokerPrice(), max_brokers: M.getMaxBrokers(), overhead: 0.2 * Math.pow(0.95, M.brokers),
              tick_seconds: M.secondsPerTick, tick_progress: M.tickT, dollar_cookies: Game.cookiesPsRawHighest, graph_lines: !!M.graphLines, graph_colors: !!M.graphCols,
              goods: M.goodsById.map(function (g) { return {id: g.id, symbol: g.symbol, name: g.name, company: g.company, building: g.building.name, active: !!g.active, hidden: !!g.hidden,
                price: M.getGoodPrice(g), price_cookies: M.getGoodPrice(g) * Game.cookiesPsRawHighest, delta: M.goodDelta(g.id), resting_value: M.getRestingVal(g.id), stock: g.stock, max_stock: M.getGoodMaxStock(g), last_trade: g.last, can_buy_this_tick: g.last !== 2, can_sell_this_tick: g.last !== 1}; }),
              loans: M.loanTypes.map(function (loan, i) { var id = i + 1; return {id: id, name: loan[0], multiplier: loan[1], duration_minutes: loan[2], interest_multiplier: loan[3], interest_minutes: loan[4], downpayment_fraction: loan[5], required_office: [1, 3, 5][i], active: !!Game.hasBuff('Loan ' + id), interest_active: !!Game.hasBuff('Loan ' + id + ' (interest)'), unlocked: M.officeLevel >= [1, 3, 5][i]}; }), opportunities: {implemented: false}};
          }
          Object.assign(out[pair[0]], extra);
        } catch (e) { out[pair[0]].available = false; out[pair[0]].state_error = e.message; }
      });
      return out;
    }
    function liveState() {
      var tickerEffect = Game.TickerEffect, sub = tickerEffect && tickerEffect.sub;
      return {timestamp: Date.now(), ready: !!Game.ready, on_ascend: !!Game.OnAscend, ascend_timer: Game.AscendTimer, reincarnate_timer: Game.ReincarnateTimer,
        cookies: Game.cookies, cps: Game.cookiesPs, unbuffed_cps: Game.unbuffedCps, raw_cps: Game.cookiesPsRaw, click_cookies: Game.computedMouseCps,
        ticker: {text: textHTML(Game.Ticker), clicks: Game.TickerClicks, effect: tickerEffect ? {type: tickerEffect.type, sub: sub && typeof sub === 'object' ? {id: sub.id, name: sub.name} : sub} : null},
        shimmers: (Game.shimmers || []).map(function (s, i) { return {index: i, id: s.id, type: s.type, wrath: !!s.wrath, remaining_frames: s.life}; }),
        wrinklers: (Game.wrinklers || []).map(function (w, i) { return {id: i, phase: w.phase, hp: w.hp, shiny: w.type === 1, sucked: w.sucked}; }),
        buffs: Object.keys(Game.buffs || {}).map(function (key) { var b = Game.buffs[key]; return {name: key, remaining_frames: b.time, max_frames: b.maxTime, cps_multiplier: b.multCpS, click_multiplier: b.multClick}; }),
        lumps: {available: Game.lumps, total: Game.lumpsTotal, unlocked: read(function () { return Game.canLumps(); }, false), type: Game.lumpCurrentType, started_at: Game.lumpT, mature_age_ms: Game.lumpMatureAge, ripe_age_ms: Game.lumpRipeAge, overripe_age_ms: Game.lumpOverripeAge, refill_remaining_frames: Game.lumpRefill},
        season: {current: Game.season, base: Game.baseSeason, remaining_frames: Game.seasonT, uses: Game.seasonUses},
        prestige: {level: Game.prestige, chips: Game.heavenlyChips, spent: Game.heavenlyChipsSpent, mode: Game.ascensionMode, next_mode: Game.nextAscensionMode, permanent_slots: (Game.permanentUpgrades || []).slice(), gain: read(function () { return Math.max(0, Math.floor(Game.HowMuchPrestige(Game.cookiesEarned + Game.cookiesReset)) - Math.floor(Game.HowMuchPrestige(Game.cookiesReset))); })},
        research: {id: Game.nextResearch, remaining_frames: Game.researchT}, grandmapocalypse: {elder_wrath: Game.elderWrath, pledge_remaining_frames: Game.pledgeT, pledges: Game.pledges, covenant: read(function () { return owned('Elder Covenant'); }, false)},
        minigames: minigamesState(), prompt: prompt(), menu: Game.onMenu, store_mode: Game.buyMode, store_bulk: Game.buyBulk, choice_selector: Game.choiceSelectorOn};
    }
    function snapshot() {
      var up = upgradesCatalog(), bs = buildingsCatalog(), live = liveState();
      var dragon = {unlocked: owned('A crumbly egg'), level: Game.dragonLevel, max_level: Game.dragonLevels.length - 1, aura1: Game.dragonAura, aura2: Game.dragonAura2,
        secondary_unlocked: Game.dragonLevel === Game.dragonLevels.length - 1, can_upgrade: Game.dragonLevel < Game.dragonLevels.length - 1 && read(function () { return Game.dragonLevels[Game.dragonLevel].cost(); }, false),
        levels: Game.dragonLevels.map(function (level, i) { return {id: i, name: level.name, description: textHTML(read(function () { return typeof level.action === 'function' ? level.action() : level.action; }, '')), cost_description: textHTML(read(function () { return level.costStr ? level.costStr() : ''; }, ''))}; }),
        auras: Object.keys(Game.dragonAuras).map(function (id) { var a = Game.dragonAuras[id]; return {id: Number(id), name: a.name, display_name: a.dname, description: textHTML(a.desc), unlocked: Game.dragonLevel >= Number(id) + 4}; })};
      var santa = {unlocked: owned('A festive hat'), level: Game.santaLevel, max_level: Game.santaLevels.length - 1, levels: Game.santaLevels.slice(), next_cost: Math.pow(Game.santaLevel + 1, Game.santaLevel + 1)};
      var control = {api_version: schema.version, game_version: Game.version, snapshot_at: Date.now(), live: live, buildings: bs, upgrades: up,
        achievements: Object.values(Game.AchievementsById || {}).map(function (a) { return {id: a.id, name: a.name, display_name: a.dname, won: !!a.won, pool: a.pool, description: textHTML(a.desc)}; }),
        dragon: dragon, santa: santa, preferences: Object.assign({}, Game.prefs), volume: {sfx: Game.volume, music: Game.volumeMusic},
        seasons: Object.keys(Game.seasons || {}).map(function (key) { var s = Game.seasons[key], u = s.triggerUpgrade; return {id: key, name: s.name, trigger_upgrade: u && u.id, trigger_name: s.trigger, price: u && u.getPrice(), unlocked: !!(u && u.unlocked), bought: !!(u && u.bought)}; }),
        ascension_modes: Object.keys(Game.ascensionModes || {}).map(function (key) { var mode = Game.ascensionModes[key]; return {id: Number(key), name: mode.name, description: textHTML(mode.desc)}; }),
        languages: Object.keys(env.Langs || {}).map(function (key) { return {id: key, name: env.Langs[key].name, file: env.Langs[key].file}; }),
        mods: Object.keys(Game.mods || {}).map(function (key) { return {id: key, name: Game.mods[key].name || key}; }),
        unsupported: schema.unsupported};
      var gm = live.minigames.garden, pm = live.minigames.pantheon, gr = live.minigames.grimoire, sm = live.minigames.stock;
      var stockGoods = {}; (sm.goods || []).forEach(function (g) { stockGoods[g.symbol] = {id: g.id, name: g.name, price: g.price, delta: g.delta, portfolio: g.stock, maxPortfolio: g.max_stock}; });
      var prefs = {}; Object.keys(Game.prefs).forEach(function (key) { prefs[key] = Game.prefs[key]; }); Object.keys(aliases).forEach(function (key) { prefs[key] = key === 'scary' ? 1 - Number(!!Game.prefs[aliases[key]]) : Game.prefs[aliases[key]]; });
      return {control: control, buildings: bs, upgrades_na_loja: (Game.UpgradesInStore || []).map(function (u) { var x = up[u.id]; return {id: u.id, name: u.name, price: x.price, pool: x.pool, description: x.description, canAfford: x.can_buy, icon: u.icon}; }),
        upgrades_comprados: up.filter(function (u) { return u.bought; }), achievements: control.achievements,
        grimorio: gr.available ? {available: true, magic: gr.magic, magicMax: gr.magic_max, spells: gr.spells.map(function (s) { return {index: s.id, name: s.name, cost: s.cost, failChance: s.fail_chance * 100, canCast: s.can_cast}; })} : null,
        panteao: pm.available ? {available: true, slots: pm.slots, swapsDisponiveis: pm.swaps, spirits: pm.spirits} : null,
        jardim: gm.available ? {available: true, width: 6, height: 6, soil: gm.soil, seeds: gm.seeds, grid: Array.from({length: 6}, function (_, x) { return Array.from({length: 6}, function (_, y) { var t = gm.plot[y][x]; return t.seed_id === null ? null : {seedId: t.seed_id, seedName: t.name, growthStage: t.age, mature: t.mature}; }); })} : null,
        bolsa: sm.available ? {available: true, goods: stockGoods} : null,
        dragao: Object.assign({nivel: dragon.level, pode_evoluir: dragon.can_upgrade}, dragon), santa: Object.assign({nivel: santa.level, nivel_maximo: santa.max_level, pode_evoluir: santa.unlocked && santa.level < santa.max_level && Game.cookies > santa.next_cost}, santa),
        interruptores: prefs, legado: Object.assign({prestige: Game.prestige, heavenly_chips: Game.heavenlyChips, heavenly_chips_gastos: Game.heavenlyChipsSpent, ganho_prestige: live.prestige.gain, ganho_chips: live.prestige.gain, ascensoes: Game.resets, modo_ascensao: Game.ascensionMode, cookies_para_proximo_prestige: read(function () { return Math.max(0, Game.HowManyCookiesReset(Math.floor(Game.HowMuchPrestige(Game.cookiesEarned + Game.cookiesReset)) + 1) - Game.cookiesEarned - Game.cookiesReset); }), upgrades: up.filter(function (u) { return u.pool === 'prestige'; }).map(function (u) { return Object.assign({canAfford: u.can_buy}, u); })}, live.prestige),
        save_string: Game.ready ? Game.WriteSave(1) : null};
    }
    async function execute(inputAction) {
      var started = Date.now(), action, result;
      try {
        action = schema.validate(inputAction);
        var spec = schema.actions[action.type];
        need(Game.ready, 'Game is not ready.', 'not_ready');
        if (['cookies', 'buildings', 'store', 'lumps', 'garden', 'pantheon', 'grimoire', 'stock', 'dragon', 'santa', 'seasons', 'gifts'].indexOf(spec.group) !== -1) playing();
        result = await handlers[action.type](action);
        return {type: action.type, status: result && result.awaiting_confirmation ? 'awaiting_confirmation' : 'succeeded', started_at: started, finished_at: Date.now(), result: result || null};
      } catch (e) {
        return {type: inputAction && inputAction.type, status: 'failed', started_at: started, finished_at: Date.now(), error: {code: e.code || 'execution_error', message: e.message, may_have_side_effects: !!action}};
      }
    }
    return {execute: execute, handlers: handlers, inspectUI: inspectUI, prompt: prompt, snapshot: snapshot, liveState: liveState};
  }
  return {version: schema.version, create: create};
});
