import { Chess, type Color } from "chess.js";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { StockfishClient } from "../lib/engine";
import { savedPracticeDecision } from "../lib/coach-practice";
import { parseAndReviewPgn, type LocalGameReview, type ReviewCandidate } from "../lib/game-review";
import { appViewPath, resolveAppView, type AppView } from "../lib/navigation";
import { clearLocalData, exportBackup, getChessTrainerDb, getSetting, putSetting, putTrainingAttempt, restoreBackup, reviewCard } from "../lib/storage";
import type { EngineAnalysis, JsonValue } from "../lib/types";
import { TrainingBoard } from "./TrainingBoard";
import { CoachedPlay, type CoachedSetupDraft } from "./CoachedPlay";
import { CoachPractice, type PracticeRequest } from "./CoachPractice";
import "./simple-app.css";

type LearnerProfile = {
  rating: number;
  tacticsRating: number;
  timeControl: string;
  orientation: "white" | "black";
  dailyMinutes: number;
  createdAt: string;
};

type OfflineStatus = {
  online: boolean;
  persistent: boolean | null;
  serviceWorkerReady: boolean;
};

function asProfile(value: JsonValue | undefined): LearnerProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, JsonValue>;
  if (typeof record.rating !== "number" || typeof record.timeControl !== "string") return null;
  return {
    rating: record.rating,
    tacticsRating: typeof record.tacticsRating === "number" ? record.tacticsRating : record.rating,
    timeControl: record.timeControl,
    orientation: record.orientation === "black" ? "black" : "white",
    dailyMinutes: typeof record.dailyMinutes === "number" ? record.dailyMinutes : 30,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date().toISOString(),
  };
}

function profileJson(profile: LearnerProfile): JsonValue {
  return { ...profile } as unknown as JsonValue;
}

function makeId(prefix: string): string {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

function moveLabel(fen: string, uci: string): string {
  try {
    const board = new Chess(fen);
    const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? "q" });
    return move.san;
  } catch {
    return uci;
  }
}

