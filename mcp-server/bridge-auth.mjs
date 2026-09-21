import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function localBridgeURL(value) {
  const u = new URL(value);
  if (u.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('Cookie Bridge URL must be a loopback HTTP origin without credentials or a path.');
  return u.origin;
}
export function accessToken() {
  const filename = process.env.COOKIE_BRIDGE_TOKEN_FILE || path.join(os.homedir(), 'CookieBridge', 'access-token');
  let token = process.env.COOKIE_BRIDGE_TOKEN;
  if (!token) {
    try {token = fs.readFileSync(filename, 'utf8').trim();}
    catch (_) {throw new Error('Cookie Bridge access-token is unavailable. Start the updated game or set COOKIE_BRIDGE_TOKEN_FILE.');}
  }
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid Cookie Bridge access-token format.');
  return token;
}
export function authHeaders(extra = {}) {return {...extra, Authorization: 'Bearer ' + accessToken()};}
