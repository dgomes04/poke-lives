// Preload das abas do PokeIdle: roda antes do jogo e injeta a extensão /hunt,
// do mesmo jeito que o navegador faria (scripts "MAIN" no mundo da página).
const { ipcRenderer, webFrame } = require('electron');

if (location.hostname === 'pokeidle.io') {
  const ext = ipcRenderer.sendSync('hunt:ext-code');
  if (ext && !ext.error) {
    // mundo da página, antes do jogo abrir o WebSocket (a extensão escuta ele)
    webFrame.executeJavaScript(ext.main).catch((e) => console.error('[poke-lives] /hunt', e));
    // scripts do "mundo isolado" (ex.: a ponte da Shiny WishList) rodam aqui mesmo
    if (ext.isolated) {
      window.addEventListener('DOMContentLoaded', () => {
        try { new Function(ext.isolated)(); } catch (e) { console.error('[poke-lives] /hunt ponte', e); }
      });
    }
  }
}
