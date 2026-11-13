const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  check: (list) => ipcRenderer.invoke('check', list),
  huntExtInfo: () => ipcRenderer.invoke('hunt:ext-info'),
  paths: () => ipcRenderer.invoke('paths'),
  metrics: () => ipcRenderer.invoke('metrics'),
  logins: (partition) => ipcRenderer.invoke('logins', partition),
  fullscreen: (on) => ipcRenderer.invoke('fullscreen', on),
  snipeOpen: (partition, name) => ipcRenderer.invoke('snipe:open', { partition, name }),
  snipeDisable: (partition) => ipcRenderer.invoke('snipe:disable', partition),
  phoneSet: (cfg) => ipcRenderer.invoke('phone:set', cfg),
  phoneInfo: () => ipcRenderer.invoke('phone:info'),
  comparar: (conta) => ipcRenderer.invoke('comparador:abrir', conta),
  bravePerfis: () => ipcRenderer.invoke('brave:perfis'),
  braveVotar: (perfil, url) => ipcRenderer.invoke('brave:votar', { perfil, url }),
  login:(platform, partition) => ipcRenderer.invoke('login', { platform, partition }),
});
