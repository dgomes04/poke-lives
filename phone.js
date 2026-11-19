// Acompanhar pelo celular: o main serve uma página na rede de casa e pede este resumo a cada atualização.
// Só leitura: daqui não sai nenhum comando para o jogo nem para as lives.

// preço de referência em gemas (menor anúncio no Mercado em 12/11/2026) e nome de cada item
const ITEM_INFO = {
  70000: { nome: 'Boss Token', gemas: 3 },
  70011: { nome: 'Frag. de Chave', gemas: 240 },
  70013: { nome: 'Frag. de Bicicleta', gemas: 153 },
  70012: { nome: 'Frag. de Shiny Stone', gemas: 99 },
  70014: { nome: 'Frag. de Mega', gemas: 119 },
  70015: { nome: 'Frag. de Mega Shiny', gemas: 650 },
  70017: { nome: 'Frag. de Ovo Shiny', gemas: 1749 },
  70095: { nome: 'Safari Ticket', gemas: 300 },
  70090: { nome: 'Mystic Ticket', gemas: null },
  40530: { nome: 'Peça de TM AoE', gemas: 315 },
  59194: { nome: 'Frag. de Z-Move', gemas: 163 },
};
const GEMA_USD = 0.01;
const TAXA_ITEM = 0.15;

function valorGemas(itens) {
  let v = 0;
  for (const [k, n] of Object.entries(itens || {})) v += (ITEM_INFO[k]?.gemas || 0) * n;
  return Math.round(v * (1 - TAXA_ITEM)); // o que sobra vendendo, já sem a comissão
}
const listaItens = (itens) => Object.entries(itens || {})
  .filter(([k, n]) => n > 0 && ITEM_INFO[k])
  .map(([k, n]) => ({ nome: ITEM_INFO[k].nome, n, gemas: ITEM_INFO[k].gemas }));

// pedras de evolução: nome e menor anúncio em ouro (12/11/2026)
const PEDRAS = {
  2: ['Ancient Stone', 135000], 23: ['Cocoon Stone', 4998], 28: ['Crystal Stone', null], 31: ['Darkness Stone', 5000],
  40: ['Earth Stone', 20000], 45: ['Enigma Stone', 92069], 49: ['Feather Stone', 99998], 53: ['Fire Stone', 84998],
  66: ['Heart Stone', 108000], 71: ['Ice Stone', 79999], 76: ['Leaf Stone', 14500], 87: ['Metal Stone', 9700],
  106: ['Punch Stone', 100065], 109: ['Rock Stone', 69000], 133: ['Thunder Stone', 125000], 139: ['Venom Stone', 83928],
  142: ['Water Stone', 114999], 209: ['Sun Stone', 92898],
};
const RAR = { comum: 'Comum', incomum: 'Incomum', rara: 'Rara', mitica: 'Mítica', lendaria: 'Lendária' };
const PRECO_CASA = { comum: 1450, incomum: 3499, rara: 18500 };
const PRECO_BIKE = { comum: 1059, incomum: 2300, rara: 8000 };

