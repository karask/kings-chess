import { Chess, type Move } from "chess.js";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { TrainingBoard } from "./TrainingBoard";
import { EvaluationBar } from "./EvaluationBar";
import { StockfishClient } from "../lib/engine";
import { assessMove, explainMove, type MoveAssessment } from "../lib/coaching";
import { buildCoachingWalkthrough } from "../lib/coaching-walkthrough";
import { CoachWalkthrough } from "./CoachWalkthrough";
import { RetryActions } from "./RetryActions";
import {
  COACHED_SCENARIOS, appendGameMove, createCoachedGame, gameBoard, gamePgn,
  gameResult, loadCoachedGame, opponentBookMove, saveCoachedGame, canTakeBack, takeBackTurn, continueFromRetry, switchSavedLine, type CoachedGame,
} from "../lib/coached-game";
import { openingModules, openingRecallPrompts, type OpeningFamily } from "../lib/curriculum";
import { canonicalEpd, parseUciMove } from "../lib/chess";
import { putTrainingAttempt, reviewCard } from "../lib/storage";
import { flushPendingSaves } from "../lib/save-guard";
import "./coached-simple.css";

type Decision = CoachedGame["assessments"][number];
type Exploration = {
  decision: Decision; line: "played" | "best"; step: number;
  /** Full game history before an experimental move, including earlier branches. */
  prefix?: string[];
  parent?: Exploration;
};
export type CoachedSetupDraft = Pick<CoachedGame, "family" | "scenarioId" | "startMode" | "skillLevel" | "coaching">;
const BAD_MOVES = new Set(["inaccuracy", "mistake", "blunder"]);
const PRACTICE_EVIDENCE = new Set(["knight-fork", "checkmate", "material"]);

function hasPracticePattern(assessment: MoveAssessment) {
  return BAD_MOVES.has(assessment.classification) && assessment.evidence.some((item) => PRACTICE_EVIDENCE.has(item.kind));
}

function nextGameFocus(decision: Decision | undefined): string {
  const evidence = decision?.assessment.evidence;
  if (evidence?.some((item) => item.kind === "knight-fork")) return "Before committing, check which two pieces an enemy knight could attack at once.";
  if (evidence?.some((item) => item.kind === "checkmate")) return "Before moving, look for forcing checks for both sides and make sure your king has an escape.";
  if (evidence?.some((item) => item.kind === "material")) return "Before committing, calculate your opponent’s strongest capture and your recapture. Count what remains.";
  return "Before each move, ask what your opponent is threatening, then compare two candidates.";
}

function linePosition(fen: string, line: string[], step: number) {
  const board = new Chess(fen);
  const sans: string[] = [];
  for (const move of line) {
    try { sans.push(board.move(parseUciMove(move)).san); } catch { break; }
  }
  const preview = new Chess(fen);
  for (const move of line.slice(0, Math.min(step, sans.length))) preview.move(parseUciMove(move));
  return { fen: preview.fen(), sans };
}

