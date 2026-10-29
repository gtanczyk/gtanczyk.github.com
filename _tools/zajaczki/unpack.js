import { download, resetDownload } from './download.js';
import { ZipReader, BlobReader, BlobWriter, TextWriter, configure, ERR_INVALID_PASSWORD } from '@zip.js/zip.js/index-native.js';

// This entire module runs in our dedicated worker. Do not spawn nested workers.
configure({ useWebWorkers: false, chunkSize: 256 * 1024 });
let archive;
let busy = false;
const mime = (name) => ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', wav: 'audio/wav', json: 'application/json', js: 'text/javascript', glb: 'model/gltf-binary' })[name.split('.').pop()] || 'application/octet-stream';
const progress = (value, label, detail) => postMessage({ type: 'progress', value, label, detail });

self.onmessage = async ({ data }) => {
  if (busy || typeof data.password !== 'string' || !data.password) return;
  busy = true;
  let zip;
  let result;
  try {
    zip = new ZipReader(new BlobReader(archive ||= await download(progress)), { password: data.password });
    const entries = (await zip.getEntries()).filter((entry) => !entry.directory);
    if (entries.some((e) => !e.encrypted || /(^\/|(^|\/)\.\.\/|\\)/.test(e.filename))) throw new Error('archive');
    const index = entries.find((e) => e.filename === 'index.html');
    if (!index) throw new Error('archive');
    progress(55, 'Otwieramy sekretną furtkę…', 'Sprawdzamy hasło.');
    const html = await index.getData(new TextWriter(), { checkSignature: true });
    const total = entries.reduce((n, e) => n + e.uncompressedSize, 0);
    let done = index.uncompressedSize;
    // One entry at a time bounds scratch memory. Blob structured cloning shares
    // immutable backing storage; object URLs belong to the page, not the worker.
    for (const entry of entries) {
      if (entry === index) continue;
      const blob = await entry.getData(new BlobWriter(mime(entry.filename)), { checkSignature: true });
      postMessage({ type: 'asset', name: entry.filename, blob });
      done += entry.uncompressedSize;
      progress(55 + done / total * 40, 'Budzą się nasi bohaterowie…', `Przygotowanie gry · ${Math.round(done / total * 100)}%`);
    }
    await zip.close();
    zip = null;
    archive = null;
    result = { type: 'done', html };
  } catch (error) {
    const code = error.message === ERR_INVALID_PASSWORD ? 'password'
      : typeof error.code === 'string' && error.code.startsWith('download') ? error.code : 'archive';
    if (code !== 'password') archive = null;
    if (!code.startsWith('download') && code !== 'password') resetDownload();
    result = { type: 'error', code, reason: String(error.message) };
  } finally {
    await zip?.close().catch(() => {});
    data.password = '';
    busy = false;
  }
  // A retry may arrive as soon as the page receives the result.
  postMessage(result);
};
