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
  // janelinha flutuante do jogo: o PiP de documento só é permitido na janela principal do navegador.
  // Dentro da aba do app o Chromium mata a página (e às vezes o app inteiro). Sem ele, o jogo usa
  // a janelinha dentro da página, ou o PiP de vídeo no modo economia, que funcionam.
  webFrame.executeJavaScript(`(() => {
    try { delete Window.prototype.documentPictureInPicture; } catch {}
    try { delete window.documentPictureInPicture; } catch {}
  })()`).catch(() => {});
  // Avaliador: guarda os anúncios de Pokémon que chegam pelo socket e põe um botão "Avaliar" nos cards
  webFrame.executeJavaScript(`(${mercadoAvaliar.toString()})()`).catch(() => {});
  // Snipe próprio: só escuta o socket (relógio do servidor, respostas do Mercado). Nada roda até o app pedir.
  webFrame.executeJavaScript(`(${snipeMotor.toString()})()`).catch(() => {});
  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || !ev.data) return;
    if (ev.data.__plAvaliar) ipcRenderer.sendToHost('avaliar', ev.data.__plAvaliar);
    // a página pede dados ao app: espécie (bases, tipos, golpes) ou o câmbio do dólar
    const p = ev.data.__plPedido;
    if (p && p.id) {
      let valor = null;
      try {
        if (p.tipo === 'esp') valor = await ipcRenderer.invoke('avaliador:especie', Number(p.arg));
        else if (p.tipo === 'cambio') valor = await ipcRenderer.invoke('cambio:usdbrl');
      } catch { valor = null; }
      window.postMessage({ __plResposta: { id: p.id, valor } }, '*');
    }
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
// Mercado: cada anúncio de Pokémon ganha um selo com o preço de mercado (vendas parecidas dos últimos 30 dias,
// pelas fórmulas do próprio jogo). Clicar no selo abre o Avaliador. Só leitura: nada é comprado.
function mercadoAvaliar() {
  if (window.__plMercado) return; window.__plMercado = true;
  const anuncios = new Map(); // id -> anúncio de Pokémon visto agora
  const guardar = (o, d = 0) => {
    if (!o || typeof o !== 'object' || d > 5) return;
    if (Array.isArray(o)) { for (const x of o) guardar(x, d + 1); return; }
    if (o.tipo === 'pokemon' && o.ficha && o.preco != null && o.id != null) { anuncios.set(String(o.id), o); return; }
    for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') guardar(o[k], d + 1);
  };
  const ouvir = (ws) => ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string' || !ev.data.includes('"market"') || !ev.data.includes('"ficha"')) return;
    try { const m = JSON.parse(ev.data); if (m.t === 'market' && m.aba !== 'historicoGlobal') guardar(m); } catch { /* */ }
  });
  const esperarWs = setInterval(() => { if (window.__plWs) { ouvir(window.__plWs); clearInterval(esperarWs); } }, 500);

  // ---- pedidos ao app (espécie, câmbio) ----
  let seqPed = 0;
  const pedirApp = (tipo, arg) => new Promise((resolve) => {
    const id = 'p' + (++seqPed) + '-' + Math.random();
    const fim = setTimeout(() => { window.removeEventListener('message', ouv); resolve(null); }, 8000);
    function ouv(ev) { const r = ev.data && ev.data.__plResposta; if (r && r.id === id) { clearTimeout(fim); window.removeEventListener('message', ouv); resolve(r.valor); } }
    window.addEventListener('message', ouv);
    window.postMessage({ __plPedido: { id, tipo, arg } }, '*');
  });

  // ---- motor (módulos públicos do jogo) ----
  let mods = null;
  const modulos = async () => {
    if (mods) return mods;
    const ver = (document.querySelector('script[src*="app.js"]')?.src.match(/v=([\w.]+)/) || [])[1] || '';
    const q = ver ? '?v=' + ver : '';
    mods = { N: await import('/shared/nota-pokemon.mjs' + q), G: await import('/shared/ginasios.mjs' + q) };
    return mods;
  };
  const espCache = new Map();
  const especie = async (id) => {
    if (espCache.has(id)) return espCache.get(id);
    const e = await pedirApp('esp', id);
    const esp = e ? { pokeId: e.id, name: e.n, type1: e.t?.[0] || null, type2: e.t?.[1] || null,
      baseHp: e.b[0], baseAtk: e.b[1], baseDef: e.b[2], baseSpAtk: e.b[3], baseSpDef: e.b[4], baseSpeed: e.b[5],
      attacks: (e.m || []).map(m => ({ name: m[0], type: m[1], category: m[2] === 1 ? 'SPECIAL' : 'PHYSICAL', power: m[3], cooldownMs: m[4], learnLevel: m[5] ?? 1 })) } : null;
    espCache.set(id, esp);
    return esp;
  };
  const medir = (pk, esp) => ({ nota: mods.N.notaDePokemon(pk, esp), pve: mods.G.poderNoNivel(pk, esp, Math.max(1, Number(pk.level) || 1)) });

  // Tabela de preços da espécie. O servidor tem anti-flood ("Devagar"), então:
  // um pedido por vez, com intervalo mínimo; cache de 30 min; na maioria das espécies basta 1 página;
  // e, se o servidor reclamar, para tudo por um tempo (que dobra se ele reclamar de novo).
  const VENDAS_TTL = 30 * 60e3, RITMO_MS = 1500, VENDAS_ALVO = 30, MAX_PAGINAS = 3;
  const vendasCache = new Map();
  let filaWs = Promise.resolve(), ultimoEnvio = 0, pausaAte = 0, pausaMs = 20e3;
  const dormir = (ms) => new Promise(r => setTimeout(r, ms));
  const ehDevagar = (x) => x && x.t === 'erro' && /devagar|flood|muitas|r[aá]pido|aguarde/i.test(String(x.msg || x.erro || ''));
  // ouve o socket inteiro: se o servidor mandar "Devagar" (mesmo por pedido do próprio jogo), pausa
  const ouvirDevagar = (ws) => ws.addEventListener('message', (ev) => {
    if (typeof ev.data !== 'string' || !ev.data.includes('"erro"')) return;
    let x; try { x = JSON.parse(ev.data); } catch { return; }
    if (!ehDevagar(x)) return;
    const agora = Date.now();
    pausaMs = pausaAte > agora - 60e3 ? Math.min(pausaMs * 2, 120e3) : 20e3; // reclamou de novo logo depois: dobra
    pausaAte = agora + pausaMs;
  });
  let wsDevagar = null;
  setInterval(() => { const ws = window.__plWs; if (ws && ws !== wsDevagar) { wsDevagar = ws; ouvirDevagar(ws); } }, 500);
  const pagina = (ws, esp, pg) => new Promise((resolve) => {
    const seq = 900000 + Math.floor(Math.random() * 90000);
    const fim = setTimeout(() => { ws.removeEventListener('message', o); resolve(null); }, 8000);
    function o(ev) {
      if (typeof ev.data !== 'string' || (!ev.data.includes('historicoGlobal') && !ev.data.includes('"erro"'))) return;
      let x; try { x = JSON.parse(ev.data); } catch { return; }
      if (ehDevagar(x)) { clearTimeout(fim); ws.removeEventListener('message', o); resolve({ devagar: true }); return; }
      if (x.t !== 'market' || x.aba !== 'historicoGlobal' || (x.seq != null && x.seq !== seq)) return;
      clearTimeout(fim); ws.removeEventListener('message', o); resolve(x);
    }
    ws.addEventListener('message', o);
    ultimoEnvio = Date.now();
    ws.send(JSON.stringify({ t: 'market.historicoGlobal', pagina: pg, seq, tipo: 'pokemon', busca: esp.name }));
  });
  // espera a vez: respeita o intervalo mínimo e a pausa do anti-flood
  const aguardarVez = async () => {
    for (;;) {
      const espera = Math.max(pausaAte - Date.now(), ultimoEnvio + RITMO_MS - Date.now());
      if (espera <= 0) return;
      await dormir(Math.min(espera, 2000));
    }
  };
  // ainda(): se devolver false quando chegar a vez (o card saiu da tela), não pede nada
  const historico = (esp, ainda) => {
    const quer = ainda || (() => true);
    const c = vendasCache.get(esp.pokeId);
    if (c && c.pendente) { c.quer.push(quer); return c.p; }
    if (c && Date.now() - c.em < VENDAS_TTL) return c.p;
    const ent = { em: Date.now(), pendente: true, quer: [quer] };
    ent.p = (filaWs = filaWs.then(async () => {
      if (!ent.quer.some(f => f())) { vendasCache.delete(esp.pokeId); return null; } // ninguém mais precisa (cards saíram da tela)
      const linhas = [];
      let completo = true;
      for (let pg = 0; pg < MAX_PAGINAS; pg++) {
        await aguardarVez();
        const ws = window.__plWs;
        if (!ws || ws.readyState !== 1) { completo = false; break; }
        const m = await pagina(ws, esp, pg);
        if (!m || m.devagar) { completo = false; break; }
        for (const l of m.linhas || []) if (l.tipo === 'pokemon' && l.ficha && Number(l.ficha.speciesId) === esp.pokeId) linhas.push(l);
        if (!m.temMais || linhas.length >= VENDAS_ALVO) break;
      }
      ent.pendente = false; ent.em = Date.now();
      // incompleto (servidor reclamou, socket caiu): guarda o que veio só por 2 min, pra tentar de novo depois
      if (!completo) { ent.em = Date.now() - VENDAS_TTL + 2 * 60e3; if (!linhas.length) { vendasCache.delete(esp.pokeId); return null; } }
      return linhas;
    }).catch(() => { vendasCache.delete(esp.pokeId); return null; }));
    vendasCache.set(esp.pokeId, ent);
    return ent.p;
  };
  const OURO_POR_GEMA = 4.6e6;
  const quantil = (vals, q) => {
    if (!vals.length) return null;
    const s = [...vals].sort((a, b) => a.v - b.v), tot = s.reduce((t, x) => t + x.w, 0);
    let acc = 0;
    for (const x of s) { acc += x.w; if (acc >= q * tot) return x.v; }
    return s[s.length - 1].v;
  };
  // mesma conta do Avaliador: nota parecida, mesma potência, nível parecido, ajustado pela força
  async function precoDeMercado(a, ainda) {
    await modulos();
    const esp = await especie(Number(a.ficha.speciesId));
    if (!esp) return null;
    const alvo = medir(a.ficha, esp);
    const linhas = await historico(esp, ainda);
    if (!linhas) return null;
    const moeda = a.moeda === 'gold' ? 'gold' : 'orb';
    const w = [];
    for (const l of linhas) {
      const f = l.ficha;
      if (!!f.shiny !== !!a.ficha.shiny) continue;
      const v = medir(f, esp);
      const dn = alvo.nota != null && v.nota != null ? Math.abs(v.nota - alvo.nota) : 1;
      const dNivel = Math.abs(Math.log(Math.max(1, a.ficha.level) / Math.max(1, f.level)));
      const razao = v.pve > 0 ? Math.min(3, Math.max(1 / 3, alvo.pve / v.pve)) : 1;
      const preco = l.moeda === moeda ? Number(l.bruto) : moeda === 'orb' ? Number(l.bruto) / OURO_POR_GEMA : Number(l.bruto) * OURO_POR_GEMA;
      const peso = Math.exp(-dn / 0.6) * Math.exp(-dNivel / 0.5) * (f.potencia === a.ficha.potencia ? 1 : 0.35) * (l.moeda === moeda ? 1 : 0.5);
      if (peso > 0.05) w.push({ v: preco * razao, w: peso });
    }
    if (!w.length) return { semVendas: true };
    return { justo: quantil(w, 0.5), baixo: quantil(w, 0.25), alto: quantil(w, 0.75), n: w.length };
  }
  // o snipe usa as mesmas contas (preço de mercado, nota, Tabela de preços)
  window.__plAval = {
    modulos, especie, medir, precoDeMercado, historico,
    historicoPronto: (id) => { const c = vendasCache.get(Number(id)); return !!(c && !c.pendente && Date.now() - c.em < VENDAS_TTL); },
  };

  // ---- selo no card ----
  const cssSelo = 'display:block;margin-top:5px;padding:4px 7px;border-radius:7px;font:500 10.5px/1.35 system-ui;cursor:pointer;text-align:left;width:100%;box-sizing:border-box;background:#2a1d33cc;color:#f3e8ff;';
  const fmt = (v, moeda) => {
    if (v == null) return '—';
    if (moeda === 'gold') return v >= 1e9 ? (v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' bi' : v >= 1e6 ? (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : Math.round(v).toLocaleString('pt-BR');
    return Math.round(v).toLocaleString('pt-BR');
  };
  let brl = null;
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
  const resultados = new Map(); // id do anúncio -> promessa do preço
  async function pintarSelo(card, el, tentativa = 0, espera = 0) {
    const a = acharAnuncio(card);
    if (!a) { // o pacote do anúncio ainda não chegou: tenta de novo
      el.textContent = 'Avaliar';
      if (tentativa < 5) setTimeout(() => pintarSelo(card, el, tentativa + 1), 800);
      return;
    }
    el.dataset.anuncio = String(a.id);
    el.textContent = 'calculando preço…';
    if (brl == null) brl = (await pedirApp('cambio')) || 5.4;
    const chave = String(a.id);
    if (!resultados.has(chave)) {
      const p = precoDeMercado(a, () => el.isConnected).catch(() => null);
      resultados.set(chave, p);
      p.then(r => { if (r == null) resultados.delete(chave); }); // não calculou (saiu da tela, servidor pediu calma): tenta de novo quando voltar
    }
    const r = await resultados.get(chave);
    if (!el.isConnected) return;
    if (r == null && espera < 3) { // não deu agora (servidor pediu calma, jogo reconectando): tenta de novo depois
      const calma = Date.now() < pausaAte;
      el.style.cssText = cssSelo + 'border:1px dashed #6b5a80;';
      el.innerHTML = `<b>preço em espera</b><br><span style="opacity:.75">${calma ? 'o servidor pediu calma; tento de novo já já' : 'tento de novo em instantes'}</span>`;
      setTimeout(() => { if (el.isConnected) pintarSelo(card, el, 5, espera + 1); }, Math.max(pausaAte - Date.now(), 5000) + 500);
      return;
    }
    const moeda = a.moeda === 'gold' ? 'gold' : 'orb';
    const usd = moeda === 'orb' ? a.preco * 0.01 : (a.preco / OURO_POR_GEMA) * 0.01;
    const d2 = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dinheiro = `US$ ${d2(usd)} · R$ ${d2(usd * brl)}`;
    if (!r || r.semVendas || !r.justo) {
      el.style.cssText = cssSelo + 'border:1px dashed #6b5a80;';
      el.innerHTML = `<b>sem vendas parecidas</b><br><span style="opacity:.75">clique para avaliar</span><br><span style="opacity:.75">${dinheiro}</span>`;
      return;
    }
    const pct = Math.round((a.preco / r.justo - 1) * 100);
    const sinal = pct > 0 ? '+' : '';
    const [rot, cor] = a.preco < r.baixo ? ['abaixo do mercado', '#4ade80'] : a.preco > r.alto ? ['acima do mercado', '#f87171'] : ['no preço', '#f3e8ff'];
    el.style.cssText = cssSelo + `border:1px ${r.n < 3 ? 'dashed' : 'solid'} ${cor === '#f3e8ff' ? '#8b5cf6' : cor};`;
    el.title = `Mediana de ${r.n} venda(s) parecida(s) nos últimos 30 dias${r.n < 3 ? ' (poucas vendas: estimativa fraca)' : ''}. Clique para ver no Avaliador.`;
    el.innerHTML = `<b style="color:${cor}">${rot} ${sinal}${pct}%</b><br><span style="opacity:.8">mercado ${fmt(r.justo, moeda)} · faixa ${fmt(r.baixo, moeda)}–${fmt(r.alto, moeda)}</span><br><span style="opacity:.8">${dinheiro}</span>`;
  }
  const selo = (card) => {
    if (card.querySelector('.pl-preco') || !card.querySelector('.cm-vend')) return;
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'pl-preco'; el.style.cssText = cssSelo + 'border:1px solid #6b5a80;';
    el.textContent = '…';
    el.onclick = (e) => {
      e.stopPropagation(); e.preventDefault();
      const a = anuncios.get(el.dataset.anuncio) || acharAnuncio(card);
      if (a) window.postMessage({ __plAvaliar: { id: a.id, ficha: a.ficha, preco: a.preco, moeda: a.moeda, vendedor: a.vendedor, nome: card.querySelector('.cm-nome-txt')?.textContent || '' } }, '*');
    };
    const vend = card.querySelector('.cm-vend');
    vend.parentElement.insertBefore(el, vend);
    // só calcula quando o card aparece na tela (rolar a lista não dispara dezenas de pedidos de uma vez)
    el.textContent = 'preço ao aparecer';
    visivel.observe(el);
  };
  const visivel = new IntersectionObserver((ents) => {
    for (const e of ents) {
      if (!e.isIntersecting) continue;
      visivel.unobserve(e.target);
      const card = e.target.closest('.cm-card');
      if (card) pintarSelo(card, e.target);
    }
  }, { rootMargin: '150px' });
  // observa o documento (que não é trocado), e não o <html> do início, que o carregamento da página substitui
  let agendado = false;
  new MutationObserver(() => {
    if (agendado) return; agendado = true;
    setTimeout(() => { agendado = false; for (const c of document.querySelectorAll('.cm-card.poke')) selo(c); }, 150);
  }).observe(document, { childList: true, subtree: true });
}

// roda no mundo da página. Base do snipe próprio: relógio do servidor (os anúncios liberam num horário do
// servidor), envio pelo socket do jogo e espera de respostas. Quem decide o que comprar é o app (snipe.js).
function snipeMotor() {
  if (window.__plSnipe) return;
  let desvio = 0; // Date.now() − hora do servidor
  const ouvintes = new Set();
  let wsLigado = null;
  const ligar = (ws) => ws.addEventListener('message', (ev) => {
    const d = ev.data;
    if (typeof d !== 'string') return;
    if (!d.includes('servidorAgora') && !d.includes('"market"') && !d.includes('marketComprado') && !d.includes('"erro"')) return;
    let m; try { m = JSON.parse(d); } catch { return; }
    const s = Number(m.servidorAgora || (m.estado && m.estado.servidorAgora));
    if (s) desvio = Date.now() - s;
    for (const f of [...ouvintes]) { try { f(m); } catch { /* */ } }
  });
  setInterval(() => { const ws = window.__plWs; if (ws && ws !== wsLigado) { wsLigado = ws; ligar(ws); } }, 400);
  window.__plSnipe = {
    agora: () => Date.now() - desvio,
    pronto: () => !!(window.__plWs && window.__plWs.readyState === 1 && wsLigado === window.__plWs),
    enviar: (o) => { const ws = window.__plWs; if (!ws || ws.readyState !== 1) return false; ws.send(JSON.stringify(o)); return true; },
    // espera a primeira mensagem que passar no filtro (ou null no prazo)
    esperar: (filtro, ms) => new Promise((res) => {
      const f = (m) => { if (filtro(m)) { ouvintes.delete(f); clearTimeout(t); res(m); } };
      const t = setTimeout(() => { ouvintes.delete(f); res(null); }, ms);
      ouvintes.add(f);
    }),
  };
}