window.phoneStatus = function () {
  const s = stats();
  const accs = cfg.settings.pokeAccounts;
  const info = (a) => tileInfo[a.id] || {};
  const contas = accs.map(a => {
    const i = info(a);
    const st = s.acc[a.id] || {};
    const fora = i.outra || pokeHealthState[a.id]?.emOutroLugar;
    const estado = !pokeViews[a.id] ? 'fechada' : i.login ? 'deslogada' : fora ? 'aberta em outro lugar'
      : i.parada ? 'farm parada' : i.reconn ? 'reconectando' : i.hunt ? 'caçando' : 'carregando';
    const kpi = (re) => { const k = (i.kpis || []).find(x => re.test(x[0])); return k ? k.slice(1) : null; };
    return {
      id: a.id, nome: a.name, principal: cfg.settings.pokeMain === a.id, estado,
      parada: i.parada ? { motivo: i.parada.motivo, min: Math.round((Date.now() - i.parada.desde) / 60e3) } : null,
      hunt: i.hunt || st.hunt || null, outland: !!i.outland,
      tlvl: i.tlvl ?? st.tlvl ?? null, tlvl0: st.tlvl0 ?? null,
      pk: i.pk || st.pk || null, plvl: i.plvl ?? st.plvl ?? null, hp: i.hp ?? null, hpMax: i.hpMax ?? null,
      revives: i.revives ?? null, pocoes: i.pocoes ?? null,
      bolas: (i.bolas || []).filter(b => b.usa || b.qtd > 0), autoBola: i.autoBola ?? null,
      bolasTotal: i.bolas ? bolasTotalUsadas(i) : null,
      bolasH: window.bolasPorHora ? bolasPorHora(a.id) : null,
      itens: itensDaConta(a.id),
      xpH: window.xpPerHour ? xpPerHour(a.id, 'tx') : null, abates: kpi(/abates/i),
      gemas: i.orbs ?? st.orbs ?? null, diamantes: i.diamonds ?? st.diamonds ?? null,
      ouro: i.gold ?? st.gold ?? null, ouroHoje: st.gold != null && st.gold0 != null ? st.gold - st.gold0 : null,
      hoje: listaItens(st.got), valorHoje: valorGemas(st.got),
      shinyVistos: i.shinySeen ?? null, shinyPegos: i.shinyCaught ?? null, shinyTotal: i.shinyTotal ?? null,
    };
  });

  // itens vendíveis somando as contas, com quanto cada uma tem
  const itens = Object.entries(ITEM_INFO).map(([k, inf]) => {
    const por = accs.map(a => ({ conta: a.name, n: Number((info(a).items || s.acc[a.id]?.itemsLast || {})[k] || 0) })).filter(x => x.n > 0);
    const n = por.reduce((t, x) => t + x.n, 0);
    const hoje = accs.reduce((t, a) => t + (s.acc[a.id]?.got?.[k] || 0), 0);
    return { nome: inf.nome, n, hoje, por, gemas: inf.gemas ? Math.round(inf.gemas * n * (1 - TAXA_ITEM)) : null };
  }).filter(x => x.n > 0 || x.hoje > 0).sort((a, b) => (b.gemas || 0) - (a.gemas || 0));
  const pedras = Object.entries(PEDRAS).map(([k, [nome, ouro]]) => {
    const por = accs.map(a => ({ conta: a.name, n: Number(info(a).pedras?.[k] || 0) })).filter(x => x.n > 0);
    const n = por.reduce((t, x) => t + x.n, 0);
    return { nome, n, por, ouro: ouro ? Math.round(ouro * n * (1 - TAXA_ITEM)) : null };
  }).filter(x => x.n > 0).sort((a, b) => (b.ouro || 0) - (a.ouro || 0));
  const numerados = [];
  for (const a of accs) {
    for (const c of info(a).casas || []) numerados.push({ tipo: 'Casa', conta: a.name, id: c.id, rar: RAR[c.rar] || c.rar, gemas: PRECO_CASA[c.rar] ? Math.round(PRECO_CASA[c.rar] * (1 - TAXA_ITEM)) : null, anunciada: c.anunciada });
    for (const c of info(a).bikes || []) numerados.push({ tipo: 'Bicicleta', conta: a.name, id: c.id, rar: RAR[c.rar] || c.rar, gemas: PRECO_BIKE[c.rar] ? Math.round(PRECO_BIKE[c.rar] * (1 - TAXA_ITEM)) : null, anunciada: c.anunciada });
  }
  const valorItens = itens.reduce((t, x) => t + (x.gemas || 0), 0) + numerados.reduce((t, x) => t + (x.gemas || 0), 0);

  // shiny
  const lure = {};
  for (const p of ['twitch', 'kick']) {
    const l = boostState[p];
    const x = Array.isArray(l) ? l.find(b => /lure/i.test(b.name || '')) : null;
    lure[p] = Array.isArray(l) ? (x?.time || null) : undefined;
  }
  const shinyHoje = (s.shinyNovos || []).slice().reverse();

  const lives = [];
  for (const p of PLATFORMS) for (const sl of slots[p]) if (sl.channel) {
    lives.push({ plat: p, canal: sl.channel.name, pontos: cfg.points?.[key(sl.channel)]?.balance ?? null });
  }
  const valorHoje = contas.reduce((t, c) => t + c.valorHoje, 0);
  const hist = (cfg.hist || []).slice(-7);
  const media7 = hist.length ? Math.round(hist.reduce((t, h) => t + h.gemas, 0) / hist.length) : null;
  const alertas = [];
  for (const c of contas) {
    if (c.parada) alertas.push({ tipo: 'erro', txt: `${c.nome}: farm parada (${c.parada.motivo}) há ${c.parada.min} min` });
    else if (c.estado === 'deslogada' || c.estado === 'aberta em outro lugar') alertas.push({ tipo: 'erro', txt: `${c.nome}: ${c.estado}` });
    else if (c.autoBola && c.bolasTotal === 0) alertas.push({ tipo: 'erro', txt: `${c.nome}: acabaram as pokebolas, a captura parou` });
    else if (c.autoBola && c.bolasH > 0 && c.bolasTotal / c.bolasH < 3) alertas.push({ tipo: 'aviso', txt: `${c.nome}: pokebolas acabam em ~${Math.max(1, Math.round(c.bolasTotal / c.bolasH * 60))} min` });
    else if (c.revives === 0 || c.pocoes === 0) alertas.push({ tipo: 'aviso', txt: `${c.nome}: acabou ${[c.revives === 0 ? 'revive' : null, c.pocoes === 0 ? 'poção' : null].filter(Boolean).join(' e ')}` });
  }
  const votos = window.votoResumo ? votoResumo().filter(v => v.liberado).map(v => v.nome) : [];
  if (votos.length) alertas.push({ tipo: 'aviso', txt: `Voto do IdleHub liberado: ${votos.join(', ')} (abra pelo PC)` });
  for (const x of shinyHoje.slice(0, 3)) alertas.push({ tipo: 'shiny', txt: `Shiny ${x.nome} em ${x.conta}`, t: x.t });

  return {
    agora: Date.now(), gemaUsd: GEMA_USD,
    total: {
      valorHojeGemas: valorHoje, media7, valorItens,
      gemas: contas.reduce((t, c) => t + (c.gemas || 0), 0),
      tokensHoje: contas.reduce((t, c) => t + (s.acc[c.id]?.got?.[70000] || 0), 0),
      shinyHoje: shinyHoje.length,
      pontosHoje: Object.values(s.points || {}).reduce((t, x) => t + (x.gained || 0), 0),
    },
    alertas, contas, itens, pedras, numerados,
    shiny: { hoje: shinyHoje, lure, colecao: contas.reduce((t, c) => t + (c.shinyTotal || 0), 0), hist },
    lives,
  };
};

