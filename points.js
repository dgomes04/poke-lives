// Saldo de pontos por canal: uma aba escondida visita cada canal (logada na sua conta) e lê o saldo.
// As lives abertas na grade atualizam o saldo a cada checagem.

const POINTS_SCAN_EVERY = 3 * 3600e3; // varredura completa a cada 3 h
const POINTS_WAIT = 20e3;             // tempo máximo esperando o saldo aparecer em cada canal
const BOOST_COSTS = [[1000, 'Lure'], [500, 'Captura'], [300, 'XP']];
let pointsScan = null; // { i, total } enquanto varre

// ---------- dentro da página do canal ----------
async function pageReadPoints(platform) {
  const num = (t) => {
    t = (t || '').trim().toLowerCase();
    // "5,1 mil" / "1.234" (pt-BR) ou "1.2k" / "1,234" (inglês)
    const en = /k$/.test(t);
    const n = parseFloat(en ? t.replace(/,/g, '') : t.replace(/\./g, '').replace(',', '.'));
    if (isNaN(n)) return null;
    return /mil|k$/.test(t) ? Math.round(n * 1000) : n;
  };
  // deslogado o site mostra "0": não conta como saldo
  const visBtn = (re) => [...document.querySelectorAll('button, a')].some(b => b.offsetParent && re.test((b.innerText || '').trim()));
  if (platform === 'twitch') {
    if (!document.querySelector('[data-a-target="user-menu-toggle"]')) return null;
    const s = document.querySelector('[data-test-selector="community-points-summary"]');
    if (!s) return null;
    const bal = s.querySelector('[data-test-selector="copo-balance-string"]'); // pontos do canal (o outro é bits)
    if (bal) return num(bal.innerText);
    const ns = (s.innerText || '').split('\n').map(num).filter(n => n != null);
    return ns.length ? Math.max(...ns) : null;
  }
  // Kick: confirma o aviso de "conteúdo adulto" se aparecer
  const adulto = [...document.querySelectorAll('button')].filter(b => b.offsetParent).find(b => /tenho 18 anos|18 anos ou mais|i am 18|18 or older/i.test(b.innerText || ''));
  if (adulto) adulto.click();
  // Kick: embaixo do chat ficam dois botões numéricos lado a lado: saldo de pontos (esquerda) e KICKs (direita)
  if (!document.getElementById('chatroom-footer')) return null;
  if (visBtn(/^(Entrar|Log in|Cadastrar-se|Sign up)$/i)) return null; // deslogado
  const nums = [...document.querySelectorAll('button')]
    .filter(x => /^[\d.,]+\s*(mil|k)?$/i.test((x.innerText || '').trim()) && x.getBoundingClientRect().width)
    .map(x => ({ x, r: x.getBoundingClientRect() }));
  if (!nums.length) return null;
  const bottom = Math.max(...nums.map(n => n.r.top));
  const row = nums.filter(n => Math.abs(n.r.top - bottom) < 10).sort((a, c) => a.r.left - c.r.left);
  const v = num(row[0].x.innerText);
  return v != null && v <= 50_000_000 ? v : null;
}

// ---------- lógica ----------
function pointsOf(c) { return cfg.points?.[key(c)] || null; }

function pointsLabel(c) {
  const p = pointsOf(c);
  if (!p || p.balance == null) return '';
  const can = BOOST_COSTS.filter(([cost]) => p.balance >= cost).map(([, n]) => n);
  return `<span class="pts ${can.length ? 'ok' : ''}" title="Lido ${new Date(p.at).toLocaleString('pt-BR')}${can.length ? ' · dá pra: ' + can.join(', ') : ''}">${ic('coin')}${fmt(p.balance)}${can.length ? ' · dá até ' + can[0] : ''}</span>`;
}

function setPoints(c, balance) {
  if (!(balance >= 0 && balance <= 50_000_000)) return; // leitura errada: não estraga a prioridade nem o Resumo
  cfg.points ||= {};
  cfg.points[key(c)] = { balance, at: Date.now() };
  if (window.statsPoints) statsPoints(c, balance);
}

// saldo das lives abertas (chamado a cada checagem)
async function pointsFromSlots() {
  let changed = false;
  for (const p of PLATFORMS) for (const s of slots[p]) {
    if (!s.wv || !s.channel) continue;
    const b = await s.wv.executeJavaScript(`(${pageReadPoints})(${JSON.stringify(p)})`).catch(() => null);
    if (b != null) { setPoints(s.channel, b); changed = true; }
  }
  if (changed) save();
}

function makeScanner(id = 'pointsScanner') {
  let box = document.getElementById(id);
  if (!box) {
    box = document.createElement('div');
    box.id = id;
    // fora da tela, mas com tamanho de verdade pra página montar o chat
    box.style.cssText = 'position:fixed;left:-3000px;top:0;width:1280px;height:800px;';
    document.body.appendChild(box);
  }
  box.innerHTML = '';
  const wv = document.createElement('webview');
  wv.setAttribute('partition', partition());
  wv.style.cssText = 'width:1280px;height:800px;';
  wv.addEventListener('dom-ready', () => {
    wv.setAudioMuted(true);
    wv.insertCSS('video{display:none!important}').catch(() => {}); // não precisa do vídeo pra ler o saldo
  });
  box.appendChild(wv);
  return wv;
}

async function scanAllPoints() {
  if (pointsScan) return;
  const list = cfg.channels.slice();
  pointsScan = { i: 0, total: list.length, found: 0 };
  updatePointsBtn();
  const wv = makeScanner();
  await new Promise(r => { wv.addEventListener('dom-ready', r, { once: true }); wv.src = 'about:blank'; });
  try {
    for (const c of list) {
      pointsScan.i++;
      updatePointsBtn();
      // quem está aberto na grade já é lido por lá
      if (slots[c.platform].some(s => s.channel && key(s.channel) === key(c))) continue;
      try { await wv.loadURL(urlOf(c)); } catch { /* páginas que redirecionam dão erro mas carregam */ }
      const until = Date.now() + POINTS_WAIT;
      let b = null;
      while (Date.now() < until && b == null) {
        await sleep(1500);
        b = await wv.executeJavaScript(`(${pageReadPoints})(${JSON.stringify(c.platform)})`).catch(() => null);
      }
      if (b != null) { setPoints(c, b); pointsScan.found++; save(); renderList(); }
    }
  } finally {
    document.getElementById('pointsScanner')?.remove();
    cfg.pointsScanAt = Date.now(); save();
    pointsScan = null;
    updatePointsBtn();
    assign(); // reordena a grade com os saldos novos (prioridade "Mais pontos")
  }
}

function updatePointsBtn() {
  const b = $('scanPoints');
  if (!b) return;
  b.textContent = pointsScan ? `Pontos ${pointsScan.i}/${pointsScan.total}` : 'Pontos';
  b.disabled = !!pointsScan;
}

(async function pointsInit() {
  while (!cfg) await sleep(200);
  $('scanPoints').onclick = scanAllPoints;
  updatePointsBtn();
  renderList();
  setInterval(() => {
    if (window.__plPause || pointsScan) return;
    if (!cfg.pointsScanAt || Date.now() - cfg.pointsScanAt > POINTS_SCAN_EVERY) scanAllPoints();
  }, 60e3);
  // primeira varredura 2 min depois de abrir (deixa as lives carregarem antes)
  setTimeout(() => { if (!window.__plPause && (!cfg.pointsScanAt || Date.now() - cfg.pointsScanAt > POINTS_SCAN_EVERY)) scanAllPoints(); }, 120e3);
})();
