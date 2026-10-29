const $ = (id) => document.getElementById(id);
const form = $('unlock');
const passwordInput = $('password');
const loading = $('loading');
const created = new Set();
let unpacker;
let busy = false;
let running = false;
const objectURL = (blob) => { const url = URL.createObjectURL(blob); created.add(url); return url; };
const release = () => { for (const url of created) URL.revokeObjectURL(url); created.clear(); };
const progress = (value, label, detail) => {
  $('progress').value = value;
  $('status').textContent = label;
  $('detail').textContent = detail;
};

// AES and ZIP parsing must never execute on the page's rendering thread.
function unpack(password) {
  unpacker ||= new Worker(new URL('./unpack.js?v=' + __UNPACK_VERSION__, import.meta.url));
  const worker = unpacker;
  const assets = Object.create(null);
  return new Promise((resolve, reject) => {
    const finish = (error, html) => {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      if (error?.message !== 'password' && !error?.message.startsWith('download')) {
        worker.terminate();
        unpacker = null;
      }
      error ? reject(error) : resolve({ html, assets });
    };
    worker.onerror = (event) => { event.preventDefault(); finish(new Error('worker')); };
    worker.onmessageerror = () => finish(new Error('worker'));
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') progress(data.value, data.label, data.detail);
      else if (data.type === 'asset') assets[data.name] = objectURL(data.blob);
      else if (data.type === 'done') finish(null, data.html);
      else if (data.type === 'error') {
        if (data.code !== 'password') console.warn('[game-loader]', data.code, data.reason);
        finish(new Error(data.code));
      }
    };
    worker.postMessage({ password });
  });
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
  bootstrap.src = objectURL(new Blob([`globalThis.__gameAssets=${JSON.stringify(assets)};`], { type: 'text/javascript' }));
  module.before(bootstrap);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('start')), 90000);
    const onMessage = (event) => {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type === 'game:ready') finish();
      if (event.data?.type === 'game:error') finish(new Error('start'));
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
  try {
    const { html, assets } = await unpack(password);
    progress(95, 'Jeszcze chwila…', 'Rozkładamy pierwszy zakątek świata.');
    await mount(html, assets);
  } catch (error) {
    $('game').replaceChildren();
    $('game').hidden = true;
    release();
    form.hidden = false;
    loading.hidden = true;
    $('message').textContent = error.message === 'password'
      ? 'To hasło nie otwiera furtki. Spróbuj jeszcze raz.'
      : error.message.startsWith('download')
        ? 'Pobieranie zostało przerwane. Wpisz hasło ponownie — dokończymy od ostatniej pobranej części.'
        : error.message === 'start'
          ? 'Paczka została pobrana, ale gra nie wystartowała. Odśwież stronę i spróbuj ponownie.'
          : 'Nie udało się otworzyć paczki gry. Odśwież stronę i spróbuj ponownie.';
    passwordInput.focus();
  } finally {
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
