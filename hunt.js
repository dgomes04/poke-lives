// Troca automática de hunt: em cada conta do hub, lê a melhor hunt na extensão /hunt
// (XP/h, Ouro/h ou Shiny/h) e, se valer a pena, vai pra ela pelo Mapa → LISTA.

const HUNT_EVERY = 15 * 60e3;   // conferir a cada 15 min
const HUNT_TICK = 20e3;         // relógio interno (e intervalo das retentativas)
const HUNT_LEVEL_EVERY = 60e3;  // olha o nível do pokémon a cada 1 min
const HUNT_RETRY_FOR = 30 * 60e3; // tenta trocar por até 30 min (pokémon em batalha)
const HUNT_MIN_GAIN = 1.05;     // só troca se for 5% melhor
const MODE_LABEL = { xp: 'XP/h', ouro: 'Ouro/h', shiny: 'Shiny/h' };

const huntState = {}; // id -> { next, lvlAt, lvl, pending: { name, region, until, nextTry, gain } }

// ---------- dentro do jogo ----------

async function pageHuntLevel() {
  const card = document.getElementById('ativo-card');
  const m = card && card.innerText.match(/Nv\s*(\d+)/);
  return m ? +m[1] : null;
}

async function pageReadBestHunt({ mode }) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (e) => e && e.offsetParent;
  const btn = document.querySelector('.pih-btn');
  if (!btn || btn.hidden) return { error: 'botão /hunt não apareceu (tem pokémon em campo?)' };
  const ctrl = () => [...document.querySelectorAll('.pih-ctrl')].find(vis);
  if (!ctrl()) btn.click();
  for (let i = 0; i < 40 && !ctrl(); i++) await wait(200);
  if (!ctrl()) return { error: 'painel /hunt não abriu' };
  const ready = () => !document.querySelector('.pih-carga') && document.querySelector('.pih-tab tbody tr');
  const settle = async () => { await wait(300); for (let i = 0; i < 50 && !ready(); i++) await wait(200); };
  // espera o painel terminar de calcular antes de clicar: enquanto carrega, os botões de região
  // nem existem e o painel é redesenhado (o clique se perderia)
  await settle();
  // sempre clica no tipo da hunt e depois em "Todas", nessa ordem, mesmo que já pareçam marcados:
  // sem isso o ranking pode ficar só no mapa que estava aberto
  const ord = document.querySelector(`[data-ordem="${mode}"]`);
  if (!ord) return { error: `modo ${mode} não existe na /hunt` };
  ord.click(); await settle();
  const lib = document.querySelector('input[data-pref="soLiberadas"]');
  if (lib && !lib.checked) { lib.click(); await settle(); }
  const todas = document.querySelector('[data-regiao=""]');
  if (!todas) return { error: 'botão "Todas" da /hunt não apareceu' };
  todas.click(); await settle();
  if (!document.querySelector(`[data-ordem="${mode}"]`)?.classList.contains('on') || !document.querySelector('[data-regiao=""]')?.classList.contains('on'))
    return { error: 'a /hunt não ficou no tipo certo com "Todas" marcada' };
  const rows = [...document.querySelectorAll('.pih-tab tbody tr')].map(tr => {
    const b = tr.querySelector('.pih-hunt b');
    const small = tr.querySelector('.pih-hunt small');
    return {
      name: b ? b.textContent.trim() : '',
      region: small ? small.textContent.split('·')[0].trim() : '',
      val: tr.children[2] ? tr.children[2].innerText.trim() : '',
      ok: !tr.querySelector('[colspan]') && !tr.classList.contains('pih-bloq'),
    };
  }).filter(r => r.name);
  // hunt atual: o jogo mostra "Pinsir · nível 100"
  const leaf = [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && vis(e) && /^.+ · nível \d+$/.test(e.textContent.trim()));
  const current = leaf ? leaf.textContent.trim().replace(/ · nível \d+$/, '') : null;
  // fecha o painel
  const fechar = document.querySelector('.pih-ctrl')?.closest('[class]')?.parentElement?.querySelector('[data-acao="fechar"]') || document.querySelector('[data-acao="fechar"]');
  if (fechar) fechar.click(); else btn.click();
  return { rows: rows.slice(0, 25), current };
}

