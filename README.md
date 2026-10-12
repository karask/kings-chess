# King's Study

King's Study is a local-first chess trainer for a compact, coherent repertoire:

- the Pirc as Black against `1.e4`;
- the King's Indian Defense (KID) as Black against `1.d4`, `1.c4`, and related move orders;
- the King's Indian Attack (KIA) as White.

Play a complete game with a coach, learn from important decisions, and optionally revisit a mistake or solve two related exercises. The focus is plans, pawn breaks, and calculation—not memorizing one setup against everything.

This is a static browser app. It has no OpenAI Sites integration, cloud service, backend, account system, synchronization, analytics, or live API dependency. Training content and the chess engine are bundled; progress stays in the current browser.

## Run locally

Requirements: Node.js `>=22.13.0` and npm.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. This development mode is best for editing; no credentials or environment variables are required.

To run the installable, offline-capable production PWA locally:

```bash
npm run local
```

Open `http://localhost:4173`, allow the first load to finish, and then install it from your browser if desired. That first successful production load caches the app shell, curriculum, puzzle pack, and Stockfish assets. Later starts and training sessions can run without a network connection.

Useful commands:

```bash
npm test
npm run test:engine
npm run lint
npm run build
npm run local
npm run preview
```

`npm run build` type-checks the project and writes a static production build to `dist/`. The production service worker makes the core app, puzzle pack, and engine available offline after one successful load. Service workers are not registered by the development server.

## One board, one coach

The home screen opens your current coached game automatically. For a new game, choose **Pirc**, **KID**, or **KIA**, then **Play**. Opponent setup, opening-position starts, difficulty, and feedback frequency are under **Game options**. Difficulty is a Stockfish skill setting, not a calibrated human Elo.

There are no Today, Repertoire, Tactics, Progress, or Tabiya Sparring navigation screens. Older bookmarks lead to the game. Existing learning content, cards, attempts, review events, and backups remain intact; this redesign does not erase progress.

- The viewport-fitted board stays large. Coach text is on the left on desktop and in a compact panel above it on mobile.
- Feedback leads with a brief explanation. **Show why** explores your move and an alternative; **Try again** checks a candidate without changing the game. Further detail and engine numbers are collapsed.
- An **Opening guide** offers exact-position instruction when available, otherwise explicitly general family guidance—not an unsupported verdict about the current position.
- The black/white evaluation bar follows the displayed position. Positive favors White; negative favors Black; M means forced mate. It stays hidden in after-game coaching mode.
- **Take back** restores your previous turn, including undoing the opponent reply and cancelling pending analysis. It autosaves without deleting saved reviews.
- After a game, revisit at most three decisions, see one focus for the next game, and play again. **Remember for later** adds a useful decision to spaced review.
- Optional practice is part of the playing flow: two puzzle positions, or one saved decision. It is never a compulsory daily queue. A specific puzzle motif is inferred only from verified evidence; mixed fallback practice is labeled honestly after the attempt.
- **Game details** contains move history, PGN export, score definitions, and resignation. **Menu** contains local PGN import and Settings/Backup.

The current game resumes after reload and is included in JSON backups. Export a PGN before replacing it; v1 keeps one current game, not a game archive. There is no synchronization, account, analytics, or external chess-platform dependency.

### Teaching and evidence

Coaching runs at full strength independently of opponent difficulty. It compares unrestricted and played-move-restricted searches with fixed budgets, and spends extra effort on large or uncertain differences. Sound off-book alternatives are not automatically mistakes.

The current explanation layer verifies demonstrated mating lines, a subset of knight forks, and settled material consequences. It also uses exact authored opening instruction and separately labeled structure reminders. It cannot yet reliably explain every quiet or strategic move. An engine preference is not presented as a complete explanation, and a legal continuation is not proof that every move in it is forced.

Move labels use transparent centipawn-loss thresholds rather than Chess.com's proprietary system: Excellent ≤15, Good ≤50, Inaccuracy ≤100, Mistake ≤200, Blunder >200. Best is the engine's first choice; mate is handled separately, and unstable comparisons are Unrated. No Brilliant/Great labels or language-model service are used.

### Content retained behind the coach

