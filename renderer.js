const PLATFORMS = ['twitch', 'kick'];
let cfg, status = {}, filter = 'all', timer = null, checking = false;
const slots = { twitch: [], kick: [] }; // cada slot: { el, wv, channel }

const $ = (id) => document.getElementById(id);
const key = (c) => c.platform + ':' + c.name.toLowerCase();
const urlOf = (c) => c.platform === 'twitch' ? 'https://www.twitch.tv/' + c.name.toLowerCase() : 'https://kick.com/' + c.name.toLowerCase();
const partition = () => cfg.settings.secondary ? 'persist:alt' : 'persist:main';
// cópia de teste nunca grava a configuração (não pode estragar a do app de verdade)
const save = () => location.search.includes('test=1') ? Promise.resolve(false) : window.api.saveConfig(cfg);
const fmt = (n) => n == null ? '' : n.toLocaleString('pt-BR');

// ---------- avisos do Windows ----------
const notifyLast = {};
function notify(title, body, key = title, everyMin = 30) {
  if (cfg?.settings?.notify === false) return;
  if (notifyLast[key] && Date.now() - notifyLast[key] < everyMin * 60e3) return; // não repete o mesmo aviso
  notifyLast[key] = Date.now();
  try { new Notification(title, { body }); } catch { /* sem permissão de aviso */ }
}

// ---------- vigia das lives: vídeo parado por muito tempo = recarrega ----------
const STUCK_RELOAD = 90e3;
async function watchdogLives() {
  for (const p of PLATFORMS) for (const s of slots[p]) {
    if (!s.wv || !s.channel || Date.now() - (s.loadedAt || 0) < 120e3) continue; // dá tempo de carregar
    const v = await s.wv.executeJavaScript(`(() => { const v = document.querySelector('video'); return v ? v.currentTime : -1; })()`).catch(() => null);
    const moved = v != null && v >= 0 && s.lastT != null && Math.abs(v - s.lastT) > 0.5;
    if (v == null || v < 0 || (s.lastT != null && !moved)) s.stuckSince ||= Date.now(); else s.stuckSince = null;
    s.lastT = v;
    if (s.stuckSince && Date.now() - s.stuckSince > STUCK_RELOAD) {
      console.log('[poke-lives] live travada, recarregando', s.channel.name);
      s.stuckSince = null; s.lastT = null; s.loadedAt = Date.now();
      s.wv.reload();
      (s.reloads ||= []).push(Date.now());
      s.reloads = s.reloads.filter(t => Date.now() - t < 30 * 60e3);
      if (s.reloads.length >= 3) notify('Live travando', `${s.channel.name} (${p}) travou ${s.reloads.length}x em 30 min. Talvez a live tenha caído.`, 'stuck:' + key(s.channel));
    }
  }
}

// ---------- script injetado em cada live ----------
function injectScript(platform) {
  const s = cfg.settings;
  return `(() => {
    const platform = ${JSON.stringify(platform)};
    const economy = ${!!s.economy};
    const autoBonus = ${!!s.autoBonus};
    try {
      if (platform === 'twitch') {
        const want = economy ? '160p30' : 'chunked';
        const cur = localStorage.getItem('video-quality');
        localStorage.setItem('video-quality', JSON.stringify({ default: want }));
        if (economy && (!cur || !cur.includes(want)) && !sessionStorage.getItem('pl-reloaded')) {
          sessionStorage.setItem('pl-reloaded', '1'); location.reload(); return;
        }
      } else {
        localStorage.setItem('stream_quality', economy ? '160' : 'auto');
      }
    } catch (e) {}
    if (window.__plTimer) clearInterval(window.__plTimer);
    window.__plTimer = setInterval(() => {
      // mantém o vídeo rodando
      const v = document.querySelector('video');
      if (v && v.paused && v.readyState > 1) v.play().catch(() => {});
      // Kick: confirma o aviso de "conteúdo adulto" (senão a live e o saldo não aparecem)
      if (platform === 'kick') {
        const adulto = [...document.querySelectorAll('button')].filter(b => b.offsetParent).find(b => /tenho 18 anos|18 anos ou mais|i am 18|18 or older/i.test(b.innerText || ''));
        if (adulto) adulto.click();
      }
      // Twitch: chat recolhido esconde o saldo de pontos e o baú; reabre
      if (platform === 'twitch') {
        const t = document.querySelector('[data-a-target="right-column__toggle-collapse-btn"]');
        if (t && /expand|expandir|mostrar|show/i.test(t.getAttribute('aria-label') || '') && (!window.__plExp || Date.now() - window.__plExp > 60000)) {
          window.__plExp = Date.now(); t.click();
        }
      }
      if (!autoBonus) return;
      // baú de bônus da Twitch
      const icon = document.querySelector('.claimable-bonus__icon');
      const btn = icon ? icon.closest('button') :
        [...document.querySelectorAll('button[aria-label]')].find(b => /claim bonus|resgatar b[ôo]nus|coletar b[ôo]nus/i.test(b.getAttribute('aria-label')));
      if (btn) { btn.click(); console.log('[poke-lives] bônus resgatado'); }
    }, 5000);
  })();`;
}

