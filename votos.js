// Vote & Ganhe (TopIdle): confere se o voto de cada conta está liberado, avisa e abre a página de voto
// de cada conta no perfil do Brave escolhido (cada conta vota com o próprio Google).
// O voto em si (votar e autorizar no Google) é feito por você.

const VOTO_CHECAR = 30 * 60e3;
const votoInfo = {};       // id -> { ativo, esperaMs, url, votos, diamantes, noPar, votosPorDiamante, nick, em }
const votoAvisado = {};    // id -> já avisou deste voto liberado
let bravePerfis = null;

// ---------- dentro do jogo ----------
async function pageVoto() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('sessao') || 'null'); } catch { /* sem sessão */ }
  if (!s || !s.token) return { erro: 'sem login' };
  const r = await fetch('/topidle/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: s.token }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { erro: d.erro || 'o jogo não respondeu' };
  return { ativo: !!d.ativo, esperaMs: Number(d.esperaMs) || 0, url: d.url || null, votos: d.votos ?? null, diamantes: d.diamantes ?? null,
    noPar: d.noPar ?? null, votosPorDiamante: d.votosPorDiamante ?? null, nick: d.identificador || s.nick || null };
}

// ---------- lógica ----------
const votoLiberado = (v) => !!(v && v.ativo && v.url && v.esperaMs - (Date.now() - v.em) <= 0);
const votoPerfil = (id) => (cfg.settings.votoPerfil || {})[id] || 'Default';

async function checarVotos() {
  for (const a of cfg.settings.pokeAccounts) {
    const wv = pokeViews[a.id];
    if (!wv) continue;
    let v;
    try { v = await runIn(wv, pageVoto, null, 20e3); } catch { v = { erro: 'o jogo não respondeu' }; }
    votoInfo[a.id] = { ...v, em: Date.now() };
  }
  avisarVotos();
  renderVotoMenu();
}
function avisarVotos() {
  const novos = [];
  for (const a of cfg.settings.pokeAccounts) {
    const v = votoInfo[a.id];
    if (votoLiberado(v)) { if (!votoAvisado[a.id]) { votoAvisado[a.id] = true; novos.push(a.name); } }
    else if (v && !v.erro) votoAvisado[a.id] = false;
  }
  if (novos.length && cfg.settings.votoAuto !== false) {
    // abre sozinho, igual às outras automações: você só vota e autoriza com o Google em cada aba
    blog(`Voto do TopIdle liberado: ${novos.join(', ')}. Abrindo no Brave…`, 'ok', 'conta');
    notify('Voto liberado no TopIdle', `Abri o voto de ${novos.join(', ')} no Brave: é só votar e autorizar.`, 'voto:' + novos.join(','), 0);
    (async () => { for (const a of cfg.settings.pokeAccounts) if (novos.includes(a.name)) { await abrirVoto(a.id); await sleep(1500); } })();
  } else if (novos.length) {
    blog(`Voto do TopIdle liberado: ${novos.join(', ')}. Abra em Votar → Abrir votos liberados.`, 'ok', 'conta');
    notify('Voto liberado no TopIdle', `${novos.join(', ')} — 2 votos = 1 diamante`, 'voto:' + novos.join(','), 0);
  }
}

function horasTxt(ms) {
  if (ms <= 0) return 'agora';
  const h = Math.floor(ms / 3600e3), m = Math.round((ms % 3600e3) / 60e3);
  return h ? `${h} h ${m} min` : `${m} min`;
}

async function abrirVoto(id) {
  const v = votoInfo[id];
  if (!v || !v.url) return blog(`${accName(id)}: o link de voto ainda não foi lido (o jogo precisa estar logado).`, 'err', 'conta');
  const r = await window.api.braveVotar(votoPerfil(id), v.url);
  if (r.erro) blog(`${accName(id)}: não abri o voto (${r.erro}).`, 'err', 'conta');
  else blog(`${accName(id)}: abri o TopIdle no perfil "${nomePerfil(votoPerfil(id))}" do Brave. Vote e autorize com o Google desta conta.`, '', 'conta');
}
async function abrirVotosLiberados() {
  const lista = cfg.settings.pokeAccounts.filter(a => votoLiberado(votoInfo[a.id]));
  if (!lista.length) return blog('Nenhum voto liberado agora.', '', 'conta');
  for (const a of lista) { await abrirVoto(a.id); await sleep(1500); } // um de cada vez pro Brave abrir os perfis certinho
}
const nomePerfil = (dir) => bravePerfis?.find(p => p.dir === dir)?.nome || dir;

