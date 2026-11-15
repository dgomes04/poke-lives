// Janela do Avaliador: lê a ficha (colada ou vinda de um anúncio), pede o cálculo ao jogo e julga o preço.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v, casas = 0) => v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas });
const curto = (v) => {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return n(v / 1e9, 1) + ' bi';
  if (a >= 1e6) return n(v / 1e6, 1) + ' mi';
  if (a >= 1e4) return n(v / 1e3) + ' mil';
  return n(v);
};
const STATS = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
const ROTULO_STAT = { hp: 'hp', atk: 'atk', def: 'def', 'sp.atk': 'spAtk', spatk: 'spAtk', 'sp.def': 'spDef', spdef: 'spDef', spd: 'speed', speed: 'speed' };

// referências (wiki do jogo e mercado de itens)
const OURO_POR_GEMA = 4.6e6;      // pelos itens vendidos nas duas moedas (Boss Token, fragmentos)
const GEMA_SAQUE_USD = 0.009;
const CHANCE_POT = [0.745, 0.20, 0.05, 0.005, 0.00005];
const FAIXAS_Q = [[0.8, 0.9, 0.05], [0.9, 1.0, 0.05], [1.0, 1.1, 0.34], [1.1, 1.2, 0.20], [1.2, 1.3, 0.10], [1.3, 1.4, 0.10], [1.4, 1.5, 0.10], [1.5, 1.6, 0.05], [1.7, 1.8, 0.0067], [1.8, 1.8001, 0.0029]];
const RUTULO_Q = (q) => q < 1 ? 'Fraca' : q < 1.1 ? 'Comum' : q < 1.3 ? 'Incomum' : q < 1.5 ? 'Rara' : q < 1.7 ? 'Épica' : 'Lendária';
const FAIXA_NOTA = ['Extremamente Fraco', 'Fraco', 'Mediano', 'Razoável', 'Bom', 'Forte', 'Poderoso', 'Mítico', 'Lendário', 'Divino'];
const PONTOS_SACRIFICIO = [[7, 1000], [6.5, 560], [6, 320], [5.5, 190], [5, 110], [4.5, 60], [4, 25], [3.9, 20], [3.8, 17], [3.7, 14], [3.6, 12], [3.5, 10]];