// "Chat leve": esconde as mensagens do chat e a barra lateral (o que mais pesa e cresce com o tempo).
// O campo de mensagem, o saldo de pontos e o baú de bônus continuam lá.
const LIGHT_CSS = {
  twitch: `.chat-scrollable-area__message-container, [data-test-selector="chat-scrollable-area__message-container"],
    .side-nav, [data-a-target="side-nav-bar"], [data-a-target="side-nav-bar-collapsed"], .channel-panels, .channel-root__panels,
    .community-highlight-stack__card, .stream-chat-header + div .chat-room__notifications { display: none !important; }`,
  // cuidado: na Kick o bloco principal da página também tem [data-sidebar]; não usar seletores genéricos
  kick: `#chatroom-messages, [data-chat-entry], #sidebar-wrapper { display: none !important; }`,
};
const RELOAD_LIVE_EVERY = 3 * 3600e3; // recarrega cada live a cada 3 h pra liberar memória

function reloadOldSlot() {
  // no máximo uma por vez, pra nunca ficar sem nenhuma rodando
  const old = PLATFORMS.flatMap(p => slots[p]).filter(s => s.wv && s.loadedAt && Date.now() - s.loadedAt > RELOAD_LIVE_EVERY)
    .sort((a, b) => a.loadedAt - b.loadedAt)[0];
  if (old) { old.loadedAt = Date.now(); old.wv.reload(); }
}

async function showMemory() {
  const m = await window.api.metrics();
  const nome = (u) => /twitch\.tv\/(\w+)/.test(u) ? 'Twitch ' + u.split('/')[1] : /kick\.com\/(\w+)/.test(u) ? 'Kick ' + u.split('/')[1] : /pokeidle/.test(u) ? 'PokeIdle' : u || '?';
  const linhas = m.pages.filter(p => p.type !== 'remote').sort((a, b) => b.mb - a.mb)
    .map(p => `${String(p.mb).padStart(5)} MB  ${p.cpu}% CPU  ${p.type === 'window' ? 'Poke Lives (tela)' : nome(p.url)}`);
  const outros = m.other.reduce((s, o) => s + o.mb, 0);
  alert(`Memória total: ${m.total} MB\n\n${linhas.join('\n')}\n${String(outros).padStart(5)} MB  GPU / rede / outros\n\nDica: cada live pesa bastante. Menos lives por plataforma = menos memória.`);
}

// ---------- grade ----------
function buildGrid() {
  const grid = $('grid');
  grid.innerHTML = '';
  const n = cfg.settings.perPlatform;
  grid.style.gridTemplateColumns = '1fr 1fr';
  grid.style.gridTemplateRows = `repeat(${n}, 1fr)`;
  grid.style.gridAutoFlow = 'column';
  for (const p of PLATFORMS) {
    slots[p] = [];
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      grid.appendChild(el);
      const slot = { el, wv: null, channel: null, platform: p };
      slots[p].push(slot);
      renderSlot(slot);
    }
  }
}

