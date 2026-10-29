# Zajączki — private Diorama export

The public directory is `/zajaczki-gra/`. Only the landing page, the loader, the
Diorama mark, the zip.js license and an AES-256 encrypted `game.zip` are published.
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
Web Streams. No CDN is used. Rebuild the loader with the same command as the game.

Before publishing, test: no-hash prompt; wrong password and successful retry;
encoded hash; desktop and touch viewport; first scene, walking, a conversation,
scene transition and audio; no plaintext HTTP asset requests. Verify all ZIP
entries are encrypted, fail without/with a wrong password, and authenticate with
the chosen password. Check source-photo hashes and public files once more before
staging. Publish on the existing `master` GitHub Pages branch.
