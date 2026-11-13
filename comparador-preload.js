// Ponte do comparador: põe um seletor "Escolher um Pokémon meu" em cima de cada ficha (A e B).
// Os dados vêm das contas abertas no app; a página do comparador não é alterada, só recebe o texto da ficha.
const { ipcRenderer } = require('electron');

const fichaJson = (p) => JSON.stringify({
  displayName: p.nome, speciesId: p.speciesId, level: p.level, potencia: p.potencia, quality: p.quality,
  shiny: !!p.shiny, ivs: p.ivs, refino: p.refino || {}, tmElemental: p.tmElemental || null,
}, null, 2);

function rotulo(p) {
  const iv = p.ivs ? Object.values(p.ivs).reduce((t, v) => t + (Number(v) || 0), 0) : null;
  return `${p.shiny ? '✦ ' : ''}${p.nome} · Nv ${p.level} · P${p.potencia ?? '?'} · Q ${Number(p.quality || 0).toFixed(3)}${iv != null ? ` · IV ${iv}` : ''}${p.ativo ? ' (em campo)' : ''}`;
}

window.addEventListener('DOMContentLoaded', async () => {
  const css = document.createElement('style');
  css.textContent = `html{background:#1c1923;min-height:100%}body{min-height:100vh}.pl-pick{display:flex;gap:6px;margin:0 0 8px}.pl-pick select{flex:1;min-width:0;background:#2b202d;color:#fff4ec;border:1px solid #7d5056;border-radius:7px;padding:7px 8px;font:inherit}
    .pl-pick button{white-space:nowrap}.pl-nota{font-size:12px;color:#f0d0c2;margin:0 0 8px}`;
  document.head.appendChild(css);

  let contas = [];
  try { contas = await ipcRenderer.invoke('comparador:pokemons'); } catch { contas = []; }
  const { conta: contaInicial } = await ipcRenderer.invoke('comparador:inicio').catch(() => ({}));
  const porId = new Map();
  contas.forEach((c) => (c.pokemons || []).forEach((p) => porId.set(`${c.id}:${p.id}`, p)));

  const opcoes = () => '<option value="">Escolher um Pokémon meu…</option>' + contas.map((c) =>
    `<optgroup label="${c.nome.replace(/"/g, '&quot;')}">${(c.pokemons || []).map((p) =>
      `<option value="${c.id}:${p.id}">${rotulo(p).replace(/</g, '&lt;')}</option>`).join('')}</optgroup>`).join('');

  const compara = () => {
    if (document.getElementById('a').value.trim() && document.getElementById('b').value.trim()) document.getElementById('compare').click();
  };

  for (const lado of ['a', 'b']) {
    const ta = document.getElementById(lado);
    if (!ta) continue;
    const box = document.createElement('div');
    box.className = 'pl-pick';
    box.innerHTML = `<select aria-label="Escolher um Pokémon meu para o lado ${lado.toUpperCase()}">${opcoes()}</select>
      <button type="button" class="secondary">Colar ficha</button>`;
    ta.parentElement.insertBefore(box, ta);
    if (lado === 'b') {
      const nota = document.createElement('p');
      nota.className = 'pl-nota';
      nota.textContent = 'Pra comparar com um Pokémon do Mercado: abra a ficha dele no jogo, copie e use "Colar ficha".';
      ta.parentElement.insertBefore(nota, ta);
    }
    const sel = box.querySelector('select');
    sel.onchange = () => { const p = porId.get(sel.value); if (p) { ta.value = fichaJson(p); compara(); } };
    box.querySelector('button').onclick = async () => {
      const txt = await navigator.clipboard.readText().catch(() => '');
      if (txt.trim()) { ta.value = txt; sel.value = ''; compara(); }
    };
    // abre já com o Pokémon em campo da conta escolhida no lado A
    if (lado === 'a' && contaInicial) {
      const c = contas.find((x) => x.id === contaInicial);
      const p = c?.pokemons?.find((x) => x.ativo) || c?.pokemons?.[0];
      if (p) { sel.value = `${c.id}:${p.id}`; ta.value = fichaJson(p); }
    }
  }
  if (!contas.some((c) => c.pokemons?.length)) {
    const aviso = document.createElement('p');
    aviso.className = 'pl-nota';
    aviso.textContent = 'Nenhum Pokémon carregado ainda: abra o PokeIdle no app e espere o jogo carregar. Dá pra colar fichas mesmo assim.';
    document.getElementById('inputs')?.before(aviso);
  }
});
