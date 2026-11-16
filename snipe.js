// Snipe próprio do Mercado da Comunidade (substitui o Rotom Sniper, sem avisos na tela do jogo).
// Uma conta lê o Mercado (a lista é a mesma pra todo mundo); quando um anúncio passa numa regra,
// a conta dona da regra compra pelo próprio socket. Tudo vai pro histórico tipado do painel.
// Modos por conta: Desligado, Ensaio (só registra "teria comprado") e Comprando.

const SNIPE_INTERVALO = 4000;          // consulta do Mercado
const SNIPE_INTERVALO_LENTO = 8000;    // depois de um "Devagar" do servidor
const SNIPE_HIST_MAX = 400;
const SNIPE_TIPOS = {
  COMPRA: { rot: 'Compras', cls: 'ok' }, ENSAIO: { rot: 'Ensaios', cls: 'ens' }, PERDIDA: { rot: 'Perdidas', cls: 'err' },
  RECUSADA: { rot: 'Recusadas', cls: 'err' }, SALDO: { rot: 'Saldo', cls: 'err' }, LIMITE: { rot: 'Limites', cls: 'ens' },
  RITMO: { rot: 'Ritmo', cls: 'inf' }, INFO: { rot: 'Info', cls: 'inf' },
};

// ================= dentro do jogo =================

// uma rodada de leitura do Mercado: devolve os anúncios que passam nas regras (não compra nada)
async function pageSnipeScan({ ciclo, regras }) {
  const S = window.__plSnipe, A = window.__plAval;
  if (!S || !S.pronto()) return { erro: 'o jogo ainda não conectou' };
  const achados = [];
  let ritmo = false, adiados = 0;
  S.esperar(m => m.t === 'erro' && /devagar/i.test(String(m.msg || m.chave || '')), 4000).then(m => { if (m) ritmo = true; });
  const moedaDe = (m) => /^(gold|coins?|ouro)$/i.test(String(m || 'gold')) ? 'gold' : 'orb';
  const aberto = (a) => a && a.id != null && !a.comprador && (!a.estado || a.estado === 'aberto') && Number(a.preco) > 0;
  const fixoOk = (r, p) => Number(r.max) > 0 && p <= Number(r.max);
  const pctOk = (r, p, m) => !!(m && m.justo && (m.n || 0) >= (Number(r.minVendas) || 1) && p <= m.justo * (1 - (Number(r.pct) || 0) / 100));
  const precoOk = (r, p, m) => r.modo === 'fixo' ? fixoOk(r, p) : r.modo === 'pct' ? pctOk(r, p, m) : fixoOk(r, p) && pctOk(r, p, m);
  const pk = regras.filter(r => r.tipo === 'pokemon'), it = regras.filter(r => r.tipo === 'item');

  // ---- Pokémon: alterna recentes / mais baratos em ouro / mais baratos em gemas
  if (pk.length) {
    const [ordem, moeda] = [['recentes', ''], ['menor_preco', 'gold'], ['menor_preco', 'orb']][ciclo % 3];
    const resp = S.esperar(m => m.t === 'market' && !/^(historico|meus$|itens$|item$|cancelado$)/.test(m.aba || '') &&
      (Array.isArray(m.anuncios) || Array.isArray(m.linhas)), 3500);
    S.enviar({ t: 'market.listar', tipo: 'pokemon', ordem, moeda, busca: '', criterios: [], elemento: '' });
    const m = await resp;
    const lista = m ? [...(m.anuncios || []), ...(m.linhas || [])] : [];
    if (A) await A.modulos().catch(() => null);
    let novas = 0; // históricos novos por rodada (cada um são até 4 pedidos ao servidor)
    for (const a of lista) {
      const f = a.ficha;
      if (!aberto(a) || !f || !f.speciesId) continue;
      const preco = Number(a.preco), moedaA = moedaDe(a.moeda), sid = Number(f.speciesId);
      let med, merc;
      for (const r of pk) {
        if (r.moeda !== moedaA) continue;
        if (r.especieId && Number(r.especieId) !== sid) continue;
        if (r.shiny && !f.shiny) continue;
        if (r.p5 && !(Number(f.potencia) >= 5)) continue;
        if (r.nivelMin && !(Number(f.level) >= Number(r.nivelMin))) continue;
        if (r.modo !== 'pct' && !fixoOk(r, preco)) continue;
        if (r.notaMin) {
          if (med === undefined) { try { const esp = A && await A.especie(sid); med = esp ? A.medir(f, esp) : null; } catch { med = null; } }
          if (!med || !(med.nota >= Number(r.notaMin))) continue;
        }
        if (r.modo !== 'fixo') {
          if (merc === undefined) {
            if (!A) merc = null;
            else if (!A.historicoPronto(sid) && novas >= 2) { merc = 'depois'; }
            else { if (!A.historicoPronto(sid)) novas++; merc = await A.precoDeMercado(a).catch(() => null); }
          }
          if (merc === 'depois') { adiados++; continue; }
          if (!precoOk(r, preco, merc)) continue;
        }
        achados.push({
          regra: r.id, tipo: 'pokemon', id: a.id, preco, moeda: moedaA, qtd: 1,
          compravelEm: Number(a.compravelEm || a.compravelEmMs || 0), vendedor: String(a.vendedor || ''),
          nome: f.nome || f.name || '', especieId: sid, shiny: !!f.shiny, potencia: f.potencia, level: f.level,
          nota: med && med.nota != null ? Math.round(med.nota * 10) / 10 : null,
          justo: merc && merc.justo ? Math.round(merc.justo) : null, n: (merc && merc.n) || 0,
        });
        break; // um anúncio vai pra uma regra só (a primeira da lista)
      }
    }
  }

  // ---- Itens: resumo do Mercado (menor preço de cada item) e, se algum serve, os vendedores daquele item
  if (it.length && ciclo % 2 === 0) {
    const resp = S.esperar(m => m.t === 'market' && m.aba === 'itens' && m.resumo, 3500);
    S.enviar({ t: 'market.itens' });
    const m = await resp;
    const vistos = new Map(); // itemId:moeda -> linhas
    if (m) for (const r of it) {
      const res = m.resumo[r.itemId] || m.resumo[String(r.itemId)];
      const min = res ? Number(r.moeda === 'gold' ? res.minGold : res.minOrb) || 0 : 0;
      if (!min || (r.modo !== 'pct' && !fixoOk(r, min))) continue;
      const k = r.itemId + ':' + r.moeda;
      if (!vistos.has(k)) {
        const rItem = S.esperar(x => x.t === 'market' && x.aba === 'item' && Number(x.itemId) === Number(r.itemId), 3500);
        S.enviar({ t: 'market.item', itemId: Number(r.itemId), moeda: r.moeda });
        vistos.set(k, (await rItem)?.linhas || []);
      }
      let merc = null;
      if (r.modo !== 'fixo') merc = await pageSnipePrecoItem(r).catch(() => null);
      for (const l of vistos.get(k)) {
        if (!aberto(l)) continue;
        const preco = Number(l.preco);
        if (!precoOk(r, preco, merc)) continue;
        achados.push({
          regra: r.id, tipo: 'item', id: l.id, preco, moeda: r.moeda, qtd: Number(l.qtd) || 1,
          compravelEm: Number(l.compravelEm || l.compravelEmMs || 0), vendedor: String(l.vendedor || ''),
          nome: (l.ficha && l.ficha.nome) || r.alvo, itemId: r.itemId, justo: merc && merc.justo ? merc.justo : null, n: (merc && merc.n) || 0,
        });
      }
    }
  }
  return { achados, ritmo, adiados };

  // preço de mercado de um item: vendas dos últimos 30 dias (Tabela de preços), cache de 10 min
  async function pageSnipePrecoItem(r) {
    const c = (window.__plPrecoItem ||= new Map()), k = r.itemId + ':' + r.moeda, v = c.get(k);
    if (v && Date.now() - v.em < 10 * 60e3) return v.r;
    const precos = [];
    for (let pg = 0; pg < 2; pg++) {
      const seq = 800000 + Math.floor(Math.random() * 90000);
      const resp = S.esperar(x => x.t === 'market' && x.aba === 'historicoGlobal' && (x.seq == null || x.seq === seq), 4000);
      S.enviar({ t: 'market.historicoGlobal', pagina: pg, seq, tipo: 'item', busca: r.alvo });
      const x = await resp;
      if (!x) break;
      for (const l of x.linhas || []) {
        const id = Number(l.itemId || (l.ficha && l.ficha.itemId) || 0);
        if (id !== Number(r.itemId) || moedaDe(l.moeda) !== r.moeda) continue;
        const q = Number(l.qtd || (l.ficha && l.ficha.qtd) || 1) || 1;
        const unit = Number(l.preco) || Number(l.bruto) / q;
        if (unit > 0) precos.push(unit);
      }
      if (!x.temMais) break;
    }
    precos.sort((a, b) => a - b);
    const out = precos.length ? { justo: precos[Math.floor(precos.length / 2)], n: precos.length } : { semVendas: true, n: 0 };
    c.set(k, { em: Date.now(), r: out });
    return out;
  }
}