function renderSlot(slot) {
  const { el, channel, platform } = slot;
  el.innerHTML = '';
  slot.wv = null;
  const bar = document.createElement('div');
  bar.className = 'bar';
  const label = channel ? `<b>${channel.name}</b> <span class="muted">${fmt(status[key(channel)]?.viewers)}</span>` : '<span class="muted">vazio</span>';
  bar.innerHTML = `<span class="plat ${platform}">${platform}</span>${label}<span class="grow"></span>`;
  el.appendChild(bar);
  if (!channel) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = `Nenhum canal da ${platform === 'twitch' ? 'Twitch' : 'Kick'} ao vivo pra este espaço.`;
    el.appendChild(e);
    return;
  }
  const reload = document.createElement('button');
  reload.textContent = 'Recarregar';
  bar.appendChild(reload);
  const wv = document.createElement('webview');
  wv.setAttribute('partition', partition());
  wv.setAttribute('allowpopups', '');
  wv.src = urlOf(channel);
  slot.loadedAt = Date.now();
  wv.addEventListener('dom-ready', () => {
    wv.setAudioMuted(!!cfg.settings.mutePc);
    wv.executeJavaScript(injectScript(platform)).catch(() => {});
    if (cfg.settings.lightChat !== false) wv.insertCSS(LIGHT_CSS[platform]).catch(() => {});
  });
  reload.onclick = () => wv.reload();
  // página da live quebrou (falta de memória, crash): recarrega
  wv.addEventListener('render-process-gone', () => setTimeout(() => { try { wv.reload(); slot.loadedAt = Date.now(); } catch { renderSlot(slot); } }, 3000));
  el.appendChild(wv);
  slot.wv = wv;
}

function updateSlotLabels() {
  for (const p of PLATFORMS) for (const s of slots[p]) {
    if (!s.channel) continue;
    const span = s.el.querySelector('.bar .muted');
    if (span) span.textContent = fmt(status[key(s.channel)]?.viewers);
  }
}

// escolhe quem fica aberto: fixados primeiro, depois a ordem da lista
// canais que você mandou assistir (ficam na grade até "Parar de assistir"; não sobrevive a fechar o app)
const watching = new Set();
function toggleWatch(c) {
  const k = key(c);
  if (watching.has(k)) watching.delete(k);
  else {
    // no máximo o número de vagas da plataforma: o mais antigo sai
    const same = [...watching].filter(x => x.startsWith(c.platform + ':'));
    if (same.length >= slots[c.platform].length) watching.delete(same[0]);
    watching.add(k);
  }
  assign();
}

function assign() {
  for (const p of PLATFORMS) {
    const live = cfg.channels.filter(c => c.platform === p && !c.paused && status[key(c)]?.live);
    // fixados primeiro; depois (opção "Mais pontos") quem tem mais saldo; depois a ordem da lista
    const bal = (c) => (window.pointsOf && pointsOf(c)?.balance) ?? -1;
    const byPoints = (cfg.settings.priority || 'points') === 'points';
    live.sort((a, b) => (b.pinned - a.pinned) || (byPoints ? bal(b) - bal(a) : 0) || (cfg.channels.indexOf(a) - cfg.channels.indexOf(b)));
    // "Assistir": canais escolhidos na mão entram primeiro (mesmo offline), até você parar
    const forced = cfg.channels.filter(c => c.platform === p && watching.has(key(c)));
    const desired = [...forced, ...live.filter(c => !watching.has(key(c)))].slice(0, slots[p].length);
    const desiredKeys = new Set(desired.map(key));
    const kept = new Set();
    for (const s of slots[p]) {
      if (s.channel && desiredKeys.has(key(s.channel))) kept.add(key(s.channel));
      else if (s.channel) { s.channel = null; s.dirty = true; }
    }
    const queue = desired.filter(c => !kept.has(key(c)));
    for (const s of slots[p]) {
      if (!s.channel && queue.length) { s.channel = queue.shift(); s.dirty = true; }
      if (s.dirty) { s.dirty = false; renderSlot(s); }
    }
  }
  updateSlotLabels();
  renderList();
}

