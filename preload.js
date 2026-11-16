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
  votoJanela: (conta, url, nome) => ipcRenderer.invoke('voto:janela', { conta, url, nome }),
  avaliar: (anuncio) => ipcRenderer.invoke('avaliador:abrir', anuncio),
  avaliadorEspecie: (q) => ipcRenderer.invoke('avaliador:especie', q),
  snipeEspecies: () => ipcRenderer.invoke('snipe:especies'),
  snipeItens: () => ipcRenderer.invoke('snipe:itens'),
  precificador: (p) => ipcRenderer.invoke('precificador:abrir', p),
  login:(platform, partition) => ipcRenderer.invoke('login', { platform, partition }),
});