// compra um anúncio pela conta desta aba (respeita o saldo e o horário de liberação do servidor)
async function pageSnipeComprar(o) {
  const S = window.__plSnipe;
  if (!S || !S.pronto()) return { erro: 'o jogo não está conectado' };
  const eu = window.__plEu || {};
  const saldo = o.moeda === 'gold' ? eu.gold : eu.orbs;
  let qtd = Math.max(1, Number(o.qtd) || 1);
  if (typeof saldo === 'number') {
    if (saldo < o.preco) return { erro: 'saldo', saldo };
    qtd = Math.min(qtd, Math.floor(saldo / o.preco));
  }
  const espera = Number(o.compravelEm || 0) - S.agora();
  if (espera > 120e3) return { erro: 'o anúncio só libera daqui a mais de 2 min' };
  if (espera > 0) await new Promise(r => setTimeout(r, espera + 120));
  const comprado = (m) => m.t === 'batalha' && Array.isArray(m.ev) && m.ev.some(e => e && (e.k === 'marketComprado' || e.t === 'marketComprado'));
  const tentar = async () => {
    const resp = S.esperar(m => comprado(m) || m.t === 'erro', 6000);
    if (!S.enviar({ t: 'market.comprar', id: Number(o.id), qtd, preco: Number(o.preco), moeda: String(o.moeda) })) return { erro: 'o jogo não está conectado' };
    const m = await resp;
    if (!m) return { semResposta: true, qtd };
    if (m.t === 'erro') return { erro: String(m.msg || m.chave || 'recusada pelo servidor') };
    const e = m.ev.find(x => x && (x.k === 'marketComprado' || x.t === 'marketComprado'));
    return { ok: true, qtd, desc: (e && e.descricao) || '' };
  };
  let r = await tentar();
  if (r.erro && /ainda|liber|aguard|espera/i.test(r.erro)) { await new Promise(x => setTimeout(x, 700)); r = await tentar(); }
  return r;
}

// catálogo de itens do jogo (nome e id) e o que esta conta tem
async function pageSnipeCatalogo() {
  let lista = [];
  try { lista = ((await (await fetch('/assets/items.json')).json()).items || []).map(i => ({ id: Number(i.id), n: String(i.name || i.nome || '') })).filter(i => i.id && i.n); } catch { /* */ }
  return { itens: lista, tem: (window.__plEu && window.__plEu.items) || {} };
}

// itens à venda no Mercado da Comunidade agora (ids). Itens da loja do jogo (Revive, poções, bolas) não aparecem aqui.
async function pageSnipeItensMercado() {
  const S = window.__plSnipe;
  if (!S || !S.pronto()) return null;
  const resp = S.esperar(m => m.t === 'market' && m.aba === 'itens' && m.resumo, 4000);
  S.enviar({ t: 'market.itens' });
  const m = await resp;
  return m ? Object.keys(m.resumo).map(Number).filter(Boolean) : null;
}

