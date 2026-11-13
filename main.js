const { app, BrowserWindow, ipcMain, net, session, webContents, shell, Tray, Menu, nativeImage, Notification, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');

// mantém a mesma pasta de dados (logins, config) tanto rodando pelo atalho quanto instalado
app.setPath('userData', process.env.PL_USERDATA || path.join(app.getPath('appData'), 'poke-lives')); // PL_USERDATA: pasta separada pros testes
const TESTING = !!(process.env.PL_DEBUG_PORT || process.env.PL_SHOT || process.env.PL_SELFTEST);
// uma janela só: abrir de novo traz a que já está aberta (fora dos testes)
if (!TESTING && !app.requestSingleInstanceLock()) app.quit();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const CONFIG = () => path.join(app.getPath('userData'), 'config.json');

const TWITCH = ['yeTz', 'Rodil', 'Surskity11', 'FaturetoSL', 'DenisSniderTV', 'Daniels', 'PatoPapao', 'aXtLOL',
  'ClovaoBengala', 'Biscoitao', 'cogu', 'TFToddy', 'LuccaTV', 'Techzz', 'Guaxilol1', 'dersin2k', 'mecmeno',
  'revolta', 'Kennzy', 'ookina', 'Gragolandia1', 'matta', 'fnblol9'];
const KICK = ['yetz', 'DenisSnider', 'daniels', 'Guaxilol1', 'PatoPapao2', 'AxT', 'Rodil', 'clovaobengalalol',
  'Biscoitao', 'cogu', 'tftoddy', 'LuccaTV', 'techzz', 'dersin2k', 'FaturetoSL', 'mecmeno', 'surskity', 'Yulla',
  'Revolta', 'YoDa', 'fNblol', 'Kennzy', 'ookina8', 'Gragolandia', 'matta'];

function defaultConfig() {
  return {
    channels: [
      ...TWITCH.map(n => ({ platform: 'twitch', name: n, paused: false, pinned: false })),
      ...KICK.map(n => ({ platform: 'kick', name: n, paused: false, pinned: false })),
    ],
    settings: { secondary: false, mutePc: true, economy: true, interval: 30, perPlatform: 2, autoBonus: true },
  };
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); } catch { return defaultConfig(); }
}

async function getText(url) {
  const r = await net.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/html,*/*' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

async function checkTwitch(name) {
  const login = name.toLowerCase();
  try {
    const t = (await getText('https://decapi.me/twitch/viewercount/' + login)).trim();
    if (/offline/i.test(t)) return { live: false };
    const n = parseInt(t.replace(/\D/g, ''), 10);
    if (!isNaN(n) && /^\d[\d.,]*$/.test(t)) return { live: true, viewers: n };
  } catch { /* cai pro plano B */ }
  const h = await getText('https://www.twitch.tv/' + login);
  return { live: /"isLiveBroadcast":true/.test(h) };
}

async function checkKick(name) {
  const j = JSON.parse(await getText('https://kick.com/api/v2/channels/' + name.toLowerCase()));
  const ls = j.livestream;
  return ls && ls.is_live !== false ? { live: true, viewers: ls.viewer_count, title: ls.session_title } : { live: false };
}

ipcMain.handle('config:load', () => loadConfig());
ipcMain.handle('config:save', (_e, cfg) => { fs.writeFileSync(CONFIG(), JSON.stringify(cfg, null, 2)); return true; });

