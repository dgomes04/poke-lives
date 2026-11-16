// Otimizar: liga o Modo ULTRA Economia do próprio jogo em todas as contas (a caça continua no servidor;
// a tela do jogo vira só uma caixa com os números). Quando uma automação precisa da tela (Mapa, Market,
// bônus de live), sai do Ultra só naquela conta por alguns segundos e volta.

// ---------- dentro do jogo ----------
async function pageUltra(ligar) {
  const espera = (ms) => new Promise(r => setTimeout(r, ms));
  const naTela = () => document.documentElement.classList.contains('modo-ultra');
  const salvo = () => { try { return localStorage.getItem('cfg-ultra') === '1'; } catch { return false; } };
  if (ligar ? (salvo() && naTela()) : (!salvo() && !naTela())) return { ok: true, ja: true };
  // desligar com a caixa na tela: o próprio botão "Voltar ao jogo"
  if (!ligar && naTela() && document.getElementById('ultra-sair')) {
    document.getElementById('ultra-sair').click();
    for (let i = 0; i < 20 && naTela(); i++) await espera(150);
    return { ok: !naTela() };
  }
  // pelo interruptor das Configurações → Desempenho (o mesmo que você clicaria)
  const vis = (e) => e && e.offsetParent;
  const cfgBtn = document.getElementById('btn-config');
  if (!cfgBtn) return { erro: 'botão de configurações não encontrado' };
  cfgBtn.click();
  let tog = null;
  for (let i = 0; i < 20 && !vis(tog = document.getElementById('cfg-ultra')); i++) {
    const aba = [...document.querySelectorAll('button, [role=tab], [data-aba]')].find(b => vis(b) && /desempenho/i.test(b.innerText || ''));
    if (aba) aba.click();
    await espera(200);
  }
  if (!vis(tog)) return { erro: 'interruptor do Ultra não apareceu' };
  if (salvo() !== ligar) tog.click();
  await espera(400);
  // fecha as Configurações se ficaram abertas (ao ligar o jogo já fecha sozinho)
  for (const m of [...document.querySelectorAll('.modal:not(.hidden)')].filter(m => getComputedStyle(m).display !== 'none')) m.querySelector('.modal-topo button')?.click();
  return { ok: salvo() === ligar, naTela: naTela() };
}

// ---------- no app ----------
const ultraLigadoApp = () => !!cfg.settings.ultra;

async function aplicarUltra(id, ligar) {
  const wv = pokeViews[id];
  if (!wv) return;
  try { return await runIn(wv, pageUltra, ligar, 20e3); } catch { return { erro: 'o jogo não respondeu' }; }
}

// sai do Ultra só nesta conta enquanto a automação usa a tela, e volta depois
async function comTelaDoJogo(wv, fn) {
  if (!ultraLigadoApp()) return fn();
  try { await runIn(wv, pageUltra, false, 20e3); await sleep(800); } catch { /* segue mesmo assim */ }
  try { return await fn(); }
  finally { if (ultraLigadoApp()) runIn(wv, pageUltra, true, 20e3).catch(() => {}); }
}

async function alternarOtimizar() {
  const ligar = !ultraLigadoApp();
  cfg.settings.ultra = ligar;
  if (ligar) { cfg.settings.pokeLayoutAntesUltra = cfg.settings.pokeLayout; cfg.settings.pokeLayout = 'grid'; }
  else if (cfg.settings.pokeLayoutAntesUltra) cfg.settings.pokeLayout = cfg.settings.pokeLayoutAntesUltra;
  save(); applyPokeLayout(); pintarOtimizar();
  const nomes = [];
  for (const a of cfg.settings.pokeAccounts) {
    const r = await withLock(pokeViews[a.id], () => aplicarUltra(a.id, ligar)).catch(() => null);
    if (r && !r.ok && !r.ja) nomes.push(`${a.name} (${r.erro || 'não respondeu'})`);
  }
  blog(ligar ? 'Otimizado: Modo ULTRA Economia ligado nas contas.' : 'Modo ULTRA Economia desligado: contas de volta ao normal.', 'ok', 'sistema');
  if (nomes.length) blog(`Não deu em: ${nomes.join(', ')}. Tento de novo em instantes.`, 'err', 'sistema');
  pintarOtimizar();
}

function pintarOtimizar() {
  const b = document.getElementById('ultraBtn');
  if (!b) return;
  const on = ultraLigadoApp();
  b.classList.toggle('on', on);
  const txt = b.querySelector('.ub-txt');
  if (txt) txt.textContent = on ? `Otimizado · ${cfg.settings.pokeAccounts.length} contas` : 'Otimizar';
  b.title = on ? 'Modo ULTRA Economia ligado em todas as contas. Clique para voltar ao normal.' : 'Liga o Modo ULTRA Economia do jogo em todas as contas (gasta bem menos CPU e memória)';
  document.querySelectorAll('#pokeView .ptile').forEach(t => t.classList.toggle('ultra', on));
}

// conta que carregou/recarregou com o app otimizado: entra no Ultra sozinha
async function manterUltra() {
  if (!ultraLigadoApp()) return;
  for (const a of cfg.settings.pokeAccounts) {
    const i = tileInfo[a.id];
    if (!i || i.login || i.outra || i.ultra) continue;
    const wv = pokeViews[a.id];
    if (wv) await withLock(wv, () => aplicarUltra(a.id, true)).catch(() => {});
  }
}

(function iniciarUltra() {
  if (typeof cfg === 'undefined' || !cfg?.settings || !document.getElementById('ultraBtn')) return setTimeout(iniciarUltra, 500);
  document.getElementById('ultraBtn').onclick = alternarOtimizar;
  // quadros criados ou refeitos também ganham o selo ULTRA
  const aplicarLayout = window.applyPokeLayout;
  if (aplicarLayout) window.applyPokeLayout = function (...a) { const r = aplicarLayout.apply(this, a); pintarOtimizar(); return r; };
  pintarOtimizar();
  setInterval(() => { pintarOtimizar(); manterUltra(); }, 60e3);
})();