// ---------- checagem ----------
async function checkAll() {
  if (checking) return;
  checking = true;
  $('checkNow').disabled = true;
  $('checkNow').innerHTML = ic('loader', 'spinning') + 'Verificando…';
  try {
    const list = cfg.channels.filter(c => !c.paused).map(c => ({ platform: c.platform, name: c.name }));
    const res = await window.api.check(list);
    for (const [k, v] of Object.entries(res)) {
      // em caso de erro, mantém o último estado conhecido
      status[k] = v.error ? { ...(status[k] || {}), error: v.error } : v;
    }
    $('lastCheck').textContent = 'Última checagem: ' + new Date().toLocaleTimeString('pt-BR') +
      ` · ${Object.values(status).filter(s => s.live).length} ao vivo`;
    assign();
    reloadOldSlot();
    if (window.pointsFromSlots) pointsFromSlots().then(renderList).catch(() => {});
    watchdogLives().catch(() => {});
  } finally {
    checking = false;
    $('checkNow').disabled = false;
    $('checkNow').innerHTML = ic('refresh') + 'Verificar agora';
  }
}

function restartTimer() {
  clearInterval(timer);
  timer = setInterval(checkAll, cfg.settings.interval * 1000);
}

// ---------- lista ----------
function isOpen(c) {
  return slots[c.platform].some(s => s.channel && key(s.channel) === key(c));
}

function renderList() {
  const ul = $('list');
  ul.innerHTML = '';
  cfg.channels.forEach((c, i) => {
    const st = status[key(c)];
    if (filter === 'twitch' || filter === 'kick') { if (c.platform !== filter) return; }
    if (filter === 'live' && !st?.live) return;
    if (filter === 'pts' && !((window.pointsOf && pointsOf(c)?.balance) >= 300)) return;
    const li = document.createElement('li');
    if (st?.live) li.classList.add('live');
    if (isOpen(c)) li.classList.add('open');
    let cls = '', txt = 'verificando';
    if (c.paused) { cls = 'paused'; txt = 'pausado'; }
    else if (st?.live) { cls = 'live'; txt = 'ao vivo' + (st.viewers != null ? ' · ' + fmt(st.viewers) + ' assistindo' : ''); }
    else if (st && st.live === false) txt = 'offline';
    if (st?.error && !c.paused) { cls += ' error'; txt += ' (erro na checagem)'; }
    li.classList.add(c.platform);
    if (c.paused) li.classList.add('paused');
    li.innerHTML = `<div class="ch-main">
        <div class="ch-top"><span class="plat ${c.platform}">${c.platform === 'twitch' ? 'Twitch' : 'Kick'}</span>
          <span class="name">${c.pinned ? `<span class="pin" title="Fixado">${ic('star')}</span>` : ''}${c.name}</span>
          ${isOpen(c) ? `<span class="onscreen" title="Aberta na grade">${ic('eye')}na tela</span>` : ''}</div>
        <div class="status ${cls}"><span class="dot"></span>${txt}</div>
        ${window.pointsLabel ? pointsLabel(c) : ''}
      </div><div class="actions"></div>`;
    const actions = li.querySelector('.actions');
    const btn = (icon, title, fn) => { const b = document.createElement('button'); b.innerHTML = ic(icon); b.title = title; b.onclick = fn; actions.appendChild(b); };
    // botão principal do card: Assistir / Parar de assistir
    const w = document.createElement('button');
    const isW = watching.has(key(c));
    w.className = 'watch' + (isW ? ' on' : '');
    w.innerHTML = isW ? `${ic('x')}Parar` : `${ic('play')}Assistir`;
    w.title = isW ? 'Voltar a escolher sozinho' : `Colocar na grade no lugar de uma live da ${c.platform === 'twitch' ? 'Twitch' : 'Kick'}${st?.live ? '' : ' (está offline: não rende pontos)'}`;
    w.onclick = () => toggleWatch(c);
    li.querySelector('.ch-main').appendChild(w);
    if (isW) li.classList.add('watching');
    btn(c.paused ? 'play' : 'pause', c.paused ? 'Retomar' : 'Pausar', () => { c.paused = !c.paused; save(); assign(); if (!c.paused) checkAll(); });
    btn('star', c.pinned ? 'Desafixar' : 'Fixar (entra primeiro na grade)', () => { c.pinned = !c.pinned; save(); assign(); });
    btn('up', 'Subir na lista', () => move(i, -1));
    btn('down', 'Descer na lista', () => move(i, 1));
    btn('gift', 'Abrir pra resgatar', () => openRedeem(c));
    btn('trash', 'Remover da lista', () => { if (confirm(`Remover ${c.name} da lista?`)) { cfg.channels.splice(i, 1); delete status[key(c)]; save(); assign(); } });
    if (c.pinned) actions.children[1].classList.add('on');
    ul.appendChild(li);
  });
}

