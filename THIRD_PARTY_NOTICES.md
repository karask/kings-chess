# Third-Party Notices

King's Study includes third-party software and public-domain data. Project-authored code and content are licensed under `GPL-3.0-or-later`; see [`LICENSE`](LICENSE). Third-party components retain their own licenses and notices.

The source URLs below are provenance and license references. They are not remote services used by the app. King's Study has no Sites integration, cloud service, backend, account, synchronization, analytics, or live API dependency.

## Stockfish.js 18 lite single-thread

King's Study bundles these browser-engine artifacts:

- `public/engine/stockfish-18-lite-single.js`
- `public/engine/stockfish-18-lite-single.wasm`

They are unmodified copies of the lite single-thread artifacts distributed by the npm package `stockfish@18.0.8` (`buildVersion: 18`). The package declares `GPL-3.0` and identifies the upstream project as `nmrugg/stockfish.js`.

- Component: Stockfish.js 18 lite single-thread
- Upstream release: <https://github.com/nmrugg/stockfish.js/releases/tag/v18.0.0>
- Exact corresponding-source tag: <https://github.com/nmrugg/stockfish.js/tree/v18.0.0>
- Corresponding-source archive: <https://github.com/nmrugg/stockfish.js/archive/refs/tags/v18.0.0.tar.gz>
- JavaScript release asset: <https://github.com/nmrugg/stockfish.js/releases/download/v18.0.0/stockfish-18-lite-single.js>
- WebAssembly release asset: <https://github.com/nmrugg/stockfish.js/releases/download/v18.0.0/stockfish-18-lite-single.wasm>
- Stockfish.js authors and contributors: <https://github.com/nmrugg/stockfish.js/blob/v18.0.0/AUTHORS>
- License: GNU General Public License version 3; a verbatim copy is shipped at [`public/engine/COPYING.txt`](public/engine/COPYING.txt).

Checksums of the bundled artifacts (SHA-256):

```text
5243fd9b276cab7dfe3ad1d43ab9ead73568fac76468c614242977a210c4a391  public/engine/stockfish-18-lite-single.js
a8fbc05ec6920b56d7485826dcb02c5ffd2826bcbf751cf973046f237a9096f1  public/engine/stockfish-18-lite-single.wasm
```

Stockfish.js is a WebAssembly port of the Stockfish chess engine. Copyright and contributor information is maintained by the upstream projects:

- Stockfish: <https://github.com/official-stockfish/Stockfish>
- Stockfish.js: <https://github.com/nmrugg/stockfish.js>

## Lichess puzzle snapshot

`public/data/puzzles.json` is a transformed subset of the Lichess puzzle database, which Lichess dedicates to the public domain under CC0 1.0.

- Publisher: Lichess
- Database page and format documentation: <https://database.lichess.org/#puzzles>
- Source file: <https://database.lichess.org/lichess_db_puzzle.csv.zst>
- Recorded source snapshot: `2026-08-02`
- Local dataset ID: `lichess-starter-2026-08`
- Generated: `2026-08-28T10:27:39.116Z`
- License: CC0 1.0 Universal, <https://creativecommons.org/publicdomain/zero/1.0/>
- Local manifest: [`public/data/puzzle-manifest.json`](public/data/puzzle-manifest.json)
- Local pack SHA-256: `94b2464985fdab237640a2e951febef51a8ded71774b8d0d538d3b6fc509dbb6`

The generator read 194,275 source rows, retained ratings 800–1900 with popularity at least 80 and at least 40 plays, removed duplicates, and emitted 3,000 puzzles. Of those, 600 were selected for Pirc/KID/KIA structure tags. Puzzle IDs and source-game URLs are retained for traceability. The transformation and any project-authored explanations are part of King's Study; the underlying puzzle records remain CC0.

## Direct npm dependencies

Versions below are the exact versions recorded in this distribution's lockfile.

### Runtime

| Package | Version | License | Upstream source |
| --- | ---: | --- | --- |
| `@mliebelt/pgn-parser` | 1.4.19 | Apache-2.0 | <https://github.com/mliebelt/pgn-parser> |
| `chess.js` | 1.4.0 | BSD-2-Clause | <https://github.com/jhlywa/chess.js> |
| `dexie` | 4.4.5 | Apache-2.0 | <https://github.com/dexie/Dexie.js> |
| `react` | 19.2.6 | MIT | <https://github.com/facebook/react> |
| `react-chessboard` | 5.12.1 | MIT | <https://github.com/Clariity/react-chessboard> |
| `react-dom` | 19.2.6 | MIT | <https://github.com/facebook/react> |
| `stockfish` | 18.0.8 | GPL-3.0 | <https://github.com/nmrugg/stockfish.js/tree/v18.0.0> |
| `ts-fsrs` | 5.4.1 | MIT | <https://github.com/open-spaced-repetition/ts-fsrs> |

### Development and build tooling

| Package | Version | License | Upstream source |
| --- | ---: | --- | --- |
| `@eslint/js` | 9.39.4 | MIT | <https://github.com/eslint/eslint> |
| `@types/node` | 22.19.19 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| `@types/react` | 19.2.14 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| `@types/react-dom` | 19.2.3 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| `@vitejs/plugin-react` | 6.0.2 | MIT | <https://github.com/vitejs/vite-plugin-react> |
| `eslint` | 9.39.4 | MIT | <https://github.com/eslint/eslint> |
| `eslint-plugin-jsx-a11y` | 6.10.2 | MIT | <https://github.com/jsx-eslint/eslint-plugin-jsx-a11y> |
| `eslint-plugin-react` | 7.37.5 | MIT | <https://github.com/jsx-eslint/eslint-plugin-react> |
| `eslint-plugin-react-hooks` | 7.1.1 | MIT | <https://github.com/facebook/react/tree/main/packages/eslint-plugin-react-hooks> |
| `fake-indexeddb` | 6.2.5 | Apache-2.0 | <https://github.com/dumbmatter/fakeIndexedDB> |
| `globals` | 16.4.0 | MIT | <https://github.com/sindresorhus/globals> |
| `typescript` | 5.9.3 | Apache-2.0 | <https://github.com/microsoft/TypeScript> |
| `typescript-eslint` | 8.59.3 | MIT | <https://github.com/typescript-eslint/typescript-eslint> |
| `vite` | 8.2.2 | MIT | <https://github.com/vitejs/vite> |

Transitive npm packages keep their own license files and metadata in the installed package tree. `package-lock.json` is the authoritative dependency graph for this release.