ipcMain.handle('check', async (_e, list) => {
  const out = {};
  const queue = [...list];
  async function worker() {
    while (queue.length) {
      const c = queue.shift();
      const key = c.platform + ':' + c.name.toLowerCase();
      try { out[key] = await (c.platform === 'twitch' ? checkTwitch(c.name) : checkKick(c.name)); }
      catch (err) { out[key] = { error: String(err.message || err) }; }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
});

ipcMain.handle('login', (_e, { platform, partition }) => {
  const w = new BrowserWindow({ width: 1000, height: 800, title: 'Login', webPreferences: { partition } });
  const urls = { twitch: 'https://www.twitch.tv/login', kick: 'https://kick.com/', pokeidle: 'https://pokeidle.io/app' };
  w.loadURL(urls[platform] || urls.kick);
  w.setMenuBarVisibility(false);
  return true;
});

// ---------- extensão /hunt (lida da pasta do Brave/Chrome/Edge, sem copiar) ----------
const HUNT_EXT_ID = 'mhnplloljgchpfpcpbhmcokmnefodjnh';
let huntExt; // cache: { version, dir, main, isolated, css } ou { error }

function findHuntExt(extId = HUNT_EXT_ID) {
  const local = process.env.LOCALAPPDATA || '';
  const browsers = ['BraveSoftware\\Brave-Browser\\User Data', 'Google\\Chrome\\User Data', 'Microsoft\\Edge\\User Data'];
  const found = [];
  for (const b of browsers) {
    const root = path.join(local, b);
    let profiles = [];
    try { profiles = fs.readdirSync(root); } catch { continue; }
    for (const prof of profiles) {
      const extDir = path.join(root, prof, 'Extensions', extId);
      let vers = [];
      try { vers = fs.readdirSync(extDir); } catch { continue; }
      for (const v of vers) if (fs.existsSync(path.join(extDir, v, 'manifest.json'))) found.push({ v, dir: path.join(extDir, v) });
    }
  }
  const num = (v) => v.split(/[._]/).map(n => parseInt(n, 10) || 0);
  found.sort((a, b) => { const x = num(a.v), y = num(b.v); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return (y[i] || 0) - (x[i] || 0); return 0; });
  return found[0] || null;
}

function loadHuntExt() {
  if (huntExt) return huntExt;
  const f = findHuntExt();
  if (!f) return (huntExt = { error: 'extensão /hunt não encontrada no Brave, Chrome ou Edge' });
  try {
    const man = JSON.parse(fs.readFileSync(path.join(f.dir, 'manifest.json'), 'utf8'));
    const read = (list) => (list || []).map(p => fs.readFileSync(path.join(f.dir, p), 'utf8')).join('\n;\n');
    const cs = man.content_scripts || [];
    huntExt = {
      version: man.version, dir: f.dir,
      main: cs.filter(c => c.world === 'MAIN').map(c => read(c.js)).join('\n;\n'),
      isolated: cs.filter(c => c.world !== 'MAIN' && c.js).map(c => read(c.js)).join('\n;\n'),
      css: cs.map(c => read(c.css)).join('\n'),
    };
  } catch (e) { huntExt = { error: 'não consegui ler a extensão /hunt: ' + e.message }; }
  return huntExt;
}

ipcMain.on('hunt:ext-code', (e) => { e.returnValue = loadHuntExt(); });
ipcMain.handle('hunt:ext-info', () => { const x = loadHuntExt(); return { version: x.version, error: x.error, css: x.css }; });
// ---------- Rotom Sniper ----------
// Extensão de snipe do Mercado. É carregada de verdade (com o Cockpit dela) só nas contas em que
// o usuário ligou o snipe: cada conta tem a própria sessão, então regras e logs ficam por conta.
const SNIPE_EXT_ID = 'olccbpdjdkbfgondiiaicmlifhbcggmk';
async function enableSnipe(partition) {
  const ses = session.fromPartition(partition);
  const have = ses.getExtension(SNIPE_EXT_ID);
  if (have) return { ok: true, version: have.version, loadedNow: false };
  const f = findHuntExt(SNIPE_EXT_ID);
  if (!f) return { error: 'extensão Rotom Sniper não encontrada no Brave, Chrome ou Edge' };
  try {
    const ext = await ses.loadExtension(f.dir, { allowFileAccess: false });
    return { ok: true, version: ext.version, loadedNow: true };
  } catch (e) { return { error: 'não consegui carregar o Rotom Sniper: ' + e.message }; }
}
const cockpits = new Map(); // partition -> janela do Cockpit
ipcMain.handle('snipe:enable', (_e, partition) => enableSnipe(partition));
ipcMain.handle('snipe:disable', (_e, partition) => {
  const ses = session.fromPartition(partition);
  cockpits.get(partition)?.close();
  if (ses.getExtension(SNIPE_EXT_ID)) ses.removeExtension(SNIPE_EXT_ID);
  return true;
});
ipcMain.handle('snipe:open', async (_e, { partition, name }) => {
  const r = await enableSnipe(partition);
  if (r.error) return r;
  let w = cockpits.get(partition);
  if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); return r; }
  w = new BrowserWindow({
    width: 1160, height: 760, title: 'Rotom Sniper · ' + name, autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'), backgroundColor: '#14101c',
    webPreferences: { partition },
  });
  w.on('page-title-updated', (ev) => ev.preventDefault()); // mantém o nome da conta no título
  w.on('closed', () => cockpits.delete(partition));
  cockpits.set(partition, w);
  w.loadURL(`chrome-extension://${SNIPE_EXT_ID}/cockpit.html`);
  return r;
});

