const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const IDLE_MS = 30000;
const parts = [];
let downloaded = 0;

export function resetDownload() {
  parts.length = 0;
  downloaded = 0;
}

const failure = (code) => Object.assign(new Error(code), { code });

// Every response stays below the size at which some connections cut downloads.
// Only complete, validated fragments are retained for automatic/manual retries.
export async function download(progress) {
  const total = __ARCHIVE_BYTES__;
  const count = Math.ceil(total / CHUNK_BYTES);
  const detail = (size, part) => `${(size / 1048576).toFixed(1)} z ${(total / 1048576).toFixed(1)} MB · część ${part}/${count}`;
  while (downloaded < total) {
    const start = downloaded;
    const end = Math.min(start + CHUNK_BYTES, total) - 1;
    const expected = end - start + 1;
    const part = parts.length + 1;
    let fragment;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      let timer;
      const touch = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(), IDLE_MS); };
      try {
        progress(start / total * 55, attempt > 1 ? 'Ponawiamy przerwaną część…' : 'Pobieramy świat Zajączków…', detail(start, part));
        touch();
        // A stable URL per fragment allows ordinary browser caching. On retry,
        // bypass a stale/truncated response without discarding earlier fragments.
        const url = './game.zip?v=' + __ARCHIVE_VERSION__ + '&part=' + start + (attempt > 1 ? '&retry=' + Date.now() : '');
        const response = await fetch(url, {
          headers: { Range: `bytes=${start}-${end}` }, credentials: 'omit',
          cache: attempt > 1 ? 'reload' : 'default', signal: controller.signal,
        });
        const range = response.headers.get('content-range');
        const completeSmallFile = total <= CHUNK_BYTES && response.status === 200;
        if (!response.body || (!completeSmallFile && (response.status !== 206 || range !== `bytes ${start}-${end}/${total}`))) {
          await response.body?.cancel();
          throw failure('download-range');
        }
        let received = 0;
        let last = -Infinity;
        const meter = new TransformStream({ transform(chunk, sink) {
          touch();
          received += chunk.byteLength;
          if (received > expected) throw failure('download-size');
          const now = performance.now();
          if (now - last > 100 || received === expected) {
            progress((start + received) / total * 55, 'Pobieramy świat Zajączków…', detail(start + received, part));
            last = now;
          }
          sink.enqueue(chunk);
        } });
        fragment = await new Response(response.body.pipeThrough(meter)).blob();
        if (fragment.size !== expected) throw failure('download-size');
        break;
      } catch (error) {
        controller.abort();
        if (attempt === MAX_ATTEMPTS) throw failure(typeof error.code === 'string' && error.code.startsWith('download') ? error.code : 'download');
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      } finally {
        clearTimeout(timer);
      }
    }
    parts.push(fragment);
    downloaded += fragment.size;
  }
  const archive = new Blob(parts, { type: 'application/zip' });
  resetDownload();
  return archive;
}