// lê o botão "Centro Pokemon": com contagem ("3s") = pokémon em combate, não dá pra trocar de mapa
async function pageCombatState() {
  const els = [...document.querySelectorAll('button, [role=button], a, div, span')]
    .filter(x => /centro\s*pok[eé]mon/i.test(x.textContent || '') && (x.textContent || '').length < 60);
  if (!els.length) return { found: false, locked: false };
  const inner = (l) => l.find(x => !l.some(y => y !== x && x.contains(y)));
  const comConta = els.filter(x => /\d+\s*s(?![a-z])/i.test(x.textContent || ''));
  const b = els.find(x => x.matches('button, [role=button]')) || inner(comConta) || inner(els) || els[0];
  const box = b.closest('button, [role=button]') || b;
  const txt = (box.textContent || '').replace(/\s+/g, ' ');
  const m = txt.match(/(\d+)\s*s(?![a-z])/i);
  const st = getComputedStyle(box);
  const locked = !!m || box.disabled || box.getAttribute('aria-disabled') === 'true' || st.pointerEvents === 'none' || /disabled|travad|bloq|locked/i.test(box.className || '');
  return { found: true, locked, secs: m ? +m[1] : null, txt: txt.trim().slice(0, 40) };
}

async function pageGoHunt({ name, region }) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (e) => e && e.offsetParent;
  const esc = () => { for (const t of [document, window]) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); };
  const busca = () => vis(document.getElementById('f-mapa')) ? document.getElementById('f-mapa') : null;
  const btnTxt = (re) => [...document.querySelectorAll('button, [role=button]')].find(b => vis(b) && re.test((b.innerText || '').trim()));
  const atual = () => [...document.querySelectorAll('body *')].find(e => e.children.length === 0 && vis(e) && /^.+ · nível \d+$/.test(e.textContent.trim()))?.textContent.trim().replace(/ · nível \d+$/, '');
  if ((atual() || '').toLowerCase() === name.toLowerCase()) return { ok: true, already: true };
  // combate: o botão "Centro Pokemon" mostra uma contagem ("3s") e fica bloqueado enquanto o pokémon luta.
  // Só dá pra trocar de mapa quando ele libera.
  // (mesma lógica de pageCombatState; repetida aqui porque a função roda sozinha dentro da página)
  const combate = () => {
    const els = [...document.querySelectorAll('button, [role=button], a, div, span')]
      .filter(x => /centro\s*pok[eé]mon/i.test(x.textContent || '') && (x.textContent || '').length < 60);
    if (!els.length) return { found: false, locked: false };
    const inner = (l) => l.find(x => !l.some(y => y !== x && x.contains(y)));
    const comConta = els.filter(x => /\d+\s*s(?![a-z])/i.test(x.textContent || ''));
    const b = els.find(x => x.matches('button, [role=button]')) || inner(comConta) || inner(els) || els[0];
    const box = b.closest('button, [role=button]') || b;
    const txt = (box.textContent || '').replace(/\s+/g, ' ');
    const m = txt.match(/(\d+)\s*s(?![a-z])/i);
    const st = getComputedStyle(box);
    const locked = !!m || box.disabled || box.getAttribute('aria-disabled') === 'true' || st.pointerEvents === 'none' || /disabled|travad|bloq|locked/i.test(box.className || '');
    return { found: true, locked, secs: m ? +m[1] : null, txt: txt.trim().slice(0, 40) };
  };
  // time desmaiado: sem curar, o jogo não deixa caçar
  let curou = false;
  const curar = btnTxt(/^curar (a )?equipe$/i);
  if (curar && !curar.disabled) { curar.click(); curou = true; await wait(1500); }
  if (!busca()) {
    // layout menor: o Mapa fica dentro do Menu, então abre o Menu primeiro
    let mapaBtn = null;
    const menu = btnTxt(/^Menu$/i);
    if (menu) { menu.click(); for (let i = 0; i < 10 && !(mapaBtn = btnTxt(/^Mapa$/i)); i++) await wait(200); }
    if (!mapaBtn) mapaBtn = btnTxt(/^Mapa$/i); // layout de computador: Mapa na barra de cima
    if (!mapaBtn) return { error: 'botão Mapa não encontrado' };
    mapaBtn.click();
  }
  for (let i = 0; i < 25 && !busca(); i++) await wait(200);
  if (!busca()) return { error: 'o mapa não abriu' };
  // modo LISTA (no layout pequeno o botão é só um ícone: é o segundo dos dois)
  const modos = [...document.querySelectorAll('button.mapa-modo-bt')].filter(vis);
  const lista = modos.find(b => /LISTA/i.test(b.innerText)) || modos[modos.length - 1];
  if (lista && !lista.classList.contains('on')) { lista.click(); await wait(500); }
  const tab = [...document.querySelectorAll('button.mapa-reg-bt')].find(b => b.innerText.trim().toLowerCase().startsWith(region.toLowerCase()));
  if (tab) {
    if (tab.classList.contains('mapa-area-travada')) { esc(); return { error: `região ${region} ainda travada` }; }
    if (!tab.classList.contains('on')) { tab.click(); await wait(700); }
  }
  const inp = busca();
  inp.value = name;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(900);
  const findRow = () => [...document.querySelectorAll('.ml-linha')].find(r => (r.querySelector('.ml-nome')?.textContent || '').trim().toLowerCase() === name.toLowerCase());
  // fecha o que estiver aberto (Hunt Analyser e Mapa): botão ✕ do topo de cada janela visível
  const fecharTudo = async () => {
    for (let k = 0; k < 3; k++) {
      const abertos = [...document.querySelectorAll('.modal:not(.hidden)')].filter(m => getComputedStyle(m).display !== 'none');
      if (!abertos.length) return;
      for (const m of abertos.reverse()) {
        const x = m.querySelector('.modal-topo button, .modal-acoes button');
        if (x) x.click();
      }
      esc();
      await wait(300);
    }
  };
  const row = findRow();
  if (!row) { await fecharTudo(); return { error: `não achei "${name}" no mapa (${region})` }; }
  // (o selo "Caçando" da lista NÃO indica a hunt atual; quem diz é o "Nome · nível N" do jogo)
  row.click(); // abre o "Hunt Analyser" da área
  let go = null;
  for (let i = 0; i < 20 && !go; i++) {
    await wait(200);
    go = document.querySelector('button.ha-cacar') ||
      [...document.querySelectorAll('button')].find(b => b !== row && /^ca[çc]ar aqui$/i.test((b.innerText || '').trim()));
  }
  if (!go) {
    // conta o motivo que o Hunt Analyser mostra no lugar do botão (time desmaiado, requisito…)
    const ana = [...document.querySelectorAll('.modal:not(.hidden)')].find(m => /hunt analyser/i.test(m.innerText || ''));
    const motivo = ana && (ana.innerText.split('\n').map(x => x.trim()).find(x => /desmai|curar|revive|requer|bloque|precisa|n[ãa]o pode/i.test(x)));
    await fecharTudo();
    return { busy: true, msg: motivo || 'o Hunt Analyser não mostrou o botão "Caçar aqui" (time desmaiado?)' };
  }
  // acompanha a contagem do combate e clica no instante em que libera (espera até 60 s com o Analyser aberto)
  let c = combate();
  if (c.locked) {
    const ate = Date.now() + 60e3;
    while (c.locked && Date.now() < ate) { await wait(250); c = combate(); }
    if (c.locked) { await fecharTudo(); return { busy: true, combat: true, secs: c.secs, msg: 'pokémon em combate o tempo todo' }; }
    go = document.querySelector('button.ha-cacar') || go; // o Analyser pode ter sido redesenhado
  }
  if (go.disabled) {
    const t = go.title || go.getAttribute('aria-label') || '';
    await fecharTudo();
    return { busy: true, msg: t || 'botão "Caçar aqui" desativado' };
  }
  go.scrollIntoView({ block: 'center' });
  go.click();
  // espera o jogo mostrar a hunt nova ("Magikarp · nível 1")
  let ok = false;
  for (let i = 0; i < 20 && !ok; i++) { await wait(250); ok = (atual() || '').toLowerCase() === name.toLowerCase(); }
  const aviso = [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && vis(e))
    .map(e => e.textContent.trim()).find(t => t.length < 140 && /combate|batalha|lutando|n[ãa]o (é|e) poss[ií]vel|aguarde|espere/i.test(t));
  await fecharTudo();
  if (ok) return { ok: true, curou };
  const c2 = combate();
  return { busy: true, combat: c2.locked, secs: c2.secs, msg: aviso || (c2.locked ? 'pokémon entrou em combate' : 'o jogo não trocou (pokémon em combate?)') };
}