function move(i, dir) {
  // move dentro da mesma plataforma
  const p = cfg.channels[i].platform;
  let j = i + dir;
  while (j >= 0 && j < cfg.channels.length && cfg.channels[j].platform !== p) j += dir;
  if (j < 0 || j >= cfg.channels.length) return;
  [cfg.channels[i], cfg.channels[j]] = [cfg.channels[j], cfg.channels[i]];
  save(); assign();
}

function parseChannel(text) {
  const t = text.trim();
  let m = t.match(/twitch\.tv\/([A-Za-z0-9_]+)/i);
  if (m) return { platform: 'twitch', name: m[1] };
  m = t.match(/kick\.com\/([A-Za-z0-9_-]+)/i);
  if (m) return { platform: 'kick', name: m[1] };
  return null;
}

// ---------- aba de resgate ----------
function openRedeem(channel) {
  $('redeem').hidden = false;
  $('redeemList').innerHTML = cfg.channels
    .map(c => `<option value="${c.platform === 'twitch' ? 'twitch.tv/' : 'kick.com/'}${c.name}">`).join('');
  if (!channel) { $('redeemInput').focus(); return; }
  $('redeemInput').value = (channel.platform === 'twitch' ? 'twitch.tv/' : 'kick.com/') + channel.name;
  $('redeemPlat').value = channel.platform;
  const body = $('redeemBody');
  const wv = document.createElement('webview');
  wv.id = 'redeemBody';
  wv.setAttribute('partition', partition());
  wv.setAttribute('allowpopups', '');
  wv.src = urlOf(channel);
  wv.addEventListener('dom-ready', () => wv.setAudioMuted(!!cfg.settings.mutePc));
  body.replaceWith(wv);
}

function closeRedeem() {
  $('redeem').hidden = true;
  // destrói a live de resgate pra não ficar gastando internet
  const e = document.createElement('div');
  e.id = 'redeemBody';
  e.className = 'empty';
  e.textContent = 'Escolha um canal pra abrir e resgatar o boost no mercado de pontos.';
  $('redeemBody').replaceWith(e);
}

// ---------- quem está logado (Twitch pelo cookie; Kick pela página da live aberta, ou cookie) ----------
async function refreshLogins() {
  let r = { twitch: null, kick: null };
  try { r = await window.api.logins('persist:main'); } catch { /* */ }
  const kickWv = slots.kick.find(s => s.wv && s.channel)?.wv;
  if (kickWv) {
    const ok = await kickWv.executeJavaScript(`!!document.getElementById('chatroom-footer') && ![...document.querySelectorAll('button, a')].some(b => b.offsetParent && /^(Entrar|Log in|Cadastrar-se|Sign up)$/i.test((b.innerText || '').trim()))`).catch(() => null);
    if (ok != null) r.kick = ok ? (r.kick || '?') : null;
  }
  for (const [p, id] of [['twitch', 'acctTwitch'], ['kick', 'acctKick']]) {
    const box = $(id), who = r[p];
    box.classList.toggle('ok', !!who);
    box.querySelector('.acct-st').innerHTML = who ? `${ic('check')}conectado${who !== '?' ? ' como <b>' + who + '</b>' : ''}` : 'não conectado';
    const b = box.querySelector('button');
    b.textContent = who ? 'trocar' : 'Entrar';
    b.className = 'sm ' + (who ? 'ghost' : 'accent');
  }
}

