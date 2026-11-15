// Preload das abas do PokeIdle: roda antes do jogo e injeta a extensão /hunt,
// do mesmo jeito que o navegador faria (scripts "MAIN" no mundo da página).
const { ipcRenderer, webFrame } = require('electron');

if (location.hostname === 'pokeidle.io') {
  // guarda o socket do jogo (só a referência) pro avaliador pedir a Tabela de preços
  webFrame.executeJavaScript(`(() => {
    if (window.__plWsHook) return; window.__plWsHook = true;
    const Orig = window.WebSocket;
    function WS(...a) { const ws = new Orig(...a); try { if (new URL(String(a[0]), location.href).host === location.host) window.__plWs = ws; } catch {} return ws; }
    WS.prototype = Orig.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) WS[k] = Orig[k];
    window.WebSocket = WS;
  })()`).catch(() => {});
  // Avaliador: guarda os anúncios de Pokémon que chegam pelo socket e põe um botão "Avaliar" nos cards
  webFrame.executeJavaScript(`(${mercadoAvaliar.toString()})()`).catch(() => {});
  window.addEventListener('message', (ev) => {
    if (ev.source === window && ev.data && ev.data.__plAvaliar) ipcRenderer.sendToHost('avaliar', ev.data.__plAvaliar);
  });
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

// roda no mundo da página (texto injetado acima)
function mercadoAvaliar() {
  if (window.__plMercado) return; window.__plMercado = true;
  const anuncios = new Map(); // id -> anúncio de Pokémon visto agora
  const guardar = (o, d = 0) => {
    if (!o || typeof o !== 'object' || d > 5) return;
    if (Array.isArray(o)) { for (const x of o) guardar(x, d + 1); return; }
    if (o.tipo === 'pokemon' && o.ficha && o.preco != null && o.id != null) { anuncios.set(o.id, o); return; }
    for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') guardar(o[k], d + 1);
  };
  const ouvir = (ws) => ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string' || !ev.data.includes('"market"') || !ev.data.includes('"ficha"')) return;
    try { const m = JSON.parse(ev.data); if (m.t === 'market') guardar(m); } catch { /* */ }
  });
  const esperarWs = setInterval(() => { if (window.__plWs) { ouvir(window.__plWs); clearInterval(esperarWs); } }, 500);
  const normal = (s) => String(s || '').toLowerCase().trim();
  const acharAnuncio = (card) => {
    const vend = normal(card.querySelector('.cm-vend b')?.textContent);
    const nome = normal(card.querySelector('.cm-nome-txt')?.textContent);
    const txt = card.innerText || '';
    const lista = [...anuncios.values()].filter(a => normal(a.vendedor) === vend);
    const porNome = lista.filter(a => [a.ficha.apelido, a.ficha.nome, a.ficha.name].some(x => normal(x) === nome));
    const cand = porNome.length ? porNome : lista;
    return cand.find(a => txt.includes('Nv ' + a.ficha.level) || txt.includes('Nv' + a.ficha.level)) || cand[0] || null;
  };
  const botao = (card) => {
    if (card.querySelector('.pl-avaliar') || !card.querySelector('.cm-vend')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pl-avaliar'; b.textContent = 'Avaliar';
    b.title = 'Poke Lives: diz se o preço vale pela força e pelas vendas parecidas';
    b.style.cssText = 'position:absolute;top:6px;left:6px;z-index:5;font:600 11px system-ui;padding:3px 8px;border-radius:7px;border:1px solid #7c3aed;background:#7c3aedd9;color:#fff;cursor:pointer';
    b.onclick = (e) => {
      e.stopPropagation(); e.preventDefault();
      const a = acharAnuncio(card);
      if (!a) { b.textContent = 'Recarregue a lista'; setTimeout(() => { b.textContent = 'Avaliar'; }, 2500); return; }
      window.postMessage({ __plAvaliar: { id: a.id, ficha: a.ficha, preco: a.preco, moeda: a.moeda, vendedor: a.vendedor, nome: card.querySelector('.cm-nome-txt')?.textContent || '' } }, '*');
    };
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    card.appendChild(b);
  };
  // observa o documento (que não é trocado), e não o <html> do início, que o carregamento da página substitui
  let agendado = false;
  new MutationObserver(() => {
    if (agendado) return; agendado = true;
    setTimeout(() => { agendado = false; for (const c of document.querySelectorAll('.cm-card.poke')) botao(c); }, 150);
  }).observe(document, { childList: true, subtree: true });
}
