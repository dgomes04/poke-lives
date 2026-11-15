// Aba PokeIdle: lê o tempo dos boosts no jogo e resgata automaticamente nas lives da grade.

const BOOSTS = {
  xp:      { label: 'XP',          cost: 300,  title: 'Bônus +15% XP PokeIdle',       match: /XP/i },
  capture: { label: 'Captura',     cost: 500,  title: 'Bônus de +15% Capture Boost',  match: /Capture/i },
  lure:    { label: 'Secret Lure', cost: 1000, title: 'Bônus de +15% Secret Lure',    match: /Lure/i },
};
const CHECK_MIN = 5;          // conferir a cada 5 min
const ATTEMPT_WAIT = 8 * 60e3; // depois de resgatar, espera o PokeIdle atualizar
const CHANNEL_BLOCK = 30 * 60e3;

let pokeWv = null, boostState = { twitch: null, kick: null, at: null }, boostBusy = false, boostTimer = null;
const attempts = {};  // 'twitch:xp' -> { at, channelKey }
const blocked = {};   // channelKey -> até quando

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// roda uma função dentro do jogo. Com prazo: se a página recarregar no meio, a resposta nunca volta,
// e sem prazo a automação (e a trava daquela conta) ficaria parada pra sempre.
const RUN_PRAZO = 150e3;
const runIn = (wv, fn, arg, prazo = RUN_PRAZO) => Promise.race([
  wv.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`),
  new Promise((_, rej) => setTimeout(() => rej(new Error('o jogo não respondeu a tempo')), prazo)),
]);
const platName = (p) => p === 'twitch' ? 'Twitch' : 'Kick';

// histórico com tipos: boost, hunt, shiny, conta, sistema (deduzido do texto quando não é informado)
const LOG_TYPES = {
  boost: { label: 'Boost', icon: 'bolt' },
  hunt: { label: 'Hunt', icon: 'pin' },
  shiny: { label: 'Shiny', icon: 'sparkles' },
  conta: { label: 'Contas', icon: 'lock' },
  sistema: { label: 'Sistema', icon: 'settings' },
};
let logFilter = 'all';
function logTypeOf(msg) {
  if (/shiny/i.test(msg)) return 'shiny';
  if (/resgat|boost|pontos|\bXP 1h|Captura|Lure|acabou na|conferido/i.test(msg)) return 'boost';
  if (/hunt|→|Caçar|caçando|mapa/i.test(msg)) return 'hunt';
  if (/login|aberta em outro|recarreg|travou|caiu|parou de responder|reconect|principal/i.test(msg)) return 'conta';
  return 'sistema';
}
function blog(msg, kind = '', type = null) {
  type ||= logTypeOf(msg);
  const li = document.createElement('li');
  li.className = `${kind} t-${type}`;
  li.dataset.type = type;
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  li.innerHTML = `<span class="lg-ic">${ic(LOG_TYPES[type].icon)}</span><span class="lg-body"><span class="lg-meta">${LOG_TYPES[type].label} · ${hora}</span><span class="lg-msg"></span></span>`;
  li.querySelector('.lg-msg').textContent = msg.replace(/^✨\s*/, '');
  li.hidden = logFilter !== 'all' && logFilter !== type;
  const ul = $('boostLog');
  ul.prepend(li);
  while (ul.children.length > 150) ul.lastChild.remove();
}
function setupLogFilter() {
  const box = $('logFilter');
  box.innerHTML = [['all', 'Tudo'], ...Object.entries(LOG_TYPES).map(([k, v]) => [k, v.label])]
    .map(([k, l]) => `<button data-t="${k}" class="${k === logFilter ? 'on' : ''}">${l}</button>`).join('');
  box.onclick = (e) => {
    const b = e.target.closest('button[data-t]');
    if (!b) return;
    logFilter = b.dataset.t;
    box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    $('boostLog').querySelectorAll('li').forEach(li => { li.hidden = logFilter !== 'all' && li.dataset.type !== logFilter; });
  };
}

// ---------- funções que rodam dentro das páginas ----------

// PokeIdle: abre "Bônus Twitch" / "Bônus na Kick", lê os boosts e fecha
async function pageReadBoosts() {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const close = async (modal) => {
    const x = [...modal.querySelectorAll('button, [role=button]')].find(b => /^[✕×xX]$/.test((b.innerText || '').trim()) || /fech|close/i.test(b.className + (b.getAttribute('aria-label') || '')));
    if (x) x.click();
    for (const t of [document, window]) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    for (let i = 0; i < 10 && modal.isConnected && modal.offsetParent; i++) await wait(150);
  };
  const out = {};
  // o botão da barra lateral muda de cara ("Bônus na Kick" / "Kick ao vivo · assista"); acha pelo jeito mais tolerante:
  // classe da plataforma (.twitch/.kick ou .tw-ativo/.kk-ativo) e, se não achar, pelo texto
  const achaBotao = (p) => {
    const bs = [...document.querySelectorAll('button')];
    return bs.find(b => b.classList.contains(p === 'twitch' ? 'tw-ativo' : 'kk-ativo'))
      || bs.find(b => b.classList.contains('tr-ativo') && b.classList.contains(p))
      || bs.find(b => b.offsetParent && (b.innerText || '').length < 40 && (p === 'twitch' ? /twitch/i : /kick/i).test(b.innerText || '') && /b[ôo]nus|ao vivo|assist/i.test(b.innerText || ''));
  };
  const visiveis = () => [...document.querySelectorAll('.vt-modal')].filter(m => m.offsetParent && m.querySelector('.kk-rec'));
  for (const [p, modalSel] of [['twitch', '.vt-modal.tw-modal'], ['kick', '.vt-modal.kk-modal']]) {
    const btn = achaBotao(p);
    if (!btn) { out[p] = { error: 'botão de bônus não encontrado (está logado no PokeIdle?)' }; continue; }
    let modal = document.querySelector(modalSel);
    if (!modal || !modal.offsetParent) btn.click();
    // aceita a janela da plataforma pela classe; se a classe mudou, a única janela de bônus visível
    const pega = () => { const m = document.querySelector(modalSel); if (m && m.offsetParent && m.querySelector('.kk-rec')) return m; const v = visiveis(); return v.length === 1 ? v[0] : null; };
    for (let i = 0; i < 25 && !(modal = pega()); i++) await wait(200);
    if (!modal) { out[p] = { error: 'janela de bônus não abriu' }; continue; }
    await wait(600); // deixa os tempos atualizarem
    out[p] = [...modal.querySelectorAll('.kk-rec')].map(e => {
      const estado = (e.querySelector('.kk-rec-estado')?.innerText || '').trim();
      return {
        name: (e.querySelector('.kk-rec-nome')?.innerText || '').trim(),
        active: e.classList.contains('ativo'),
        // ativo mostra "7h 4m"; inativo mostra "1H POR RESGATE"
        time: e.classList.contains('ativo') && !/resgate/i.test(estado) && /\d+\s*[hms]/i.test(estado) ? estado : null,
      };
    });
    await close(modal);
  }
  return out;
}

// Twitch, fase 1: abre o mercado, acha a recompensa, abre a tela de confirmação
async function pageTwitchPrepare({ title, cost }) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const sumBtn = document.querySelector('[data-test-selector="community-points-summary"] button');
  if (!sumBtn) return { error: 'botão de pontos não encontrado (logado na Twitch?)' };
  const balEl = document.querySelector('[data-test-selector="copo-balance-string"]'); // pontos (o outro número é bits)
  const nums = (balEl ? balEl.innerText : (sumBtn.innerText || '')).split('\n').map(t => t.trim()).filter(Boolean).map(t => {
    const n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
    return /mil|k/i.test(t) ? Math.round(n * 1000) : n;
  }).filter(n => !isNaN(n));
  const balance = nums.length ? Math.max(...nums) : null;
  if (balance != null && balance < cost) return { error: 'poucos pontos', balance };
  if (!document.querySelector('[class*="reward-center__content"]')) sumBtn.click();
  let item;
  for (let i = 0; i < 25 && !item; i++) {
    await wait(200);
    item = [...document.querySelectorAll('[class*="rewardListItem"]')]
      .find(e => e.innerText.split('\n').map(t => t.trim()).includes(title));
  }
  if (!item) { sumBtn.click(); return { error: 'recompensa não encontrada neste canal', balance }; }
  item.querySelector('button').click();
  await wait(1500);
  const pop = document.querySelector('[class*="reward-center__content"]');
  const costTxt = cost.toLocaleString('pt-BR');
  const confirm = pop && [...pop.querySelectorAll('button')].filter(b => !b.closest('[class*="rewardListItem"]'))
    .find(b => /resgat|redeem|trocar/i.test(b.innerText) || b.innerText.trim() === costTxt || b.innerText.trim() === String(cost));
  if (!confirm) { sumBtn.click(); return { error: 'botão de confirmar não encontrado', balance }; }
  if (confirm.disabled) { sumBtn.click(); return { error: 'botão de resgatar desativado (pontos? limite do canal?)', balance }; }
  window.__plConfirm = confirm;
  return { ok: true, balance, confirmText: confirm.innerText.trim() };
}

// Kick, fase 1
async function pageKickPrepare({ title, cost }) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const findPanel = () => {
    const h = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === 'Pontos do canal' && e.offsetParent);
    let p = h; for (let i = 0; i < 4 && p; i++) p = p.parentElement;
    return p;
  };
  // botão de pontos: primeiro botão numérico no canto inferior direito (perto do chat)
  // mesmo jeito da leitura de saldo: a fileira numérica mais de baixo, o da esquerda é o saldo
  const nums = [...document.querySelectorAll('button')]
    .filter(x => /^[\d.,]+\s*(mil|k)?$/i.test((x.innerText || '').trim()) && x.getBoundingClientRect().width)
    .map(x => ({ x, r: x.getBoundingClientRect() }));
  const bottom = nums.length ? Math.max(...nums.map(n => n.r.top)) : 0;
  const ptsBtn = nums.filter(n => Math.abs(n.r.top - bottom) < 10).sort((a, c) => a.r.left - c.r.left)[0]?.x;
  if (!ptsBtn) return { error: 'botão de pontos não encontrado (logado na Kick?)' };
  const t = ptsBtn.innerText.trim();
  const en = /k$/i.test(t); // "1.2K" (inglês) ou "1,2 mil" / "1.234" (pt-BR)
  const balance = Math.round(parseFloat(en ? t.replace(/,/g, '') : t.replace(/\./g, '').replace(',', '.')) * (/mil|k$/i.test(t) ? 1000 : 1));
  if (!isNaN(balance) && balance < cost) return { error: 'poucos pontos', balance };
  let panel = findPanel();
  if (!panel) ptsBtn.click();
  let item;
  for (let i = 0; i < 25 && !item; i++) {
    await wait(200);
    panel = findPanel();
    item = panel && [...panel.querySelectorAll('button')].find(b => b.innerText.split('\n').map(x => x.trim()).includes(title));
  }
  if (!item) { ptsBtn.click(); return { error: 'recompensa não encontrada neste canal', balance }; }
  const before = new Set(document.querySelectorAll('button'));
  item.click();
  await wait(1500);
  const costTxt = cost.toLocaleString('pt-BR');
  const confirm = [...document.querySelectorAll('button')].filter(b => b.offsetParent && b !== item)
    .find(b => /resgat|redeem|confirm|trocar/i.test(b.innerText) || (!before.has(b) && b.innerText.includes(costTxt)));
  if (!confirm) { ptsBtn.click(); return { error: 'botão de confirmar não encontrado', balance }; }
  if (confirm.disabled) { ptsBtn.click(); return { error: 'botão de resgatar desativado', balance }; }
  window.__plConfirm = confirm;
  window.__plClose = () => { if (findPanel()) ptsBtn.click(); };
  return { ok: true, balance, confirmText: confirm.innerText.trim() };
}

// fase 2 (as duas plataformas): clica em confirmar ou cancela
async function pageCommit(doIt) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const btn = window.__plConfirm;
  window.__plConfirm = null;
  if (doIt && btn && btn.isConnected) { btn.click(); await wait(2500); }
  const msg = (document.querySelector('[class*="reward-center__content"]')?.innerText || '').split('\n').slice(0, 4).join(' ');
  // fecha o mercado
  const tw = document.querySelector('[data-test-selector="community-points-summary"] button');
  if (tw && document.querySelector('[class*="reward-center__content"]')) tw.click();
  if (window.__plClose) { window.__plClose(); window.__plClose = null; }
  return { clicked: !!(doIt && btn), msg };
}

// ---------- lógica ----------

function parseTime(t) {
  if (!t) return 0;
  let s = 0;
  for (const [, n, u] of t.matchAll(/(\d+)\s*([hms])/gi)) s += +n * ({ h: 3600, m: 60, s: 1 })[u.toLowerCase()];
  return s;
}

function typeOf(name) {
  return Object.keys(BOOSTS).find(k => BOOSTS[k].match.test(name));
}

function renderBoostTable() {
  const rows = Object.entries(BOOSTS).map(([k, b]) => {
    const cell = (p) => {
      const list = boostState[p];
      if (!list || list.error) return `<td class="muted">${list?.error ? 'erro' : '—'}</td>`;
      const r = list.find(x => typeOf(x.name) === k);
      return r && r.time ? `<td class="on">${r.time}</td>` : `<td class="off">acabou</td>`;
    };
    const on = cfg.settings.boost[k] ? ic('star', 'mainstar') : '';
    return `<tr><td>${on}${b.label} <span class="muted">${b.cost}</span></td>${cell('twitch')}${cell('kick')}</tr>`;
  });
  $('boostTable').innerHTML = `<tr><th>Boost</th><th>Twitch</th><th>Kick</th></tr>${rows.join('')}`;
  const errs = ['twitch', 'kick'].map(p => boostState[p]?.error && platName(p) + ': ' + boostState[p].error).filter(Boolean);
  $('boostNext').textContent = (boostState.at ? 'Conferido às ' + boostState.at.toLocaleTimeString('pt-BR') : 'Ainda não conferido') +
    (errs.length ? ' · ' + errs.join(' · ') : '');
  // aviso no botão do topo
  const missing = ['twitch', 'kick'].flatMap(p => Array.isArray(boostState[p]) ? Object.keys(BOOSTS).filter(k => cfg.settings.boost[k] && !boostState[p].find(x => typeOf(x.name) === k && x.time)) : []);
  $('pokeBadge').textContent = missing.length ? `· ${missing.length} acabado${missing.length > 1 ? 's' : ''}` : '';
}

function askConfirm(text) {
  return new Promise((resolve) => {
    $('confirmText').textContent = text;
    $('confirmBox').hidden = false;
    const done = (v) => { $('confirmBox').hidden = true; clearTimeout(to); resolve(v); };
    const to = setTimeout(() => done(false), 120e3);
    $('confirmYes').onclick = () => done(true);
    $('confirmNo').onclick = () => done(false);
  });
}

async function readBoosts() {
  if (!pokeWv) return false;
  try {
    const wv = pokeWv;
    const res = await withLock(wv, () => withDesktop(wv, () => runIn(wv, pageReadBoosts)));
    boostState = { ...res, at: new Date() };
  } catch (e) {
    boostState = { twitch: { error: 'PokeIdle não respondeu' }, kick: { error: 'PokeIdle não respondeu' }, at: new Date() };
  }
  renderBoostTable();
  return true;
}

// tenta resgatar numa página de canal já carregada. Retorna 'done' (resgatou ou você cancelou) ou 'skip' (tenta outro)
async function redeemOn(wv, channel, p, k, where) {
  const b = BOOSTS[k], ch = channel.name;
  let r;
  try { r = await runIn(wv, p === 'twitch' ? pageTwitchPrepare : pageKickPrepare, { title: b.title, cost: b.cost }); }
  catch (e) { r = { error: 'a página não respondeu' }; }
  if (r.balance != null && window.setPoints) { setPoints(channel, r.balance); save(); }
  if (r.error) {
    blog(`${ch} (${platName(p)}${where}): ${r.error}${r.balance != null ? ` · saldo ${r.balance}` : ''}`, 'err');
    return 'skip';
  }
  const text = `Resgatar ${b.label} 1h (${b.cost} pontos) no canal ${ch} da ${platName(p)}${where}? Saldo: ${r.balance ?? '?'}`;
  const ok = cfg.settings.boost.confirm ? await askConfirm(text) : true;
  const res = await runIn(wv, pageCommit, ok).catch(() => ({ clicked: false }));
  if (!ok) { blog(`Resgate de ${b.label} em ${ch} cancelado.`); attempts[p + ':' + k] = { at: Date.now(), channelKey: null }; return 'done'; }
  if (res.clicked) {
    blog(`Resgatei ${b.label} 1h em ${ch} (${platName(p)}${where}). Conferindo no PokeIdle…`, 'ok');
    notify('Boost resgatado', `${b.label} 1h em ${ch} (${platName(p)}) por ${b.cost} pontos.`, 'boost:' + Date.now(), 0);
    if (window.statsBoost) statsBoost(b.label, ch, p, b.cost);
    attempts[p + ':' + k] = { at: Date.now(), channelKey: key(channel), channel: ch };
    if (r.balance != null && window.setPoints) { setPoints(channel, r.balance - b.cost); save(); renderList(); }
    return 'done';
  }
  blog(`Não consegui clicar em resgatar em ${ch}.`, 'err');
  return 'skip';
}

async function tryRedeem(p, k) {
  const b = BOOSTS[k];
  // 1º: as lives abertas na grade
  const cands = slots[p].filter(s => s.channel && s.wv && !(blocked[key(s.channel)] > Date.now()));
  for (const s of cands) if (await redeemOn(s.wv, s.channel, p, k, '') === 'done') return;
  // 2º: qualquer outro canal da lista com saldo suficiente (mesmo offline), numa aba escondida
  if (await tryRedeemElsewhere(p, k)) return;
  blog(`${b.label} acabou na ${platName(p)} e nenhum canal conseguiu resgatar (faltam pontos? rode "Pontos" pra atualizar os saldos).`, 'err');
  notify('Boost sem pontos', `${b.label} acabou na ${platName(p)} e nenhum canal tem pontos suficientes (${b.cost}).`, 'nopts:' + p + k, 60);
}

async function tryRedeemElsewhere(p, k) {
  const b = BOOSTS[k];
  const open = new Set(slots[p].filter(s => s.channel).map(s => key(s.channel)));
  const cands = cfg.channels
    .filter(c => c.platform === p && !open.has(key(c)) && !(blocked[key(c)] > Date.now()))
    .map(c => ({ c, bal: window.pointsOf ? pointsOf(c)?.balance : null }))
    .filter(x => x.bal != null && x.bal >= b.cost)
    .sort((x, y) => y.bal - x.bal)
    .slice(0, 5);
  if (!cands.length) return false;
  blog(`Sem pontos nas lives abertas. Tentando em ${cands.map(x => x.c.name).join(', ')}…`);
  const wv = makeScanner('redeemHidden');
  try {
    await new Promise(r => { wv.addEventListener('dom-ready', r, { once: true }); wv.src = 'about:blank'; });
    for (const { c } of cands) {
      try { await wv.loadURL(urlOf(c)); } catch { /* redireciona mas carrega */ }
      // espera a página montar o saldo antes de abrir o mercado
      let ready = null;
      for (let i = 0; i < 14 && ready == null; i++) {
        await sleep(1500);
        ready = await wv.executeJavaScript(`(${pageReadPoints})(${JSON.stringify(p)})`).catch(() => null);
      }
      if (ready == null) { blog(`${c.name} (${platName(p)}): a página não carregou o saldo.`, 'err'); continue; }
      if (await redeemOn(wv, c, p, k, ', aba escondida') === 'done') return true;
    }
    return false;
  } finally {
    document.getElementById('redeemHidden')?.remove();
  }
}

let outlandAvisado = false;
async function boostCycle(manual = false) {
  if (boostBusy || (window.__plPause && !manual)) return;
  boostBusy = true;
  $('bCheck').disabled = true;
  try {
    await readBoosts();
    const s = cfg.settings.boost;
    for (const p of ['twitch', 'kick']) {
      const list = boostState[p];
      if (!Array.isArray(list)) continue;
      // confere resgates anteriores
      for (const k of Object.keys(BOOSTS)) {
        const a = attempts[p + ':' + k];
        if (!a || !a.channelKey) continue;
        const active = list.find(x => typeOf(x.name) === k && x.time);
        if (active) { blog(`${BOOSTS[k].label} na ${platName(p)} ativo: ${active.time}.`, 'ok'); delete attempts[p + ':' + k]; }
        else if (Date.now() - a.at > ATTEMPT_WAIT) {
          blog(`O resgate em ${a.channel} não apareceu no PokeIdle. Pausando esse canal por 30 min.`, 'err');
          blocked[a.channelKey] = Date.now() + CHANNEL_BLOCK;
          delete attempts[p + ':' + k];
        }
      }
      if (!s.auto) continue;
      // na Outland não rola shiny e os drops não dependem de captura: Lure e Captura seriam pontos jogados fora
      const naOutland = !!tileInfo[cfg.settings.pokeMain]?.outland;
      if (naOutland && !outlandAvisado) { outlandAvisado = true; blog('Principal na Outland: pulando Secret Lure e Captura (lá eles não rendem nada). Só o XP continua.', '', 'boost'); }
      if (!naOutland) outlandAvisado = false;
      // acabados e marcados, do mais barato pro mais caro
      const expired = Object.keys(BOOSTS)
        .filter(k => s[k] && !list.find(x => typeOf(x.name) === k && x.time))
        .filter(k => !(naOutland && (k === 'lure' || k === 'capture')))
        .filter(k => !(attempts[p + ':' + k] && Date.now() - attempts[p + ':' + k].at < ATTEMPT_WAIT))
        .sort((a, b) => BOOSTS[a].cost - BOOSTS[b].cost);
      if (expired.length) await tryRedeem(p, expired[0]); // um por rodada
    }
    if (manual && !s.auto) blog('Conferido. Resgate automático está desligado.');
  } finally {
    boostBusy = false;
    $('bCheck').disabled = false;
  }
}

// Hub: até 4 contas do PokeIdle, cada uma com sessão própria (persist:<id>), com o navegador
// padrão (sem trocar o user agent) pra verificação da Cloudflare funcionar normalmente.
// A conta principal é a que tem Twitch/Kick vinculadas: é dela que o resgate lê os boosts.
const MAX_ACCOUNTS = 4;
const pokeViews = {}; // id -> webview
let pokePreloadUrl = null, huntExtInfo = null;

// uma automação por vez em cada aba do jogo (boost e hunt não se atropelam)
const wvLocks = new Map();
function withLock(wv, fn) {
  const prev = wvLocks.get(wv) || Promise.resolve();
  const next = prev.then(fn, fn);
  wvLocks.set(wv, next.catch(() => {}));
  return next;
}

// info de cada conta, lida de dentro do jogo (usa o "estado" que a /hunt escuta; senão, a tela)
async function pageTileInfo() {
  const vis = (e) => e && e.offsetParent;
  const PIH = window.__pokeidleHunt;
  if (PIH && PIH.on && !window.__plEuHook) { window.__plEuHook = true; PIH.on('estado', (e) => { window.__plEu = e; }); }
  // lista de hunts do "welcome" (slug -> área), pra saber se a hunt atual é da Outland
  if (PIH && PIH.on && !window.__plWelHook) {
    window.__plWelHook = true;
    PIH.on('welcome', (m) => {
      const areas = {};
      const walk = (o, d) => {
        if (!o || typeof o !== 'object' || d > 4) return;
        if (Array.isArray(o)) { for (const h of o) if (h && h.slug && h.area) areas[h.slug] = h.area; else walk(h, d + 1); return; }
        for (const k of Object.keys(o)) walk(o[k], d + 1);
      };
      walk(m, 0);
      window.__plAreas = areas;
      if (Array.isArray(m.catalogoBolas)) window.__plBolas = m.catalogoBolas.map(b => ({ id: b.id, nome: b.nome || b.name || ('Bola ' + b.id) }));
    });
  }
  const eu = window.__plEu || {};
  const area = eu.huntSlug && window.__plAreas ? window.__plAreas[eu.huntSlug] || null : null;
  const pk = (eu.pokemons || []).find(p => p.id === eu.activeId);
  const leafs = () => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && vis(e));
  const huntLeaf = leafs().find(e => /^.+ · nível \d+$/.test(e.textContent.trim()));
  const card = document.getElementById('ativo-card');
  const pkTxt = card && card.innerText.match(/^\s*(\S+)[\s\S]*?Nv\s*(\d+)/);
  const login = !!leafs().find(e => /^LOGAR$/i.test(e.textContent.trim()));
  const outra = !!leafs().find(e => /desconecta a outra sess|sess[ãa]o foi pausada|conta aberta em outro/i.test(e.textContent));
  const reconn = !!leafs().find(e => /reconectando|conex[ãa]o perdida/i.test(e.textContent));
  const firstNum = (o, ks) => { for (const k of ks) if (o && typeof o[k] === 'number') return o[k]; return null; };
  // "Achados · hunt": contadores de shiny vistos / capturados (o número some quando é zero)
  const shinySlot = (re) => {
    const s = [...document.querySelectorAll('.eco-slot-shiny')].find(e => re.test(e.title || e.getAttribute('aria-label') || e.innerText));
    if (!s) return null;
    const n = parseInt((s.innerText.match(/\d+/) || ['0'])[0], 10);
    return isNaN(n) ? 0 : n;
  };
  // painel da sessão: "XP TREINADOR / 90.024.282 / 27.300.065/h", "LUCRO LÍQUIDO / ...", "ABATES", "CAPTURAS"
  const kpis = [...document.querySelectorAll('.eco-kpi')].map(k => k.innerText.split('\n').map(x => x.trim()).filter(Boolean)).filter(k => k.length);
  // tempo da sessão: "3:18:30 caçando" (não confundir com o relógio do evento, que também é h:mm:ss)
  const sess = leafs().find(e => /^\d+:\d{2}:\d{2}$/.test(e.textContent.trim()) && /ca[çc]ando/i.test(e.parentElement?.innerText || ''));
  return {
    kpis,
    session: sess ? sess.textContent.trim() : null,
    shinySeen: shinySlot(/vistos/i),
    shinyCaught: shinySlot(/capturados|pegos/i),
    tx: firstNum(eu, ['xp', 'exp', 'experiencia', 'xpTotal']),
    px: firstNum(pk, ['xp', 'exp', 'experiencia', 'xpTotal']),
    reconn,
    trainer: eu.nome || eu.username || eu.name || null,
    tlvl: eu.level ?? eu.nivel ?? eu.lvl ?? null,
    pk: pk ? pk.nome : (pkTxt ? pkTxt[1] : null),
    plvl: pk ? pk.level : (pkTxt ? +pkTxt[2] : null),
    hunt: huntLeaf ? huntLeaf.textContent.trim().replace(/ · nível (\d+)$/, ' ($1)') : null,
    login, outra,
    area, outland: area === 'outland',
    // pokémon em campo e o estoque que a automação usa pra levantar ele (só leitura; nada é comprado)
    hp: pk && typeof pk.hp === 'number' ? pk.hp : null,
    hpMax: pk && typeof pk.maxHp === 'number' ? pk.maxHp : null,
    noCentro: !!eu.noCentro,
    revives: eu.items ? ((eu.automation?.reviveIds?.length ? eu.automation.reviveIds : [205, 206]).reduce((t, k) => t + Number(eu.items[k] || 0), 0)) : null,
    pocoes: eu.items ? ((eu.automation?.potionIds?.length ? eu.automation.potionIds : [200, 201, 202, 203, 204, 207]).reduce((t, k) => t + Number(eu.items[k] || 0), 0)) : null,
    // pokebolas: quantas tem de cada uma e quais a automação de captura usa (sem bola, a captura para)
    bolas: eu.balls ? (window.__plBolas || Object.keys(eu.balls).map(id => ({ id: +id, nome: 'Bola ' + id }))).map(b => ({
      id: b.id, nome: b.nome, qtd: Number(eu.balls[b.id] || 0), usa: (eu.automation?.ballIds || []).includes(b.id),
    })) : null,
    autoBola: eu.automation ? !!(eu.automation.autoBallSemParar || eu.automation.autoBallAteCapturar || eu.automation.autoBall) : null,
    // revives e poções, um por um (quantos tem e se a automação usa)
    suprimentos: eu.items ? [[205, 'Revive', 'revive'], [206, 'Max Revive', 'revive'], [200, 'Small Potion', 'pocao'], [201, 'Great Potion', 'pocao'],
      [202, 'Ultra Potion', 'pocao'], [203, 'Hyper Potion', 'pocao'], [204, 'Ultimate Potion', 'pocao'], [70070, 'Golden Potion', 'pocao'], [207, 'Medicine', 'pocao']]
      .map(([id, nome, tipo]) => ({ id, nome, tipo, qtd: Number(eu.items[id] || 0),
        usa: (tipo === 'revive' ? eu.automation?.reviveIds : eu.automation?.potionIds)?.includes(id) || false }))
      .filter(x => x.qtd > 0 || x.usa) : null,
    autoRevive: eu.automation ? !!eu.automation.autoRevive : null,
    autoPocao: eu.automation ? !!eu.automation.autoPotion : null,
    gold: typeof eu.gold === 'number' ? eu.gold : null,
    orbs: typeof eu.orbs === 'number' ? eu.orbs : null,
    diamonds: typeof eu.diamonds === 'number' ? eu.diamonds : null,
    // o que vale gema no Mercado: tokens, fragmentos e tickets (ids do jogo)
    items: eu.items ? Object.fromEntries([70000, 70011, 70013, 70012, 70014, 70015, 70017, 70090, 70095, 40530, 59194]
      .map(k => [k, Number(eu.items[k] || 0)])) : null,
    // pedras de evolução (vendem no Mercado, em ouro)
    pedras: eu.items ? Object.fromEntries([2, 23, 28, 31, 40, 45, 49, 53, 66, 71, 76, 87, 106, 109, 133, 139, 142, 209]
      .map(k => [k, Number(eu.items[k] || 0)]).filter(([, n]) => n > 0)) : null,
    casas: Array.isArray(eu.casa?.lista) ? eu.casa.lista.map(c => ({ id: c.id, rar: c.raridade || null, anunciada: !!c.anunciada })) : null,
    bikes: Array.isArray(eu.bicicleta?.lista) ? eu.bicicleta.lista.map(c => ({ id: c.id, rar: c.raridade || null, anunciada: !!c.anunciada })) : null,
    // shinies da conta: quantos tem e os mais recentes
    shinyTotal: Array.isArray(eu.pokemons) ? eu.pokemons.filter(p => p.shiny).length : null,
    shinyRecentes: Array.isArray(eu.pokemons) ? eu.pokemons.filter(p => p.shiny).sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 6)
      .map(p => ({ id: p.id, nome: p.nome || p.name || '?', nivel: p.level ?? null, pot: p.potencia ?? null })) : null,
  };
}

const tileInfo = {}; // id -> último info

// recuperação: página travada/sem resposta ou "reconectando" por mais de 2 min = recarrega.
// "aberta em outro lugar" e "faça login" só avisam (recarregar roubaria a sessão de onde você abriu).
const pokeHealthState = {};
const POKE_DEAD_RELOAD = 2 * 60e3;
function pokeHealth(id, wv, i) {
  const h = (pokeHealthState[id] ||= {});
  const name = accName(id);
  const bad = !i || i.reconn;
  if (bad) h.since ||= Date.now(); else h.since = null;
  // conta aberta em outro lugar (celular, outro PC): o app NÃO recarrega sozinho, senão tomaria a conta
  // de volta e derrubaria quem está jogando lá. Só volta quando você pedir (⟳ no quadro ou "Voltar a jogar no PC").
  if (i?.outra) h.emOutroLugar = true;
  else if (i && i.hunt && !i.reconn) h.emOutroLugar = false;
  if (h.since && !h.emOutroLugar && Date.now() - h.since > POKE_DEAD_RELOAD) {
    h.since = null;
    blog(`${name}: o jogo ${i ? 'ficou reconectando' : 'parou de responder'} por 2 min. Recarregando.`, 'err');
    notify('PokeIdle recarregado', `${name}: o jogo travou e foi recarregado.`, 'dead:' + id);
    wv.reload();
  }
  if (i?.outra && !h.outra) { blog(`${name}: aberta em outro lugar. Clique ⟳ no quadro pra voltar a jogar aqui.`, 'err'); notify('Conta do PokeIdle desconectada', `${name} foi aberta em outro lugar. Clique ⟳ no quadro dela pra voltar.`, 'outra:' + id); }
  if (i?.login && !h.login) notify('PokeIdle pede login', `${name} está na tela de login.`, 'login:' + id);
  h.outra = !!i?.outra; h.login = !!i?.login;
  shinyCheck(id, i);
}

// volta a jogar no PC uma conta que foi aberta em outro lugar (botão do celular / ⟳ do quadro)
function pageJogarAqui() {
  const b = [...document.querySelectorAll('button, [role=button], a')].find(x => x.offsetParent && /^\s*jogar aqui\s*$/i.test(x.innerText || ''));
  if (b) { b.click(); return true; }
  return false;
}
window.retomarConta = async function (id) {
  const wv = pokeViews[id];
  if (!wv) return { ok: false, msg: 'conta não está aberta no app' };
  if (pokeHealthState[id]) { pokeHealthState[id].emOutroLugar = false; pokeHealthState[id].since = null; }
  let clicou = false;
  try { clicou = await runIn(wv, pageJogarAqui, null, 10e3); } catch { /* recarrega abaixo */ }
  if (!clicou) { try { wv.reload(); } catch { wv.src = 'https://pokeidle.io/app'; } }
  blog(`${accName(id)}: voltou a jogar no PC${clicou ? '' : ' (jogo recarregado)'}.`, 'ok', 'conta');
  return { ok: true };
};

// alerta de shiny: os contadores do jogo subiram (zeram ao trocar de hunt, então só conta aumento)
const shinyLast = {};
function shinyCheck(id, i) {
  if (!i || i.login || i.outra) return;
  const prev = shinyLast[id];
  const cur = { seen: i.shinySeen, caught: i.shinyCaught, hunt: i.hunt };
  shinyLast[id] = cur;
  if (!prev) return; // primeira leitura: só guarda
  const name = accName(id), onde = i.hunt ? ` em ${i.hunt}` : '';
  if (cur.caught != null && prev.caught != null && cur.caught > prev.caught) {
    const n = cur.caught - prev.caught;
    blog(`✨ ${name}: ${n > 1 ? n + ' shinies capturados' : 'SHINY CAPTURADO'}${onde}!`, 'ok');
    notify('✨ Shiny capturado!', `${name}${onde}`, 'shinyc:' + id + Date.now(), 0);
    if (window.statsShiny) statsShiny(name, i.hunt, 'capturado', n);
  } else if (cur.seen != null && prev.seen != null && cur.seen > prev.seen) {
    const n = cur.seen - prev.seen;
    blog(`✨ ${name}: ${n > 1 ? n + ' shinies apareceram' : 'apareceu um SHINY'}${onde}!`, 'ok');
    notify('✨ Shiny apareceu!', `${name}${onde}`, 'shinys:' + id + Date.now(), 0);
    if (window.statsShiny) statsShiny(name, i.hunt, 'visto', n);
  }
}
// farm parada: pokémon em campo desmaiado por mais de 1 min (normalmente acabou revive/poção). Só avisa.
const PARADA_APOS = 60e3;
const mortoDesde = {};
function farmParada(id, i) {
  if (!i || i.login || i.outra || i.hp == null) { delete mortoDesde[id]; return null; }
  if (i.hp > 0) {
    if (mortoDesde[id]?.avisado) blog(`${accName(id)}: o pokémon voltou a lutar. Farm rodando de novo.`, 'ok', 'conta');
    delete mortoDesde[id];
    return null;
  }
  const m = (mortoDesde[id] ||= { t: Date.now() });
  if (Date.now() - m.t < PARADA_APOS) return null;
  const faltam = [i.revives === 0 ? 'revives' : null, i.pocoes === 0 ? 'poções' : null].filter(Boolean);
  const motivo = faltam.length ? `sem ${faltam.join(' e ')}` : 'pokémon desmaiado';
  if (!m.avisado) {
    m.avisado = true;
    blog(`${accName(id)}: farm PARADA. O pokémon em campo morreu e está ${motivo}. Compre ${faltam.length ? faltam.join('/') : 'revive/poção'} no Market do jogo.`, 'err', 'conta');
    notify('Farm parada', `${accName(id)}: ${motivo}`, 'parada:' + id, 0);
  }
  return { desde: m.t, motivo };
}
// pokebolas da captura automática acabaram: só avisa (o app não compra nada)
const bolasAvisadas = {};
function avisoBolas(id, i) {
  if (!i.bolas || !i.autoBola || i.login || i.outra) return;
  const usadas = i.bolas.filter(b => b.usa);
  const total = (usadas.length ? usadas : i.bolas).reduce((t, b) => t + b.qtd, 0);
  const ultraCuida = cfg.settings.autoUltra !== false && (usadas.length ? usadas : i.bolas).some(b => /^ultra ?ball$/i.test(b.nome || ''));
  if (total === 0 && ultraCuida && (ultraUltima[id]?.ok || !ultraUltima[id])) return; // a compra automática resolve
  if (total === 0 && !bolasAvisadas[id]) {
    bolasAvisadas[id] = true;
    const nomes = (usadas.length ? usadas : i.bolas).map(b => b.nome).join(', ');
    blog(`${accName(id)}: acabaram as pokebolas da captura automática (${nomes}). A captura parou; compre no Market do jogo.`, 'err', 'conta');
    notify('Acabaram as pokebolas', `${accName(id)}: a captura automática parou.`, 'bolas:' + id, 0);
  } else if (total > 0) bolasAvisadas[id] = false;
}
async function refreshTileInfo() {
  for (const [id, wv] of Object.entries(pokeViews)) {
    let i;
    try { i = await runIn(wv, pageTileInfo); } catch { i = null; }
    if (i) i.parada = farmParada(id, i);
    if (i) avisoBolas(id, i);
    if (i && window.verificarUltra) verificarUltra(id, i); // roda sozinha (tem trava por conta)
    tileInfo[id] = i;
    pokeHealth(id, wv, i);
    if (i && window.statsAccount) statsAccount(id, i);
    if (i && !i.login && !i.outra && window.statsShinyNovos) statsShinyNovos(id, i);
    const tile = wv.closest('.ptile');
    if (!tile) continue;
    const el = tile.querySelector('.tinfo');
    if (!i) el.textContent = 'carregando…';
    else if (i.login) el.innerHTML = `<span class="pc-warn">${ic('lock')}deslogada</span>`;
    else if (i.outra) el.innerHTML = `<span class="pc-warn">${ic('alert')}aberta em outro lugar</span>`;
    else if (i.parada) el.innerHTML = `<span class="pc-warn">${ic('alert')}farm parada: ${i.parada.motivo}</span>`;
    else el.innerHTML = [i.tlvl != null ? `treinador ${fmt(i.tlvl)}` : '', i.pk ? `${i.pk} Nv ${fmt(i.plvl)}` : '', i.hunt ? `${ic('pin')}${i.hunt}` : '',
      // sempre visível: shinies vistos/pegos; "—" = o bloco "Achados · Hunt" não foi encontrado nessa conta
      `<span class="shn">${ic('sparkles')}${(i.shinySeen == null && i.shinyCaught == null) ? '—' : `${i.shinySeen || 0}/${i.shinyCaught || 0}`}</span>`].filter(Boolean).join('<span class="sep">·</span>');
    el.title = el.textContent + (i && !i.login && !i.outra ? '  (estrela = shinies vistos/pegos nessa hunt)' : '');
    tile.querySelector('.sdot').className = 'sdot ' + (!i ? '' : i.login || i.outra || i.parada ? 'bad' : i.reconn ? 'warn' : 'ok');
    tile.querySelector('[data-a=login]').hidden = !(i && i.login); // "Login em janela" só pra conta deslogada
  }
  renderPokeChips();
  renderPokeCards();
}

// ---------- modo Cards: um card por conta com os dados da run (os jogos seguem rodando por baixo) ----------
const cardPrev = {}; // id -> valores da última vez (pra piscar o que mudou)
const nfc = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
function ptNum(t) { // "27.300.065/h" -> 27300065 ; "-16.418/h" -> -16418 ; "8,5/h" -> 8.5
  if (!t) return null;
  const m = String(t).replace(/\s/g, '').match(/^[−-]?[\d.]+(,\d+)?/);
  if (!m) return null;
  return parseFloat(m[0].replace('−', '-').replace(/\./g, '').replace(',', '.'));
}
function kpi(i, re) { return (i?.kpis || []).find(k => re.test(k[0] || '')) || null; }
function perHour(k) { const h = k && k.find(x => /\/h$/.test(x)); return h ? ptNum(h) : null; }

// itens da conta no card (Farm e Vendíveis), no formato aprovado
const COR_FARM = { bola: '#facc15', revive: '#f472b6', pocao: '#a78bfa' };
function cardItens(id) {
  const it = itensDaConta(id);
  if (!it.farm.length && !it.vend.length) return '';
  const hh = (h) => h < 1 ? `~${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `~${Math.round(h)} h` : `~${Math.round(h / 24)} dias`;
  const info = [it.usaUltra && it.ultraDura != null ? `Ultra acaba em ${hh(it.ultraDura)}` : '', it.usaUltra ? `compra automática ${it.autoUltra ? 'ligada' : 'desligada'}` : ''].filter(Boolean).join(' · ');
  const chip = (x) => `<span class="pc-chip ${x.est}" title="${x.nomeLongo}"><span class="pc-dot" style="background:${COR_FARM[x.tipo]}"></span>${x.nome} <b>${fmt(x.qtd)}</b></span>`;
  const MAX_V = 4;
  const vend = it.vend.slice(0, MAX_V).map(x => `<span class="pc-chip" title="${x.gemas ? '≈ ' + fmt(x.gemas) + ' gemas' : x.ouro ? '≈ ' + fmt(x.ouro) + ' ouro' : ''}">${x.nome} <b>${fmt(x.n)}</b></span>`).join('') +
    (it.vend.length > MAX_V ? `<span class="pc-chip muted">+${it.vend.length - MAX_V} tipos</span>` : '');
  return `<div class="pc-itens">
    ${it.farm.length ? `<div class="pc-isec"><span>Farm</span><span>${info}</span></div><div class="pc-chips">${it.farm.map(chip).join('')}</div>` : ''}
    ${it.vend.length ? `<div class="pc-isec"><span>Vendíveis</span><span>${it.vendGemas ? '≈ ' + fmt(it.vendGemas) + ' gemas' : ''}</span></div><div class="pc-chips">${vend}</div>` : ''}
  </div>`;
}
function renderPokeCards() {
  const box = $('pokeCards');
  if (!box || !box.classList.contains('show')) return;
  // seletor de hunt aberto num card: não redesenha agora (a escolha se perderia)
  if (document.activeElement?.matches?.('#pokeCards select')) return;
  const s = cfg.settings;
  const focusName = { off: 'manual', xp: 'XP/h', ouro: 'Ouro/h', shiny: 'Shiny/h' };
  if (!box.querySelector('.pcard')) box.innerHTML = '';
  const seen = new Set();
  for (const a of s.pokeAccounts) {
    seen.add(a.id);
    const i = tileInfo[a.id];
    let card = box.querySelector(`.pcard[data-id="${a.id}"]`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'pcard';
      card.dataset.id = a.id;
      card.onclick = (e) => {
        // ações do menu ⋯ do card repassam pro menu do quadro da conta
        const fwd = e.target.closest('[data-fwd]');
        if (fwd) { pokeViews[a.id]?.closest('.ptile')?.querySelector(`[data-a=${fwd.dataset.fwd}]`)?.click(); return; }
        if (e.target.closest('[data-check]')) { checkNowAccount(a.id); return; }
        if (e.target.closest('select')) return;
        if (e.target.closest('.dd, button')) return;
        s.pokeSel = a.id; s.pokeLayout = 'focus'; save(); applyPokeLayout();
      };
      // seletor de modo no card: repassa pro seletor do quadro (mesma lógica, fica sincronizado)
      card.addEventListener('change', (e) => {
        const sel = e.target.closest('[data-card-focus]');
        if (!sel) return;
        const tileSel = pokeViews[a.id]?.closest('.ptile')?.querySelector('[data-a=focus]');
        if (tileSel) { tileSel.value = sel.value; tileSel.onchange(); }
        sel.blur();
        renderPokeCards();
      });
      box.appendChild(card);
    }
    const isMain = s.pokeMain === a.id;
    card.classList.toggle('main', isMain);
    const st = !i ? 'carregando' : i.login ? 'faça login' : i.outra ? 'aberta em outro lugar' : i.reconn ? 'reconectando' : '';
    const dot = !i ? '' : i.login || i.outra ? 'bad' : i.reconn ? 'warn' : 'ok';
    const xp = perHour(kpi(i, /XP POK/i)) ?? perHour(kpi(i, /XP TREIN/i));
    const gold = perHour(kpi(i, /LUCRO/i));
    const kills = perHour(kpi(i, /ABATES/i));
    const capt = kpi(i, /CAPTURAS/i);
    const cells = [
      ['XP/h', xp != null ? nfc.format(xp) : '—', ''],
      ['Lucro/h', gold != null ? nfc.format(gold) : '—', gold != null && gold < 0 ? 'neg' : ''],
      ['Abates/h', kills != null ? nfc.format(kills) : '—', ''],
      ['Capturas', capt ? capt[1] : '—', ''],
      ['Shiny', i && (i.shinySeen != null || i.shinyCaught != null) ? `${i.shinySeen || 0} / ${i.shinyCaught || 0}` : '—', (i?.shinySeen || i?.shinyCaught) ? 'shiny' : ''],
      isMain ? ['Boosts', boostSummary(), 'boost'] : ['Abates', kpi(i, /ABATES/i)?.[1] || '—', ''],
    ];
    if (card.querySelector('.dd.open') || card.contains(document.activeElement)) continue; // não redesenha com menu/seletor aberto
    const prev = cardPrev[a.id] || {};
    const head = `<div class="pc-head"><span class="sdot ${dot}"></span><b>${a.name}</b>${isMain ? `<span class="tag">${ic('star')}principal</span>` : ''}<span class="grow"></span>
        ${i?.session ? `<span class="pc-time" title="Tempo nessa hunt">${ic('clock')}${i.session}</span>` : ''}
        <button class="iconbtn sm pc-check ${cardChecking.has(a.id) ? 'busy' : ''}" data-check title="${(a.focus || 'off') === 'off' ? 'Conferir a hunt agora (escolha um modo automático no quadro pra ele trocar sozinho)' : 'Conferir a melhor hunt agora'}">${ic('refresh')}</button>
        <div class="dd"><button class="iconbtn sm" title="Opções da conta">${ic('dots')}</button><div class="menu right">
          <button data-fwd="rename">${ic('pencil')} Renomear</button>
          <button data-fwd="zoom">${ic('focus')} Abrir o jogo</button>
          ${isMain ? '' : `<button data-fwd="main">${ic('star')} Tornar principal</button>`}
          ${i?.login ? `<button data-fwd="login">${ic('key')} Login em janela</button>` : ''}
          <button data-fwd="compare">${ic('chart')} Comparar Pokémon</button>
          <button data-fwd="snipe">${ic('target')} Snipe (Rotom Sniper)</button>
          <button data-fwd="reload">${ic('refresh')} Recarregar jogo</button></div></div></div>`;
    // estados sem dados (deslogada, aberta em outro lugar, carregando): um bloco limpo com ação, sem grade vazia
    const semDados = i && !i.login && !i.outra && !i.reconn && !i.pk && !(i.kpis || []).length;
    const state = (!i || semDados) ? { icon: 'loader', spin: true, title: 'Carregando o jogo…', text: 'Isso leva alguns segundos.' }
      : i.login ? { icon: 'lock', title: 'Conta deslogada', text: 'Entre no PokeIdle pra ver a run desta conta.', act: 'login', label: 'Fazer login' }
      : i.outra ? { icon: 'alert', title: 'Aberta em outro lugar', text: 'O jogo só deixa uma sessão por conta.', act: 'reload', label: 'Jogar aqui' }
      : i.reconn ? { icon: 'loader', spin: true, title: 'Reconectando…', text: 'Se demorar mais de 2 min, o app recarrega sozinho.' }
      : i.parada ? { icon: 'alert', title: `Farm parada: ${i.parada.motivo}`, text: `O pokémon em campo morreu há ${Math.round((Date.now() - i.parada.desde) / 60e3)} min. Compre revive/poção no Market do jogo (o app não compra nada).`, act: 'zoom', label: 'Abrir o jogo' }
      : null;
    if (state) {
      card.classList.add('empty');
      card.innerHTML = `${head}<div class="pc-state"><span class="pc-sic ${state.spin ? 'spin' : ''}">${ic(state.icon)}</span>
        <b>${state.title}</b><span>${state.text}</span>
        ${state.act ? `<button class="accent sm" data-act="${state.act}">${state.label}</button>` : ''}</div>`;
      const b = card.querySelector('[data-act]');
      if (b) b.onclick = (e) => {
        e.stopPropagation();
        if (state.act === 'login') window.api.login('pokeidle', 'persist:' + a.id);
        else if (state.act === 'zoom') pokeViews[a.id]?.closest('.ptile')?.querySelector('[data-a=zoom]')?.click();
        else pokeViews[a.id]?.reload();
      };
      cardPrev[a.id] = {};
      continue;
    }
    card.classList.remove('empty');
    const html = `${head}
      <div class="pc-sub">${i.pk || '—'} Nv ${fmt(i.plvl)} <span class="muted2">· treinador ${fmt(i.tlvl)}</span></div>
      <div class="pc-hunt"><span class="pc-hname">${ic('pin')}${i.hunt ? i.hunt.replace(/ \((\d+)\)$/, ' · nível $1') : 'sem hunt'}</span>
        <select class="pc-mode ${(a.focus || 'off') === 'off' ? 'off' : ''}" data-card-focus title="Como escolher a hunt desta conta">
          ${[['off', 'Hunt manual'], ['xp', 'Auto: XP/h'], ['ouro', 'Auto: Ouro/h'], ['shiny', 'Auto: Shiny/h']]
            .map(([v, l]) => `<option value="${v}" ${(a.focus || 'off') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${(a.focus || 'off') !== 'off' && window.huntStatusTxt ? `<div class="pc-hst">${huntStatusTxt(a.id)}</div>` : ''}
      <div class="pc-grid">${cells.map(([l, v, cls]) => `<div class="${cls} ${prev[l] !== undefined && prev[l] !== v ? 'flash' : ''}"><small>${l}</small><b>${v}</b></div>`).join('')}</div>
      ${window.itensDaConta ? cardItens(a.id) : ''}`;
    card.innerHTML = html;
    cardPrev[a.id] = Object.fromEntries(cells.map(([l, v]) => [l, v]));
  }
  box.querySelectorAll('.pcard').forEach(c => { if (!seen.has(c.dataset.id)) c.remove(); });
  box.classList.toggle('n1', s.pokeAccounts.length === 1);
}

// ↻ do card: atualiza os dados e confere a hunt dessa conta na hora
const cardChecking = new Set();
async function checkNowAccount(id) {
  if (cardChecking.has(id)) return;
  cardChecking.add(id); renderPokeCards();
  try {
    const a = cfg.settings.pokeAccounts.find(x => x.id === id);
    if (!a.focus || a.focus === 'off') blog(`${a.name}: hunt está no manual. Escolha XP/Ouro/Shiny no quadro pra ele trocar sozinho.`, '', 'hunt');
    else await window.huntCheckAccount(id, true);
    await refreshTileInfo();
  } finally { cardChecking.delete(id); renderPokeCards(); }
}

function boostSummary() {
  // "XP 6h/8h · Cap 3h" = tempo restante na Twitch / na Kick
  const short = { xp: 'XP', capture: 'Cap', lure: 'Lure' };
  const parts = [];
  for (const k of ['xp', 'capture', 'lure']) {
    const t = ['twitch', 'kick'].map(p => (Array.isArray(boostState[p]) ? boostState[p] : []).find(r => typeOf(r.name) === k && r.time))
      .map(r => r ? r.time.replace(/\s+\d+m$/, '').replace(/^(\d+m)\s+\d+s$/, '$1') : '—');
    if (t.some(x => x !== '—')) parts.push(`${short[k]} ${t.join('/')}`);
  }
  return parts.length ? parts.join(' · ') : '—';
}

// layout: 'grid' (2×2), 'main3' (uma grande + as outras do lado), 'focus' (só a selecionada)
function applyPokeLayout() {
  const s = cfg.settings, accs = s.pokeAccounts, view = $('pokeView');
  if (!accs.find(a => a.id === s.pokeSel)) s.pokeSel = s.pokeMain;
  const layout = accs.length === 1 && s.pokeLayout !== 'cards' ? 'grid' : s.pokeLayout || 'grid';
  const n = accs.length;
  // Cards: cobre os jogos (que continuam em grade por baixo, sendo desenhados)
  $('pokeCards').classList.toggle('show', layout === 'cards');
  if (layout === 'cards') renderPokeCards();
  for (const a of accs) {
    const t = pokeViews[a.id]?.closest('.ptile');
    if (!t) continue;
    t.style.gridColumn = t.style.gridRow = '';
    t.classList.toggle('solo', layout === 'focus' && a.id === s.pokeSel);
  }
  if (layout === 'main3') {
    view.style.gridTemplateColumns = '3fr 1fr';
    view.style.gridTemplateRows = `repeat(${n - 1}, 1fr)`;
    let row = 1;
    for (const a of accs) {
      const t = pokeViews[a.id]?.closest('.ptile');
      if (!t) continue;
      if (a.id === s.pokeSel) { t.style.gridColumn = '1'; t.style.gridRow = `1 / span ${n - 1}`; }
      else { t.style.gridColumn = '2'; t.style.gridRow = String(row++); }
    }
  } else {
    view.style.gridTemplateColumns = n === 1 ? '1fr' : '1fr 1fr';
    view.style.gridTemplateRows = n <= 2 ? '1fr' : '1fr 1fr';
  }
  renderPokeChips();
  setTimeout(fitAllPokeZoom, 150);
}

function renderPokeChips() {
  const s = cfg.settings, box = $('pokeChips');
  if (!box) return;
  const layout = s.pokeLayout || 'grid';
  const lay = [['cards', 'cards', 'Cards'], ['grid', 'grid', 'Grade'], ['main3', 'layout', '1+3'], ['focus', 'focus', 'Foco']]
    .map(([k, i, l]) => `<button data-lay="${k}" class="${layout === k ? 'on' : ''}">${ic(i)}${l}</button>`).join('');
  const selShown = layout === 'focus' || layout === 'main3';
  const chips = s.pokeAccounts.map(a => {
    const i = tileInfo[a.id];
    const dot = !i ? '' : i.login || i.outra ? 'bad' : i.reconn ? 'warn' : 'ok';
    return `<button data-acc="${a.id}" class="acc ${selShown && s.pokeSel === a.id ? 'on' : ''}" title="${i?.hunt ? 'Caçando ' + i.hunt : ''}"><span class="dot ${dot}"></span>${s.pokeMain === a.id ? ic('star', 'mainstar') : ''}${a.name}</button>`;
  }).join('');
  box.innerHTML = `<span class="seg">${lay}</span><span class="accs">${chips}</span>`;
  box.querySelectorAll('[data-lay]').forEach(b => b.onclick = () => { s.pokeLayout = b.dataset.lay; save(); applyPokeLayout(); });
  box.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => {
    s.pokeSel = b.dataset.acc;
    if (['grid', 'cards'].includes(s.pokeLayout || 'grid')) s.pokeLayout = 'focus'; // na grade/cards, clicar na conta = ver só ela
    save(); applyPokeLayout();
  });
}

// tela cheia: o quadro cobre a janela inteira e a janela entra em tela cheia
const closeMenus = () => document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open'));
function setPokeFull(tile) {
  document.querySelectorAll('.ptile.full').forEach(t => t.classList.remove('full'));
  if (tile) tile.classList.add('full');
  window.api.fullscreen(!!tile);
  setTimeout(fitAllPokeZoom, 300);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.querySelector('.ptile.full')) setPokeFull(null); });

function buildPokeHub() {
  const accs = cfg.settings.pokeAccounts;
  const view = $('pokeView');
  // remove as que saíram
  for (const id of Object.keys(pokeViews)) if (!accs.find(a => a.id === id)) { pokeViews[id].closest('.ptile').remove(); delete pokeViews[id]; }
  accs.forEach((a) => {
    let tile = pokeViews[a.id]?.closest('.ptile');
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'ptile';
      tile.innerHTML = `<div class="tbar"><span class="sdot"></span><span class="star"></span><input title="Nome da conta (clique pra renomear)"><span class="tinfo">carregando…</span>
        <button class="fullExit" data-a="fullx" title="Sair da tela cheia (Esc)">Sair da tela cheia</button>
        <label class="hsel" title="Troca automática de hunt (usa a extensão /hunt)">${ic('pin')}<select data-a="focus">
          <option value="off">Hunt manual</option><option value="xp">Auto: XP/h</option>
          <option value="ouro">Auto: Ouro/h</option><option value="shiny">Auto: Shiny/h</option></select></label>
        <div class="dd"><button class="iconbtn sm" title="Opções da conta">${ic('dots')}</button>
          <div class="menu right">
            <div class="mtitle">Conta</div>
            <button data-a="rename">${ic('pencil')} Renomear</button>
            <button data-a="zoom">${ic('focus')} Ver só esta</button>
            <button data-a="full">${ic('fullscreen')} Tela cheia</button>
            <button data-a="main" title="Conta com Twitch/Kick vinculadas: o resgate automático usa ela">${ic('star')} Tornar principal</button>
            <button data-a="login" hidden>${ic('key')} Login em janela</button>
            <button data-a="compare">${ic('chart')} Comparar Pokémon</button>
            <button data-a="snipe">${ic('target')} Snipe (Rotom Sniper)</button>
            <button data-a="snipeoff" hidden>${ic('x')} Desligar snipe</button>
            <button data-a="reload">${ic('refresh')} Recarregar jogo</button>
            <button data-a="remove" class="danger">${ic('trash')} Tirar do hub</button>
          </div></div></div>`;
      const wv = document.createElement('webview');
      wv.setAttribute('partition', 'persist:' + a.id);
      wv.setAttribute('allowpopups', ''); // sem isso o link nem chega no main (que manda pro navegador do PC)
      if (pokePreloadUrl) wv.setAttribute('preload', pokePreloadUrl); // injeta a /hunt
      wv.src = 'https://pokeidle.io/app';
      wv.addEventListener('dom-ready', () => {
        wv.setAudioMuted(!!cfg.settings.mutePc);
        fitPokeZoom(wv);
        if (huntExtInfo?.css) wv.insertCSS(huntExtInfo.css).catch(() => {});
      });
      const sel = tile.querySelector('[data-a=focus]');
      sel.value = a.focus || 'off';
      sel.onchange = () => {
        a.focus = sel.value; save();
        blog(`${a.name}: hunt ${sel.value === 'off' ? 'manual' : 'automática por ' + sel.value}.`);
        if (a.focus !== 'off' && window.huntCheckAccount) window.huntCheckAccount(a.id, true);
      };
      // botão "Avaliar" num anúncio do Mercado: abre o Avaliador com aquele anúncio
      wv.addEventListener('ipc-message', (ev) => { if (ev.channel === 'avaliar' && ev.args?.[0]) window.api.avaliar(ev.args[0]); });
      // a página do jogo quebrou (falta de memória, crash): recarrega
      wv.addEventListener('render-process-gone', () => {
        blog(`${a.name}: a página do jogo caiu. Recarregando.`, 'err');
        setTimeout(() => { try { wv.reload(); } catch { /* */ } }, 3000);
      });
      tile.appendChild(wv);
      pokeViews[a.id] = wv;
      const inp = tile.querySelector('input');
      inp.value = a.name;
      inp.onchange = () => { a.name = inp.value.trim() || a.name; inp.value = a.name; save(); renderPokeChips(); renderPokeCards(); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = a.name; inp.blur(); } };
      tile.querySelector('[data-a=rename]').onclick = () => {
        // no modo Cards o quadro está escondido: mostra a conta antes de renomear
        if (cfg.settings.pokeLayout === 'cards') { cfg.settings.pokeSel = a.id; cfg.settings.pokeLayout = 'focus'; save(); applyPokeLayout(); }
        setTimeout(() => { inp.focus(); inp.select(); }, 50);
      };
      tile.querySelector('[data-a=main]').onclick = () => { cfg.settings.pokeMain = a.id; save(); buildPokeHub(); blog(`Conta principal agora é ${a.name}.`); };
      tile.querySelector('[data-a=login]').onclick = () => window.api.login('pokeidle', 'persist:' + a.id);
      tile.querySelector('[data-a=reload]').onclick = () => { if (pokeHealthState[a.id]) pokeHealthState[a.id].emOutroLugar = false; wv.reload(); };
      tile.querySelector('[data-a=snipe]').onclick = () => { closeMenus(); openSnipe(a.id); };
      tile.querySelector('[data-a=compare]').onclick = () => { closeMenus(); window.api.comparar(a.id); };
      tile.querySelector('[data-a=snipeoff]').onclick = () => { closeMenus(); stopSnipe(a.id); };
      tile.querySelector('[data-a=full]').onclick = () => { closeMenus(); setPokeFull(tile.classList.contains('full') ? null : tile); };
      tile.querySelector('[data-a=fullx]').onclick = () => setPokeFull(null);
      tile.querySelector('[data-a=zoom]').onclick = () => {
        const s = cfg.settings;
        if (s.pokeLayout === 'focus' && s.pokeSel === a.id) s.pokeLayout = s.pokePrevLayout || 'grid';
        else { if (s.pokeLayout !== 'focus') s.pokePrevLayout = s.pokeLayout || 'grid'; s.pokeLayout = 'focus'; s.pokeSel = a.id; }
        save(); applyPokeLayout();
      };
      tile.querySelector('[data-a=remove]').onclick = () => {
        if (cfg.settings.pokeAccounts.length === 1) { alert('Precisa ter pelo menos uma conta.'); return; }
        if (!confirm(`Tirar a conta "${a.name}" do hub? O login dela fica salvo se você adicionar de novo.`)) return;
        cfg.settings.pokeAccounts = cfg.settings.pokeAccounts.filter(x => x.id !== a.id);
        if (cfg.settings.pokeMain === a.id) cfg.settings.pokeMain = cfg.settings.pokeAccounts[0].id;
        save(); buildPokeHub();
      };
    }
    view.appendChild(tile); // mantém a ordem
    const isMain = cfg.settings.pokeMain === a.id;
    tile.classList.toggle('main', isMain);
    tile.querySelector('.star').innerHTML = isMain ? ic('star') : '';
    tile.querySelector('[data-a=main]').hidden = isMain;
    tile.querySelector('[data-a=snipeoff]').hidden = !a.snipe;
  });
  renderSnipeMenu();
  pokeWv = pokeViews[cfg.settings.pokeMain] || null;
  $('pokeAdd').hidden = accs.length >= MAX_ACCOUNTS; // já tem 4 contas (o máximo do jogo): some
  applyPokeLayout();
}

// ---------- comparador: os Pokémon de cada conta, com os dados que a ficha pede ----------
function pagePokemons() {
  const eu = window.__plEu || {};
  return (eu.pokemons || []).filter(p => p && p.speciesId).map(p => ({
    id: p.id, nome: p.apelido || p.nome || p.name || ('#' + p.speciesId), speciesId: p.speciesId, level: p.level,
    potencia: p.potencia, quality: p.quality, shiny: !!p.shiny, ivs: p.ivs || null, refino: p.refino || {},
    tmElemental: typeof p.tmElemental === 'string' ? p.tmElemental : null, ativo: p.id === eu.activeId,
  }));
}
window.listarPokemons = async function () {
  const out = [];
  for (const a of cfg.settings.pokeAccounts) {
    const wv = pokeViews[a.id];
    let pokemons = [];
    if (wv) { try { pokemons = await runIn(wv, pagePokemons); } catch { pokemons = []; } }
    pokemons.sort((x, y) => (y.ativo - x.ativo) || (y.level || 0) - (x.level || 0));
    out.push({ id: a.id, nome: a.name, pokemons });
  }
  return out;
};

// ---------- Rotom Sniper ----------
// Abre o Cockpit da extensão na conta escolhida. Na primeira vez liga a extensão naquela conta e
// recarrega o jogo (ela precisa entrar junto com a página). Fica ligada nas próximas aberturas do app.
function reloadPoke(id) {
  const wv = pokeViews[id];
  if (!wv) return;
  try { wv.reload(); } catch { wv.src = 'https://pokeidle.io/app'; } // ainda carregando: começa de novo
}
async function openSnipe(id) {
  const a = cfg.settings.pokeAccounts.find(x => x.id === id);
  if (!a) return;
  const r = await window.api.snipeOpen('persist:' + id, a.name);
  if (r.error) { blog(`${a.name}: ${r.error}.`, 'err', 'sistema'); alert(r.error); return; }
  if (!a.snipe) { a.snipe = true; save(); buildPokeHub(); }
  if (r.loadedNow) {
    reloadPoke(id);
    blog(`${a.name}: Rotom Sniper ${r.version} ligado. Recarreguei o jogo pra extensão entrar.`, 'ok', 'conta');
  }
}
async function stopSnipe(id) {
  const a = cfg.settings.pokeAccounts.find(x => x.id === id);
  if (!a || !confirm(`Desligar o Rotom Sniper na conta "${a.name}"? O jogo recarrega e o snipe para.`)) return;
  await window.api.snipeDisable('persist:' + id);
  a.snipe = false; save(); buildPokeHub();
  reloadPoke(id);
  blog(`${a.name}: Rotom Sniper desligado.`, 'ok', 'conta');
}
function renderSnipeMenu() {
  if ($('compareBtn') && !$('compareBtn').onclick) $('compareBtn').onclick = () => window.api.comparar(cfg.settings.pokeSel || cfg.settings.pokeMain);
  const m = $('snipeMenu');
  if (!m) return;
  m.innerHTML = '<div class="mtitle">Abrir Cockpit na conta</div>' + cfg.settings.pokeAccounts.map(a =>
    `<button data-id="${a.id}">${ic(a.snipe ? 'target' : 'plus')} ${String(a.name).replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`)}${a.snipe ? ' <span class="muted">· ligado</span>' : ''}</button>`).join('');
  m.querySelectorAll('button').forEach(b => b.onclick = () => { closeMenus(); openSnipe(b.dataset.id); });
}

// Quadro pequeno faz o jogo trocar pro layout de celular (botões no Menu, sem a barra lateral
// e sem o /hunt). Reduz o zoom pra página "enxergar" pelo menos 1400 px de largura.
// Fica no tamanho normal (layout menor, como o jogo escolhe). Só durante a leitura da /hunt e dos
// bônus, que somem nesse layout, o zoom diminui por alguns segundos e depois volta.
const POKE_MIN_CSS_WIDTH = 1400;
const desktopUsers = new Map(); // wv -> quantas automações pediram o layout de computador
function fitPokeZoom(wv) {
  const z = desktopUsers.get(wv) ? Math.max(0.35, Math.min(1, (wv.clientWidth || 600) / POKE_MIN_CSS_WIDTH)) : 1;
  try { if (Math.abs(wv.getZoomFactor() - z) > 0.01) wv.setZoomFactor(z); } catch { /* ainda carregando */ }
}
async function withDesktop(wv, fn) {
  desktopUsers.set(wv, (desktopUsers.get(wv) || 0) + 1);
  fitPokeZoom(wv);
  await sleep(1200); // o jogo refaz o layout
  try { return await fn(); }
  finally {
    desktopUsers.set(wv, desktopUsers.get(wv) - 1);
    fitPokeZoom(wv);
  }
}
function fitAllPokeZoom() { Object.values(pokeViews).forEach(fitPokeZoom); }
window.addEventListener('resize', () => setTimeout(fitAllPokeZoom, 100));

function addPokeAccount() {
  const accs = cfg.settings.pokeAccounts;
  if (accs.length >= MAX_ACCOUNTS) return;
  // reaproveita ids poke-2..4 pra manter logins antigos
  const used = new Set(accs.map(a => a.id));
  const id = ['poke', 'poke-2', 'poke-3', 'poke-4'].find(x => !used.has(x));
  accs.push({ id, name: 'Conta ' + (accs.length + 1) });
  save(); buildPokeHub();
  blog(`Conta adicionada. Faça login nela no quadro novo.`);
}

(async function boostInit() {
  while (!cfg) await sleep(100);
  setupLogFilter();
  if (location.search.includes('nopoke')) { cfg.settings.pokeAccounts = []; return; } // modo de teste
  cfg.settings.boost ||= { xp: true, capture: false, lure: false, auto: false, confirm: true };
  const s = cfg.settings.boost;
  for (const [id, k] of [['bXp', 'xp'], ['bCapture', 'capture'], ['bLure', 'lure'], ['bAuto', 'auto'], ['bConfirm', 'confirm']]) {
    $(id).checked = !!s[k];
    $(id).onchange = () => {
      s[k] = $(id).checked; save(); renderBoostTable();
      if (k === 'auto') blog(s.auto ? 'Resgate automático ligado.' : 'Resgate automático desligado.');
      if (k === 'auto' && s.auto) boostCycle();
    };
  }
  $('openPoke').onclick = () => { $('poke').classList.remove('closed'); setTimeout(fitAllPokeZoom, 100); };
  $('pokeClose').onclick = () => { setPokeFull(null); $('poke').classList.add('closed'); };
  $('bCheck').onclick = () => boostCycle(true);
  $('pokeAdd').onclick = addPokeAccount;
  // medido: com os jogos sem desenhar, a caçada rende ~17% menos XP. Por isso vem desligado.
  if (!cfg.settings.pokeLightV2) { cfg.settings.pokeLight = false; cfg.settings.pokeLightV2 = true; }
  $('pokeLight').checked = cfg.settings.pokeLight;
  $('poke').classList.toggle('leve', cfg.settings.pokeLight);
  $('pokeLight').onchange = () => { cfg.settings.pokeLight = $('pokeLight').checked; save(); $('poke').classList.toggle('leve', cfg.settings.pokeLight); };
  cfg.settings.pokeAccounts ||= [{ id: 'poke', name: 'Principal' }]; // 'poke' = login que você já fez
  cfg.settings.pokeMain ||= cfg.settings.pokeAccounts[0].id;
  $('mutePc').addEventListener('change', () => Object.values(pokeViews).forEach(w => w.setAudioMuted(!!cfg.settings.mutePc)));
  try {
    pokePreloadUrl = (await window.api.paths()).pokePreload;
    huntExtInfo = await window.api.huntExtInfo();
  } catch { /* segue sem a /hunt */ }
  buildPokeHub();
  setInterval(refreshTileInfo, 15e3);
  setTimeout(refreshTileInfo, 8e3);
  if (huntExtInfo?.error) blog('Troca automática de hunt indisponível: ' + huntExtInfo.error + '.', 'err');
  else if (huntExtInfo) blog(`Extensão /hunt v${huntExtInfo.version} carregada.`, '', 'sistema');
  renderBoostTable();
  blog('Faça login no PokeIdle aqui uma vez. Conferindo a cada ' + CHECK_MIN + ' min.', '', 'sistema');
  setTimeout(() => boostCycle(), 45e3); // espera o jogo e as lives carregarem
  boostTimer = setInterval(() => boostCycle(), CHECK_MIN * 60e3);
})();
