// Compra automática de Ultra Ball (com ouro, no Market do NPC): quando a captura automática usa Ultra Ball
// e ela chega a 1.500 ou menos, o app abre Market → Pokebolas → Ultra Ball → Máx → Comprar.
// Só Ultra Ball e só com ouro; nada é comprado com diamante ou gema.

const ULTRA_LIMITE = 1500;         // compra quando sobrar isso ou menos
const ULTRA_MIN_COMPRA = 1000;     // ainda com bolas, só compra se o ouro der pra pelo menos isso (senão espera zerar)
const ULTRA_ESPERA = 15 * 60e3;    // se a compra falhar, tenta de novo depois de 15 min
const ULTRA_ESPERA_POUCO = 60 * 60e3; // ouro curto com bolas sobrando: olha de novo em 1h
const ULTRA_ESPERA_OK = 2 * 60e3;  // depois de comprar, dá tempo do jogo atualizar o estoque
const ultraUltima = {};            // id -> quando tentou

// ---------- dentro do jogo ----------
async function pageComprarUltra(opts) {
  const ensaio = !!(opts && opts.ensaio); // teste: vai até o botão Comprar e NÃO clica
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (e) => e && e.offsetParent;
  const btnTxt = (re) => [...document.querySelectorAll('button, [role=button]')].find(b => vis(b) && re.test((b.innerText || '').trim()));
  const fechar = async () => {
    for (let k = 0; k < 3; k++) {
      const abertos = [...document.querySelectorAll('.modal:not(.hidden)')].filter(m => getComputedStyle(m).display !== 'none');
      if (!abertos.length) return;
      for (const m of abertos.reverse()) m.querySelector('.modal-topo button, .modal-acoes button')?.click();
      for (const t of [document, window]) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await wait(300);
    }
  };
  const corpo = () => vis(document.getElementById('mk-corpo')) ? document.getElementById('mk-corpo') : null;
  // abre o Market (no layout menor ele fica dentro do Menu)
  if (!corpo()) {
    let mk = btnTxt(/^Market$/i);
    if (!mk) {
      const menu = btnTxt(/^Menu$/i);
      if (menu) { menu.click(); for (let i = 0; i < 10 && !(mk = btnTxt(/^Market$/i)); i++) await wait(200); }
    }
    if (!mk) return { error: 'botão Market não encontrado' };
    mk.click();
  }
  for (let i = 0; i < 25 && !corpo(); i++) await wait(200);
  if (!corpo()) return { error: 'o Market não abriu' };
  // aba Comprar
  const abaCompra = document.querySelector('#mk-modos [data-aba="compra"]');
  if (abaCompra && !abaCompra.classList.contains('on')) { abaCompra.click(); await wait(500); }
  // categoria Pokebolas
  const cats = [...document.querySelectorAll('.mk-cat')];
  const catBolas = cats.find(b => /pok[eé] ?bolas|pok[eé]balls|bolas/i.test(b.innerText || '')) || cats[0];
  if (catBolas && !catBolas.classList.contains('on')) { catBolas.click(); await wait(600); }
  // card da Ultra Ball
  let card = null;
  for (let i = 0; i < 15 && !card; i++) {
    card = [...document.querySelectorAll('.mk-pal')].find(c => /^ultra ?ball$/i.test((c.querySelector('.mk-nome')?.textContent || '').trim()));
    if (!card) await wait(200);
  }
  if (!card) { await fechar(); return { error: 'Ultra Ball não apareceu no Market' }; }
  const atalhos = [...card.querySelectorAll('.mk-atalho')];
  const max = atalhos.find(b => /m[aá]x/i.test(b.textContent || '')) || atalhos[atalhos.length - 1];
  const qtd = Number(max?.dataset.q || 0);
  if (!max || max.disabled || !(qtd > 0)) { await fechar(); return { error: 'sem ouro pra comprar Ultra Ball' }; }
  const minimo = Number(opts && opts.minimo) || 0;
  if (qtd < minimo) { await fechar(); return { error: `o ouro só dá ${qtd} Ultra Balls`, pouco: true, qtd }; }
  max.click();
  await wait(300);
  const comprar = card.querySelector('.mk-pal-comprar');
  if (!comprar || comprar.disabled) { await fechar(); return { error: 'o botão Comprar ficou travado' }; }
  const gasto = (comprar.innerText || '').replace(/^[^\d]*/, '').trim();
  if (ensaio) { await fechar(); return { ok: true, ensaio: true, qtd, gasto }; }
  comprar.click();
  await wait(1500);
  await fechar();
  return { ok: true, qtd, gasto };
}

// ---------- lógica ----------
async function verificarUltra(id, i) {
  if (cfg.settings.autoUltra === false || !i || !i.bolas || i.login || i.outra || !i.autoBola) return;
  const ultra = i.bolas.find(b => /^ultra ?ball$/i.test(b.nome || ''));
  if (!ultra || !ultra.usa || !(ultra.qtd <= ULTRA_LIMITE)) return; // só quando sobrar 1.500 ou menos
  const u = ultraUltima[id];
  const espera = u && (u.ok ? ULTRA_ESPERA_OK : u.pouco ? ULTRA_ESPERA_POUCO : ULTRA_ESPERA);
  // ouro curto: se as bolas zerarem, compra o que der na hora
  if (u && Date.now() - u.t < espera && !(u.pouco && ultra.qtd === 0)) return;
  ultraUltima[id] = { t: Date.now(), ok: false };
  const wv = pokeViews[id];
  if (!wv) return;
  // com bolas sobrando, só vale se o ouro comprar um lote de verdade (não gasta o ouro todo em compras picadas)
  const minimo = ultra.qtd > 0 ? ULTRA_MIN_COMPRA : 0;
  let r;
  try { r = await withLock(wv, () => withDesktop(wv, () => runIn(wv, pageComprarUltra, { minimo }, 60e3))); }
  catch { r = { error: 'o jogo não respondeu' }; }
  if (r.ok) {
    ultraUltima[id].ok = true;
    const motivo = ultra.qtd > 0 ? `restavam ${ultra.qtd.toLocaleString('pt-BR')} Ultra Balls` : 'as Ultra Balls acabaram';
    blog(`${accName(id)}: ${motivo}. Comprei ${r.qtd.toLocaleString('pt-BR')} no Market (${r.gasto || 'ouro'}).`, 'ok', 'conta');
    if (window.statsCompra) statsCompra(accName(id), 'Ultra Ball', r.qtd);
  } else if (r.pouco) {
    ultraUltima[id].pouco = true;
    blog(`${accName(id)}: restam ${ultra.qtd.toLocaleString('pt-BR')} Ultra Balls, mas ${r.error}. Espero juntar ouro (ou zerar) pra comprar.`, '', 'conta');
  } else {
    blog(`${accName(id)}: não deu pra comprar Ultra Ball (${r.error}). Tento de novo em 15 min.`, 'err', 'conta');
  }
}
window.verificarUltra = verificarUltra;
window.pageComprarUltra = pageComprarUltra;

// interruptor no menu Boost (ligado por padrão)
(function iniciarAutoUltra() {
  if (typeof cfg === 'undefined' || !cfg || !cfg.settings || !document.getElementById('autoUltra')) return setTimeout(iniciarAutoUltra, 500);
  const sw = document.getElementById('autoUltra');
  sw.checked = cfg.settings.autoUltra !== false;
  sw.onchange = () => {
    cfg.settings.autoUltra = sw.checked; save();
    blog(`Compra automática de Ultra Ball ${sw.checked ? 'ligada' : 'desligada'}.`, '', 'sistema');
  };
})();