ipcMain.handle('paths', () => ({ pokePreload: 'file:///' + path.join(__dirname, 'poke-preload.js').replace(/\\/g, '/') }));

app.whenReady().then(async () => {
  if (process.env.PL_SELFTEST) { // checagem rápida sem interface: PL_SELFTEST=1 npm start
    for (const [p, list] of [['twitch', TWITCH], ['kick', KICK]]) for (const n of list) {
      try { console.log(p, n, JSON.stringify(await (p === 'twitch' ? checkTwitch(n) : checkKick(n)))); }
      catch (e) { console.log(p, n, 'ERRO', e.message); }
    }
    return app.quit();
  }
  app.setAppUserModelId('com.pokelives.app'); // necessário pros avisos do Windows aparecerem
  for (const p of ['persist:main', 'persist:alt']) session.fromPartition(p).setUserAgent(UA);
  // contas com o snipe ligado: a extensão tem que estar carregada antes do jogo abrir
  for (const a of loadConfig().settings?.pokeAccounts || []) if (a.snipe) await enableSnipe('persist:' + a.id);
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  const startHidden = process.argv.includes('--hidden'); // aberto junto com o Windows: começa na bandeja
  const win = new BrowserWindow({
    width: 1600, height: 950, backgroundColor: '#1a1410', title: 'Poke Lives', icon: iconPath, show: !startHidden,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true, backgroundThrottling: false, contextIsolation: true,
    },
  });
  win.setMenuBarVisibility(false);
  setupTray(win, iconPath);
  mainWin = win;
  // o PC não entra em suspensão com o app aberto (a tela pode apagar): farm e celular seguem funcionando
  if (!TESTING) powerSaveBlocker.start('prevent-app-suspension');
  const ph = loadConfig().settings?.phone;
  if (ph?.on && ph.token) startPhone(ph).catch(() => {});
  // nos testes: "test" = não grava a configuração; "nopoke" = não abre o PokeIdle
  const query = {};
  if (TESTING) query.test = '1';
  if (process.env.PL_NOPOKE) query.nopoke = '1';
  win.loadFile('index.html', Object.keys(query).length ? { query } : undefined);
  // modo de teste: só com PL_DEBUG_PORT definido, e só aceita conexões do próprio PC
  if (process.env.PL_DEBUG_PORT) {
    require('http').createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', async () => {
        try {
          let out;
          if (req.url.startsWith('/shot')) {
            const file = decodeURIComponent((req.url.split('file=')[1] || '').split('&')[0]);
            out = body ? await win.webContents.executeJavaScript(body) : null; // dataURL de um webview
            const titulo = decodeURIComponent((req.url.match(/[?&]janela=([^&]+)/) || [])[1] || '');
            const alvo = titulo ? (BrowserWindow.getAllWindows().find(w => w.getTitle().includes(titulo)) || win)
              : req.url.includes('cmp=1') && comparadorWin ? comparadorWin : win;
            const png = out ? Buffer.from(String(out).split(',')[1], 'base64') : (await alvo.webContents.capturePage()).toPNG();
            fs.writeFileSync(file, png); out = file;
          } else if (req.url.startsWith('/cmp')) out = await comparadorWin?.webContents.executeJavaScript(body); // janela do comparador
          else out = await win.webContents.executeJavaScript(body);
          res.end(JSON.stringify(out, null, 1));
        } catch (e) { res.statusCode = 500; res.end(String(e && e.stack || e)); }
      });
    }).listen(+process.env.PL_DEBUG_PORT, '127.0.0.1');
  }
  if (process.env.PL_TESTJS)setTimeout(() => win.webContents.executeJavaScript(process.env.PL_TESTJS), 8000);
  if (process.env.PL_SHOT) setTimeout(async () => { // print de teste
    fs.writeFileSync(process.env.PL_SHOT, (await win.webContents.capturePage()).toPNG());
    app.quit();
  }, 20000);
});