- Original Pirc/KID/KIA plans, move-order warnings, model-game summaries, and family-focused endgame material remain in the curriculum library.
- The offline CC0 Lichess pack contains 3,000 legal puzzles. The opponent's setup move is applied before presentation; the learner must solve the full line, with legal alternate mate-in-one moves accepted.
- Hints, misses, slow solves, and existing due puzzle cards feed spaced review. Clean first attempts remain history instead of growing the review queue.
- Saved-decision retries are assessed, not marked successful merely for playing a legal move. Existing explanation/context is retained in subsequent review events.
- PGN parsing and review remain entirely on-device.

The puzzle snapshot and filters are recorded in [`public/data/puzzle-manifest.json`](public/data/puzzle-manifest.json).

### Next priority: better explanations

The next development priority is validated chess reasoning, not more menus or more fluent generic prose:

1. Contrast the played move with a sound alternative: what changed, what the opponent can exploit, and how the alternative addresses it.
2. Broaden evidence to hanging pieces, pins, overloaded defenders, discovered attacks, and missed threats, with legal counterexamples and sacrifice checks.
3. Add structure-aware teaching rules for development, king safety, fianchetto bishops, central tension, and pawn-break timing; each rule needs prerequisites and exceptions.
4. Evaluate explanation accuracy and usefulness on fixed tactical, quiet, defensive, opening, and endgame positions. Track unsupported claims, useful coverage, and latency.

These are future explanation-engine improvements, not capabilities claimed by the simplified interface.

## Architecture

- `src/`: React UI, board interaction, local navigation, and PWA registration.
- `lib/curriculum.ts`: authored opening modules, branches, essentials, model-game summaries, and recall prompts.
- `lib/puzzles.ts` and `lib/chess.ts`: starter tactics, legal-move handling, and Lichess puzzle semantics.
- `lib/learning.ts`: session planning, scoring, and mastery rules.
- `lib/storage.ts`: Dexie/IndexedDB persistence, FSRS review state, and JSON backup/restore.
- `lib/pgn.ts`: local PGN parsing and repertoire matching.
- `lib/game-review.ts`: multi-game imports, legal replay, repertoire coverage, first-departure detection, and critical-moment nomination.
- `lib/engine.ts` and `public/stockfish-engine.worker.js`: browser-only UCI engine adapter.
- `lib/coaching.ts`: forced-root move comparisons, cautious grading, and replay-verified explanations.
- `lib/coached-game.ts`: opening scenarios, history-preserving full games, outcomes, PGN export, and validated autosave.
- `lib/evaluation.ts` and `src/EvaluationBar.tsx`: White-perspective position scores and a cancellable, shared-worker evaluation rail.
- `src/CoachedPlay.tsx` and `src/TrainingBoard.tsx`: coached-game UI and shared interactive board.
- `src/CoachPractice.tsx` and `lib/coach-practice.ts`: bounded optional puzzle practice and saved-decision retries.
- `lib/navigation.ts`: the game-first home screen and legacy bookmark compatibility.
- `public/data/`: the bundled Lichess puzzle snapshot and provenance manifest.
- `public/engine/`: Stockfish.js JavaScript/WASM artifacts and its GPLv3 license text.
- `public/sw.js`: same-origin production asset cache for offline use.

There is no server component. Vite serves static files during development and produces static files for local preview. The app does not require Sites, Cloudflare, a database server, or any other hosted backend.

## Local data and privacy

Study state is stored in the browser's IndexedDB database named `kings-study`. Clearing site data removes it. Use Settings → Download JSON backup before clearing browser data or moving to another browser/device; restore merges validated review data locally.

The app makes no training-data uploads. Same-origin requests load only the static app assets. External attribution and source-game links open only when you choose them.

## Licensing and provenance

Project-authored code and content are licensed under **GPL-3.0-or-later**; see [`LICENSE`](LICENSE). Stockfish remains under its own GPLv3 terms, and the Lichess puzzle snapshot is CC0-1.0.

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for exact Stockfish corresponding-source links, puzzle provenance, artifact checksums, and direct dependency licenses. The app also ships a plain-text copy at `public/THIRD_PARTY_NOTICES.txt` for in-app access.