function exportGame(game: CoachedGame) {
  const url = URL.createObjectURL(new Blob([gamePgn(game)], { type: "application/x-chess-pgn" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `kings-study-${game.family}-${game.createdAt.slice(0, 10)}.pgn`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function MoveHistory({ game, moves, visibleFeedback, canExplore, viewedPly, onView, onExplore }: {
  game: CoachedGame; moves: Move[]; visibleFeedback: boolean; canExplore: boolean; viewedPly: number; onView: (ply: number) => void; onExplore: (decision: Decision) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [moves.length]);
  const rows: Array<{ number: number; white?: { move: Move; ply: number }; black?: { move: Move; ply: number } }> = [];
  moves.forEach((move, index) => {
    const number = Number(move.before.split(" ")[5]);
    if (rows.at(-1)?.number !== number) rows.push({ number });
    rows.at(-1)![move.color === "w" ? "white" : "black"] = { move, ply: index + 1 };
  });
  const cell = (entry: { move: Move; ply: number } | undefined) => {
    if (!entry) return <span className="history-empty">—</span>;
    const decision = game.assessments.find((item) => item.ply === entry.ply);
    return <><button className="history-san" aria-current={viewedPly === entry.ply ? "step" : undefined} title={`View position after ${entry.move.san}`} onClick={() => onView(entry.ply)}>{entry.move.san}</button>{decision && visibleFeedback ? <button className="history-grade" title={`Explore ${entry.move.san}: ${decision.assessment.classification}`} disabled={!canExplore} onClick={() => onExplore(decision)}>{decision.assessment.classification}</button> : null}</>;
  };
  return <section className="coached-history" aria-label="Move history">
    <h2>Move history</h2>
    <div className="coached-history-scroll" ref={scroll}>
      {rows.length ? <table><thead><tr><th scope="col"><span className="sr-only">Move number</span></th><th scope="col">White</th><th scope="col">Black</th></tr></thead><tbody>{rows.map((row) => <tr key={row.number}><th scope="row">{row.number}.</th><td>{cell(row.white)}</td><td>{cell(row.black)}</td></tr>)}</tbody></table> : <p>No moves yet.</p>}
    </div>
  </section>;
}

function BoardMenu({ game }: { game: CoachedGame }) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.current?.contains(event.target as Node)) {
        if (menu.current) menu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  return <details className="coached-board-menu" ref={menu}>
    <summary aria-label="Game tools" title="Game tools"><span aria-hidden="true">⋮</span></summary>
    <div className="coached-board-menu-content">
      <button className="text-button" onClick={() => { exportGame(game); if (menu.current) menu.current.open = false; }}>Download PGN</button>
      <details className="coached-ratings"><summary>Score info</summary>
        <p>The evaluation bar uses White’s perspective: + favors White, − favors Black. M means forced mate. The bar follows the position on the board; its fill is an estimate, not a win probability.</p>
        <p>Best is the engine’s first choice. Labels measure the estimated loss from that choice: Excellent ≤0.15 pawns, Good ≤0.50, Inaccuracy ≤1.00, Mistake ≤2.00, Blunder &gt;2.00. Uncertain comparisons are Unrated; mate is handled separately.</p>
        <p>Coach comparisons use your perspective. A negative position can still contain an excellent move. Evaluation stays hidden during after-game coaching until the game ends.</p>
      </details>
    </div>
  </details>;
}

function Assessment({ assessment: savedAssessment, family }: { assessment: MoveAssessment; family: OpeningFamily }) {
  const assessment = useMemo(() => ({ ...savedAssessment, ...explainMove({ ...savedAssessment, family }) }), [savedAssessment, family]);
  const scoreText = (score: MoveAssessment["bestScore"]) => !score ? "Unavailable" : score.type === "mate" ? `Mate ${score.value > 0 ? "for you" : "against you"} in ${Math.abs(score.value)}` : `${score.value >= 0 ? "+" : ""}${(score.value / 100).toFixed(2)}`;
  // Lead with one authored sentence, without clipping chess notation or inventing
  // a shorter causal claim. The complete explanation remains one disclosure away.
  const sentenceEnd = assessment.explanation.search(/[.!?](?=\s+[A-Z])/);
  const mechanism = assessment.evidence.find((item) => item.line === "played" && ["hanging-piece", "defender", "pin", "discovered-attack", "fork", "knight-fork", "defense"].includes(item.kind));
  const alternative = assessment.evidence.find((item) => item.line === "best" && item.kind === "defense");
  const brief = mechanism?.text ?? (assessment.explanation.length > 180 && sentenceEnd >= 0
    ? assessment.explanation.slice(0, sentenceEnd + 1) : assessment.explanation);
  return <div className={`move-assessment grade-${assessment.classification}`}>
    <div className="assessment-heading"><span className="move-grade">{assessment.classification}</span><strong>{assessment.playedSan}</strong></div>
    {assessment.title.toLowerCase() !== assessment.classification ? <h3>{assessment.title}</h3> : null}
    <p>{brief}</p>
    {alternative ? <p className="assessment-alternative"><strong>Why {assessment.bestSan} helps:</strong> {alternative.text}</p> : null}
    {assessment.confidence === "limited" ? <small>A concrete explanation has not yet been established; this is a bounded engine assessment.</small> : null}
    <details className="assessment-detail"><summary>More context & analysis</summary>
      {brief !== assessment.explanation ? <p>{assessment.explanation}</p> : null}
      {assessment.bestMove !== assessment.playedMove ? <p>Compare with <strong>{assessment.bestSan}</strong>. Other sound moves can also be good.</p> : null}
      {assessment.authoredContext ? <><h4>Exact-position opening lesson</h4><p>{assessment.authoredContext}</p></> : null}
      {assessment.strategicContext ? <><h4>Structure guidance — not a proven cause</h4><p>{assessment.strategicContext}</p></> : null}
      <h4>Engine comparison</h4><p>Preferred move: {scoreText(assessment.bestScore)}. Your move: {scoreText(assessment.playedScore)}.{assessment.lossCp !== undefined ? ` Estimated loss: ${(assessment.lossCp / 100).toFixed(2)}.` : ""}</p><p>Both scores are from your perspective. Fixed-budget searches use their last completed, comparable iteration; they are estimates, not a proof of optimal play.</p>
      <small>{assessment.confidence === "verified" ? "Explanation supported by a checked continuation or authored position." : "Limited explanation: engine preference is not a complete strategic proof."}</small>
    </details>
  </div>;
}

function GameSetup({ rating, current, onStart, onCancel, onPractice, onRevisit, hasDueReview, setupDraft, onSetupDraftChange }: {
  rating: number; current: CoachedGame | null; onStart: (game: CoachedGame) => void; onCancel: () => void;
  onPractice?: (assessment?: MoveAssessment, family?: OpeningFamily) => void;
  onRevisit?: () => void; hasDueReview?: boolean;
  setupDraft?: CoachedSetupDraft | null; onSetupDraftChange?: (draft: CoachedSetupDraft) => void;
}) {
  const [draft, setDraft] = useState<CoachedSetupDraft>(() => setupDraft ?? {
    family: current?.family ?? "pirc",
    scenarioId: current?.scenarioId ?? COACHED_SCENARIOS.find((s) => s.family === "pirc")!.id,
    startMode: current?.startMode ?? "start",
    skillLevel: current?.skillLevel ?? (rating < 1200 ? 0 : rating < 1500 ? 3 : 6),
    coaching: current?.coaching ?? "critical",
  });
  const { family, scenarioId, startMode, skillLevel, coaching } = draft;
  function updateDraft(changes: Partial<CoachedSetupDraft>) {
    const next = { ...draft, ...changes };
    setDraft(next); onSetupDraftChange?.(next);
  }
  const [replace, setReplace] = useState(false);
  const hasGame = Boolean(current?.moves.length);
  const scenarios = COACHED_SCENARIOS.filter((s) => s.family === family);
  return <section className="coached-setup simple-game-setup">
    <header><p className="eyebrow">YOUR BOARD. YOUR COACH.</p><h1>Learn by playing.</h1><p>Choose your opening. Play a game. Understand the moments that matter.</p></header>
    <form onSubmit={(event) => { event.preventDefault(); onStart(createCoachedGame({ family, scenarioId, startMode, skillLevel, coaching })); }}>
      <fieldset><legend>Your repertoire</legend><div className="coached-family-choices">{(["pirc", "kid", "kia"] as const).map((value) => <button type="button" key={value} className={family === value ? "selected" : ""} aria-pressed={family === value} onClick={() => updateDraft({ family: value, scenarioId: COACHED_SCENARIOS.find((s) => s.family === value)!.id })}><strong>{value.toUpperCase()}</strong><span>You play {value === "kia" ? "White" : "Black"}</span></button>)}</div></fieldset>
      <details className="coached-game-options"><summary>Game options</summary>
      <label htmlFor="coached-scenario">Opponent setup</label><select id="coached-scenario" value={scenarioId} onChange={(e) => updateDraft({ scenarioId: e.target.value })}>{scenarios.map((s) => <option value={s.id} key={s.id}>{s.label}</option>)}</select>
      <p className="quiet-note">{scenarios.find((s) => s.id === scenarioId)?.description} The book guides the opponent only while the position matches. Deviate freely; Stockfish takes over.</p>
      <div className="coached-setup-columns"><div><label htmlFor="coached-start">Start from</label><select id="coached-start" value={startMode} onChange={(e) => updateDraft({ startMode: e.target.value as "start" | "tabiya" })}><option value="start">Starting position — full game</option><option value="tabiya">Opening position — continue to the end</option></select></div><div><label htmlFor="coached-skill">Opponent difficulty</label><select id="coached-skill" value={skillLevel} onChange={(e) => updateDraft({ skillLevel: Number(e.target.value) })}><option value={0}>Gentle · skill 0</option><option value={3}>Developing · skill 3</option><option value={6}>Challenging · skill 6</option><option value={12}>Strong · skill 12</option><option value={20}>Full strength · skill 20</option></select></div></div>
      <label htmlFor="coached-frequency">When should the coach pause?</label><select id="coached-frequency" value={coaching} onChange={(e) => updateDraft({ coaching: e.target.value as CoachedGame["coaching"] })}><option value="critical">Important moments only</option><option value="every">After every one of my moves</option><option value="after">After the game — no feedback while playing</option></select>
      <p className="quiet-note">Difficulty is a Stockfish skill setting, not a calibrated human Elo. The coach always analyses at full strength. Games are untimed so you can explore.</p>
      </details>
      {hasGame ? <div className="replace-game-note"><button type="button" className="text-button" onClick={() => exportGame(current!)}>Download current game first</button><label><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace the current saved game. My training history stays intact.</label></div> : null}
      <div className="coached-actions"><button className="primary-action" disabled={hasGame && !replace} type="submit">Play<span>→</span></button>{current ? <button className="secondary-action" type="button" onClick={onCancel}>Back to game</button> : null}</div>
      {hasDueReview && onRevisit ? <button className="text-button coached-optional-practice" type="button" onClick={onRevisit}>Optional: revisit a previous mistake →</button> : onPractice ? <button className="text-button coached-optional-practice" type="button" onClick={() => onPractice(undefined, family)}>Optional: two-position warm-up →</button> : null}
    </form>
    <p className="setup-reassurance">Your game saves automatically on this device. The coach explains important moments; <strong>Show why</strong> explores the moves and <strong>Try again</strong> lets you test an idea.</p>
  </section>;
}

export function CoachedPlay({ rating, onRecorded, onPractice, onRevisit, hasDueReview, leaveRef, setupDraft, onSetupDraftChange, setupOpen, onSetupOpenChange }: {
  rating: number; onRecorded: () => void;
  onPractice?: (assessment?: MoveAssessment, family?: OpeningFamily) => void;
  onRevisit?: () => void; hasDueReview?: boolean;
  leaveRef?: RefObject<(() => Promise<boolean>) | null>;
  setupDraft?: CoachedSetupDraft | null; onSetupDraftChange?: (draft: CoachedSetupDraft) => void;
  setupOpen?: boolean; onSetupOpenChange?: (open: boolean) => void;
}) {
  const [game, setGame] = useState<CoachedGame | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [localShowSetup, setLocalShowSetup] = useState(false);
  const showSetup = setupOpen ?? localShowSetup;
  function setShowSetup(open: boolean) { setLocalShowSetup(open); onSetupOpenChange?.(open); }
  const [activity, setActivity] = useState("");
  const [engineFault, setEngineFault] = useState("");
  const [storageFault, setStorageFault] = useState("");
  const [notice, setNotice] = useState("");
  const [exploration, setExploration] = useState<Exploration | null>(null);
  const [historyPly, setHistoryPly] = useState<number | null>(null);
  const [retry, setRetry] = useState<Decision | null>(null);
  const [retryAssessment, setRetryAssessment] = useState<MoveAssessment | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [variationInput, setVariationInput] = useState(false);
  const [variationBusy, setVariationBusy] = useState(false);
  const [variationMove, setVariationMove] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [resignConfirm, setResignConfirm] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [evaluationGeneration, setEvaluationGeneration] = useState(0);
  const gameRef = useRef<CoachedGame | null>(null);
  const engine = useRef<StockfishClient | null>(null);
  const advanceController = useRef<AbortController | null>(null);
  const evaluationController = useRef<AbortController | null>(null);
  const retryController = useRef<AbortController | null>(null);
  const variationController = useRef<AbortController | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const saveFailed = useRef(false);
  const boardShell = useRef<HTMLDivElement>(null);

  const commit = useCallback((next: CoachedGame) => {
    gameRef.current = next;
    setGame(next);
    saveQueue.current = saveQueue.current.then(() => saveCoachedGame(next)).then(() => { saveFailed.current = false; setStorageFault(""); }).catch(() => {
      saveFailed.current = true;
      setStorageFault("Autosave failed. Keep this tab open and download your PGN; you can retry saving below.");
    });
  }, []);

  useEffect(() => {
    let live = true;
    void loadCoachedGame().then((saved) => { if (live) { gameRef.current = saved; setGame(saved); } }).catch((error: unknown) => {
      if (live) setStorageFault(error instanceof Error ? error.message : "Could not restore your game. Your training data has not been changed.");
    }).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; advanceController.current?.abort(); retryController.current?.abort(); variationController.current?.abort(); engine.current?.dispose(); engine.current = null; };
  }, []);

  const board = useMemo(() => game ? gameBoard(game) : null, [game]);
  const result = useMemo(() => game ? gameResult(game) : null, [game]);
  const moveHistory = useMemo(() => board?.history({ verbose: true }) ?? [], [board]);
  const lastPly = game?.moves.length ?? 0;
  const lastIsLearner = Boolean(game && moveHistory.at(-1)?.color === game.learnerColor);
  const pendingAssessment = Boolean(game && lastIsLearner && !game.resigned && !game.assessments.some((a) => a.ply === lastPly) && !game.skippedAssessmentPlies?.includes(lastPly));
  const paused = Boolean(game && game.pausedAtPly === lastPly);
  const hasGame = Boolean(game);
  const isExploring = Boolean(exploration);
  const isRetrying = Boolean(retry);
  const isBrowsing = historyPly !== null;
  const explorationAssessment = exploration?.decision.assessment;
  const explorationLine = exploration?.line;
  const explorationFamily = game?.family;
  // Rebuild explanations from stored legal lines, so older games gain the new
  // teaching layer without rewriting the learner's saved game or reviews.
  const teachingAssessment = useMemo(() => explorationAssessment && explorationFamily ? {
    ...explorationAssessment, ...explainMove({ ...explorationAssessment, family: explorationFamily }),
  } : undefined, [explorationAssessment, explorationFamily]);
  const walkthrough = useMemo(() => teachingAssessment && explorationLine ? buildCoachingWalkthrough(teachingAssessment, explorationLine) : [], [teachingAssessment, explorationLine]);
  const variationHistory = useMemo(() => {
    if (!game || !exploration || !walkthrough.length) return null;
    const moves = [...(exploration.prefix ?? game.moves.slice(0, exploration.decision.ply - 1)), ...walkthrough.slice(1, exploration.step + 1).map((frame) => frame.move!)];
    const board = new Chess(game.initialFen);
    for (const move of moves) board.move(parseUciMove(move));
    return { moves, board };
  }, [game, exploration, walkthrough]);

  useEffect(() => {
    if (!game || showSetup || exploration || retry || isBrowsing || engineFault || game.resigned) return;
    const controller = new AbortController();
    advanceController.current = controller;
    const current = game;
    async function advance() {
      engine.current ??= new StockfishClient();
      if (pendingAssessment) {
        setActivity("Coach is comparing your move…");
        const assessment = await assessMove(engine.current, { initialFen: current.initialFen, moves: current.moves.slice(0, -1), playedMove: current.moves.at(-1)!, family: current.family, signal: controller.signal });
        if (controller.signal.aborted || gameRef.current !== current) return;
        const shouldPause = current.coaching === "every" || (current.coaching === "critical" && BAD_MOVES.has(assessment.classification));
        commit({ ...current, assessments: [...current.assessments, { ply: current.moves.length, assessment }], pausedAtPly: shouldPause ? current.moves.length : undefined, updatedAt: new Date().toISOString() });
      } else if (!paused && !gameResult(current) && gameBoard(current).turn() !== current.learnerColor) {
        const bookMove = opponentBookMove(current);
        setActivity(bookMove ? "Opponent is following the selected opening…" : "Opponent is thinking…");
        let move = bookMove;
        if (!move) {
          const answer = await engine.current.analyze(gameBoard(current).fen(), { history: { initialFen: current.initialFen, moves: current.moves }, skillLevel: current.skillLevel, nodes: 35_000, moveTimeMs: 900, timeoutMs: 25_000, signal: controller.signal });
          move = answer.bestMove;
        } else {
          // Yield once before the authored reply, allowing a new game/unmount to cancel it.
          await Promise.resolve();
        }
        if (controller.signal.aborted || gameRef.current !== current) return;
        if (!move) throw new Error("The engine did not return a legal reply. Retry to continue this game.");
        commit(appendGameMove(current, move));
      }
      if (!controller.signal.aborted) setActivity("");
    }
    void advance().catch((error: unknown) => {
      if (controller.signal.aborted || gameRef.current !== current) return;
      setActivity("");
      setEngineFault(error instanceof Error ? error.message : "The local engine could not finish. Your game is still saved.");
    });
    return () => controller.abort();
  }, [game, pendingAssessment, paused, showSetup, exploration, retry, isBrowsing, engineFault, commit]);

  // Fit the board to both its actual column width and the visible viewport.
  // Explanations scroll independently; they never force the bottom rank offscreen.
  useLayoutEffect(() => {
    const shell = boardShell.current;
    if (!shell) return;
    const resize = () => {
      const parent = shell.parentElement!;
      const top = shell.getBoundingClientRect().top + window.scrollY;
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const mobileNav = Math.max(12, (document.querySelector(".mobile-nav")?.getBoundingClientRect().height ?? 0) + 8);
      const input = shell.querySelector<HTMLElement>(".keyboard-move");
      const footer = shell.querySelector<HTMLElement>(".coached-board-footer");
      const available = viewport - top - mobileNav - (input ? input.offsetHeight + 10 : 0) - (footer ? footer.offsetHeight + 8 : 0) - 12;
      const padding = getComputedStyle(parent);
      const width = parent.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
      // Reserve only the narrow evaluation rail; the square board uses the rest.
      shell.style.setProperty("--coached-board-size", `${Math.max(120, Math.min(width - 44, available))}px`);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(shell.parentElement!);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); };
  }, [loaded, showSetup, hasGame, keyboard, isExploring, isRetrying, isBrowsing]);

  const cancelSearches = useCallback(() => {
    advanceController.current?.abort();
    evaluationController.current?.abort();
    retryController.current?.abort();
    variationController.current?.abort();
    engine.current?.stop();
    setActivity("");
    setRetryBusy(false);
    setVariationInput(false); setVariationBusy(false); setVariationMove(null);
    setEvaluationGeneration((value) => value + 1);
  }, []);

  const viewMove = useCallback((ply: number) => {
    if (!game) return;
    cancelSearches();
    setExploration(null); setRetry(null); setRetryAssessment(null); setResignConfirm(false); setNotice("");
    setHistoryPly(ply >= game.moves.length ? null : Math.max(0, ply));
  }, [game, cancelSearches]);

  const stepMove = useCallback((direction: -1 | 1) => {
    if (!game || retry) return;
    if (exploration) {
      const limit = Math.max(0, walkthrough.length - 1);
      const step = Math.max(0, Math.min(limit, exploration.step + direction));
      if (step !== exploration.step) { cancelSearches(); setExploration({ ...exploration, step }); }
      return;
    }
    const current = historyPly ?? game.moves.length;
    const next = Math.max(0, Math.min(game.moves.length, current + direction));
    if (next !== current) viewMove(next);
  }, [game, retry, exploration, historyPly, viewMove, cancelSearches, walkthrough]);

  useEffect(() => {
    if (!loaded || showSetup || !game) return;
    const navigate = (event: KeyboardEvent) => {
      if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || event.altKey || event.ctrlKey || event.metaKey || retry) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable], .coached-board-menu, .coached-resign-confirm")) return;
      event.preventDefault();
      stepMove(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [loaded, showSetup, game, retry, stepMove]);

  async function prepareToLeave() {
    if (savingReview) { setNotice("Please wait for this decision to finish saving before leaving the game."); return false; }
    if (!await flushPendingSaves(() => saveQueue.current, () => saveFailed.current, cancelSearches)) {
      setNotice("Your latest game is not saved yet. Retry saving before leaving; download its PGN for a separate backup.");
      return false;
    }
    // Only stop the live game once every queued snapshot is durable. Failed
    // navigation must leave the game usable, including an analysis in progress.
    return true;
  }

  useImperativeHandle(leaveRef, () => prepareToLeave);

  function start(next: CoachedGame) {
    cancelSearches();
    setHistoryPly(null); setExploration(null); setRetry(null); setRetryAssessment(null); setEngineFault(""); setNotice(""); setActivity(""); setResignConfirm(false); setShowSetup(false); setFlipped(false);
    window.scrollTo({ top: 0, behavior: "instant" });
    commit(next);
  }

  function playMove(uci: string): boolean {
    if (!game || !board || activity || engineFault || pendingAssessment || paused || exploration || isBrowsing || result || board.turn() !== game.learnerColor) return false;
    try { const next = appendGameMove(game, uci); evaluationController.current?.abort(); commit(next); setNotice(""); return true; } catch { setNotice("That move is not legal in this position."); return false; }
  }

  function takeBack() {
    if (!game || savingReview || !canTakeBack(game)) return;
    const next = takeBackTurn(game);
    cancelSearches();
    setHistoryPly(null); setExploration(null); setRetry(null); setRetryAssessment(null); setEngineFault(""); setResignConfirm(false);
    setNotice(game.moves.length - next.moves.length > 1 ? "Took back your last move and the computer’s reply. Your turn." : "Took back your last move. Your turn.");
    commit(next);
  }

  function tryCandidate(uci: string): boolean {
    if (!retry || !game || retryBusy) return false;
    try { new Chess(retry.assessment.beforeFen).move(parseUciMove(uci)); } catch { setNotice("That candidate is not legal. Try another move."); return false; }
    evaluationController.current?.abort();
    retryController.current?.abort();
    const controller = new AbortController();
    retryController.current = controller;
    engine.current ??= new StockfishClient();
    setRetryBusy(true); setRetryAssessment(null); setNotice("");
    void assessMove(engine.current, { initialFen: game.initialFen, moves: game.moves.slice(0, retry.ply - 1), playedMove: uci, family: game.family, signal: controller.signal }).then((assessment) => {
      if (!controller.signal.aborted) setRetryAssessment(assessment);
    }).catch((error: unknown) => { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not check that candidate. Try again."); }).finally(() => { if (!controller.signal.aborted) setRetryBusy(false); });
    return true;
  }

  function returnToGame() {
    cancelSearches(); setHistoryPly(null); setRetry(null); setRetryAssessment(null); setExploration(null); setNotice("");
  }

  function continueCandidate() {
    if (!game || !retry || !retryAssessment || retryBusy || savingReview) return;
    try {
      const next = continueFromRetry(game, retry.ply, retryAssessment);
      returnToGame(); setEngineFault(""); setResignConfirm(false);
      commit(next);
      setNotice("Continuing from your new move. Your original line is saved below.");
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Could not continue from that move. Your game is unchanged.");
    }
  }

  function restoreComparison() {
    if (!game?.savedLine || savingReview) return;
    const returningToOriginal = game.savedLine.kind === "original";
    try {
      const next = switchSavedLine(game);
      returnToGame(); setEngineFault(""); setResignConfirm(false);
      commit(next);
      setNotice(returningToOriginal ? "Original game restored. Your revised line is still available." : "Revised game restored. Your original line is still available.");
    } catch (error: unknown) {
      setNotice(error instanceof Error ? error.message : "Could not restore that line. Your current game is unchanged.");
    }
  }

  function changeExploration(next: Exploration) {
    cancelSearches(); setNotice(""); setExploration(next);
  }

  function tryVariation(uci: string): boolean {
    if (!game || !exploration || !variationHistory || !variationInput || variationBusy) return false;
    const prefix = [...variationHistory.moves];
    const position = new Chess(game.initialFen);
    try {
      for (const move of prefix) position.move(parseUciMove(move));
      if (position.isGameOver()) return false;
      position.move(parseUciMove(uci));
    } catch { setNotice("That reply is not legal here. Try another move."); return false; }
    evaluationController.current?.abort(); variationController.current?.abort();
    const controller = new AbortController();
    variationController.current = controller;
    engine.current ??= new StockfishClient();
    setVariationBusy(true); setVariationMove(uci); setNotice("");
    const parent = exploration;
    void assessMove(engine.current, { initialFen: game.initialFen, moves: prefix, playedMove: uci, family: game.family, signal: controller.signal }).then((assessment) => {
      if (controller.signal.aborted) return;
      setExploration({ decision: { ply: prefix.length + 1, assessment }, prefix, parent, line: "played", step: 1 });
      setVariationInput(false);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not check this reply. Try again.");
    }).finally(() => {
      if (!controller.signal.aborted) { setVariationBusy(false); setVariationMove(null); }
    });
    return true;
  }

  async function saveDecision(decision: Decision) {
    if (!game || savingReview || (game.reviewSavedPlies?.length ?? 0) >= 3 || game.reviewSavedPlies?.includes(decision.ply)) return;
    const snapshot = game;
    setSavingReview(true);
    const id = `coached:${game.id}:${decision.ply}`;
    try {
      await reviewCard(id, 1, { itemId: id, kind: "custom", source: "coached-game", context: { classification: "strategy", family: game.family, fen: decision.assessment.beforeFen, playedMove: decision.assessment.playedMove, playedSan: decision.assessment.playedSan, rationale: "Find a strong move in this position from your coached game. Check your opponent’s threats before deciding.", explanation: decision.assessment.explanation, learnerColor: game.learnerColor, bestMove: decision.assessment.bestMove, gameId: game.id } });
      const now = new Date();
      await putTrainingAttempt({ id: `attempt:${id}`, itemId: id, kind: "custom", startedAt: now, finishedAt: now, outcome: "failed", durationMs: 0, metadata: { activity: "game-review", importedGameId: game.id, classification: decision.assessment.classification } });
      const current = gameRef.current;
      if (current?.id === snapshot.id) commit({ ...current, reviewSavedPlies: [...(current.reviewSavedPlies ?? []), decision.ply], updatedAt: new Date().toISOString() });
      setNotice("Remembered. The coach can offer this mistake for a short revisit before a later game."); onRecorded();
    } catch { setNotice("Could not save this review. Your game is still available; please try again."); }
    finally { setSavingReview(false); }
  }

  if (!loaded) return <div className="center-state"><p>Restoring your local game…</p></div>;
  if (!game || showSetup) return <div className="content-page coached-page">{storageFault ? <p role="alert" className="error-text">{storageFault}{game ? <button onClick={() => commit(game)}>Retry save</button> : null}</p> : null}<GameSetup rating={rating} current={game} onStart={start} onCancel={() => setShowSetup(false)} onPractice={onPractice} onRevisit={onRevisit} hasDueReview={hasDueReview} setupDraft={setupDraft} onSetupDraftChange={onSetupDraftChange} /></div>;

  const latest = game.assessments.at(-1);
  const viewedPly = Math.min(historyPly ?? game.moves.length, game.moves.length);
  const decision = exploration?.decision ?? retry ?? (isBrowsing ? [...game.assessments].reverse().find((item) => item.ply <= viewedPly) : latest);
  const visibleFeedback = game.coaching !== "after" || Boolean(result);
  const actualFen = board!.fen();
  const replayLine = walkthrough.slice(1).map((frame) => frame.move!);
  const replay = exploration ? linePosition(exploration.decision.assessment.beforeFen, replayLine, exploration.step) : null;
  const narratedStep = walkthrough[Math.min(exploration?.step ?? 0, walkthrough.length - 1)];
  const displayedFen = variationMove && replay ? linePosition(replay.fen, [variationMove], 1).fen : retry ? retryAssessment ? linePosition(retry.assessment.beforeFen, [retryAssessment.playedMove], 1).fen : retry.assessment.beforeFen : replay?.fen ?? (isBrowsing ? moveHistory[viewedPly - 1]?.after ?? game.initialFen : actualFen);
  const displayedMoves = retry ? [...game.moves.slice(0, retry.ply - 1), ...(retryAssessment ? [retryAssessment.playedMove] : [])] : exploration ? [...(variationHistory?.moves ?? []), ...(variationMove ? [variationMove] : [])] : game.moves.slice(0, viewedPly);
  const nextArrow = exploration && !variationInput ? replayLine[exploration.step] : undefined;
  const lastOpponentMove = !exploration && !retry ? [...moveHistory.slice(0, viewedPly)].reverse().find((move) => move.color !== game.learnerColor) : undefined;
  const baseOrientation = game.learnerColor === "w" ? "white" : "black";
  const orientation = flipped ? baseOrientation === "white" ? "black" : "white" : baseOrientation;
  const canExplore = isBrowsing ? Boolean(decision) : !pendingAssessment && !activity && (paused || board!.turn() === game.learnerColor || Boolean(result));
  const navigationPly = exploration?.step ?? viewedPly;
  const navigationLimit = exploration ? replay?.sans.length ?? 0 : game.moves.length;
  const exactLesson = openingRecallPrompts.find((item) => item.family === game.family && canonicalEpd(item.fen) === canonicalEpd(displayedFen));
  const familyGuide = openingModules[game.family];
  const important = [...game.assessments].filter((a) => BAD_MOVES.has(a.assessment.classification)).sort((a, b) => {
    const weights: Record<string, number> = { blunder: 3, mistake: 2, inaccuracy: 1 };
    return (weights[b.assessment.classification] - weights[a.assessment.classification]) || (b.assessment.lossCp ?? 0) - (a.assessment.lossCp ?? 0);
  }).slice(0, 3);

  return <section className="content-page coached-page">
    <header className="coached-game-header"><div><p className="eyebrow">{openingModules[game.family].name} · YOU PLAY {game.learnerColor === "w" ? "WHITE" : "BLACK"}</p><h1>Play with a coach</h1></div><div className="coached-actions"><button className="secondary-action" disabled={savingReview} onClick={() => { cancelSearches(); returnToGame(); setShowSetup(true); }}>New game</button></div></header>
    {storageFault ? <p className="error-text" role="alert">{storageFault} <button onClick={() => commit(game)}>Retry save</button></p> : null}
    <div className="coached-layout">
      <aside className="coached-panel" aria-label="Game coach">
        <div className="coached-coach-copy">
        <div className="coached-status" role="status">{retry ? "Practice candidate · your game is unchanged" : exploration ? "Exploring a variation · your game is unchanged" : isBrowsing ? `${viewedPly ? `After ${moveHistory[viewedPly - 1].san}` : "Starting position"} · viewing move history` : activity || result || (paused ? "Coach paused · continue when ready" : engineFault ? "Engine paused" : "Your move")}</div>
        {engineFault ? <div className="feedback error" role="alert"><strong>Engine unavailable</strong><p>{engineFault}</p><button className="secondary-action" onClick={() => { engine.current?.dispose(); engine.current = null; setEngineFault(""); }}>Retry engine</button>{pendingAssessment ? <button className="text-button" onClick={() => { setEngineFault(""); commit({ ...game, skippedAssessmentPlies: [...(game.skippedAssessmentPlies ?? []), lastPly] }); }}>Skip coaching for this move</button> : null}</div> : null}
        {retry ? <><h2>Find another candidate.</h2><p>Play a move on the board. The coach checks it independently—sound alternatives count.</p>{retryBusy ? <p role="status">Checking your candidate…</p> : retryAssessment ? <Assessment assessment={retryAssessment} family={game.family} /> : null}{retryAssessment ? <RetryActions assessment={retryAssessment} laterPlies={game.moves.length - retry.ply} disabled={retryBusy || savingReview} onContinue={continueCandidate} onTryAnother={() => setRetryAssessment(null)} onShowLine={() => { setExploration({ decision: { ply: retry.ply, assessment: retryAssessment }, line: "played", step: 0 }); setRetry(null); }} /> : null}<button className="secondary-action" onClick={returnToGame}>Return to original game</button></> : <>
          {!exploration && (visibleFeedback && decision && (!result || isBrowsing) ? <><Assessment assessment={decision.assessment} family={game.family} /><div className="coached-actions"><button className="secondary-action" disabled={!canExplore} onClick={() => { setHistoryPly(null); changeExploration({ decision, line: "played", step: 0 }); }}>Show why</button><button className="secondary-action" disabled={!canExplore} onClick={() => { setHistoryPly(null); setExploration(null); setRetry(decision); setRetryAssessment(null); }}>Try again</button></div></> : isBrowsing ? <div className="coached-intro"><h2>Earlier position.</h2><p>Use the arrows to browse the game. Return to the latest move to continue playing.</p></div> : !result ? <div className="coached-intro"><h2>Your move.</h2><p>{game.coaching === "after" ? "The coach will share feedback when the game ends. Take your time and play your own ideas." : "Drag a piece, or click its start and destination. I’ll explain the important moments as we play."}</p></div> : null)}
          {exploration && replay && teachingAssessment ? <CoachWalkthrough assessment={teachingAssessment} line={exploration.line} step={exploration.step} frames={walkthrough} sans={replay.sans} trial={Boolean(exploration.parent)} testing={variationInput} busy={variationBusy} canTest={Boolean(variationHistory && !variationHistory.board.isGameOver())} onLine={(line) => changeExploration({ ...exploration, line, step: 0 })} onStep={(step) => changeExploration({ ...exploration, step })} onTest={() => { cancelSearches(); setVariationInput(true); setNotice(""); }} onCancelTest={cancelSearches} onBack={exploration.parent ? () => changeExploration(exploration.parent!) : undefined} onReturn={returnToGame} /> : null}
          {isBrowsing ? <button className="secondary-action" onClick={() => viewMove(game.moves.length)}>Return to latest move</button> : null}
          {paused && !result && !exploration && !isBrowsing ? <button className="primary-action" onClick={() => commit({ ...game, pausedAtPly: undefined, updatedAt: new Date().toISOString() })}>Continue game<span>→</span></button> : null}
          {onPractice && !result && !exploration && decision && visibleFeedback && hasPracticePattern(decision.assessment) ? <button className="text-button coached-pattern-practice" disabled={!canExplore} onClick={() => { cancelSearches(); onPractice(decision.assessment, game.family); }}>Optional: practise this pattern →</button> : null}
          {result && !pendingAssessment && !exploration ? <div className="coached-summary"><h2>{result}</h2><p>{important.length ? "A few moments worth learning from:" : "No clear mistake was identified in the completed checks. You can explore your decisions in Move history."}</p>{important.map((item) => <div className="critical-decision" key={item.ply}><button className="text-button" onClick={() => { setExploration(null); setRetry(item); setRetryAssessment(null); }}>{item.assessment.playedSan} · {item.assessment.classification} · try again →</button><button className="text-button" disabled={savingReview || game.reviewSavedPlies?.includes(item.ply) || (game.reviewSavedPlies?.length ?? 0) >= 3} onClick={() => void saveDecision(item)}>{game.reviewSavedPlies?.includes(item.ply) ? "Remembered" : "Remember for later"}</button></div>)}<div className="coached-next-focus"><strong>One focus for your next game</strong><p>{nextGameFocus(important[0])}</p></div><div className="coached-actions"><button className="primary-action" disabled={savingReview} onClick={() => { returnToGame(); setShowSetup(true); }}>Play again<span>→</span></button>{onPractice && important[0] && hasPracticePattern(important[0].assessment) ? <button className="secondary-action" disabled={savingReview} onClick={() => { cancelSearches(); onPractice(important[0].assessment, game.family); }}>Practise this mistake</button> : null}</div></div> : null}
        </>}
        {notice ? <p role="status" className="coach-notice">{notice}</p> : null}
        {game.savedLine && !retry && !exploration && !isBrowsing ? <section className="coached-comparison" aria-label="Saved game line">
          <p>{game.savedLine.kind === "original" ? "Playing your revised line. Your original game is saved." : "Viewing your original game. Your revised line is saved."}</p>
          <button className="text-button" disabled={savingReview} onClick={restoreComparison}>{game.savedLine.kind === "original" ? "Return to original game" : "Return to revised game"}</button>
        </section> : null}
        {visibleFeedback && !retry && !result ? <details className="coached-opening-plan"><summary>{exactLesson ? "Opening plan for this position" : "Your opening guide"}</summary>{exactLesson ? <p>{exactLesson.explanation}</p> : <><p className="quiet-note">General {game.family.toUpperCase()} guidance — not an assessment of this position.</p><p>{familyGuide.promise}</p><p>{familyGuide.honestLimits[0]}</p></>}</details> : null}
        <MoveHistory game={game} moves={moveHistory} visibleFeedback={visibleFeedback} canExplore={canExplore && !retryBusy} viewedPly={viewedPly} onView={viewMove} onExplore={(item) => { returnToGame(); setExploration({ decision: item, line: "played", step: 0 }); }} />
        </div>
      </aside>
      <section className="coached-board-area" aria-label="Coached game board">
        <div className="coached-board-toolbar"><span>{new Chess(displayedFen).turn() === "w" ? "White" : "Black"} to move{new Chess(displayedFen).isCheck() ? " · check" : ""}{isBrowsing ? " · history" : ""}</span><div><button onClick={takeBack} disabled={!canTakeBack(game) || savingReview || Boolean(exploration || retry || isBrowsing)} title={exploration || retry || isBrowsing ? "Return to the live game to take back a move" : "Undo your last move and the computer’s reply"}>Take back</button><button onClick={() => setFlipped(!flipped)} aria-label="Rotate board">Rotate</button><button onClick={() => setKeyboard(!keyboard)} aria-pressed={keyboard}>Keyboard</button></div></div>
        <div className="coached-board-shell" ref={boardShell}>
          <EvaluationBar history={{ initialFen: game.initialFen, moves: displayedMoves }} orientation={orientation} enabled={!engineFault && !activity && (!pendingAssessment || isBrowsing) && !retryBusy && !variationInput && !variationBusy && Boolean(exploration || retry || isBrowsing || paused || result || board!.turn() === game.learnerColor)} hidden={!visibleFeedback} generation={evaluationGeneration} engineRef={engine} searchControllerRef={evaluationController} />
          <TrainingBoard fen={displayedFen} orientation={orientation} onMove={exploration ? tryVariation : retry ? tryCandidate : playMove} disabled={exploration ? !variationInput || variationBusy : retry ? retryBusy || Boolean(retryAssessment) : Boolean(isBrowsing || activity || engineFault || paused || pendingAssessment || result || board!.turn() !== game.learnerColor)} showKeyboardEntry={keyboard} lastMove={lastOpponentMove} highlightSquares={variationInput ? [] : narratedStep?.squares ?? []} arrows={nextArrow ? [{ startSquare: nextArrow.slice(0, 2), endSquare: nextArrow.slice(2, 4), color: exploration?.line === "best" ? "rgba(23,100,134,.7)" : "rgba(154,90,12,.7)" }] : []} label={exploration ? "Explanation board" : "Coached game"} />
          <div className="coached-board-footer">
            <div className="coached-history-navigation" aria-label="Browse moves">
              <button aria-label="Previous move" title="Previous move (left arrow)" disabled={Boolean(retry) || navigationPly === 0} onClick={() => stepMove(-1)}>←</button>
              <span>{exploration ? `${navigationPly}/${navigationLimit}` : isBrowsing ? `${viewedPly}/${game.moves.length}` : "Live"}</span>
              <button aria-label="Next move" title="Next move (right arrow)" disabled={Boolean(retry) || navigationPly >= navigationLimit} onClick={() => stepMove(1)}>→</button>
            </div>
            <div className="coached-board-tools">
            {!result && !retry && !exploration && !isBrowsing ? <div className="coached-resign">
              <button className="text-button" aria-label="Resign game" disabled={Boolean(activity) || pendingAssessment || savingReview} aria-expanded={resignConfirm} onClick={() => setResignConfirm(!resignConfirm)}>Resign</button>
              {resignConfirm ? <div className="coached-resign-confirm" role="group" aria-label="Confirm resignation"><p>Resign this game?</p><div className="coached-actions"><button className="danger-button" onClick={() => { cancelSearches(); commit({ ...game, resigned: true, pausedAtPly: undefined, updatedAt: new Date().toISOString() }); setResignConfirm(false); }}>Yes, resign</button><button className="secondary-action" onClick={() => setResignConfirm(false)}>Keep playing</button></div></div> : null}
            </div> : null}
            <BoardMenu game={game} />
            </div>
          </div>
        </div>
      </section>
    </div>
  </section>;
}