// ---------- votos do TopIdle ----------
// O app só ABRE a página de voto; o clique em "Votar agora" (checagem da Cloudflare) é feito por você.
// janela de voto de cada conta: sessão própria (persist:voto-<conta>), o login do TopIdle fica salvo nela
const votoJanelas = new Map();
ipcMain.handle('voto:janela', (_e, { conta, url, nome }) => {
  let u;
  try { u = new URL(url); } catch { return { erro: 'link inválido' }; }
  if (u.protocol !== 'https:' || !/(^|\.)topidle\./i.test(u.hostname)) return { erro: 'o link não é do TopIdle' };
  if (!/^[\w-]{1,40}$/.test(conta || '')) return { erro: 'conta inválida' };
  let w = votoJanelas.get(conta);
  if (w && !w.isDestroyed()) { w.loadURL(u.href); if (w.isMinimized()) w.restore(); w.show(); w.focus(); return { ok: true }; }
  w = new BrowserWindow({
    width: 1100, height: 860, title: `Votar · ${String(nome || conta).slice(0, 30)}`, autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'), backgroundColor: '#14101c',
    webPreferences: { partition: `persist:voto-${conta}` },
  });
  w.on('page-title-updated', (ev) => ev.preventDefault()); // o título diz de qual conta é a janela
  w.on('closed', () => votoJanelas.delete(conta));
  votoJanelas.set(conta, w);
  w.loadURL(u.href);
  return { ok: true };
});

// ---------- comparador de Pokémon ----------
// Abre o comparador (arquivo do usuário, sem alteração) numa janela própria; a ponte preenche as fichas.
let comparadorWin = null, comparadorConta = null;
ipcMain.handle('comparador:abrir', (_e, conta) => {
  comparadorConta = conta || null;
  if (comparadorWin && !comparadorWin.isDestroyed()) { comparadorWin.reload(); comparadorWin.show(); comparadorWin.focus(); return true; }
  comparadorWin = new BrowserWindow({
    width: 1320, height: 900, title: 'Comparador de Pokémon', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'), backgroundColor: '#2b2230',
    webPreferences: { preload: path.join(__dirname, 'comparador-preload.js'), contextIsolation: true },
  });
  comparadorWin.on('closed', () => { comparadorWin = null; });
  comparadorWin.loadFile(path.join(__dirname, 'comparador.html'));
  return true;
});
ipcMain.handle('comparador:inicio', () => ({ conta: comparadorConta }));
ipcMain.handle('comparador:pokemons', async () => {
  try { return await phoneData('window.listarPokemons ? window.listarPokemons() : []'); } catch { return []; }
});

