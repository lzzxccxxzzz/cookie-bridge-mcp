'use strict';
const path = require('path');
const fs = require('fs');
// Preserve the game's own Steam bridge. Installer does not edit preload.js.
const installed = path.resolve(__dirname, '../../../preload.js');
require(fs.existsSync(installed) ? installed : path.resolve(__dirname, '../preload.js'));
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('cookieBridgeConnection', {
  connect: () => ipcRenderer.invoke('cookie-bridge-connect'),
});
