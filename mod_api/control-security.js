'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {fileURLToPath} = require('url');

function error(status, message) { return Object.assign(new Error(message), {status}); }
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function loadToken(directory) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const filename = path.join(directory, 'access-token');
  try { fs.writeFileSync(filename, crypto.randomBytes(32).toString('hex') + '\n', {flag: 'wx', mode: 0o600}); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (!fs.lstatSync(filename).isFile()) throw error(500, 'Access-token must be a regular file.');
  const token = fs.readFileSync(filename, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw error(500, 'Invalid access-token file; refusing to start without authentication.');
  return token;
}
function createSecurity({port, directory, clientToken, now = Date.now}) {
  const client = clientToken || loadToken(directory);
  const renderer = crypto.randomBytes(32).toString('hex');
  const sessions = new Map(), cookieName = 'cookie_bridge_' + port;
  const htmlPaths = new Set(['/docs', '/docs/pt', '/charts', '/saves']);
  const rendererPaths = new Set(['POST /state', 'GET /action/next', 'POST /action/results']);
  function authenticate(req) {
    const auth = req.headers.authorization || '';
    if (equal(auth, 'Bearer ' + renderer)) return 'renderer';
    if (equal(auth, 'Bearer ' + client)) return 'client';
    // An invalid Authorization header must not silently fall back to a cookie.
    if (auth) return null;
    const match = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='));
    const id = match && match.slice(cookieName.length + 1), expires = sessions.get(id);
    if (expires && expires > now()) return 'session';
    if (id) sessions.delete(id);
    return null;
  }
  function guard(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    const host = req.headers.host;
    if (![port === 80 ? '127.0.0.1' : `127.0.0.1:${port}`, port === 80 ? 'localhost' : `localhost:${port}`].includes(host)) throw error(403, 'Invalid Host.');
    if (!req.url.startsWith('/') || req.url.startsWith('//')) throw error(400, 'Invalid request target.');
    const origin = req.headers.origin, sameOrigin = 'http://' + host, role = authenticate(req);
    if (origin && origin !== sameOrigin && origin !== 'null') throw error(403, 'Origin is not allowed.');
    if (req.headers['sec-fetch-site'] === 'cross-site' && origin !== 'null' && role !== 'renderer') throw error(403, 'Cross-site requests are not allowed.');
    if (req.method === 'OPTIONS') {
      if (!origin) throw error(403, 'Origin required.');
      const method = req.headers['access-control-request-method'];
      if (!['GET', 'POST', 'DELETE'].includes(method)) throw error(405, 'Method is not allowed.');
      const headers = (req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
      if (headers.some(x => !['authorization', 'content-type'].includes(x))) throw error(403, 'Header is not allowed.');
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.writeHead(204);res.end();return {handled: true};
    }
    const pathname = new URL(req.url, sameOrigin).pathname;
    if (['POST', 'DELETE'].includes(req.method) && (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw error(415, 'application/json is required.');
    // Only our IPC-bootstrapped renderer may use file-origin requests.
    if (origin === 'null' && role !== 'renderer') throw error(403, 'File-origin requests require renderer authentication.');
    if (role === 'session' && !['GET', 'HEAD'].includes(req.method) && origin !== sameOrigin) throw error(403, 'Same-origin confirmation required.');
    if (role === 'renderer' && origin === 'null') {res.setHeader('Access-Control-Allow-Origin', 'null');res.setHeader('Vary', 'Origin');}
    if (pathname === '/auth/login' && req.method === 'POST') {
      if (origin !== sameOrigin) throw error(403, 'Login must originate from this dashboard.');
      return {role, pathname, login: true};
    }
    if (req.method === 'GET' && htmlPaths.has(pathname) && !role) return {pathname, loginPage: true};
    if (!role) throw error(401, 'Authentication required. Use the local access-token file.');
    const route = req.method + ' ' + pathname;
    if (rendererPaths.has(route) && role !== 'renderer') throw error(403, 'Renderer-only endpoint.');
    if (role === 'renderer' && !rendererPaths.has(route) && !['GET /', 'GET /state', 'GET /action/queue', 'GET /capabilities'].includes(route)) throw error(403, 'Endpoint is not available to the renderer.');
    return {role, pathname};
  }
  function login(token, res) {
    if (!equal(token, client)) throw error(401, 'Invalid access token.');
    for (const [id, expires] of sessions) if (expires <= now()) sessions.delete(id);
    while (sessions.size >= 16) sessions.delete(sessions.keys().next().value);
    const id = crypto.randomBytes(32).toString('hex');sessions.set(id, now() + 3600000);
    res.setHeader('Set-Cookie', `${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
    return {ok: true};
  }
  function logout(req, res) {
    const match = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='));
    if (match) sessions.delete(match.slice(cookieName.length+1));
    res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return {ok:true};
  }
  return {guard, login, logout, rendererToken: renderer};
}
function resolveAsset(root, name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*\.(png|jpe?g|gif|webp|mp3|ogg)$/i.test(name) || name.includes('..')) throw error(400, 'Invalid resource name.');
  let realRoot, filename;
  try {realRoot = fs.realpathSync(root);filename = fs.realpathSync(path.join(realRoot, name));}
  catch (_) {throw error(404, 'Resource not found.');}
  const relative = path.relative(realRoot, filename);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || !fs.statSync(filename).isFile()) throw error(403, 'Resource is outside the image directory.');
  return filename;
}
function trustedGameURL(url, gameFile) {
  try {const u = new URL(url);return u.protocol === 'file:' && path.resolve(fileURLToPath(u)) === path.resolve(gameFile);}
  catch (_) {return false;}
}
function trustedSender(event, contents, gameFile, legacyFrame) {
  if (!event || !contents || event.sender !== contents) return false;
  if (event.senderFrame && contents.mainFrame) return event.senderFrame === contents.mainFrame && trustedGameURL(event.senderFrame.url, gameFile);
  // Older bundled Electron exposes numeric IDs instead of WebFrameMain. The
  // frame record must come from native main-frame navigation events, never IPC.
  return !!(legacyFrame && Number.isInteger(legacyFrame.frameId) && legacyFrame.frameId > 0 && Number.isInteger(legacyFrame.processId) && legacyFrame.processId > 0 && event.frameId === legacyFrame.frameId && event.processId === legacyFrame.processId && trustedGameURL(legacyFrame.url, gameFile) && trustedGameURL(contents.getURL(), gameFile));
}
function escapeHTML(value) {return String(value == null ? '' : value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const loginPage = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Cookie Bridge — sign in</title><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;max-width:560px;margin:10vh auto;padding:24px"><h1>Cookie Bridge — sign in</h1><p>Paste the token from your local CookieBridge/access-token file. Do not share or commit it.</p><form id="login"><label>Access token <input id="token" type="password" autocomplete="off" required minlength="64" maxlength="64"></label><button>Sign in</button></form><p id="status" role="status"></p><script>document.getElementById('login').addEventListener('submit',async function(e){e.preventDefault();var input=document.getElementById('token');var token=input.value;input.value='';try{var r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token})});document.getElementById('status').textContent=r.ok?'Signed in.':'Invalid token.';if(r.ok)location.reload();}catch(e){document.getElementById('status').textContent='Connection failed.';}});</script></body></html>`;
module.exports = {createSecurity, loadToken, resolveAsset, trustedGameURL, trustedSender, escapeHTML, loginPage};