// ---------- acompanhar pelo celular ----------
// Página só de leitura na rede de casa (Wi-Fi). Toda requisição precisa do código secreto (?k=...).
let mainWin = null, phoneSrv = null, phoneCfg = null;
const PHONE_PORT = 47800;
function lanAddresses() {
  const out = [];
  for (const [nome, lista] of Object.entries(require('os').networkInterfaces())) {
    for (const a of lista || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const priv = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      const ts = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address); // Tailscale
      if (priv || ts) out.push({ ip: a.address, nome, ts, virtual: /vethernet|virtualbox|vmware|wsl|hyper-v|default switch/i.test(nome) });
    }
  }
  const reais = out.filter(a => !a.virtual); // redes virtuais (WSL, Hyper-V, VMs) o celular não alcança
  return (reais.length ? reais : out).sort((a, b) => a.ts - b.ts);
}
async function phoneData(js) {
  if (!mainWin || mainWin.isDestroyed()) throw new Error('app fechando');
  return mainWin.webContents.executeJavaScript(js);
}
// print de uma conta: um por vez por jogo, com limite de tempo, e reaproveitado por 2 s
const telas = new Map(); // webContents id -> { t, jpg, andamento }
const comPrazo = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('demorou')), ms))]);
async function telaDe(wc) {
  const c = telas.get(wc.id) || {};
  telas.set(wc.id, c);
  if (c.jpg && Date.now() - c.t < 2000) return c.jpg;
  if (c.andamento) return c.andamento;
  c.andamento = (async () => {
    let img = await comPrazo(wc.capturePage(), 3000).catch(() => null);
    if (!img || img.isEmpty()) {
      // painel do PokeIdle fechado: ele volta pra dentro da janela, atrás das lives (invisível), só durante a captura
      await phoneData('window.phoneEspiar && window.phoneEspiar(true)').catch(() => {});
      try {
        for (let i = 0; i < 8 && (!img || img.isEmpty()); i++) {
          await new Promise(r => setTimeout(r, 250));
          img = await comPrazo(wc.capturePage(), 3000).catch(() => null);
        }
      } finally { await phoneData('window.phoneEspiar && window.phoneEspiar(false)').catch(() => {}); }
    }
    if (!img || img.isEmpty()) return null;
    if (img.getSize().width > 900) img = img.resize({ width: 900 });
    c.jpg = img.toJPEG(70); c.t = Date.now();
    return c.jpg;
  })().finally(() => { c.andamento = null; });
  return c.andamento;
}
async function startPhone(cfg) {
  stopPhone();
  phoneCfg = cfg;
  const crypto = require('crypto');
  const ok = (k) => typeof k === 'string' && k.length === cfg.token.length &&
    crypto.timingSafeEqual(Buffer.from(k), Buffer.from(cfg.token));
  phoneSrv = require('http').createServer(async (req, res) => {
    let u;
    try { u = new URL(req.url, 'http://x'); } catch { res.statusCode = 400; return res.end(); }
    const acao = req.method === 'POST' && u.pathname === '/api/retomar'; // único comando: voltar a jogar no PC
    if ((req.method !== 'GET' && !acao) || !ok(u.searchParams.get('k'))) { res.statusCode = 403; return res.end('Acesso negado'); }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    try {
      if (u.pathname === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end(fs.readFileSync(path.join(__dirname, 'phone.html')));
      }
      if (u.pathname === '/api/stream') { // tempo real: um pacote a cada 3 s enquanto a página estiver aberta
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        let vivo = true;
        const envia = async () => {
          if (!vivo) return;
          try { res.write(`data: ${JSON.stringify(await phoneData('window.phoneStatus ? window.phoneStatus() : null'))}\n\n`); }
          catch { res.write(': sem dados\n\n'); }
          if (vivo) setTimeout(envia, 3000);
        };
        req.on('close', () => { vivo = false; });
        return envia();
      }
      if (acao) {
        const id = String(u.searchParams.get('conta') || '');
        const r = await phoneData(`window.retomarConta ? window.retomarConta(${JSON.stringify(id)}) : { ok: false }`);
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify(r || { ok: false }));
      }
      if (u.pathname === '/api/tela') { // print da tela de uma conta (só quando pedido)
        const id = String(u.searchParams.get('conta') || '');
        const wcId = await phoneData(`(() => { try { return pokeViews[${JSON.stringify(id)}]?.getWebContentsId() ?? null; } catch { return null; } })()`);
        const wc = wcId != null && webContents.fromId(wcId);
        if (!wc) { res.statusCode = 404; return res.end(); }
        const jpg = await telaDe(wc);
        if (!jpg) { res.statusCode = 204; return res.end(); }
        res.setHeader('Content-Type', 'image/jpeg');
        return res.end(jpg);
      }
      res.statusCode = 404; res.end();
    } catch (e) { console.error('[celular]', e); res.statusCode = 500; res.end('erro'); }
  });
  await new Promise((resolve, reject) => {
    phoneSrv.once('error', reject);
    phoneSrv.listen(cfg.port || PHONE_PORT, '0.0.0.0', resolve);
  });
  return phoneInfo();
}
function stopPhone() { if (phoneSrv) { phoneSrv.close(); phoneSrv.closeAllConnections?.(); phoneSrv = null; } }
async function phoneInfo() {
  if (!phoneSrv || !phoneCfg) return { on: false };
  const port = phoneCfg.port || PHONE_PORT;
  const urls = lanAddresses().map(a => ({ ...a, url: `http://${a.ip}:${port}/?k=${phoneCfg.token}` }));
  for (const x of urls) { try { x.qr = await require('qrcode').toDataURL(x.url, { margin: 1, width: 220 }); } catch { x.qr = null; } }
  return { on: true, urls, qr: urls[0]?.qr || null };
}
ipcMain.handle('phone:set', async (_e, cfg) => {
  try { if (!cfg?.on) { stopPhone(); return { on: false }; } return await startPhone(cfg); }
  catch (e) { stopPhone(); return { on: false, error: e.code === 'EADDRINUSE' ? `a porta ${cfg.port || PHONE_PORT} já está em uso` : e.message }; }
});
ipcMain.handle('phone:info', () => phoneInfo());

