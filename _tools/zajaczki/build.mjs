// Usage: node build.mjs /path/to/diorama < /secure/password-input
// The password is read from stdin; it is never written into public output or logs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { buildLoader } from './build-loader.mjs';
import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter, configure } from '@zip.js/zip.js/index-native.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const diorama = path.resolve(process.argv[2] || '../../../diorama');
const output = path.resolve(here, '../../zajaczki-gra');
const password = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
if (!password) throw new Error('Provide the ZIP password on stdin.');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'zajaczki-export-'));
const source = path.join(diorama, 'worlds/drawn-dreams');
const list = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? list(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const replaceOnce = (text, search, replacement) => {
  if (!text.includes(search) || text.indexOf(search) !== text.lastIndexOf(search)) throw new Error('Diorama runtime changed; review the private asset adapter.');
  return text.replace(search, replacement);
};

try {
  execFileSync(process.execPath, [path.join(diorama, 'app/bin/diorama.mjs'), 'export', 'drawn-dreams', temporary], { cwd: diorama, stdio: ['ignore', 'ignore', 'inherit'] });
  const entry = path.join(diorama, 'app/web/main.ts');
  const runtime = await build({
    entryPoints: [entry], bundle: true, format: 'esm', minify: true, target: 'es2022', write: false,
    plugins: [{ name: 'in-memory-private-assets', setup(builder) {
      builder.onLoad({ filter: /main\.ts$/ }, (args) => {
        if (args.path !== entry) return;
        let text = fs.readFileSync(entry, 'utf8');
        text = replaceOnce(text, 'const files = (p: string) => `files/${p}`;', `const asset = (p: string): string => {
          const url = (globalThis as any).__gameAssets[p];
          if (!url) throw new Error('Missing private asset: ' + p);
          return url;
        };
        const files = (p: string) => asset('files/' + p);`);
        text = replaceOnce(text, "fetch('world-data.json')", "fetch(asset('world-data.json'))");
        text = replaceOnce(text, 'Object.assign(window, { diorama:', 'Object.assign(window, { game:');
        // Let input, loader messages and timers run even when rendering exceeds one frame.
        text = replaceOnce(text, 'const frame = (now: number) => {\n  requestAnimationFrame(frame);', 'const frame = (now: number) => {\n  setTimeout(() => requestAnimationFrame(frame), 0);');
        text = replaceOnce(text, 'this.ui();\n    if (this.data.story', `this.ui();
        parent.postMessage({ type: 'game:ready' }, '*');
        if (this.data.story`);
        return { contents: text, loader: 'ts', resolveDir: path.dirname(entry) };
      });
    } }],
  });
  fs.writeFileSync(path.join(temporary, 'main.js'), runtime.outputFiles[0].text);
  let html = fs.readFileSync(path.join(temporary, 'index.html'), 'utf8');
  html = html.replace('lang="en"', 'lang="pl"').replace('<title>Diorama</title>', '<title>Gra Zajączków</title>')
    .replace('Turn your phone sideways to play.', 'Obróć telefon, aby wygodniej grać.')
    .replace('Play upright anyway', 'Gram w pionie')
    .replace('click to walk or use, double click to hurry · right click or long press to look or put back · WASD or arrows walk (Shift hurries), E uses · 1-9 items · g grid · m sound', 'kliknij, aby podejść lub użyć · strzałki lub WASD: ruch · E: użyj · M: dźwięk');
  html = html.replace('</head>', `<script>addEventListener('error',()=>parent.postMessage({type:'game:error'},'*'));addEventListener('unhandledrejection',()=>parent.postMessage({type:'game:error'},'*'));</script></head>`);
  fs.writeFileSync(path.join(temporary, 'index.html'), html);

  const originals = list(source).filter((p) => p.includes(`${path.sep}drawings${path.sep}`) || /\/photo\.[^/]+$/.test(p));
  const originalHashes = new Set(originals.map(hash));
  const files = list(temporary).sort();
  for (const file of files) {
    const rel = path.relative(temporary, file).split(path.sep).join('/');
    if (!/^(index\.html|main\.js|world-data\.json|files\/(cast|places|items|sound)\/)/.test(rel) || /(^|\/)(drawings?|photo|memo|studio)(\/|\.)/i.test(rel)) throw new Error(`Disallowed export path: ${rel}`);
    if (originalHashes.has(hash(file))) throw new Error(`Original drawing photograph in export: ${rel}`);
  }
  const data = JSON.parse(fs.readFileSync(path.join(temporary, 'world-data.json'), 'utf8'));
  if (/drawings\/|photo\.png|\/Users\//.test(JSON.stringify(data))) throw new Error('Source material reference in world data.');

  fs.mkdirSync(output, { recursive: true });
  configure({ useWebWorkers: false });
  const zip = new ZipWriter(new Uint8ArrayWriter(), { password, encryptionStrength: 3, level: 0, zipCrypto: false, useWebWorkers: false });
  // Verify the password with the small HTML entry before decrypting large images.
  const ordered = [path.join(temporary, 'index.html'), ...files.filter((f) => !f.endsWith('/index.html'))];
  for (const file of ordered) await zip.add(path.relative(temporary, file).split(path.sep).join('/'), new Uint8ArrayReader(fs.readFileSync(file)), { lastModDate: new Date('2026-10-29T00:00:00Z') });
  const bytes = await zip.close();
  if (bytes.byteLength >= 100 * 1024 * 1024) throw new Error('Archive exceeds GitHub single-file limit.');
  fs.writeFileSync(path.join(output, 'game.zip'), bytes);
  await buildLoader();
  fs.copyFileSync(path.join(diorama, 'app/studio/favicon.svg'), path.join(output, 'logo.svg'));
  const license = fs.readFileSync(path.join(here, 'node_modules/@zip.js/zip.js/LICENSE'), 'utf8');
  fs.writeFileSync(path.join(output, 'LICENSE-zip.js.txt'), license);
  fs.copyFileSync(path.join(diorama, 'LICENSE'), path.join(output, 'LICENSE-engine.txt'));
  fs.copyFileSync(path.join(diorama, 'node_modules/three/LICENSE'), path.join(output, 'LICENSE-three.txt'));
  console.log(JSON.stringify({ files: files.length, places: Object.keys(data.places).length, originalFilesExcluded: originals.length, archiveBytes: bytes.byteLength, archiveSha256: hash(path.join(output, 'game.zip')) }, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