function renderVotoMenu() {
  const m = $('votoMenu');
  if (!m) return;
  const accs = cfg.settings.pokeAccounts;
  const liberados = accs.filter(a => votoLiberado(votoInfo[a.id])).length;
  const badge = $('votoBadge');
  if (badge) { badge.textContent = liberados; badge.hidden = !liberados; }
  if (m.closest('.dd')?.classList.contains('open') && m.contains(document.activeElement)) return; // não atrapalha quem está escolhendo
  const perfis = bravePerfis || [{ dir: 'Default', nome: 'Padrão' }];
  const usados = {};
  for (const a of accs) usados[votoPerfil(a.id)] = (usados[votoPerfil(a.id)] || 0) + 1;
  const repetido = Object.values(usados).some(n => n > 1);
  m.innerHTML = `<div class="mtitle">Vote & Ganhe · 2 votos = 1 💎</div>
    <label class="row switch" title="Quando o voto de uma conta libera, o app abre o TopIdle dela no perfil do Brave escolhido. Votar e autorizar no Google continua com você.">Abrir votos sozinho <input type="checkbox" id="votoAuto" ${cfg.settings.votoAuto !== false ? 'checked' : ''}><i></i></label>` + accs.map(a => {
    const v = votoInfo[a.id];
    const st = !v ? '<span class="muted">conferindo…</span>' : v.erro ? `<span class="pc-warn">${v.erro}</span>`
      : !v.ativo ? '<span class="muted">voto desligado</span>'
      : votoLiberado(v) ? '<span class="ok">liberado</span>' : `<span class="muted">volta em ${horasTxt(v.esperaMs - (Date.now() - v.em))}</span>`;
    return `<div class="voto-row">
      <div><b>${a.name}</b> <small class="muted">${v?.nick ? 'nick ' + v.nick : ''}</small><br><small>${st}${v?.votos != null ? ` · ${v.votos} votos · ${v.diamantes ?? 0} 💎` : ''}</small></div>
      <select data-voto-perfil="${a.id}" title="Perfil do Brave logado no Google desta conta">${perfis.map(p => `<option value="${p.dir}" ${votoPerfil(a.id) === p.dir ? 'selected' : ''}>${p.nome}</option>`).join('')}</select>
      <button data-voto-abrir="${a.id}" ${votoLiberado(v) ? '' : 'class="ghost"'}>Abrir</button></div>`;
  }).join('') +
  (repetido ? `<p class="hint">Cada conta vota com um Google diferente: no Brave, crie um perfil para cada (menu do perfil → Adicionar), entre no Google dela e escolha aqui.</p>` : '') +
  `<button id="votoTodos" class="accent">Abrir votos liberados${liberados ? ` (${liberados})` : ''}</button>
   <button id="votoChecar" class="ghost">Conferir agora</button>`;
  m.querySelectorAll('[data-voto-perfil]').forEach(sel => sel.onchange = () => {
    (cfg.settings.votoPerfil ||= {})[sel.dataset.votoPerfil] = sel.value; save(); renderVotoMenu();
  });
  $('votoAuto').onchange = () => { cfg.settings.votoAuto = $('votoAuto').checked; save(); };
  m.querySelectorAll('[data-voto-abrir]').forEach(b => b.onclick = () => abrirVoto(b.dataset.votoAbrir));
  $('votoTodos').onclick = () => abrirVotosLiberados();
  $('votoChecar').onclick = () => { $('votoChecar').textContent = 'Conferindo…'; checarVotos(); };
}

window.votoResumo = () => cfg.settings.pokeAccounts.map(a => {
  const v = votoInfo[a.id];
  return { nome: a.name, liberado: votoLiberado(v), voltaMs: v && !v.erro ? Math.max(0, v.esperaMs - (Date.now() - v.em)) : null, erro: v?.erro || null };
});

(async function iniciarVotos() {
  while (typeof cfg === 'undefined' || !cfg || !cfg.settings?.pokeAccounts || !$('votoMenu')) await sleep(500);
  try { const r = await window.api.bravePerfis(); bravePerfis = r.perfis || null; } catch { /* sem Brave */ }
  renderVotoMenu();
  await sleep(90e3); // espera os jogos carregarem
  checarVotos();
  setInterval(checarVotos, VOTO_CHECAR);
  setInterval(() => { avisarVotos(); renderVotoMenu(); }, 60e3); // o "volta em" anda e o aviso sai na hora certa
})();