// ---------- economia de memória ----------
// anúncios e rastreadores de terceiros: não fazem falta pros pontos nem pro jogo
const BLOCK = ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'amazon-adsystem.com',
  'scorecardresearch.com', 'google-analytics.com', 'googletagmanager.com', 'facebook.net', 'connect.facebook.net',
  'sharethrough.com', 'adsrvr.org', 'adnxs.com', 'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com',
  'pubmatic.com', 'rubiconproject.com', 'casalemedia.com', 'openx.net', 'moatads.com', 'quantserve.com',
  'hotjar.com', 'clarity.ms', 'branch.io', 'segment.io', 'mixpanel.com', 'amplitude.com', 'sentry.io'];
const blockedSessions = new WeakSet();
function blockAds(ses) {
  if (!ses || blockedSessions.has(ses)) return;
  blockedSessions.add(ses);
  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (d, cb) => {
    let host = '';
    try { host = new URL(d.url).hostname; } catch { /* url estranha */ }
    cb({ cancel: BLOCK.some(b => host === b || host.endsWith('.' + b)) });
  });
}

// quem está logado nas lives (lê os cookies da sessão, sem abrir nada)
ipcMain.handle('logins', async (_e, partition) => {
  const ses = session.fromPartition(partition || 'persist:main');
  const tw = await ses.cookies.get({ domain: 'twitch.tv' }).catch(() => []);
  const kk = await ses.cookies.get({ domain: 'kick.com' }).catch(() => []);
  const twLogin = tw.find(c => c.name === 'login')?.value || (tw.some(c => c.name === 'auth-token') ? '?' : null);
  const kkSess = kk.find(c => /session_token|kick_session|XSRF/i.test(c.name) && /session_token/i.test(c.name));
  return { twitch: twLogin ? decodeURIComponent(twLogin) : null, kick: kkSess ? '?' : null };
});

ipcMain.handle('fullscreen', (e, on) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.setFullScreen(!!on);
  return true;
});

