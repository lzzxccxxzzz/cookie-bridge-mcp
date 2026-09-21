// Real Electron -> HTTP queue -> renderer tests. CDP is only the fixture/oracle.
import fs from 'node:fs/promises';
import path from 'node:path';
import { assert, delay, here, bridgeURL, json, until, connectTest } from './test-support.mjs';

const t = await connectTest();
const {cdp, invoke} = t;
const report = {started_at: new Date().toISOString(), game_version: null, mode: 'isolated Electron, real MCP actions, CDP fixtures and independent assertions', cases: [], coverage: {}, exceptions: []};
const allTools = (await t.client.listTools()).tools.map(x => x.name);
const output = path.join(here, 'output', 'integration');
await fs.mkdir(output, {recursive: true});
let current;
const selected = process.env.TEST_GROUP;
const q = value => JSON.stringify(value);
const e = expression => cdp.evaluate(expression);
async function seed(expression, returnValue = false) { current.fixtures.push(expression); return e(returnValue ? expression : '(()=>{' + expression + ';return true;})()'); }
async function call(name, args = {}, allowError = false) {
  const result = await invoke(name, args, allowError);
  current.calls.push({tool: name, arguments: Object.fromEntries(Object.entries(args).map(([k,v]) => [k, ['save','code'].includes(k) ? '[redacted]' : v])), id: result.id, status: result.status, error: result.error});
  return result;
}
async function act(name, args = {}) {
  const r = await call(name, args);
  assert.ok(['succeeded', 'awaiting_confirmation'].includes(r.status), `${name}: unexpected result ${JSON.stringify(r)}`);
  return r;
}
async function check(expression, expected = true) {
  const actual = await e(expression); current.assertions.push({expression, actual, expected}); assert.deepEqual(actual, expected);
}
async function rejected(name, args, expression) {
  const before = expression ? await e(expression) : null;
  const r = await call(name, args, true);
  assert.ok(r.status === 'failed' || r.error, 'Expected a rejected action');
  if (expression) assert.deepEqual(await e(expression), before, 'Rejected action changed guarded state');
}
async function run(group, name, fn) {
  if (selected && !selected.split(',').includes(group)) return;
  current = {group, name, fixtures: [], calls: [], assertions: [], started_at: Date.now()};
  try { await fn(); current.status = 'passed'; }
  catch (err) { current.status = 'failed'; current.error = err.stack; }
  current.duration_ms = Date.now() - current.started_at; report.cases.push(current);
  console.log(`${current.status.toUpperCase()} ${group}: ${name}${current.error ? '\n' + current.error : ''}`);
  await fs.writeFile(path.join(output, 'live-progress.json'), JSON.stringify(report, null, 2));
}
async function normal() {
  await seed(`(()=>{Game.ClosePrompt();if(Game.OnAscend)Game.Reincarnate(1);return true;})()`);
  await until(() => e('!Game.OnAscend && !Game.AscendTimer && !Game.ReincarnateTimer'));
  await seed(`(()=>{Game.ClosePrompt();Game.ShowMenu('');Game.cookies=1e80;Game.cookiesEarned=Math.max(Game.cookiesEarned,1e80);Game.lumps=1000;Game.lumpsTotal=1000;Game.lumpT=Date.now();Game.lumpRefill=0;Game.prefs.autosave=0;Game.prefs.cloudSave=0;Game.prefs.focus=0;Game.prefs.askLumps=0;return true;})()`);
}
async function minigames() {
  await normal();
  await seed(`(()=>{for(const b of Game.ObjectsById){b.amount=500;b.highest=500;b.level=Math.max(b.level,10);b.locked=0;b.refresh();}Game.Objects.Cursor.amount=2000;Game.Objects.Cursor.level=12;Game.BuildingsOwned=Game.ObjectsById.reduce((s,b)=>s+b.amount,0);Game.CalculateGains();Game.LoadMinigames();return true;})()`);
  await until(() => e(`['Farm','Bank','Temple','Wizard tower'].every(n=>Game.Objects[n].minigameLoaded)`));
  await delay(600);
}
async function grant(names) { await seed(`(()=>{for(const n of ${q(names)}){const u=Game.Upgrades[n];if(!u)throw Error(n);u.unlocked=1;u.bought=1;}Game.recalculateGains=1;Game.upgradesToRebuild=1;return true;})()`); }
async function fresh() {
  await seed('(()=>{Game.ClosePrompt();Game.HardReset(2);Game.prefs.autosave=0;Game.prefs.cloudSave=0;Game.prefs.focus=0;return true;})()'); await delay(600);
}
try {
  if (!await e('!!Game.ready')) await e(`document.getElementById('langSelect-EN').click()`);
  await until(() => e('!!Game.ready && !!window.CookieBridge'));
  await until(async () => (await json(bridgeURL + '/capabilities')).renderer_version);
  report.game_version = await e('Game.version');

  await run('reads', 'state, catalogs, discovery and PNG screenshot', async () => {
    const status = await call('get_bridge_status'); assert.equal(status.jogo_conectado, true);
    const cap = await call('get_capabilities'); assert.equal(cap.actions.length, allTools.filter(n => cap.actions.some(a=>a.name===n)).length);
    const state = await call('get_game_state'); assert.equal(state.control.game_version, await e('Game.version')); assert.ok(!state.save_string);
    const stats = await call('get_game_stats'); assert.ok(Number.isFinite(stats.cookies_na_conta));
    const b = await call('get_building', {name:'Cursor'}); assert.equal(b.building.amount, await e('Game.Objects.Cursor.amount'));
    const upgrades = await call('get_upgrades'); assert.ok(Array.isArray(upgrades.upgrades));
    for (const kind of ['buildings','upgrades','achievements','dragon_auras','dragon_levels','seasons','ascension_modes','languages','mods','preferences']) {
      const cat = await call('get_game_catalog', {kind}); assert.ok(kind==='preferences' ? Object.hasOwn(cat,'fancy') : Array.isArray(cat.items));
    }
    for(const name of ['get_golden_cookies','get_active_effects','get_minigame_state','get_dragon_state','get_prestige_state','get_news_state','get_action_queue','get_action_history']) assert.ok(await call(name));
    const ui = await call('get_ui_state'); assert.ok(ui.result.elements.length);
    const image = await call('get_game_screenshot'); const png = Buffer.from(image.content.find(c=>c.type==='image').data, 'base64'); assert.equal(png.subarray(1,4).toString(),'PNG');
    await fs.writeFile(path.join(output,'game.png'), png);
  });

  await run('goal', 'earn 10K, buy building/upgrade and collect golden cookie through MCP', async () => {
    await fresh();
    const start = await e('Game.cookieClicks');
    await act('click_cookie',{count:150}); await check('Game.cookieClicks',start+150);
    await act('buy_building',{name:'Cursor',quantity:1}); await check('Game.Objects.Cursor.amount',1);
    await act('buy_building',{name:'Cursor',quantity:1});
    await act('buy_upgrade',{name:'Reinforced index finger'}); await check('!!Game.Has("Reinforced index finger")');
    for(let i=0; i<15 && await e('Game.cookies<10000'); i++) await act('click_cookie',{count:500});
    await check('Game.cookies>=10000');
    const golden = await seed(`(()=>{const s=new Game.shimmer('golden',{noWrath:true});s.force='lucky';s.spawnLead=1;return {id:s.id,before:Game.goldenClicks};})()`,true);
    await act('click_shimmer',{shimmer_id:golden.id}); await check('Game.goldenClicks',golden.before+1);
    await act('force_save');
  });

  await run('buildings', 'every building, buy/sell modes, bulk, levels and legacy endpoint', async () => {
    await normal();
    const names = await e('Game.ObjectsById.map(b=>b.name)');
    for(const name of names) {
      await seed(`Game.Objects[${q(name)}].locked=0`);
      const before = await e(`Game.Objects[${q(name)}].amount`);
      await act('buy_building',{name}); await check(`Game.Objects[${q(name)}].amount`, before+1);
    }
    await act('store_mode',{mode:'sell'}); await check('Game.buyMode',-1);
    await act('store_bulk',{quantity:-1}); await check('Game.buyBulk',-1);
    const before = await e('Game.Objects.Cursor.amount');
    await act('buy_building_max',{name:'Cursor',limit:10}); await check('Game.Objects.Cursor.amount',before+10); await check('Game.buyMode',-1);
    await act('sell_building',{name:'Cursor',quantity:2}); await check('Game.Objects.Cursor.amount',before+8);
    await act('store_mode',{mode:'buy'}); for(const quantity of [1,10,100]) {await act('store_bulk',{quantity});await check('Game.buyBulk',quantity);}
    await act('mute_building',{name:'Farm',muted:true}); await check('!!Game.Objects.Farm.muted');
    await act('mute_building',{name:'Farm',muted:false}); await check('!!Game.Objects.Farm.muted',false);
    const old = await e('({level:Game.Objects.Farm.level,lumps:Game.lumps})');
    await act('sugarlump_use',{name:'Farm'}); await check('Game.Objects.Farm.level',old.level+1); await check('Game.lumps',old.lumps-old.level-1);
    const level = await json(bridgeURL+'/action/view/lvl/Farm'); assert.equal(level.nivel_atual,old.level+1);
    await act('sell_all_of_type',{name:'Farm'}); await check('Game.Objects.Farm.amount',0);
    await act('sell_all_buildings',{confirm:true}); await check('Game.BuildingsOwned',0);
  });

  await run('store', 'upgrade types, vault, buy all, switches and selectors', async () => {
    await normal(); await grant(['Inspired checklist','Golden switch','Shimmering veil','Milk selector','Background selector','Basic wallpaper assortment']);
    await seed(`(()=>{for(const n of ['Reinforced index finger','Carpal tunnel prevention cream','Bingo center/Research facility','Specialized chocolate chips','One mind','Milk selector','Background selector','Golden switch [off]','Golden switch [on]','Shimmering veil [off]','Shimmering veil [on]']){Game.Upgrades[n].unlocked=1;Game.Upgrades[n].bought=0;}Game.Upgrades['Milk selector'].bought=1;Game.Upgrades['Background selector'].bought=1;Game.Upgrades['Golden switch [on]'].bought=1;Game.Upgrades['Shimmering veil [on]'].bought=1;Game.CalculateGains();return true;})()`);
    await act('upgrade_vault',{name:'Reinforced index finger',vaulted:true}); await check('Game.Upgrades["Reinforced index finger"].isVaulted()',true);
    await act('buy_upgrade',{name:'Bingo center/Research facility'}); await check('Game.nextResearch',await e('Game.Upgrades["Specialized chocolate chips"].id'));
    await act('buy_upgrade',{name:'Specialized chocolate chips'}); await check('!!Game.Has("Specialized chocolate chips")');
    const prompt = await act('buy_upgrade',{name:'One mind'}); assert.equal(prompt.status,'awaiting_confirmation');
    await act('prompt_respond',{expected_prompt:prompt.result.prompt.token,option:0}); await check('!!Game.Has("One mind")');
    await act('store_buy_all'); await check('!!Game.Has("Carpal tunnel prevention cream")'); await check('!!Game.Has("Reinforced index finger")',false);
    await act('upgrade_vault',{name:'Reinforced index finger',vaulted:false}); await act('buy_upgrade',{name:'Reinforced index finger'});
    for(const name of ['Milk selector','Background selector']) {
      const r=await act('upgrade_choices',{name}); assert.ok(r.result.choices);
      if(r.result.choices.kind==='list') await act('upgrade_choose',{name,choice_id:1});
    }
    for(const name of ['golden','veil']) for(const enabled of [true,false]) {
      await act('switch_set',{switch:name,enabled}); await check(`!!Game.Has(${q(name==='golden'?'Golden switch [off]':'Shimmering veil [off]')})`,enabled);
    }
    await seed(`Game.Upgrades['Elder Covenant'].unlocked=1;Game.Upgrades['Elder Covenant'].bought=0;Game.Upgrades['Revoke Elder Covenant'].bought=0;Game.elderWrath=3`);
    await act('switch_set',{switch:'covenant',enabled:true});await check('!!Game.Has("Elder Covenant")');
    await act('switch_set',{switch:'covenant',enabled:false});await check('!!Game.Has("Elder Covenant")',false);
    await seed(`Game.Upgrades['Sugar frenzy'].unlocked=1;Game.Upgrades['Sugar frenzy'].bought=0;Game.prefs.askLumps=1`);
    const lumps=await e('Game.lumps');const frenzy=await act('buy_upgrade',{name:'Sugar frenzy'});assert.equal(frenzy.status,'awaiting_confirmation');
    await act('prompt_respond',{expected_prompt:frenzy.result.prompt.token,option:0});await check('Game.lumps',lumps-1);await check('!!Game.hasBuff("Sugar frenzy")');
  });

  await run('garden','plant, harvest, soil, freeze, lump refill and sacrifice',async()=>{
    await minigames(); await act('minigame_open',{name:'Farm',open:true}); await check('!!Game.Objects.Farm.onMinigame');
    await seed(`(()=>{const M=Game.Objects.Farm.minigame;M.reset(true);M.plantsById.forEach(p=>p.unlocked=1);M.plantsUnlockedN=M.plantsN;M.buildPanel();M.nextSoil=0;return true;})()`);
    const tile = await e(`(()=>{const M=Game.Objects.Farm.minigame;for(let y=0;y<6;y++)for(let x=0;x<6;x++)if(M.isTileUnlocked(x,y))return {x,y};})()`);
    await act('garden_select_seed',{seed_index:0}); await check('Game.Objects.Farm.minigame.seedSelected',0);
    await act('garden_plant',{seed_index:0,...tile}); await check(`Game.Objects.Farm.minigame.plot[${tile.y}][${tile.x}][0]`,1);
    await act('garden_harvest',tile); await check(`Game.Objects.Farm.minigame.plot[${tile.y}][${tile.x}][0]`,0);
    await act('garden_click_tile',tile); await check(`Game.Objects.Farm.minigame.plot[${tile.y}][${tile.x}][0]`,1);
    await seed(`Game.Objects.Farm.minigame.plot[${tile.y}][${tile.x}][1]=100`);
    const harvests=await e('Game.Objects.Farm.minigame.harvestsTotal');
    await act('garden_harvest_all',{mature_only:true}); await check('Game.Objects.Farm.minigame.harvestsTotal',harvests+1);
    for(const soil_id of [1,2,3,4,0]) {await seed('Game.Objects.Farm.minigame.nextSoil=0');await act('garden_soil',{soil_id});await check('Game.Objects.Farm.minigame.soil',soil_id);}
    for(const frozen of [true,false]) {await act('garden_freeze',{frozen});await check('!!Game.Objects.Farm.minigame.freeze',frozen);}
    const lumps=await e('Game.lumps');await act('garden_recharge');await check('Game.lumps',lumps-1);
    const before=await e('Game.Objects.Farm.minigame.convertTimes');await act('garden_sacrifice',{confirm:true});await check('Game.Objects.Farm.minigame.convertTimes',before+1);
    await act('minigame_open',{name:'Farm',open:false});await check('!!Game.Objects.Farm.onMinigame',false);
  });

  await run('pantheon','slot every spirit, remove and refill',async()=>{
    await minigames();await act('minigame_open',{name:'Temple'});
    const ids=await e('Game.Objects.Temple.minigame.godsById.map(g=>g.id)');
    for(const spirit_index of ids){await seed('Game.Objects.Temple.minigame.swaps=3');await act('pantheon_set',{spirit_index,slot_index:0});await check('Game.Objects.Temple.minigame.slot[0]',spirit_index);}
    await act('pantheon_remove',{slot_index:0});await check('Game.Objects.Temple.minigame.slot[0]',-1);
    await seed('Game.Objects.Temple.minigame.swaps=0;Game.lumpRefill=0');const lumps=await e('Game.lumps');await act('pantheon_recharge');await check('Game.Objects.Temple.minigame.swaps',3);await check('Game.lumps',lumps-1);
  });

  await run('grimoire','cast every spell and recharge with a lump',async()=>{
    await minigames();await act('minigame_open',{name:'Wizard tower'});
    const ids=await e('Game.Objects["Wizard tower"].minigame.spellsById.map(s=>s.id)');
    for(const spell_index of ids){
      await seed('Game.Objects["Wizard tower"].minigame.magic=Game.Objects["Wizard tower"].minigame.magicM;Game.gainBuff("frenzy",180,7);Game.Objects.Farm.amount=50;Game.elderWrath=3;Object.assign(Game.wrinklers[0],{phase:2,hp:3,sucked:1000})');
      const before=await e('Game.Objects["Wizard tower"].minigame.spellsCastTotal');await act('cast_spell',{spell_index});await until(()=>e(`Game.Objects['Wizard tower'].minigame.spellsCastTotal>${before}`));await check(`Game.Objects['Wizard tower'].minigame.spellsCastTotal>${before}`);
    }
    await seed('Game.Objects["Wizard tower"].minigame.magic=0;Game.lumpRefill=0');const lumps=await e('Game.lumps');await act('grimoire_recharge');await check('Game.lumps',lumps-1);await check('Game.Objects["Wizard tower"].minigame.magic>0');
  });

  await run('stock','every good, brokers, office, all loans and graph settings',async()=>{
    await minigames();await act('minigame_open',{name:'Bank'});
    await seed('Game.Objects.Bank.minigame.reset(true);Game.Objects.Bank.minigame.goodsById.forEach(g=>{g.active=1;g.last=0;});Game.CalculateGains()');
    const goods=await e('Game.Objects.Bank.minigame.goodsById.map(g=>({id:g.id,name:g.name}))');
    for(const g of goods){
      await seed(`Game.Objects.Bank.minigame.goodsById[${g.id}].last=0`);
      await act('stock_buy',{ticker:String(g.id),quantity:2});await check(`Game.Objects.Bank.minigame.goodsById[${g.id}].stock`,2);
      await seed(`Game.Objects.Bank.minigame.goodsById[${g.id}].last=0`);
      await act('stock_sell',{ticker:String(g.id),quantity:1});await check(`Game.Objects.Bank.minigame.goodsById[${g.id}].stock`,1);
    }
    await seed('Game.Objects.Bank.minigame.goodsById.forEach(g=>g.last=0)');await act('stock_sell_all');await check('Game.Objects.Bank.minigame.goodsById.every(g=>g.stock===0)');
    await act('stock_buy_broker');await check('Game.Objects.Bank.minigame.brokers',1);
    for(let i=0;i<5;i++){await seed('Game.Objects.Cursor.amount=2000');await act('stock_upgrade_office');await check('Game.Objects.Bank.minigame.officeLevel',i+1);}
    for(const loan_id of [1,2,3]){await act('stock_take_loan',{loan_id});await check(`!!Game.hasBuff('Loan ${loan_id}')`);}
    await act('stock_graph',{lines:false,colors:false});await check('!!Game.Objects.Bank.minigame.graphLines',false);
    await act('stock_graph',{lines:true,colors:true});await check('!!Game.Objects.Bank.minigame.graphCols');
    for(const visible of [false,true]){await act('stock_visibility',{ticker:'0',visible});await check('!Game.Objects.Bank.minigame.goodsById[0].hidden',visible);}
  });

  await run('dragon','egg, every training level, two auras and pet',async()=>{
    await minigames();await grant(['Pet the dragon']);
    await seed('Game.dragonLevel=0;Game.Upgrades["A crumbly egg"].unlocked=1;Game.Upgrades["A crumbly egg"].bought=0');
    await act('buy_upgrade',{name:'A crumbly egg'});await act('special_menu',{tab:'dragon'});await check('Game.specialTab','dragon');
    const max=await e('Game.dragonLevels.length-1');
    for(let level=1;level<=max;level++){await seed('Game.ObjectsById.forEach(b=>b.amount=Math.max(b.amount,500));Game.BuildingsOwned=Game.ObjectsById.reduce((s,b)=>s+b.amount,0)');await act('upgrade_dragon');await check('Game.dragonLevel',level);}
    await act('dragon_set_aura',{aura_id:15,slot:0});await check('Game.dragonAura',15);
    await act('dragon_set_aura',{aura_id:10,slot:1});await check('Game.dragonAura2',10);
    await act('dragon_pet',{count:5});await check('Game.lastClickedSpecialPic>0');await act('special_menu',{tab:'close'});
  });

  await run('seasons','five seasons, seasonal purchases, Santa and shimmers',async()=>{
    await normal();await grant(['Season switcher']);
    await seed('Object.values(Game.seasons).forEach(s=>s.triggerUpgrade.unlocked=1)');
    const seasonal={christmas:'A festive hat',valentines:'Pure heart biscuits',fools:null,easter:'Chicken egg',halloween:'Skull cookies'};
    for(const [season,upgrade] of Object.entries(seasonal)){
      await act('set_season',{season});await check('Game.season',season);
      if(upgrade){await seed(`Game.Upgrades[${q(upgrade)}].unlocked=1;Game.Upgrades[${q(upgrade)}].bought=0`);await act('buy_upgrade',{name:upgrade});await check(`!!Game.Has(${q(upgrade)})`);}
    }
    await act('set_season',{season:'christmas'});await act('special_menu',{tab:'santa'});
    await seed('Game.santaLevel=0');for(let level=1;level<15;level++){await act('upgrade_santa');await check('Game.santaLevel',level);}
    await seed(`(()=>{new Game.shimmer('reindeer');const s=new Game.shimmer('golden');s.force='lucky';return true;})()`);
    const r=await act('click_shimmers',{kind:'all'});assert.ok(r.result.clicked.length>=2);
    const before=await e('Game.goldenClicks');await seed(`(()=>{const s=new Game.shimmer('golden',{noWrath:true});s.force='lucky';s.spawnLead=1;return true;})()`);
    await act('click_golden_cookie',{index:0});await check('Game.goldenClicks',before+1);
    await act('set_season',{season:''});await check('Game.season',await e('Game.baseSeason'));
  });

  await run('cookies','fortune news, wrinkler click/pop and lump harvest',async()=>{
    await minigames();await grant(['Fortune cookies']);
    await seed(`Game.Upgrades['Fortune #001'].unlocked=0;Game.TickerEffect={type:'fortune',sub:Game.Upgrades['Fortune #001']}`);
    await act('click_ticker',{fortune_only:true});await check('!!Game.Upgrades["Fortune #001"].unlocked');
    await seed('Game.elderWrath=3;Object.assign(Game.wrinklers[0],{phase:2,hp:3,clicks:0,sucked:10000,type:0});Object.assign(Game.wrinklers[1],{phase:2,hp:3,clicks:0,sucked:10000,type:1})');
    await act('wrinkler_click',{id:0});await check('Game.wrinklers[0].clicks',1);
    const before=await e('Game.wrinklersPopped');await act('wrinkler_pop',{id:0});await until(()=>e(`Game.wrinklersPopped>${before}`));
    await act('wrinkler_pop_all');await check('Game.wrinklers[1].phase>0');
    await act('wrinkler_pop_all',{include_shiny:true});await until(()=>e('Game.wrinklers[1].phase===0'));
    await seed('Game.lumpCurrentType=0;Game.lumpT=Date.now()-Game.lumpRipeAge-1000');const lumps=await e('Game.lumps');await act('harvest_lump');await check('Game.lumps',lumps+1);
  });

  await run('ui','settings, menus, UI events, prompts and tiny-cookie achievement',async()=>{
    await minigames();await act('rename_bakery',{name:'MCP acceptance'});await check('Game.bakeryName','MCP acceptance');
    const before=await e('!!Game.prefs.particles');await act('toggle_pref',{name:'particles'});await check('!!Game.prefs.particles',!before);await act('set_pref',{name:'particles',enabled:before});await check('!!Game.prefs.particles',before);
    for(const channel of ['sfx','music','filter'])await act('set_volume',{channel,value:25});await check('Game.volume',25);
    await act('show_menu',{menu:'stats'});await act('click_tiny_cookie');await check('!!Game.HasAchiev("Tiny cookie")');
    await act('inspect_ui',{limit:1000});
    await act('ui_scroll',{target:'centerArea',y:300});await check('document.getElementById("centerArea").scrollTop>0');
    await act('ui_click',{target:'prefsButton'});await check('Game.onMenu','prefs');
    await seed(`Game.bakeryNamePrompt()`);
    await act('ui_set_input',{target:'bakeryNameInput',value:'UI verified'});
    const p=await call('get_ui_state');await act('prompt_respond',{expected_prompt:p.result.prompt.token,option:0});await check('Game.bakeryName','UI verified');
    await seed('Game.bakeryNamePrompt()');await act('prompt_cancel');await check('!!Game.promptOn',false);
    await act('show_menu',{menu:''});const clicks=await e('Game.cookieClicks');await act('ui_pointer',{target:'bigCookie',event:'click',x:0.5,y:0.5});await check('Game.cookieClicks',clicks+1);
    await seed('Game.Notify("MCP notice","dismiss me",[0,0],60)');await act('dismiss_notifications');await check('Game.Notes.every(n=>!n || n.life<=0 || n.dying)',true);
    await act('minigame_open',{name:'Temple'});await seed('Game.Objects.Temple.minigame.swaps=3');
    await act('ui_drag',{from:'templeGodDrag0',to:'templeSlot0'});await check('Number(Game.Objects.Temple.minigame.slot[0])',0);
  });

  await run('selectors','every shop selector, jukebox and clone customization',async()=>{
    await minigames();await grant(['Classic dairy selection','Basic wallpaper assortment','Golden cookie alert sound','Sound test']);
    await seed('Object.values(Game.UpgradesById).filter(u=>u.choicesFunction).forEach(u=>{u.unlocked=1;u.bought=1})');
    const selectors=await e('Object.values(Game.UpgradesById).filter(u=>u.choicesFunction).map(u=>({id:u.id,name:u.name}))');
    for(const selector of selectors){
      const r=await act('upgrade_choices',{id:selector.id});
      if(r.result.choices.kind==='list'){
        await act('upgrade_choose',{id:selector.id,choice_id:1});
        const field={'Milk selector':'milkType','Background selector':'bgType','Golden cookie sound selector':'chimeType'}[selector.name];
        if(field)await check(`Game.${field}`,1);
      } else {
        await act('ui_set_input',{target:'jukeboxSoundSelect',value:'1'});await check('Game.jukebox.onSound',1);
        const loop=await e('!!Game.jukebox.trackLooped');await act('ui_click',{target:'jukeboxMusicLoop'});await check('!!Game.jukebox.trackLooped',!loop);
      }
    }
    await act('show_menu',{menu:''});const ui=await call('get_ui_state',{limit:1000});
    const customize=ui.result.elements.find(el=>el.tag==='a'&&el.text==='Customize');assert.ok(customize,'Clone Customize control is discoverable');
    await act('ui_click',{target:customize.ref});const before=await e('Game.YouCustomizer.currentGenes[0]');
    await act('ui_click',{target:'customizerSelect-R-hair'});await check('Game.YouCustomizer.currentGenes[0]!=='+before);await act('prompt_cancel');
  });

  await run('gifts','create and redeem a gift via MCP',async()=>{
    await normal();await grant(['Wrapping paper']);await seed('Game.killBuff("Gifted out")');
    const r=await act('gift_create',{cookies:12,message:'MCP integration',design:0});assert.ok(r.result.code);
    await act('prompt_cancel');await seed('Game.killBuff("Gifted out");Game.seed="different-recipient"');
    const before=await e('Game.cookiesReceived');await act('gift_redeem',{code:r.result.code});await check('Game.cookiesReceived',before+12);await act('prompt_cancel');
  });

  await run('prestige','ascend, heavenly purchases, permanent slots and reincarnate',async()=>{
    await normal();await seed(`Game.Upgrades['Reinforced index finger'].unlocked=1;Game.Upgrades['Reinforced index finger'].bought=1;Game.cookiesReset=0;Game.prestige=0;Game.heavenlyChips=0;Game.cookiesEarned=1e30`);
    await act('ascend',{confirm:true});await until(()=>e('!!Game.OnAscend && !Game.AscendTimer'));
    await seed(`Game.Upgrades['Legacy'].bought=0;Game.Upgrades['Permanent upgrade slot I'].bought=0`);
    await act('buy_heavenly_upgrade',{name:'Legacy'});await check('!!Game.Has("Legacy")');
    await act('buy_heavenly_upgrade',{name:'Permanent upgrade slot I'});await act('prompt_cancel');
    const id=await e('Game.Upgrades["Reinforced index finger"].id');await act('permanent_slot',{slot:0,upgrade_id:id});await check('Game.permanentUpgrades[0]',id);
    await act('ascension_view',{x:20,y:30,zoom:0.8});await check('Game.AscendOffXT',20);
    await act('ascension_mode',{mode:1});await check('Game.nextAscensionMode',1);await act('ascension_mode',{mode:0});
    await act('reincarnate');await until(()=>e('!Game.OnAscend && !Game.ReincarnateTimer'));await check('Game.ascensionMode',0);await check('!!Game.Has("Reinforced index finger")');
  });

  await run('negative','invalid parameters, resources, cooldowns and stale references',async()=>{
    await normal();await seed('Game.cookies=0;Game.lumps=0');
    await rejected('buy_building',{name:'Cursor'},'Game.Objects.Cursor.amount');
    await rejected('sugarlump_use',{name:'Farm'},'Game.Objects.Farm.level');
    await rejected('buy_building',{name:'Cursor',quantity:-1},'Game.Objects.Cursor.amount');
    await rejected('ascend',{},'Game.resets');await rejected('hard_reset',{confirm:false},'Game.resets');
    await rejected('click_shimmer',{shimmer_id:99999999});
    await rejected('prompt_respond',{expected_prompt:'prompt-stale',option:0});
    await rejected('ui_click',{target:'cb-element-stale'});
    await rejected('import_save',{save:'not a save',confirm:true},'Game.Objects.Cursor.amount');
    await minigames();await seed('Game.lumpRefill=Date.now()');await rejected('grimoire_recharge',{},'Game.lumps');
    await seed('Game.Objects.Farm.minigame.nextSoil=Date.now()+3600000');await rejected('garden_soil',{soil_id:1},'Game.Objects.Farm.minigame.soil');
  });

  await run('queue','action IDs, polling, generic alias and queue cancellation',async()=>{
    await normal();const r=await call('enqueue_game_action',{type:'rename_bakery',parameters:{name:'Receipt identity'},wait_for_result:false});
    const receipt=await call('get_action_result',{id:r.id,wait_ms:10000});assert.equal(receipt.status,'succeeded');await check('Game.bakeryName','Receipt identity');
    await seed('CookieBridge.pausar()');const pending=await call('enqueue_game_action',{type:'click_cookie',parameters:{},wait_for_result:false});
    const queue=await call('get_action_queue');assert.ok(queue.fila.some(a=>a._bridge.id===pending.id));
    const cleared=await call('clear_action_queue');assert.ok(cleared.cancelled.includes(pending.id));
    const cancelled=await call('get_action_result',{id:pending.id},true);assert.equal(cancelled.status,'cancelled');await seed('CookieBridge.retomar()');
  });

  await run('persistence','export, reset, import and reload',async()=>{
    await normal();await act('rename_bakery',{name:'Save roundtrip'});const before=await e('Game.Objects.Cursor.amount');
    const saved=await act('export_save');assert.ok(saved.result.save.length>100);
    await act('hard_reset',{confirm:true});await check('Game.BuildingsOwned',0);
    await act('import_save',{save:saved.result.save,confirm:true});await check('Game.Objects.Cursor.amount',before);await check('Game.bakeryName','Save roundtrip');
    await act('force_save');await e('location.reload()');await until(()=>e('!!Game.ready && !!window.CookieBridge && Game.bakeryName==="Save roundtrip"'));await check('Game.bakeryName','Save roundtrip');
    await until(async()=>(await json(bridgeURL+'/capabilities')).state_age_ms<2000);
    await act('set_language',{language:'FR'});await until(()=>e('!!Game.ready && locId==="FR"'),30000);
    await until(async()=>(await json(bridgeURL+'/capabilities')).state_age_ms<2000);
    await act('set_language',{language:'EN'});await until(()=>e('!!Game.ready && locId==="EN"'),30000);
    await check('Game.bakeryName','Save roundtrip');
  });
} finally {
  const passed=new Set(report.cases.filter(c=>c.status==='passed').flatMap(c=>c.calls.filter(c=>!c.error&&c.status!=='failed').map(c=>c.tool)));
  report.coverage={registered:allTools.length,passed:allTools.filter(n=>passed.has(n)).length,missing:allTools.filter(n=>!passed.has(n))};
  report.exceptions=cdp.exceptions;
  report.finished_at=new Date().toISOString();
  report.status=report.cases.length>0 && report.exceptions.length===0 && report.cases.every(c=>c.status==='passed') && (selected || report.coverage.missing.length===0) ? 'passed':'failed';
  await fs.writeFile(path.join(output,selected?'report-'+selected.replaceAll(',','-')+'.json':'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({status:report.status,cases:report.cases.length,failed:report.cases.filter(c=>c.status==='failed').map(c=>c.group),coverage:report.coverage}));
  await t.close();if(report.status!=='passed')process.exitCode=1;
}
