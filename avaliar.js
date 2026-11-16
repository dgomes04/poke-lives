// Avaliador de Pokémon: o cálculo roda DENTRO do jogo da conta principal, com os módulos públicos
// do próprio PokeIdle (/shared/nota-pokemon.mjs e /shared/ginasios.mjs) — os números saem iguais aos do jogo.
// Também lê a Tabela de preços (vendas dos últimos 30 dias da espécie). Só leitura: nada é comprado.

// ---------- dentro do jogo ----------
async function pageAvaliar({ alvo, esp: e, paginas = 4 }) { // 4 páginas, igual ao selo do Mercado
  const ver = (document.querySelector('script[src*="app.js"]')?.src.match(/v=([\w.]+)/) || [])[1] || '';
  const N = await import(`/shared/nota-pokemon.mjs${ver ? '?v=' + ver : ''}`);
  const G = await import(`/shared/ginasios.mjs${ver ? '?v=' + ver : ''}`);
  // espécie no formato que as funções do jogo esperam
  const esp = {
    pokeId: e.id, name: e.n, type1: e.t?.[0] || null, type2: e.t?.[1] || null,
    baseHp: e.b[0], baseAtk: e.b[1], baseDef: e.b[2], baseSpAtk: e.b[3], baseSpDef: e.b[4], baseSpeed: e.b[5],
    attacks: (e.m || []).map(m => ({ name: m[0], type: m[1], category: m[2] === 1 ? 'SPECIAL' : 'PHYSICAL', power: m[3], cooldownMs: m[4], learnLevel: m[5] ?? 1 })),
  };
  const medir = (pk) => {
    const nivel = Math.max(1, Number(pk.level) || 1);
    const r = {
      nota: N.notaDePokemon(pk, esp),
      poderRank: N.poderDePokemon ? N.poderDePokemon(pk, esp) : null,
      pve100: G.poderNoNivel(pk, esp, 100),
      pveAgora: G.poderNoNivel(pk, esp, nivel),
      pvp: G.poderNoNivel(pk, esp, G.nivelNoGinasio(nivel), { pvp: true }),
      pvpNivel: G.nivelNoGinasio(nivel),
      showdown: G.poderNoNivel(pk, esp, Math.min(nivel, 150), { pvp: true }),
      golpe: null,
    };
    try {
      const st = G.statsNoNivel(pk, esp, nivel);
      r.golpe = G.melhorGolpeDoGinasio(esp, nivel, st, pk.tmElemental, pk.tmFisico)?.name || null;
    } catch { /* sem golpe */ }
    return r;
  };
  // o melhor nascimento possível da espécie (P5, qualidade 1,8, IV 32), no mesmo nível, pra dar a régua
  const ideal = { ...alvo, potencia: 5, quality: 1.8, ivs: { hp: 32, atk: 32, def: 32, spAtk: 32, spDef: 32, speed: 32 }, refino: {}, tmElemental: alvo.tmElemental };
  const resultado = { alvo: medir(alvo), ideal: medir(ideal), idealComum: medir({ ...ideal, shiny: false }), vendas: [], erroVendas: null };

  // Tabela de preços: vendas dos últimos 30 dias, pela busca do nome da espécie
  const ws = window.__plWs;
  if (!ws || ws.readyState !== 1) { resultado.erroVendas = 'o jogo não está conectado'; return resultado; }
  const pedirPagina = (pagina) => new Promise((resolve) => {
    const seq = 900000 + Math.floor(Math.random() * 90000);
    const fim = setTimeout(() => { ws.removeEventListener('message', ouvir); resolve(null); }, 8000);
    function ouvir(ev) {
      if (typeof ev.data !== 'string' || !ev.data.includes('historicoGlobal')) return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t !== 'market' || m.aba !== 'historicoGlobal' || (m.seq != null && m.seq !== seq)) return;
      clearTimeout(fim); ws.removeEventListener('message', ouvir); resolve(m);
    }
    ws.addEventListener('message', ouvir);
    ws.send(JSON.stringify({ t: 'market.historicoGlobal', pagina, seq, tipo: 'pokemon', busca: e.n }));
  });
  for (let p = 0; p < paginas; p++) {
    const m = await pedirPagina(p);
    if (!m) { if (!resultado.vendas.length) resultado.erroVendas = 'a Tabela de preços não respondeu'; break; }
    for (const l of m.linhas || []) {
      const f = l.ficha;
      if (l.tipo !== 'pokemon' || !f || Number(f.speciesId) !== Number(alvo.speciesId)) continue; // só a mesma espécie
      const med = medir(f);
      resultado.vendas.push({
        em: l.em, preco: Number(l.bruto), moeda: l.moeda, level: f.level, potencia: f.potencia, quality: f.quality,
        shiny: !!f.shiny, iv: f.ivs ? Object.values(f.ivs).reduce((t, v) => t + (Number(v) || 0), 0) : null,
        tm: f.tmElemental || null, nota: med.nota, pve100: med.pve100, pveAgora: med.pveAgora, pvp: med.pvp,
      });
    }
    if (!m.temMais) break;
  }
  return resultado;
}

// ---------- no app ----------
window.avaliarNoJogo = async function ({ alvo, esp }) {
  // a principal, se estiver logada; senão, qualquer conta logada (o cálculo e a Tabela de preços são iguais pra todas)
  const ids = [cfg.settings.pokeMain, ...cfg.settings.pokeAccounts.map(a => a.id)];
  const id = ids.find(x => pokeViews[x] && tileInfo[x] && !tileInfo[x].login && !tileInfo[x].outra);
  const wv = id && pokeViews[id];
  if (!wv) return { erro: 'nenhuma conta do PokeIdle logada no app' };
  try { return await withLock(wv, () => runIn(wv, pageAvaliar, { alvo, esp }, 90e3)); }
  catch (e) { return { erro: 'o jogo não respondeu (' + e.message + ')' }; }
};

// botão Avaliar na barra do PokeIdle: abre a janela vazia (para colar uma ficha)
document.addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('avaliarBtn');
  if (b) b.onclick = () => window.api.avaliar(null);
});