// ---------- ler a ficha colada ----------
async function lerFicha(texto) {
  const src = String(texto || '').trim();
  if (!src) throw new Error('Cole a ficha do Pokémon.');
  try { // também aceita JSON
    const j = JSON.parse(src);
    if (j && (j.speciesId || j.especie)) return j.speciesId ? j : { ...j, speciesId: (await window.av.especie(j.especie))?.id };
  } catch { /* não é JSON */ }
  const p = { ivs: {}, refino: {} };
  let nome = null, colIv = -1, colRef = -1;
  const num = (s) => Number(String(s).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  for (const bruto of src.split(/\r?\n/)) {
    const s = bruto.replace(/^\s*[-*>]\s*/, '').trim();
    const f = s.match(/^\**([^:|*]+?)\**\s*:\s*(.+)$/);
    if (f) {
      const k = f[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(), v = f[2].trim();
      if (k === 'especie' || k === 'species') { const id = v.match(/#\s*(\d+)/); if (id) p.speciesId = Number(id[1]); nome = v.split(/\s*\(#|\s+—\s+/)[0].trim(); }
      else if (k === 'nivel' || k === 'level') p.level = num(v.split(' ')[0]);
      else if (k === 'potencia' || k === 'potency') { const m = v.match(/P?\s*([1-5])/i); if (m) p.potencia = Number(m[1]); }
      else if (k === 'qualidade' || k === 'quality') p.quality = Number(v.match(/[\d.,]+/)?.[0].replace(',', '.'));
      else if (k === 'shiny') p.shiny = /^(sim|yes|true)/i.test(v);
      else if (/z-?move|tm elemental/.test(k)) p.tmElemental = v.split(/[\s(,]/)[0].toUpperCase();
    }
    if (s.startsWith('|')) {
      const c = s.split('|').map(x => x.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
      const h = c.map(x => x.toLowerCase());
      if (h[0] === 'stat' || h[0] === 'atributo') { colIv = h.findIndex(x => /^iv/.test(x)); colRef = h.findIndex(x => /^(refino|refine)/.test(x)); continue; }
      const key = ROTULO_STAT[(c[0] || '').toLowerCase().replace(/\s/g, '')];
      if (key && colIv > 0) { p.ivs[key] = num(c[colIv]); if (colRef > 0) p.refino[key] = num(c[colRef]) || 0; }
    }
  }
  if (!p.speciesId && nome) p.speciesId = (await window.av.especie(nome))?.id;
  const falta = [];
  if (!p.speciesId) falta.push('espécie');
  if (!(p.level > 0)) falta.push('nível');
  if (!(p.potencia >= 1)) falta.push('potência');
  if (!(p.quality > 0)) falta.push('qualidade');
  if (STATS.some(k => !(p.ivs[k] >= 1))) falta.push('os 6 IVs');
  if (falta.length) throw new Error('Não achei na ficha: ' + falta.join(', ') + '.');
  return p;
}

// ---------- raridade do nascimento ----------
function chanceQualMaiorOuIgual(q) {
  let p = 0;
  for (const [a, b, c] of FAIXAS_Q) {
    if (q <= a) p += c;
    else if (q < b) p += c * (b - q) / (b - a);
  }
  return Math.max(p, 1e-6);
}
const DIST_IV = (() => { // soma de 6 sorteios de 1 a 32
  let d = [1];
  for (let k = 0; k < 6; k++) {
    const nd = new Array(d.length + 32).fill(0);
    d.forEach((v, i) => { for (let x = 1; x <= 32; x++) nd[i + x] += v / 32; });
    d = nd;
  }
  return d;
})();
const chanceIvMaiorOuIgual = (iv, shiny) => {
  const cauda = (x) => DIST_IV.slice(Math.max(0, x)).reduce((a, b) => a + b, 0);
  return shiny ? cauda(Math.max(iv, 111)) / cauda(111) : cauda(iv);
};

// ---------- preço justo ----------
function quantil(vals, q) {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a.v - b.v);
  const tot = s.reduce((t, x) => t + x.w, 0);
  let acc = 0;
  for (const x of s) { acc += x.w; if (acc >= q * tot) return x.v; }
  return s[s.length - 1].v;
}
function precoJusto(alvo, med, vendas, moeda) {
  const paraMoeda = (preco, m) => m === moeda ? preco : moeda === 'orb' ? preco / OURO_POR_GEMA : preco * OURO_POR_GEMA;
  const parecidas = vendas.filter(v => v.shiny === !!alvo.shiny);
  const comparaveis = parecidas.map(v => {
    const dn = med.nota != null && v.nota != null ? Math.abs(v.nota - med.nota) : 1;
    const mesmaPot = v.potencia === alvo.potencia;
    // o nível pesa muito no preço: vendas de nível parecido contam mais, e o ajuste usa a força no nível de cada uma
    const dNivel = Math.abs(Math.log(Math.max(1, alvo.level) / Math.max(1, v.level)));
    const razao = v.pveAgora > 0 ? Math.min(3, Math.max(1 / 3, med.pveAgora / v.pveAgora)) : 1;
    const peso = Math.exp(-dn / 0.6) * Math.exp(-dNivel / 0.5) * (mesmaPot ? 1 : 0.35) * (v.moeda === moeda ? 1 : 0.5);
    return { ...v, dn, mesmaPot, valor: paraMoeda(v.preco, v.moeda) * razao, peso };
  }).filter(v => v.peso > 0.05);
  const w = comparaveis.map(v => ({ v: v.valor, w: v.peso }));
  return {
    comparaveis, n: comparaveis.length,
    justo: quantil(w, 0.5), baixo: quantil(w, 0.25), alto: quantil(w, 0.75),
    outraMoeda: comparaveis.some(v => v.moeda !== moeda),
  };
}

// ---------- avaliar ----------
let ultimoAnuncio = null;
async function avaliar() {
  const msg = $('msg'); msg.textContent = ''; msg.className = 'mut';
  let alvo;
  try { alvo = ultimoAnuncio?.ficha && $('ficha').dataset.anuncio === '1' ? ultimoAnuncio.ficha : await lerFicha($('ficha').value); }
  catch (e) { msg.textContent = e.message; msg.className = 'err'; return; }
  const preco = Number(String($('preco').value).replace(/\./g, '').replace(',', '.'));
  const moeda = $('moeda').value;
  $('avaliar').disabled = true;
  $('resultado').innerHTML = '<div class="panel carregando">Calculando com as fórmulas do jogo e lendo a Tabela de preços…</div>';
  const r = await window.av.calcular({ alvo });
  $('avaliar').disabled = false;
  if (!r || r.erro) { $('resultado').innerHTML = `<div class="panel err">Não deu pra avaliar: ${esc(r?.erro || 'sem resposta')}.</div>`; return; }
  const esp = await window.av.especie(alvo.speciesId);
  render(alvo, esp, r, preco > 0 ? preco : null, moeda);
}

function render(alvo, esp, r, preco, moeda) {
  const m = r.alvo, iv = STATS.reduce((t, k) => t + (Number(alvo.ivs?.[k]) || 0), 0);
  const lendario = m.nota == null;
  const outland = esp.id >= 2001 && esp.id <= 2058;
  const moedaTxt = moeda === 'orb' ? 'gemas' : 'ouro';
  const fmtP = (v) => v == null ? '—' : moeda === 'orb' ? `${n(v)} gemas` : `${curto(v)} ouro`;
  const usd = (v) => moeda === 'orb' ? v * GEMA_SAQUE_USD : (v / OURO_POR_GEMA) * GEMA_SAQUE_USD;

  // raridade
  const pPot = CHANCE_POT.slice(alvo.potencia - 1).reduce((a, b) => a + b, 0);
  const pQ = chanceQualMaiorOuIgual(Number(alvo.quality));
  const pIv = chanceIvMaiorOuIgual(iv, !!alvo.shiny);
  const pTotal = pPot * pQ * pIv * (alvo.shiny ? 1 / 24000 : 1);
  const raridade = 1 / Math.max(pTotal, 1e-12);

  // força relativa (régua: o melhor nascimento comum da espécie no mesmo nível)
  // régua: a nota do próprio jogo (0 a 10 dentro da espécie). O nível soma por cima disso.
  const pctNasc = lendario ? 100 : Math.max(2, Math.min(100, m.nota * 10));
  const inicial = Number(alvo.quality) === 1.6 && STATS.every(k => Number(alvo.ivs?.[k]) === 27);
  const [hp, atk, , spAtk] = esp.b;
  const folga = spAtk - Math.max(atk, hp);
  const alcance = folga <= 0 ? 'corpo a corpo' : folga < 25 ? 'à distância 2🏹' : folga < 50 ? 'à distância 3🏹' : 'à distância 4🏹';

  // preço
  const pj = precoJusto(alvo, m, r.vendas || [], moeda);
  let verd = { cls: 'neutro', txt: 'Sem preço para comparar', sub: 'Digite o preço do anúncio para ver o veredito.' };
  if (preco && pj.justo) {
    const d = preco / pj.justo - 1;
    const pct = Math.round(Math.abs(d) * 100);
    const vezes = preco / pj.justo;
    verd = d <= -0.15 ? { cls: 'bom', txt: `Preço bom · ~${pct}% abaixo do justo` }
      : d < 0.15 ? { cls: 'justo', txt: `Preço justo · ${d < 0 ? pct + '% abaixo' : pct + '% acima'} do estimado` }
      : { cls: 'caro', txt: vezes >= 3 ? `Muito caro · ${n(vezes, vezes < 10 ? 1 : 0)}× o preço justo` : `Caro · ~${pct}% acima do justo` };
    verd.sub = `Estimado: ${fmtP(pj.justo)} (faixa ${fmtP(pj.baixo)} – ${fmtP(pj.alto)}), com base em ${pj.n} venda${pj.n === 1 ? '' : 's'} parecida${pj.n === 1 ? '' : 's'} nos últimos 30 dias${pj.outraMoeda ? ' (algumas convertidas da outra moeda)' : ''}.`;
    if (pj.n < 3) verd.sub += ' Poucas vendas: trate como estimativa fraca.';
  } else if (preco) {
    verd = { cls: 'neutro', txt: 'Sem vendas parecidas para comparar', sub: r.erroVendas ? `A Tabela de preços: ${r.erroVendas}.` : 'Ninguém vendeu um parecido nos últimos 30 dias. Use a força e a raridade abaixo para decidir.' };
  }

  const serve = () => lendario ? '<span class="ok">excelente (lendário ×4)</span>' : m.nota >= 7 ? '<span class="ok">excelente</span>' : m.nota >= 5.5 ? '<span class="ok">bom</span>' : m.nota >= 4 ? '<span class="warn">mediano</span>' : '<span class="err">fraco para a espécie</span>';
  const showdownOk = !alvo.shiny && alvo.potencia < 5 && !lendario && !outland && !alvo.tmElemental;
  const amadorOk = !alvo.shiny && alvo.potencia < 5 && !lendario;
  const sacr = m.nota != null && m.nota >= 3.5 ? PONTOS_SACRIFICIO.find(([nn]) => m.nota >= nn)?.[1] : null;
  const vendasHtml = (pj.comparaveis || []).sort((a, b) => b.peso - a.peso).slice(0, 12).map(v =>
    `<tr class="${v.dn < 0.4 && v.mesmaPot ? 'perto' : ''}"><td>${new Date(v.em).toLocaleDateString('pt-BR')}</td><td>Nv ${n(v.level)}</td><td>P${v.potencia}</td><td>${n(v.quality, 3)}</td><td>${v.iv ?? '—'}</td><td>${v.nota != null ? n(v.nota, 2) : '—'}</td><td class="n">${v.moeda === 'orb' ? n(v.preco) + ' gemas' : curto(v.preco) + ' ouro'}</td></tr>`).join('');

  $('resultado').innerHTML = `<div class="panel">
    <div class="top">
      <img class="spr" alt="" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${alvo.shiny ? 'shiny/' : ''}${esp.spriteId || esp.id}.png">
      <div><div class="nm">${alvo.shiny ? '✦ ' : ''}${esc(esp.n)} · Nv ${n(alvo.level)}</div>
        <div class="tags"><span class="tag">P${alvo.potencia}</span><span class="tag">Q ${n(alvo.quality, 3)} ${RUTULO_Q(alvo.quality)}</span><span class="tag">IV ${iv}/192</span>
        ${lendario ? '<span class="tag">Lendário · sem nota</span>' : `<span class="tag">N ${n(m.nota, 2)} ${FAIXA_NOTA[Math.min(9, Math.floor(m.nota))]}</span>`}
        ${alvo.tmElemental ? `<span class="tag">Z-Move ${esc(alvo.tmElemental)}</span>` : ''}${outland ? '<span class="tag">Outland</span>' : ''}</div></div>
      ${preco ? `<div class="price"><small class="mut">anunciado</small><br><b>${fmtP(preco)}</b><br><small class="mut">≈ US$ ${n(usd(preco), 2)} no saque</small></div>` : ''}
    </div>
    <div class="verd ${verd.cls}"><b>${verd.txt}</b><br><span class="mut">${verd.sub}</span>
      <div style="margin-top:8px"><button id="verPrec">Comparar no Precificador (pokeidleguide.io)</button> <span class="mut" style="font-size:11px">segunda opinião: shiny pela tabela da staff</span></div></div>
    <div class="g3">
      <div class="k"><small>Força PvE (no nível dele)</small><b>${n(m.pveAgora)}</b><div class="bar"><i style="width:${pctNasc}%"></i></div><small>nascimento ${lendario ? 'de lendário' : 'nota ' + n(m.nota, 1) + '/10'} · no Nv 100: ${n(m.pve100)}</small></div>
      <div class="k"><small>Força PvP (régua da arena)</small><b>${n(m.pvp)} ⚔</b><div class="bar"><i style="width:${pctNasc}%"></i></div><small>luta como Nv ${n(m.pvpNivel)} · ${alcance}</small></div>
      <div class="k"><small>Raridade do nascimento</small><b>${inicial ? 'inicial (fixo)' : '1 em ' + curto(raridade)}</b><div class="bar"><i style="width:${Math.min(100, Math.log10(raridade) * 16)}%"></i></div><small>P${alvo.potencia}+ · Q ≥ ${n(alvo.quality, 2)} · IV ≥ ${iv}${alvo.shiny ? ' · shiny' : ''}</small></div>
    </div>
    <div class="sec">Onde ele serve</div>
    <div class="row"><span>Hunt (PvE)</span><span>${serve()} · melhor golpe: ${esc(m.golpe || '—')}</span></div>
    <div class="row"><span>PvP Ranqueado · Mundial · Ginásio</span><span>${serve()} · ${n(m.pvp)} ⚔</span></div>
    <div class="row"><span>Showdown (teto Nv 150)</span><span>${showdownOk ? `entra · luta com ${n(m.showdown)} ⚔` : '<span class="err">não entra</span> (shiny, P5, lendário, Outland ou Z-Move)'}</span></div>
    <div class="row"><span>Campeonato Amador</span><span>${amadorOk ? '<span class="ok">entra</span>' : '<span class="err">não entra</span> (shiny, P5 ou lendário)'}</span></div>
    <div class="row"><span>Sacrifício</span><span>${sacr ? `${sacr} pontos` : '<span class="mut">não vale (nota abaixo de 3,5 ou lendário)</span>'}</span></div>
    <div class="row"><span>Pode revender no Mercado</span><span>${alvo.shiny || alvo.potencia === 5 || lendario || (alvo.level >= 50 && m.nota >= 3.5) ? '<span class="ok">sim</span>' : '<span class="warn">só com Nv 50+ e nota 3,5+</span>'}${alvo.shiny ? ' · só em gemas' : ''}</span></div>
    <div class="sec">Vendas parecidas (últimos 30 dias)</div>
    ${vendasHtml ? `<table><thead><tr><th>Data</th><th>Nível</th><th>Pot.</th><th>Qual.</th><th>IV</th><th>Nota</th><th class="n">Preço</th></tr></thead><tbody>${vendasHtml}</tbody></table>
      <p class="mut" style="font-size:11px;margin:6px 0 0">Destacadas: mesma potência e nota parecida. O preço justo pondera pela parecença e ajusta pela força de cada uma.</p>`
      : `<p class="mut">${r.erroVendas ? esc(r.erroVendas) : `Nenhuma venda de ${esc(esp.n)} ${alvo.shiny ? 'shiny ' : ''}nos últimos 30 dias.`}</p>`}
    <p class="mut" style="font-size:11px;margin:10px 0 0">Força e nota pelas fórmulas do jogo (módulos públicos do PokeIdle). Ouro ↔ gema convertido a ~${curto(OURO_POR_GEMA)} de ouro por gema. ${alvo.tmElemental ? '' : 'Ficha colada não traz o Z-Move; se ele tiver, a força real é maior.'}</p>
  </div>`;
  $('verPrec').onclick = () => window.av.precificador({ especie: esp.n, shiny: !!alvo.shiny, nivel: alvo.level, potencia: alvo.potencia,
    qualidade: Number(alvo.quality).toFixed(3), ivs: STATS.map(k => alvo.ivs?.[k]) });
  const img = $('resultado').querySelector('.spr');
  if (img) img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
}

function carregarAnuncio(a) {
  if (!a?.ficha) return;
  ultimoAnuncio = a;
  $('ficha').value = `Anúncio de ${a.vendedor || '?'}: ${a.nome || 'Pokémon'} · Nv ${a.ficha.level} · P${a.ficha.potencia}`;
  $('ficha').dataset.anuncio = '1';
  $('preco').value = a.preco != null ? String(a.preco) : '';
  $('moeda').value = a.moeda === 'gold' ? 'gold' : 'orb';
  $('origem').innerHTML = `Avaliando o anúncio de <b>${esc(a.vendedor || '?')}</b>. Para avaliar outro, cole uma ficha ou clique em Avaliar noutro anúncio.`;
  avaliar();
}
$('ficha').addEventListener('input', () => { $('ficha').dataset.anuncio = ''; });
$('avaliar').onclick = avaliar;
$('abrirPrec').onclick = () => window.av.precificador(null);
window.av.aoReceberAnuncio(carregarAnuncio);
window.av.pendente().then(a => a && carregarAnuncio(a));
