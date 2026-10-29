# Zajączki — private game export

The public directory is `/zajaczki-gra/`. Only the landing page, the loader, the
engine mark, the zip.js license and an AES-256 encrypted `game.zip` are published.
No password, plaintext game, drawing photographs or workshop source files belong
in this repository. GitHub Pages excludes this `_tools` directory.

To rebuild with a local `drawn-dreams` world and Node.js 22 or newer:

```sh
cd _tools/zajaczki
npm ci
read -rs 'ZIP_PASSWORD?Game password: '; echo
printf '%s' "$ZIP_PASSWORD" | node build.mjs /path/to/diorama
unset ZIP_PASSWORD
```

The password prompt above uses zsh. Do not put a literal password in a shell
command or commit it. The build reads stdin, uses Diorama's gameplay-only exporter,
checks exported bytes against original drawing/photo hashes, adapts asset loading
to in-memory Blob URLs, and encrypts every archive entry with WinZip AES-256.
The adapter fails if the expected runtime integration points have changed.

`https://grzegorz.tanczyk.pl/zajaczki-gra/#PASSWORD` opens the game directly;
without a fragment the page asks for a password. Encode special characters with
`encodeURIComponent` when building a link. The fragment is cleared from the current
address immediately after reading. No analytics, remote scripts, service worker,
localStorage or decrypted persistent cache is used. A wrong password allows retry
without downloading the archive again. Runtime assets are Blob URLs and never
requested from the public server.

The password and unlocked assets are available to anyone given the full link.
ZIP filenames and file sizes are not encrypted. Updating the password creates a
new archive but does not revoke copies of an older archive or Git history.

The loader uses [zip.js](https://github.com/gildas-lormeau/zip.js), pinned in the
lockfile and bundled locally. It requires a modern browser with Web Crypto and
Web Streams. No CDN is used. Download, ZIP parsing and AES decryption run in a dedicated Web Worker. The
archive is fetched sequentially using HTTP byte ranges of at most 4 MiB. Each
fragment has its Content-Range and byte length checked, with three attempts and
an idle timeout. Completed fragments survive a manual retry in the same tab.
Each response is streamed into a browser-managed Blob; entries are decrypted one
at a time. The host must support HTTP Range requests (GitHub Pages does). The worker retains the encrypted archive only for password retries;
after success it terminates before the game starts. Decrypted Blob URLs remain
owned by the page for scene transitions. The exported render loop yields through
a timer before scheduling its next animation frame, allowing loader messages,
input and timers to run even when a frame is expensive. Voiced dialogue advances
after audio playback ends plus a short pause, independently of the simulation
clock. Muted or missing voices retain the text-reading fallback.

To rebuild just the loader without changing the encrypted archive or needing its
password, run `node build-loader.mjs`. The full build also calls this step. ZIP,
worker and loader URLs use content hashes so updates bypass stale HTTP caches.

Run the downloader regression tests with `node --test download.test.mjs`. They
cover a response cut below 10 MiB, fragment retries, resuming completed fragments,
incorrect Range responses and browser aborts.

Before publishing, test: no-hash prompt; wrong password and successful retry;
encoded hash; desktop and touch viewport; first scene, walking, a conversation,
scene transition and audio; rapid answer clicks must stop the previous voice and
discard obsolete replies while preserving item and flag effects; no plaintext
HTTP asset requests. Verify all ZIP
entries are encrypted, fail without/with a wrong password, and authenticate with
the chosen password. Check source-photo hashes and public files once more before
staging. Publish on the existing `master` GitHub Pages branch.

Public branding intentionally uses only the logo. Keep the engine name out of the landing page, metadata and exported runtime. Legal license text remains intact.
