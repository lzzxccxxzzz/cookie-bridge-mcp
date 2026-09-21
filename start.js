/*
	intruder! intruder! someone breached into the core files!
	nah just kidding, just poke around responsibly and try not to break stuff
*/
const {app,BrowserWindow,screen,ipcMain,dialog,shell}=require('electron');
const path=require('path');
const fs=require('fs');
const AdmZip=require('adm-zip');
let greenworks;
let greenworksLaunched=false;

// ═══════════════════════════════════════════════════════════════════════════
// Cookie Bridge — HTTP Server (main process, port 8000)
// ═══════════════════════════════════════════════════════════════════════════
const httpMod = require('http');
const API_PORT = Number(process.env.COOKIE_BRIDGE_PORT || 8000);
if (!Number.isInteger(API_PORT) || API_PORT < 1 || API_PORT > 65535) throw new Error('Invalid COOKIE_BRIDGE_PORT');
const TEST_MODE = process.env.COOKIE_BRIDGE_TEST_MODE === '1';
const TEST_ROOT = process.env.COOKIE_BRIDGE_TEST_ROOT;
if (TEST_MODE && (!TEST_ROOT || !path.isAbsolute(TEST_ROOT))) throw new Error('Test mode requires an absolute COOKIE_BRIDGE_TEST_ROOT');
const BRIDGE_DATA = TEST_MODE ? path.join(TEST_ROOT, 'bridge-data') : path.join(require('os').homedir(), 'CookieBridge');
if (TEST_MODE) {
  app.setPath('userData', path.join(TEST_ROOT, 'profile'));
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  greenworksLaunched = true; // Isolated tests never initialize Steam services.
}
const API_HOST = '127.0.0.1';
let _state = null;
let _stateLog = [];
const CONTROL_DIR = fs.existsSync(path.join(__dirname, 'mod_api', 'control-schema.js'))
  ? path.join(__dirname, 'mod_api') : path.join(__dirname, 'mods', 'local', 'mod_api');
const CONTROL_SCHEMA = require(path.join(CONTROL_DIR, 'control-schema.js'));
const SECURITY = require(path.join(CONTROL_DIR, 'control-security.js'));
const _security = SECURITY.createSecurity({port: API_PORT, directory: BRIDGE_DATA});
const _controlQueue = require(path.join(CONTROL_DIR, 'control-queue.js')).createQueue({storagePath: path.join(BRIDGE_DATA, 'actions.json')});
function _enqueue(action) {
  if (!_state || !_state.control || _state.control.api_version !== CONTROL_SCHEMA.version) {
    throw {status: 503, message: 'Matching Cookie Bridge v3 renderer is not connected. Install all mod_api files and restart the game.'};
  }
  if (Date.now() - _state.timestamp > 15000) throw {status: 503, message: 'Game state is stale; no action was queued.'};
  return _controlQueue.enqueue(action);
}

const BUILDINGS = ['Cursor','Grandma','Farm','Mine','Factory','Bank','Temple',
  'Wizard tower','Shipment','Alchemy lab','Portal','Time machine',
  'Antimatter condenser','Prism','Chancemaker','Fractal engine',
  'Javascript console','Idleverse','Cortex baker','You'];
const TICKERS = ['CRL','CHC','BTR','SUG','NUT','SLT','VNL','EGG',
  'CNM','CRM','JAM','WCH','HNY','CKI','RCP','SBD','PBL','YOU'];
const PREF_MAP = {
  fancy:{d:'Advanced CSS graphics (shadows, lighting, effects)',inv:false},filters:{d:'CSS filters on building icons',inv:false},
  milk:{d:'Milk wave animation at the bottom',inv:false},cursors:{d:'Animated cursors around the big cookie',inv:false},
  particles:{d:'Falling particles (cookies, spinning light)',inv:false},numbers:{d:'Floating numbers when clicking the cookie',inv:false},
  wobbly:{d:'Cookie wobbles when clicked',inv:false},animate:{d:'Building animations',inv:false},
  crates:{d:'Crates / frames on stats icons',inv:false},monospace:{d:'Monospace font on counters',inv:false},
  cookiesound:{d:'Modern cookie click sound',inv:false},format:{d:'Abbreviate large numbers',inv:false},
  warn:{d:'Warn before closing window',inv:false},focus:{d:'Reduce FPS when window loses focus',inv:false},
  extraButtons:{d:'Extra mute buttons on buildings',inv:false},lumpConfirm:{d:'Confirm before spending sugar lumps',inv:false},
  screenReader:{d:'Screen reader / accessibility mode',inv:false},fastNotes:{d:'Fast notifications (dismiss quickly)',inv:false},
  scary:{d:'Grandmapocalypse visuals (scary grandmas)',inv:true},customGrandmas:{d:'Custom grandma names (Patreon feature)',inv:false},
  autosave:{d:'Auto-save every minute',inv:false},timeout:{d:'Sleep / timeout mode to reduce lag',inv:false},
  cloudSave:{d:'Steam Cloud save',inv:false},bgMusic:{d:'Play background music',inv:false},
  fullscreen:{d:'Fullscreen (Steam only)',inv:false},discordPresence:{d:'Discord Rich Presence',inv:false}
};
const DRAGON_AURAS = {0:'No aura',1:'Breath of Milk (kittens +5% effective)',2:'Dragon Cursor (clicking +5% powerful)',3:'Elder Battalion (grandmas +1% CpS per non-grandma building)',4:'Reaper of Fields (golden cookies may trigger Dragon Harvest)',5:'Earth Shatterer (buildings sell for 50% refund)',6:'Master of the Armory (upgrades cost -2%)',7:'Fierce Hoarder (buildings cost -2%)',8:'Dragon God (+5% prestige CpS effect)',9:'Arcane Aura (golden cookies +5% more frequent)',10:'Dragonflight (golden cookie → ×1111 CpC for 10 s)',11:'Ancestral Metamorphosis (golden cookies give +10% more)',12:'Unholy Dominion (wrath cookies give +10% more)',13:'Epoch Manipulator (golden cookie duration +5%)',14:'Mind Over Matter (random drops +25% more common)',15:'Radiant Appetite (×2 all cookie production)',16:"Dragon's Fortune (+123% CpS per golden cookie on screen)",17:"Dragon's Curve (sugar lumps ripen +5% faster)",18:'Reality Bending (10% of every other aura combined)',19:'Dragon Orbs (sell most expensive building → 10% chance to summon golden cookie)',20:'Supreme Intellect (boosts all minigames while active)',21:'Dragon Guts (+2 wrinkler slots; wrinklers digest and explode for +20% more)'};
const VALID_SEASONS = ['valentines','fools','halloween','christmas','easter',''];
const SOIL_NAMES = {0:'Normal soil',1:'Fertilizer (ticks every 3 min; fast growth)',2:'Clay (ticks every 15 min; +25% passive effects)',3:'Pebbles (auto-collects seeds on expiration)',4:'Woodchips (mutations spread ×3)'};

function _res(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
function _resHtml(res, html) {
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
  // Existing dashboard controls use same-origin fetch and an HttpOnly session.
  html=html.replace('<head>', '<head><script>var esc='+SECURITY.escapeHTML.toString()+';var _cbFetch=window.fetch.bind(window);window.fetch=function(url,options){options=Object.assign({},options);if(new URL(url,location.href).origin===location.origin&&/^(POST|DELETE)$/i.test(options.method||"GET")){options.headers=new Headers(options.headers);if(!options.headers.has("Content-Type"))options.headers.set("Content-Type","application/json");}return _cbFetch(url,options);};</script>');
  res.end(html);
}
function _readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let b = '', bytes = 0, exceeded = false;
    req.setEncoding('utf8');
    req.on('data', c => {
      bytes += Buffer.byteLength(c, 'utf8');
      if (bytes > limit) { exceeded = true; b = ''; return; }
      if (!exceeded) b += c;
    });
    req.on('end', () => {
      if (exceeded) return reject({status: 413, message: 'Request body exceeds the allowed size.'});
      try { resolve(b ? JSON.parse(b) : {}); } catch (_) { reject({status: 400, message: 'Malformed JSON.'}); }
    });
    req.on('error', reject);
  });
}
function _getState() {
  if (!_state) throw {status:503, message:'Game state not yet available. Wait for the mod to connect (1–2 s).'};
  return _state;
}
function _findBuilding(state, nome) {
  const l = nome.toLowerCase();
  return (state.buildings||[]).find(b => b.name.toLowerCase()===l)||null;
}
function _findUpgrade(state, nome) {
  const l = nome.toLowerCase();
  return (state.upgrades_na_loja||[]).find(u => u.name.toLowerCase()===l)||null;
}




// ── Saves / Backup Codes HTML ────────────────────────────────────────────────
const _SAVES_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cookie Bridge — Backup Codes</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#040410;--bg2:#07071a;--bg3:#0a0a20;--bg4:#0d0d26;--border:#181838;--border2:#222248;--c1:#00e5ff;--c2:#69ff47;--c3:#ffea00;--c4:#d500f9;--c5:#ff4081;--c6:#ff6d00;--dim:#28385a;--dim2:#3a5070;--text:#b0bcd0;--text2:#d0daea}
html,body{min-height:100%;background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif}
body::before{content:'';position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:40px 40px;opacity:.3;z-index:0}
header{position:sticky;top:0;z-index:100;background:rgba(7,7,26,.96);backdrop-filter:blur(8px);border-bottom:1px solid var(--border2);padding:0 24px;height:52px;display:flex;align-items:center;gap:12px}
header::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--c1) 20%,var(--c5) 50%,var(--c3) 80%,transparent);opacity:.6}
.logo{color:var(--c3);font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:3px;font-weight:500;text-decoration:none;white-space:nowrap}
.vsep{width:1px;height:24px;background:var(--border2);flex-shrink:0}
.pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-family:'JetBrains Mono',monospace;font-size:10px;border:1px solid;white-space:nowrap}
.pill-b{border-color:var(--c1);color:var(--c1);background:rgba(0,229,255,.07)}
.pill-y{border-color:var(--c3);color:var(--c3);background:rgba(255,234,0,.07)}
.pill-g{border-color:var(--c2);color:var(--c2);background:rgba(105,255,71,.07)}
.spacer{flex:1}
.hbtn{background:var(--bg3);border:1px solid var(--border2);color:var(--dim2);padding:4px 12px;border-radius:4px;font-size:10px;cursor:pointer;text-decoration:none;letter-spacing:.5px;transition:all .15s;font-family:inherit}
.hbtn:hover{border-color:var(--c1);color:var(--c1)}
.page{position:relative;z-index:1;padding:20px 24px 48px}
/* how-to box */
.howto{background:rgba(0,229,255,.04);border:1px solid rgba(0,229,255,.15);border-radius:10px;padding:14px 18px;margin-bottom:22px;display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start}
.howto-step{display:flex;align-items:flex-start;gap:10px;flex:1;min-width:200px}
.step-num{width:22px;height:22px;border-radius:50%;background:var(--c1);color:#000;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.step-text{color:var(--text2);font-size:11px;line-height:1.6}
.step-text b{color:var(--c1)}
/* controls */
.ctrl-row{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap}
.ctrl-label{color:var(--dim2);font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:2px}
.nsel{background:var(--bg4);border:1px solid var(--border2);color:var(--text2);padding:5px 10px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:10px;cursor:pointer;outline:none}
.save-btn{background:rgba(105,255,71,.06);border:1px solid var(--c2);color:var(--c2);padding:5px 14px;border-radius:4px;font-size:10px;font-family:'JetBrains Mono',monospace;cursor:pointer;transition:all .15s;letter-spacing:.5px}
.save-btn:hover{background:rgba(105,255,71,.12)}
/* entries */
.entry{background:rgba(7,7,26,.97);border:1px solid var(--border2);border-radius:10px;padding:16px;margin-bottom:10px;transition:border-color .2s;position:relative;overflow:hidden}
.entry:hover{border-color:#2a2a5a}
.entry::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--c3)00,var(--c3),var(--c3)00);opacity:.5;border-radius:10px 10px 0 0}
.entry-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.ts{color:var(--c1);font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:500}
.run-badge{background:rgba(213,0,249,.1);border:1px solid rgba(213,0,249,.3);color:#d500f9;font-family:'JetBrains Mono',monospace;font-size:9px;padding:2px 8px;border-radius:10px}
.stats-row{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px}
.stat{display:flex;flex-direction:column;gap:2px}
.stat-l{color:var(--dim2);font-size:8px;text-transform:uppercase;letter-spacing:1.5px;font-family:'JetBrains Mono',monospace}
.stat-v{color:var(--text2);font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:500}
.code-box{background:#020208;border:1px solid var(--border2);border-radius:6px;padding:8px 12px;display:flex;align-items:center;gap:10px}
.code-text{color:var(--dim2);font-family:'JetBrains Mono',monospace;font-size:9px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.copy-btn{background:rgba(0,229,255,.07);border:1px solid var(--c1);color:var(--c1);padding:4px 14px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:9px;cursor:pointer;white-space:nowrap;transition:all .15s;letter-spacing:.5px;flex-shrink:0}
.copy-btn:hover{background:rgba(0,229,255,.15)}
.copy-btn.ok{border-color:var(--c2);color:var(--c2);background:rgba(105,255,71,.1)}
.no-save{color:var(--dim);font-size:10px;font-family:'JetBrains Mono',monospace;font-style:italic;padding:4px}
#empty{text-align:center;padding:60px 20px;color:var(--dim2);font-family:'JetBrains Mono',monospace}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(105,255,71,.4)}50%{opacity:.7;box-shadow:0 0 0 4px rgba(105,255,71,0)}}
.pulse{width:6px;height:6px;border-radius:50%;background:var(--c2);animation:pulse 2s infinite;display:inline-block;flex-shrink:0}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:var(--bg)}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
</style>
</head>
<body>
<header>
  <a class="logo" href="/docs"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-2px"><path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4zm-5 16a3 3 0 110-6 3 3 0 010 6zm3-10H5V5h10v4z"/></svg> <span data-i18n="title">BACKUP CODES</span></a>
  <div class="vsep"></div>
  <span class="pill pill-b"><span class="pulse"></span>&nbsp;<span id="h-count">—</span></span>
  <span class="pill pill-y" id="h-size">—</span>
  <span class="pill pill-g" id="h-latest">—</span>
  <div class="spacer"></div>
  <a class="hbtn" href="/charts" data-i18n="charts_lnk">← Charts</a>
  <a class="hbtn" href="/docs">Docs</a>
  <button class="hbtn" id="lang-btn" onclick="toggleLang()">PT</button>
  <button class="hbtn" onclick="load()">↻</button>
</header>
<div class="page">

  <!-- How to restore -->
  <div class="howto">
    <div class="howto-step">
      <div class="step-num">1</div>
      <div class="step-text" data-i18n="step1">Find the save from the time you want to restore and click <b>COPY CODE</b></div>
    </div>
    <div class="howto-step">
      <div class="step-num">2</div>
      <div class="step-text" data-i18n="step2">In Cookie Clicker: <b>Options → Export Save</b> area → click <b>Import Save</b></div>
    </div>
    <div class="howto-step">
      <div class="step-num">3</div>
      <div class="step-text" data-i18n="step3">Paste the code into the text box and click <b>Load</b>. The game reloads from that point.</div>
    </div>
    <div class="howto-step">
      <div class="step-num"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg></div>
      <div class="step-text" data-i18n="step4">Saves are captured every <b>5 minutes</b> automatically. Use <b>Save Now</b> to capture the current state immediately.</div>
    </div>
  </div>

  <!-- Controls -->
  <div class="ctrl-row">
    <span class="ctrl-label" data-i18n="show_lbl">SHOW</span>
    <select class="nsel" id="n-sel" onchange="load()">
      <option value="10">Last 10</option>
      <option value="20" selected>Last 20</option>
      <option value="50">Last 50</option>
      <option value="100">Last 100</option>
      <option value="200">Last 200</option>
    </select>
    <button class="save-btn" onclick="saveNow()"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-2px"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg> <span data-i18n="save_now">Save Now</span></button>
    <span id="save-status" style="color:var(--dim2);font-size:10px;font-family:'JetBrains Mono',monospace"></span>
  </div>

  <!-- List -->
  <div id="list"><div id="empty">Loading backup codes…</div></div>
</div>
<script>
var _NS=['million','billion','trillion','quadrillion','quintillion','sextillion','septillion','octillion','nonillion','decillion','undecillion','duodecillion','tredecillion','quattuordecillion','quindecillion','sexdecillion','septendecillion','octodecillion','novemdecillion','vigintillion'];
function fN(n){if(n===null||n===undefined)return'?';n=+n;if(isNaN(n))return'?';var neg=n<0;if(neg)n=-n;var s;if(n>=1e6){var e=Math.min(Math.floor(Math.log10(n)/3)*3,63);var i=e/3-2;s=(i>=0&&i<_NS.length)?(n/Math.pow(10,e)).toFixed(3)+' '+_NS[i]:n.toExponential(3);}else if(n>=1000){s=Math.round(n).toLocaleString('en-US');}else{s=n.toFixed(1);}return neg?'-'+s:s;}
function fmtTs(iso){var d=new Date(iso);return d.toLocaleDateString()+' '+d.toLocaleTimeString();}
function fmtTsShort(iso){var d=new Date(iso);return d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',second:'2-digit'});}

function copyCode(btn,code){
  navigator.clipboard.writeText(code).then(function(){
    btn.textContent='✓ COPIED';btn.className='copy-btn ok';
    setTimeout(function(){btn.textContent='COPY CODE';btn.className='copy-btn';},2000);
  }).catch(function(){
    var t=document.createElement('textarea');t.value=code;document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);
    btn.textContent='✓ COPIED';btn.className='copy-btn ok';
    setTimeout(function(){btn.textContent='COPY CODE';btn.className='copy-btn';},2000);
  });
}

function renderEntry(e,idx){
  var hasSave=typeof e.save==='string'&&e.save.length>10;
  var codeHtml=hasSave
    ? \`<div class="code-box">
        <span class="code-text" title="\${esc(e.save)}">\${esc(e.save.slice(0,80))}…</span>
        <button class="copy-btn" data-code="\${esc(e.save)}" onclick="copyCode(this,this.dataset.code)">COPY CODE</button>
       </div>\`
    : '<div class="no-save">No save string in this entry (captured before save feature was added)</div>';
  return \`<div class="entry">
    <div class="entry-head">
      <span class="ts">\${fmtTs(e.ts)}</span>
      <span class="run-badge">Run #\${esc(e.run??'?')}</span>
      \${idx===0?'<span style="background:rgba(105,255,71,.08);border:1px solid rgba(105,255,71,.3);color:#69ff47;font-family:JetBrains Mono,monospace;font-size:9px;padding:2px 8px;border-radius:10px">LATEST</span>':''}
    </div>
    <div class="stats-row">
      <div class="stat"><span class="stat-l">Prestige</span><span class="stat-v">\${fN(e.prestige)}</span></div>
      <div class="stat"><span class="stat-l">CpS</span><span class="stat-v">\${fN(e.cps)}</span></div>
      <div class="stat"><span class="stat-l">Bank</span><span class="stat-v">\${fN(e.cookies)}</span></div>
      <div class="stat"><span class="stat-l">Buildings</span><span class="stat-v">\${Number(e.total_buildings||0).toLocaleString('en-US')}</span></div>
      <div class="stat"><span class="stat-l">Upgrades</span><span class="stat-v">\${Number(e.upgrades_bought||0).toLocaleString('en-US')}</span></div>
      <div class="stat"><span class="stat-l">Legacy Gain</span><span class="stat-v">+\${Number(e.legacy_gain||0).toLocaleString('en-US')}</span></div>
    </div>
    \${codeHtml}
  </div>\`;
}

async function saveNow(){
  var st=document.getElementById('save-status');
  st.textContent='saving…';st.style.color='var(--dim2)';
  try{
    var r=await fetch('/db/save/now',{method:'POST'});
    var d=await r.json();
    if(d.ok){st.textContent='✓ saved';st.style.color='var(--c2)';setTimeout(function(){st.textContent='';load();},1200);}
    else{st.textContent='error';st.style.color='var(--c5)';}
  }catch(e){st.textContent='error: '+e.message;st.style.color='var(--c5)';}
}

async function load(){
  var n=document.getElementById('n-sel').value;
  try{
    var[info,saves]=await Promise.all([fetch('/db/info').then(r=>r.json()),fetch('/db/saves?n='+n).then(r=>r.json())]);
    document.getElementById('h-count').textContent=info.count+' saves';
    document.getElementById('h-size').textContent=info.size_mb+'MB';
    document.getElementById('h-latest').textContent=info.last_ts?'latest '+fmtTsShort(info.last_ts):'no saves';
    var list=document.getElementById('list');
    if(!saves.length){list.innerHTML='<div id="empty" style="text-align:center;padding:60px;color:var(--dim2);font-family:JetBrains Mono,monospace">No saves yet.<br><br>The game auto-saves every 5 min. Click Save Now to capture immediately.</div>';return;}
    list.innerHTML=saves.map(renderEntry).join('');
  }catch(e){document.getElementById('list').innerHTML='<div id="empty" style="color:#ff4081;padding:40px;text-align:center;font-family:JetBrains Mono,monospace">Error: '+esc(e.message)+'</div>';}
}
var _L=localStorage.getItem('cb_lang')||'en';
var _TR={
  en:{title:'BACKUP CODES',charts_lnk:'← Charts',step1:'Find the save from the time you want to restore and click <b>COPY CODE</b>',step2:'In Cookie Clicker: <b>Options → Export Save</b> area → click <b>Import Save</b>',step3:'Paste the code into the text box and click <b>Load</b>. The game reloads from that point.',step4:'Saves are captured every <b>5 minutes</b> automatically. Use <b>Save Now</b> to capture the current state immediately.',show_lbl:'SHOW',save_now:'Save Now',last_n:{'10':'Last 10','20':'Last 20','50':'Last 50','100':'Last 100','200':'Last 200'}},
  pt:{title:'BACKUP CODES',charts_lnk:'← Gr\xe1ficos',step1:'Encontre o save do momento que quer restaurar e clique em <b>COPY CODE</b>',step2:'No Cookie Clicker: \xe1rea <b>Op\xe7\xf5es → Exportar Save</b> → clique em <b>Importar Save</b>',step3:'Cole o c\xf3digo na caixa de texto e clique em <b>Load</b>. O jogo recarrega a partir desse ponto.',step4:'Saves s\xe3o capturados a cada <b>5 minutos</b> automaticamente. Use <b>Salvar Agora</b> para capturar imediatamente.',show_lbl:'EXIBIR',save_now:'Salvar Agora',last_n:{'10':'\xdaltimos 10','20':'\xdaltimos 20','50':'\xdaltimos 50','100':'\xdaltimos 100','200':'\xdaltimos 200'}}
};
function _applyLang(){
  var t=_TR[_L]||_TR.en;
  document.querySelectorAll('[data-i18n]').forEach(function(el){var k=el.getAttribute('data-i18n');if(t[k]!==undefined)el.innerHTML=t[k];});
  var ns=document.getElementById('n-sel');
  if(ns&&t.last_n){var opts=ns.options;for(var i=0;i<opts.length;i++){var v=opts[i].value;if(t.last_n[v])opts[i].text=t.last_n[v];}}
  var lb=document.getElementById('lang-btn');if(lb)lb.textContent=_L==='en'?'PT':'EN';
}
function toggleLang(){_L=_L==='en'?'pt':'en';localStorage.setItem('cb_lang',_L);_applyLang();}
_applyLang();
load();
setInterval(load,30000);
</script>
</body>
</html>`;

// ── Charts HTML ──────────────────────────────────────────────────────────────
const _CHARTS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cookie Bridge — Charts</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#040410;--bg2:#07071a;--bg3:#0a0a20;--bg4:#0d0d26;--border:#181838;--border2:#222248;--c1:#00e5ff;--c2:#69ff47;--c3:#ffea00;--c4:#d500f9;--c5:#ff4081;--c6:#ff6d00;--dim:#28385a;--dim2:#3a5070;--text:#b0bcd0;--text2:#d0daea}
html,body{min-height:100%;background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif}
body::before{content:'';position:fixed;inset:0;pointer-events:none;background-image:linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:40px 40px;opacity:.3;z-index:0}
header{position:sticky;top:0;z-index:100;background:rgba(7,7,26,.96);backdrop-filter:blur(8px);border-bottom:1px solid var(--border2);padding:0 24px;height:52px;display:flex;align-items:center;gap:12px}
header::after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,var(--c1) 20%,var(--c4) 50%,var(--c2) 80%,transparent);opacity:.6}
.logo{color:var(--c1);font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:3px;font-weight:500;text-decoration:none;white-space:nowrap}
.vsep{width:1px;height:24px;background:var(--border2);flex-shrink:0}
.pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:20px;font-family:'JetBrains Mono',monospace;font-size:10px;border:1px solid;white-space:nowrap}
.pill-b{border-color:var(--c1);color:var(--c1);background:rgba(0,229,255,.07)}
.pill-g{border-color:var(--c2);color:var(--c2);background:rgba(105,255,71,.07)}
.pill-y{border-color:var(--c3);color:var(--c3);background:rgba(255,234,0,.07)}
.pill-p{border-color:var(--c4);color:var(--c4);background:rgba(213,0,249,.07)}
.spacer{flex:1}
.hbtn{background:var(--bg3);border:1px solid var(--border2);color:var(--dim2);padding:4px 12px;border-radius:4px;font-size:10px;cursor:pointer;text-decoration:none;letter-spacing:.5px;transition:all .15s;font-family:inherit}
.hbtn:hover{border-color:var(--c1);color:var(--c1)}
.page{position:relative;z-index:1;padding:20px 24px 48px}
.info-bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:22px}
.kv{background:rgba(7,7,26,.9);border:1px solid var(--border2);border-radius:8px;padding:8px 14px;min-width:130px}
.kv label{color:var(--dim2);font-size:9px;text-transform:uppercase;letter-spacing:1.5px;display:block;margin-bottom:3px;font-family:'JetBrains Mono',monospace}
.kv span{color:var(--c3);font-size:15px;font-weight:600;font-family:'JetBrains Mono',monospace}
.kv.io span{color:var(--c2)}
.sec{margin-bottom:28px}
.sec-hd{display:flex;align-items:center;gap:10px;margin-bottom:14px}
.sec-title{color:var(--dim2);font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:3px;white-space:nowrap}
.sec-line{flex:1;height:1px;background:var(--border)}
.combo-box{background:rgba(7,7,26,.97);border:1px solid var(--border2);border-radius:12px;padding:20px 22px;position:relative;overflow:hidden}
.combo-box::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--c1),var(--c4),var(--c2));opacity:.5}
.toggles{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
.mtog{display:inline-flex;align-items:center;gap:7px;padding:6px 14px;border-radius:20px;border:1px solid;font-size:10px;font-family:'JetBrains Mono',monospace;cursor:pointer;transition:opacity .15s,filter .15s;user-select:none;letter-spacing:.5px}
.mtog.off{opacity:.3;filter:grayscale(.8)}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.ctrl-bar{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;align-items:center}
.abtn{padding:5px 13px;border-radius:4px;border:1px solid var(--border2);background:var(--bg4);color:var(--dim2);font-size:10px;font-family:'JetBrains Mono',monospace;cursor:pointer;transition:all .12s;letter-spacing:.5px}
.abtn.on{border-color:var(--c1);color:var(--c1);background:rgba(0,229,255,.07)}
.ctrl-sep{width:1px;height:20px;background:var(--border2)}
.chart-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:14px}
.ccard{background:rgba(7,7,26,.97);border:1px solid var(--border2);border-radius:10px;padding:16px;position:relative;overflow:hidden;transition:border-color .2s}
.ccard:hover{border-color:#2a2a5a}
.ch-hd{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
.ch-label{font-family:'JetBrains Mono',monospace;font-size:8px;letter-spacing:2.5px;text-transform:uppercase;color:var(--dim2)}
.ch-sub{color:var(--dim);font-size:9px;margin-top:3px}
.ch-val{font-family:'JetBrains Mono',monospace;font-size:17px;font-weight:600;line-height:1;text-align:right}
.ch-delta{font-size:9px;margin-top:3px;font-family:'JetBrains Mono',monospace;text-align:right;color:var(--dim2)}
canvas{display:block;width:100%!important}
#chart-combined{max-height:200px}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(105,255,71,.4)}50%{opacity:.7;box-shadow:0 0 0 4px rgba(105,255,71,0)}}
.pulse{width:6px;height:6px;border-radius:50%;background:var(--c2);animation:pulse 2s infinite;display:inline-block;flex-shrink:0}
::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-track{background:var(--bg)}::-webkit-scrollbar-thumb{background:var(--border2);border-radius:2px}
</style>
</head>
<body>
<header>
  <a class="logo" href="/docs" data-i18n="title">COOKIE BRIDGE — CHARTS</a>
  <div class="vsep"></div>
  <span class="pill pill-b"><span class="pulse"></span><span id="h-saves">—</span></span>
  <span class="pill pill-y" id="h-size">—</span>
  <span class="pill pill-g" id="h-mem">—</span>
  <span class="pill pill-p" id="h-up">—</span>
  <div class="spacer"></div>
  <a class="hbtn" href="/saves"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-2px"><path d="M17 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V7l-4-4zm-5 16a3 3 0 110-6 3 3 0 010 6zm3-10H5V5h10v4z"/></svg> <span data-i18n="backup_lnk">Backup Codes</span></a>
  <a class="hbtn" href="/docs">← Docs</a>
  <button class="hbtn" id="lang-btn" onclick="toggleLang()">PT</button>
  <button class="hbtn" style="border-color:#ff4444;color:#ff4444" onclick="showReset()"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-2px"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg> <span data-i18n="db_reset">DB Reset</span></button>
  <button class="hbtn" onclick="load()">↻</button>
</header>

<!-- DB Reset modal -->
<div id="reset-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:none;align-items:center;justify-content:center">
  <div style="background:#07071a;border:1px solid #ff4444;border-radius:12px;padding:28px 32px;max-width:400px;width:90%;position:relative">
    <div style="color:#ff4444;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:3px;margin-bottom:12px"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-2px"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg> DB RESET</div>
    <div style="color:#b0bcd0;font-size:13px;margin-bottom:6px">This will permanently delete <code style="color:#ff4081">saves.ndjson</code> and all save history.</div>
    <div style="color:#6878a0;font-size:11px;margin-bottom:16px">Type <b style="color:#ff4444">db reset</b> to confirm:</div>
    <input id="reset-input" type="text" placeholder="db reset" autocomplete="off"
      style="width:100%;background:#0a0a20;border:1px solid #222248;color:#d0daea;padding:8px 12px;border-radius:6px;font-family:'JetBrains Mono',monospace;font-size:13px;outline:none;margin-bottom:14px"
      oninput="document.getElementById('reset-confirm').disabled=this.value!=='db reset'">
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button onclick="hideReset()" style="background:#0a0a20;border:1px solid #222248;color:#6878a0;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:11px">Cancel</button>
      <button id="reset-confirm" disabled onclick="doReset()"
        style="background:#1a0000;border:1px solid #ff4444;color:#ff4444;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:11px;opacity:.4;transition:opacity .15s"
        onmouseenter="if(!this.disabled)this.style.background='#2a0000'" onmouseleave="this.style.background='#1a0000'">DELETE ALL</button>
    </div>
  </div>
</div>
<script>
document.getElementById('reset-confirm').addEventListener('input',function(){});
function showReset(){var o=document.getElementById('reset-overlay');o.style.display='flex';document.getElementById('reset-input').value='';document.getElementById('reset-confirm').disabled=true;document.getElementById('reset-confirm').style.opacity='.4';}
function hideReset(){document.getElementById('reset-overlay').style.display='none';}
function doReset(){fetch('/db/reset',{method:'DELETE'}).then(r=>r.json()).then(d=>{hideReset();if(d.ok){D=[];drawAll();alert('Database wiped. Auto-save will create a new file on next tick.');}else{alert('Error: '+d.error);}}).catch(e=>alert(e.message));}
document.getElementById('reset-input').addEventListener('input',function(){var ok=this.value==='db reset';var btn=document.getElementById('reset-confirm');btn.disabled=!ok;btn.style.opacity=ok?'1':'.4';});
</script>

<div class="page">
  <div class="info-bar" id="info-bar"></div>

  <!-- ── Combined evolution chart ─────────────────────────────────────────── -->
  <div class="sec">
    <div class="sec-hd"><div class="sec-title" data-i18n="sec_evo">EVOLUTION — ALL METRICS</div><div class="sec-line"></div></div>
    <div class="combo-box">
      <div class="toggles" id="m-toggles"></div>
      <div class="ctrl-bar">
        <div class="abtn on" id="b-pct" onclick="setNorm('pct')" data-i18n="tog_pct">% Growth from baseline</div>
        <div class="abtn" id="b-log" onclick="setNorm('log')" data-i18n="tog_log">Log scale (raw)</div>
        <div class="ctrl-sep"></div>
        <div class="abtn" id="b-rel" onclick="setTime('rel')" data-i18n="tog_rel">Relative time</div>
        <div class="abtn on" id="b-abs" onclick="setTime('abs')" data-i18n="tog_abs">Absolute time</div>
      </div>
      <canvas id="chart-combined" height="160"></canvas>
    </div>
  </div>

  <!-- ── Individual metric cards ──────────────────────────────────────────── -->
  <div class="sec">
    <div class="sec-hd"><div class="sec-title" data-i18n="sec_ind">INDIVIDUAL METRICS</div><div class="sec-line"></div></div>
    <div class="chart-grid" id="chart-grid"></div>
  </div>
</div>
<script src="/assets/chart.umd.js"></script>
<script>
const METRICS=[
  {k:'cps',             l:'CpS',       u:'Cookies per second',          c:'#00e5ff'},
  {k:'cpc',             l:'CpC',       u:'Cookies per click',           c:'#69ff47'},
  {k:'cookies',         l:'Bank',      u:'Cookies in bank',             c:'#ffea00'},
  {k:'total_buildings', l:'Buildings', u:'Total buildings owned',       c:'#ff6d00'},
  {k:'upgrades_bought', l:'Upgrades',  u:'Total upgrades purchased',    c:'#d500f9'},
  {k:'legacy_gain',     l:'Legacy',    u:'Prestige gain if ascend now', c:'#ff4081'},
];
var _CH={};
var _NS=['million','billion','trillion','quadrillion','quintillion','sextillion','septillion','octillion','nonillion','decillion','undecillion','duodecillion','tredecillion','quattuordecillion','quindecillion','sexdecillion','septendecillion','octodecillion','novemdecillion','vigintillion'];
function fN(n){if(n===null||n===undefined)return'?';n=+n;if(isNaN(n))return'?';var neg=n<0;if(neg)n=-n;var s;if(n>=1e6){var e=Math.min(Math.floor(Math.log10(n)/3)*3,63);var i=e/3-2;s=(i>=0&&i<_NS.length)?(n/Math.pow(10,e)).toFixed(3)+' '+_NS[i]:n.toExponential(3);}else if(n>=1000){s=Math.round(n).toLocaleString('en-US');}else{s=n.toFixed(1);}return neg?'-'+s:s;}

let D=[],norm='pct',tMode='abs';
const visM=new Set(METRICS.map(m=>m.k));

function setNorm(v){norm=v;['pct','log'].forEach(x=>document.getElementById('b-'+x).className='abtn'+(v===x?' on':''));drawAll();}
function setTime(v){tMode=v;['rel','abs'].forEach(x=>document.getElementById('b-'+x).className='abtn'+(v===x?' on':''));drawAll();}
function xV(r,base){return tMode==='rel'?Math.round((+new Date(r.ts)-base)/60000):+new Date(r.ts);}
function xFmt(v){return tMode==='rel'?v+'m':new Date(v).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});}
function xTip(v){return tMode==='rel'?v+' min into session':new Date(v).toLocaleString();}