// ---------- abas, painel de configurações e menus suspensos ----------
function syncTabs() {
  const pokeOpen = !$('poke').classList.contains('closed');
  $('tabLives').classList.toggle('on', !pokeOpen);
  $('openPoke').classList.toggle('on', pokeOpen);
  const b = pokeOpen ? $('openPoke') : $('tabLives');
  $('tabInd').style.left = b.offsetLeft + 'px';
  $('tabInd').style.width = b.offsetWidth + 'px';
}
function setupChrome() {
  $('tabLives').onclick = () => $('pokeClose').click();
  new MutationObserver(syncTabs).observe($('poke'), { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', syncTabs);
  setTimeout(syncTabs, 50);
  const openS = (on) => document.body.classList.toggle('settings-open', on);
  $('openSettings').onclick = () => { openS(true); refreshLogins(); };
  setTimeout(refreshLogins, 20e3);
  setInterval(refreshLogins, 5 * 60e3);
  $('closeSettings').onclick = () => openS(false);
  $('settingsShade').onclick = () => openS(false);
  // menus suspensos (.dd): o botão abre/fecha; clicar fora fecha
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.dd > button');
    // clicar numa ação do menu fecha o menu; clicar em interruptor/seleção mantém aberto
    const inMenu = e.target.closest('.dd .menu button') ? null : e.target.closest('.dd .menu');
    document.querySelectorAll('.dd.open').forEach(d => { if (d !== btn?.parentElement && !d.contains(inMenu)) d.classList.remove('open'); });
    if (btn) btn.parentElement.classList.toggle('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { openS(false); document.querySelectorAll('.dd.open').forEach(d => d.classList.remove('open')); }
  });
}

// ---------- início ----------
async function init() {
  cfg = await window.api.loadConfig();
  const s = cfg.settings;
  s.secondary = false; // "conta secundária" saiu: várias contas farmando pode dar ban
  setupChrome();
  $('perLabel').textContent = s.perPlatform;
  if (s.lightChat === undefined) s.lightChat = true;
  $('showMem').onclick = showMemory;
  if (s.notify === undefined) s.notify = true;
  for (const id of ['secondary', 'mutePc', 'economy', 'autoBonus', 'lightChat', 'notify']) {
    $(id).checked = !!s[id];
    $(id).onchange = () => {
      s[id] = $(id).checked; save();
      if (id === 'mutePc') PLATFORMS.forEach(p => slots[p].forEach(sl => sl.wv && sl.wv.setAudioMuted(s.mutePc)));
      else if (id === 'notify') { if (s.notify) notify('Poke Lives', 'Avisos ligados.', 'teste', 0); }
      else PLATFORMS.forEach(p => slots[p].forEach(sl => sl.channel && renderSlot(sl))); // recarrega com a nova config
    };
  }
  $('priority').value = s.priority || 'points';
  $('priority').onchange = () => { s.priority = $('priority').value; save(); assign(); };
  $('perPlatform').value = String(s.perPlatform);
  $('perPlatform').onchange = () => {
    s.perPlatform = +$('perPlatform').value; save();
    $('perLabel').textContent = s.perPlatform;
    buildGrid(); assign();
  };
  $('interval').value = String(s.interval);
  $('interval').onchange = () => { s.interval = +$('interval').value; save(); restartTimer(); };
  $('checkNow').onclick = checkAll;
  $('openRedeem').onclick = () => openRedeem(null);
  $('redeemClose').onclick = closeRedeem;
  $('redeemBar').onsubmit = (e) => {
    e.preventDefault();
    const v = $('redeemInput').value.trim();
    const c = parseChannel(v) || (/^[A-Za-z0-9_-]+$/.test(v) ? { platform: $('redeemPlat').value, name: v } : null);
    if (!c) { alert('Cole um link (twitch.tv/canal ou kick.com/canal) ou só o nome do canal.'); return; }
    openRedeem(c);
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('redeem').hidden) closeRedeem(); });
  $('loginTwitch').onclick = () => window.api.login('twitch', partition());
  $('loginKick').onclick = () => window.api.login('kick', partition());
  $('addForm').onsubmit = (e) => {
    e.preventDefault();
    const c = parseChannel($('addInput').value);
    if (!c) { alert('Cole um link da Twitch (twitch.tv/canal) ou da Kick (kick.com/canal).'); return; }
    if (cfg.channels.some(x => key(x) === key(c))) { alert('Esse canal já está na lista.'); return; }
    cfg.channels.push({ ...c, paused: false, pinned: false });
    $('addInput').value = '';
    save(); renderList(); checkAll();
  };
  document.querySelectorAll('.filters button').forEach(b => b.onclick = () => {
    filter = b.dataset.f;
    document.querySelectorAll('.filters button').forEach(x => x.classList.toggle('on', x === b));
    renderList();
  });
  buildGrid();
  renderList();
  await checkAll();
  restartTimer();
}

init();
