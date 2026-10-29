import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(here, '../../zajaczki-gra');
const hash = (name) => createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex').slice(0, 16);

// Rebuild the loader independently, without decrypting or changing the game.
export async function buildLoader() {
  const bundle = (name, define) => build({
    entryPoints: [path.join(here, name)], bundle: true, format: name === 'loader.js' ? 'esm' : 'iife',
    minify: true, target: 'es2022', outfile: path.join(output, name), legalComments: 'eof', define,
  });
  await bundle('unpack.js', { __ARCHIVE_VERSION__: JSON.stringify(hash('game.zip')) });
  await bundle('loader.js', { __UNPACK_VERSION__: JSON.stringify(hash('unpack.js')) });
  const landing = path.join(output, 'index.html');
  fs.writeFileSync(landing, fs.readFileSync(landing, 'utf8').replace(/src="\.\/loader\.js(?:\?v=[^"]*)?"/, `src="./loader.js?v=${hash('loader.js')}"`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildLoader();