function buildToggles(){
  document.getElementById('m-toggles').innerHTML=METRICS.map(m=>
    \`<div class="mtog" id="tog-\${m.k}" style="border-color:\${m.c};color:\${m.c};background:\${m.c}18" onclick="toggleM('\${m.k}')">
       <div class="dot" style="background:\${m.c}"></div>\${m.l}
     </div>\`
  ).join('');
}
function toggleM(k){if(visM.has(k))visM.delete(k);else visM.add(k);document.getElementById('tog-'+k).className='mtog'+(visM.has(k)?'':' off');drawAll();}

function buildGrid(){
  const g=document.getElementById('chart-grid');g.innerHTML='';
  METRICS.forEach(m=>{
    const d=document.createElement('div');d.className='ccard';
    d.innerHTML=\`<div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,\${m.c}00,\${m.c},\${m.c}00);border-radius:10px 10px 0 0"></div>
      <div class="ch-hd">
        <div><div class="ch-label">\${m.l}</div><div class="ch-sub">\${m.u}</div></div>
        <div><div class="ch-val" style="color:\${m.c}" id="cv-\${m.k}">—</div><div class="ch-delta" id="cd-\${m.k}"></div></div>
      </div>
      <canvas id="ca-\${m.k}" height="130"></canvas>\`;
    g.appendChild(d);
  });
}

function drawAll(){if(!D.length)return;drawCombined();drawIndividual();}

function drawCombined(){
  const base=D.length?+new Date(D[0].ts):0;
  const datasets=METRICS.filter(m=>visM.has(m.k)).map(m=>{
    const rows=D.filter(r=>(+(r[m.k])||0)>0);
    if(!rows.length)return null;
    let pts;
    if(norm==='pct'){
      const first=+(rows[0][m.k])||1;
      pts=rows.map(r=>({x:xV(r,base),y:+((+(r[m.k])/first-1)*100).toFixed(2)}));
    }else{
      pts=rows.map(r=>({x:xV(r,base),y:+(r[m.k])>0?+Math.log10(+(r[m.k])).toFixed(3):0}));
    }
    return{label:m.l,data:pts,borderColor:m.c,backgroundColor:m.c+'14',borderWidth:2,pointRadius:2.5,pointBackgroundColor:m.c,tension:0.3,fill:false,showLine:true};
  }).filter(Boolean);
  if(_CH.combo){_CH.combo.destroy();delete _CH.combo;}
  const ctx=document.getElementById('chart-combined');if(!ctx)return;
  _CH.combo=new Chart(ctx,{
    type:'scatter',data:{datasets},
    options:{
      animation:false,responsive:true,maintainAspectRatio:true,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:true,position:'top',labels:{color:'#8090b0',font:{size:10,family:'JetBrains Mono'},boxWidth:10,padding:18,usePointStyle:true,pointStyle:'circle'}},
        tooltip:{backgroundColor:'rgba(4,4,20,.97)',borderColor:'rgba(255,255,255,.08)',borderWidth:1,titleColor:'#8090b0',bodyColor:'#c0ccd8',padding:12,itemSort:(a,b)=>b.parsed.y-a.parsed.y,
          callbacks:{title:items=>xTip(items[0].parsed.x),label:c=>' '+c.dataset.label+':  '+(norm==='pct'?(c.parsed.y>=0?'+':'')+c.parsed.y.toFixed(2)+'%':c.parsed.y.toFixed(2)+' log₁₀')}}
      },
      scales:{
        x:{type:'linear',ticks:{color:'#28385a',font:{size:9,family:'JetBrains Mono'},maxTicksLimit:8,callback:v=>xFmt(v)},grid:{color:'rgba(24,24,56,.5)',drawBorder:false}},
        y:{ticks:{color:'#6070a0',font:{size:9,family:'JetBrains Mono'},callback:v=>norm==='pct'?(v>=0?'+':'')+v+'%':v.toFixed(1)},grid:{color:'rgba(24,24,56,.5)',drawBorder:false},
           title:{display:true,text:norm==='pct'?'% growth from baseline':'log₁₀ (value)',color:'#3a5070',font:{size:9,family:'JetBrains Mono'}}}
      }
    }
  });
}

function drawIndividual(){
  const base=D.length?+new Date(D[0].ts):0;
  METRICS.forEach(m=>{
    const pts=D.map(r=>({x:xV(r,base),y:+(r[m.k])||0}));
    const lv=D.length?+(D[D.length-1][m.k]):null;
    const cv=document.getElementById('cv-'+m.k);if(cv)cv.textContent=lv!=null?fN(lv):'—';
    const cd=document.getElementById('cd-'+m.k);
    if(cd&&D.length>1){const prev=+(D[D.length-2][m.k])||0,delta=(lv||0)-prev;cd.textContent=(delta>=0?'+':'')+fN(delta)+' last';cd.style.color=delta>=0?'#69ff47':'#ff4081';}
    if(_CH[m.k]){_CH[m.k].destroy();delete _CH[m.k];}
    const ctx=document.getElementById('ca-'+m.k);if(!ctx)return;
    _CH[m.k]=new Chart(ctx,{type:'scatter',data:{datasets:[{data:pts,borderColor:m.c,backgroundColor:m.c+'18',borderWidth:1.5,pointRadius:1.5,pointBackgroundColor:m.c,tension:0.3,fill:true,showLine:true}]},
      options:{animation:false,responsive:true,plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(4,4,20,.95)',borderColor:m.c+'40',borderWidth:1,titleColor:m.c,bodyColor:'#a0b0c8',callbacks:{title:items=>xTip(items[0].parsed.x),label:c=>fN(c.parsed.y)}}},
        scales:{x:{type:'linear',ticks:{color:'#28385a',font:{size:8,family:'JetBrains Mono'},maxTicksLimit:6,callback:v=>xFmt(v)},grid:{color:'rgba(24,24,56,.5)',drawBorder:false}},y:{ticks:{color:'#6070a0',font:{size:9,family:'JetBrains Mono'},callback:v=>fN(v)},grid:{color:'rgba(24,24,56,.5)',drawBorder:false}}}}
    });
  });
}

async function load(){
  try{
    const[info,hist,io]=await Promise.all([fetch('/db/info').then(r=>r.json()),fetch('/db/history?n=5000').then(r=>r.json()),fetch('/io').then(r=>r.json())]);
    D=hist;
    document.getElementById('h-saves').textContent=info.count+' saves';
    document.getElementById('h-size').textContent=info.size_mb+'MB';
    document.getElementById('h-mem').textContent=io.memory.heap_used_mb+'MB / '+io.os.total_mem_mb+'MB';
    document.getElementById('h-up').textContent=Math.round(io.uptime_s/60)+'min up';
    document.getElementById('info-bar').innerHTML=
      [['Saves indexed',info.count],['DB size',info.size_mb+'MB'],['Interval',info.interval_min+'min'],['First save',info.first_ts?new Date(info.first_ts).toLocaleString():'—'],['Last save',info.last_ts?new Date(info.last_ts).toLocaleString():'—'],['Bakery',info.last_bakery||'—']].map(([l,v])=>\`<div class="kv"><label>\${esc(l)}</label><span>\${esc(v)}</span></div>\`).join('')+
      [['RAM',io.memory.heap_used_mb+'/'+io.os.total_mem_mb+'MB'],['Free',io.os.free_mem_mb+'MB'],['CPUs',io.os.cpus],['Up',Math.round(io.uptime_s/60)+'min'],['OS',Math.round(io.os.uptime_s/3600)+'h']].map(([l,v])=>\`<div class="kv io"><label>\${esc(l)}</label><span>\${esc(v)}</span></div>\`).join('');
    if(!hist.length){document.getElementById('chart-grid').innerHTML='<p style="color:var(--dim2);padding:40px;grid-column:1/-1;text-align:center;font-family:JetBrains Mono,monospace;font-size:12px">No data yet — DB auto-saves every 5 min.<br><br>Trigger a save now: <code style="color:var(--c1)">POST /db/save/now</code></p>';return;}
    drawAll();
  }catch(e){console.error('[charts]',e);}
}
var _LC=localStorage.getItem('cb_lang')||'en';
var _TRC={
  en:{title:'COOKIE BRIDGE — CHARTS',backup_lnk:'Backup Codes',db_reset:'DB Reset',tog_pct:'% Growth from baseline',tog_log:'Log scale (raw)',tog_rel:'Relative time',tog_abs:'Absolute time',sec_evo:'EVOLUTION — ALL METRICS',sec_ind:'INDIVIDUAL METRICS'},
  pt:{title:'COOKIE BRIDGE — GR\xc1FICOS',backup_lnk:'Backup Codes',db_reset:'Resetar BD',tog_pct:'% Crescimento vs base',tog_log:'Escala log (raw)',tog_rel:'Tempo relativo',tog_abs:'Tempo absoluto',sec_evo:'EVOLU\xc7\xc3O — TODAS AS M\xc9TRICAS',sec_ind:'M\xc9TRICAS INDIVIDUAIS'}
};
function _applyCLang(){
  var t=_TRC[_LC]||_TRC.en;
  document.querySelectorAll('[data-i18n]').forEach(function(el){var k=el.getAttribute('data-i18n');if(t[k]!==undefined)el.innerHTML=t[k];});
  var lb=document.getElementById('lang-btn');if(lb)lb.textContent=_LC==='en'?'PT':'EN';
}
function toggleLang(){_LC=_LC==='en'?'pt':'en';localStorage.setItem('cb_lang',_LC);_applyCLang();}
buildToggles();buildGrid();_applyCLang();load();setInterval(load,30000);
</script>
</body>
</html>`;

// ── Save DB ──────────────────────────────────────────────────────────────────
const _os      = require('os');
const _DB_DIR  = BRIDGE_DATA;
const _DB_FILE = path.join(_DB_DIR, 'saves.ndjson');
const _DB_MS   = 5 * 60 * 1000; // every 5 min
let   _DB_COUNT = 0; // loaded on first /db/info

function _buildDbEntry(st) {
  const es = st.estatisticas || {};
  const bs = st.buildings    || [];
  return {
    ts:              new Date().toISOString(),
    bakery:          st.bakery_name || '',
    run:             es.ascensoes || 0,
    prestige:        es.prestige  || 0,
    heavenly_chips:  es.heavenly_chips || 0,
    legacy_gain:     (st.legado||{}).ganho_prestige || 0,
    cps:             st.cookies_por_segundo_raw || st.cookies_por_segundo || 0,
    cpc:             st.cookies_por_click || 0,
    cookies:         st.cookies_na_conta || 0,
    total_buildings: bs.reduce((s,b)=>s+b.amount,0),
    upgrades_bought: (st.upgrades_comprados||[]).length,
    dragon_level:    (st.dragao||{}).nivel || 0,
    grimoire_mana:   (st.grimorio||{}).magic || 0,
    save:            st.save_string || null,
  };
}

function _runDbSave() {
  const st = _state;
  if (!st || !st.save_string) return;
  try {
    if (!fs.existsSync(_DB_DIR)) fs.mkdirSync(_DB_DIR, {recursive:true});
    fs.appendFileSync(_DB_FILE, JSON.stringify(_buildDbEntry(st))+'\n', 'utf8');
    _DB_COUNT++;
    const sz = fs.statSync(_DB_FILE).size;
    if (sz > 200*1024*1024) { // 200 MB cap — rotate 20%
      const lines = fs.readFileSync(_DB_FILE,'utf8').split('\n').filter(Boolean);
      const keep  = Math.floor(lines.length * 0.8);
      fs.writeFileSync(_DB_FILE, lines.slice(lines.length-keep).join('\n')+'\n','utf8');
      _DB_COUNT = keep;
    }
  } catch(e) { console.warn('[CookieBridge] DB save failed:',e.message); }
}

setInterval(_runDbSave, _DB_MS);


const ROUTES = [
  ['GET', /^\/assets\/chart\.umd\.js$/, async(q,s)=>{const data=await fs.promises.readFile(path.join(CONTROL_DIR,'vendor','chart.umd.js'));s.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});s.end(data);}],
  ['GET', /^\/control\/screenshot$/, async(q,s)=>{const gameWindow=BrowserWindow.getAllWindows().find(w=>/\/src\/index\.html(?:[?#]|$)/.test(w.webContents.getURL()));if(!gameWindow)throw {status:503,message:'Cookie Clicker window is not ready.'};const capture=await gameWindow.webContents.capturePage();_res(s,200,{mimeType:'image/png',data:capture.toPNG().toString('base64'),timestamp:Date.now(),size:capture.getSize()});}],
  ['GET', /^\/capabilities$/, (q,s)=>_res(s,200,{api_version:CONTROL_SCHEMA.version,runtime:{electron:process.versions.electron,node:process.versions.node},test_mode:TEST_MODE,test_root:TEST_MODE?TEST_ROOT:undefined,renderer_version:_state&&_state.control&&_state.control.api_version,game_version:_state&&_state.control&&_state.control.game_version,state_age_ms:_state?Date.now()-_state.timestamp:null,actions:Object.values(CONTROL_SCHEMA.actions),unsupported:CONTROL_SCHEMA.unsupported})],
  ['GET', /^\/control\/state$/, (q,s)=>{const st=_getState();if(!st.control)throw {status:503,message:'Full control renderer is not installed/loaded.'};_res(s,200,{...st.control,state_age_ms:Date.now()-st.timestamp});}],
  ['GET', /^\/bridge\/(control-schema\.js|control-runtime\.js)$/, async(q,s,p)=>{const data=await fs.promises.readFile(path.join(CONTROL_DIR,p[0]));s.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});s.end(data);}],
  ['POST', /^\/action\/results$/, async(q,s)=>{const body=await _readBody(q);_res(s,200,_controlQueue.acknowledge(body.results));}],
  ['GET', /^\/action\/result\/([a-zA-Z0-9-]+)$/, (q,s,p)=>{const result=_controlQueue.get(p[0]);if(!result)throw {status:404,message:'Action result not found (expired history or server restart).'};_res(s,200,result);}],
  ['GET', /^\/img\/([^/]+)$/, async(q,s,p)=>{const fp=SECURITY.resolveAsset(path.join(__dirname,'src','img'),p[0]);const data=await fs.promises.readFile(fp);const ct={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.mp3':'audio/mpeg','.ogg':'audio/ogg'}[path.extname(fp).toLowerCase()];s.writeHead(200,{'Content-Type':ct,'Content-Length':data.length});s.end(data);}],
  ['GET', /^\/upgrades$/, (q,s)=>{ var u=(_state&&_state.upgrades_na_loja)||[]; _res(s,200,{upgrades:u,total:u.length,compravel:u.filter(function(x){return x.canAfford;}).length}); }],
  ['GET', /^\/visual$/, (q,s)=>{ s.writeHead(301,{'Location':'/charts','Content-Length':'0'}); s.end(); }],

  ['GET',    /^\/$/,                                    (q,s)=>_res(s,200,{status:'online',mod:'Cookie Bridge v3.2',timestamp:new Date().toISOString(),jogo_conectado:_state!==null,confeitaria:_state?_state.bakery_name:null,cookies_na_conta:_state?_state.cookies_na_conta:null,docs:`http://localhost:${API_PORT}/docs`})],
  ['GET',    /^\/docs$/,                                (q,s)=>_resHtml(s,_buildDocs('en'))],
  ['GET',    /^\/docs\/pt$/,                            (q,s)=>_resHtml(s,_buildDocs('pt'))],
  ['GET',    /^\/state$/,                               (q,s)=>_res(s,200,_getState())],
  ['GET', /^\/action\/view\/lvl\/([^\/]+)$/, (q,s,p)=>{const st=_getState(),b=_findBuilding(st,p[0]);if(!b)throw {status:404,message:'Building not found.'};const lp=(st.sugar_lumps||{}).disponiveis||0;_res(s,200,{edificio:b.name,nivel_atual:b.level,nivel_maximo:null,custo_proximo_nivel:b.level+1,sugar_lumps_disponiveis:lp,pode_subir_nivel:true,pode_usar_agora:!!b.can_level});}],
  ['GET',    /^\/action\/view\/([^\/]+)$/,              (q,s,p)=>{ const st=_getState(),b=_findBuilding(st,p[0]); if(b){_res(s,200,{tipo:'edificio',nome:b.name,quantidade_atual:b.amount,nivel:b.level,cps_base:b.baseCps,bloqueado:b.locked,precos_compra:{'1':b.buy_price_1,'10':b.buy_price_10,'100':b.buy_price_100},precos_venda:{'1':b.sell_price_1,'10':b.sell_price_10,'100':b.sell_price_100},pode_comprar:{'1':st.cookies_na_conta>=b.buy_price_1,'10':st.cookies_na_conta>=b.buy_price_10,'100':st.cookies_na_conta>=b.buy_price_100},pode_vender:{'1':b.amount>=1,'10':b.amount>=10,'100':b.amount>=100},tem_minigame:b.has_minigame});return;} const u=_findUpgrade(st,p[0]); if(u){_res(s,200,{tipo:'upgrade',id:u.id,nome:u.name,preco:u.price,pool:u.pool,descricao:u.description,pode_comprar:u.canAfford});return;} _res(s,404,{error:`'${p[0]}' not found.`}); }],
  ['GET',    /^\/action\/view\/upgrade\/([^\/]+)$/,    (q,s,p)=>{ const st=_getState(),u=_findUpgrade(st,decodeURIComponent(p[0])); if(!u){_res(s,404,{error:`Upgrade '${decodeURIComponent(p[0])}' not found in the store. Check GET /state → upgrades_na_loja.`});return;} _res(s,200,{tipo:'upgrade',id:u.id,nome:u.name,preco:u.price,pool:u.pool,descricao:u.description,pode_comprar:u.canAfford,falta_cookies:u.canAfford?0:Math.ceil(u.price-st.cookies_na_conta)}); }],
  ['POST', /^\/action\/buy\/upgrade\/([^\/]+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'buy_upgrade',name:p[0]}))],
  ['POST', /^\/action\/buy\/build\/([^\/]+)\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'buy_building',name:p[0],quantity:Number(p[1])}))],
  ['POST', /^\/action\/sell\/build\/([^\/]+)\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'sell_building',name:p[0],quantity:Number(p[1])}))],
  ['POST', /^\/action\/enqueue$/, async(q,s)=>_res(s,202,_enqueue(await _readBody(q)))],
  ['GET', /^\/action\/queue$/, (q,s)=>_res(s,200,_controlQueue.view())],
  ['DELETE', /^\/action\/queue$/, (q,s)=>_res(s,200,_controlQueue.clear())],
  ['GET',    /^\/sugarlump\/view$/,                     (q,s)=>{ const sl=_getState().sugar_lumps||{}; _res(s,200,{disponiveis:sl.disponiveis||0,tipo_crescendo:sl.tipo_crescendo||null,tempo_para_maduro_ms:sl.tempo_para_maduro_ms||null}); }],
  ['POST', /^\/sugarlump\/set\/([^\/]+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'sugarlump_use',name:p[0]}))],
  ['POST', /^\/sugarlump\/use\/([^\/]+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'sugarlump_use',name:p[0]}))],
  ['GET',    /^\/golden_cookie\/view$/,                 (q,s)=>{ const sh=_getState().shimmers||[]; _res(s,200,{tem_shimmer:sh.length>0,total:sh.length,shimmers:sh,acao_recomendada:sh.length>0?{type:'click_shimmer',index:0}:null}); }],
  ['GET',    /^\/effects\/view$/,                       (q,s)=>{ const bf=_getState().buffs_ativos||{}; _res(s,200,{tem_buffs:Object.keys(bf).length>0,buffs:bf}); }],
  ['GET',    /^\/prefs\/view$/,                 (q,s)=>{ const pr=_getState().interruptores||{},r={}; for(const k in PREF_MAP)r[k]={ativo:!!pr[k],descricao:PREF_MAP[k].d}; _res(s,200,r); }],
  ['POST', /^\/prefs\/set\/([^\/]+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'toggle_pref',name:p[0]}))],
  ['GET',    /^\/stats$/,                                 (q,s)=>{ const st=_getState(),es=st.estatisticas||{},bs=st.buildings||[],gr=st.grimorio||{},dr=st.dragao||{},sa=st.santa||{},sl=st.sugar_lumps||{},wk=st.wrinklers||[]; _res(s,200,{_sources:{ascensoes:'Game.resets (total ascensions ever performed)',prestige:'Game.prestige (heavenly chips earned in last run)',heavenly_chips:'Game.heavenlyChips (unspent)',heavenly_chips_gastos:'Game.heavenlyChipsSpent',total_cookies_ganhos:'Game.cookiesEarned (this run)',total_cookies_reset:'Game.cookiesReset (sum across all runs)',cookies_na_conta:'Game.cookies (current bank)',cps_raw:'Game.cookiesPsRaw (always-on, ignores focus)',cps_global:'Game.globalCookiesPs (goes to 0 when unfocused)',cpc:'Game.computedMouseCps (per click)'},bakery_name:st.bakery_name||'',cookies_na_conta:st.cookies_na_conta||0,cps_raw:st.cookies_por_segundo_raw||st.cookies_por_segundo||0,cps_global:st.cookies_por_segundo||0,cookies_por_click:st.cookies_por_click||0,prestige:es.prestige||0,ascensoes:es.ascensoes||0,heavenly_chips:es.heavenly_chips||0,heavenly_chips_gastos:es.heavenly_chips_gastos||0,total_cookies_ganhos:es.total_cookies_ganhos||0,total_cookies_reset:es.total_cookies_reset||0,total_cliques:es.total_cliques||0,fps:es.fps||0,estacao:es.estacao||'none',versao_jogo:es.versao_jogo||'',buildings:bs.map(function(b){return{name:b.name,amount:b.amount,level:b.level,locked:b.locked};}),total_buildings:bs.reduce(function(s,b){return s+b.amount;},0),upgrades_comprados:(st.upgrades_comprados||[]).length,upgrades_na_loja:(st.upgrades_na_loja||[]).length,nivel_dragao:dr.nivel||0,aura1_dragao:dr.aura1||0,aura2_dragao:dr.aura2||0,nivel_santa:sa.nivel||0,sugar_lumps_disponiveis:sl.disponiveis||0,sugar_lump_tipo:sl.tipo_crescendo||null,wrinklers_ativos:wk.filter(function(w){return w&&w.phase>0;}).length,wrinklers_total_sucked:wk.reduce(function(s,w){return s+(w&&w.sucked||0);},0),grimoire_mana:gr.magic||0,grimoire_mana_max:gr.magicMax||0,timestamp:st.timestamp||null}); }],
  ['POST',    /^\/backup$/,                              async(q,s)=>{ const st=_getState(); try{ const dir=path.join(__dirname,'cookie_bridge_backups'); if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true}); const ts=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19),file=path.join(dir,ts+'.json'); fs.writeFileSync(file,JSON.stringify(st,null,2),'utf8'); _res(s,200,{ok:true,arquivo:file,bakery:st.bakery_name,timestamp:ts}); }catch(e){_res(s,500,{error:'Backup falhou: '+e.message});} }],
  ['GET',    /^\/history\/states$/,                     (q,s,p,u)=>{ const n=Math.min(parseInt(u.searchParams.get('n')||'10',10),60); _res(s,200,{total:_stateLog.length,estados:_stateLog.slice(-n)}); }],
  ['GET', /^\/history\/actions$/, (q,s,p,u)=>{const n=Math.max(1,Math.min(Number(u.searchParams.get('n'))||50,200));const rows=_controlQueue.history(n);_res(s,200,{total:rows.length,acoes:rows});}],
  // ── Save DB ───────────────────────────────────────────────────────────────
  ['GET',    /^\/db\/info$/,           (q,s)=>{ try{ if(!fs.existsSync(_DB_FILE)){return _res(s,200,{file:_DB_FILE,count:0,size_bytes:0,size_mb:0,interval_min:_DB_MS/60000,first_ts:null,last_ts:null});} const sz=fs.statSync(_DB_FILE).size; const lines=fs.readFileSync(_DB_FILE,'utf8').split('\n').filter(Boolean); const first=lines.length?JSON.parse(lines[0]):null; const last=lines.length?JSON.parse(lines[lines.length-1]):null; _res(s,200,{file:_DB_FILE,count:lines.length,size_bytes:sz,size_mb:Math.round(sz/1024/1024*100)/100,interval_min:_DB_MS/60000,first_ts:first?first.ts:null,last_ts:last?last.ts:null,last_bakery:last?last.bakery:null}); }catch(e){_res(s,500,{error:e.message});} }],
  ['GET',    /^\/db\/history$/,        (q,s,p,u)=>{ try{ const n=Math.min(parseInt(u.searchParams.get('n')||'500',10),10000); if(!fs.existsSync(_DB_FILE))return _res(s,200,[]); const lines=fs.readFileSync(_DB_FILE,'utf8').split('\n').filter(Boolean); const slice=lines.slice(-n).map(l=>{const e=JSON.parse(l);delete e.save;return e;}); _res(s,200,slice); }catch(e){_res(s,500,{error:e.message});} }],
  ['GET',    /^\/db\/save\/latest$/,   (q,s)=>{ try{ if(!fs.existsSync(_DB_FILE))return _res(s,404,{error:'No saves yet.'}); const lines=fs.readFileSync(_DB_FILE,'utf8').split('\n').filter(Boolean); if(!lines.length)return _res(s,404,{error:'No saves yet.'}); const e=JSON.parse(lines[lines.length-1]); _res(s,200,{ts:e.ts,bakery:e.bakery,run:e.run,prestige:e.prestige,save:e.save}); }catch(e){_res(s,500,{error:e.message});} }],
  ['POST',   /^\/db\/save\/now$/,      async(q,s)=>{ if(!_state||!_state.save_string){_res(s,503,{error:'Game state not available. Is Cookie Clicker running with the mod?'});return;} _runDbSave(); _res(s,200,{ok:true,message:'Save snapshot triggered.',file:_DB_FILE}); }],
  ['GET',    /^\/db\/saves$/,         (q,s,p,u)=>{ try{ const n=Math.min(parseInt(u.searchParams.get('n')||'20',10),200); if(!fs.existsSync(_DB_FILE))return _res(s,200,[]); const lines=fs.readFileSync(_DB_FILE,'utf8').split('\n').filter(Boolean); _res(s,200,lines.slice(-n).map(l=>JSON.parse(l)).reverse()); }catch(e){_res(s,500,{error:e.message});} }],
  ['DELETE', /^\/db\/reset$/,         (q,s)=>{ try{ if(fs.existsSync(_DB_FILE)){fs.unlinkSync(_DB_FILE);} _DB_COUNT=0; _res(s,200,{ok:true,message:'Database wiped.',file:_DB_FILE}); }catch(e){_res(s,500,{error:e.message});} }],
  // ── IO ────────────────────────────────────────────────────────────────────
  ['GET',    /^\/io$/,                 (q,s)=>{ const m=process.memoryUsage(); _res(s,200,{uptime_s:Math.round(process.uptime()),memory:{rss_mb:Math.round(m.rss/1024/1024*10)/10,heap_used_mb:Math.round(m.heapUsed/1024/1024*10)/10,heap_total_mb:Math.round(m.heapTotal/1024/1024*10)/10},os:{free_mem_mb:Math.round(_os.freemem()/1024/1024),total_mem_mb:Math.round(_os.totalmem()/1024/1024),load_avg:_os.loadavg(),platform:_os.platform(),cpus:_os.cpus().length,uptime_s:Math.round(_os.uptime())}}); }],
  // ── Charts ────────────────────────────────────────────────────────────────
  ['GET', /^\/charts$/, (q,s)=>_resHtml(s,_CHARTS_HTML)],
  ['GET', /^\/saves$/, (q,s)=>_resHtml(s,_SAVES_HTML)],
  ['GET',    /^\/dbview$/,            (q,s)=>{ s.writeHead(301,{'Location':'/charts'}); s.end(); }],
  // ── Grimoire ──────────────────────────────────────────────────────────────
  ['GET',    /^\/grimoire\/view$/,                           (q,s)=>{ const g=_getState().grimorio; if(!g){_res(s,404,{error:'Grimoire not available. Buy the Wizard Tower.'});return;} _res(s,200,g); }],
  ['POST', /^\/grimoire\/cast\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'cast_spell',spell_index:Number(p[0])}))],
  ['POST', /^\/grimoire\/recharge$/, async(q,s,p)=>_res(s,202,_enqueue({type:'grimoire_recharge'}))],
  // ── Pantheon ──────────────────────────────────────────────────────────────
  ['GET',    /^\/pantheon\/view$/,                            (q,s)=>{ const p=_getState().panteao; if(!p){_res(s,404,{error:'Pantheon not available. Buy the Temple.'});return;} _res(s,200,p); }],
  ['POST', /^\/pantheon\/set\/(\d+)\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'pantheon_set',spirit_index:Number(p[0]),slot_index:Number(p[1])}))],
  ['POST', /^\/pantheon\/remove\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'pantheon_remove',slot_index:Number(p[0])}))],
  ['POST', /^\/pantheon\/recharge$/, async(q,s,p)=>_res(s,202,_enqueue({type:'pantheon_recharge'}))],
  // ── Jardim ─────────────────────────────────────────────────────────────────
  ['GET',    /^\/garden\/view$/,                             (q,s)=>{ const j=_getState().jardim; if(!j){_res(s,404,{error:'Garden not available. Buy the Farm.'});return;} _res(s,200,Object.assign({},j,{solo_nome:SOIL_NAMES[j.soil||0]||'?'})); }],
  ['GET',    /^\/garden\/seeds$/,                            (q,s)=>{ const j=_getState().jardim; if(!j){_res(s,404,{error:'Garden not available.'});return;} _res(s,200,(j.seeds||[]).filter(function(s2){return s2.unlocked;}).map(function(s2){return{id:s2.id,name:s2.name};})); }],
  ['POST', /^\/garden\/plant\/(\d+)\/(\d+)\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'garden_plant',seed_index:Number(p[0]),x:Number(p[1]),y:Number(p[2])}))],
  ['POST', /^\/garden\/harvest\/(\d+)\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'garden_harvest',x:Number(p[0]),y:Number(p[1])}))],
  ['POST', /^\/garden\/harvest_all$/, async(q,s,p)=>_res(s,202,_enqueue({type:'garden_harvest_all'}))],
  ['POST', /^\/garden\/soil\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'garden_soil',soil_id:Number(p[0])}))],
  // ── Bolsa de Valores ────────────────────────────────────────────────────────
  ['GET',    /^\/stock\/view$/,                              (q,s)=>{ const b=_getState().bolsa; if(!b){_res(s,404,{error:'Stock Market not available. Buy the Bank.'});return;} _res(s,200,b); }],
  ['GET',    /^\/stock\/analysis$/,                           (q,s)=>{ const b=_getState().bolsa; if(!b){_res(s,404,{error:'Stock Market not available.'});return;} const opp=Object.entries(b.goods||{}).filter(([,g])=>g.price<g.restingValue).map(([tk,g])=>({ticker:tk,preco:g.price,resting:g.restingValue,desconto_pct:Math.round((g.restingValue-g.price)/g.restingValue*1000)/10,portfolio:g.portfolio,espaco:g.maxPortfolio-g.portfolio})).sort((a,b2)=>b2.desconto_pct-a.desconto_pct); _res(s,200,{total:opp.length,ativos:opp}); }],
  ['GET',    /^\/stock\/view\/([^\/]+)$/,                   (q,s,p)=>{ const tk=p[0].toUpperCase(),b=_getState().bolsa; if(!b){_res(s,404,{error:'Stock Market not available.'});return;} if(!TICKERS.includes(tk)){_res(s,400,{error:`Ticker '${tk}' is invalid.`,validos:TICKERS});return;} const g=(b.goods||{})[tk]; if(!g){_res(s,404,{error:`Asset '${tk}' not found.`});return;} _res(s,200,Object.assign({ticker:tk},g,{below_resting:g.price<g.restingValue})); }],
  ['POST', /^\/stock\/buy\/([^\/]+)\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'stock_buy',ticker:p[0],quantity:Number(p[1])}))],
  ['POST', /^\/stock\/sell\/([^\/]+)\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'stock_sell',ticker:p[0],quantity:Number(p[1])}))],
  // ── Dragon ─────────────────────────────────────────────────────────────────
  ['GET',    /^\/dragon\/view$/,                             (q,s)=>{ const d=_getState().dragao; if(!d){_res(s,404,{error:"Dragon not available. Buy 'How to bake your dragon'."});return;} _res(s,200,Object.assign({},d,{aura1_desc:DRAGON_AURAS[d.aura1]||'?',aura2_desc:DRAGON_AURAS[d.aura2]||'?',auras:DRAGON_AURAS})); }],
  ['POST', /^\/dragon\/set_aura\/(\d+)\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'dragon_set_aura',aura_id:Number(p[0]),slot:Number(p[1])}))],
  // ── Wrinklers ──────────────────────────────────────────────────────────────
  ['GET',    /^\/wrinklers\/view$/,                          (q,s)=>{ const ws=((_getState().wrinklers)||[]).filter(w=>w.phase>0),tot=ws.reduce((a,w)=>a+w.sucked,0); _res(s,200,{total_ativos:ws.length,maximo:12,total_cookies_acumulados:tot,total_ao_estourar:Math.round(tot*1.1),wrinklers:ws,tem_shiny:ws.some(w=>w.type===1)}); }],
  ['POST', /^\/wrinklers\/pop\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'wrinkler_pop',id:Number(p[0])}))],
  ['POST', /^\/wrinklers\/pop_all$/, async(q,s,p)=>_res(s,202,_enqueue({type:'wrinkler_pop_all',include_shiny:true}))],
  // ── Season ────────────────────────────────────────────────────────────────
  ['GET',    /^\/season\/view$/,                             (q,s)=>{ const e=(_getState().estacao_ativa)||{}; _res(s,200,{estacao_atual:e.nome||'',tempo_restante_frames:e.tempo_restante_frames||0,usos_do_switcher:e.usos||0,estacoes_disponiveis:VALID_SEASONS}); }],
  ['POST', /^\/season\/set\/([^\/]*)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'set_season',season:p[0]}))],
  // ── Volume ─────────────────────────────────────────────────────────────────
  ['GET',    /^\/volume\/view$/,                             (q,s)=>{ const v=(_getState().volume)||{sfx:75,music:50}; _res(s,200,{sfx:v.sfx,music:v.music,sfx_desc:'Sound effects (clicks, notifications)',music_desc:'Trilha sonora do jogo'}); }],
  ['POST', /^\/volume\/set\/([^\/]+)\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'set_volume',channel:p[0],value:Number(p[1])}))],
  ['POST', /^\/volume\/mute\/([^\/]+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'mute_building',name:p[0]}))],
  // ── Dragon — upgrade ──────────────────────────────────────────────────────
  ['POST', /^\/dragon\/upgrade$/, async(q,s,p)=>_res(s,202,_enqueue({type:'upgrade_dragon'}))],
  // ── Papai Noel ────────────────────────────────────────────────────────────
  ['GET',    /^\/santa\/view$/,                          (q,s)=>{ const sc=_getState().santa; if(!sc){_res(s,404,{error:'Santa state not available.'});return;} _res(s,200,sc); }],
  ['POST', /^\/santa\/upgrade$/, async(q,s,p)=>_res(s,202,_enqueue({type:'upgrade_santa'}))],
  // ── Sugar Lump — colheita manual ──────────────────────────────────────────
  ['POST', /^\/sugarlump\/harvest$/, async(q,s,p)=>_res(s,202,_enqueue({type:'harvest_lump'}))],
  // ── Venda total de um tipo ────────────────────────────────────────────────
  ['POST', /^\/action\/sell_all\/([^\/]+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'sell_all_of_type',name:p[0]}))],
  // ── Forced Save ──────────────────────────────────────────────────────────
  ['POST', /^\/game\/save$/, async(q,s,p)=>_res(s,202,_enqueue({type:'force_save'}))],
  // ── Prestige ───────────────────────────────────────────────────────────────
  ['GET',    /^\/prestige\/view$/,                           (q,s)=>{ const es=(_getState().estatisticas)||{}; _res(s,200,{prestige:es.prestige||0,heavenly_chips:es.heavenly_chips||0,heavenly_chips_gastos:es.heavenly_chips_gastos||0,ascensoes:es.ascensoes||0,bonus_cps_pct:es.prestige||0,aviso:'Para ascender use POST /action/enqueue com type=ascend (REINICIA o run atual).'}); }],
  // ── Reincarnation ────────────────────────────────────────────────────────────
  ['POST', /^\/legacy\/reincarnate$/, async(q,s,p)=>_res(s,202,_enqueue({type:'reincarnate'}))],
  // ── Legacy (Prestige / Ascension) ─────────────────────────────────────────
  ['GET',    /^\/legacy\/view$/,                             (q,s)=>{ const lg=_getState().legado; if(!lg){_res(s,404,{error:'Legacy data not available.'});return;} _res(s,200,{prestige:lg.prestige,heavenly_chips:lg.heavenly_chips,heavenly_chips_gastos:lg.heavenly_chips_gastos,ascensoes:lg.ascensoes,modo_ascensao:lg.modo_ascensao,cookies_para_proximo_prestige:lg.cookies_para_proximo_prestige,total_upgrades_prestige:(lg.upgrades||[]).length,upgrades_comprados:(lg.upgrades||[]).filter(u=>u.bought).length,aviso_ascensao:'POST /legacy/ascend with {"confirmar":true} RESETS the current run. Buildings and upgrades are lost. Heavenly chips and prestige upgrades are kept.'}); }],
  ['GET',    /^\/legacy\/upgrades$/,                        (q,s)=>{ const lg=_getState().legado; if(!lg){_res(s,404,{error:'Legacy data not available.'});return;} const upgs=(lg.upgrades||[]).sort((a,b2)=>a.price-b2.price); _res(s,200,{heavenly_chips:lg.heavenly_chips||0,total:upgs.length,comprados:upgs.filter(u=>u.bought).length,upgrades:upgs}); }],
  ['POST', /^\/legacy\/buy_heavenly\/(\d+)$/, async(q,s,p)=>_res(s,202,_enqueue({type:'buy_heavenly_upgrade',id:Number(p[0])}))],
  ['POST', /^\/legacy\/ascend$/, async(q,s)=>{const body=await _readBody(q);_res(s,202,_enqueue({type:'ascend',confirm:body.confirm===undefined?body.confirmar:body.confirm}));}],
  // Endpoints internos usados pelo mod (fetch dentro do jogo)
  ['POST', /^\/state$/, async(q,s)=>{const b=await _readBody(q);if(!b||Array.isArray(b)||typeof b!=='object'||!b.control||b.control.api_version!==CONTROL_SCHEMA.version)throw {status:400,message:'Invalid renderer state.'};_state=Object.assign({},b,{timestamp:Date.now()});_stateLog.push(_state);if(_stateLog.length>60)_stateLog.shift();_res(s,200,{ok:true});}],
  ['GET', /^\/action\/next$/, (q,s)=>{const action=_controlQueue.next();if(action)_res(s,200,action);else{s.writeHead(204,{'Content-Length':'0'});s.end();}}],
];

