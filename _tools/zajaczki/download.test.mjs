import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const MB = 1024 * 1024;
let serial = 0;
async function fixture(size, fault = () => null) {
  const { outputFiles } = await build({ entryPoints: [new URL('./download.js', import.meta.url).pathname], bundle: true, write: false, format: 'esm', define: { __ARCHIVE_BYTES__: String(size), __ARCHIVE_VERSION__: '"test"' } });
  const module = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].text + `\n// instance ${serial++}`).toString('base64'));
  const data = Buffer.alloc(size);
  for (let i = 0; i < size; i++) data[i] = i % 251;
  const requests = [];
  const attempts = new Map();
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const [, from, to] = options.headers.Range.match(/^bytes=(\d+)-(\d+)$/);
    const start = Number(from), end = Number(to);
    assert(end - start + 1 <= 4 * MB, 'Never request a response reaching the 10 MiB cutoff');
    attempts.set(start, (attempts.get(start) || 0) + 1);
    requests.push({ start, end });
    const problem = fault(start, attempts.get(start));
    if (problem === 'abort') throw new DOMException('aborted', 'AbortError');
    if (problem === 'network') {
      return new Response(new ReadableStream({ start(c) { c.enqueue(data.subarray(start, start + 1024)); c.error(new TypeError('connection cut')); } }), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${size}` } });
    }
    return new Response(problem === 'short' ? data.subarray(start, start + 1024) : data.subarray(start, end + 1), {
      status: problem === 'ignored' ? 200 : 206,
      headers: { 'Content-Range': `bytes ${problem === 'range' ? 0 : start}-${end}/${size}` },
    });
  };
  return { ...module, data, requests, attempts, restore: () => { globalThis.fetch = original; } };
}

test('download stays under 10 MiB and retries only a connection-cut fragment', async () => {
  const f = await fixture(10 * MB + 73, (start, attempt) => start === 4 * MB && attempt === 1 ? 'network' : null);
  try {
    const archive = await f.download(() => {});
    assert.deepEqual(Buffer.from(await archive.arrayBuffer()), f.data);
    assert.deepEqual([...f.attempts], [[0, 1], [4 * MB, 2], [8 * MB, 1]]);
  } finally { f.restore(); }
});

test('three incomplete responses report failure; manual retry retains complete fragments', async () => {
  const f = await fixture(12 * MB + 17, (start, attempt) => start === 8 * MB && attempt <= 3 ? 'short' : null);
  try {
    await assert.rejects(f.download(() => {}), { code: 'download-size' });
    const archive = await f.download(() => {});
    assert.deepEqual(Buffer.from(await archive.arrayBuffer()), f.data);
    assert.deepEqual([...f.attempts], [[0, 1], [4 * MB, 1], [8 * MB, 4], [12 * MB, 1]]);
  } finally { f.restore(); }
});

for (const problem of ['range', 'ignored']) test(`reject ${problem} response instead of appending the wrong bytes`, async () => {
  const f = await fixture(5 * MB, (start) => start === 4 * MB ? problem : null);
  try {
    await assert.rejects(f.download(() => {}), { code: 'download-range' });
    assert.equal(f.attempts.get(0), 1);
    assert.equal(f.attempts.get(4 * MB), 3);
  } finally { f.restore(); }
});

test('browser AbortError remains a resumable download error', async () => {
  const f = await fixture(5 * MB, () => 'abort');
  try {
    await assert.rejects(f.download(() => {}), { code: 'download' });
  } finally { f.restore(); }
});