// ---------- lógica ----------

function parseHuntVal(t) {
  if (!t) return NaN;
  const s = t.replace(/[≈~]/g, '').trim().toLowerCase();
  const n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (isNaN(n)) return NaN;
  // shiny pode vir como tempo até o próximo ("37 h", "67 d", "12 min"): menos é melhor
  if (/\bmin\b/.test(s)) return 1 / (n * 60);
  if (/\bd\b/.test(s)) return 1 / (n * 86400);
  if (/\bh\b/.test(s)) return 1 / (n * 3600);
  if (/\bbi\b/.test(s)) return n * 1e9;
  if (/\bmi\b/.test(s)) return n * 1e6;
  if (/\bmil\b|k\b/.test(s)) return n * 1e3;
  return n;
}

function accName(id) { return cfg.settings.pokeAccounts.find(a => a.id === id)?.name || id; }

// última conferência de cada conta (aparece no card): quando foi e o que deu
function huntStatus(id, txt, erro = false) { const st = (huntState[id] ||= {}); st.ultima = { t: Date.now(), txt, erro }; }
window.huntStatusTxt = function (id) {
  const st = huntState[id] || {};
  const h = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (st.pending) return `Indo pra ${st.pending.name}…`;
  const prox = st.next ? ` · próxima ${h(st.next)}` : '';
  if (!st.ultima) return `Primeira conferência ${st.next ? 'às ' + h(st.next) : 'em instantes'}`;
  return `<span class="${st.ultima.erro ? 'pc-warn' : ''}">${h(st.ultima.t)}: ${st.ultima.txt}</span>${prox}`;
};
async function huntCheckAccount(id, manual = false) {
  const a = cfg.settings.pokeAccounts.find(x => x.id === id);
  const wv = pokeViews[id];
  if (!a || !wv || !a.focus || a.focus === 'off') return;
  const st = (huntState[id] ||= {});
  st.next = Date.now() + HUNT_EVERY;
  let r;
  try { r = await withLock(wv, () => withDesktop(wv, () => runIn(wv, pageReadBestHunt, { mode: a.focus }))); }
  catch { r = { error: 'o jogo não respondeu' }; }
  if (r.error) {
    // logo depois de abrir o app o jogo ainda está carregando: tenta de novo em 2 min (até 5 vezes) antes de avisar
    st.falhas = (st.falhas || 0) + 1;
    if (st.falhas <= 5) { st.next = Date.now() + 2 * 60e3; huntStatus(id, `${r.error} (tento de novo em 2 min)`, true); return; }
    huntStatus(id, r.error, true); blog(`${a.name}: ${r.error}.`, 'err'); st.falhas = 0; return;
  }
  st.falhas = 0;
  const best = r.rows.find(x => x.ok);
  if (!best) { huntStatus(id, 'a /hunt não mostrou hunt liberada', true); blog(`${a.name}: a /hunt não mostrou nenhuma hunt liberada.`, 'err'); return; }
  if (r.current && r.current.toLowerCase() === best.name.toLowerCase()) {
    huntStatus(id, `já na melhor (${best.name})`);
    if (manual) blog(`${a.name}: já está na melhor hunt de ${MODE_LABEL[a.focus]} (${best.name}, ${best.val}).`, 'ok');
    st.pending = null;
    return;
  }
  const cur = r.current && r.rows.find(x => x.name.toLowerCase() === r.current.toLowerCase());
  let gain = null;
  if (cur) {
    const vb = parseHuntVal(best.val), vc = parseHuntVal(cur.val);
    if (vb > 0 && vc > 0) {
      gain = vb / vc;
      if (gain < HUNT_MIN_GAIN) {
        huntStatus(id, `${best.name} só ${Math.round((gain - 1) * 100)}% melhor; ficou`);
        if (manual) blog(`${a.name}: ${best.name} é só ${Math.round((gain - 1) * 100)}% melhor que ${cur.name}; fica onde está.`);
        return;
      }
    }
  }
  st.pending = { name: best.name, region: best.region, from: r.current, val: best.val, gain, until: Date.now() + HUNT_RETRY_FOR, nextTry: 0, tries: 0 };
  blog(`${a.name}: melhor hunt de ${MODE_LABEL[a.focus]} é ${best.name} (${best.region}, ${best.val})${r.current ? `; agora em ${r.current}` : ''}. Indo…`);
  await huntTrySwitch(id);
}