// "hoje no mercado": faixa de preço recente (Pokémon: Tabela de preços; item: anúncios abertos agora)
async function pageSnipeFaixa(q) {
  const S = window.__plSnipe, A = window.__plAval;
  if (!S || !S.pronto()) return null;
  const moedaDe = (m) => /^(gold|coins?|ouro)$/i.test(String(m || 'gold')) ? 'gold' : 'orb';
  let precos = [];
  if (q.tipo === 'pokemon') {
    if (!A || !q.especieId) return null;
    await A.modulos();
    const esp = await A.especie(Number(q.especieId));
    if (!esp) return null;
    const linhas = await A.historico(esp);
    precos = linhas.filter(l => moedaDe(l.moeda) === q.moeda && (!q.shiny || l.ficha.shiny) && (!q.p5 || Number(l.ficha.potencia) >= 5)).map(l => Number(l.bruto));
  } else {
    const resp = S.esperar(x => x.t === 'market' && x.aba === 'item' && Number(x.itemId) === Number(q.itemId), 3500);
    S.enviar({ t: 'market.item', itemId: Number(q.itemId), moeda: q.moeda });
    precos = ((await resp)?.linhas || []).map(l => Number(l.preco));
  }
  precos = precos.filter(p => p > 0).sort((a, b) => a - b);
  const tem = q.itemId && window.__plEu && window.__plEu.items ? Number(window.__plEu.items[q.itemId] || 0) : null;
  if (!precos.length) return { n: 0, tem };
  return { n: precos.length, min: precos[0], max: precos[precos.length - 1], med: precos[Math.floor(precos.length / 2)], tem };
}

// ================= no app =================

const snipe = { ciclo: 0, lentoAte: 0, vistos: new Map(), rodando: false, timer: null, sel: null, filtro: 'all', editando: null, catalogo: null, especies: null };

