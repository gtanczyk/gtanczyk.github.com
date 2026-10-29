import { ZipReader, BlobReader, BlobWriter, TextWriter, configure, ERR_INVALID_PASSWORD } from '@zip.js/zip.js/index-native.js';

configure({ useWebWorkers: false });
const $ = (id) => document.getElementById(id);
const form = $('unlock');
const passwordInput = $('password');
const loading = $('loading');
const created = new Set();
let archive;
let busy = false;
let running = false;
const mime = (name) => ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', wav: 'audio/wav', json: 'application/json', js: 'text/javascript', glb: 'model/gltf-binary' })[name.split('.').pop()] || 'application/octet-stream';
const objectURL = (blob) => { const url = URL.createObjectURL(blob); created.add(url); return url; };
const release = () => { for (const url of created) URL.revokeObjectURL(url); created.clear(); };
const progress = (value, label, detail) => {
  $('progress').value = value;
  $('status').textContent = label;
  $('detail').textContent = detail;
};

async function download() {
  if (archive) return archive;
  const response = await fetch('./game.zip', { credentials: 'omit' });
  if (!response.ok) throw new Error('download');
  const total = Number(response.headers.get('content-length'));
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    progress(total ? size / total * 55 : 15, 'Pobieramy świat Zajączków…', `${(size / 1048576).toFixed(1)}${total ? ` z ${(total / 1048576).toFixed(1)}` : ''} MB`);
  }
  archive = new Blob(chunks, { type: 'application/zip' });
  return archive;
}

async function mount(html, assets) {
  const frame = document.createElement('iframe');
  frame.title = 'Gra Zajączków';
  frame.allow = 'autoplay; fullscreen; gamepad';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const module = doc.querySelector('script[src="main.js"]');
  if (!module || !assets['main.js'] || !assets['world-data.json']) throw new Error('archive');
  module.src = assets['main.js'];
  const bootstrap = doc.createElement('script');
  bootstrap.src = objectURL(new Blob([`globalThis.__dioramaAssets=${JSON.stringify(assets)};`], { type: 'text/javascript' }));
  module.before(bootstrap);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('start')), 90000);
    const onMessage = (event) => {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type === 'diorama:ready') finish();
      if (event.data?.type === 'diorama:error') finish(new Error('start'));
    };
    const finish = (error) => {
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      error ? reject(error) : resolve();
    };
    window.addEventListener('message', onMessage);
    $('game').replaceChildren(frame);
    // Keep the frame laid out while loading, underneath the invitation.
    $('game').hidden = false;
    $('game').style.zIndex = '-1';
    frame.srcdoc = '<!doctype html>\n' + doc.documentElement.outerHTML;
  });
  progress(100, 'Przygoda czeka!', 'Gotowe.');
  $('game').style.zIndex = '';
  $('game').classList.add('ready');
  $('welcome').hidden = true;
  document.body.classList.add('playing');
  running = true;
  frame.focus();
}

async function unlock(password) {
  if (busy || running || !password) return;
  busy = true;
  form.hidden = true;
  loading.hidden = false;
  document.body.classList.add('busy');
  $('message').textContent = '';
  passwordInput.value = '';
  progress(0, 'Otwieramy świat wyobraźni…', 'Przygotowujemy przygodę.');
  let zip;
  try {
    zip = new ZipReader(new BlobReader(await download()), { password });
    const entries = (await zip.getEntries()).filter((entry) => !entry.directory);
    if (entries.some((e) => !e.encrypted || /(^\/|(^|\/)\.\.\/|\\)/.test(e.filename))) throw new Error('archive');
    const index = entries.find((e) => e.filename === 'index.html');
    if (!index) throw new Error('archive');
    progress(55, 'Otwieramy sekretną furtkę…', 'Sprawdzamy hasło.');
    const html = await index.getData(new TextWriter(), { checkSignature: true });
    const assets = Object.create(null);
    const total = entries.reduce((n, e) => n + e.uncompressedSize, 0);
    let done = index.uncompressedSize;
    for (const entry of entries) {
      if (entry === index) continue;
      const blob = await entry.getData(new BlobWriter(mime(entry.filename)), { checkSignature: true });
      assets[entry.filename] = objectURL(blob);
      done += entry.uncompressedSize;
      progress(55 + done / total * 40, 'Budzą się nasi bohaterowie…', `Przygotowanie gry · ${Math.round(done / total * 100)}%`);
      await new Promise((r) => setTimeout(r, 0));
    }
    await zip.close();
    zip = null;
    progress(95, 'Jeszcze chwila…', 'Rozkładamy pierwszy zakątek świata.');
    await mount(html, assets);
    archive = null;
  } catch (error) {
    if (error.message !== ERR_INVALID_PASSWORD) archive = null;
    $('game').replaceChildren();
    $('game').hidden = true;
    release();
    form.hidden = false;
    loading.hidden = true;
    $('message').textContent = error.message === ERR_INVALID_PASSWORD
      ? 'To hasło nie otwiera furtki. Spróbuj jeszcze raz.'
      : 'Nie udało się otworzyć gry. Sprawdź połączenie i spróbuj ponownie.';
    passwordInput.focus();
  } finally {
    await zip?.close().catch(() => {});
    password = '';
    busy = false;
    document.body.classList.remove('busy');
  }
}

function fromHash() {
  let password = '';
  try { password = decodeURIComponent(location.hash.slice(1)); }
  catch { $('message').textContent = 'Link ma nieprawidłowy zapis hasła. Wpisz hasło poniżej.'; }
  // Keep the password out of subsequent copies of the address and session history.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  if (password) void unlock(password);
}
form.addEventListener('submit', (event) => { event.preventDefault(); void unlock(passwordInput.value); });
window.addEventListener('hashchange', fromHash);
fromHash();
