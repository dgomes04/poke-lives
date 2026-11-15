// Ponte da janela do Avaliador com o app (só o que ela precisa).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('av', {
  especie: (q) => ipcRenderer.invoke('avaliador:especie', q),
  calcular: (pedido) => ipcRenderer.invoke('avaliador:calcular', pedido),
  pendente: () => ipcRenderer.invoke('avaliador:pendente'),
  precificador: (p) => ipcRenderer.invoke('precificador:abrir', p),
  aoReceberAnuncio: (fn) => ipcRenderer.on('avaliador:anuncio', (_e, a) => fn(a)),
});