async function huntTrySwitch(id) {
  const st = huntState[id], p = st && st.pending, wv = pokeViews[id];
  if (!p || !wv) return;
  if (Date.now() > p.until) {
    blog(`${accName(id)}: desisti de ir pra ${p.name} depois de ${p.tries} tentativas (${p.lastMsg || 'sem resposta'}). Tento de novo na próxima conferência.`, 'err');
    st.pending = null;
    return;
  }
  p.tries++;
  let r;
  try { r = await withLock(wv, () => (window.comTelaDoJogo ? comTelaDoJogo(wv, () => runIn(wv, pageGoHunt, { name: p.name, region: p.region })) : runIn(wv, pageGoHunt, { name: p.name, region: p.region }))); }
  catch { r = { busy: true, msg: 'o jogo não respondeu' }; }
  if (r.curou) blog(`${accName(id)}: o time estava desmaiado; curei a equipe antes de trocar de hunt.`, 'err', 'conta');
  if (r.ok) {
    const g = p.gain ? ` (+${Math.round((p.gain - 1) * 100)}%)` : '';
    blog(`${accName(id)}: ${p.from || '?'} → ${p.name}${g}${r.already ? ' (já estava lá)' : ''}.`, 'ok');
    huntStatus(id, `trocou pra ${p.name}${g}`);
    if (!r.already) {
      notify('Hunt trocada', `${accName(id)}: ${p.from || '?'} → ${p.name}${g}`, 'hunt:' + id + p.name, 0);
      if (window.statsHunt) statsHunt(accName(id), p.from, p.name, g);
    }
    st.pending = null;
  } else if (r.error) {
    blog(`${accName(id)}: ${r.error}.`, 'err');
    st.pending = null;
  } else {
    p.lastMsg = r.msg;
    // a partir daqui acompanha o botão "Centro Pokemon" a cada 2 s e tenta de novo no instante em que a
    // contagem some; os 20 s ficam só como reserva se o jogo não mostrar contagem nenhuma
    p.watch = true;
    p.sawLock = !!r.combat;
    p.nextTry = Date.now() + (r.combat ? 2e3 : HUNT_TICK);
    if (p.tries === 1) blog(r.combat
      ? `${accName(id)}: pokémon em combate. Vou trocar pra ${p.name} assim que o "Centro Pokemon" liberar.`
      : `${accName(id)}: não deu pra trocar agora (${r.msg}). Vou acompanhar o "Centro Pokemon" e tentar quando liberar.`);
  }
}