function snipeCfg() {
  const s = (cfg.settings.snipe ||= { contas: {}, regras: [] });
  s.contas ||= {}; s.regras ||= [];
  for (const a of cfg.settings.pokeAccounts) s.contas[a.id] ||= { modo: 'off', tetoOuro: 100e6, tetoGemas: 100 };
  return s;
}
function snipeDia() {
  const hoje = new Date().toLocaleDateString('sv-SE');
  if (!cfg.snipeDia || cfg.snipeDia.dia !== hoje) cfg.snipeDia = { dia: hoje, contas: {}, regras: {}, limiteAvisado: {} };
  return cfg.snipeDia;
}
const snipeGasto = (id) => (snipeDia().contas[id] ||= { gold: 0, orb: 0 });
const snipeLogada = (id) => !!(pokeViews[id] && tileInfo[id] && !tileInfo[id].login && !tileInfo[id].outra);
const snipeAberto = () => { const b = $('snipeBox'); return !!b && !b.hidden; };
const snipeEsc = (s) => String(s ?? '').replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`);
function snipeFmt(v, moeda) {
  if (v == null || isNaN(v)) return '—';
  if (moeda === 'gold') {
    if (v >= 1e9) return (v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' bi';
    if (v >= 1e6) return (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
    return Math.round(v).toLocaleString('pt-BR');
  }
  return Math.round(v).toLocaleString('pt-BR') + ' gemas';
}
// "15.000.000", "15 mi", "1,5 bi", "2500" -> número
function snipeNum(t) {
  const m = String(t || '').trim().toLowerCase().replace(/\s+/g, '').match(/^([\d.,]+)(bi|b|mi|m|mil|k)?$/);
  if (!m) return 0;
  const mult = { bi: 1e9, b: 1e9, mi: 1e6, m: 1e6, mil: 1e3, k: 1e3 }[m[2]] || 1;
  // com sufixo, vírgula (ou ponto solto) é decimal: "1,5 bi"; sem sufixo, pontos e vírgulas são milhar
  const num = mult > 1 ? m[1].replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.') : m[1].replace(/[.,]/g, '');
  const n = parseFloat(num);
  return isNaN(n) ? 0 : Math.round(n * mult);
}

function snipeHist(conta, tipo, txt, det = '', vend = '') {
  const h = (cfg.snipeHist ||= []);
  h.unshift({ em: Date.now(), conta, tipo, txt, det, vend });
  if (h.length > SNIPE_HIST_MAX) h.length = SNIPE_HIST_MAX;
  if (snipeAberto()) snipeRenderHist();
}

function snipeResumoRegra(r) {
  const alvo = r.tipo === 'item' ? r.alvo : [r.alvo || 'Qualquer Pokémon', r.shiny && 'shiny', r.p5 && 'P5'].filter(Boolean).join(' ');
  const extras = r.tipo === 'pokemon' ? [r.notaMin && `nota ≥ ${r.notaMin}`, r.nivelMin && `nível ≥ ${r.nivelMin}`].filter(Boolean) : [];
  const teto = `${r.tipo === 'item' ? 'cada ' : ''}≤ ${snipeFmt(r.max, r.moeda)}${r.moeda === 'gold' ? ' ouro' : ''}`;
  const pct = `${r.pct}% abaixo do mercado${r.minVendas > 1 ? `, ${r.minVendas}+ vendas` : ''}`;
  const preco = r.modo === 'fixo' ? teto : r.modo === 'pct' ? pct : `${teto} e ${pct}`;
  const qtd = r.tipo === 'item' ? ` · até ${r.qtdCompra || '∞'}/compra, ${r.qtdDia || '∞'}/dia` : '';
  return { titulo: alvo, sub: [...extras].join(' · '), preco: preco + qtd };
}

// ---------- o laço ----------
function snipeAgendar() {
  clearTimeout(snipe.timer);
  snipe.timer = setTimeout(snipeTick, Date.now() < snipe.lentoAte ? SNIPE_INTERVALO_LENTO : SNIPE_INTERVALO);
}
async function snipeTick() {
  try {
    if (snipe.rodando) return;
    const s = snipeCfg();
    const ativas = s.regras.filter(r => r.ativa && s.contas[r.conta]?.modo !== 'off' && s.contas[r.conta] && snipeLogada(r.conta));
    if (!ativas.length) return;
    // quem lê o Mercado: a primeira conta logada com o snipe ligado
    const leitor = cfg.settings.pokeAccounts.map(a => a.id).find(id => s.contas[id]?.modo !== 'off' && snipeLogada(id));
    if (!leitor) return;
    snipe.rodando = true;
    snipe.leitor = leitor;
    // limites do dia: regra de item que já bateu a quantidade do dia, ou conta sem teto sobrando naquela moeda
    const dia = snipeDia();
    const regras = ativas.filter(r => {
      const c = s.contas[r.conta], g = snipeGasto(r.conta);
      const teto = r.moeda === 'gold' ? Number(c.tetoOuro) : Number(c.tetoGemas);
      if (c.modo === 'on' && teto > 0 && g[r.moeda] >= teto) return false;
      if (r.tipo === 'item' && r.qtdDia > 0 && (dia.regras[r.id] || 0) >= r.qtdDia) return false;
      return true;
    });
    if (!regras.length) return;
    const ciclo = snipe.ciclo++;
    let res;
    try { res = await runIn(pokeViews[leitor], pageSnipeScan, { ciclo, regras }, 30e3); }
    catch { res = { erro: 'o jogo não respondeu' }; }
    if (!res || res.erro) return;
    if (res.ritmo && Date.now() > snipe.lentoAte) {
      snipe.lentoAte = Date.now() + 5 * 60e3;
      snipeHist(leitor, 'RITMO', 'Servidor pediu calma', 'consulta passou para 8 s por 5 min');
    }
    // limpa anúncios vistos há mais de 3 min
    for (const [k, t] of snipe.vistos) if (Date.now() - t > 3 * 60e3) snipe.vistos.delete(k);
    for (const a of res.achados || []) {
      const k = a.tipo + ':' + a.id;
      if (snipe.vistos.has(k)) continue;
      snipe.vistos.set(k, Date.now());
      const r = s.regras.find(x => x.id === a.regra);
      if (r) snipeAgir(r, a); // não espera: compra em paralelo com a próxima leitura
    }
  } finally {
    snipe.rodando = false;
    snipeAgendar();
  }
}

function snipeDescAnuncio(a) {
  if (a.tipo === 'item') return `${a.nome} ×${a.qtd}`;
  return [a.nome, a.shiny && 'shiny', Number(a.potencia) >= 5 && 'P5', a.nota != null && `nota ${a.nota}`, a.level && `nv ${a.level}`].filter(Boolean).join(' ');
}
function snipeDescPreco(a, qtd) {
  const unit = snipeFmt(a.preco, a.moeda) + (a.moeda === 'gold' ? ' ouro' : '');
  const merc = a.justo ? ` (mercado ${snipeFmt(a.justo, a.moeda)}, ${Math.round((a.preco / a.justo - 1) * 100)}%)` : '';
  return a.tipo === 'item' ? `${unit} cada · ${snipeFmt(a.preco * qtd, a.moeda)} no total${merc}` : unit + merc;
}

async function snipeAgir(r, a) {
  const s = snipeCfg(), c = s.contas[r.conta], dia = snipeDia(), g = snipeGasto(r.conta);
  // quantidade: o anúncio, o máximo por compra e o que falta do dia
  let qtd = a.qtd || 1;
  if (r.tipo === 'item') {
    if (r.qtdCompra > 0) qtd = Math.min(qtd, r.qtdCompra);
    if (r.qtdDia > 0) qtd = Math.min(qtd, r.qtdDia - (dia.regras[r.id] || 0));
  }
  const teto = r.moeda === 'gold' ? Number(c.tetoOuro) : Number(c.tetoGemas);
  if (c.modo === 'on' && teto > 0) qtd = Math.min(qtd, Math.floor((teto - g[r.moeda]) / a.preco));
  const desc = snipeDescAnuncio({ ...a, qtd: Math.max(qtd, 1) });
  if (qtd <= 0) {
    const k = r.conta + ':' + r.moeda;
    if (!dia.limiteAvisado[k]) {
      dia.limiteAvisado[k] = true;
      snipeHist(r.conta, 'LIMITE', `Teto de ${r.moeda === 'gold' ? 'ouro' : 'gemas'} do dia atingido`, `${desc} custava ${snipeFmt(a.preco, a.moeda)} · regras dessa moeda pausadas até 00:00`);
    }
    return;
  }
  if (c.modo === 'ensaio') {
    snipeHist(r.conta, 'ENSAIO', desc, `teria comprado por ${snipeDescPreco(a, qtd)}`, a.vendedor);
    return;
  }
  if (c.modo !== 'on' || !snipeLogada(r.conta)) return;
  // reserva o gasto antes de disparar (duas compras ao mesmo tempo não furam o teto)
  const reserva = a.preco * qtd;
  g[r.moeda] += reserva;
  if (r.tipo === 'item') dia.regras[r.id] = (dia.regras[r.id] || 0) + qtd;
  let res;
  try { res = await runIn(pokeViews[r.conta], pageSnipeComprar, { id: a.id, qtd, preco: a.preco, moeda: a.moeda, compravelEm: a.compravelEm }, 150e3); }
  catch { res = { erro: 'o jogo não respondeu' }; }
  const devolver = () => { g[r.moeda] -= reserva; if (r.tipo === 'item') dia.regras[r.id] -= qtd; };
  if (res.ok || res.semResposta) {
    const q = res.qtd || qtd;
    if (q < qtd) { g[r.moeda] -= a.preco * (qtd - q); if (r.tipo === 'item') dia.regras[r.id] -= qtd - q; }
    const d = snipeDescAnuncio({ ...a, qtd: q });
    const parcial = r.tipo === 'item' && q < (a.qtd || 1) ? ` de ${a.qtd}` : '';
    snipeHist(r.conta, 'COMPRA', d + parcial, snipeDescPreco(a, q) + (res.semResposta ? ' · o jogo não confirmou, confira o depósito' : ''), a.vendedor);
    blog(`${accName(r.conta)}: snipe comprou ${d} por ${snipeFmt(a.preco * q, a.moeda)}${a.moeda === 'gold' ? ' de ouro' : ''}.`, 'ok', 'snipe');
    if (window.statsCompra) statsCompra(accName(r.conta), 'Snipe: ' + d, q);
  } else {
    devolver();
    const e = String(res.erro || '');
    if (e === 'saldo') snipeHist(r.conta, 'SALDO', desc, `faltou ${a.moeda === 'gold' ? 'ouro' : 'gemas'} (custava ${snipeFmt(a.preco * qtd, a.moeda)}, tinha ${snipeFmt(res.saldo, a.moeda)})`, a.vendedor);
    else if (/vendid|n[ãa]o existe|n[ãa]o encontr|indispon|esgot|j[áa] foi|removid/i.test(e)) snipeHist(r.conta, 'PERDIDA', desc, 'alguém comprou antes · ' + e, a.vendedor);
    else snipeHist(r.conta, 'RECUSADA', desc, e, a.vendedor);
  }
  save();
  if (snipeAberto()) snipeRenderContas();
}

// ---------- painel ----------
function snipeAbrir() {
  let box = $('snipeBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'snipeBox';
    box.innerHTML = `
      <div class="sn-head">${ic('target')}<b>Snipe</b><span class="muted" id="snLeitor"></span><button id="snFechar">Fechar</button></div>
      <div class="sn-contas" id="snContas"></div>
      <div class="sn-card" id="snDetalhe"></div>
      <div class="sn-card" id="snEditor" hidden></div>
      <div class="sn-card"><div class="sn-row-head"><b>Histórico</b><span id="snFiltros"></span><span class="muted" id="snHistSub"></span></div><div id="snHist"></div></div>`;
    document.body.appendChild(box);
    $('snFechar').onclick = () => { box.hidden = true; };
  }
  snipe.sel ||= cfg.settings.pokeAccounts[0]?.id;
  box.hidden = false;
  snipeRender();
}
function snipeRender() { snipeRenderContas(); snipeRenderDetalhe(); snipeRenderHist(); }

function snipeRenderContas() {
  const s = snipeCfg();
  const rot = { off: ['Desligado', 'off'], ensaio: ['Ensaio', 'ens'], on: ['Comprando', 'ok'] };
  $('snLeitor').textContent = snipe.leitor && s.contas[snipe.leitor]?.modo !== 'off'
    ? `consulta o Mercado a cada ${Date.now() < snipe.lentoAte ? 8 : 4} s · lendo pela ${accName(snipe.leitor)}` : 'ligue uma conta pra começar';
  $('snContas').innerHTML = cfg.settings.pokeAccounts.map(a => {
    const c = s.contas[a.id], g = snipeGasto(a.id), [txt, cls] = rot[c.modo] || rot.off;
    const nRegras = s.regras.filter(r => r.conta === a.id), ativas = nRegras.filter(r => r.ativa).length;
    const barra = (rotulo, gasto, teto, moeda) => `<div class="sn-gasto"><span>${rotulo}</span><span>${snipeFmt(gasto, moeda)} / ${teto > 0 ? snipeFmt(teto, moeda) : 'sem teto'}</span></div>
      <div class="sn-bar"><i style="width:${teto > 0 ? Math.min(100, Math.round(gasto / teto * 100)) : 0}%"></i></div>`;
    const corpo = !snipeLogada(a.id) ? '<div class="muted">conta não está logada no app</div>'
      : c.modo === 'on' ? barra('Ouro hoje', g.gold, c.tetoOuro, 'gold') + barra('Gemas hoje', g.orb, c.tetoGemas, 'orb')
      : c.modo === 'ensaio' ? `<div class="muted">${(cfg.snipeHist || []).filter(h => h.conta === a.id && h.tipo === 'ENSAIO' && new Date(h.em).toLocaleDateString('sv-SE') === snipeDia().dia).length} ensaio(s) hoje · gastou 0</div>`
      : `<div class="muted">${nRegras.length ? `${nRegras.length} regra(s), ${ativas} ativa(s)` : 'sem regras'}</div>`;
    return `<div class="sn-conta${a.id === snipe.sel ? ' sel' : ''}" data-id="${a.id}">
      <div class="sn-conta-top"><b>${snipeEsc(a.name)}</b><span class="sn-pill ${cls}">${txt}</span></div>${corpo}</div>`;
  }).join('');
  $('snContas').querySelectorAll('.sn-conta').forEach(el => el.onclick = () => { snipe.sel = el.dataset.id; snipe.editando = null; $('snEditor').hidden = true; snipeRender(); });
}

function snipeRenderDetalhe() {
  const s = snipeCfg(), id = snipe.sel, c = s.contas[id], conta = cfg.settings.pokeAccounts.find(a => a.id === id);
  if (!c || !conta) { $('snDetalhe').innerHTML = ''; return; }
  const regras = s.regras.filter(r => r.conta === id);
  const modoBtn = (m, t) => `<span data-m="${m}" class="${c.modo === m ? 'on' : ''}">${t}</span>`;
  $('snDetalhe').innerHTML = `
    <div class="sn-row-head"><b>Regras de ${snipeEsc(conta.name)}</b>
      <span class="sn-seg" id="snModo">${modoBtn('off', 'Desligado')}${modoBtn('ensaio', 'Ensaio')}${modoBtn('on', 'Comprando')}</span>
      <button id="snNova">${ic('plus')} Regra</button></div>
    ${conta.snipe ? `<div class="sn-aviso">${ic('alert')} O Rotom Sniper também está ligado nesta conta. Desligue ele (menu da conta → Desligar snipe) pra os dois não disputarem o mesmo anúncio.</div>` : ''}
    <div class="sn-tetos"><label>Teto de ouro por dia <input id="snTetoOuro" value="${c.tetoOuro ? snipeFmt(c.tetoOuro, 'gold') : ''}" placeholder="sem teto"></label>
      <label>Teto de gemas por dia <input id="snTetoGemas" value="${c.tetoGemas || ''}" placeholder="sem teto"></label>
      <span class="muted">as regras de cima têm prioridade quando duas servem pro mesmo anúncio</span></div>
    ${regras.length ? regras.map((r, i) => { const t = snipeResumoRegra(r); return `<div class="sn-regra" data-id="${r.id}">
      <span class="sn-regra-txt"><b>${snipeEsc(t.titulo)}</b>${t.sub ? ` <span class="muted">· ${snipeEsc(t.sub)}</span>` : ''}<br><span class="muted">${snipeEsc(t.preco)}</span></span>
      <span class="sn-pill ${r.ativa ? 'ok' : 'off'}" data-a="ativa" title="Clique pra ${r.ativa ? 'pausar' : 'ativar'}">${r.ativa ? 'ativa' : 'pausada'}</span>
      <button class="iconbtn sm" data-a="subir" title="Mais prioridade" ${i ? '' : 'disabled'}>${ic('up')}</button>
      <button class="iconbtn sm" data-a="editar" title="Editar">${ic('pencil')}</button>
      <button class="iconbtn sm" data-a="apagar" title="Apagar">${ic('trash')}</button></div>`; }).join('')
      : '<div class="muted sn-vazio">Nenhuma regra ainda. Crie uma em "+ Regra"; a conta começa em Ensaio pra você calibrar antes de gastar.</div>'}`;
  $('snModo').querySelectorAll('span').forEach(b => b.onclick = () => {
    const m = b.dataset.m;
    if (m === 'on' && !confirm(`Ligar o snipe de verdade em ${conta.name}? Ele vai gastar ouro/gemas sozinho, até os tetos do dia.`)) return;
    c.modo = m; save();
    snipeHist(id, 'INFO', `Snipe ${m === 'off' ? 'desligado' : m === 'ensaio' ? 'em modo ensaio' : 'comprando'}`);
    snipeRender(); snipeAgendar();
  });
  $('snNova').onclick = () => snipeEditor(null);
  const tetos = () => { c.tetoOuro = snipeNum($('snTetoOuro').value); c.tetoGemas = snipeNum($('snTetoGemas').value); save(); snipeRenderContas(); };
  $('snTetoOuro').onchange = tetos; $('snTetoGemas').onchange = tetos;
  $('snDetalhe').querySelectorAll('.sn-regra').forEach(el => {
    const r = s.regras.find(x => x.id === el.dataset.id);
    el.querySelector('[data-a=ativa]').onclick = () => { r.ativa = !r.ativa; save(); snipeRender(); };
    el.querySelector('[data-a=editar]').onclick = () => snipeEditor(r);
    el.querySelector('[data-a=subir]').onclick = () => {
      const i = s.regras.indexOf(r), acima = s.regras.slice(0, i).reverse().find(x => x.conta === r.conta);
      if (!acima) return;
      const j = s.regras.indexOf(acima);
      [s.regras[i], s.regras[j]] = [s.regras[j], s.regras[i]]; save(); snipeRenderDetalhe();
    };
    el.querySelector('[data-a=apagar]').onclick = () => { if (!confirm('Apagar esta regra?')) return; s.regras.splice(s.regras.indexOf(r), 1); save(); snipeRender(); };
  });
}

function snipeRenderHist() {
  const tipos = ['all', 'COMPRA', 'ENSAIO', 'PERDIDA', 'RECUSADA', 'SALDO', 'LIMITE', 'RITMO'];
  $('snFiltros').innerHTML = tipos.map(t => `<span class="sn-pill ${t === snipe.filtro ? 'inf' : 'off'}" data-t="${t}">${t === 'all' ? 'Todos' : SNIPE_TIPOS[t].rot}</span>`).join('');
  $('snFiltros').querySelectorAll('[data-t]').forEach(b => b.onclick = () => { snipe.filtro = b.dataset.t; snipeRenderHist(); });
  const conta = cfg.settings.pokeAccounts.find(a => a.id === snipe.sel);
  $('snHistSub').textContent = conta ? conta.name : '';
  const linhas = (cfg.snipeHist || []).filter(h => (h.conta === snipe.sel || h.tipo === 'RITMO') && (snipe.filtro === 'all' || h.tipo === snipe.filtro)).slice(0, 80);
  $('snHist').innerHTML = linhas.length ? linhas.map(h => {
    const d = new Date(h.em), hoje = d.toLocaleDateString('sv-SE') === new Date().toLocaleDateString('sv-SE');
    const quando = (hoje ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ') + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const t = SNIPE_TIPOS[h.tipo] || SNIPE_TIPOS.INFO;
    return `<div class="sn-h"><span class="muted">${quando}</span><span class="sn-pill ${t.cls}">${h.tipo}</span>
      <span>${snipeEsc(h.txt)}${h.det ? ` · <span class="muted">${snipeEsc(h.det)}</span>` : ''}</span><span class="muted">${h.vend ? '@' + snipeEsc(h.vend) : ''}</span></div>`;
  }).join('') : '<div class="muted sn-vazio">Nada por aqui ainda.</div>';
}

// ---------- editor de regra ----------
async function snipeEditor(regra) {
  const id = snipe.sel;
  const r = regra ? { ...regra } : { tipo: 'pokemon', alvo: '', moeda: 'gold', shiny: false, p5: false, notaMin: 0, nivelMin: 0, modo: 'fixo', max: 0, pct: 30, minVendas: 3, qtdCompra: 0, qtdDia: 0 };
  snipe.editando = r;
  const ed = $('snEditor');
  ed.hidden = false;
  const seg = (nome, ops, val) => `<span class="sn-seg" data-campo="${nome}">${ops.map(([v, t]) => `<span data-v="${v}" class="${String(val) === String(v) ? 'on' : ''}">${t}</span>`).join('')}</span>`;
  const desenhar = () => {
    const pk = r.tipo === 'pokemon', ouro = r.moeda === 'gold';
    ed.innerHTML = `
      <div class="sn-row-head"><b>${regra ? 'Editar regra' : 'Nova regra'} · ${snipeEsc(accName(id))}</b></div>
      <div class="sn-grid">
        <label>Tipo ${seg('tipo', [['pokemon', 'Pokémon'], ['item', 'Item']], r.tipo)}</label>
        <label>Moeda ${seg('moeda', [['gold', 'Ouro'], ['orb', 'Gemas']], r.moeda)}</label>
        <label class="sn-larga">${pk ? 'Alvo (vazio = qualquer Pokémon)' : 'Item'}
          <input id="snAlvo" list="snLista" value="${snipeEsc(r.alvo)}" placeholder="${pk ? 'Gible' : 'Bronze Boss Token'}"><datalist id="snLista"></datalist></label>
      </div>
      ${pk ? `<div class="sn-linha"><label class="sn-chk"><input type="checkbox" id="snShiny" ${r.shiny ? 'checked' : ''}> Shiny</label>
        <label class="sn-chk"><input type="checkbox" id="snP5" ${r.p5 ? 'checked' : ''}> P5</label>
        <label class="sn-chk">Nota mínima <input id="snNota" class="sn-curto" value="${r.notaMin || ''}" placeholder="—"></label>
        <label class="sn-chk">Nível mínimo <input id="snNivel" class="sn-curto" value="${r.nivelMin || ''}" placeholder="—"></label></div>` : ''}
      <label>Como decidir o preço${pk ? '' : ' (por unidade)'} ${seg('modo', [['fixo', 'Valor fixo'], ['pct', '% abaixo do mercado'], ['ambos', 'Os dois']], r.modo)}</label>
      <div class="sn-grid">
        <label class="${r.modo === 'pct' ? 'sn-apagado' : ''}">Pagar no máximo${pk ? '' : ', cada'}
          <span class="sn-linha"><input id="snMax" value="${r.max ? (ouro ? r.max.toLocaleString('pt-BR') : r.max) : ''}" placeholder="${ouro ? '15.000.000' : '80'}"><span class="muted">${ouro ? 'ouro' : 'gemas'}</span></span>
          <span class="sn-linha">${(ouro ? [[1e6, '1 mi'], [10e6, '10 mi'], [100e6, '100 mi']] : [[10, '10'], [50, '50'], [100, '100']]).map(([v, t]) => `<button data-atalho="${v}">${t}</button>`).join('')}</span></label>
        <label class="${r.modo === 'fixo' ? 'sn-apagado' : ''}">Pelo menos abaixo do mercado
          <span class="sn-linha"><input id="snPct" class="sn-curto" value="${r.pct}"><span class="muted">%</span>
          <span class="muted">com</span><input id="snVendas" class="sn-curto" value="${r.minVendas}"><span class="muted">vendas ou mais</span></span></label>
      </div>
      ${pk ? '' : `<div class="sn-grid"><label>Máximo por compra <span class="sn-linha"><input id="snQCompra" value="${r.qtdCompra || ''}" placeholder="sem limite"><span class="muted">un.</span></span></label>
        <label>Máximo por dia <span class="sn-linha"><input id="snQDia" value="${r.qtdDia || ''}" placeholder="sem limite"><span class="muted">un.</span></span></label></div>`}
      <div class="sn-resumo" id="snResumo"></div>
      <div class="muted" id="snFaixa"></div>
      <div class="sn-erro" id="snErro"></div>
      <div class="sn-acoes"><button id="snCancelar">Cancelar</button><button class="accent" id="snSalvar">Salvar regra</button></div>`;
    // listas do campo Alvo
    const lista = pk ? (snipe.especies || []).map(e => e.n) : snipeItensRmt().map(i => i.n);
    $('snLista').innerHTML = lista.map(n => `<option value="${snipeEsc(n)}">`).join('');
    ed.querySelectorAll('.sn-seg[data-campo] span').forEach(b => b.onclick = () => { ler(); r[b.parentElement.dataset.campo] = b.dataset.v; if (b.parentElement.dataset.campo === 'tipo') r.alvo = ''; desenhar(); });
    ed.querySelectorAll('[data-atalho]').forEach(b => b.onclick = (e) => { e.preventDefault(); r.max = Number(b.dataset.atalho); $('snMax').value = ouro ? r.max.toLocaleString('pt-BR') : r.max; resumo(); });
    ed.querySelectorAll('input').forEach(i => i.oninput = () => { ler(); resumo(); });
    $('snAlvo').onchange = () => { ler(); faixa(); };
    $('snCancelar').onclick = () => { ed.hidden = true; snipe.editando = null; };
    $('snSalvar').onclick = salvar;
    resumo(); faixa();
  };
  const ler = () => {
    r.alvo = ($('snAlvo')?.value || '').trim();
    if ($('snShiny')) { r.shiny = $('snShiny').checked; r.p5 = $('snP5').checked; r.notaMin = Number(String($('snNota').value).replace(',', '.')) || 0; r.nivelMin = parseInt($('snNivel').value) || 0; }
    if ($('snMax')) r.max = r.moeda === 'gold' ? snipeNum($('snMax').value) : Number(String($('snMax').value).replace(',', '.')) || 0;
    if ($('snPct')) { r.pct = Math.max(0, Math.min(95, Number($('snPct').value) || 0)); r.minVendas = Math.max(1, parseInt($('snVendas').value) || 1); }
    if ($('snQCompra')) { r.qtdCompra = parseInt($('snQCompra').value) || 0; r.qtdDia = parseInt($('snQDia').value) || 0; }
  };
  const resumo = () => {
    const ouro = r.moeda === 'gold';
    const val = r.max ? (ouro ? r.max.toLocaleString('pt-BR') + ' de ouro' : r.max + ' gemas') : '(defina o valor)';
    const pct = `pelo menos ${r.pct}% abaixo do preço de mercado (${r.minVendas}+ vendas)`;
    const cond = r.modo === 'fixo' ? `anunciado por até ${val}` : r.modo === 'pct' ? pct : `por até ${val} e ${pct}`;
    let t;
    if (r.tipo === 'pokemon') {
      const quem = [r.alvo || 'qualquer Pokémon', r.shiny && 'shiny', r.p5 && 'P5'].filter(Boolean).join(' ');
      const extra = [r.notaMin && `nota ${r.notaMin}+`, r.nivelMin && `nível ${r.nivelMin}+`].filter(Boolean).join(' e ');
      t = `Compra ${quem}${extra ? ' com ' + extra : ''} que esteja ${cond}.`;
    } else {
      const condItem = r.modo === 'fixo' ? `anunciado por até ${val} cada` : r.modo === 'pct' ? pct : `por até ${val} cada e ${pct}`;
      const lim = [r.qtdCompra && `no máximo ${r.qtdCompra} por compra`, r.qtdDia && `${r.qtdDia} por dia`].filter(Boolean).join(' e ');
      const dia = r.qtdDia && r.max && r.modo !== 'pct' ? ` (até ${snipeFmt(r.qtdDia * r.max, r.moeda)}${ouro ? ' de ouro' : ''} por dia)` : '';
      t = `Compra ${r.alvo || '(escolha o item)'} ${condItem}${lim ? ', ' + lim : ''}${dia}.`;
    }
    $('snResumo').textContent = t;
  };
  let faixaSeq = 0;
  const faixa = async () => {
    const el = $('snFaixa'), seq = ++faixaSeq;
    el.textContent = '';
    if (!r.alvo || !snipeLogada(id)) return;
    let q = { tipo: r.tipo, moeda: r.moeda, shiny: r.shiny, p5: r.p5 };
    if (r.tipo === 'pokemon') { const e = await window.api.avaliadorEspecie(r.alvo).catch(() => null); if (!e) return; q.especieId = e.id; }
    else { const i = snipeAcharItem(r.alvo); if (!i) return; q.itemId = i.id; }
    el.textContent = 'olhando o mercado…';
    const f = await runIn(pokeViews[id], pageSnipeFaixa, q, 40e3).catch(() => null);
    if (seq !== faixaSeq) return;
    const tem = f && f.tem != null ? ` Você tem ${f.tem.toLocaleString('pt-BR')}.` : '';
    if (!f || !f.n) { el.textContent = (r.tipo === 'pokemon' ? 'Sem vendas parecidas nos últimos 30 dias.' : 'Ninguém anunciando agora.') + tem; return; }
    el.textContent = r.tipo === 'pokemon'
      ? `Vendas nos últimos 30 dias: de ${snipeFmt(f.min, r.moeda)} a ${snipeFmt(f.max, r.moeda)} (mediana ${snipeFmt(f.med, r.moeda)}, ${f.n} vendas).${tem}`
      : `Hoje no Mercado: de ${snipeFmt(f.min, r.moeda)} a ${snipeFmt(f.max, r.moeda)} cada (${f.n} anúncios).${tem}`;
  };
  const salvar = async () => {
    ler();
    const erro = (t) => { $('snErro').textContent = t; };
    if (r.modo !== 'pct' && !(r.max > 0)) return erro('Defina o valor máximo.');
    if (r.modo !== 'fixo' && !(r.pct > 0)) return erro('Defina a porcentagem abaixo do mercado.');
    if (r.tipo === 'pokemon') {
      r.especieId = null;
      if (r.alvo) {
        const e = await window.api.avaliadorEspecie(r.alvo).catch(() => null);
        if (!e) return erro(`Não achei a espécie "${r.alvo}". Escolha um nome da lista.`);
        r.especieId = e.id; r.alvo = e.n;
      }
    } else {
      const i = snipeAcharItem(r.alvo);
      if (!i) return erro(r.alvo ? `Não achei o item "${r.alvo}". Escolha um nome da lista.` : 'Escolha o item.');
      r.itemId = i.id; r.alvo = i.n;
    }
    const s = snipeCfg();
    if (regra) Object.assign(regra, r);
    else {
      s.regras.push({ ...r, id: 'r' + Date.now().toString(36), conta: id, ativa: true });
      if (s.contas[id].modo === 'off') { s.contas[id].modo = 'ensaio'; snipeHist(id, 'INFO', 'Snipe em modo ensaio', 'a primeira regra liga a conta em Ensaio: nada é gasto'); }
    }
    save();
    ed.hidden = true; snipe.editando = null;
    snipeRender(); snipeAgendar();
  };
  desenhar();
  // listas (uma vez): espécies do catálogo do app e itens do jogo
  if (!snipe.especies) snipe.especies = await window.api.snipeEspecies().catch(() => []);
  if (!snipe.catalogo?.itens?.length) {
    const itens = await window.api.snipeItens().catch(() => []);
    if (itens.length) snipe.catalogo = { itens };
    else if (snipeLogada(id)) snipe.catalogo = await runIn(pokeViews[id], pageSnipeCatalogo, null, 20e3).catch(() => null);
  }
  // só itens do Mercado da Comunidade: os que já apareceram à venda lá (a lista cresce com o tempo)
  const leitor = [id, ...cfg.settings.pokeAccounts.map(a => a.id)].find(snipeLogada);
  if (leitor && !snipe.itensLidos) {
    const ids = await runIn(pokeViews[leitor], pageSnipeItensMercado, null, 15e3).catch(() => null);
    if (ids && ids.length) { snipe.itensLidos = true; cfg.snipeItensVistos = [...new Set([...(cfg.snipeItensVistos || []), ...ids])]; save(); }
  }
  if (snipe.editando === r && !ed.hidden) { ler(); desenhar(); }
}
// itens que já apareceram à venda no Mercado da Comunidade (sem a lista ainda, o catálogo inteiro)
function snipeItensRmt() {
  const todos = snipe.catalogo?.itens || [], vistos = new Set(cfg.snipeItensVistos || []);
  return vistos.size ? todos.filter(i => vistos.has(i.id)) : todos;
}
function snipeAcharItem(nome) {
  const n = String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  if (!n || !snipe.catalogo) return null;
  return snipeItensRmt().find(i => i.n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '') === n) || null;
}

// ---------- início ----------
(function iniciarSnipe() {
  if (typeof cfg === 'undefined' || !cfg || !cfg.settings || !cfg.settings.pokeAccounts || !$('snipeBtn')) return setTimeout(iniciarSnipe, 500);
  snipeCfg();
  LOG_TYPES.snipe ||= { label: 'Snipe', icon: 'target' };
  if (typeof setupLogFilter === 'function') setupLogFilter();
  $('snipeBtn').onclick = (e) => { e.stopPropagation(); snipeAbrir(); };
  setInterval(() => { if (snipeAberto()) snipeRenderContas(); }, 15e3);
  snipeAgendar();
})();