// ---------- interruptor nas configurações ----------
function novoCodigo() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function aplicarCelular() {
  const ph = cfg.settings.phone ||= { on: false };
  if (ph.on && !ph.token) { ph.token = novoCodigo(); save(); }
  const r = await window.api.phoneSet(ph);
  $('phoneOn').checked = !!r.on;
  $('phoneBox').hidden = !r.on;
  if (r.error) { ph.on = false; save(); blog(`Celular: ${r.error}.`, 'err', 'sistema'); alert('Não deu pra ligar: ' + r.error); return; }
  if (!r.on) return;
  const urls = r.urls || [];
  // um QR por rede: Wi-Fi de casa e, com o Tailscale, o de fora de casa
  $('phoneQr').hidden = true;
  $('phoneQrs').innerHTML = urls.filter(u => u.qr).map(u =>
    `<figure class="phone-qr"><img src="${u.qr}" alt="QR code (${u.ts ? 'Tailscale' : 'Wi-Fi'})"><figcaption>${u.ts ? 'Fora de casa (Tailscale)' : 'Wi-Fi de casa'}</figcaption></figure>`).join('');
  $('phoneUrls').innerHTML = urls.length
    ? urls.map(u => `${u.ts ? 'Tailscale (fora de casa)' : 'Wi-Fi'}: <code>${u.ip}</code>`).join('<br>') +
      '<br>Se o Windows perguntar sobre o firewall, permita em <b>redes privadas</b>.' +
      (urls.some(u => u.ts) ? '' : '<br>Pra acessar <b>fora de casa</b>, instale o Tailscale no PC e no celular (mesma conta) e reabra esta tela: aparece um segundo QR.')
    : 'Nenhuma rede encontrada. O PC está conectado no Wi-Fi ou no cabo?';
  $('phoneCopy').onclick = () => { if (urls[0]) { navigator.clipboard.writeText(urls[0].url); blog('Link do celular copiado.', 'ok', 'sistema'); } };
}
document.addEventListener('DOMContentLoaded', () => {
  const tryInit = () => {
    if (typeof cfg === 'undefined' || !cfg || !cfg.settings) return setTimeout(tryInit, 500);
    $('phoneOn').checked = !!cfg.settings.phone?.on;
    if (cfg.settings.phone?.on) aplicarCelular();
    $('phoneOn').onchange = () => { (cfg.settings.phone ||= {}).on = $('phoneOn').checked; save(); aplicarCelular(); };
    $('phoneNew').onclick = () => {
      if (!confirm('Gerar um link novo? O link antigo para de funcionar no celular.')) return;
      cfg.settings.phone.token = novoCodigo(); save(); aplicarCelular();
    };
  };
  tryInit();
});

