// Resumo do dia: níveis/XP de cada conta do PokeIdle, pontos ganhos por canal, boosts e trocas de hunt.
// Fica salvo no config e zera quando muda o dia.

const XP_WINDOW = 60 * 60e3; // XP/h calculado na última hora
const xpSamples = {};        // id -> [{ t, tx, px }] (só em memória)

function today() { return new Date().toLocaleDateString('sv-SE'); } // AAAA-MM-DD
function stats() {
  if (!cfg.stats || cfg.stats.day !== today()) {
    if (cfg.stats?.day) guardarDia(cfg.stats); // fecha o dia anterior no histórico
    cfg.stats = { day: today(), acc: {}, points: {}, boosts: [], hunts: [] };
  }
  for (const p of Object.values(cfg.stats.points || {})) if (!(p.gained >= 0 && p.gained <= 50_000_000)) p.gained = 0;
  return cfg.stats;
}
let statsDirty = false;
setInterval(() => { if (statsDirty) { statsDirty = false; save(); } }, 60e3);

function statsAccount(id, i) {
  const s = stats();
  const a = (s.acc[id] ||= { tlvl0: i.tlvl, plvl0: i.plvl, pk0: i.pk });
  if (a.tlvl0 == null && i.tlvl != null) a.tlvl0 = i.tlvl;
  if (a.pk0 !== i.pk) { a.pk0 = i.pk; a.plvl0 = i.plvl; } // trocou de pokémon em campo: recomeça a conta do nível
  if (a.plvl0 == null && i.plvl != null) a.plvl0 = i.plvl;
  Object.assign(a, { name: accName(id), tlvl: i.tlvl, plvl: i.plvl, pk: i.pk, hunt: i.hunt, outland: !!i.outland });
  // drops do dia: soma só o que entrou na mochila (vender ou usar não desconta)
  if (i.items) {
    a.got ||= {};
    if (a.itemsLast) for (const [k, n] of Object.entries(i.items)) {
      const d = n - (a.itemsLast[k] ?? n);
      if (d > 0 && d < 500) a.got[k] = (a.got[k] || 0) + d;
    }
    a.itemsLast = i.items;
  }
  if (i.gold != null) { if (a.gold0 == null) a.gold0 = i.gold; a.gold = i.gold; }
  if (i.orbs != null) { if (a.orbs0 == null) a.orbs0 = i.orbs; a.orbs = i.orbs; }
  if (i.diamonds != null) a.diamonds = i.diamonds;
  statsBolas(id, i);
  if (i.tx != null || i.px != null) {
    const arr = (xpSamples[id] ||= []);
    arr.push({ t: Date.now(), tx: i.tx, px: i.px });
    while (arr.length && Date.now() - arr[0].t > XP_WINDOW) arr.shift();
  }
  statsDirty = true;
}

// gasto de pokebolas (as que a automação usa), pra estimar quanto tempo o estoque dura
const bolaSamples = {}; // id -> [{ t, n }]
function bolasTotalUsadas(i) {
  const usadas = (i.bolas || []).filter(b => b.usa);
  return (usadas.length ? usadas : (i.bolas || [])).reduce((t, b) => t + b.qtd, 0);
}
function statsBolas(id, i) {
  if (!i.bolas) return;
  const arr = (bolaSamples[id] ||= []);
  arr.push({ t: Date.now(), n: bolasTotalUsadas(i) });
  while (arr.length && Date.now() - arr[0].t > 60 * 60e3) arr.shift();
}
function bolasPorHora(id) {
  const arr = bolaSamples[id] || [];
  if (arr.length < 2) return null;
  let gasto = 0; // soma só as quedas (comprar bola no meio não atrapalha a conta)
  for (let k = 1; k < arr.length; k++) if (arr[k].n < arr[k - 1].n) gasto += arr[k - 1].n - arr[k].n;
  const h = (arr[arr.length - 1].t - arr[0].t) / 3600e3;
  return h >= 10 / 60 ? gasto / h : null;
}

function xpPerHour(id, k) {
  const arr = (xpSamples[id] || []).filter(x => x[k] != null);
  if (arr.length < 2) return null;
  const a = arr[0], b = arr[arr.length - 1];
  const h = (b.t - a.t) / 3600e3;
  if (h < 10 / 60 || b[k] < a[k]) return null; // precisa de pelo menos 10 min (e o XP não pode ter zerado)
  return (b[k] - a[k]) / h;
}

const POINTS_MAX = 50_000_000;   // saldo acima disso é leitura errada (outro número da página)
const POINTS_STEP_MAX = 100_000; // ninguém ganha isso entre duas leituras
// resumo de cada dia fechado (até 30 dias), pro "últimos dias" e a média do celular
function guardarDia(st) {
  const accs = Object.values(st.acc || {});
  const gemas = accs.reduce((t, a) => t + (window.valorGemas ? valorGemas(a.got) : 0), 0);
  const tokens = accs.reduce((t, a) => t + (a.got?.[70000] || 0), 0);
  const shinies = (st.shinyNovos || []).length;
  cfg.hist = [...(cfg.hist || []).filter(h => h.day !== st.day), { day: st.day, gemas, tokens, shinies }].slice(-30);
}
// shiny novo na conta (com espécie, nível e potência), pra lista do dia
const shinyVistos = {}; // id da conta -> Set de ids de pokémon shiny já conhecidos
function statsShinyNovos(id, i) {
  if (!Array.isArray(i.shinyRecentes)) return;
  const conhecidos = shinyVistos[id];
  shinyVistos[id] = new Set(i.shinyRecentes.map(p => p.id));
  if (!conhecidos) return; // primeira leitura: só guarda
  for (const p of i.shinyRecentes) if (!conhecidos.has(p.id)) {
    (stats().shinyNovos ||= []).push({ t: Date.now(), conta: accName(id), nome: p.nome, nivel: p.nivel, pot: p.pot });
    statsDirty = true;
  }
}