// ── Portuguese translations ───────────────────────────────────────────────────
const _PT_ROUTES = {
  'GET/': 'Verificação de saúde — status do servidor, conexão com o jogo, nome da confeitaria',
  'GET/docs': 'Documentação em Inglês — esta é a versão em Português',
  'GET/state': 'Snapshot completo do jogo (atualizado a cada ~500ms pelo mod)',
  'GET/action/view/{name}': 'Detalhes de prédio ou melhoria pelo nome (não diferencia maiúsculas)',
  'GET/action/view/upgrade/{name}': 'Busca de melhoria: preço, grupo, descrição, acessibilidade',
  'GET/action/view/lvl/{name}': 'Info de nível do prédio (upgrades via sugar lump)',
  'POST/action/buy/upgrade/{name}': 'Comprar uma melhoria da loja pelo nome',
  'POST/action/buy/build/{name}/{n}': 'Comprar N prédios (n = 1, 10 ou 100)',
  'POST/action/sell/build/{name}/{n}': 'Vender N prédios',
  'POST/action/enqueue': 'Adicionar ação à fila FIFO. Consulte /capabilities e acompanhe o recibo em /action/result/:id.',
  'GET/action/queue': 'Listar ações pendentes na fila',
  'DELETE/action/queue': 'Limpar toda a fila de ações',
  'GET/sugarlump/view': 'Contagem de sugar lumps, tipo crescendo e tempo para amadurecer',
  'POST/sugarlump/use/{build}': 'Usar 1 sugar lump para aumentar o nível de um prédio',
  'POST/sugarlump/harvest': 'Coletar manualmente um sugar lump (controla o tipo do próximo)',
  'GET/golden_cookie/view': 'Shimmers atualmente visíveis na tela',
  'GET/effects/view': 'Buffs temporários ativos (Frenzy, Click Frenzy, etc.)',
  'GET/grimoire/view': 'Estado do grimório: mana, mana máxima, todos os feitiços com custo',
  'POST/grimoire/cast/{idx}': 'Lançar feitiço pelo índice idx (0–8)',
  'POST/grimoire/recharge': 'Gastar 1 sugar lump para restaurar a mana ao máximo',
  'GET/pantheon/view': 'Estado do panteão: slots, trocas disponíveis, todos os espíritos',
  'POST/pantheon/set/{spirit}/{slot}': 'Colocar espírito no slot (0=Diamante 100%, 1=Rubi 50%, 2=Jade 25%)',
  'POST/pantheon/remove/{slot}': 'Remover espírito de um slot',
  'POST/pantheon/recharge': 'Gastar 1 sugar lump para restaurar as trocas de adoração para 3',
  'GET/garden/view': 'Grade completa do jardim, lista de sementes e solo ativo',
  'POST/garden/plant/{seed}/{x}/{y}': 'Plantar semente na célula (x, y)',
  'POST/garden/harvest/{x}/{y}': 'Colher planta na célula (x, y)',
  'POST/garden/harvest_all': 'Colher todas as plantas do jardim',
  'POST/garden/soil/{0-4}': 'Mudar tipo de solo (0=Normal 1=Fertilizante 2=Argila 3=Cascalho 4=Lascas)',
  'GET/stock/view': 'Todos os ativos com preço, delta e valor de repouso',
  'GET/stock/view/{ticker}': 'Detalhes de um ativo específico pelo símbolo ticker',
  'GET/stock/analysis': 'Ativos abaixo do valor de repouso ordenados por desconto (oportunidades de compra)',
  'POST/stock/buy/{ticker}/{n}': 'Comprar N unidades de um ativo',
  'POST/stock/sell/{ticker}/{n}': 'Vender N unidades do portfólio',
  'GET/dragon/view': 'Nível do dragão, auras ativas e dicionário completo de auras',
  'POST/dragon/set_aura/{id}/{slot}': 'Definir aura id no slot (0=primária, 1=secundária; nível≥20 para slot 1)',
  'POST/dragon/upgrade': 'Evoluir o dragão (custa cookies e/ou prédios)',
  'GET/santa/view': 'Nível e nome do Papai Noel',
  'POST/santa/upgrade': 'Evoluir o Papai Noel (requer temporada de Natal)',
  'GET/wrinklers/view': 'Wrinklers ativos, cookies acumulados e flag de brilhante',
  'POST/wrinklers/pop/{id}': 'Estourar wrinkler pelo id (0–11), libera cookies sucados × 1.1',
  'POST/wrinklers/pop_all': 'Estourar todos os wrinklers ativos de uma vez',
  'GET/season/view': 'Temporada atual, tempo restante e temporadas disponíveis',
  'POST/season/set/{name}': 'Trocar temporada ativa (requer melhoria Season Switcher)',
  'GET/volume/view': 'Níveis de volume atuais de SFX e música',
  'POST/volume/set/{sfx|music}/{0-100}': 'Ajustar nível de volume',
  'POST/volume/mute/{building}': 'Alternar estado mudo para o som de um prédio',
  'GET/prefs/view': 'Todas as 26 preferências do jogo com estado atual',
  'POST/prefs/set/{name}': 'Alternar uma preferência ligado/desligado pelo nome',
  'GET/prestige/view': 'Resumo de prestígio: chips, ascensões, bônus % de CpS',
  'GET/legacy/view': 'Dados completos de legado: prestígio, chips, cookies para o próximo prestígio',
  'GET/legacy/upgrades': 'Todas as melhorias celestiais com preço, status e acessibilidade',
  'POST/legacy/buy_heavenly/{id}': 'Comprar uma melhoria celestial com heavenly chips',
  'POST/legacy/ascend': 'PERIGO: Ascender — reinicia a corrida atual (requer {confirmar:true})',
  'POST/legacy/reincarnate': 'Reencarnar após a tela de ascensão',
  'GET/stats': 'Todas as estatísticas com fontes Game.* documentadas — prestígio, chips, CpS raw/global, cookies, ascensões, prédios, dragão, santa, lumps, wrinklers, grimório, FPS',
  'POST/action/sell_all/{name}': 'Vender TODOS os prédios de um tipo (combo Godzamok — tipicamente com espírito Reaper of Fields)',
  'POST/game/save': 'Forçar salvamento imediato do jogo no disco (use antes de ações arriscadas)',
  'POST/backup': 'Tirar snapshot JSON manual do estado atual → salvo na pasta cookie_bridge_backups/',
  'GET/history/states?n=10': 'Últimos N snapshots de estado do jogo na memória (buffer circular, máx 60)',
  'GET/history/actions?n=50': 'Últimas N ações executadas com timestamps (buffer circular, máx 200)',
  'GET/db/info': 'Metadados do banco — caminho, contagem de entradas, tamanho, intervalo, timestamps',
  'GET/db/history?n=500': 'Estatísticas históricas do banco (sem string de save). Até 10.000 entradas',
  'GET/db/save/latest': 'String de save mais recente (base64, igual ao Export Save do jogo) — use para restaurar',
  'POST/db/save/now': 'Acionar snapshot imediato no banco (sem esperar o intervalo de 5min)',
  'GET/db/saves?n=20': 'Últimas N entradas COM strings base64 completas, mais recente primeiro (máx 200)',
  'DELETE/db/reset': 'PERIGO: Deletar permanentemente o banco saves.ndjson. Irreversível.',
  'GET/io': 'Estatísticas em tempo real do processo Node.js — heap, RAM SO, CPUs, uptime',
  'GET/charts': 'Página de gráficos de evolução — CpS, cookies, prédios, melhorias, legado ao longo do tempo',
  'GET/saves': 'Página de Códigos de Backup — strings de save por snapshot de 5min. Copie e cole no Import Save',
};
const _PT_SECT = {
  'System & State':'Sistema & Estado','Buildings & Upgrades':'Prédios & Melhorias',
  'Sugar Lumps':'Sugar Lumps','Golden Cookies & Buffs':'Cookies Dourados & Buffs',
  'Grimoire':'Grimório','Pantheon':'Panteão','Garden':'Jardim',
  'Stock Market':'Mercado de Ações','Dragon':'Dragão','Santa':'Papai Noel',
  'Wrinklers':'Wrinklers','Seasons':'Temporadas','Volume & Audio':'Volume & Áudio',
  'Preferences':'Preferências','Legacy & Prestige':'Legado & Prestígio',
  'Stats':'Estatísticas','Misc & History':'Misc & Histórico','Database & IO':'Banco de Dados & IO',
};
const _PT_SDESC = {
  'System & State': '<b>GET /</b> confirma conexão com servidor e jogo. <b>GET /state</b> retorna snapshot completo com ~60 campos, mesclado do estado rápido (a cada ~500ms: cookies, CpS, buffs, shimmers) e estado lento (a cada ~5s: prédios, minijogos, dragão, legado). Use <b>GET /stats</b> para visão anotada de todos os campos numéricos.',
  'Buildings & Upgrades': 'Todos os 20 prédios do <b>Cursor</b> ao <b>You</b>. Compre e venda em lotes de 1, 10 ou 100. <b>GET /action/view/{name}</b> mostra preço atual, acessibilidade e valor de venda. Melhorias são desbloqueios únicos comprados da loja — aplicam permanentemente até a ascensão.',
  'Sugar Lumps': 'Um lump amadurece a cada ~24h. Gastar um aumenta o nível de um prédio em +1 (máx nível 10; Cursor máx 20), concedendo +1% CpS permanente por nível. Use <b>POST /sugarlump/harvest</b> para coletar manualmente (controla o tipo do próximo lump).',
  'Golden Cookies & Buffs': 'Shimmers aparecem aleatoriamente e somem após ~13s. Clique via <b>POST /action/enqueue {type:"click_shimmer", index:0}</b>. Efeitos comuns — <b>Frenzy</b>: ×7 CpS por 77s &nbsp;·&nbsp; <b>Click Frenzy</b>: ×777 CpC por 13s &nbsp;·&nbsp; <b>Lucky</b>: cookies instantâneos. Buffs ativos com tempo restante estão em <b>GET /effects/view</b>.',
  'Grimoire': 'Desbloqueia quando Wizard Tower alcança nível 1 (1 sugar lump). Mana regenera com o tempo até <code>magicMax</code>. Feitiços principais — <b>idx 0 Conjure Baked Goods</b>: cookies instantâneos &nbsp;·&nbsp; <b>idx 1 Force the Hand of Fate</b>: força cookie dourado a aparecer. Chance de falha = déficit de mana + <code>failChnc</code> base do feitiço.',
  'Pantheon': 'Desbloqueia quando Temple alcança nível 1. Coloque até 3 espíritos: Diamante (100%), Rubi (50%), Jade (25%). Trocar custa 1 adoração (recarrega para 3 com 1 sugar lump). Combo — <b>Godzamok</b> (slot 0) multiplica CpC pelo número de tipos de prédios vendidos; combine com <b>Reaper of Fields</b> no jardim.',
  'Garden': 'Desbloqueia quando Farm alcança nível 1. Grade cresce com o nível de sugar lump do Farm (3×3 → 6×6). Plante sementes da lista descoberta; plantas mudam quando dois tipos maduros são adjacentes. Solo 1 (Fertilizante) maximiza crescimento; solo 3 (Cascalho) maximiza descoberta de mutações.',
  'Stock Market': 'Desbloqueia quando Bank alcança nível 1. 18 ativos com valor de repouso; preço oscila em torno dele. <b>GET /stock/analysis</b> ordena oportunidades de compra por desconto (%). Compre quando preço está bem abaixo do repouso, venda acima.',
  'Dragon': 'Sacrifique cookies e/ou prédios para evoluir Krumblor do nível 0 ao 20. <b>Aura 11 Radiant Appetite</b> dobra o CpS base. <b>Aura 6 Dragonflight</b> faz cookies dourados concederem ×1111 CpC por 10s. Nível 20 desbloqueia ambos os slots simultaneamente.',
  'Santa': 'Ative primeiro a temporada de Natal (<b>POST /season/set/christmas</b>). Evolua por 14 níveis (<b>POST /santa/upgrade</b>). Último nível desbloqueia a melhoria <b>Santa\'s legacy</b>.',
  'Wrinklers': 'Até 12 wrinklers podem se agarrar ao cookie. Reduzem CpS bruto em ~5% cada, mas acumulam cookies e retornam ×1.1 ao serem estourados. Estratégia: estoure durante <b>Frenzy × Elder Frenzy</b>. Wrinklers brilhantes (~0.01%) retornam ×3.3.',
  'Seasons': 'Eventos sazonais duram até serem trocados manualmente. Cada um desbloqueia melhorias exclusivas (Natal: Papai Noel/renas; Halloween; Páscoa: ovos; Valentines). Melhoria Season Switcher permite troca no meio de uma corrida.',
  'Volume & Audio': 'SFX e música são trilhas independentes (0–100 cada). <b>POST /volume/mute/{building}</b> silencia o som ambiente de um prédio. Útil em automações onde o áudio do jogo interfere.',
  'Preferences': '26 preferências booleanas. Maioria cosmética. <b>screenReader</b> ativa modo de acessibilidade por teclado. <b>cloudSave</b> alterna Steam Cloud. <b>focus</b> reduz FPS quando a janela está desfocada.',
  'Legacy & Prestige': '<b>Prestígio</b> = <code>floor(cbrt(totalCookiesBaked / 1e12))</code> — cada nível = +1% CpS permanente. <b>Ascender</b> reinicia prédios e cookies mas rende Heavenly Chips. <b>GET /legacy/view</b> mostra os chips que você ganharia agora.',
  'Stats': 'Snapshot anotado de cada campo numérico com sua variável <code>Game.*</code> fonte. Inclui objeto <code>_sources</code> explicando a origem de cada valor.',
  'Misc & History': '<b>POST /action/sell_all/{name}</b> vende todos os prédios de um tipo (combos Godzamok). <b>POST /game/save</b> força salvamento. Buffers circulares na memória: últimos 60 snapshots de estado (<b>/history/states</b>) e 200 registros de ação (<b>/history/actions</b>).',
  'Database & IO': '<a href="/charts" target="_blank" style="color:#00e5ff;font-weight:bold;font-size:13px">📈 Abrir Gráficos — evolução e análise de renascimentos →</a><br><br>Salva automaticamente a cada <b>5 min</b> em <code>%USERPROFILE%/CookieBridge/saves.ndjson</code>. Cada entrada = estatísticas + string de save completa. <b>/db/info</b> → metadados. <b>/db/saves</b> → entradas com código de save. <b>/db/save/latest</b> → último save para restaurar.',
};