// print da tela com o painel do PokeIdle fechado: põe o painel atrás das lives por um instante
let espiando = 0;
window.phoneEspiar = (on) => {
  espiando = Math.max(0, espiando + (on ? 1 : -1));
  $('poke').classList.toggle('espiar', espiando > 0);
};

// ---------- itens de cada conta (card do PC e card do celular) ----------
// farm: bolas, revives e poções (estado: 'zero' acabou · 'low' acabando · 'usa' a automação usa)
// vend: o que vende no Mercado, do mais valioso pro menos
function itensDaConta(id) {
  const i = tileInfo[id] || {};
  const farm = [];
  const horas = window.bolasPorHora && bolasPorHora(id) > 0 ? bolasTotalUsadas(i) / bolasPorHora(id) : null;
  for (const b of i.bolas || []) {
    if (!(b.qtd > 0 || (b.usa && i.autoBola))) continue;
    const est = b.usa && b.qtd === 0 ? 'zero' : b.usa && horas != null && horas < 3 ? 'low' : b.usa ? 'usa' : '';
    farm.push({ nome: b.nome.replace(/ Ball$/, ''), nomeLongo: b.nome, qtd: b.qtd, est, tipo: 'bola' });
  }
  for (const tipo of ['revive', 'pocao']) {
    const lista = (i.suprimentos || []).filter(x => x.tipo === tipo);
    const comEstoque = lista.filter(x => x.qtd > 0);
    if (!comEstoque.length && lista.some(x => x.usa)) {
      farm.push({ nome: tipo === 'revive' ? 'Revives' : 'Poções', nomeLongo: tipo === 'revive' ? 'Revives' : 'Poções', qtd: 0, est: 'zero', tipo });
      continue;
    }
    for (const x of comEstoque) {
      farm.push({ nome: x.nome.replace(/ Potion$/, ' Pot'), nomeLongo: x.nome, qtd: x.qtd, est: x.usa && x.qtd < 20 ? 'low' : x.usa ? 'usa' : '', tipo });
    }
  }
  const vend = [];
  for (const [k, inf] of Object.entries(ITEM_INFO)) {
    const n = Number((i.items || {})[k] || 0);
    if (n > 0) vend.push({ nome: inf.nome, n, gemas: inf.gemas ? Math.round(inf.gemas * n * (1 - TAXA_ITEM)) : 0 });
  }
  for (const [k, [nome, ouro]] of Object.entries(PEDRAS)) {
    const n = Number((i.pedras || {})[k] || 0);
    if (n > 0) vend.push({ nome, n, gemas: 0, ouro: ouro ? Math.round(ouro * n * (1 - TAXA_ITEM)) : 0 });
  }
  vend.sort((a, b) => (b.gemas - a.gemas) || ((b.ouro || 0) - (a.ouro || 0)));
  return {
    farm, vend, vendGemas: vend.reduce((t, x) => t + x.gemas, 0),
    ultraDura: horas, autoUltra: cfg.settings.autoUltra !== false,
    usaUltra: (i.bolas || []).some(b => b.usa && /^ultra/i.test(b.nome)),
  };
}
window.itensDaConta = itensDaConta;