function statsPoints(c, balance) {
  if (!(balance >= 0 && balance <= POINTS_MAX)) return;
  const s = stats();
  const p = (s.points[key(c)] ||= { name: c.name, plat: c.platform, start: balance, gained: 0 });
  if (!(p.gained >= 0 && p.gained <= POINTS_MAX)) p.gained = 0; // conserta o que uma leitura errada já tinha somado
  // soma só o que subiu (gasto com boost não conta como perda de "ganho"); salto absurdo é ignorado
  if (p.last != null && balance > p.last && balance - p.last <= POINTS_STEP_MAX) p.gained += balance - p.last;
  p.last = balance;
  statsDirty = true;
}

function statsBoost(label, ch, plat, cost) {
  stats().boosts.push({ t: Date.now(), label, ch, plat, cost });
  statsDirty = true;
}

function statsShiny(acc, hunt, kind, n) {
  (stats().shinies ||= []).push({ t: Date.now(), acc, hunt, kind, n });
  statsDirty = true;
  save(); // shiny é raro: grava na hora
}

function statsHunt(acc, from, to, gain) {
  stats().hunts.push({ t: Date.now(), acc, from, to, gain });
  statsDirty = true;
}

function showStats() {
  const s = stats();
  const hora = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const n = (v) => v == null ? '—' : fmt(Math.round(v));
  const accRows = Object.entries(s.acc).map(([id, a]) => `<tr>
      <td><b>${a.name}</b></td>
      <td>${n(a.tlvl)} <span class="muted">(+${a.tlvl != null && a.tlvl0 != null ? a.tlvl - a.tlvl0 : 0})</span></td>
      <td>${a.pk || '—'} ${n(a.plvl)} <span class="muted">(+${a.plvl != null && a.plvl0 != null ? a.plvl - a.plvl0 : 0})</span></td>
      <td>${n(xpPerHour(id, 'tx'))}</td><td>${n(xpPerHour(id, 'px'))}</td>
      <td>${a.hunt || '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhuma conta lida ainda hoje.</td></tr>';
  const pts = Object.values(s.points).sort((a, b) => b.gained - a.gained);
  const ptsTotal = pts.reduce((x, p) => x + p.gained, 0);
  const ptsRows = pts.filter(p => p.gained > 0).map(p => `<tr><td>${p.plat === 'twitch' ? 'Twitch' : 'Kick'}</td><td>${p.name}</td><td>+${fmt(p.gained)}</td><td>${fmt(p.last)}</td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">Nenhum ponto ganho registrado ainda hoje.</td></tr>';
  const boostRows = s.boosts.map(b => `<li>${hora(b.t)} · ${b.label} 1h em ${b.ch} (${b.plat === 'twitch' ? 'Twitch' : 'Kick'}) · −${b.cost}</li>`).join('') || '<li class="muted">Nenhum hoje.</li>';
  const shinyRows = (s.shinies || []).map(x => `<li>${hora(x.t)} · ✨ ${x.acc}: ${x.n > 1 ? x.n + ' ' : ''}${x.kind === 'capturado' ? 'capturado' : 'visto'}${x.hunt ? ' em ' + x.hunt : ''}</li>`).join('') || '<li class="muted">Nenhum hoje.</li>';
  const huntRows = s.hunts.map(h => `<li>${hora(h.t)} · ${h.acc}: ${h.from || '?'} → ${h.to}${h.gain || ''}</li>`).join('') || '<li class="muted">Nenhuma hoje.</li>';
  $('statsBody').innerHTML = `
    <h3>Contas do PokeIdle</h3>
    <table><tr><th>Conta</th><th>Treinador (hoje)</th><th>Pokémon em campo (hoje)</th><th>XP/h treinador</th><th>XP/h pokémon</th><th>Hunt</th></tr>${accRows}</table>
    <p class="muted">XP/h é da última hora (precisa de uns 10 min de dados). "—" = o jogo não informou.</p>
    <h3>Pontos ganhos hoje: +${fmt(ptsTotal)}</h3>
    <table><tr><th></th><th>Canal</th><th>Ganhou</th><th>Saldo</th></tr>${ptsRows}</table>
    <h3>Shinies (${(s.shinies || []).length})</h3><ul>${shinyRows}</ul>
    <h3>Boosts resgatados (${s.boosts.length})</h3><ul>${boostRows}</ul>
    <h3>Trocas de hunt (${s.hunts.length})</h3><ul>${huntRows}</ul>`;
  $('statsBox').hidden = false;
}

(async function statsInit() {
  while (!cfg) await sleep(200);
  $('showStats').onclick = showStats;
  $('statsClose').onclick = () => { $('statsBox').hidden = true; };
})();