async function huntTick() {
  if (window.__plPause) return; // pausado pelo modo de teste
  for (const a of cfg.settings.pokeAccounts) {
    if (!a.focus || a.focus === 'off' || !pokeViews[a.id]) continue;
    const st = (huntState[a.id] ||= { next: Date.now() + 60e3 + Math.random() * 60e3 }); // espera o jogo carregar
    if (st.pending) {
      const p = st.pending;
      if (p.watch && Date.now() < p.nextTry) {
        // acompanha a contagem: travado → espera; acabou de liberar → tenta já
        const c = await withLock(pokeViews[a.id], () => runIn(pokeViews[a.id], pageCombatState)).catch(() => null);
        if (c && c.locked) { p.sawLock = true; p.nextTry = Math.max(p.nextTry, Date.now() + 2e3); }
        else if (c && c.found && p.sawLock) p.nextTry = 0;
      }
      if (Date.now() >= p.nextTry) await huntTrySwitch(a.id);
      continue;
    }
    if (Date.now() >= st.next) { await huntCheckAccount(a.id); continue; }
    if (!st.lvlAt || Date.now() - st.lvlAt > HUNT_LEVEL_EVERY) {
      st.lvlAt = Date.now();
      const wv = pokeViews[a.id];
      const lvl = await withLock(wv, () => runIn(wv, pageHuntLevel)).catch(() => null);
      // subiu de nível: confere a hunt em silêncio (só aparece no histórico se trocar)
      if (lvl && st.lvl && lvl !== st.lvl) { st.lvl = lvl; await huntCheckAccount(a.id); }
      else if (lvl) st.lvl = lvl;
    }
  }
}

window.huntCheckAccount = huntCheckAccount;
(async function huntInit() {
  while (!cfg || !cfg.settings.pokeAccounts) await sleep(200);
  let running = 0; // quando começou a rodada (0 = livre)
  setInterval(async () => {
    if (running && Date.now() - running < 6 * 60e3) return; // rodada presa há mais de 6 min: segue em frente
    const eu = running = Date.now();
    try { await huntTick(); } catch (e) { console.warn('[hunt]', e); } finally { if (running === eu) running = 0; }
  }, 2000); // relógio curto: as tentativas de troca saem no segundo certo (o resto tem horário próprio)
})();