ipcMain.handle('metrics', () => {
  const mem = new Map(app.getAppMetrics().map(m => [m.pid, m]));
  const pages = webContents.getAllWebContents().map(wc => {
    const m = mem.get(wc.getOSProcessId());
    let host = '';
    try { host = new URL(wc.getURL()).hostname + new URL(wc.getURL()).pathname; } catch { /* */ }
    return { type: wc.getType(), url: host, mb: m ? Math.round(m.memory.workingSetSize / 1024) : 0, cpu: m ? Math.round(m.cpu.percentCPUUsage) : 0 };
  });
  const total = Math.round(app.getAppMetrics().reduce((s, m) => s + m.memory.workingSetSize, 0) / 1024);
  const other = app.getAppMetrics().filter(m => m.type !== 'Tab' && m.type !== 'Renderer').map(m => ({ type: m.type, mb: Math.round(m.memory.workingSetSize / 1024) }));
  return { total, pages, other };
});

// login com Google/Discord às vezes abre em janelinha e precisa dela pra devolver o login
const POPUP_AUTH = ['accounts.google.com', 'discord.com', 'id.twitch.tv'];
function openLinkOutside(url) {
  let u;
  try { u = new URL(url); } catch { return; }
  if (!/^https?:$/.test(u.protocol)) return;
  if (BLOCK.some(b => u.hostname === b || u.hostname.endsWith('.' + b))) return;
  shell.openExternal(url);
}

app.on('web-contents-created', (_e, wc) => {
  blockAds(wc.session);
  // vale pra TODA página do app (lives, PokeIdle, janelas de login e janelinhas):
  // link que abriria janela nova vai pro navegador padrão do PC (ex.: Brave)
  wc.setWindowOpenHandler(({ url }) => {
    let host = '';
    try { host = new URL(url).hostname; } catch { /* */ }
    if (POPUP_AUTH.some(a => host === a || host.endsWith('.' + a))) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true } };
    }
    if (url && url !== 'about:blank') openLinkOutside(url);
    return { action: 'deny' };
  });
  if (wc.getType() === 'webview') {
    wc.setBackgroundThrottling(false);
    const external = openLinkOutside;
    // link que sairia do site (da live ou do PokeIdle) também abre fora, pra aba não sair do lugar
    wc.on('will-navigate', (ev, url) => {
      let from, to;
      try { from = new URL(wc.getURL()).hostname.replace(/^www\./, ''); to = new URL(url).hostname.replace(/^www\./, ''); } catch { return; }
      // logins (Discord/Google/Twitch) vão e voltam dentro da própria aba
      const AUTH = ['discord.com', 'accounts.google.com', 'id.twitch.tv', 'twitch.tv', 'kick.com', 'pokeidle.io', 'challenges.cloudflare.com'];
      const isAuth = (h) => AUTH.some(a => h === a || h.endsWith('.' + a));
      if (isAuth(from) && isAuth(to) && (/discord|google|id\.twitch/.test(from + to))) return;
      if (from && to && from !== to && !to.endsWith('.' + from)) { ev.preventDefault(); external(url); }
    });
  }
});

// ---------- bandeja (perto do relógio) e iniciar com o Windows ----------
let tray = null, quitting = false;
function setupTray(win, iconPath) {
  if (TESTING) return;
  const show = () => { if (win.isMinimized()) win.restore(); win.show(); win.focus(); };
  app.on('second-instance', show);
  const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Poke Lives');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Abrir Poke Lives', click: show },
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin,
      click: (it) => { app.setLoginItemSettings({ openAtLogin: it.checked, args: ['--hidden'] }); tray.setContextMenu(menu()); } },
    { type: 'separator' },
    { label: 'Sair', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', show);
  // fechar a janela = continua rodando na bandeja (as lives e o jogo seguem)
  let avisou = false;
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!avisou && Notification.isSupported()) {
      avisou = true;
      new Notification({ title: 'Poke Lives continua rodando', body: 'Está perto do relógio. Clique com o botão direito no ícone pra sair.' }).show();
    }
  });
}
app.on('before-quit', () => { quitting = true; });

app.on('window-all-closed', () => app.quit());