function _buildDocs(lang) {
  if (!lang) lang = 'en';
  function RD(r) { return lang === 'pt' ? (_PT_ROUTES[r.m + r.p] || r.d) : r.d; }
  const IMG_GOLD = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAAAYFBMVEWQYzXhyW/QsFRzSiutjkr579bo04TTt21cOSKccTr05LisgT3q2KzBm0ecfk2oi2rbxIh/WTTKtIPHpU+0pIXEqWnv25lEKRnjzpm7j0G4mlyMlFeAdUTZvl7///////94/aVlAAAAIHRSTlP/////////////////////////////////////////AFxcG+0AAA8ySURBVHjazFqLlqSotgRETURQktIUFM///+WNwKxH16N7Zu6ctY49049cVTvYr9ixscR//suP+N8BeNxuj9t/EaBpmhshbk0jQmhu/y7AEabDi4MgjZg6mY2ocP8GAE7sp/s4tOc5KiOEKus5rL0WAmiPx+P/B3BrQhDTiadtz3mWXbFZ1n92yjpC3P4E8VuARvhuWmYYHLb72PfL3JdladtxGLpVdp0P4vYnL8TvTj/B9jz39/v9ZZpkzvO5DnJZ7vOwdrC/FiuQ7sdvc/EjQDheXnD0+9LLPHlvrNfLdsLwkuNSpJQdUFRJiBNT/yPIDwA3Qes4/0tWvcZBRZum+3lusyxRSyVLRwTgGJGEn5DyHyDE9z112R+2CUc/+2MPYrG5xkupqLSOakWIulKU9npu4Zf5AUF8az/UyjlfskdT9SmEJfS9RJYXJbVTVi/9opYenxWXNZCH1ovvm0/8aH8c5/vLGBjiwF9BeB910tY7mkSyl34deiXdMp7tKf33LnwFeKBX8Q0DSuc+FsOOFcIEARCB0CTjfb6vqFLUbVdiKXIZhmFd/dF819vi+/Ov430e7+PZ6YAyFIiEQUXCDTx+God1lneUFBJSlJLdOmyd3vfjmyiJL/abaRja+d7L86UdN2kCXAhSwpCgF8H7DqbRD7mTyjlAAGA7F30YFb76IL601wTWOZeMameeO5VQ5U0QBhUjECtTzjvMLchtXuQS49KjIdpV5cOX0nyhDvElPiNqYs5Jd/llGLteRRInMi1w3qNE4yXKd5m01otEeS4F1lccZLd2k19dEJ/i4xH/bV6yTamLqJMSra100NzC4W1RJvh+7fJ0TgsMS/T0CmbqZHQHAEzzmZrE5/ijWRfEtaRU8rJIlI2ylTQJEphokQlQUKogDlDG2pKZyq59slp8RhC/2gf53LO2yVmr0FhnV5xWFhVY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';
  const IMG_CURSOR = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpDMzU2NTE2M0Q5NzVFNTExQTUxREMwREIzNTlBMzU3RCIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDo1QUVFOUIwOTc1REIxMUU1OUFCMkY0OTI2MDhEQ0EzRCIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDo1QUVFOUIwODc1REIxMUU1OUFCMkY0OTI2MDhEQ0EzRCIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M2IChXaW5kb3dzKSI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkM4NTY1MTYzRDk3NUU1MTFBNTFEQzBEQjM1OUEzNTdEIiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOkMzNTY1MTYzRDk3NUU1MTFBNTFEQzBEQjM1OUEzNTdEIi8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+qDK1swAABPhJREFUeNrsWk9II1cY/8ZmtSjICtu4+K+QuFjNmhSsh9KVsGT/YFLavS8F8SY9eCu9Lb1I2ZuHrqC9lT3HlhJZd3vYdktx6x6UKgUbwbZs1a6blNJoapPpfM/5hplxTN4kb8aD74OP95JM8ub3+37v997MRFFVFc5yNMAZD0mAJEASwB/nXu2KapnWE/u+nqyiKFEt03pGhfworgLV8mpXC8tAU2e6XC6rmNjXsuLxPL/tJrVIj4+PqyMjI/giLeI33U6BWyf0/YpbiUQCWltbhY0vPUASUKeFnJYhgvIKmqJaryHWRcC/+7/BD0++xrm4Yibjuz/P+7AinINUKgW9vb3a+MpKrWTUPQWGhmKOZGgk+KKKvr4+UBqanMiICiXgbvoJNxkaEaATEfVzVhAZGhGgExGtiwCtghNaYjXVt6+8yw1m4PIbRMIndW58JvRq6hVVIJ/PV/1e76VLGglhrvGrKeDe7vNVwNQrapn/9v5+sWi8Fw71iFir701NTUF/f79e0QBkMhn2QXI0YRxE/VK5bLwXCoW4xueaAufb2iyA7YHACfxf+V+gWCgIk/XGxgYDk0olmfM7BQIn8DdvXoVyqSTMBGPBjijkczn24uOPPnQET4HARYLH8TOZBWhpaTlSVfh1R/AUCNwNeB4CVokEjPffG3WsuhPw7OavIq5TVnd2tmOPH38LyWQSLrYHHavuBLxQ2Be2DCIJ88+erTCXNwMn8Ob456DI8suvFvDlvCAS5peWliASGbAAJ/AWRZTKLLPZTa7xKxJwePA7de9oq0BVuSNwik/vfobNoqCpcOfBg0W4PDhYUe4InOKP7W2u8asqQCeBqWD9p59PBG4Gv/18hzxjRtAlO1PBj0+fQmdHx4lVN4qDhVJL+L0ZEVPAooJKwIv7BZYkf10FIFIFsVjsRODlcoklr/y5CRh5LW+ogMzNDJzAY+Ryf4uWv0UFy8vL0N3dbQFO4JliD//jln8t1wJMBU5VJ/AUouTvpILBweixqhP4I7b45O+KAH1ru0rSsgM3g/dA/hYVbG5uQldXpwU4gd/b23O1+ihungzpV3cTWt6osM2c1+U3Y1pFRN4Y5RqfVwGKfDQmb4lJAiQBkgBJgCRAEiAJkATwRTgcVjFP64TpNrnICwzuDIVC6sHBS5bYF/38n+P/Aeq1awm1p6dbPTp1//8fcOoxNjYGkUi/9ABREajny3YvyGazim8nHgiA3Qs0SSu+KmB6ehrW15dZH1s/DbKxsRGGh4dhdPQGNDc3g+YLNRlkA0+VnUAh+OvX3zH6FESE164fiUTgwoU2o4++YCZCCAEIBAEhQDsoAm/u47EPH34vdMnTXB+CwSDro+zv3/+CfUbgzf14/Aq0t18UPwUQIEmdgoDaWy9iaOhNJnWUPcWLFznHVqgHoKkNDLxlkTeBnZycPNaKDjS1R4++gcPDklFhAru2tnas9WQZtJPgdxAJt29/wHX81taWN6sAj8RJCV4sh3Nzn1c9BpWwu7vrajnkviuMJmh2fgSLfXOL4RUBaILxeFxz+iYDLJqfucXqe0aAEwnmyuN7OFW83AzZSTBXHklYWFh0vRlytRNEcESCObDq9ve88gMkYXZ2VpsSc8acx6rjUlkTqW4fjDhtcogYP7bDTpscIqaW7bB8MiTvCEkCJAGSAEmAJEASIAmQBJzR+F+AAQB1yUpCWzb2kQAAAABJRU5ErkJggg==';
  const IMG_GRANDMA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABABAMAAABYR2ztAAAAMFBMVEXhwJbKa0FRgLAzSnXUwbyIw+KQgHebNByTBR/NOmCbdEZkOh/////KsXwgDgr///9ZrsXmAAAAEHRSTlP///////////////////8A4CNdGQAAAapJREFUSMft1TFLxDAUAOBEkG5Ha4cOStGWroc2zoIQbhIHIZuIQzlwOXRyu8nhbnEUC/4D0R+gKIguLv4Ap7ZIewgm/+Cd1hukmrwbnASzZOjHe+G9l4aMpyzyD/4qkFMAdJVEQcl7XYUASB46vIcAWXKedJQRQMITzhFQbvDOOqEI4J3EJsSXyphil86Ec3FoAuOSumxjefXeCMDeJ2zlbs1cqNyxCPUUUurKdg77za40mwUHxPoMADdK327p+JP9XA8gyGbqL3Bxq09RkKXZVg2er/QRsrtI1ODVCOgEvJ1f6lNkcyLy6yNMA18ZvhVq0RXRTuMIP8B29NQ4QhMUi268xRTcXOuBDIgbia21fP5aaQeGxcQVQoSZ1dJPVMho/BEhXPJ8fbuLkLIgCONqXxkmqqCMsbidO8o0MDQQoq1Amiaq8ipZ9ZG7uUBzlftmUBEcgE28TGUtMziw+wQDY2lJHIxlTqXtYz+x3AdHYSDzgf4OlD3oouBlEzgG4GhzxCVy/Ucne6fd9BgBafo4PDtVZjBM02GKABgMBqPBMfYc1Ev95kHRrHf9IkavDH5TCgAAAABJRU5ErkJggg==';
  const IMG_FARM = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABABAMAAABYR2ztAAAAJFBMVEWDQBTDkziqiL00DAKaMxY8MlhzW5ZGJxwgDgqAXEFiQCz///+Kd0haAAAADHRSTlP//////////////wAS387OAAACfElEQVRIx+3VTWrjMBQAYKclpUuLnCHGy5TmAmUuEAI2XhtsdIOErEJAzrNyAcsXiKwTGOZy856k2A4hTGE2MzCmtUD6/PT0m+Dnb57gP/hHAbjn8gQAGIN/xugpGUAPu041ed2aTl33I7mB/mx0raqEt8YoRPpyD3ppjIhrzWuFAP87fQ+kMnpbxEbaRkVhYAr6rjW6TKX7GupGmq69TICkbgUNAYHOsxPHMHoCqOeusdGVEdWyBImpXgbQg2+jl4Zsw0KOsfQATokcgciXM8bmsnMhLBC5Ta+1oIqK2YqFCNQN9NuEY+6KcleqSSFga5b5PiyoYom5QxUTaIEH4efiHUHjgcRPjY6KPHYRxBGTeME+BkC9Vxv2wsFGSPnrj3DOXZaBnwU4Lr7CJKoR6Dw6roI4uwM6mq0/2KlAoERUZnmG826HEdBCKFMV7DX8muNXSp3KRJQxmAloDWwYW3y80+BxKkGn3K6LHoA5rhljbzYCNnVQW9A4gIPQm8/FLBTcA1pUMDZLD0QRzFgA2QgghSmoomOwek9dDrQwTVJsaw/OBAqxmedLAiA4jrDJt9zcACYpQBSizGl6l8FbjKAoYAp0VxWQlAhwykOgHDLsyFggDW2EKmuBEm9m68Ubbu6WMjH7ETR4pmjDVMEnbie7e7DeA9tiq7oGxxtiDna02PUDULBZBbn003ED1wlQgqeZi3AdwWEKJB0KArsB7HaHETStnWqFtRNAwgPlAFV6cLYAu3SFLbH4HrDz0P8JcPvh8BRcL+7gPICDB3t3Ls5PwOHqD06/s0HvAb33t/sBbNMNuALf++ECoUsaK8dAth0ud1cxPDx/zy/OL4aF7kkIuZGCAAAAAElFTkSuQmCC';
  const IMG_MINE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABABAMAAABYR2ztAAAAG1BMVEV2Si1fMyCUbD5IHxOAXEEgDgpiQCxGJxz///9xl81PAAAACXRSTlP//////////wBTT3gSAAACJ0lEQVRIx+3UzY3kRgyGYfng+wycwNoR2BYmA6723Biw2QGUPkZQfCMQoLD3oG6N1DtrJ7C8CXpQ/ClRw/o/MfwCP4LF/fZfYLlK8+3nYLnKJrq7fw6WUJsApfxTEColyKY2+SdgqSZBmU1m0+1HENJ2gMnMPmp9gAVlCVWbspnl/AxCVW1Sk0Q1055keFSglJlsKkBqNp9BSKk2qQmcSjPdnkAipZS4B9Um9SNYokrV/RDK2wFcZyQur399xJUDWKSQuPzz5+vLby8vw8vr62vQP0BIUcll/DLsETqCElU61VDTvIMFBBLv45u7++jjGI9J3EFSEpd/f3d/99H/+BJ2BiTKI7g+gRJ1BqcUPUodTkDTNohhXdflOpfS6ccadB/llqIqwf0IaNMOAqokTkD3Kod1XaNAbToVGe0IAE167sLytoNKKbufurCtjR1kj1OKLOl2SFEZlZe/H2AIZLYDDwoqL+MbStzHMepe5bCuq9cMBVzGUFMzg6hm9vWjhoCC9zckmZnZN2nbwGG7qwDodNCdlGTaATMBV7PYhNQo6Qi6e5fsq7sHAPq2XdcdVJScai0eSaYEjoCaQQKgpGYp3du8A8q3l+Ahqdp0AERVpgeoTV2zB9rW8zHqoLI6oDbRVFJpv80FOkB1KktJpWSZfd8sZ2utUzN0QUnZ909uXR0AAnp6QKd03O51dQ9wj+2o7gH+/J90X9dlW9zb9nQGP4tfYIvvfhqWUqc/96EAAAAASUVORK5CYII=';
  const IMG_FACTORY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAKlBMVEWOOT9GUDHDv5BbGyqUbD7EaVf///+MjF5fMyB2Si08Fg5IHxMgDgr////9CbZGAAAADnRSTlP/////////////////AEXA3MgAAAFUSURBVHja7Jdtr4MgDIWBeaWl9f//3VtelosboCtbcpd45IPG9AHPKUbNNilzAb4CwFlqAHtrvXeeJwFmAnC7GfMzATDvAbzqwZ/1bDQmVtbrUqis16VQWa9LobJel0JlvS6Fyvorhe9LgU+pD2DoaMFa/DnAxqEjBCosIh55QB0tCGV6wAMAc2MkAKXjEBC4Mf4J4H58zMRx91EV464bzYtN9NRM7wOc6UJodGMFoHZ9ZSA2jNwBGvZDBpA0AHlRPu0CnucvAJAeknK7+njaBzCHhwH3R5B659ZVCKgByMqlXhSXoAZYa50dA/oe5BVY55UriB64NQNUHhAlwir1pEpBsks5yvyg6oOzndhbwX4zkMYD2X9ZiDoPEOV5MgA0mykC4vvyANDfzhkQCSPA4IVaAEKYBFAYAEK7PiySm+RYbkO6agFOfl08fmNcP57b9ivAAE0ItTfDUzdYAAAAAElFTkSuQmCC';
  const IMG_BANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAABtQTFRFYP9Q////OoErFz4g2MOtpox7W107IA4K////IN+tNQAAAAl0Uk5T//////////8AU094EgAAAVtJREFUeNrsl9uOwyAMRM3FuP//xWvuBLsU1N2HlXCqaNR4DgNKUgqvLwsu4AL+BEDr+gggY9Avij4AyHBTwEXREsD+EJiwKloAkh/DUQaY/YWwnQFEfjzLAJM/Go8ywDN/tuNBBniuX7qaMLsZYPTn4QtlMwM8/OwL1baZoQC05r0IBRAHnu56DGE/ARNyfP6+K0qnVIqaFhG9iT4MgwoxBVtIUy8B8A1QVbwfik0qcR+EctCgdt4sDYB5AfhSVx0ilQLIRhpUzyGVCsA0clWMau1SKQAfjQmQVcpCdVqz0gDoK6CpC7iAfwewDiw4S+6h4tmxTaoLUAHpyDZX21yxSSUALldsaergrUwWjLWORx4UTyVy4kcqCYAGqMrZZpNqBvAFm5N3RX0iUs0A9fd3ZxGgb1DnMvxMvC8/bTC0lrDaIuC8Q1FquUGZAHrLyQ7lvO6frt8D/AgwAHv7aKSD74PDAAAAAElFTkSuQmCC';
  const IMG_TEMPLE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAB5QTFRFTSojflpA////lGw+IA4KdkotPBYOXzMgSB8T////j8B5+AAAAAp0Uk5T////////////ALLMLM8AAAJSSURBVHja7JbrduMwCISVRQL2/V94YUCSL7KdnJ791ThNT9KaTwMzsl3+/vAoX8AX8AW8A6h2/ABQa5PW7hHltjyPO0S5LacmJsHe14grQKwuwsxiHFPxKcCWxepcCpsU+hig6vW+OBeT8SmgVuVECBmh0tUUyrpcRNkILEKkZF0wXQyyrMsBEDYZTZT4VSpdJKKs7APAlvc2bIwpQZaIcrKPun+GgAIeEoB4AmRyAhEKuoS2svMEYMzeIhgpgoIugayNB4DbB4S/gBA00qdggHoDCPt6AuZ7SLB/HAdZzvYp7LNSQjXyrPRyCZmtLaIc7WON4aUK34+WxZDQhrKJKLvd1+1zingOGyYvIwtzh9Qj4GAfx/g8ytZ5sx9IMEU4a9pZ9ruPNiokg6SI5SaObWtnmf5vZ8+YQgCM4F9SQpSLngGIbnS9aQQKNCW8XALKVRYtTER0Gt9bbKwhwWEu6gDABSQ2MEcTsDQUqMmWISEEjUSW9MBbkBw/5/Uwo+wfbLo8JUBTGpkAJ4bkSME+ypGGmQU/p8keoAKEH3M3uKuUvvuqKcHLmxwA3BFQwZKmUq4OJ7sElOseEHWJ8E/oZUZZ4UVIILjQkzBcOCDyhSjnlsZ14fUnNoTuXTgj4vxMomL0/kfvwfs578YVQiX2gvYsxmWh6fJ6sGwkAWgA/gBQb6+JR0RG2SaP30+AcyNNuu8+lzcAR4T08gDZfba+c3PdIqLcJ18Xz1yXt/eOoFH+8TNSINpt+cNTmiPabfnjcyLrffn/flL9Pu7/GsA/AQYAgbh94LxiBz8AAAAASUVORK5CYII=';
  const IMG_WIZARD = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAADBQTFRFQU59XzMg////gXx4PkNBdkotfnq5vLSqlGw+SB8TES0/2MOtW107pox7IA4K////kBUP/gAAABB0Uk5T////////////////////AOAjXRkAAAKqSURBVHja1JfJkiMhDERZajFo8f//7Ugp3H2psmF8maGrHOGO0CNJCYHT88uR/m2Aqn4F0N67fgGw+JQ+Et4CUjo+akjvDDAJ/ZOG9Gb+no4jHR8I9wDtoeCDD+lNBtxDcyEljRXpAsAWEB7acxhBtZ6nXCFuAfCwQ4gbWbdihKKTAH2lAIuwd6ulGoFEJwEdSehYweGrCEKlOQAc6JGHPtzczu1cAMAC1w8fTUrf6rnVOreEcDBMOI54TUK1vzkTEY00RiIs+nDCttUpgCLILXAlkU7sy6v4W8ArWFsbDC+n5yQg9Z/g1nJARkVPAGAhYlo2wN4EEEfoCiA3tmjeM8melZ3YJwG2AJ9+F2YWFjGCGKhpmvUgCBYtjHgSG6ppejvDQGYVCgXkjylYaSiK6WMNVBwg+lwEkE8OBhTwIkA9UsYiuBAtKxj64QFJuZVwq8BGKCAfsgiwfWNNdGPyRBL5CngNUC3AOkgsobgAWgF4fCkgRB6J+M7FOwCVIrVsEvEFmdQFAJwzAHs1CBQsAooDfAnMKOVFwFYh4ERFYzfIXTHfACyNnkdFFaAYZUWBE3xoJBHbmZcUjMGjjFDNfF1K1wDGbsRe8CR6GkzGAkBRP7GfvCKQFJYFBTF7NDVsRhixAEAgZMBBWVWgLwWEQJSC/0sXTBzthNARCV3pUsIbE6On0bBQaB6AEoimzNHU0ZevC+HqYGk5txBRcDqNnnRdzJcAOxgdEVaOvhpdXmcBfrjmfW+jOY8PyfvcHQnRhrGPvD8a58cjc96zHbGTgAZGsyM5O8G0PNrDBF0ckNdZaD8MyGj5sfvTWtPZ7ew2+IQho5mCHd9mr7pxPYKZfs8xGRZs32Yv21FM7YdiBNyY5q/7v32p4bo13r/55aq/43/87Twz/ggwAPtk1Xr2ls6wAAAAAElFTkSuQmCC';
  const IMG_SHIPMENT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABABAMAAABYR2ztAAAAG1BMVEWOOT9bGyrEaVf///+8tKqBfHggDgo+Q0H////F1uITAAAACXRSTlP//////////wBTT3gSAAABhklEQVRIx83VMW7jMBAFUMmFtqVSOK1XRQ6QxNkDWJIPEJLTWoBGYruAqH8DYo6dIo21S1JFECCsHz45nAGmkJ1T/ETgdkB42wNP3w+qHXAr3A54yINQHqos4L8PncuAoEmfbQ4Y+DYHmEi/GpcD8DoDgibSL53NAMDrHOhA+pIB3AEw7eYRW3AFmctrGoy0kzASyLR7Cb7tUiBo8t602zK2YJ3/+4gtGHvSOpNgr8sMZBIsXft8Av3pswnEvtf/tHMD/GpmQJs1BX75yRtjUKVA+QgAOKWA3Gp1aA7PhUuDuq6LJgeUKprmqwmHUz5BFUWZnIe1VKpRpyr1UWzLuhx+F9X9zG1AX6qjVep4joOg6VbzeVDzxcZBZ271+D6UrN+igDuzluMyHGHu7rgDowEGXoYZvo0DAlZeJgA6BoIGAF5mAIuNgQ6A5WUiwPcxcAWM48UxAQlgJmHvAlMC+EmEFyeBE8DKJ5BAUWCciLB3IsKxKmT6bLmISHDphbJ+dS1+w2r+AKoE4i4ck9ZxAAAAAElFTkSuQmCC';
  const IMG_ALCHEMY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAM1BMVEXPkEY0DAJiMhi7dCX25ZjhyYSaMxbYw62oUyeDQBTDkzhLGgpbXTumjHsgDgr///////9fs1uWAAAAEXRSTlP/////////////////////ACWtmWIAAAKfSURBVFjD7ZfdYvIgDIaBqtCShN3/1X75AaUdpW7fyQ7MHLPVPLz5KTD39Z/mPoAP4I8BqDO76ke6AhDFWEosMUZEJALYj/EMUQEUEV4CQL6/GwlioQmAInQz6PfVq9RR7sGY4Jr/6xaJlrgb7Xakc0D/EXE0gLux3j8H7D8iSeNurMpGBPeE75NwGM8luGfcLtFFzxDQpA+SuyWiXwMo5ewS4phARxsDMpZhoUSdfJxTTsm5m9sF+wohI+Awz73/d4Lrqs8/ZUCg/N1GAH4auO+HBFjFvH/4dd3YVho/zo1wRBBu7L8xQdyLLxuNF5RGwEO6FeAfm1lZTwGNUGRJMLMFRQHeVLD7OUAJABGiriv2YgZqDiR47/0UYBpQ/VlHKSggTqJlr2ycRwasM4BqED/xZ4Jckc0vpiH4c0BNg/hXgCgQgjh7ieINgHQUIloIfFEB1gfrPARtSKwSNIk8kgbBAO4DcZ8DIjwliDO/BapZEBWPcqUgQhOApqIpsET6dxTg3oCsEJtVYt4HpgBbGmo7ymOufVSrsF3lAHsRYAp09tWq8JaCzlSBFEERk6exqwJiCMEE1BxwAR5egrioQm0EDEu5h0rRKoiCx3qdxJaE+yKEBZYQrA/0SWyrwhVABDBhWe6l3JcArQ/qqrBOQ6hrQgg8N0sImhJKqS3r6WxV7iWEsogE/r1LCAzIsr5lmq3Ke0IQDfrnJcA2hqOE0SlNV/incRXyUUAnwY33wnrU0tMB5dTvTIe9aaggyYwgW5pMnPj1IwA5FqhpyzclOBrZBCABigoebnJySTTZHN1YQAM4AbCE6mZR8DgFpBfA1Of0kxBYQCI9cAiAMZnfq4T3kmj+cibQI5q6VsKbVaji2sZMX0SzInz+5fkTgH+MOt+I0SYo1wAAAABJRU5ErkJggg==';
  const IMG_PORTAL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABABAMAAABYR2ztAAAAIVBMVEWam0T/pEh4ViX9Vy36IBfEAxogDgo+GhVdKBL///////+ePFuwAAAAC3RSTlP/////////////AEpPAfIAAANQSURBVEjHvZU9juM4EIUbDmacGlIHzgQFbaaEqKBDgVQwYcMq8wIrUlC0ECCxQoPAqpgansQXUOBTbtDesfwzvcliFX9QFV+9qvdy/pfv5X8HJtN+CRgbxvYLYAoB2WDM7wBjMSVPnsxzwDhP+40nZK59BkyeIeuIOUxxeAq4PZEzxvoljs8AG3DTA8Buv/HUPgGalHqoqqxscPEMmDDZQBnJEnaezWr8Aiz5Xn6InK/yhsLbAzDh0lU5l3KdRTtMrjUuwGQ99SqPBI9UlutwDxjrvAMhYrEWUknAaxMvnzNwAfsyFnF2VKtI5NqHdgYY48lTJSIlimMhQErt2XAFpjAgw74ShSiKWMhMbEukcHHGy/k8+WCTTQ9SHgT/+X5aHwRo9On4q0STMo91KRQ/RcdDpuQqB1w61v4DTJiETS0+hOSn07EQmXzVe7LhF9BQSKjeqhWP+Gkt+KvItQ94/UOTJkvsRSakWr/zo+Jb0Mj8tYcJU/JUCCn48V3xSOWAtGftVagm4GKsVll2UO9SHmSpPXPDTEnr9mwAuToodSgUF7lOPM2ByTMKfwhQUh5lLOMcl7hs5wASJrXMZPwjElEW6z1ZNgfO1nl8q/hKcpHFRen2gw03wITf7TeoMnHICiU0eerGGz9M3WBZnZUfkRASkGHCboFzs+morrJIljLX5Alv/PD5ju4bVFJUoJEhkrsDzsZt/qxBAew68qZJ2GAebN+NNYCxng2wwxSpvVucjuFoTGA41gCaPGvvd5M8C65bUA1FDLi4eG4G4KYjh+kI8sjLjg2fL53fh+/Ygw719iBkrCldjI/3AXjuan6KVKy78On82foP3V9bWQ4go/dcALpw28MUnO/5TxiqQsi4AhfcHeAD6xXsaBspcawAZ3txGWhKBNCwvipUVOr0XgdjQ8cG47qev8q41JcWZlK/uZAGB5qg4gK6MNzPwjOHG/hRWpBRqXExPhwx8pteruNdDwBIt5b7lJrRNuYitz1ovxweL20aXMVVkTfkHCZPgEC+l+uobNKXBd1b7lKjr6TYecKEuSfAZCwBQMOQfBieJw46Y1LyFFz7m8wKCSNc4iyV7lLPOocJjV/EIvqU5on0EKzGWGe+Tt7J/MfZ/TcQTiCAzy6HXgAAAABJRU5ErkJggg==';
  const IMG_TIMEMACHINE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAM1BMVEXhyYQFM1O4AEGvu7L/HlgejKwCXoW7dCVbXTtiMhhFVEvYw62mjHscKiAgDgr///////8fInhUAAAAEXRSTlP/////////////////////ACWtmWIAAAJwSURBVFjD7ZbhgoIgEIRX0hYElt7/aW93gU48MbG/N5VROR/DChi8vhT8A/4BPQDR9m0cQGmhFz/STLcAtEzTQkCzMRcIh4Dnc3HobgOYsBAh0XxzCFo9BtwvojLwirufgMjJ4RaAfYgIrJRovIhEHtFVMWIQQMmzPdgiRtAQgFJA56s/sD4SGgD5sAGw3XsHQ4DW733w4RMB2gC2ArLdJz8EYGsBVDsXAYcA6NhrbbEL6xMB9gHYrfmL/Q4gWA1v1R6GAUELqEedCOOAfBXZ7WUi3AOosz4GAP49hI2f6Hxdw34e5RLoRfD8ooRumqY+ok0QFCBGnxjhvfqfrC6incp5Iok35DeC7FfExbUgAUSCKAGWpU9oAT6AY2/K+YOMQPzphLDfDxRQZQkUsFwH/EbQEBlQhvCcjgi7LU0AWgStILkMyHbeqz8CMsHJEuDZA7ABTMjb/MHmskvAvsA+53h34z15AxD/EaGtQZpno12TLEi+QWwACVR0dhnZLwhmhGR1DbwBPAJAuWOdAvw8z4BCSIEMSwBTBSAeEVqAMeCtywFmw8MBWUnidxJA7nangGAMBp0FloyUA3QpirD4zwAkACPTIFgZAG38rvr/bC+/AD6dGsGR/wzgoBW+/ZN73/GxfxXIOTqX+GG/xTU1WBs91kd58kFEPBfKOXQIWPudP6JI/vvV5sEQVuLvKRa1LSoZNs0DAP8Y3ymaVoylX2muTYQGwOc+Vu35T6t0y8+49hPIj7Ha2lZNIJ/7CaJWoQTftmJNIM2TBP0i1gTS7CXIhI5qgFgDHCQQQk+lfzXH3jx45T/ZF9Xblcf1NeAHn8XZw5COg6oAAAAASUVORK5CYII=';
  const IMG_ANTIMATTER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABABAMAAABYR2ztAAAAJFBMVEVbGyoFM1MejKwCXoWOOT/EaVe8tKo+Q0EgDgqBfHj///////8tH2BrAAAADHRSTlP//////////////wAS387OAAACGUlEQVRIidWVsW4aQRCGt8CC9nCD3AW6dA6NldoPwFMsPlcpImamAyvyzIkm1c7+dG4sx09wEi+XggMb66xtk60/7fz/7My/YV844f8DzMxs+znQphhjzJ8CrcUYY7yzT4BW+QCQ9QKtguPr6+vznbj1AK0CeQdgl4F3xAlQAN6k+wgF4NuPQCsA6kYAaWoA/BFogBSpEUB0FQFsz4EWSEsjdbgrawTyOdAASyZnxDqTM9WnK8JRQSICm8OzidPqpCIcLSyNuGGHZzFirY9GQlchsbDiALgJr441Qldhya4QFhEWcc1UdzVC52FJ7EKhEVkPhTJR3fkIBwmJSYUGt43Ir9uhkPKqExE6CeoN/V4EFVqHhYv6YycidCY1i18EYzNeXwzB/tgZDfv9viUshf3HYqTqrhYWlIVqPwFm6tTgZ9i8uGm+Wg8ESm62PQBtitlUaTB6uLFqYjMbDEnNUswdEOMfsNlgxFbNq4nxYGQmeI53R+AeBLhps7mcXz01agq47N4BCUICps18+v1JWUAi6RxIcOJ8+W06qyaZCAlnwA4JQObL8dfpfMIAEnZ9N4zH0+m874ajhodqOrvu03By8aWaVz0u3vownl339OHUyc2LVRO7+tjJt7d4uHHTPPv4FuXXLM5DcaLKM1mc6uJeFDervJvF7S7mQzlhihlVTrliTpaTtpjV5bQv/xflH6f8Z/WdfwH4C6fJ1S4UjxJWAAAAAElFTkSuQmCC';
  const IMG_PRISM = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAACpQTFRF7v9AqxB9eOL1tQQh/6RANeD//ztAHoysAl6F7nP/IA4KBTNT////////uaCsdAAAAA50Uk5T/////////////////wBFwNzIAAACYElEQVR42uSX29LqIAyFgarQEN//dfdKCFhb2tJ692+80HFmfSxy4ODePw73nwKYfwPwMMDXsa8/AEA318ELxrd+F7BQQ8/z7D339DsAlT/bYH4KxXf0fYDJXR3shAIXpj8Loq/yRx0CKS7W+h5A9UX+KkMQ4sJWcbIE03/kFeE0lqcxaHrIpjoUgUU857W+B6h6CO0/RTzYOUTSv4/rQAyY/uv/6cXqYT6rAzWw1QsBCGdx3AeYga0eBH6phdkfA4qBqVMek1p4ngLMAK2HLAK5PAboCsTARCGFxPiEVAYTUoFqWK+hB1ADOeYcMmcbIZmFUUAhAEFZ/Iv+IsAIn/mvA1KOZXrMH28AlGDzq/4yoHho898CJElEilcBUgfVAvTNwEAdLCqxEtoChirReoEXAF4AHiO9MKNjHy9uhLA2cAx4Y89TC81DWOg7BtYA7DdqwVaBJEoim35rYAXAduVnWHAsgYRaeiEloqrfGNhuqmJBPRAlLt1IgjD9KQB7nhxADnJp5lCaSRFd/SYGJY4ql492s3SULqSj/wbYyccUPp1sFoAITP74jlT1b4o5xjK7NTTk2ONo4JKl5wZFNEGMy9mxNcYRQDl3AEiGoCaPIwA7txRQEZmLfARQzz0DKIJZOGOAdm5SjEVu+0FBhAFA/YUihkoZxT++A9GVqy429bgABDTFxbsyiW8DBCnJq5ftWguoH8j7ATwDaBZUHu8CklRiijcB30G8DLBUCmA3hWfvBWpBpJtPHrIg0t03k6Yyp/ALQO5IvwBikhjcBkgmjjIw8uyjY/mfeDv/E2AAMuKwpvWhv0kAAAAASUVORK5CYII=';
  const IMG_CHANCEMAKER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyJpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNiAoV2luZG93cykiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6M0M4Mzg4ODc3NTUzMTFFN0JFNjRBNEFCNDVBMDQ2NjgiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6M0M4Mzg4ODg3NTUzMTFFN0JFNjRBNEFCNDVBMDQ2NjgiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDozQzgzODg4NTc1NTMxMUU3QkU2NEE0QUI0NUEwNDY2OCIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDozQzgzODg4Njc1NTMxMUU3QkU2NEE0QUI0NUEwNDY2OCIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PuwwuvIAAAAtUExURVtdOxFLHNjDrWIyGLbTT+7/QP87QGalKCx5F7t0JaaMe+HJhCAOCv///////x24KXoAAAAPdFJOU///////////////////ANTcmKEAAAJNSURBVHja7JfhcuMgDIQj7BxgxL3/43a1wmnGkYM7NzfTH2HalMjSh7yWBb39/cdx+wA+gP8FUIyr1gCgesM4OsfWCEDHZM5zawQwz23rW0rPvrE1Aqg5YqTen3xj6wkAfrjVIyCyRoDh2ZqmZJN31nOANv3TdDsAXqwxwO5U74ofzt5ZTwDM8X63RdM3ILKeiJhcLks66XtrDIAD89yeK9fmw3hM4LWQtHWInbQU2QmqUgqNvavOKrHVCoKWnDMQNAm/wNgb6BcAIJRcMBAFy2Nu8W1Wyq2BgHVEGJVVM+NFGG/wCaC6lyVdVgvkH3wFAFdqmwJAYHzOq60NACaZBFxrVecatE4NGVdkTEyDID4G8LmZbsLhKoo94ToX0W8TlcPQ4r+QEAUAFS5pMHygv0uAVLx89IqIdV9EmXn2Ty8p3l6dZaCLx9vyEE8g4sokeHXRdg3g6ed1FVnXLIPwEwDjs1diJuFHAEtA/OF7SQhTuAKASgageha/9fFi2otlhT4TcZSBeAKCPqI+swfBhzzNoHcShAnYZsAUZI+v87eRTcO7kG8Ge3fiHcxfpr0QrA+OzWD0x0jDEMBSfN0MkMAVQN0r4WUzYALT1/kphcNmECcQAPg6NVPAtlLu6slUaFE/Co84bGpEpDEsnI+w6pUzEuLbsrA1jmGtelmCbhKf0sxfFYjaLRM2+mUhRi8e8yyGN41AA1mXrMGudHrQ5Gre3Fw9RLceHhPPTqoexsAxicPfHHWxdH0MPQt/f1bWx/j8v/AB/HrAlwADADf1xhZKUs9SAAAAAElFTkSuQmCC';
  const IMG_FRACTAL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyJpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNiAoV2luZG93cykiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6NERGNzBENkZEMjM0MTFFOEE5MkVDMzEyRkIwOEM0RjIiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6NERGNzBENzBEMjM0MTFFOEE5MkVDMzEyRkIwOEM0RjIiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDo0REY3MEQ2REQyMzQxMUU4QTkyRUMzMTJGQjA4QzRGMiIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDo0REY3MEQ2RUQyMzQxMUU4QTkyRUMzMTJGQjA4QzRGMiIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PgVcnS0AAAAVUExURZ7B0f///4w3YVJquVOQ5QAAAP///ydUdvkAAAAHdFJOU////////wAaSwNGAAABQklEQVR42uyW3Q7DIAiFUWDv/8izKoiw9Mde7EaTJRPO+dZSOoTPywUbsAEbcAfAzE8B3FfbQAKO4TMAA1FxEVYpE1L7gjVKwJcAQsREAsiUBUCpZOgeAASgNTgAsALQ8N8AK7dQlgK4eLSIcKSuAbksLB+utpRSJXCPZn7SSHw8T+qEu400Fa5edLl3vtfKji/+QJh1YAxohd2PgeB0MOJSsMmfPcHpFNAMKlQ/O4LTKcAVbPg/MyEWFn4VTLatGXJMGAJop/bVdE3E+hcxJ2RrAFkyx1XrthLEbxN9a2vQMz1uCNYfdPYp1IzGBwFmg9PZPsilQUZcCMn9oNfZTpzftXG7kz/oTt6FWLDzdyG+jaFgTweLLdjaYBkFWx8seQ+W14NFzgeLg8WcD5YGizkfLA2WxTPSPmhuwAb8CfAVYACNp1b8TxMq8QAAAABJRU5ErkJggg==';
  const IMG_JSCONSOLE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAB+CAYAAAA3MXHFAAAD5UlEQVRoge1aC27bMAyVitynO153gvV464k8KAgDmiIfnz5GsS0PMJI4ph4pWaREqh7HUXbiR/l5b/B3+VVts7XW8sZySUMsaq3u808LI83afbmnv48q1eRcC5uQFmwPamUizbMeELnTGLab78fH/ftX/SzHcVT9n/4dkTU5Dd1ea+amtZcGPSuaYNalQibteFbfrJaa2LPAs1R3tdcL2uq39rC+Ya1D3aXRiDSZtU7+u+kfDFk0jqySN/0j6vtVMi13ix6+guxJiIh2khVr4QxRJB/JPie+fmFmiHQbIVmtZXu0SBTio8UunAit476cUBBFhAyMwqcxzB72HLf2wSisFT2GbFciyx/y1XtWfw9fmjaf5ELQVn/Vzztpk5E42Clt56ENwNaDgDl2moMipx3BaVrY8GI1zCzV8mh43ImvtXtoBj2IJ2ute/RC70sj7ZnnGAd+iadBDjz0pSPdyMr9/c6bcSCX7C2QR0oJI185C2oM9YrbLoQZJbTzdldterdU1MraeiMWWkl34ntWRER2R2U2Lx3gGOpIgLpOLLdKefe7DWlxooL1rbpR9kUKN6QoKkQxjsFpQ8rEPGSlnXdgHOsbux1D0GOVjeOzS0c2LSu4ZbtXAUoojOCyaOEZQUf8GUS9Fe4PPaAMBouheMiMYRYT7xaiF2J2skeJpG5dGs2p2TkaEnqIci2XEQp2WQcJr7AuJLRkK1EiJYyc+a6teLfHt2Rs1GfRxcMSRA67nUbtR8EARnwvJ2objIBWd8OZqNlNTkGbGVR7yLBUt1gJuGndQpDVHhDJcN2CrT2MkmnZLqtfQO2BIctkwwQtkwKZkX0SjtQeLEZk3ay+YCRiMLJwWqysyJFsGp5GV+SZLBWeLstEXU3WEc6Sjch2rm0xGqR1i87TRK83U/tlZLsuDb08ETkY2e8tlLwId8CNFqMYkR2KFgis7OW7JypalMXdE5Klw9MMmScLy+qzJXUkC6trVoB9iaCiLVroq92SS99/Pz4O/eldkaxcLiG6hCxqMLvKTCYKHeRhMJyJWk0ubM1EMcF6ORPl5dbkt/fftkzUcpVbI9tXyPehKnegsTSUehu2yu1mhGd8KeuRti71GfltS31W3vU0qzWMqTNRM2RMDWTrmagMp7fUHvSYwZBrM5osES9VuXdjqRQUDYGcRdX3pJtdCz2BVXSpL2RB9BIwFW7rxOEe3xJ7yCqjViR8abKTtRbsEMAujU7WImTRZcsRpWhl4Fm9PA+Z2Hk6Bb2bLLKuK6uvAEUYa/VyJio5dHX67z88QbsDWZX7MgsjZ/FKfb0IX4QdLnFtqMr9j6OU8gcxdqdAd/MbfwAAAABJRU5ErkJggg==';
  const IMG_IDLEVERSE = 'data:image/png;base64,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';
  const IMG_CORTEX = 'data:image/png;base64,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';
  const IMG_YOU = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyNpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuNi1jMTQ4IDc5LjE2NDAzNiwgMjAxOS8wOC8xMy0wMTowNjo1NyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6QUFBNzRGOTlCMzBCMTFFRDlCRDhBODUwNkE2NjQ1REEiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6QUFBNzRGOThCMzBCMTFFRDlCRDhBODUwNkE2NjQ1REEiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIDIxLjAgKFdpbmRvd3MpIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6NzY1MkZCMzk4OTNFMTFFREIxMDdEMDA4QjBENzgwREIiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6NzY1MkZCM0E4OTNFMTFFREIxMDdEMDA4QjBENzgwREIiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz7OdJY/AAAAIVBMVEWJqKDQkGW0UDbhwJZAUFFuZltyfopcW2UgDgpHLjz////A4gNnAAAAC3RSTlP/////////////AEpPAfIAAAPRSURBVHjalJfbkus6CERlB3GZ///g0wtl5ykpc1Q1YycVWtBAI62/r8uiyneYa0WYxd72/Zfruzmm/O2QKa98VVOAiDJMcUFrHwhcGgJUbRmEzMPXcgfD9dxDAJl6VDgRbDmijyZIfYgaAei31fZ7V2XqXc4UWGUjgJKJfPANjELop4ytbE8AOmfsLzPZQ8J+I4mVAYB2d+yTLMibMpzpb79lcn2JwDBJAs9esiYMKmHkgRz30v5i8L5er+tOONiQEPEMAFdGzBZ5v3qB0AxQmY8AioCykX3ldQCuNBACNvwRoK1hrf45gAtWsvetBD2HgK/Nvhy44ECPrNxee4nLR4CTuS2P8/VZonSJVWr6mYMOQSKQ+dLer/5HQSsA/h4BVjdxeV637G4IyNd95a5FQT4DwLT8rezgOwm8pXjVtwMAWrngPC/SeN+kUQ7sZXJhUgddutIUvdy9uUox6S5aYgBA3Wp/sqZSvLRubW/LlRkhDzwIWkE7CsLkhLYvOW/eEQw4oInDEBRBvdsxjM2deh6QSMkfB/YKzOVEdFAtDINKpOnE2ZIMro39RSlnIwwqESmXeVELDIRsJsUjCErOhIONHhQudGMSQz9b2x8B6FlGU6BJawXqmN5zqaVtwkHITuWQIQDl0JUFyDREYgDQJEAatsvJwJFWNfmkG89gaxN5DxZEwgPlXZNK7IlGBcoBpoE6Sx9B8EkI2sSwP2q+9qIISaWEUXDrGUCEW+e+EQRAQKenlg08SIoeAKRUAoJCZ4uCLctBISWTraWgB4rS7z0gFIFOGj4RFEomsbmy3+04wAePAYnWmhZnV6eEiEcMCHrSTORKw424IS5R55bmFqpJHchnp/7bcY2UnpDoEggWg/Fe3cTZg0kDQVNBo+lorcfkgMHphtOVzF+tSBoR2eomhAkARxMaSObMtIAGHkqHTQDs2PdY0KY6KdBXuCCEEYA0pBgl3Y+OJEiikhaN3COAYy8j7FFYj9ZlKcwYoKgg62ZWOwmgq3PXJAsiAYB6H+8Q1p3Nau3ZUVeadBDIJfrmfbKgkGcAyCqmSGH0lQUKjyoOPTiqVNaTAI0XfZSyzY77yQRrHebYrdEc1IE6zL4cVL/eWN6HY912et84zqhAY3jlkWHXc3UlkT8hcQOqIcAnhg4hjwPFzWl6a8vPWb86/Og7zDyEP6qYGd1E9pmLa2SO741/ZPE9oSjo3efUr1euHwDK/xuC1alA7GMMAIIgGBF1rjyhIrD53ZlEct3+XJmiHfofAGdCdkscZ+oHAz8BTjUZd/emw+zX7/4TYACSB4Jd7i4N3gAAAABJRU5ErkJggg==';
  const IMG_BG_GRIMOIRE = 'data:image/jpeg;base64,/9j/4QAYRXhpZgAASUkqAAgAAAAAAAAAAAAAAP/sABFEdWNreQABAAQAAABLAAD/4QMraHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLwA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/PiA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJBZG9iZSBYTVAgQ29yZSA1LjMtYzAxMSA2Ni4xNDU2NjEsIDIwMTIvMDIvMDYtMTQ6NTY6MjcgICAgICAgICI+IDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+IDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnhtcD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLyIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bXA6Q3JlYXRvclRvb2w9IkFkb2JlIFBob3Rvc2hvcCBDUzYgKFdpbmRvd3MpIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOkFDNEZFMDAwMjMwRDExRThBM0RDOEE5ODgzOTdFM0RCIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOkFDNEZFMDAxMjMwRDExRThBM0RDOEE5ODgzOTdFM0RCIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6QUM0RkRGRkUyMzBEMTFFOEEzREM4QTk4ODM5N0UzREIiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6QUM0RkRGRkYyMzBEMTFFOEEzREM4QTk4ODM5N0UzREIiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz7/7gAOQWRvYmUAZMAAAAAB/9sAhAADAgICAgIDAgIDBQMDAwUFBAMD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';
  const IMG_BG_GARDEN = 'data:image/jpeg;base64,/9j/4QAYRXhpZgAASUkqAAgAAAAAAAAAAAAAAP/sABFEdWNreQABAAQAAABLAAD/4QMraHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLwA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/PiA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJBZG9iZSBYTVAgQ29yZSA1LjMtYzAxMSA2Ni4xNDU2NjEsIDIwMTIvMDIvMDYtMTQ6NTY6MjcgICAgICAgICI+IDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+IDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnhtcD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLyIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bXA6Q3JlYXRvclRvb2w9IkFkb2JlIFBob3Rvc2hvcCBDUzYgKFdpbmRvd3MpIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjBCRjcxMjY4MjMyMjExRTg4MTYwQjg5RTU4NTg2QzhGIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjBCRjcxMjY5MjMyMjExRTg4MTYwQjg5RTU4NTg2QzhGIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6MEJGNzEyNjYyMzIyMTFFODgxNjBCODlFNTg1ODZDOEYiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6MEJGNzEyNjcyMzIyMTFFODgxNjBCODlFNTg1ODZDOEYiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz7/7gAOQWRvYmUAZMAAAAAB/9sAhAADAgICAgIDAgIDBQMDAwUFBAMD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';
  const IMG_BG_PANTHEON = 'data:image/jpeg;base64,/9j/4QAYRXhpZgAASUkqAAgAAAAAAAAAAAAAAP/sABFEdWNreQABAAQAAABLAAD/4QMraHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLwA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/PiA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJBZG9iZSBYTVAgQ29yZSA1LjMtYzAxMSA2Ni4xNDU2NjEsIDIwMTIvMDIvMDYtMTQ6NTY6MjcgICAgICAgICI+IDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+IDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnhtcD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLyIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bXA6Q3JlYXRvclRvb2w9IkFkb2JlIFBob3Rvc2hvcCBDUzYgKFdpbmRvd3MpIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjJDMTA4RDdBMjMwRDExRThCMTQxRDg5QjRGOTNFOEJCIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjJDMTA4RDdCMjMwRDExRThCMTQxRDg5QjRGOTNFOEJCIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6MkMxMDhENzgyMzBEMTFFOEIxNDFEODlCNEY5M0U4QkIiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6MkMxMDhENzkyMzBEMTFFOEIxNDFEODlCNEY5M0U4QkIiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz7/7gAOQWRvYmUAZMAAAAAB/9sAhAADAgICAgIDAgIDBQMDAwUFBAMD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';
  const IMG_BG_MARKET = 'data:image/jpeg;base64,/9j/4QAYRXhpZgAASUkqAAgAAAAAAAAAAAAAAP/sABFEdWNreQABAAQAAABQAAD/4QMsaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLwA8P3hwYWNrZXQgYmVnaW49Iu+7vyIgaWQ9Ilc1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCI/PiA8eDp4bXBtZXRhIHhtbG5zOng9ImFkb2JlOm5zOm1ldGEvIiB4OnhtcHRrPSJBZG9iZSBYTVAgQ29yZSA1LjYtYzE0OCA3OS4xNjQwMzYsIDIwMTkvMDgvMTMtMDE6MDY6NTcgICAgICAgICI+IDxyZGY6UkRGIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyI+IDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PSIiIHhtbG5zOnhtcD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLyIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bXA6Q3JlYXRvclRvb2w9IkFkb2JlIFBob3Rvc2hvcCAyMS4wIChXaW5kb3dzKSIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDoxMUUxMEVBNUU0OUExMUVBQThDNEMxNjY5REZBMUE0RiIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDoxMUUxMEVBNkU0OUExMUVBQThDNEMxNjY5REZBMUE0RiI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOjExRTEwRUEzRTQ5QTExRUFBOEM0QzE2NjlERkExQTRGIiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOjExRTEwRUE0RTQ5QTExRUFBOEM0QzE2NjlERkExQTRGIi8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+/+4ADkFkb2JlAGTAAAAAAf/bAIQAAgICAgICAgICAgMCAgIDBAMC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';
  const IMG_DRAGON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA2AAAABgCAMAAABMpOELAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyJpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNiAoV2luZG93cykiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6RTgyQTg5RDREMUE1MTFFOEFGQzBGRUQ5NzQ2MUMzMzciIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6RTgyQTg5RDVEMUE1MTFFOEFGQzBGRUQ5NzQ2MUMzMzciPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDpFODJBODlEMkQxQTUxMUU4QUZDMEZFRDk3NDYxQzMzNyIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDpFODJBODlEM0QxQTUxMUU4QUZDMEZFRDk3NDYxQzMzNyIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/PjrHcT4AAABdUExURbJEOZCAdwCF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';
  const IMG_SANTA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABaAAAABgCAMAAADcriXpAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA4FpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuNi1jMTQ4IDc5LjE2NDAzNiwgMjAxOS8wOC8xMy0wMTowNjo1NyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDpiYzY4NTUyZS03NjNjLTA2NDctODA4OC04ZjA2MzIzNmZiZjMiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6QjA1OUMyNERDOEZDMTFFREIyQkNGRjhDRjNCNkFGOEQiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6QjA1OUMyNENDOEZDMTFFREIyQkNGRjhDRjNCNkFGOEQiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIDIxLjAgKFdpbmRvd3MpIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6NWRjNjMwZGUtOTRiZi0wODQ0LWI0NTUtYTg5NjMwZmE0ZGNhIiBzdFJlZjpkb2N1bWVudElEPSJhZG9iZTpkb2NpZDpwaG90b3Nob3A6MGIyYjNmNTYtMDNmNy1kYTRmLTg0MzAtNGIx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';
  const IMG_WRINKLER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAADICAMAAAAp4rTzAAAAwFBMVEVxNiKINyIzMChOMCPKkmA1IhlWJhpGJBm6YzaqlFSKMBy2bkilRCVjKRsuGBVqRiyYQiZTQjDLvoiHQCXCbzhMVUS0VSx6Mx+3WzByKhsNCwmnWjNJYlTAek05QDQ9T0GvSSZBHBhpMB6UZ0ScNiBxd2urUCuaWDZPjHBiYk9PdF6LUEdrVEF/mIqVdz1cMCCsYD6mTCyAVDSoOiBDMyWuQSJyXzWIeGyJSS2XTC2fUC8mHhkkJyLKhEWxTSv///8Vxz/4AAAAQHRSTlP///////////////////////////////////////////////////////////////////////////////////8AwnuxRAAAFeVJREFUeNq8lm1TIjkUhdOdusmCJG3bxYQOVYxEdMsql7hjRDTU+P//1Z4bcD7sOLNNFWwKUDHkuefclyDej1z2/fgljtxPRP8DRGt7dkjbSn12SHPTyPNCrLXfRuvGnhPiiWwDSCJNZ4PYD4hOkc4D8d5qgl1XNzI1TbLngHjvSVJqrq7WrWwaSWeAWLJWN20LyKhtN+v2HBCkw8r1pn0ApGnWo5tjelIM9OoAYbuummYzWh/j1yCI9Za0pXa0Ti0g3wAZNSeHWIuk54cR0gHIhl8bnU8MIcggeoESeQMI69kkes/2pBBKm1T/NdqQkiDpNLoaPQCS8wkhUsubRK0kTHo8NNIzamtP6XQQnxkCAs6XEhSiTIlybjfDGl8MSTu1iSQEaKVj5FdN2Wqd06bJp4IQtYuapFIxKKU0HqBg7XI6GSTXqa5JRxWEM0YAoaJiy/Iu06lyYmswSKsQDC9lTBSsBZBd9ieFUAxGBHEAIS+o3/pkkExUlEQlGCIKB0oy23UKiM/1YrHAk5B3nN91jAAnslsMyT57nw8/j4egcvW+jABJkAK7qs6JgGVEeb/OHESdUApccmnnj4LgqlX7VTgpMS90lx0vJ8yegeoq3RMN9JW9NBzia4ka+qgm5qDVkw6v8/nb65/brovEbQ+pindEPMNhpx0K2SV8DE3hhEMeXIXAdWrbFLs3UMDpIpg8ZIzpe641yDZ9MOEXWj6BUFtCE+w+5IjKOVDkdCou3x4f3x4vAOFmZBl9r/SyLJaOaNJnWsQnjJatOqQEn4Uk/Knl/cMWSuaPF/MuwjzFh/Zq+WNp0wuVahoA8altBB9aIsQrVwBD9e1LRNYf5/PXIJM8vMlbOBbstUt4p9MQCE2njWObcTyelhdAQSg5TVF0rtuG2EgWgkQviUosineyZXJRD4HcvzQIiBWYfXwMWionFEaL2HZiu41FRxcOMXjeUHYudbrPAyA23TYQQkvEyScgwYxZonqQl7BtxOtr5MoNlSkb0Pd7uUAsMQgGVVc5dh+axWz8Oq3LGVw9GuNLhE4oTBbui6XNlhb30z3DoqLN0D7xe58Zgr5e7CHsNxIVt12I7BVmmCpm4bIh/vfSEipf+WEQjyZTpmSTc8JfHfE1GM3mGCIiuidGSIGd5V8lgN5ACIrDDhsr+EaKiudJpHpeJftogd4FvuG57CR+oE8ZUkqrH48N1yLfzp/OFfHTcIfNfKZhHfsRCXucY4aMfLbiX3gmQmUxVu2D+Rio/r8gfDVwW8Acs5eD0YHHeFzBrVK5PAwjbBNOlf5YmtV4vMKzwkaWmvzvIT7vauImVL3rK9f3+PRk5YJzY1eYGGMhsHOSHVOmcqFfPT09PU9AQSB8nf18rYh/6aBUpoQp5yNCfHxyiWukGvciKteBvXVMYbGuurycTCbXz8933+8uVytARNT1/e63ENzlqRgPBiBY19ffZ7O7uy+TCh2CM13VVTiLfenx5993s9mX2R+zi4sZYuE9sf56W/8a4j280gz5hxHrb05UCYLyS7cKImxAQATkULGSM4oJ3gkE3/f/Vq9nFpO8und1t1eXP1Jhm5np6ekBs3yrMC7FLbQz27TP/tVtK8fbdp3X+hpPKc0BembHtmlm9tnxKFmN/q7nevI7EJiGdKGmKUA4D29OUVVxlmWmcNrNcXXG78Jw5SAWYtlSO1eVbYciq88egiwfjAYjX8/X/W9AEliPfKE8KFDwUHVDGFUlsiwIqq6zV0jd7SYygYC0CRgN0mkeojk7iBncghfHatE0QPqvVbqDJOuc3Jo1Y+eGUFp71VW2WccAEWFVr25FcYljITI7PLdXPyqlQcUHjkcUiXiQTU+yyRtj1qy/UuwTZE0gukUahYRprV3bWW1jRuEOv64LYKDEIgBmhTEfaa5bTuWEKAKIJaiAic0YsDZNni6s5O7EGARqneg5WTVLp4abSHSb19lmt997Hq7w6+LtcilCEQSZadp1iwJoGt0pme5kJx7KaIIPVSfwzsDkTHcL+LL5B0iCYr2zF4WZ4sEqF/JURih/h+u0SHMuwLiFABlM8KD2NDRlhD/A5wNYy3LJ7gmX4ykMAgMfxZo0Xe9GMhPIe7rWe9qjLNRkRigzvCLJUwQeXfctEe3tgqqjJoEAnwiEUCbuAX/onlh+SHPwADy/NAxDYqdJH3fJHaR/Xui8q305qCAeR5bd11c0/HZL0kEZi8OwAptQhaV6fz7Qf/Q/hAG9MnFPp2ZNzrZ5efoESZ/Zt4/XKz2l51zXnSzxchrVdkvycSEaQ0iIT4yzZBsIGcD9cLHwOdT14DHlPv8EoS7Mx0WHDv4KsselnJTEnS1f6VTh7XIJw5Da51Z4RFs+4DDeQyN3BjyfTZpKfvqy60eQvm90VOUThcYH/Pt4hUNni6ajTIVCiBg/4riAcGp8ueZBNsnrU0VYCxhjZq2fd1L2DIJNWSY9UGAxed+klJURP6yRvpyd4lZU1CMoOziM/8MQUG064gUMJrqE0ou00UAYL6FAdLmhVR8gjUxIgHN9Nu4jyuY+LCkFmuZfvXMY8v18zAEgJkDiukOdUTXklgHuzp7f09LXqf5PcjwwSGJxcfo8f7+XfsobATUZVOO6aat4jGHgEwAGIILahV6DfkQTHszTOzuhknnPspuowqs9+oCkWSO/qAUmtDxgeNDUWBHIgBiGESZAv8S1xkXzI7UCKQgVCmNwJyZftKt3fySQF/qgwc434hUUQhlFXrfickCNB5POozkIYWarKzOjvFuI+2EMfF2QH8P+QyC5MNT3BMOmS9n56cm/rmohbPAqGxjl8TEAC1YtAvliU7jluewgqo5FVR76X+YJhYMRf2is+QjzUNIkNjBd9nVd24CxEU02BEwthzFg9AxVQbX30ScEvCjpb/JLJCpnvUXfSdWBo3MPEEB8QfWvGCCdiEeOiTAstlx0DBW5MNROp9YZ7LDw4MnHe/+fJZoDBFAzy3jFDoJgTnKxkFjfURqqf0UKGZ+3W5q2EIapxGrELnluuPSRauZuTvP5H8xds5G0wM/l8ehyx5x+7NKDH3FbejT5u7bzMAKgtvBYxtOTVFu44X53aRt43SR/tqkWrSZ46Hg0etZ/92V3wLTFQN7vO8wX/OvaFlIIs2jI3W5sYGOzkYhn/voXi2mi2p2it3rV/Yefu4NPdAbKvvUZArnCEKFUSm5w65u12TQN7U1/Y7j/ZcxsmxNVoiAsEJUSDHgngOsLsMRoxbiFGEzxYtz//69u9xnMp2yET5vUxnaYOec83SP+Gm/5cdxK4IiPmL28nrArMEB4aZmOcHhoZ8EqYSQpR/c34hZxgH1EAq9jbW1r9avgEfNOFT8+o73PR3mOg1fqXhgxuxj9Hk4xFE6XPiLxwThuJpwmasAoQLdljPLZwctggapdhdmH6cfbLdmPcUY0jzDV7LP/2sszmi+nxpcxtax0gSF6zOh38e1RlygZmX16gsqmj9T7+2bip+dCHfa9RNo/L4hQ/OOS9mmIDMUaSIti/5BpDtdIRzUSRME/cKamfhq+205dnV5fF31EHl/+fHheVO9gRYRd0Ill4uHnEfu6AtLT6/GX0CGX5lGxvr6fd9Xp0EtkMTx8HA5epGqj8Zg1I+Qyuge+pG4MDDMv40QTZczdsrSmE/fsqufKOxz6vK5F7hnYD991PLg3mMPIdzf4ONY7PtRTMi3BpganM61KZCG6AxQfd4oHIl7cF3mceRHJFC2Dzyw3XB6DjeCEb5Bc4Nxgw/ztsdaSGfCXBZxFE9ix4L4IMqLAU2/ZbZDOBhRBr7LnoC1AHR0LnYJfgPgrrAVjzSpNwUEgJ+rzbrayiMGXFqFWa4xwBPjd6+XnOnVBW26aNg2WtHFDEMXcNRRgeVpa3WQvgyCJ7zTIxaXsiKVDVYROwBAw1/zpCUgXzuEQAUcwkeBi+K8t2rKP4ZlNO8yhbTB/ttiLeKh7qgAB6hsFCBV/S+ZKoWCDIbb8yZ5fqVhAw8jyGVg+lxREjIH5o0gbd0SE98s8iBsDNzBJ4Ru5jHALlHAEIPkcn09VhXZm0QBGNHh6PcnPPj7JRYQ0rwZ5t/d5tHGXSyJkCAAjF62LkFN494H0FrkB/9dUEnba+Hsif00Zc0y1RGFYsomjH1a75joH3Nm+ERLAHp4e8APY3mDFjzMmFJpWIGLGP4v8DdjEcx0GQcNCzoHKM5bzEDsNcvQVZrz98N/nsgivm2gzgch4oGiuRx2uDOP4Tp1cAsv6Yk0zHk9xtnaGzx0QpH8SQMXOg8JTv/Pzb884XaYJe0UEjpPFvYoHXpZfPIt2gSbmvDWO7DVFPj/tbQGREPDSALi5KcgKR2MgY5nAwidJe7ettFDhY8lKSlgIlVVL2GrQ1lZTF808KwS5TpYZiiE78ifYTjNJkmCfLHoMLXnkJg4iNHUKsXbjrG1WB1cDjHRClw3z11S+BF9vCYeOV7Xa7+MeIvHlom8sEGLgfQGFd/DtqsbhssOri8JEoFN0Jkv8ixx23qNJJa56rKTFslspebm2xJ1JvXxYK4PoSAvnFldEW4Y4is45QEXm8KOwUWzeFzH1LRn3PWclqwpFjdK010/IbXAdUNRCknWzqyiS/aIXG/Amrbs26pFwJzGjCe2GBBye3xg31sf1HHPEaI6uwcimaCpt9iI67FOFDsRap2/oMbSSQCyKqEjwVXkIzBs4lAIDMproxxAI4uxXkbbicmHHfUx6iKz2sXYOXbxGizKoHpwl9qHbBFdiIb3rWJTShpRHfjz6pqd8t5L9KhAZbrz2WlyOQnNhLKBn8W010NjVUNf3LbIpZh+QQE61D5BPtGU5I9CxveJhPAxERC9JGeaA5Rh5QNVBVkXE5+fTCcZ9kKhddedLvKVkFELGUx1NXJ0rUqk0PFOG8EDfgjsV4DxPfju89MrqL2bb+TkazOHN19NoIbwJ7RAxTrq2keW4kZh97M1gfPuLuOetQ2xKMeo/0mYL94AwJ5i1WII8eGuwpqj7bMrMQ8M9m3zQU6SNdTRyE4KGsF2D7u66lAjn51T6sk6+JrwhpMkov2vz/7ikuZhfZ3g8kuAAx6uuj+HVsa/Ydfc6/5+W6+9NGwmi4NRQQWwcnRKCC7t1WhEEORlSRy14r/7+3+rem1lITzoSGzuoUf/jZX/MzJs3b/PyAvUAsjNWAwWJ6jlkZ7gmjKkNIulLjgPFnozir1+P36CtLu+V1/EGQPRcQGrdbpfL5R4Ej+QgdLd1twv5y1KzP2l5Eo7fHg9b5dwMQZW/wCHx78t23+cVHsKjE9TeLkHhEByLUUmGWhY0HfZ5CiKxfr37cjhAQJcSLGLE/2euMyCliMQuCCCJX/lpkMypI5VsBKiveV5GJpK1qDG4qgGIDxaAFMPwKIIxIvXL9X/Rh64GuWedVB3T+iDO+gtGKulZBZho7whBDSTZTx98zxh6kwl+twYgZh2IUnBS8rBbU3oKeBq+5u5/YVSj3aoytfMYZ+wLku+H4R9yIXIhYiVJEl96kX7B6XJyQU3AcXkmp5wFma//o3iD4XMh+/3+sF0ICgt773mCvcw0P8TnAvE8iFtZ5wt9rroc+tPt4hHBd9BulMLEJD/9GuFbGOfcHvO/16bUE32QLUdOx5jj8cDqOBP1RRgzj0SETXubNjfHzFeruZAjOVsRr6de9yaGfrkSFISTsfPyIgeOXWHPyvJUUbxYjJif0dmR5yppgtJaC257qc3HrpheyhOxkIo/7flYpCZPXwmyb3Fj04tBrMwJAl8hZUja10s8m1KFJGpOu8mNu9SwJD4hF9BcF2eie3NIkLCEXGtawaXDBRiQ/7sLQSghSz9L5XOgrKGf7BYLzB7vMYhNoqOkECIPXQji1BwR6lwFWZhzOHKv691i/PmfxSGS+6BRUl66XUbdCTLZFyuBTvtGwvHYnQwGMvUhhbj44APvgaBHQi0A0XSks8uTSj8UMTS4HKQKyiOIDghkpoI53XfaAUY69pEzeXu33gZxRpQM/GRSUnpcwIgslW4FTsokeDC8Slt47qyuJRQQTENll6BqzXQAKAsZFGZt2hj7UOadWn1YJOmBHPWvQYOhzyY7zE+IUtyu52kriyLiUWIlUyGbzB5KhPQO17s+HSDAWL3nU3zPB2kkIulKFimIo83R8QN6hL2yK9fabFnqhgGE42qu5dQGIRujtbK2PQiumCuxGloTIo+h90sChdT/7ZxSz5vqsGV6h3PkeCLcjb+y2YrEBkeUsr2V1xac21AHe0z67B7ux8sf/ES0+aAbNaY9CDkxdGj6M9Ak7tCh/F6irbt7oRmKIGFh2oKg9A0h4uK3ZuM43mLwP4axBC3qiOa8ISzLwW1bEFjqUWO1+FKMuIMJ5POn8VfpgAceJGgJEt8EYeDHzmjqk912+Xv7afzj+8wblJHp564lCPdLfKjEATuSkTOVFjVbs1tsv5IqNFocdUQGPoSWBIavqZ/FcilFa5CYEkWoqdjPkaMpbZEqoGrT0BYkNcKMNCBJUKiz0INH62qmNoLWZ1IZ6SS815XeOBnR9NTCyA62tB2AYBHM99wrLoNK1B7T32hwHL/bsjUIJ+xZSOMxz0HskaNk35cMyVM3Zp62BkFiYZn31mA5e9oLuVvYMrIVW7UGSYuMKJkcC+2Loj4eXc84EuPag1QGLaHcInKj3gHDLDSmUPNorS3e3a2aIM4I5wY7wv48bDaclSKP9VlOipv1el11AJIGQSzyVyYcL9eR7KzPVJ+FtzbtAgS8OJB3FfjSQQ9mu4dXAy5F7aoTkBQmIIQDv/Sh9/xMfzXCJcqElNm0GxBY5tAPybmjJeUkPhKXMu9W8d5CaoOkc4txRChPj2TUqWZ6aAXvMPomIMJZAkY9m3r+wFGdxWcmABeDOLC8TKYEMDoyTdJWz7ay6g6EGljMAkKMp6v814aKc1gHowmIi0PxgNAUAxf/JpJqlXYKYpzvIKUQ5yyMw9i5qlsQNfF7LVALVr2FNDh4G8hzBjpch6z3hKy3kPogkPBjclJ4ynoIFXmwUXMh9SPe4kgyeYlCN+kEGYXPm6pOQQJ7fNcAfjfZbJB/w7lNuwWx69MrE+STCe+vszUXUh9kZfT5hD5lwuWKnak6BhGLLJ+IDG6QhPk4pXRp1yCsWmxRh/nPp58TPoBxHb/7FRA8GZFjgRmX17cBRv16AhaZxa+fJhgNQIrQXy8upG6ENIx4aJGyXUPkeQRi+iEgJVdSSorESppsVpM/JxAMX88k/DCQgH9SIIPHDseefhwIX7CFT8XHgeBprkqF8szso0DSf9u3YxuAQRgIgAVKywDumOMjZf+t8m9QepC+ilngRAjCIX70lQgclw15MK/XmopiGxK68uYWURjGhnDXcyr61zHgQzKcxDKyNSBsCFvZVE6o5dyIzOqLEf/uRIIK9JJF+BAuSxZgX++8Bcm55Pm1oWwjqfBz6LYiGRfkcD6uxVgX/mgUUkghf0Jey12IPv96Ox8AAAAASUVORK5CYII=';
  const IMG_SUGARLUMP = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAyJpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMy1jMDExIDY2LjE0NTY2MSwgMjAxMi8wMi8wNi0xNDo1NjoyNyAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIENTNiAoV2luZG93cykiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6N0I2MzFCMjM0OTk2MTFFN0E1M0RDQzQyODk5NjZEMDMiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6N0I2MzFCMjQ0OTk2MTFFN0E1M0RDQzQyODk5NjZEMDMiPiA8eG1wTU06RGVyaXZlZEZyb20gc3RSZWY6aW5zdGFuY2VJRD0ieG1wLmlpZDo3QjYzMUIyMTQ5OTYxMUU3QTUzRENDNDI4OTk2NkQwMyIgc3RSZWY6ZG9jdW1lbnRJRD0ieG1wLmRpZDo3QjYzMUIyMjQ5OTYxMUU3QTUzRENDNDI4OTk2NkQwMyIvPiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gPD94cGFja2V0IGVuZD0iciI/Pj3tVSoAAAAkUExURTQVF8GojODg4PrtuZCAd9TBvG5XVcprQX56uUFOff///////9OKRM8AAAAMdFJOU///////////////ABLfzs4AAAB2SURBVHjaZI+BDsQgCEMpFFDv///3QJdtuWuipA+CVT4/kquUXkCEYB7UV1lXd6Qc0B5U1aQcUH1zWwvYQAJuCjUzrZEGCUW5OthgktVfZq4HjIneUiMespcOZhHF/cqYEUkyUq5go5AzQp7ojZ7o/5976yvAAFuYBnbAZZoMAAAAAElFTkSuQmCC';

  const buildings = [
    {name:'Cursor',               img:IMG_CURSOR,       sz:'48px 48px'},
    {name:'Grandma',              img:IMG_GRANDMA,      sz:'48px 48px'},
    {name:'Farm',                 img:IMG_FARM,         sz:'48px 48px'},
    {name:'Mine',                 img:IMG_MINE,         sz:'48px 48px'},
    {name:'Factory',              img:IMG_FACTORY,      sz:'48px 48px'},
    {name:'Bank',                 img:IMG_BANK,         sz:'48px 48px'},
    {name:'Temple',               img:IMG_TEMPLE,       sz:'48px 48px'},
    {name:'Wizard tower',         img:IMG_WIZARD,       sz:'48px 48px'},
    {name:'Shipment',             img:IMG_SHIPMENT,     sz:'48px 48px'},
    {name:'Alchemy lab',          img:IMG_ALCHEMY,      sz:'48px 48px'},
    {name:'Portal',               img:IMG_PORTAL,       sz:'48px 48px'},
    {name:'Time machine',         img:IMG_TIMEMACHINE,  sz:'48px 48px'},
    {name:'Antimatter condenser', img:IMG_ANTIMATTER,   sz:'48px 48px'},
    {name:'Prism',                img:IMG_PRISM,        sz:'48px 48px'},
    {name:'Chancemaker',          img:IMG_CHANCEMAKER,  sz:'48px 48px'},
    {name:'Fractal engine',       img:IMG_FRACTAL,      sz:'48px 48px'},
    {name:'Javascript console',   img:IMG_JSCONSOLE,    sz:'48px 216px'},
    {name:'Idleverse',            img:IMG_IDLEVERSE,    sz:'192px 48px'},
    {name:'Cortex baker',         img:IMG_CORTEX,       sz:'192px 48px'},
    {name:'You',                  img:IMG_YOU,          sz:'48px 48px'},
  ];

  const routes = [
    {m:'GET',    p:'/',                                    d:'Healthcheck — server status, game connection, bakery name'},
    {m:'GET',    p:'/docs',                                d:'This documentation page (English)'},
    {m:'GET',    p:'/docs/pt',                             d:'Documentação em Português — mesma referência completa em PT-BR'},
    {m:'GET',    p:'/state',                               d:'Full game snapshot (updated every ~500ms by the mod)'},
    {m:'GET',    p:'/action/view/{name}',                  d:'Building or upgrade details by name (case-insensitive)'},
    {m:'GET',    p:'/action/view/lvl/{name}',              d:'Building level info (sugar lump upgrades)'},
    {m:'POST',   p:'/action/buy/upgrade/{name}',          d:'Purchase an upgrade currently in the store (list loaded live from /state)'},
    {m:'POST',   p:'/action/buy/build/{name}/{n}',         d:'Buy N buildings (n = 1, 10 or 100)'},
    {m:'POST',   p:'/action/sell/build/{name}/{n}',        d:'Sell N buildings'},
    {m:'POST',   p:'/action/enqueue',                      d:'Queue a typed action. Discover the full schema at /capabilities and poll /action/result/:id; acceptance is not execution.'},
    {m:'GET',    p:'/action/queue',                        d:'List pending actions in the queue'},
    {m:'DELETE', p:'/action/queue',                        d:'Clear the entire action queue'},
    {m:'GET',    p:'/sugarlump/view',                      d:'Sugar lump count, growing type and time to ripe'},
    {m:'POST',   p:'/sugarlump/use/{build}',               d:'Use 1 sugar lump to level up a building'},
    {m:'POST',   p:'/sugarlump/harvest',                   d:'Manually harvest a sugar lump (controls next lump type)'},
    {m:'GET',    p:'/golden_cookie/view',                  d:'Shimmers currently visible on screen'},
    {m:'GET',    p:'/effects/view',                        d:'Active temporary buffs (Frenzy, Click Frenzy, etc.)'},
    {m:'GET',    p:'/grimoire/view',                       d:'Grimoire state: mana, max mana, all spells with cost'},
    {m:'POST',   p:'/grimoire/cast/{idx}',                 d:'Cast spell at index idx (0–8)'},
    {m:'POST',   p:'/grimoire/recharge',                   d:'Spend 1 sugar lump to restore mana to maximum'},
    {m:'GET',    p:'/pantheon/view',                        d:'Pantheon state: slots, available swaps, all spirits'},
    {m:'POST',   p:'/pantheon/set/{spirit}/{slot}',         d:'Place spirit in slot (0=Diamond 100%, 1=Ruby 50%, 2=Jade 25%)'},
    {m:'POST',   p:'/pantheon/remove/{slot}',               d:'Remove spirit from a slot'},
    {m:'POST',   p:'/pantheon/recharge',                    d:'Spend 1 sugar lump to restore worship swaps to 3'},
    {m:'GET',    p:'/garden/view',                         d:'Full garden grid, seed list and active soil'},
    {m:'GET',    p:'/garden/seeds',                        d:'Unlocked seeds only — id and name, used by the plant dropdown'},
    {m:'POST',   p:'/garden/plant/{seed}/{x}/{y}',       d:'Plant seed at cell (x, y) — seed is the numeric ID from /garden/seeds'},
    {m:'POST',   p:'/garden/harvest/{x}/{y}',               d:'Harvest plant at cell (x, y)'},
    {m:'POST',   p:'/garden/harvest_all',                  d:'Harvest all plants in the garden'},
    {m:'POST',   p:'/garden/soil/{0-4}',                   d:'Change soil type (0=Normal 1=Fertilizer 2=Clay 3=Pebbles 4=Woodchips)'},
    {m:'GET',    p:'/stock/view',                          d:'All stock market assets with price, delta and resting value'},
    {m:'GET',    p:'/stock/view/{ticker}',                 d:'Details of a specific asset by ticker symbol'},
    {m:'GET',    p:'/stock/analysis',                       d:'Assets below resting value sorted by discount (buy opportunities)'},
    {m:'POST',   p:'/stock/buy/{ticker}/{n}',          d:'Buy N units of an asset'},
    {m:'POST',   p:'/stock/sell/{ticker}/{n}',           d:'Sell N units from portfolio'},
    {m:'GET',    p:'/dragon/view',                         d:'Dragon level, active auras and full aura dictionary'},
    {m:'POST',   p:'/dragon/set_aura/{id}/{slot}',         d:'Set aura id in slot (0=primary, 1=secondary; level≥20 for slot 1)'},
    {m:'POST',   p:'/dragon/upgrade',                      d:'Evolve the dragon (costs cookies and/or buildings)'},
    {m:'GET',    p:'/santa/view',                          d:'Santa level and name'},
    {m:'POST',   p:'/santa/upgrade',                       d:'Evolve Santa (requires Christmas season)'},
    {m:'GET',    p:'/wrinklers/view',                      d:'Active wrinklers, accumulated cookies and shiny flag'},
    {m:'POST',   p:'/wrinklers/pop/{id}',                  d:'Pop wrinkler by id (0–11), releases sucked × 1.1 cookies'},
    {m:'POST',   p:'/wrinklers/pop_all',                   d:'Pop all active wrinklers at once'},
    {m:'GET',    p:'/season/view',                         d:'Current season, time remaining and available seasons'},
    {m:'POST',   p:'/season/set/{name}',                   d:'Switch active season (requires Season Switcher upgrade)'},
    {m:'GET',    p:'/volume/view',                         d:'Current SFX and music volume levels'},
    {m:'POST',   p:'/volume/set/{tipo}/{valor}',              d:'Adjust volume level (tipo: sfx or music, valor: 0–100)'},
    {m:'POST',   p:'/volume/mute/{building}',              d:'Toggle mute state for a building sound'},
    {m:'GET',    p:'/prefs/view',                  d:'All 26 game preference toggles with current state'},
    {m:'POST',   p:'/prefs/set/{name}',            d:'Toggle a preference on/off by name'},
    {m:'GET',    p:'/prestige/view',                       d:'Basic prestige summary: chips, ascensions, CpS bonus %'},
    {m:'GET',    p:'/legacy/view',                         d:'Full legacy data: prestige, chips, cookies to next prestige'},
    {m:'GET',    p:'/legacy/upgrades',                     d:'All heavenly upgrades with price, status and affordability'},
    {m:'POST',   p:'/legacy/buy_heavenly/{id}',            d:'Purchase a heavenly upgrade with heavenly chips'},
    {m:'POST',   p:'/legacy/ascend',                       d:'DANGER: Ascend — resets current run (requires {confirmar:true})'},
    {m:'POST',   p:'/legacy/reincarnate',                  d:'Reincarnate after the ascension screen'},
    {m:'GET',    p:'/stats',                               d:'All statistics with documented Game.* sources — prestige, chips raw/global CpS, cookies, ascensions, buildings count, dragon, santa, lumps, wrinklers, grimoire, FPS'},
    {m:'POST',   p:'/action/sell_all/{name}',              d:'Sell ALL buildings of a type (Godzamok combo — typically paired with Reaper of Fields pantheon spirit)'},
    {m:'POST',   p:'/game/save',                           d:'Force an immediate game save to disk (use before risky actions: ascend, mass sell, high-fail spells)'},
    {m:'POST',    p:'/backup',                              d:'Take a manual JSON snapshot of current state → saved to cookie_bridge_backups/ folder'},
    {m:'GET',    p:'/history/states?n=10',                 d:'Last N full game state snapshots held in memory (ring buffer, max 60)'},
    {m:'GET',    p:'/history/actions?n=50',                d:'Last N executed actions with timestamps (ring buffer, max 200)'},
    {m:'GET',    p:'/db/info',                             d:'Save DB metadata — file path, entry count, size, interval, first and last timestamp'},
    {m:'GET',    p:'/db/history?n=500',                    d:'Historical stats from DB (no save string) — cps, prestige, cookies, buildings, chips over time. Up to 10 000 entries'},
    {m:'GET',    p:'/db/save/latest',                      d:'Most recent full game save string (base64, same as Export Save in-game) — use to restore or analyze'},
    {m:'POST',   p:'/db/save/now',                         d:'Trigger an immediate DB snapshot (no wait for 5-min interval)'},
    {m:'GET',    p:'/db/saves?n=20',                       d:'Last N save entries WITH full base64 save strings, newest first (max 200). Use the save string with Import Save in-game to restore any point in time'},
    {m:'DELETE', p:'/db/reset',                            d:'DANGER: Permanently delete the entire saves.ndjson database. Requires confirmation via the /charts DB Reset modal. Irreversible.'},
    {m:'GET',    p:'/io',                                  d:'Real-time Node.js process stats — heap used/total, RSS, plus OS free/total RAM, CPU count, uptime'},
    {m:'GET',    p:'/charts',                              d:'Evolution chart page (Chart.js) — CpS, prestige, cookies, buildings, upgrades, legacy gain over time. Auto-refreshes every 30 s'},
    {m:'GET',    p:'/saves',                               d:'Backup Codes page — full save strings per 5-min snapshot. Copy any code and paste it into Cookie Clicker Import Save to restore that moment'},
  ];

  const badge = (m) => {
    const colors = {GET:'#1a7a3c',POST:'#1a4d8f',DELETE:'#8b1a1a'};
    const bgs = {GET:'#0d3d1e',POST:'#0d2645',DELETE:'#45100d'};
    return `<span style="background:${bgs[m]};color:${colors[m]};border:1px solid ${colors[m]};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:bold;font-family:monospace;white-space:nowrap">${m}</span>`;
  };

  const sections = [
    {title:'System & State',     icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 13H4c-.6 0-1 .4-1 1v6c0 .6.4 1 1 1h16c.6 0 1-.4 1-1v-6c0-.6-.4-1-1-1zM7 19c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM20 3H4c-.6 0-1 .4-1 1v6c0 .6.4 1 1 1h16c.6 0 1-.4 1-1V4c0-.6-.4-1-1-1zM7 9C5.9 9 5 8.1 5 7s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>',  methods:['GET'],            filter:r=>['/','/docs','/state'].includes(r.p)},
    {title:'Buildings & Upgrades',icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 11V3H7v4H3v14h8v-4h2v4h8V11h-4zm-6 4H9v-2h2v2zm0-4H9V9h2v2zm0-4H9V5h2v2zm6 8h-2v-2h2v2zm0-4h-2V9h2v2z"/></svg>',methods:['GET','POST'],    filter:r=>r.p.startsWith('/action')},
    {title:'Sugar Lumps',        icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 8l10 14L22 8 12 2zm0 3.8L18.5 8 12 19.5 5.5 8 12 5.8z"/></svg>', methods:['GET','POST'],    filter:r=>r.p.startsWith('/sugarlump')},
    {title:'Golden Cookies & Buffs',icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>',methods:['GET'],          filter:r=>['/golden_cookie/view','/effects/view'].includes(r.p)},
    {title:'Grimoire',           icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>', methods:['GET','POST'],    filter:r=>r.p.startsWith('/grimoire')},
    {title:'Pantheon',           icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 20h2v-8H2v8zm3 0h2v-8H5v8zm4 0h2v-8H9v8zm4 0h2v-8h-2v8zm4 0h2v-8h-2v8zM12 1L2 6v2h20V6z"/></svg>',  methods:['GET','POST'],    filter:r=>r.p.startsWith('/pantheon')},
    {title:'Garden',             icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 8C8 10 5.9 16.17 3.82 21H5.71c.98-2.52 2.04-5.14 4.29-7.5C13 10.39 17.5 10 22 10c0 0-1 8-10 8-3 0-5.29-1.39-6.27-2.55.28-.67.57-1.33.88-1.98C7.92 15.32 9.87 16 12 16c4 0 6.42-3.12 7.53-5.31A25.16 25.16 0 0117 8z"/></svg>', methods:['GET','POST'],    filter:r=>r.p.startsWith('/garden')},
    {title:'Stock Market',       icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>', methods:['GET','POST'],    filter:r=>r.p.startsWith('/stock')},
    {title:'Dragon',             icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"/></svg>', methods:['GET','POST'],    filter:r=>r.p.startsWith('/dragon')},
    {title:'Santa',              icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22 11h-4.17l2.24-2.24-1.41-1.41L15 11h-2V9l3.66-3.66-1.42-1.41L13 6.17V2h-2v4.17l-2.24-2.24-1.42 1.41L11 9v2H9L5.34 7.34 3.93 8.76 6.17 11H2v2h4.17l-2.24 2.24 1.41 1.41L9 13h2v2l-3.66 3.66 1.42 1.41L11 17.83V22h2v-4.17l2.24 2.24 1.42-1.41L14 15v-2h2l3.66 3.66 1.41-1.41L18.83 13H22z"/></svg>', methods:['GET','POST'],    filter:r=>r.p.startsWith('/santa')},
    {title:'Wrinklers',          icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>', methods:['GET','POST'],    filter:r=>r.p.startsWith('/wrinklers')},
    {title:'Seasons',            icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>', methods:['GET','POST'],    filter:r=>r.p.startsWith('/season')},
    {title:'Volume & Audio',     icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>', methods:['GET','POST'],    filter:r=>r.p.startsWith('/volume')},
    {title:'Preferences',        icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',  methods:['GET','POST'],    filter:r=>r.p.startsWith('/prefs')},
    {title:'Legacy & Prestige',  icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.96V17H7v2h10v-2h-4v-1.1c1.63-.33 2.98-1.46 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.86 10.4 5 9.28 5 8zm7 6c-1.65 0-3-1.35-3-3V5h6v6c0 1.65-1.35 3-3 3zm7-6c0 1.28-.86 2.4-2 2.82V7h2v1z"/></svg>',  methods:['GET','POST'],    filter:r=>r.p.startsWith('/prestige')||r.p.startsWith('/legacy')},
    {title:'Stats',              icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>', methods:['GET'],            filter:r=>r.p==='/stats'},
    {title:'Misc & History',     icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>', methods:['GET','POST'],    filter:r=>['/action/sell_all/{name}','/game/save','/backup','/history/states?n=10','/history/actions?n=50'].includes(r.p)},
    {title:'Database & IO',      icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C7.58 3 4 4.79 4 7s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4zM4 9v3c0 2.21 3.58 4 8 4s8-1.79 8-4V9c0 2.21-3.58 4-8 4s-8-1.79-8-4zm0 5v3c0 2.21 3.58 4 8 4s8-1.79 8-4v-3c0 2.21-3.58 4-8 4s-8-1.79-8-4z"/></svg>', methods:['GET','POST','DELETE'], filter:r=>r.p.startsWith('/db/')||r.p==='/io'||r.p==='/charts'||r.p==='/saves'},
  ];

  const buildingCards = buildings.map(b =>
    `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;background:#0d0d2a;border:1px solid #2a2a4a;border-radius:8px;padding:8px 6px;min-width:72px">` +
    `<div style="width:48px;height:48px;flex-shrink:0;background-image:url(${b.img});background-size:${b.sz};background-position:0 0;background-repeat:no-repeat;image-rendering:pixelated"></div>` +
    `<span style="font-size:10px;color:#aaa;text-align:center;word-break:break-word;max-width:72px">${b.name}</span>` +
    `</div>`
  ).join('');

  const minigameCards = [
    {title:'Grimoire',  img:IMG_BG_GRIMOIRE, desc:'Cast spells, manage mana'},
    {title:'Garden',    img:IMG_BG_GARDEN,   desc:'Plant seeds, harvest plants'},
    {title:'Pantheon',  img:IMG_BG_PANTHEON, desc:'Slot spirits for passive bonuses'},
    {title:'Stock Market', img:IMG_BG_MARKET, desc:'Trade assets, buy low sell high'},
  ];

  const minigameHtml = minigameCards.map(c =>
    `<div style="flex:1;min-width:160px;border-radius:10px;overflow:hidden;border:1px solid #2a2a4a;position:relative;height:100px">` +
    `<div style="position:absolute;inset:0;background-image:url('${c.img}');background-size:cover;background-position:center;filter:brightness(0.55)"></div>` +
    `<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;padding:10px 12px">` +
    `<div style="color:#f5e642;font-weight:bold;font-size:14px;text-shadow:0 1px 4px #000">${c.title}</div>` +
    `<div style="color:#ccc;font-size:11px;text-shadow:0 1px 3px #000">${c.desc}</div>` +
    `</div></div>`
  ).join('');


  const BODY_EXAMPLES = {
    '/action/enqueue': JSON.stringify({type:'click_cookie',count:1},null,2),
    '/legacy/ascend':       '{\n  "confirmar": true\n}',
    '/legacy/buy_heavenly/{id}': '{}',
  };

  const PARAM_HINTS = {
    'n':        '1, 10 or 100',
    'slot':     '0 = Diamond (100%) | 1 = Ruby (50%) | 2 = Jade (25%)',
    'idx':      '0–8  (0=Conjure Baked Goods … 8=Diminish Ineptitude)',
    'spirit':   '0–10 (0=Holobore … 10=Rigidel)',
    'x':        '0–5',
    'y':        '0–5',
    'seed':     'seed ID from GET /garden/view',
    'ticker':   'CRL CHC BTR SUG NUT SLT VNL EGG CNM CRM JAM WCH HNY CKI RCP SBD PBL YOU',
    'id':       'numeric ID from /state or /legacy/upgrades',
    'name':     'building or upgrade name (e.g. Farm)',
    'build':    'building name (e.g. Farm)',
    'tipo':     'sfx or music',
    'valor':    '0–100',
    'building': 'building name',
    '/action/view/upgrade/{name}:name':   'upgrade name — see GET /state → upgrades_na_loja',
    '/action/buy/upgrade/{name}:name':    'upgrade name — see GET /state → upgrades_na_loja',
  };

  const _BLDS = ['Cursor','Grandma','Farm','Mine','Factory','Bank','Temple','Wizard tower','Shipment','Alchemy lab','Portal','Time machine','Antimatter condenser','Prism','Chancemaker','Fractal engine','Javascript console','Idleverse','Cortex baker','You'].map(function(b){return{v:b};});
  const ROUTE_SELECTS = {
    'n':        [{v:'1'},{v:'10'},{v:'100'}],
    'x':        [{v:'0'},{v:'1'},{v:'2'},{v:'3'},{v:'4'},{v:'5'}],
    'y':        [{v:'0'},{v:'1'},{v:'2'},{v:'3'},{v:'4'},{v:'5'}],
    'ticker':   ['CRL','CHC','BTR','SUG','NUT','SLT','VNL','EGG','CNM','CRM','JAM','WCH','HNY','CKI','RCP','SBD','PBL','YOU'].map(function(t){return{v:t};}),
    'tipo':     [{v:'sfx',l:'sfx — Sound Effects'},{v:'music',l:'music — BGM'}],
    'idx':      [{v:'0',l:'0 — Conjure Baked Goods'},{v:'1',l:'1 — Force the Hand of Fate'},{v:'2',l:"2 — Thor's Tempest"},{v:'3',l:'3 — Summer Solstice'},{v:'4',l:'4 — Spontaneous Edifice'},{v:'5',l:"5 — Haggler's Charm"},{v:'6',l:'6 — Stretch Time'},{v:'7',l:'7 — Commodity Revaluation'},{v:'8',l:'8 — Diminish Ineptitude'}],
    'spirit':   [{v:'0',l:'0 — Holobore'},{v:'1',l:'1 — Vomitrax'},{v:'2',l:'2 — Cyclius'},{v:'3',l:'3 — Dotjeiess'},{v:'4',l:'4 — Muridal'},{v:'5',l:'5 — Jeremy'},{v:'6',l:'6 — Mokalsium'},{v:'7',l:'7 — Idleseer'},{v:'8',l:'8 — Godzamok'},{v:'9',l:'9 — Borealus'},{v:'10',l:'10 — Rigidel'}],
    'build':    _BLDS,
    'building': _BLDS,
    '0-4':      [{v:'0',l:'0 — Normal'},{v:'1',l:'1 — Fertilizer'},{v:'2',l:'2 — Clay'},{v:'3',l:'3 — Pebbles'},{v:'4',l:'4 — Woodchips'}],
    '/pantheon/set/{spirit}/{slot}:slot':  [{v:'0',l:'0 — Diamond (100%)'},{v:'1',l:'1 — Ruby (50%)'},{v:'2',l:'2 — Jade (25%)'}],
    '/pantheon/remove/{slot}:slot':        [{v:'0',l:'0 — Diamond'},{v:'1',l:'1 — Ruby'},{v:'2',l:'2 — Jade'}],
    '/dragon/set_aura/{id}/{slot}:slot':   [{v:'0',l:'0 — Primary'},{v:'1',l:'1 — Secondary (level ≥ 20)'}],
    '/dragon/set_aura/{id}/{slot}:id':     [{v:'0',l:'0 — No aura'},{v:'1',l:'1 — Breath of Milk'},{v:'2',l:'2 — Dragon Cursor'},{v:'3',l:'3 — Elder Battalion'},{v:'4',l:'4 — Reaper of Fields'},{v:'5',l:'5 — Earth Shatterer'},{v:'6',l:'6 — Master of the Armory'},{v:'7',l:'7 — Fierce Hoarder'},{v:'8',l:'8 — Dragon God'},{v:'9',l:'9 — Arcane Aura'},{v:'10',l:'10 — Dragonflight'},{v:'11',l:'11 — Ancestral Metamorphosis'},{v:'12',l:'12 — Unholy Dominion'},{v:'13',l:'13 — Epoch Manipulator'},{v:'14',l:'14 — Mind Over Matter'},{v:'15',l:'15 — Radiant Appetite'},{v:'16',l:"16 — Dragon's Fortune"},{v:'17',l:"17 — Dragon's Curve"},{v:'18',l:'18 — Reality Bending'},{v:'19',l:'19 — Dragon Orbs'},{v:'20',l:'20 — Supreme Intellect'},{v:'21',l:'21 — Dragon Guts'}],
    '/wrinklers/pop/{id}:id':             [{v:'0'},{v:'1'},{v:'2'},{v:'3'},{v:'4'},{v:'5'},{v:'6'},{v:'7'},{v:'8'},{v:'9'},{v:'10'},{v:'11'}],
    '/season/set/{name}:name':            [{v:'halloween'},{v:'christmas'},{v:'valentines'},{v:'easter'},{v:'fools'},{v:'',l:'— none (disable season) —'}],
    '/prefs/set/{name}:name':             ['fancy','filters','milk','cursors','particles','numbers','wobbly','animate','crates','monospace','cookiesound','format','warn','focus','extraButtons','lumpConfirm','screenReader','fastNotes','scary','customGrandmas','autosave','timeout','cloudSave','bgMusic','fullscreen','discordPresence'].map(function(p){return{v:p};}),
    '/action/view/{name}:name':            _BLDS,
    '/action/buy/upgrade/{name}:name':    '__LIVE_UPGRADES__',
    '/garden/plant/{seed}/{x}/{y}:seed':  '__LIVE_SEEDS__',
    '/action/buy/build/{name}/{n}:name':  _BLDS,
    '/action/sell/build/{name}/{n}:name': _BLDS,
    '/action/view/lvl/{name}:name':       _BLDS,
    '/action/sell_all/{name}:name':       _BLDS,
  };

  const SECTION_DESCS = {
    'System & State':          '<b>GET /</b> confirms server + game connection. <b>GET /state</b> returns the full ~60-field snapshot merged from fast state (every ~500 ms: cookies, CpS, buffs, shimmers) and slow state (every ~5 s: buildings, minigames, dragon, legacy). Use <b>GET /stats</b> for a cleaner, annotated view of all numeric fields.',
    'Buildings & Upgrades':    'All 20 buildings from <b>Cursor</b> to <b>You</b>. Buy and sell in batches of 1, 10 or 100. <b>GET /action/view/{name}</b> shows current price, affordability and sell value. Upgrades are one-time unlocks bought from the store — once purchased they apply permanently until ascension.',
    'Sugar Lumps':             'A lump ripens every ~24 h. Spending one levels a building by +1 (max level 10; Cursor max 20), granting a permanent +1 % CpS per level. Use <b>POST /sugarlump/harvest</b> to manually collect the growing lump early (controls next lump type: Normal / Bifurcated / Golden / Meaty / Caramelized).',
    'Golden Cookies & Buffs':  'Shimmers spawn randomly and vanish after ~13 s. Click via <b>POST /action/enqueue {type:"click_shimmer", index:0}</b>. Common effects — <b>Frenzy</b>: ×7 CpS for 77 s &nbsp;·&nbsp; <b>Click Frenzy</b>: ×777 CpC for 13 s &nbsp;·&nbsp; <b>Lucky</b>: instant cookies (capped at 15 min CpS). Active buffs with time remaining are in <b>GET /effects/view</b>.',
    'Grimoire':                'Unlocks when Wizard Tower reaches level 1 (1 sugar lump). Mana regenerates over time up to <code>magicMax</code>. Key spells — <b>idx 0 Conjure Baked Goods</b>: instant cookies &nbsp;·&nbsp; <b>idx 1 Force the Hand of Fate</b>: forces a golden cookie to spawn (most powerful). Fail chance = mana deficit + base <code>failChnc</code> of the spell.',
    'Pantheon':                'Unlocks when Temple reaches level 1. Slot up to 3 spirits: Diamond (100 %), Ruby (50 %), Jade (25 %). Swapping costs 1 worship swap (refills to 3 with 1 sugar lump). Key combo — <b>Godzamok</b> (slot 0) multiplies CpC by number of distinct building types sold; pair with <b>Reaper of Fields</b> in garden for massive click combos.',
    'Garden':                  'Unlocks when Farm reaches level 1. Grid grows with Farm sugar lump level (3×3 → 6×6). Plant seeds from discovered list; plants mutate when two mature types are adjacent. Soil types control growth speed vs mutation chance. Soil 1 (Fertilizer) maximises growth; soil 4 (Woodchips) maximises mutation rate (mutations spread ×3).',
    'Stock Market':            'Unlocks when Bank reaches level 1. 18 assets each track a resting value; price oscillates around it. <b>GET /stock/analysis</b> ranks buy opportunities by discount (%). Buy when price is well below rest, sell above it. Each building sold reduces the resting value of its linked ticker — careful with Godzamok combos.',
    'Dragon':                  'Sacrifice cookies and/or buildings to level Krumblor from level 0 to 20. Higher levels unlock new aura slots and choices. <b>Aura 15 Radiant Appetite</b> doubles base CpS (×2 all cookie production). <b>Aura 10 Dragonflight</b> makes golden cookies grant ×1111 CpC for 10 s. Level 20 unlocks both aura slots simultaneously.',
    'Santa':                   'Activate Christmas season first (<b>POST /season/set/christmas</b>). Then evolve Santa through 14 levels (<b>POST /santa/upgrade</b>). Higher levels unlock powerful upgrades in the store. Last level unlocks the <b>Santa\'s legacy</b> upgrade.',
    'Wrinklers':               'Up to 12 wrinklers can attach to the cookie. They reduce raw CpS by ~5 % each but accumulate cookies internally and return ×1.1 on pop. Strategy: pop during <b>Frenzy × Elder Frenzy</b> for maximum return. Shiny wrinklers (very rare, ~0.01 %) return ×3.3. Let them fill during long idle sessions.',
    'Seasons':                 'Seasonal events last until manually switched. Each unlocks exclusive upgrades (e.g. Christmas: Santa/reindeer; Halloween: "creepy cookies"; Easter: egg drops; Valentines: heart biscuits). Season Switcher upgrade allows changing mid-run; uses tracked by <code>seasonUses</code>.',
    'Volume & Audio':          'SFX and music are independent tracks (0–100 each). <b>POST /volume/mute/{building}</b> silences the ambient sound of a specific building. Useful for automation environments where game audio interferes.',
    'Preferences':             '26 boolean preferences. Most are cosmetic (particles, milk wave, numbers). <b>screenReader</b> enables keyboard-driven fast-buy accessibility mode. <b>cloudSave</b> toggles Steam Cloud sync. <b>focus</b> reduces FPS when the window is unfocused (reduces CPU when the game is in background).',
    'Legacy & Prestige':       '<b>Prestige</b> = <code>floor(cbrt(totalCookiesBaked / 1e12))</code> — each level = +1 % CpS permanently. <b>Ascending</b> resets buildings, upgrades and cookies but earns Heavenly Chips equal to the prestige gained. <b>GET /legacy/view</b> shows the delta (chips you would gain right now). Heavenly upgrades from <b>GET /legacy/upgrades</b> apply across all future runs.',
    'Stats':                   'Annotated snapshot of every numeric field with its <code>Game.*</code> source variable. Includes <code>_sources</code> object explaining where each value comes from — useful for auditing unexpected values (e.g. confirming Ascension #24 = <code>Game.resets</code>).',
    'Misc & History':          '<b>POST /action/sell_all/{name}</b> sells every building of one type (use for Godzamok combos). <b>POST /game/save</b> forces a disk save before risky actions. <b>POST /backup</b> takes a full JSON snapshot to <code>cookie_bridge_backups/</code>. In-memory ring buffers: last 60 state snapshots (<b>/history/states</b>) and last 200 action records (<b>/history/actions</b>).',
    'Database & IO':           '<a href="/charts" target="_blank" style="color:#00e5ff;font-weight:bold;font-size:13px">📈 Open Charts — evolution &amp; rebirth analytics →</a><br><br>Auto-saves every <b>5 min</b> to <code>%USERPROFILE%/CookieBridge/saves.ndjson</code>. Each entry = stats + full save string (same base64 as Export Save). Cap 200 MB / 80 % rotation. <b>/db/info</b> → metadata. <b>/db/history</b> → timeseries data. <b>/db/save/latest</b> → last save string to restore. <b>/io</b> → Node.js + OS memory.',
  };

  const sectionHtml = sections.map(function(sec) {
    const sRoutes = routes.filter(sec.filter);
    if (!sRoutes.length) return '';
    const desc = (lang === 'pt' ? _PT_SDESC[sec.title] : null) || SECTION_DESCS[sec.title] || '';

    const rows = sRoutes.map(function(r, idx) {
      const tid = (sec.title.replace(/[^a-zA-Z0-9]/g, '') + idx);
      const params = (r.p.match(/\{[^}]+\}/g) || []).map(function(s){ return s.slice(1,-1); });
      const hasBody = r.m === 'POST';
      const bodyEx = BODY_EXAMPLES[r.p] || '';

      // Build URL display with inline param inputs
      var urlParts = r.p.split(/\{[^}]+\}/);
      var urlHtml = '<code style="font-family:monospace;font-size:12px;color:#5bc8f5">';
      urlParts.forEach(function(part, i) {
        urlHtml += '<span style="color:#5bc8f5">' + part + '</span>';
        if (i < params.length) {
          var opts = ROUTE_SELECTS[r.p + ':' + params[i]] || ROUTE_SELECTS[params[i]];
          if (opts === '__LIVE_UPGRADES__') {
            urlHtml += '<select data-param="' + params[i] + '" data-param-for="' + tid + '" data-live="upgrades"' +
              ' style="background:#0d1a2a;border:1px solid #2a4a6a;border-radius:3px;padding:2px 6px;color:#888;font-family:monospace;font-size:12px;cursor:pointer;max-width:260px">' +
              '<option value="">⟳ loading store upgrades…</option>' +
              '</select>';
          } else if (opts === '__LIVE_SEEDS__') {
            urlHtml += '<select data-param="' + params[i] + '" data-param-for="' + tid + '" data-live="seeds"' +
              ' style="background:#0d1a2a;border:1px solid #2a4a6a;border-radius:3px;padding:2px 6px;color:#888;font-family:monospace;font-size:12px;cursor:pointer;max-width:240px">' +
              '<option value="">⟳ loading seeds…</option>' +
              '</select>';
          } else if (opts) {
            urlHtml += '<select data-param="' + params[i] + '" data-param-for="' + tid + '"' +
              ' style="background:#0d1a2a;border:1px solid #2a4a6a;border-radius:3px;padding:2px 6px;color:#f5e642;font-family:monospace;font-size:12px;cursor:pointer;max-width:220px">' +
              opts.map(function(o){return '<option value="'+o.v+'">'+(o.l||o.v)+'</option>';}).join('') +
              '</select>';
          } else {
            var hint = PARAM_HINTS[r.p + ':' + params[i]] || PARAM_HINTS[params[i]] || '';
            urlHtml += '<input data-param="' + params[i] + '" data-param-for="' + tid + '"' +
              ' placeholder="' + params[i] + '"' +
              ' style="background:#0d1a2a;border:1px solid #2a4a6a;border-radius:3px;padding:2px 6px;color:#f5e642;font-family:monospace;font-size:12px;width:' + Math.max(60, params[i].length * 8 + 20) + 'px" />' +
              (hint ? '<span style="color:#444;font-size:10px;margin:0 4px" title="' + hint + '">(' + hint.slice(0, 30) + (hint.length > 30 ? '…' : '') + ')</span>' : '');
          }
        }
      });
      urlHtml += '</code>';

      const testPanel = '<tr id="tp-' + tid + '" style="display:none">' +
        '<td colspan="4" style="padding:12px 18px 16px 18px;background:#06060e;border-bottom:1px solid #1a1a2e">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
        '<span style="background:#0d0d2a;border:1px solid #2a2a4a;border-radius:4px;padding:4px 10px;font-size:12px;color:#888">http://localhost:PORT</span>' +
        urlHtml +
        '</div>' +
        (hasBody ?
          '<div style="margin-bottom:10px">' +
          '<div style="color:#888;font-size:11px;margin-bottom:4px">Request Body (JSON)</div>' +
          '<textarea id="body-' + tid + '" spellcheck="false" style="width:100%;min-height:72px;background:#0d0d1a;border:1px solid #2a2a4a;border-radius:4px;padding:8px;color:#e0e0e0;font-family:monospace;font-size:12px;resize:vertical">' + bodyEx + '</textarea>' +
          '</div>' : '') +
        '<div style="display:flex;align-items:center;gap:12px">' +
        '<button onclick="runTest(\'' + tid + '\',\'' + r.m + '\',\'' + r.p + '\',' + (hasBody ? 'true' : 'false') + ')" ' +
        'style="background:#1a4d8f;color:#fff;border:none;border-radius:5px;padding:7px 20px;font-size:13px;cursor:pointer;font-weight:bold">&#x25b6; Execute</button>' +
        '<span id="result-status-' + tid + '" style="font-size:12px;font-family:monospace"></span>' +
        '</div>' +
        '<pre id="result-' + tid + '" style="display:none;margin-top:10px;background:#03030a;border:1px solid #333;border-radius:5px;padding:12px;font-size:12px;color:#e0e0e0;overflow-x:auto;max-height:280px;overflow-y:auto;white-space:pre-wrap;word-break:break-all"></pre>' +
        '</td></tr>';

      return '<tr style="border-bottom:1px solid #0d0d1a">' +
        '<td style="padding:8px 10px;white-space:nowrap;width:74px">' + badge(r.m) + '</td>' +
        '<td style="padding:8px 10px;font-family:\'Courier New\',monospace;font-size:12px;color:#5bc8f5;word-break:break-all">' + r.p + '</td>' +
        '<td style="padding:8px 10px;font-size:12px;color:#bbb">' + RD(r) + '</td>' +
        '<td style="padding:8px 10px;text-align:right;white-space:nowrap">' +
        '<button data-tid="' + tid + '" onclick="toggleTest(\'' + tid + '\')" ' +
        'style="background:#0d0d2a;border:1px solid #2a2a4a;color:#888;border-radius:4px;padding:4px 12px;font-size:11px;cursor:pointer;transition:all 0.15s">&#x25b6; Test</button>' +
        '</td></tr>' + testPanel;
    }).join('');

    return '<section style="margin-bottom:36px">' +
      '<div style="display:flex;align-items:baseline;gap:10px;border-bottom:1px solid #2a2a4a;padding-bottom:8px;margin-bottom:8px">' +
      '<h2 style="color:#f5e642;font-size:15px;margin:0">' + sec.icon + ' ' + (lang === 'pt' ? (_PT_SECT[sec.title] || sec.title) : sec.title) + '</h2>' +
      '<span style="color:#555;font-size:11px">' + sRoutes.length + (lang === 'pt' ? ' rota' : ' route') + (sRoutes.length !== 1 ? 's' : '') + '</span>' +
      '</div>' +
      (desc ? '<p style="color:#666;font-size:12px;margin-bottom:12px;line-height:1.6">' + desc + '</p>' : '') +
      '<table style="width:100%;border-collapse:collapse;background:#0a0a18;border-radius:8px;overflow:hidden">' +
      '<thead><tr style="background:#0d0d2a;border-bottom:1px solid #1a1a3a">' +
      '<th style="padding:6px 10px;text-align:left;font-size:10px;color:#444;font-weight:600;letter-spacing:0.5px">' + (lang==='pt'?'MÉTODO':'METHOD') + '</th>' +
      '<th style="padding:6px 10px;text-align:left;font-size:10px;color:#444;font-weight:600;letter-spacing:0.5px">' + (lang==='pt'?'CAMINHO':'PATH') + '</th>' +
      '<th style="padding:6px 10px;text-align:left;font-size:10px;color:#444;font-weight:600;letter-spacing:0.5px">' + (lang==='pt'?'DESCRIÇÃO':'DESCRIPTION') + '</th>' +
      '<th style="padding:6px 10px;font-size:10px;color:#444;font-weight:600;letter-spacing:0.5px"></th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table></section>';
  }).join('');

  var p = API_PORT;

  var scriptLines = [
    '(function(){',
    '  var PORT=' + p + ';',
    '  var sb=document.getElementById("status-badge");',
    '  function check(){',
    '    fetch("/").then(function(r){return r.json();}).then(function(d){',
    '      if(d.jogo_conectado){sb.textContent="Online — "+(d.confeitaria||"connected");sb.style.cssText="background:#0d3d1e;color:#2d9e54;border:1px solid #1a7a3c;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:bold";}',
    '      else{sb.textContent="Server up — game loading";sb.style.cssText="background:#3d2d00;color:#e67e22;border:1px solid #a05a00;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:bold";}',
    '    }).catch(function(){sb.textContent="Offline";sb.style.cssText="background:#3d0d0d;color:#ff6b6b;border:1px solid #8b1a1a;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:bold";});',
    '  }',
    '  check();setInterval(check,5000);',
    '',
    '  window.toggleTest=function(tid){',
    '    var el=document.getElementById("tp-"+tid);if(!el)return;',
    '    var open=el.style.display!=="none";',
    '    el.style.display=open?"none":"table-row";',
    '    var btn=document.querySelector("[data-tid=\'"+tid+"\']");',
    '    if(btn){btn.textContent=open?"\\u25b6 Test":"\\u25bc Close";btn.style.borderColor=open?"#2a2a4a":"#f5e642";btn.style.color=open?"#888":"#f5e642";}',
    '  };',
    '',
    '  window.runTest=function(tid,method,template,hasBody){',
    '    var res=document.getElementById("result-"+tid);',
    '    var sta=document.getElementById("result-status-"+tid);',
    '    if(!res)return;',
    '    var path=template;',
    '    var ok=true;',
    '    document.querySelectorAll("[data-param-for=\'"+tid+"\']").forEach(function(inp){',
    '      var v=inp.value.trim();',
    '      if(!v){inp.style.borderColor="#c0392b";ok=false;return;}',
    '      inp.style.borderColor="#2a4a6a";',
    '      path=path.replace("{"+inp.getAttribute("data-param")+"}",encodeURIComponent(v));',
    '    });',
    '    if(!ok||path.indexOf("{")!==-1){sta.textContent="\\u26a0 Fill in all parameters";sta.style.color="#e67e22";return;}',
    '    var url=path;',
    '    var opts={method:method,headers:{"Content-Type":"application/json","Accept":"application/json"}};',
    '    if(hasBody){var be=document.getElementById("body-"+tid);if(be&&be.value.trim()){try{JSON.parse(be.value);opts.body=be.value;}catch(e){sta.textContent="\\u26a0 Invalid JSON: "+e.message;sta.style.color="#e67e22";return;}}}',
    '    sta.textContent="\\u29d7 Sending\\u2026";sta.style.color="#888";res.style.display="none";',
    '    fetch(url,opts).then(function(r){',
    '      var code=r.status;',
    '      return r.text().then(function(t){',
    '        var pretty=t;try{pretty=JSON.stringify(JSON.parse(t),null,2);}catch(e){}',
    '        res.textContent=pretty;res.style.display="block";',
    '        var isOk=code>=200&&code<300;',
    '        res.style.borderColor=isOk?"#1a7a3c":code<500?"#a05a00":"#8b1a1a";',
    '        sta.textContent="HTTP "+code+(isOk?" \\u2713":"");',
    '        sta.style.color=isOk?"#2d9e54":code<500?"#e67e22":"#ff6b6b";',
    '      });',
    '    }).catch(function(e){',
    '      res.textContent="Connection refused.\\nIs Cookie Clicker running with the Cookie Bridge mod active?\\n\\nURL tried: "+url;',
    '      res.style.display="block";res.style.borderColor="#8b1a1a";',
    '      sta.textContent="\\u2717 No connection";sta.style.color="#ff6b6b";',
    '    });',
    '  };',
    '})();',
    '',
    '  // ── Electron Debug Panel ───────────────────────────────────────────────────',
    '  if(/electron/i.test(navigator.userAgent)){',
    '    var _dbgBar=document.createElement("div");',
    '    _dbgBar.id="dbg-bar";',
    '    _dbgBar.style.cssText="position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#050510;border-top:2px solid #f5e642;padding:6px 16px;font-family:monospace;font-size:11px;color:#ccc;display:flex;align-items:center;gap:14px;flex-wrap:wrap";',
    '    _dbgBar.innerHTML=',
    '      \'<span style="color:#f5e642;font-weight:bold;letter-spacing:1px">DEBUG</span>\'+',
    '      \'<span id="dbg-state" style="color:#5bc8f5"></span>\'+',
    '      \'<span id="dbg-queue" style="color:#2d9e54"></span>\'+',
    '      \'<span id="dbg-next" style="color:#888"></span>\'+',
    '      \'<span style="flex:1"></span>\'+',
    '      \'<button id="dbg-btn-clear" style="background:#1a1a2e;color:#ccc;border:1px solid #333;padding:2px 10px;border-radius:3px;font-size:10px;cursor:pointer;font-family:monospace">Clear Queue</button>\'+',
    '      \'<button id="dbg-btn-bkp" style="background:#1a1a2e;color:#ccc;border:1px solid #333;padding:2px 10px;border-radius:3px;font-size:10px;cursor:pointer;font-family:monospace">Save Backup</button>\'+',
    '      \'<button id="dbg-btn-state" style="background:#1a1a2e;color:#ccc;border:1px solid #333;padding:2px 10px;border-radius:3px;font-size:10px;cursor:pointer;font-family:monospace">State JSON</button>\';',
    '    document.body.appendChild(_dbgBar);',
    '    document.body.style.paddingBottom="36px";',
    '    var _dbgPre=document.createElement("pre");',
    '    _dbgPre.id="dbg-pre";',
    '    _dbgPre.style.cssText="display:none;position:fixed;bottom:36px;left:0;right:0;height:45vh;background:#030308;border-top:1px solid #1a3050;overflow:auto;padding:16px;font-size:11px;color:#5bc8f5;z-index:9998;margin:0";',
    '    document.body.appendChild(_dbgPre);',
    '    var _dbgOpen=false;',
    '    function _dbgUpdate(){',
    '      fetch("/").then(function(r){return r.json();}).then(function(d){',
    '        var ts=d.ultimo_estado_recebido;',
    '        var age=ts?((Date.now()-ts)/1000).toFixed(1)+"s ago":"no data";',
    '        var el=document.getElementById("dbg-state");',
    '        if(el)el.textContent="State: "+age;',
    '      }).catch(function(){});',
    '      fetch("/action/queue").then(function(r){return r.json();}).then(function(d){',
    '        var qEl=document.getElementById("dbg-queue");',
    '        var nEl=document.getElementById("dbg-next");',
    '        if(qEl)qEl.textContent="Queue: "+d.total;',
    '        var next=d.fila&&d.fila.length?d.fila[0].type:"— idle";',
    '        if(nEl)nEl.textContent="Next: "+next;',
    '      }).catch(function(){});',
    '    }',
    '    document.getElementById("dbg-btn-clear").onclick=function(){',
    '      fetch("/action/queue",{method:"DELETE"}).then(function(){_dbgUpdate();});',
    '    };',
    '    document.getElementById("dbg-btn-bkp").onclick=function(){',
    '      var b=document.getElementById("dbg-btn-bkp");b.textContent="Saving...";',
    '      fetch("/backup",{method:"POST"}).then(function(r){return r.json();}).then(function(){b.textContent="Saved!";setTimeout(function(){b.textContent="Save Backup";},2000);}).catch(function(){b.textContent="Error";});',
    '    };',
    '    document.getElementById("dbg-btn-state").onclick=function(){',
    '      _dbgOpen=!_dbgOpen;',
    '      var pre=document.getElementById("dbg-pre");',
    '      if(_dbgOpen){',
    '        fetch("/state").then(function(r){return r.json();}).then(function(d){',
    '          pre.textContent=JSON.stringify(d,null,2);pre.style.display="block";',
    '        });',
    '      }else{pre.style.display="none";}',
    '    };',
    '    _dbgUpdate();setInterval(_dbgUpdate,1000);',
    '  }',
    '',
    "function esc(value){return String(value==null?'':value).replace(/[&<>\"']/g,function(c){return '&#'+c.charCodeAt(0)+';';});}",
    '  // ── Live View ─────────────────────────────────────────────────────────',
    '  var _liveTimer=null,_livePaused=false,_mgDetailKey=null,_lastD=null;',
    '  function fmt(n){',
    '    if(n===undefined||n===null)return "?";',
    '    n=Number(n);if(isNaN(n))return "?";',
    '    var NS=["million","billion","trillion","quadrillion","quintillion","sextillion","septillion","octillion","nonillion","decillion","undecillion","duodecillion","tredecillion","quattuordecillion","quindecillion","sexdecillion","septendecillion","octodecillion","novemdecillion","vigintillion"];',
    '    var neg=n<0;if(neg)n=-n;var s;',
    '    if(n>=1e6){var e=Math.min(Math.floor(Math.log10(n)/3)*3,63);var i=e/3-2;s=(i>=0&&i<NS.length)?(n/Math.pow(10,e)).toFixed(3)+" "+NS[i]:n.toExponential(3);}',
    '    else if(n>=1000){s=Math.round(n).toLocaleString("en-US");}',
    '    else{s=n.toLocaleString(undefined,{maximumFractionDigits:1});}',
    '    return neg?"-"+s:s;',
    '  }',
    '  function renderGrimoire(gr){',
    '    var spells=gr.spells||[];',
    '    if(!spells.length)return \'<div style="color:#556;font-size:11px;padding:8px">No spell data yet</div>\';',
    '    var rows=spells.map(function(sp){',
    '      var ok=sp.canCast;var ic=sp.icon||[0,0];',
    '      var ico=\'<div style="width:24px;height:24px;min-width:24px;background-image:url(/img/icons.png);background-position:\'+(0-(ic[0]*24))+\'px \'+(0-(ic[1]*24))+\'px;background-size:864px 888px;image-rendering:pixelated"></div>\';',
    '      return \'<tr style="color:\'+(ok?\'#ccc\':\'#556\')+\'">\'+',
    '        \'<td style="padding:2px 6px">\'+ico+\'</td>\'+',
    '        \'<td style="padding:3px 10px">\'+esc(sp.name)+\'</td>\'+',
    '        \'<td style="padding:3px 8px;color:#5bc8f5">\'+esc(sp.cost)+\'</td>\'+',
    '        \'<td style="padding:3px 8px;color:#f5a742">\'+esc(sp.failChance||0)+\'%</td>\'+',
    '        \'<td style="padding:3px 8px;color:\'+(ok?\'#2d9e54\':\'#663333\')+\'">\'+(ok?\'\\u2713\':\'\\u2717\')+\'</td></tr>\';',
    '    }).join(\'\');',
    '    return \'<table style="width:100%;border-collapse:collapse">\'+',
    '      \'<thead><tr style="color:#3a5070;font-size:9px;letter-spacing:1px">\'+',
    '      \'<th style="padding:2px 6px"></th>\'+',
    '      \'<th style="text-align:left;padding:3px 10px">SPELL</th>\'+',
    '      \'<th style="text-align:left;padding:3px 8px">COST</th>\'+',
    '      \'<th style="text-align:left;padding:3px 8px">FAIL%</th>\'+',
    '      \'<th style="text-align:left;padding:3px 8px">CAST?</th>\'+',
    '      \'</tr></thead><tbody>\'+rows+\'</tbody></table>\';',
    '  }',
    '  function renderPantheon(pt){',
    '    var SLOTS=[\'Diamond\',\'Ruby\',\'Jade\'];',
    '    var spirits=pt.spirits||[];',
    '    var slotted=pt.slots||[-1,-1,-1];',
    '    var sMap=Object.create(null);spirits.forEach(function(sp){sMap[sp.id]=sp;});',
    '    var slotRows=SLOTS.map(function(sn,i){',
    '      var spId=slotted[i];var sp=(spId!=null&&spId!==-1)?sMap[spId]:null;',
    '      var ic=sp&&sp.icon?sp.icon:[0,0];',
    '      var icoStyle=\'width:32px;height:32px;min-width:32px;background-image:url(/img/icons.png);background-position:\'+(0-(ic[0]*32))+\'px \'+(0-(ic[1]*32))+\'px;background-size:1152px 1184px;image-rendering:pixelated;border-radius:3px\';',
    '      var icoHtml=sp?\'<div style="\'+icoStyle+\'"></div>\':\'<div style="width:32px;height:32px;min-width:32px;background:#0a0a18;border:1px solid #1a1a32;border-radius:3px"></div>\';',
    '      return \'<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #1a1a32">\'+',
    '        icoHtml+',
    '        \'<span style="color:#888;font-size:9px;min-width:52px;text-transform:uppercase">\'+sn+\'</span>\'+',
    '        \'<span style="color:\'+(sp?\'#ccc\':\'#444\')+\';font-size:11px">\'+(sp?esc(sp.name):\'\\u2014 empty\')+\'</span></div>\';',
    '    }).join(\'\');',
    '    var unslotted=spirits.filter(function(sp){return sp.slot<0;});',
    '    var unHtml=\'\';',
    '    if(unslotted.length){',
    '      unHtml=\'<div style="margin-top:8px;color:#3a5070;font-size:9px;letter-spacing:1px">UNSLOTTED</div>\'+',
    '        \'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">\'+',
    '        unslotted.map(function(sp){',
    '          var ic=sp.icon||[0,0];',
    '          return \'<div title="\'+esc(sp.name)+\'" style="width:24px;height:24px;background-image:url(/img/icons.png);background-position:\'+(0-(ic[0]*24))+\'px \'+(0-(ic[1]*24))+\'px;background-size:864px 888px;image-rendering:pixelated;cursor:default"></div>\';',
    '        }).join(\'\')+',
    '        \'</div>\';',
    '    }',
    '    return \'<div style="padding:2px 0">\'+slotRows+unHtml+\'</div>\';',
    '  }',
    '  function renderGarden(gd){',
    '    var grid=gd.grid||[];',
    '    if(!grid.length)return \'<div style="color:#556;font-size:11px;padding:8px">No grid data yet</div>\';',
    '    var rows=[];for(var gy=0;gy<(gd.height||6);gy++){rows[gy]=[];for(var gx=0;gx<(gd.width||6);gx++)rows[gy][gx]=(grid[gx]?grid[gx][gy]:null)||null;}',
    '    var tbl=rows.map(function(row){',
    '      var cells=row.map(function(cell){',
    '        if(!cell)return \'<td style="width:40px;height:40px;background:#060c14;border:1px solid #0d1a2e"></td>\';',
    '        var ic=cell.icon||[0,0];',
    '        var pct=cell.growthPct||0;',
    '        var m=cell.mature;',
    '        var spr=\'<div style="width:40px;height:40px;background-image:url(/img/gardenPlants.png);background-position:\'+(0-(ic[0]*40))+\'px \'+(0-(ic[1]*40))+\'px;background-size:200px 1440px;image-rendering:pixelated"></div>\';',
    '        return \'<td title="\'+esc(cell.seedName)+\' \'+esc(pct)+\'%" style="width:40px;height:40px;background:\'+(m?\'#0a2010\':\'#081208\')+\';border:1px solid \'+(m?\'#1a4020\':\'#0d1a12\')+\';padding:0">\'+spr+\'</td>\';',
    '      }).join(\'\');',
    '      return \'<tr>\'+cells+\'</tr>\';',
    '    }).join(\'\');',
    '    return \'<div style="overflow-x:auto"><table style="border-collapse:collapse">\'+tbl+\'</table></div>\';',
    '  }',
    '  function renderStock(bk){',
    '    var goods=bk.goods||{};',
    '    var keys=Object.keys(goods);',
    '    if(!keys.length)return \'<div style="color:#556;font-size:11px;padding:8px">No stock data yet</div>\';',
    '    var hasIco=keys.some(function(k){return goods[k].icon;});',
    '    var rows=keys.map(function(k){',
    '      var g=goods[k];var delta=g.delta||0;',
    '      var dc=delta>0?\'#2d9e54\':delta<0?\'#ff6b6b\':\'#556\';',
    '      var dt=(delta>0?\'+\':\'\')+delta.toFixed(2);',
    '      var icoTd=\'\';if(hasIco&&g.icon){var ic=g.icon;icoTd=\'<td style="padding:3px 6px"><div style="width:24px;height:24px;background-image:url(/img/icons.png);background-position:\'+(0-(ic[0]*24))+\'px \'+(0-(ic[1]*24))+\'px;background-size:864px 888px;image-rendering:pixelated"></div></td>\';}',
    '      return \'<tr style="font-size:11px">\'+icoTd+',
    '        \'<td style="padding:3px 10px;color:#ccc">\'+esc(g.name)+\'</td>\'+',
    '        \'<td style="padding:3px 8px;color:#f5e642">$\'+g.price.toFixed(2)+\'</td>\'+',
    '        \'<td style="padding:3px 8px;color:\'+dc+\'">\'+dt+\'</td>\'+',
    '        \'<td style="padding:3px 8px;color:#5bc8f5">\'+esc(g.portfolio)+\'/\'+esc(g.maxPortfolio)+\'</td></tr>\';',
    '    }).join(\'\');',
    '    return \'<table style="width:100%;border-collapse:collapse">\'+',
    '      \'<thead><tr style="color:#3a5070;font-size:9px;letter-spacing:1px">\'+',
    '      (hasIco?\'<th></th>\':\'\')+',
    '      \'<th style="text-align:left;padding:3px 10px">NAME</th>\'+',
    '      \'<th style="text-align:left;padding:3px 8px">PRICE</th>\'+',
    '      \'<th style="text-align:left;padding:3px 8px">DELTA</th>\'+',
    '      \'<th style="text-align:left;padding:3px 8px">OWNED</th>\'+',
    '      \'</tr></thead><tbody>\'+rows+\'</tbody></table>\';',
    '  }',
    '  function renderLegado(lg){',
    '    var chips=lg.heavenly_chips||0;var spent=lg.heavenly_chips_gastos||0;',
    '    var prest=lg.prestige||0;var asc=lg.ascensoes||0;',
    '    var delta=lg.ganho_prestige||0;var toNext=lg.cookies_para_proximo_prestige;',
    '    var runMs=lg.tempo_run_ms||0;',
    '    var upgs=lg.upgrades||[];',
    '    var bought=upgs.filter(function(u){return u.bought;}).length;',
    '    var affordable=upgs.filter(function(u){return !u.bought&&u.canAfford;});',
    '    var runH=Math.floor(runMs/3600000);var runM=Math.floor((runMs%3600000)/60000);',
    '    var runStr=runMs>0?(runH>0?runH+"h ":"")+runM+"m this run":"—";',
    '    function s2(l,v,c){return \'<div style="background:#0a0a20;border:1px solid #1a1a38;border-radius:4px;padding:6px 10px">\'+\'<div style="color:#3a5070;font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px">\'+esc(l)+\'</div>\'+\'<div style="color:\'+(c||\'#f5e642\')+\';font-size:14px;font-weight:700">\'+esc(v)+\'</div></div>\';}',
    '    var html=\'\';',
    '    html+=\'<div style="background:#0d1a0d;border:1px solid #1a3a1a;border-radius:6px;padding:10px 14px;margin-bottom:10px">\';',
    '    html+=\'<div style="color:#3a5070;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px">Ascending now would give</div>\';',
    '    html+=\'<div style="color:#2d9e54;font-size:20px;font-weight:700;line-height:1.2">+\'+fmt(delta)+\' prestige levels</div>\';',
    '    html+=\'<div style="color:#2d9e54;font-size:13px;margin-top:2px">+\'+fmt(delta)+\' heavenly chips to spend</div>\';',
    '    html+=\'<div style="color:#556;font-size:10px;margin-top:6px">\'+runStr+\'</div>\';',
    '    html+=\'</div>\';',
    '    html+=\'<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:10px">\';',
    '    html+=s2(\'Current prestige\',fmt(prest),\'#5bc8f5\');',
    '    html+=s2(\'Ascensions\',\'#\'+asc,\'#888\');',
    '    html+=s2(\'Chips available\',fmt(chips));',
    '    html+=s2(\'Chips spent\',fmt(spent),\'#556\');',
    '    html+=\'</div>\';',
    '    if(toNext!==null&&toNext!==undefined){html+=\'<div style="color:#556;font-size:10px;margin-bottom:8px">\\u2192 Next prestige level needs \'+fmt(toNext)+\' more cookies</div>\';}',
    '    html+=\'<div style="color:#3a5070;font-size:9px;letter-spacing:1.5px;margin-bottom:6px;text-transform:uppercase">Heavenly Upgrades \\u2014 \'+bought+\'/\'+upgs.length+\' bought</div>\';',
    '    if(affordable.length){',
    '      html+=\'<div style="color:#5bc8f5;font-size:10px;margin-bottom:4px">Affordable now (\'+affordable.length+\'):</div>\';',
    '      html+=\'<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">\';',
    '      affordable.slice(0,12).forEach(function(u){html+=\'<span style="background:#0a1a2a;border:1px solid #1a3050;border-radius:3px;padding:2px 6px;font-size:10px;color:#aaa">\'+esc(u.name)+\'</span>\';});',
    '      if(affordable.length>12)html+=\'<span style="color:#556;font-size:10px">+\'+(affordable.length-12)+\' more</span>\';',
    '      html+=\'</div>\';',
    '    }',
    '    return html;',
    '  }',
    '  function renderMgDetailPanel(){',
    '    var el=document.getElementById(\'live-content\');if(!el)return;',
    '    var det=document.getElementById(\'live-mg-detail\');',
    '    if(!det){',
    '      det=document.createElement(\'div\');det.id=\'live-mg-detail\';',
    '      el.insertAdjacentElement(\'afterend\',det);',
    '    }',
    '    if(!_mgDetailKey||!_lastD){det.style.display=\'none\';return;}',
    '    var d=_lastD;',
    '    var gr=d.grimorio||{};var pt=d.panteao||{};',
    '    var gd=d.jardim||{};var bk=d.bolsa||{};var lg=d.legado||{};',
    '    var title=\'\',body=\'\';',
    '    if(_mgDetailKey===\'grimoire\'){title=\'Grimoire\';body=renderGrimoire(gr);}',
    '    else if(_mgDetailKey===\'pantheon\'){title=\'Pantheon\';body=renderPantheon(pt);}',
    '    else if(_mgDetailKey===\'garden\'){title=\'Garden\';body=renderGarden(gd);}',
    '    else if(_mgDetailKey===\'stock\'){title=\'Stock Market\';body=renderStock(bk);}',
    '    else if(_mgDetailKey===\'legado\'){title=\'Legacy\';body=renderLegado(lg);}',
    '    det.style.display=\'block\';',
    '    det.innerHTML=\'<div style="background:#0a0a18;border:1px solid #1a1a32;border-radius:6px;padding:12px;margin-top:8px;font-family:Segoe UI,Arial,sans-serif">\'+',
    '      \'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">\'+',
    '      \'<span style="color:#3a5070;font-size:9px;letter-spacing:1.5px;text-transform:uppercase">\'+title+\'</span>\'+',
    '      \'<span style="color:#3a5070;font-size:11px;cursor:pointer" onclick="_mgDetailKey=null;renderMgDetailPanel()">\\u2715 close</span>\'+',
    '      \'</div>\'+body+\'</div>\';',
    '  }',
    '  function toggleLiveView(){',
    '    var p=document.getElementById("live-panel");',
    '    var b=document.getElementById("btn-live");',
    '    if(!p)return;',
    '    var vis=p.style.display!=="none";',
    '    p.style.display=vis?"none":"block";',
    '    b.style.background=vis?"#0d1a2e":"#0d2645";',
    '    b.style.borderColor=vis?"#1a4d8f":"#5bc8f5";',
    '    if(!vis){updateLiveView();if(!_livePaused)_liveTimer=setInterval(updateLiveView,2000);}',
    '    else{clearInterval(_liveTimer);}',
    '  }',
    '  function pauseLiveView(){',
    '    var b=document.getElementById("btn-live-pause");',
    '    _livePaused=!_livePaused;',
    '    if(_livePaused){clearInterval(_liveTimer);if(b){b.textContent="\\u25b6 Resume";b.style.color="#f5e642";}}',
    '    else{_liveTimer=setInterval(updateLiveView,2000);updateLiveView();if(b){b.textContent="\\u23f8 Pause";b.style.color="#888";}}',
    '  }',
    '  function updateLiveView(){',
    '    var el=document.getElementById("live-content");if(!el)return;',
    '    var sc=function(l,v,c,sub){',
    '      return \'<div style="background:#0a1525;border:1px solid #1a3050;border-radius:6px;padding:10px 14px">\'+',
    '        \'<div style="color:#3a5070;font-size:9px;letter-spacing:1.5px;margin-bottom:4px;text-transform:uppercase">\'+esc(l)+\'</div>\'+',
    '        \'<div style="color:\'+(c||"#f5e642")+\';font-size:17px;font-weight:700;word-break:break-all;line-height:1.2">\'+esc(v)+\'</div>\'+',
    '        (sub?\'<div style="color:#3a5070;font-size:10px;margin-top:3px">\'+esc(sub)+\'</div>\':"")+',
    '        \'</div>\';',
    '    };',
    '    var bg=function(l,v,on){',
    '      return \'<div style="background:\'+(on?"#0a2010":"#0c0c1e")+\';border:1px solid \'+(on?"#1a4a1a":"#1a1a32")+\';border-radius:4px;padding:5px 12px;flex:1;min-width:120px">\'+',
    '        \'<div style="color:#3a5070;font-size:9px;letter-spacing:1px;margin-bottom:2px;text-transform:uppercase">\'+esc(l)+\'</div>\'+',
    '        \'<div style="color:\'+(on?"#2d9e54":"#556")+\';font-size:11px;font-weight:600">\'+esc(v)+\'</div></div>\';',
    '    };',
    '    var mc=function(l,v,bar){',
    '      return \'<div style="background:#0a1525;border:1px solid #1a3050;border-radius:6px;padding:8px 12px">\'+',
    '        \'<div style="color:#3a5070;font-size:9px;letter-spacing:1px;margin-bottom:4px;text-transform:uppercase">\'+esc(l)+\'</div>\'+',
    '        \'<div style="color:#aaa;font-size:11px">\'+esc(v)+\'</div>\'+(bar||"")+\'</div>\';',
    '    };',
    '    var wmc=function(key,l,v,bar){',
    '      var s=\'cursor:pointer\';',
    '      if(key===_mgDetailKey)s+=\';outline:1px solid #5bc8f5;border-radius:6px\';',
    '      return \'<div data-mg-key="\'+ key+\'" style="\'+s+\'">\'+ mc(l,v,bar)+\'</div>\';',
    '    };',
    '    fetch("/state").then(function(r){',
    '      if(!r.ok)throw new Error("HTTP "+r.status);',
    '      return r.json();',
    '    }).then(function(d){',
    '      _lastD=d;',
    '      var ts=document.getElementById("live-ts");',
    '      if(ts)ts.textContent=new Date().toLocaleTimeString();',
    '      var es=d.estatisticas||{};',
    '      var buffsObj=d.buffs_ativos||{};var bKeys=Object.keys(buffsObj);',
    '      var sh=d.shimmers||[];',
    '      var wr=(d.wrinklers||[]).filter(function(w){return w&&w.phase>0;});',
    '      var sl=d.sugar_lumps||{};',
    '      var gr=d.grimorio||{};',
    '      var pt=d.panteao||{};',
    '      var gd=d.jardim||{};',
    '      var bk=d.bolsa||{};',
    '      var lg=d.legado||{};',
    '      var cps=d.cookies_por_segundo_raw||d.cookies_por_segundo;',
    '      var prest=es.prestige||0;',
    '      var prestFmt=fmt(prest);',
    '      var statRow=\'<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:10px">\'+',
    '        sc("Cookies",fmt(d.cookies_na_conta),"#f5e642")+',
    '        sc("CpS",fmt(cps),"#2d9e54")+',
    '        sc("CpC",fmt(d.cookies_por_click),"#cc8844")+',
    '        sc("Prestige",prestFmt,"#5bc8f5")+',
    '        sc("Ascension","#"+(es.ascensoes||0),"#888")+',
    '        \'</div>\';',
    '      var bText=bKeys.length?bKeys.slice(0,3).map(function(k){var b=buffsObj[k];var s=Math.ceil((b.timeLeft||0)/30);return k+\' (\'+Math.floor(s/60)+\':\'+(s%60<10?\'0\':\'\')+s%60+\')\';}).join(\' · \')+(bKeys.length>3?\' +\'+(bKeys.length-3):\'\'):\'— none\';',
    '      var sText=sh.length?sh.length+" shimmer"+(sh.length>1?"s":"")+" on screen!":"none";',
    '      var wText=wr.length?wr.length+" active":"none";',
    '      var lText=(sl.disponiveis||0)+" lump"+(sl.disponiveis!==1?"s":"")+" ready";',
    '      var statRow2=\'<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">\'+',
    '        bg("Buffs",bText,bKeys.length>0)+',
    '        bg("Shimmers",sText,sh.length>0)+',
    '        bg("Wrinklers",wText,wr.length>0)+',
    '        bg("Lumps",lText,(sl.disponiveis||0)>0)+',
    '        \'</div>\';',
    '      var chips=(d.buildings||[]).map(function(b){',
    '        var clr=b.amount>500?"#f5e642":b.amount>100?"#2d9e54":"#ccc";',
    '        return \'<span style="background:#0a1525;border:1px solid #1a3050;border-radius:3px;padding:2px 7px;font-size:11px;white-space:nowrap">\'+',
    '          \'<span style="color:#445">\'+esc(b.name.split(" ")[0])+\'</span><span style="color:\'+ clr +\'">×\'+esc(b.amount)+\'</span></span>\';',
    '      }).join("");',
    '      var bldgsRow=\'<div style="background:#0a0a18;border:1px solid #111128;border-radius:6px;padding:10px 12px;margin-bottom:10px">\'+',
    '        \'<div style="color:#3a5070;font-size:9px;letter-spacing:1.5px;margin-bottom:8px;text-transform:uppercase">Buildings</div>\'+',
    '        \'<div style="display:flex;flex-wrap:wrap;gap:4px">\'+chips+\'</div></div>\';',
    '      var mana=gr.magic||0;var mMax=gr.magicMax||100;',
    '      var mpct=Math.min(100,Math.round((mana/mMax)*100))||0;',
    '      var mBar=\'<div style="background:#0d1a2e;border-radius:2px;height:3px;margin-top:6px"><div style="background:\'+(mpct>80?"#5bc8f5":mpct>40?"#2d9e54":"#a05a00")+\';width:\'+mpct+\'%;height:3px;border-radius:2px;transition:width 0.5s"></div></div>\';',
    '      var mgRow=\'<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">\'+',
    '        wmc("grimoire","Grimoire",Math.round(mana)+"/"+mMax+" mana",mBar)+',
    '        wmc("pantheon","Pantheon",(pt.swapsDisponiveis!==undefined?pt.swapsDisponiveis:"?")+" swaps left")+',
    '        wmc("garden","Garden",gd.available?"active — "+(gd.width||"?")+"×"+(gd.height||"?")+" grid":"not available")+',
    '        wmc("stock","Stock",bk.available?"trading active":"not available")+',
    '        wmc("legado","Legacy","if ascend: +"+fmt(lg.ganho_prestige||0)+" levels")+',
    '        \'</div>\';',
    '      fetch("/io").then(function(r){return r.json();}).then(function(io){',
    '        var ioHtml=\'<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">\'+',
    '          \'<span style="background:#0a120a;border:1px solid #1a3a1a;border-radius:4px;padding:3px 8px;font-size:10px;color:#2d9e54">RAM \'+io.memory.heap_used_mb+\'MB / \'+io.os.total_mem_mb+\'MB</span>\'+',
    '          \'<span style="background:#0a120a;border:1px solid #1a3a1a;border-radius:4px;padding:3px 8px;font-size:10px;color:#2d9e54">Free \'+io.os.free_mem_mb+\'MB</span>\'+',
    '          \'<span style="background:#0a120a;border:1px solid #1a3a1a;border-radius:4px;padding:3px 8px;font-size:10px;color:#556">Uptime \'+Math.round(io.uptime_s/60)+\'min</span>\'+',
    '          \'<a href="/charts" target="_blank" style="background:#0a0a20;border:1px solid #1a1a38;border-radius:4px;padding:3px 8px;font-size:10px;color:#5bc8f5;text-decoration:none">&#x1F4C8; Charts</a>\'+',
    '          \'</div>\';',
    '        el.innerHTML=\'<div style="font-family:Segoe UI,Arial,sans-serif">\'+statRow+statRow2+bldgsRow+mgRow+ioHtml+\'</div>\';',
    '      }).catch(function(){',
    '        el.innerHTML=\'<div style="font-family:Segoe UI,Arial,sans-serif">\'+statRow+statRow2+bldgsRow+mgRow+\'</div>\';',
    '      });',
    '      if(!el.__mgEvt){',
    '        el.__mgEvt=true;',
    '        el.addEventListener(\'click\',function(ev){',
    '          var t=ev.target.closest(\'[data-mg-key]\');',
    '          if(!t)return;',
    '          var k=t.getAttribute(\'data-mg-key\');',
    '          _mgDetailKey=(_mgDetailKey===k)?null:k;',
    '          renderMgDetailPanel();',
    '        });',
    '      }',
    '      renderMgDetailPanel();',
    '    }).catch(function(){',
    '      el.innerHTML=\'<div style="color:#ff6b6b;padding:20px;text-align:center;font-size:12px;letter-spacing:0.5px">DISCONNECTED — is Cookie Clicker running with the mod active?</div>\';',
    '    });',
    '  }',
  ];
  scriptLines.push(
    '(function(){',
    '  fetch("/state").then(function(r){return r.json();}).then(function(st){',
    '    var ups=(st.upgrades_na_loja||[]);',
    '    var uHtml=ups.length',
    '      ?ups.map(function(u){return\'<option value="\'+esc(u.name)+\'">\'+esc(u.name)+\'</option>\';}).join("")',
    '      :\'<option value="">No upgrades in store right now</option>\';',
    '    document.querySelectorAll(\'select[data-live="upgrades"]\').forEach(function(sel){',
    '      sel.innerHTML=uHtml;sel.style.color="#f5e642";',
    '    });',
    '  }).catch(function(){',
    '    document.querySelectorAll(\'select[data-live="upgrades"]\').forEach(function(sel){',
    '      sel.innerHTML=\'<option value="">⚠ game offline</option>\';',
    '    });',
    '  });',
    '  fetch("/garden/seeds").then(function(r){return r.json();}).then(function(d){',
    '    var seeds=Array.isArray(d)?d:[];',
    '    var sHtml=seeds.length',
    '      ?seeds.map(function(s){return\'<option value="\'+esc(s.id)+\'">\'+esc(s.id)+\' — \'+esc(s.name)+\'</option>\';}).join("")',
    '      :\'<option value="">No seeds discovered yet</option>\';',
    '    document.querySelectorAll(\'select[data-live="seeds"]\').forEach(function(sel){',
    '      sel.innerHTML=sHtml;sel.style.color="#f5e642";',
    '    });',
    '  }).catch(function(){',
    '    document.querySelectorAll(\'select[data-live="seeds"]\').forEach(function(sel){',
    '      sel.innerHTML=\'<option value="">⚠ garden offline</option>\';',
    '    });',
    '  });',
    '})();'
  );
  var scriptContent = scriptLines.join('\n');

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cookie Bridge API${lang==='pt'?' — Português':''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0d1a;color:#e0e0e0;font-family:'Segoe UI',Arial,sans-serif;min-height:100vh}
a{color:#5bc8f5;text-decoration:none}a:hover{text-decoration:underline}
tr:hover>td{background:rgba(245,230,66,0.025)}
button:hover{opacity:0.82;transform:translateY(-1px)}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:#0d0d1a}
::-webkit-scrollbar-thumb{background:#2a2a3a;border-radius:3px}
input:focus,textarea:focus{outline:1px solid #f5e642;border-color:#f5e642!important}
code{background:#1a1a2e;padding:1px 6px;border-radius:3px;color:#5bc8f5;font-family:'Courier New',monospace}
</style>
</head>
<body>

<!-- HEADER -->
<header style="background:linear-gradient(135deg,#0d0d2a 0%,#1a1a3e 100%);border-bottom:2px solid #f5e642;padding:20px 32px;display:flex;align-items:center;gap:20px">
  <img src="${IMG_GOLD}" style="width:64px;height:64px;image-rendering:pixelated;filter:drop-shadow(0 0 14px rgba(245,230,66,0.7))" alt="Cookie">
  <div>
    <h1 style="color:#f5e642;font-size:26px;font-weight:bold;letter-spacing:1px">Cookie Bridge API</h1>
    <p style="color:#888;font-size:13px;margin-top:4px">v${CONTROL_SCHEMA.version} &nbsp;·&nbsp; ${lang==='pt'?'Servidor HTTP embutido no Electron':'HTTP server embedded in Electron'} &nbsp;·&nbsp; <a href="http://localhost:${p}">http://localhost:${p}</a></p>
  </div>
  <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
    <a href="${lang==='pt'?'/docs':'/docs/pt'}" style="background:#0d1a0d;color:#69ff47;border:1px solid #1a4a1a;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:bold;cursor:pointer;transition:all 0.2s;text-decoration:none">${lang==='pt'?'🇺🇸 EN':'🇧🇷 PT'}</a>
    <button onclick="toggleLiveView()" id="btn-live" style="background:#0d1a2e;color:#5bc8f5;border:1px solid #1a4d8f;padding:5px 14px;border-radius:20px;font-size:12px;font-weight:bold;cursor:pointer;transition:all 0.2s"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H3V4h18v12z"/></svg> ${lang==='pt'?'Visão ao Vivo':'Live View'}</button>
    <span id="status-badge" style="background:#1a1a2e;color:#888;border:1px solid #333;padding:4px 14px;border-radius:20px;font-size:12px;font-weight:bold">${lang==='pt'?'verificando...':'checking...'}</span>
  </div>
</header>

<main style="max-width:1120px;margin:0 auto;padding:32px 24px">


<!-- LIVE VIEW PANEL -->
<div id="live-panel" style="display:none;margin-bottom:28px;background:#070713;border:1px solid #1a3a5f;border-radius:12px;padding:0;overflow:hidden">
  <div style="background:linear-gradient(90deg,#0a1628 0%,#0d1f3c 100%);border-bottom:1px solid #1a3a5f;padding:12px 20px;display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:8px;color:#5bc8f5;font-size:13px;font-weight:600;letter-spacing:0.5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H3V4h18v12z"/></svg> ${lang==='pt'?'VISÃO AO VIVO DO JOGO':'LIVE GAME VIEW'}</div>
    <div style="display:flex;align-items:center;gap:8px">
      <span id="live-ts" style="color:#445;font-size:10px"></span>
      <button onclick="pauseLiveView()" id="btn-live-pause" style="background:#0a1628;color:#556;border:1px solid #1a2a40;padding:3px 10px;border-radius:4px;font-size:10px;cursor:pointer;letter-spacing:0.5px">&#x25a0; PAUSE</button>
      <button onclick="toggleLiveView()" style="background:#0a1628;color:#556;border:1px solid #1a2a40;padding:3px 8px;border-radius:4px;font-size:11px;cursor:pointer">&#x2715;</button>
    </div>
  </div>
  <div id="live-content" style="padding:16px 20px">
    <div style="color:#445;font-size:12px">${lang==='pt'?'Conectando...':'Connecting...'}</div>
  </div>
</div>

<!-- HOW IT WORKS -->
<section style="margin-bottom:28px;background:#0a0a18;border:1px solid #1a1a3a;border-radius:10px;padding:20px 24px">
  <h2 style="color:#f5e642;font-size:14px;margin-bottom:14px;letter-spacing:0.5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg> ${lang==='pt'?'COMO FUNCIONA':'HOW IT WORKS'}</h2>
  <ol style="color:#bbb;font-size:13px;line-height:2.1;padding-left:20px">
    ${lang==='pt'?`<li>O <b>mod Cookie Bridge</b> roda dentro do Cookie Clicker (processo renderer do Electron)</li>
    <li>A cada ~500ms o mod <b>envia o estado completo do jogo</b> para <code>POST /state</code></li>
    <li>Sua automação lê o estado via <code>GET /state</code> e enfileira ações via os endpoints POST abaixo</li>
    <li>O mod consulta <code>GET /action/next</code> e executa a ação enfileirada no jogo</li>`:`<li>The <b>Cookie Bridge mod</b> runs inside Cookie Clicker (Electron renderer process)</li>
    <li>Every ~500 ms the mod <b>pushes the full game state</b> to <code>POST /state</code></li>
    <li>Your automation reads state via <code>GET /state</code> and enqueues actions via the POST endpoints below</li>
    <li>The mod polls <code>GET /action/next</code> and executes the queued action in the game</li>`}
  </ol>
  <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
    <div style="flex:1;min-width:220px;background:#0d1a0d;border:1px solid #1a3a1a;border-radius:6px;padding:10px 14px">
      <div style="color:#2d9e54;font-size:10px;font-weight:700;margin-bottom:4px;letter-spacing:0.5px">${lang==='pt'?'ESTADO RÁPIDO — a cada 500ms':'FAST STATE — every 500 ms'}</div>
      <div style="color:#666;font-size:11px">cookies &nbsp;·&nbsp; CpS &nbsp;·&nbsp; buffs &nbsp;·&nbsp; shimmers &nbsp;·&nbsp; wrinklers &nbsp;·&nbsp; volume</div>
    </div>
    <div style="flex:1;min-width:220px;background:#0d0d2a;border:1px solid #1a1a4a;border-radius:6px;padding:10px 14px">
      <div style="color:#5bc8f5;font-size:10px;font-weight:700;margin-bottom:4px;letter-spacing:0.5px">${lang==='pt'?'ESTADO LENTO — a cada 5s ou após qualquer ação':'SLOW STATE — every 5 s or after any action'}</div>
      <div style="color:#666;font-size:11px">${lang==='pt'?'prédios &nbsp;·&nbsp; melhorias &nbsp;·&nbsp; minijogos &nbsp;·&nbsp; dragão &nbsp;·&nbsp; santa &nbsp;·&nbsp; prefs &nbsp;·&nbsp; legado':'buildings &nbsp;·&nbsp; upgrades &nbsp;·&nbsp; minigames &nbsp;·&nbsp; dragon &nbsp;·&nbsp; santa &nbsp;·&nbsp; prefs &nbsp;·&nbsp; legacy'}</div>
    </div>
    <div style="flex:1;min-width:220px;background:#1a0d0d;border:1px solid #3a1a1a;border-radius:6px;padding:10px 14px">
      <div style="color:#e67e22;font-size:10px;font-weight:700;margin-bottom:4px;letter-spacing:0.5px">${lang==='pt'?'RECONEXÃO AUTOMÁTICA':'OFFLINE BACKOFF'}</div>
      <div style="color:#666;font-size:11px">${lang==='pt'?'Em caso de erro o mod aguarda 5s antes de tentar novamente (visível no painel do jogo)':'On server error the mod waits 5 s before retrying (visible in the in-game panel)'}</div>
    </div>
  </div>
</section>

<!-- SUMMARY CARDS -->
<div style="display:flex;gap:12px;margin-bottom:28px;flex-wrap:wrap">
  <div style="flex:1;min-width:120px;background:#0d0d2a;border:1px solid #2a2a4a;border-radius:10px;padding:16px 18px">
    <div style="color:#f5e642;font-size:30px;font-weight:bold">${routes.length}</div>
    <div style="color:#555;font-size:11px;margin-top:4px">${lang==='pt'?'Total de Endpoints':'Total Endpoints'}</div>
  </div>
  <div style="flex:1;min-width:120px;background:#0d1a0d;border:1px solid #1a4a1a;border-radius:10px;padding:16px 18px">
    <div style="color:#2d9e54;font-size:30px;font-weight:bold">${routes.filter(function(r){return r.m==='GET';}).length}</div>
    <div style="color:#555;font-size:11px;margin-top:4px">GET — ${lang==='pt'?'somente leitura':'read-only'}</div>
  </div>
  <div style="flex:1;min-width:120px;background:#0d0d2a;border:1px solid #1a2a4a;border-radius:10px;padding:16px 18px">
    <div style="color:#4a8fd4;font-size:30px;font-weight:bold">${routes.filter(function(r){return r.m==='POST';}).length}</div>
    <div style="color:#555;font-size:11px;margin-top:4px">POST — ${lang==='pt'?'ações':'actions'}</div>
  </div>
  <div style="flex:1;min-width:120px;background:#1a0d0d;border:1px solid #4a1a1a;border-radius:10px;padding:16px 18px">
    <div style="color:#c0392b;font-size:30px;font-weight:bold">${routes.filter(function(r){return r.m==='DELETE';}).length}</div>
    <div style="color:#555;font-size:11px;margin-top:4px">DELETE</div>
  </div>
</div>

<!-- BUILDINGS REFERENCE -->
<section style="margin-bottom:28px">
  <h2 style="color:#f5e642;font-size:14px;border-bottom:1px solid #1a1a2e;padding-bottom:7px;margin-bottom:12px;letter-spacing:0.5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 11V3H7v4H3v14h8v-4h2v4h8V11h-4zm-6 4H9v-2h2v2zm0-4H9V9h2v2zm0-4H9V5h2v2zm6 8h-2v-2h2v2zm0-4h-2V9h2v2z"/></svg> ${lang==='pt'?'REFERÊNCIA DE PRÉDIOS':'BUILDINGS REFERENCE'} (${buildings.length})</h2>
  <p style="color:#555;font-size:12px;margin-bottom:12px">${lang==='pt'?'Use nomes em inglês (sem distinção de maiúsculas) em todos os endpoints de prédios — ex: <code>Farm</code>, <code>Wizard tower</code>, <code>You</code>':'Use English names (case-insensitive) in all building endpoints — e.g. <code>Farm</code>, <code>Wizard tower</code>, <code>You</code>'}</p>
  <div style="display:flex;flex-wrap:wrap;gap:8px">${buildingCards}</div>
</section>

<!-- MINIGAMES -->
<section style="margin-bottom:28px">
  <h2 style="color:#f5e642;font-size:14px;border-bottom:1px solid #1a1a2e;padding-bottom:7px;margin-bottom:12px;letter-spacing:0.5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg> ${lang==='pt'?'MINI-JOGOS':'MINIGAMES'}</h2>
  <p style="color:#555;font-size:12px;margin-bottom:12px">${lang==='pt'?'Cada mini-jogo desbloqueia quando o prédio pai alcança o <b>nível 1</b> (custo: 1 sugar lump).':'Each minigame unlocks when the parent building reaches <b>level 1</b> (cost: 1 sugar lump).'}</p>
  <div style="display:flex;flex-wrap:wrap;gap:12px">${minigameHtml}</div>
</section>

<!-- SPECIAL ENTITIES -->
<section style="margin-bottom:28px">
  <h2 style="color:#f5e642;font-size:14px;border-bottom:1px solid #1a1a2e;padding-bottom:7px;margin-bottom:12px;letter-spacing:0.5px"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg> ${lang==='pt'?'ENTIDADES ESPECIAIS':'SPECIAL ENTITIES'}</h2>
  <div style="display:flex;flex-wrap:wrap;gap:12px">
    <div style="display:flex;align-items:center;gap:12px;background:#0d0d2a;border:1px solid #2a2a4a;border-radius:8px;padding:12px 16px;flex:1;min-width:200px">
      <div style="width:48px;height:48px;flex-shrink:0;background-image:url(${IMG_DRAGON});background-size:432px 48px;background-position:0 0;background-repeat:no-repeat;image-rendering:pixelated"></div>
      <div><div style="color:#f5e642;font-weight:bold;font-size:13px">Krumblor (${lang==='pt'?'Dragão':'Dragon'})</div><div style="color:#666;font-size:11px;margin-top:3px">${lang==='pt'?'Nível':'Level'} 0–20 &nbsp;·&nbsp; 2 aura slots &nbsp;·&nbsp; GET /dragon/view</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:12px;background:#0d0d2a;border:1px solid #2a2a4a;border-radius:8px;padding:12px 16px;flex:1;min-width:200px">
      <div style="width:48px;height:48px;flex-shrink:0;background-image:url(${IMG_SANTA});background-size:720px 48px;background-position:0 0;background-repeat:no-repeat;image-rendering:pixelated"></div>
      <div><div style="color:#f5e642;font-weight:bold;font-size:13px">${lang==='pt'?'Papai Noel':'Santa Claus'}</div><div style="color:#666;font-size:11px;margin-top:3px">${lang==='pt'?'Nível':'Level'} 0–14 &nbsp;·&nbsp; ${lang==='pt'?'Requer Natal':'Requires Christmas'} &nbsp;·&nbsp; GET /santa/view</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:12px;background:#0d0d2a;border:1px solid #2a2a4a;border-radius:8px;padding:12px 16px;flex:1;min-width:200px">
      <div style="width:48px;height:48px;flex-shrink:0;background-image:url(${IMG_WRINKLER});background-size:48px 96px;background-position:0 0;background-repeat:no-repeat;image-rendering:pixelated"></div>
      <div><div style="color:#f5e642;font-weight:bold;font-size:13px">Wrinklers</div><div style="color:#666;font-size:11px;margin-top:3px">${lang==='pt'?'Até 12 ativos':'Up to 12 active'} &nbsp;·&nbsp; ×1.1 ${lang==='pt'?'retorno':'return'} &nbsp;·&nbsp; GET /wrinklers/view</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:12px;background:#0d0d2a;border:1px solid #2a2a4a;border-radius:8px;padding:12px 16px;flex:1;min-width:200px">
      <div style="width:48px;height:48px;flex-shrink:0;background-image:url(${IMG_SUGARLUMP});background-size:48px 48px;background-position:0 0;background-repeat:no-repeat;image-rendering:pixelated"></div>
      <div><div style="color:#f5e642;font-weight:bold;font-size:13px">Sugar Lumps</div><div style="color:#666;font-size:11px;margin-top:3px">${lang==='pt'?'Amadurece em ~24h':'Ripens in ~24 h'} &nbsp;·&nbsp; ${lang==='pt'?'Sobe nível de prédios':'Level buildings'} &nbsp;·&nbsp; GET /sugarlump/view</div></div>
    </div>
  </div>
</section>

<!-- ROUTE SECTIONS -->
${sectionHtml}
</main>

<footer style="border-top:1px solid #111;padding:14px 32px;text-align:center;color:#333;font-size:11px">
  Cookie Bridge v3.2 &nbsp;·&nbsp; <a href="http://localhost:${p}">http://localhost:${p}</a> &nbsp;·&nbsp; ${lang==='pt'?'Clique em <b>&#x25b6; Test</b> em qualquer rota para testar ao vivo':'Click <b>&#x25b6; Test</b> on any route to try it live'}
</footer>

<script>${scriptContent}</script>
</body>
</html>`;
}

const _server = httpMod.createServer(async (req, res) => {
  try {
    const access = _security.guard(req, res);
    if (access.handled) return;
    if (access.loginPage) return _resHtml(res, SECURITY.loginPage);
    if (access.login) {const body=await _readBody(req,1024);return _res(res,200,_security.login(body.token,res));}
    if (access.pathname === '/auth/logout' && req.method === 'POST') return _res(res,200,_security.logout(req,res));
    const u = new URL(req.url, `http://${API_HOST}:${API_PORT}`);
    const m = req.method.toUpperCase();
    for (const [rm, pat, fn] of ROUTES) {
      if (rm !== m) continue;
      const match = u.pathname.match(pat);
      if (match) { await fn(req, res, match.slice(1).map(decodeURIComponent), u); return; }
    }
    _res(res, 404, {error:'Route not found', dica:'GET /docs'});
  } catch(e) { _res(res, e.status||500, {error:e.message||String(e)}); }
});
_server.listen(API_PORT, API_HOST, () => {
  console.log(`[CookieBridge] Servidor HTTP em http://localhost:${API_PORT}`);
  console.log(`[CookieBridge] Docs em http://localhost:${API_PORT}/docs`);
});
_server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.warn(`[CookieBridge] Port ${API_PORT} is already in use.`);
  else console.error('[CookieBridge] Server error:', e.message);
});
// ═══════════════════════════════════════════════════════════════════════════

let DEV=1;//Preserve the inherited mod mode (including no Steam achievement sync).
let BETA=0;//save and load using different save slot

let saveFile=(BETA?`saveBeta`:`save`)+`.cki`;
let saveFileCloud=saveFile.replace('.cki','.txt');

let quit=false;
//app.disableHardwareAcceleration();//unfortunately breaks steam overlay


function launch(){
	let discordClient=0;//require('discord-rich-presence')('894730407050870835');
	
	let timeStarted=Date.now();
	let updateDiscordPresence=(arr)=>
	{
		if (!discordClient) return false;
		discordClient.updatePresence({
			state:arr[1]||'',
			details:arr[0]||'',
			startTimestamp:timeStarted,
			largeImageKey:'icon1024',
			instance:true,
		});
	}
	
	let win=new BrowserWindow({
		width:1280,
		height:720,
		minWidth:300,
		minHeight:200,
		resizable:true,
		show:false,
		backgroundColor:'#000',
		//icon:path.join(__dirname,'icon.png'),
		webPreferences:{
			backgroundThrottling:false,
			preload:path.join(CONTROL_DIR,'control-preload.js'),
			nodeIntegration:false,
			contextIsolation:true,
			affinity:'Cookie Clicker',
		}
	});
	const gameFile=path.join(__dirname,'src','index.html');
	let gameFrame=null;
	win.webContents.on('did-start-navigation',(event,url,inPlace,isMainFrame,processId,frameId)=>{if(isMainFrame)gameFrame=SECURITY.trustedGameURL(url,gameFile)?{url,processId,frameId}:null;});
	win.webContents.on('did-frame-navigate',(event,url,code,status,isMainFrame,processId,frameId)=>{if(isMainFrame)gameFrame=SECURITY.trustedGameURL(url,gameFile)?{url,processId,frameId}:null;});
	ipcMain.removeHandler('cookie-bridge-connect');
	ipcMain.handle('cookie-bridge-connect',event=>{
		if(!SECURITY.trustedSender(event,win.webContents,gameFile,gameFrame))throw new Error('Untrusted bridge sender.');
		return {port:API_PORT,token:_security.rendererToken};
	});
	win.webContents.on('will-navigate',(event,url)=>{if(!SECURITY.trustedGameURL(url,gameFile))event.preventDefault();});
	const openExternalPage=url=>{if(/^https?:\/\//.test(url))shell.openExternal(url).catch(()=>{});};
	if(typeof win.webContents.setWindowOpenHandler==='function')win.webContents.setWindowOpenHandler(({url})=>{openExternalPage(url);return {action:'deny'};});
	else win.webContents.on('new-window',(event,url)=>{event.preventDefault();openExternalPage(url);});
	
	let send=(id,data,callback)=>{
		if (quit) return false;
		callback=callback||0;
		if (win) win.webContents.send('fromMain',{id,data,callback});
		return true;
	}
	
	win.on('focus',()=>{send('window focus');});
	win.on('blur',()=>{send('window blur');});
	
	
	let timesLoaded=0;
	
	let achievs=[];
	let grantedAchievs=[];
	let isGrantingAchievs=false;
	
	let getMessage=(e,args)=>{
		if (quit) return false;
		//can fake receiving messages with getMessage(0,'data');
		if (typeof args==='string') args={id:args};
		let req=args.id||'';
		let callback=args.callback||0;
		
		try{
			if (req=='ping') send('ping',args,callback);
			else if (req=='init bridge')
			{
				timesLoaded++;
				try{
					if (!greenworksLaunched)
					{
						greenworksLaunched=true;
						process.activateUvLoop();
						greenworks=require(path.join(__dirname,'/greenworks/greenworks'));
						if (greenworks) greenworks=greenworks.init()?greenworks:false;
						if (greenworks)
						{
							achievs=greenworks.getAchievementNames();
							greenworks.on('game-overlay-activated',(active)=>{
								send('overlay',active);
							});
						}
					}
					if (greenworks)
					{
						send('greenworks loaded',{DEV,BETA,timesLoaded},callback);
					}
					else {{send('couldn\'t load greenworks, might be offline',{DEV,BETA,timesLoaded},callback);}}
				} catch(e) {send('error loading greenworks:',{DEV,BETA,timesLoaded},callback);send('error',String(e));}
			}
			else if (req=='wipe save') grantedAchievs=[];
			else if (req=='quit') {quit=true;app.quit();if (win){win.close();}}
			//else if (req=='reload') {if (win){win.reload();}}
			else if (req=='reload')
			{
				if (win)
				{
					//win.loadFile(path.join(__dirname,'/src/index.html'),BETA?{query:{'beta':'1'}}:{});
					let query={bridgePort:String(API_PORT)};
					if (BETA) query.beta='1';
					if (args.modless) query.modless='1';
					win.loadFile(path.join(__dirname,'/src/index.html'),{query:query});
				}
			}
			else if (req=='get playersN')
			{
				if (!greenworks) {return send('data',{'playersN':1},callback);console.log('error getting playersN:','no greenworks');}
				greenworks.getNumberOfPlayers((n)=>{
					send('data',{'playersN':n},callback);
				},(e)=>{send('data',{'playersN':1},callback);console.log('error getting playersN:',e);});
			}
			else if (req=='get achiev')
			{
				if (DEV || BETA) return false;
				if (greenworks && args.achiev && grantedAchievs.indexOf(String(args.achiev))==-1) greenworks.activateAchievement(String(args.achiev),()=>{grantedAchievs.push(String(args.achiev));},(err)=>{});
			}
			else if (req=='get achievs')
			{
				//we call this on save load
				//runs through every achiev in the list, and grants them at a 1-second interval
				if (DEV || BETA) return false;
				if (!greenworks) return false;
				let list=args.list;
				list=list.filter(it=>{return achievs.indexOf(String(it))!=-1;});
				list=list.filter(it=>{return grantedAchievs.indexOf(String(it))==-1;});
				list=[...new Set(list)];
				if (list.length>0 && !isGrantingAchievs)
				{
					isGrantingAchievs=true;
					let grantAchievs=()=>
					{
						let it=list.shift();
						getMessage(0,{id:'get achiev',achiev:it});
						if (list.length>0) setTimeout(grantAchievs,1000);
						else isGrantingAchievs=false;
					}
					grantAchievs();
				}
			}
			else if (req=='reset achievs')
			{
				if (DEV || BETA) return false;
				if (!greenworks) return false;
				for (let i in achievs)
				{
					greenworks.clearAchievement(achievs[i],()=>{});
				}
				grantedAchievs=[];
			}
			else if (req=='save' && args.data)
			{
				try {
					if (!fs.existsSync(path.join(__dirname,'/save'))) fs.mkdirSync(path.join(__dirname,'/save'),{recursive:true});
					fs.writeFileSync(path.join(__dirname,'/save/'+saveFile),String(args.data),'utf-8');
					send('saved',0,callback);
				}
				catch(e){send('saved',0,callback);}
			}
			else if (req=='backup')
			{
				try {
					if (fs.existsSync(path.join(__dirname,'/save/'+saveFile))) fs.copyFileSync(path.join(__dirname,'/save/'+saveFile),path.join(__dirname,'/save/OLD'+saveFile))
				}
				catch(e){}
			}
			else if (req=='load')
			{
				try {
					let fileName=saveFile;
					if (args.backup) fileName='OLD'+saveFile;
					if (!fs.existsSync(path.join(__dirname,'/save'))) fs.mkdirSync(path.join(__dirname,'/save'),{recursive:true});
					let data=fs.readFileSync(path.join(__dirname,'/save/'+fileName),'utf-8');
					send('load',data||0,callback);
				}
				catch(e){send('load',0,callback);}
			}
			else if (req=='cloud check')
			{
				if (!greenworks) return send('cloud off');
				if (greenworks.isCloudEnabledForUser())
				{
					send('cloud on');
					greenworks.getCloudQuota(
						(total,available)=>{send('cloud quota',[total,available]);},
						()=>{send('cloud off');},
					);
				}
				else send('cloud off');
			}
			else if (req=='cloud save' /*&& args.name */&& args.data)
			{
				if (!greenworks) {send('cloud save failed',0,callback);return false;}
				if (/*typeof args.name==='string' && args.name.trim().length>0 && !(/[^a-z0-9_ ]/gi).test(args.name) && */greenworks.isCloudEnabledForUser())
				{
					let doSave=()=>{
						greenworks.saveTextToFile(saveFileCloud,String(args.data),
							()=>{send('cloud on');send('cloud saved',0,callback);},
							(err)=>{send('cloud save failed',0,callback);}
						);
						getMessage(0,'cloud check');
					};
					/*if (greenworks.getFileCount()>0) greenworks.deleteFile(greenworks.getFileNameAndSize(0).name,()=>{doSave();});
					else */doSave();
				}
				else send('cloud save failed',0,callback);
			}
			else if (req=='cloud read'/* && args.name*/)
			{
				if (!greenworks) return send('cloud read',0,callback);
				if (/*typeof args.name==='string' && args.name.trim().length>0 && !(/[^a-z0-9_ ]/gi).test(args.name) && */greenworks.isCloudEnabledForUser())
				{
					greenworks.readTextFromFile(saveFileCloud,
						(data)=>{send('cloud on');send('cloud read',data||0,callback);},
						(err)=>{send('cloud read',0,callback);}
					);
				}
				else send('cloud read',0,callback);
			}
			else if (req=='cloud purge')
			{
				if (!greenworks) return false;
				/*let files=[];
				let n=greenworks.getFileCount();
				let waitForEnd=()=>
				{
					n--;
					if (n<=0)
					{
						getMessage(0,'cloud check');
						send('cloud purge ok');
					}
				}
				for (let i=0;i<n;i++)
				{
					files.push(greenworks.getFileNameAndSize(i).name);
				}
				for (let i=0;i<n;i++)
				{
					greenworks.deleteFile(files[i],waitForEnd);
				}*/
				greenworks.deleteFile(saveFileCloud,()=>{getMessage(0,'cloud check');send('cloud purge ok');});
			}
			else if (req=='url' && args.url)
			{
				args.url=args.url.replace('file://','https://');
				if (args.url.indexOf('http://')!=0 && args.url.indexOf('https://')!=0) return false;
				shell.openExternal(args.url);
			}
			else if (req=='open workshop')
			{
				if (greenworks && args.loc) greenworks.ugcShowOverlay(args.loc);
				else if (!args.loc) shell.openExternal('steam://url/SteamWorkshopPage/1454400');
			}
			else if (req=='open folder' && args.loc)
			{
				if (args.loc.indexOf('DIR')==0) {args.loc=path.join(__dirname,args.loc.replace('DIR',''));}
				shell.openPath(args.loc);
			}
			else if (req=='select folder' && args.loc)
			{
				if (args.loc.indexOf('DIR')==0) {args.loc=path.join(__dirname,args.loc.replace('DIR',''));}
				send('selected folder',dialog.showOpenDialogSync({properties:['openDirectory'],defaultPath:args.loc}),callback);
			}
			else if (req=='select mod' && args.loc)
			{
				var infoFile=args.loc+'/info.txt';
				if (!fs.existsSync(infoFile)) send('selected mod',{error:`No info.txt file found.`},callback);
				else
				{
					var info=fs.readFileSync(infoFile,'utf8');
					try{info=JSON.parse(info);}catch(e){info=0;}
					var mod={};
					if (info && info.Name && info.ID)
					{
						mod.path=args.loc;
						mod.info=info;
						mod.name=info.Name||'';
						mod.desc=info.Description||'';
						info.ID=info.ID.replace(/\W+/g,' ');
						mod.id=info.ID;
						mod.disabled=info.Disabled?true:false;
						mod.dependencies=info.Dependencies||[];
						var imgPath=args.loc+'/thumbnail.png';
						if (fs.existsSync(imgPath))
						{
							var imgSize=fs.statSync(imgPath).size/(1024*1024);
							if (imgSize<1) mod.img=imgPath;
							mod.imgSize=imgSize;
						}
						send('selected mod',mod,callback);
					}
					else send('selected mod',{error:`Invalid info.txt file.`},callback);
				}
			}
			else if (req=='publish mod')
			{
				let errorCallback=(str)=>{send('published mod',{error:str},callback);}
				
				if (!greenworks) {errorCallback(`No Steam connection.`);return false;}
				if (!args.mod) {errorCallback(`No mod selected.`);return false;}
				
				let mod=args.mod;
				let zipPath=path.join(__dirname,'/mods/'+path.basename(mod.path)+'_'+greenworks.getSteamId().steamId+'.zip');
				let cleanup=()=>{
					if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
				}
				
				console.log(`Publishing mod at ${zipPath}.`);
				
				let zip=new AdmZip();
				zip.addLocalFolder(mod.path);
				zip.writeZip(zipPath);
				
				let imgPath=mod.path+'/thumbnail.png';
				if (fs.existsSync(imgPath))
				{
					var imgSize=fs.statSync(imgPath).size/(1024*1024);
					if (imgSize>=1) imgPath=0;
				}
				else imgPath=0;
				
				if (args.update)
				{
					greenworks.ugcPublishUpdate(
						args.update,
						zipPath,
						'',
						'',
						imgPath||'',
						(out)=>{console.log('updated mod');cleanup();send('published mod',{success:true,out:out},callback);},
						(out)=>{console.log('error:',out);cleanup();send('published mod',{error:true,out:out},callback);},
						(out)=>{console.log('progress:',out);},
					);
				}
				else
				{
					greenworks.ugcPublish(
						zipPath,
						mod.name,
						mod.desc,
						imgPath||'',
						(out)=>{console.log('published mod');cleanup();send('published mod',{success:true,out:out},callback);},
						(out)=>{console.log('error:',out);cleanup();send('published mod',{error:true,out:out},callback);},
						(out)=>{console.log('progress:',out);},
					);
				}
				
				return false;
				
			}
			else if (req=='get published mods')
			{
				if (!greenworks) return false;
				greenworks.ugcGetUserItems(greenworks.UGCMatchingType.Items,greenworks.UserUGCListSortOrder.CreationOrderDesc,greenworks.UserUGCList.Published,
					(out)=>{send('published mods list',{list:out},callback);},
					(out)=>{},
				);
			}
			else if (req=='load mods')
			{
				let modDirs=['/mods/local','/mods/workshop'];
				let mods=[];
				for (var i in modDirs)
				{
					let dir=path.join(__dirname,modDirs[i]);
					if (!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true});}
					let folders=fs.readdirSync(dir,{withFileTypes:true})
					.filter(dirent=>(dirent.isDirectory() || dirent.isSymbolicLink()))
					.filter(dirent=>(dirent.name!='_zipped'))
					.map(dirent=>dirent.name);
					for (var ii in folders){
						if (fs.existsSync(dir+'/'+folders[ii]+'/info.txt'))
						{
							let mod={
								local:modDirs[i]=='/mods/local'?true:false,//note: unused - we instead decide a mod isn't local if it has a workshop id
								dir:dir+'/'+folders[ii],
								path:folders[ii],
								infoFile:dir+'/'+folders[ii]+'/info.txt',
								jsFile:fs.existsSync(dir+'/'+folders[ii]+'/main.js')?(dir+'/'+folders[ii]+'/main.js'):0,
								info:'',
							};
							mods.push(mod);
						}
					}
				}
				
				let loadedFiles=[];
				let onLoadFile=(mod,err,data)=>
				{
					loadedFiles.push(data.toString());
					if (err) console.log('error loading file:',err);
					else console.log('loaded file for mod:',mod,' - ',data);
				}
				let modIDs=[];
				for (var i in mods)
				{
					var info=fs.readFileSync(mods[i].infoFile,'utf8');
					try{info=JSON.parse(info);}catch(e){console.log('error parsing info file:',e);info=0;}
					if (info && info.Name && info.ID)
					{
						mods[i].info=info;
						info.ID=info.ID.replace(/\W+/g,' ');
						if (modIDs.indexOf(info.ID)!=-1) {console.log('mod "'+info.ID+'" already loaded');mods[i].info=0;mods[i]=0;continue;}
						modIDs.push(info.ID);
						mods[i].id=info.ID;
						mods[i].disabled=info.Disabled?true:false;
						mods[i].dependencies=info.Dependencies||[];
						mods[i].workshop=info.Workshop||false;
					}
					else mods[i].info=0;
				}
				
				mods=mods.filter(Boolean);//remove empty
				
				send('mods loaded',mods,callback);
			}
			else if (req=='sync mods')
			{
				if (!greenworks) {send('mods synced','failed to sync mods.',callback);return false;}
				console.log(`Synchronizing mods...`);
				let zippedFolder=path.join(__dirname,'/mods/workshop/_zipped');
				let outFolder=path.join(__dirname,'/mods/workshop');
				
				if (!fs.existsSync(zippedFolder)) fs.mkdirSync(zippedFolder,{recursive:true});
				
				greenworks.ugcSynchronizeItems(zippedFolder,(mods)=>{
					let modsUpdated=[];
					for (let i=0;i<mods.length;i++)
					{
						let mod=mods[i];
						if (!mod.isUpdated) continue;
						try{
							let zipPath=zippedFolder+'/'+mod.fileName;
							let newPath=outFolder+'/'+mod.fileName.substr(0,mod.fileName.lastIndexOf('_')).replace(/\.\/\\/g,'');
							if (!fs.existsSync(newPath)) fs.mkdirSync(newPath,{recursive:true});
							
							let zip=new AdmZip(zipPath);
							zip.extractAllTo(newPath,true);
							
							if (fs.existsSync(newPath+'/info.txt'))
							{
								let info=fs.readFileSync(newPath+'/info.txt','utf8');
								try{info=JSON.parse(info);}catch(e){console.log('error parsing info file:',e);info=0;}
								if (info)
								{
									info.Workshop=mod.publishedFileId;
									fs.writeFileSync(newPath+'/info.txt',JSON.stringify(info,null,' '),'utf8');
								}
							}
							console.log(`Extracted mod "${mod.title}".`);
							modsUpdated.push(mod);
						}catch(e){
							console.log(`Failed to extract mod "${mod.title}".`,e);
						}
					}
					console.log(`Synchronized!`);
					send('mods synced',modsUpdated,callback);
					
				},(err)=>{console.log(`Failed to sync mods.`,err);send('mods synced','failed to sync mods.',callback);});
			}
			else if (req=='unsubscribe workshop' && args.loc)
			{
				if (!greenworks) return false;
				
				greenworks.ugcUnsubscribe(args.loc,()=>{
					if (args.dir && fs.existsSync(args.dir) && path.relative(args.dir,path.join(__dirname,'/mods/workshop'))=='..')
					{
						//remove mod folder and matching zip file
						let archives=fs.readdirSync(path.join(__dirname,'/mods/workshop/_zipped'),{withFileTypes:true})
						.filter(dirent=>(path.extname(dirent.name)=='.zip'))
						.map(dirent=>dirent.name);
						for (var i in archives){
							if (path.basename(args.dir)===archives[i].substr(0,archives[i].lastIndexOf('_'))) fs.unlinkSync(path.join(__dirname,'/mods/workshop/_zipped/'+archives[i]));
						}
						fs.rmdirSync(args.dir,{recursive:true});
					}
					send('unsubscribed workshop',true,callback);
				},()=>{send('unsubscribed workshop',false,callback);});
			}
			else if (req=='get server image' && args.handle)
			{
				//missing: sadly, greenworks does not implement GetQueryUGCPreviewURL
				if (!greenworks) return false;
				return false;
			}
			else if (req=='fullscreen')
			{
				win.setFullScreen(args.on?true:false);
			}
			else if (req=='log to file' && args.list)
			{
				/*
					allows updating text files in the folder /file_outputs with arbitrary game data
					mainly intended for use with streaming setups, ie. OBS's 'read from file' text source
					each file will hold its own value, ie. "['cookies',Beautify(Game.cookies)]" will create and update a file named cookies.txt populated with your current amount of cookies
					
					example use in /steam/steam.js:
					if (T%Game.fps==Game.fps-1)//every second
					{
						send({id:'log to file',list:[
							['cookies',Beautify(Game.cookies)],
							['cps',Beautify(Game.cookiesPs,1)],
							['heavenlychips',Beautify(Game.heavenlyChips)],
						]});
					}
				*/
				let file_outputs=path.join(__dirname,'/file_outputs');
				if (!fs.existsSync(file_outputs)) fs.mkdirSync(file_outputs,{recursive:true});
				
				for (let i=0;i<args.list.length;i++)
				{
					let item=args.list[i];
					let fileName=String(item[0]).replace(/[^0-9A-Z ]+/gi,'');
					let content=String(item[1]);
					fs.writeFileSync(path.join(__dirname,'/file_outputs/'+fileName+'.txt'),content,'utf-8');
				}
			}
			else if (req=='update presence' && args.arr)
			{
				if (discordClient) updateDiscordPresence(args.arr);
				if (greenworks) greenworks.setRichPresence('gamestatus',args.arr[0]);
			}
			else if (req=='toggle presence')
			{
				if (!args.val)
				{
					if (discordClient) discordClient.disconnect();
					discordClient=0;
				}
				else
				{
					/*
						note: disabled in march 2023.
						the discord-rich-presence module ultimately depends on register-scheme which is causing us problems on build.
						try re-adding "discord-rich-presence": "^0.0.8" to package.json's dependencies later; if doing so, also uncomment the relevant pref button in steam.js.
					*/
					//if (!discordClient) discordClient=require('discord-rich-presence')('894730407050870835');
				}
			}
			else if (req=='ai_tick')
			{
				// Recebe estado do jogo enviado pelo mod a cada ~500ms
				if (args && args.data) {
					_state = args.data;
					_stateLog.push(_state);
					if (_stateLog.length > 60) _stateLog.shift();
				}
				if (args && args.results) _controlQueue.acknowledge(args.results);
				const nextAction = _controlQueue.next();
				send('ai_action', nextAction, callback);
			}
		}catch(e){
			send('electron error','['+req+'] - '+e.toString());
			console.log('electron error:',e);
		}
	}
	
	win.on('close',(e)=>{
		quit=true;
		e.preventDefault();
		if (win) win.destroy();
		if (win) win=null;
	});
	
	let splashDur=DEV?0:2.5;
	
	ipcMain.on('toMain',(e,args)=>{
		if(!win || !SECURITY.trustedSender(e,win.webContents,gameFile,gameFrame))return;
		getMessage(e,args);
	});
	
	if (!DEV) win.setMenu(null);
	win.setBackgroundColor('#111111');
	//these commands are to both fix the Steam overlay being white when starting in non-fullscreen, and to prevent a white flash on startup
	win.unmaximize();
	if (!TEST_MODE) win.show();
	win.loadFile(path.join(__dirname,'/splash.html'));
	setTimeout(()=>{
		if (!TEST_MODE) win.maximize();
		win.loadFile(path.join(__dirname,'/src/index.html'),{query:{bridgePort:String(API_PORT),...(BETA?{beta:'1'}:{})}});
		if (process.env.COOKIE_BRIDGE_DEVTOOLS === '1' && !TEST_MODE) win.webContents.openDevTools();
	},1000*splashDur);
}

app.whenReady().then(launch);



app.on('activate',()=>{
	if (BrowserWindow.getAllWindows().length===0) {launch();}
});

app.on('window-all-closed',()=>{
	quit=true;
	if (process.platform!=='darwin') app.quit();
});