function scoreLabel(analysis: EngineAnalysis, learnerColor: Color): string {
  const score = analysis.lines[0]?.score;
  if (!score) return "Evaluation unavailable";
  const learnerFactor = analysis.perspective === learnerColor ? 1 : -1;
  if (score.type === "mate") {
    const value = score.value * learnerFactor;
    return value > 0 ? `Mate in ${Math.abs(value)}` : `Facing mate in ${Math.abs(value)}`;
  }
  const pawns = (score.value * learnerFactor) / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)} for you`;
}

function useOfflineStatus(): OfflineStatus {
  const [status, setStatus] = useState<OfflineStatus>({ online: navigator.onLine, persistent: null, serviceWorkerReady: Boolean(navigator.serviceWorker?.controller) });
  useEffect(() => {
    const updateOnline = () => setStatus((current) => ({ ...current, online: navigator.onLine }));
    const updateWorker = () => setStatus((current) => ({ ...current, serviceWorkerReady: Boolean(navigator.serviceWorker?.controller) }));
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    navigator.serviceWorker?.addEventListener("controllerchange", updateWorker);
    void navigator.storage?.persisted?.().then((persistent) => setStatus((current) => ({ ...current, persistent }))).catch(() => undefined);
    void navigator.serviceWorker?.getRegistration().then((registration) => {
      if (registration?.active) setStatus((current) => ({ ...current, serviceWorkerReady: true }));
    }).catch(() => undefined);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
      navigator.serviceWorker?.removeEventListener("controllerchange", updateWorker);
    };
  }, []);
  return status;
}

function useDueReview(refreshKey: number) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      const db = getChessTrainerDb();
      if (!db) return false;
      const [cards, events] = await Promise.all([
        db.reviewCards.where("kind").equals("custom").filter((card) => card.due.getTime() <= Date.now()).sortBy("due"),
        db.reviewEvents.toArray(),
      ]);
      return cards.some((card) => Boolean(savedPracticeDecision(card, events)));
    }
    void load().then((value) => { if (active) setAvailable(value); }).catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, [refreshKey]);
  return available;
}

function AppShell({ view, inPractice, onNavigate, children }: { view: AppView; inPractice: boolean; onNavigate: (view: AppView) => void; children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  function navigate(next: AppView) {
    if (menu.current) menu.current.open = false;
    onNavigate(next);
  }
  return <div className="app-shell simple-app">
    <header className="topbar">
      <a className="brand" href="/" onClick={(event) => { event.preventDefault(); navigate("play"); }}><span className="brand-mark">K</span><span>King&apos;s Study</span></a>
      {view !== "play" || inPractice ? <a className="return-to-play" href="/" onClick={(event) => { event.preventDefault(); navigate("play"); }}>← Back to game</a> : <span className="app-tagline">One board. Your coach.</span>}
      <details className="utility-menu" ref={menu}>
        <summary onKeyDown={(event) => { if (event.key === "Escape" && menu.current) menu.current.open = false; }}>Menu</summary>
        <nav aria-label="Utilities">
          <a href="/import" onClick={(event) => { event.preventDefault(); navigate("import"); }}>Review a PGN</a>
          <a href="/settings" onClick={(event) => { event.preventDefault(); navigate("settings"); }}>Settings &amp; backup</a>
        </nav>
      </details>
    </header>
    <main className="page-shell">{children}</main>
  </div>;
}

function Onboarding({ onComplete }: { onComplete: (profile: LearnerProfile) => Promise<void> }) {
  const [rating, setRating] = useState(1200);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <main className="simple-onboarding">
    <span className="brand-mark">K</span>
    <p className="eyebrow">PIRC · KID · KIA</p>
    <h1>Your chess game.<br />With a coach.</h1>
    <p>Play your favourite openings. Understand important decisions. Try again when you need to.</p>
    <form onSubmit={(event) => {
      event.preventDefault(); setSaving(true); setError("");
      void onComplete({ rating, tacticsRating: rating, timeControl: "15+10 rapid", orientation: "white", dailyMinutes: 30, createdAt: new Date().toISOString() })
        .catch(() => { setError("Could not save your profile. Please try again."); setSaving(false); });
    }}>
      <label htmlFor="rating">Your approximate rapid rating</label>
      <input id="rating" type="number" min="600" max="2400" step="1" required value={rating} onChange={(event) => setRating(Number(event.target.value))} />
      <p className="quiet-note">Not sure? Start at 1200. You can change this later. No diagnostic test.</p>
      <button className="primary-action" disabled={saving} type="submit">{saving ? "Saving…" : "Let's play"}<span>→</span></button>
      {error ? <p role="alert" className="error-text">{error}</p> : null}
    </form>
    <small>Local and offline-capable. No account or uploads.</small>
  </main>;
}

const REVIEW_TITLES: Record<ReviewCandidate["classification"], string> = {
  opening: "First repertoire decision",
  tactic: "Forcing decision",
  strategy: "Plan-selection decision",
  endgame: "Endgame technique",
};

function ReviewView({ profile, onRecorded }: { profile: LearnerProfile; onRecorded: () => void }) {
  const [pgn, setPgn] = useState("");
  const [reviews, setReviews] = useState<LocalGameReview[]>([]);
  const [gameIndex, setGameIndex] = useState(0);
  const [learnerColor, setLearnerColor] = useState<Color>(profile.orientation === "white" ? "w" : "b");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [retryMove, setRetryMove] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<EngineAnalysis | null>(null);
  const [engineStatus, setEngineStatus] = useState<"idle" | "working" | "unavailable">("idle");
  const engine = useRef<StockfishClient | null>(null);
  useEffect(() => () => engine.current?.dispose(), []);

  function importGame() {
    try {
      const parsed = parseAndReviewPgn(pgn, { learnerColor });
      setReviews(parsed);
      setGameIndex(0);
      setSelected(0);
      setRetryMove(null);
      setAnalysis(null);
      setError(null);
      void putSetting("lastImportedPgn", pgn);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The PGN could not be read.");
      setReviews([]);
    }
  }

  async function analyzeMoment(moment: ReviewCandidate) {
    setEngineStatus("working"); setAnalysis(null);
    engine.current ??= new StockfishClient();
    try { const result = await engine.current.analyze(moment.fen, { nodes: 25_000, multiPv: 2, timeoutMs: 20_000 }); setAnalysis(result); setEngineStatus("idle"); }
    catch { setEngineStatus("unavailable"); }
  }

  async function markReviewed(game: LocalGameReview, moment: ReviewCandidate) {
    const now = new Date();
    await Promise.all([
      reviewCard(`game:${moment.id}`, retryMove ? 3 : 2, { itemId: moment.id, kind: "custom", source: "game-review", context: { classification: moment.classification, fen: moment.fen, playedMove: moment.playedMove, playedSan: moment.playedSan, rationale: moment.rationale, learnerColor: game.game.importedGame.learnerColor ?? learnerColor } }),
      putTrainingAttempt({ id: makeId("attempt"), itemId: moment.id, kind: "custom", startedAt: now, finishedAt: new Date(), outcome: "solved", durationMs: 0, metadata: { activity: "game-review", classification: moment.classification, importedGameId: game.game.importedGame.id, fen: moment.fen } }),
    ]).catch(() => undefined);
    onRecorded();
  }

  if (!reviews.length) return (
    <section className="content-page review-import"><header className="page-heading"><div><p className="eyebrow">OPTIONAL · LOCAL ONLY</p><h1>Review a PGN</h1><p>Paste or choose one or more PGNs. Comments and variations stay local and every main line is checked for legality.</p></div><div className="privacy-seal">LOCAL<br />PGN</div></header><div className="import-grid"><div><label htmlFor="pgn">Paste PGN games</label><textarea id="pgn" value={pgn} onChange={(event) => setPgn(event.target.value)} placeholder={'[Event "Training game"]\n[White "You"]\n[Black "Opponent"]\n\n1. Nf3 d5 2. g3 Nf6 3. Bg2 e6 ...'} /><div className="import-options"><label htmlFor="learner-color">I played</label><select id="learner-color" value={learnerColor} onChange={(event) => setLearnerColor(event.target.value as Color)}><option value="w">White</option><option value="b">Black</option></select></div><div className="import-actions"><label className="secondary-action file-action">Choose .pgn<input type="file" accept=".pgn,text/plain" multiple onChange={(event) => { const files = [...(event.target.files ?? [])]; if (files.length) Promise.all(files.map((file) => file.text())).then((texts) => setPgn(texts.join("\n\n"))).catch(() => setError("The file could not be read.")); }} /></label><button className="primary-action inline" disabled={!pgn.trim()} onClick={importGame}>Review locally <span>→</span></button></div>{error ? <p className="error-text">{error}</p> : null}</div><aside><p className="step-count">WHAT THE APP LOOKS FOR</p><ol><li><span>01</span><div><strong>Your first unfamiliar decision</strong><p>Where the game stopped matching a position you trained.</p></div></li><li><span>02</span><div><strong>Up to three critical moments</strong><p>Retry before any Stockfish line becomes visible.</p></div></li><li><span>03</span><div><strong>One useful review card</strong><p>Opening recall, tactic, strategic plan, or endgame.</p></div></li></ol><p className="engine-note">Stockfish is optional and lazy. It returns evaluations and moves—not invented coaching prose.</p></aside></div></section>
  );

  const game = reviews[gameIndex] ?? reviews[0];
  const moment = game.candidates[selected];
  const playedMove = moment ? game.game.moves[moment.ply - 1] : undefined;
  const reviewColor = game.game.importedGame.learnerColor ?? learnerColor;
  return (
    <section className="content-page">
      <header className="page-heading compact"><div><p className="eyebrow">{game.game.summary.totalPlies} plies · {game.coverage.matchedPromptIds.length} trained positions</p><h1>{game.game.summary.title}</h1><p>{game.coverage.firstDeparture ? `First repertoire departure: ${game.coverage.firstDeparture.playedSan} on move ${Math.ceil(game.coverage.firstDeparture.ply / 2)}.` : "No meaningful departure was found in a trained decision position."}</p></div><button className="secondary-action" onClick={() => { setReviews([]); setAnalysis(null); setRetryMove(null); }}>Import another</button></header>
      {reviews.length > 1 ? <div className="view-switch" aria-label="Imported games">{reviews.map((review, index) => <button type="button" className={gameIndex === index ? "selected" : ""} key={review.game.importedGame.id} onClick={() => { setGameIndex(index); setSelected(0); setRetryMove(null); setAnalysis(null); }}>{index + 1}. {review.game.summary.title}</button>)}</div> : null}
      {moment && playedMove ? <div className="review-layout"><section className="board-panel"><div className="board-wrap"><TrainingBoard fen={moment.fen} orientation={profile.orientation} onMove={(uci) => { try { const board = new Chess(moment.fen); board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? "q" }); setRetryMove(uci); return true; } catch { return false; } }} disabled={Boolean(retryMove)} label={REVIEW_TITLES[moment.classification]} /><div className="position-meta"><span className="opening-dot" />Move {Math.ceil(moment.ply / 2)} · {moment.classification}<span className="move-chip">retry first</span></div></div></section><aside className="review-coach"><div className="moment-tabs">{game.candidates.map((item, index) => <button className={selected === index ? "selected" : ""} key={item.id} onClick={() => { setSelected(index); setRetryMove(null); setAnalysis(null); }}>{index + 1}</button>)}</div><p className="step-count">{moment.classification.toUpperCase()} DECISION</p><h2>{REVIEW_TITLES[moment.classification]}</h2><p>{moment.rationale}</p>{retryMove ? <div className="feedback success"><strong>You tried {moveLabel(moment.fen, retryMove)}.</strong><p>The game move was {playedMove.san}. Now compare both with a fixed local engine search.</p></div> : <div className="retry-prompt">Move a piece on the board before revealing the continuation.</div>}{retryMove && !analysis ? <button className="primary-action" disabled={engineStatus === "working"} onClick={() => void analyzeMoment(moment)}>{engineStatus === "working" ? "Stockfish is calculating…" : engineStatus === "unavailable" ? "Engine unavailable" : "Reveal engine line"}<span>→</span></button> : null}{analysis ? <div className="engine-result"><header><strong>{scoreLabel(analysis, reviewColor)}</strong><span>{analysis.lines[0]?.depth ? `depth ${analysis.lines[0].depth}` : `${analysis.elapsedMs.toFixed(0)} ms`}</span></header><p>Best move: <b>{analysis.bestMove ? moveLabel(moment.fen, analysis.bestMove) : "none"}</b></p><code>{analysis.lines[0]?.pv.slice(0, 6).join(" ")}</code><button className="secondary-action" onClick={() => void markReviewed(game, moment)}>Save as review card</button></div> : null}</aside></div> : <div className="center-state"><h2>No critical moments were generated.</h2><p>The PGN is legal, but too short or quiet for a useful three-moment review.</p></div>}
    </section>
  );
}

function SettingsView({ profile, offlineStatus, onProfile, onReset }: { profile: LearnerProfile; offlineStatus: OfflineStatus; onProfile: (profile: LearnerProfile) => void; onReset: () => void }) {
  const [message, setMessage] = useState("");
  const [engine, setEngine] = useState<"unchecked" | "checking" | "ready" | "unavailable">("unchecked");
  async function save(next: LearnerProfile) { onProfile(next); await putSetting("profile", profileJson(next)).catch(() => undefined); setMessage("Settings saved on this device."); }
  async function downloadBackup() { try { const json = await exportBackup(); const url = URL.createObjectURL(new Blob([json], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `kings-study-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); setMessage("Backup downloaded."); } catch { setMessage("A backup could not be created in this browser."); } }
  async function restoreFile(file?: File) { if (!file) return; try { await restoreBackup(await file.text(), { mode: "merge" }); setMessage("Backup restored. Reloading progress…"); window.setTimeout(() => window.location.reload(), 500); } catch { setMessage("That file is not a valid King's Study backup."); } }
  async function requestPersistence() { try { const granted = await navigator.storage?.persist?.(); setMessage(granted ? "Persistent storage is enabled for this browser." : "The browser kept storage in best-effort mode; keep regular backups."); } catch { setMessage("This browser could not change its storage policy."); } }
  return (
    <section className="content-page settings-page"><header className="page-heading"><div><p className="eyebrow">ON-DEVICE BY DESIGN</p><h1>Settings & backup</h1><p>No account or synchronization. Export a backup before clearing browser data or moving devices.</p></div><div className="offline-badge"><span className={offlineStatus.online ? "online" : ""} />{!offlineStatus.online ? "Offline mode" : offlineStatus.serviceWorkerReady ? "Offline assets installed" : "Production install pending"}</div></header><div className="settings-grid"><section><p className="step-count">YOUR PREFERENCES</p><div className="setting-row"><div><strong>Rapid rating</strong><small>Starting level for optional practice</small></div><input aria-label="Rapid rating" type="number" min="600" max="2400" value={profile.rating} onChange={(event) => { const rating = Number(event.target.value); void save({ ...profile, rating, tacticsRating: rating }); }} /></div><div className="setting-row"><div><strong>Board perspective</strong><small>For imported reviews; coached games face your pieces</small></div><select aria-label="Board perspective" value={profile.orientation} onChange={(event) => void save({ ...profile, orientation: event.target.value as "white" | "black" })}><option value="white">White</option><option value="black">Black</option></select></div></section><section><p className="step-count">BACKUP & RESTORE</p><div className="backup-box"><h3>Progress is local</h3><p>The export includes review cards, immutable review events, attempts, settings, and content manifests.</p><button className="primary-action inline" onClick={() => void downloadBackup()}>Download JSON backup <span>↓</span></button><label className="secondary-action file-action">Restore or merge<input type="file" accept="application/json,.json" onChange={(event) => void restoreFile(event.target.files?.[0])} /></label></div><div className="setting-row"><div><strong>Browser storage</strong><small>{offlineStatus.persistent ? "Protected from routine browser eviction" : "Best-effort; keep JSON backups"}</small></div><button className="text-button" disabled={offlineStatus.persistent === true} onClick={() => void requestPersistence()}>{offlineStatus.persistent ? "persistent" : "request persistence"}</button></div><div className="setting-row"><div><strong>Local Stockfish 18</strong><small>Lazy, single-threaded, GPLv3</small></div><button className="text-button" disabled={engine === "checking"} onClick={() => { setEngine("checking"); const client = new StockfishClient(); client.initialize().then((ready) => { setEngine(ready ? "ready" : "unavailable"); client.dispose(); }).catch(() => setEngine("unavailable")); }}>{engine === "unchecked" ? "Check engine" : engine}</button></div></section><section className="license-panel"><p className="step-count">DATA & LICENSES</p><h3>Open, inspectable ingredients.</h3><ul><li><a href="/engine/COPYING.txt" target="_blank">Stockfish.js 18 · GPLv3</a></li><li><a href="https://database.lichess.org/#puzzles" target="_blank" rel="noreferrer">Lichess puzzle database · CC0</a></li><li><a href="/THIRD_PARTY_NOTICES.txt" target="_blank">Third-party notices</a></li></ul><button className="danger-button" onClick={() => { if (window.confirm("Delete all local training progress from this browser? Export a backup first if you may want it later.")) { clearLocalData().then(onReset).catch(() => setMessage("Local data could not be cleared.")); } }}>Clear all local data</button></section></div>{message ? <div className="toast" role="status">{message}</div> : null}</section>
  );
}

export function App() {
  const offlineStatus = useOfflineStatus();
  const [view, setView] = useState<AppView>(() => resolveAppView(window.location.pathname));
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [practice, setPractice] = useState<PracticeRequest | null>(null);
  const practiceLeaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const gameLeaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [setupDraft, setSetupDraft] = useState<CoachedSetupDraft | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const hasDueReview = useDueReview(refreshKey);

  useEffect(() => {
    let active = true;
    void getSetting<JsonValue>("profile").then((value) => { if (active) setProfile(asProfile(value)); }).finally(() => { if (active) setReady(true); }).catch(() => undefined);
    // Bookmarks to old learning pages keep working, but open the new game-first UI.
    window.history.replaceState({}, "", appViewPath(resolveAppView(window.location.pathname)));
    const pop = () => {
      const next = resolveAppView(window.location.pathname);
      void (async () => {
        if (next === "play" && gameLeaveRef.current && !practiceLeaveRef.current) {
          window.history.replaceState({}, "", appViewPath(next));
          return;
        }
        const leave = practiceLeaveRef.current ?? gameLeaveRef.current;
        if (leave && !await leave()) { window.history.replaceState({}, "", "/"); return; }
        window.history.replaceState({}, "", appViewPath(next));
        setView(next); setPractice(null);
      })();
    };
    window.addEventListener("popstate", pop);
    return () => { active = false; window.removeEventListener("popstate", pop); };
  }, []);

  const navigate = useCallback((next: AppView) => {
    void (async () => {
      const path = appViewPath(next);
      // Clicking the brand on the playing screen is not a departure; avoid
      // cancelling an in-progress opponent turn for a no-op navigation.
      if (window.location.pathname === path && !practiceLeaveRef.current) return;
      const leave = practiceLeaveRef.current ?? gameLeaveRef.current;
      if (leave && !await leave()) return;
      if (window.location.pathname !== path) window.history.pushState({}, "", path);
      setPractice(null); setView(next); window.scrollTo({ top: 0, behavior: "instant" });
    })();
  }, []);

  const recorded = () => setRefreshKey((value) => value + 1);
  function closePractice() { setPractice(null); recorded(); window.scrollTo({ top: 0, behavior: "instant" }); }
  async function openPractice(request: PracticeRequest) {
    const leave = gameLeaveRef.current;
    if (leave && !await leave()) return;
    setPractice(request); window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function completeOnboarding(nextProfile: LearnerProfile) {
    await putSetting("profile", profileJson(nextProfile));
    setProfile(nextProfile);
    if (navigator.storage?.persist) void navigator.storage.persist().catch(() => undefined);
  }

  if (!ready) return <div className="center-state fullscreen"><div className="spinner" /><h2>Opening your game…</h2></div>;
  if (!profile) return <Onboarding onComplete={completeOnboarding} />;

  let content: ReactNode;
  if (view === "settings") content = <SettingsView profile={profile} offlineStatus={offlineStatus} onProfile={setProfile} onReset={() => { setProfile(null); setSetupDraft(null); setSetupOpen(false); recorded(); navigate("play"); }} />;
  else if (view === "import") content = <ReviewView profile={profile} onRecorded={recorded} />;
  else if (practice) content = <CoachPractice rating={profile.tacticsRating} request={practice} onClose={closePractice} onRecorded={recorded} leaveRef={practiceLeaveRef} />;
  else content = <CoachedPlay rating={profile.rating} onRecorded={recorded} hasDueReview={hasDueReview} leaveRef={gameLeaveRef} setupDraft={setupDraft} onSetupDraftChange={setSetupDraft} setupOpen={setupOpen} onSetupOpenChange={setSetupOpen} onRevisit={() => void openPractice({ kind: "revisit" })} onPractice={(assessment, family) => void openPractice({ kind: "puzzles", assessment, family })} />;

  return <AppShell view={view} inPractice={Boolean(practice)} onNavigate={navigate}>{content}</AppShell>;
}
