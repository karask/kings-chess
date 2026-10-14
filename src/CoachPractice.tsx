import { Chess } from "chess.js";
import { assetUrl } from "../lib/app-url";
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { createPuzzleSession, gradePuzzleAttempt, parseUciMove, recordPuzzleHint, submitPuzzleMove } from "../lib/chess";
import { savedPracticeDecision, savedPracticeGrade, savedPracticeReviewContext, selectCoachPractice, type CoachPackPuzzle, type PracticeSelection, type SavedPracticeDecision } from "../lib/coach-practice";
import { assessMove, replayCoachingLine, type MoveAssessment } from "../lib/coaching";
import type { OpeningFamily } from "../lib/curriculum";
import { StockfishClient } from "../lib/engine";
import { decideTacticsCardEnrollment } from "../lib/learning";
import { getChessTrainerDb, putTrainingAttempt, reviewCard } from "../lib/storage";
import type { PuzzleSession } from "../lib/types";
import { TrainingBoard } from "./TrainingBoard";
import "./coach-practice.css";

export type CoachPracticeRequest = { kind: "puzzles"; family?: OpeningFamily; assessment?: MoveAssessment } | { kind: "revisit" };
export type PracticeRequest = CoachPracticeRequest;
type PracticeLeaveRef = RefObject<(() => Promise<boolean>) | null>;

export function CoachPractice({ rating, request, onClose, onRecorded, leaveRef }: {
  rating: number;
  request: CoachPracticeRequest;
  onClose: () => void;
  onRecorded: () => void;
  leaveRef?: PracticeLeaveRef;
}) {
  return request.kind === "puzzles"
    ? <PuzzlePractice rating={rating} request={request} onClose={onClose} onRecorded={onRecorded} leaveRef={leaveRef} />
    : <SavedDecisionPractice onClose={onClose} onRecorded={onRecorded} leaveRef={leaveRef} />;
}

function PracticeFrame({ children, fen, orientation, onMove, disabled, hintMove, onClose, closeDisabled = false, label }: {
  children: ReactNode;
  fen?: string;
  orientation?: "white" | "black";
  onMove?: (uci: string) => boolean;
  disabled?: boolean;
  hintMove?: string | null;
  onClose: () => void;
  closeDisabled?: boolean;
  label: string;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLElement>(null);
  const [keyboard, setKeyboard] = useState(false);
  useLayoutEffect(() => {
    const boardShell = shell.current;
    const container = frame.current;
    if (!boardShell || !container) return;
    const resize = () => {
      const parent = boardShell.parentElement!;
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const top = boardShell.getBoundingClientRect().top + window.scrollY;
      const input = boardShell.querySelector<HTMLElement>(".keyboard-move");
      const available = viewport - top - (input ? input.offsetHeight + 10 : 0) - 16;
      boardShell.style.setProperty("--practice-board-size", `${Math.max(120, Math.min(parent.clientWidth, available))}px`);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); };
  }, [fen, keyboard, disabled]);

  return <section className="coach-practice" ref={frame} aria-label="Optional practice">
    <aside className="coach-practice-copy">
      <button className="secondary-action" onClick={onClose} disabled={closeDisabled}>← Back to game</button>
      <p className="eyebrow">OPTIONAL PRACTICE</p>
      {children}
    </aside>
    {fen ? <section className="coach-practice-board">
      <div className="coach-practice-toolbar"><span>{new Chess(fen).turn() === "w" ? "White" : "Black"} to move</span><button className="text-button" aria-pressed={keyboard} onClick={() => setKeyboard(!keyboard)}>Keyboard</button></div>
      <div className="coach-practice-board-shell" ref={shell}><TrainingBoard fen={fen} orientation={orientation ?? "white"} onMove={onMove} disabled={disabled} hintMove={hintMove} showKeyboardEntry={keyboard} label={label} /></div>
    </section> : null}
  </section>;
}

function PuzzlePractice({ rating, request, onClose, onRecorded, leaveRef }: {
  rating: number; request: Extract<CoachPracticeRequest, { kind: "puzzles" }>; onClose: () => void; onRecorded: () => void; leaveRef?: PracticeLeaveRef;
}) {
  const [selection, setSelection] = useState<PracticeSelection | null>(null);
  const [session, setSession] = useState<PuzzleSession | null>(null);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const started = useRef(new Date());
  const attemptId = useRef(crypto.randomUUID());
  const recorded = useRef(new Map<string, Promise<void>>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void fetch(assetUrl("data/puzzles.json"), { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("The offline puzzle pack could not be opened.");
      const rows: unknown = await response.json();
      if (!Array.isArray(rows)) throw new Error("The puzzle pack is malformed.");
      const db = getChessTrainerDb();
      const history = db ? await Promise.all([
        db.reviewCards.where("kind").equals("tactic").filter((card) => card.due.getTime() <= Date.now()).sortBy("due"),
        db.attempts.where("kind").equals("tactic").sortBy("finishedAt"),
      ]).then(([cards, attempts]) => ({ dueIds: cards.map((card) => card.itemId), recentIds: attempts.slice(-24).map((attempt) => attempt.itemId) })).catch(() => ({})) : {};
      const selected = selectCoachPractice(rows as CoachPackPuzzle[], rating, request.family, request.assessment, history);
      if (!selected.positions.length) throw new Error(selected.connection);
      if (!controller.signal.aborted) {
        setSelection(selected); setSession(createPuzzleSession(selected.positions[0].puzzle));
        started.current = new Date();
      }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load the puzzle pack.");
    });
    return () => { mounted.current = false; controller.abort(); };
  }, [rating, request.family, request.assessment]);

  function record(next: PuzzleSession): Promise<void> {
    const key = attemptId.current;
    const pending = recorded.current.get(key);
    if (pending) return pending;
    const began = started.current;
    const work = (async () => {
      const solved = next.status === "solved";
      const now = new Date();
      const durationMs = now.getTime() - began.getTime();
      const slow = durationMs >= 120_000;
      const db = getChessTrainerDb();
      if (!db) throw new Error("Local storage is unavailable; this attempt has not been saved.");
      const alreadyEnrolled = Boolean(await db.reviewCards.get(`tactic:${next.puzzle.id}`));
      const enrollment = decideTacticsCardEnrollment({ solved, completedLine: solved, firstAttemptCorrect: next.mistakes === 0, usedHint: next.hints > 0, durationMs, alreadyEnrolled });
      await putTrainingAttempt({ id: `coach-practice:${key}`, itemId: next.puzzle.id, kind: "tactic", startedAt: began, finishedAt: now,
        outcome: solved ? "solved" : "abandoned", durationMs, mistakes: next.mistakes, hints: next.hints,
        metadata: { themes: next.puzzle.themes, rating: next.puzzle.rating, clean: solved && next.mistakes === 0 && next.hints === 0 && !slow, completedLine: solved, slow, activity: "coach-practice" },
      });
      if (enrollment.shouldBeEnrolled) await reviewCard(`tactic:${next.puzzle.id}`, slow && solved && next.mistakes === 0 && next.hints === 0 ? 2 : gradePuzzleAttempt({ solved, mistakes: next.mistakes, hints: next.hints, elapsedMs: durationMs }), {
        itemId: next.puzzle.id, kind: "tactic", durationMs, source: "coach-practice", context: { themes: next.puzzle.themes, completedLine: solved, reasons: enrollment.reasons },
      });
      onRecorded();
    })().catch((cause: unknown) => { recorded.current.delete(key); throw cause; });
    recorded.current.set(key, work);
    return work;
  }

  function move(uci: string): boolean {
    if (!session || session.status === "solved" || saving) return false;
    const result = submitPuzzleMove(session, uci);
    setSession(result.session); setHint(null);
    setFeedback(result.complete ? result.verdict === "alternate-mate" ? "Correct — your alternative is also checkmate." : "Correct — you found the complete line."
      : result.accepted ? "Good. The opponent has replied; find your continuation."
        : result.verdict === "illegal" ? "That move is not legal in this position. Try again." : "That is not the solution. Recheck the opponent’s forcing replies and try again.");
    if (result.complete) {
      setSaving(true);
      void record(result.session).catch((cause: unknown) => { if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not save this attempt."); })
        .finally(() => { if (mounted.current) setSaving(false); });
    }
    return result.accepted;
  }

  async function close() {
    if (saving) return false;
    if (session && (session.playedMoves.length || session.mistakes || session.hints || session.status === "solved")) {
      setSaving(true);
      try { await record(session); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this attempt."); setSaving(false); return false; }
    }
    onClose();
    return true;
  }

  // Header navigation uses the same save-on-leave path as the in-panel button.
  // React clears the imperative ref automatically when this exercise unmounts.
  useImperativeHandle(leaveRef, () => close);

  async function next() {
    if (!selection || !session || session.status !== "solved" || saving) return;
    setSaving(true);
    try {
      await record(session);
      if (index === 1) { onClose(); return; }
      setIndex(1); setSession(createPuzzleSession(selection.positions[1].puzzle));
      started.current = new Date(); attemptId.current = crypto.randomUUID();
      setFeedback(""); setHint(null); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this attempt."); }
    finally { if (mounted.current) setSaving(false); }
  }

  const solved = session?.status === "solved";
  return <PracticeFrame label="Coach practice puzzle" fen={session?.fen} orientation={session?.puzzle.playerColor === "b" ? "black" : "white"} disabled={solved || saving} hintMove={hint} onMove={move} onClose={() => void close()} closeDisabled={saving}>
    <p className="step-count">{session ? `POSITION ${index + 1} OF 2` : "TWO SHORT POSITIONS"}</p>
    <h2>{solved ? index === 1 ? "Practice complete." : "One more position." : "Calculate, then play."}</h2>
    <p>{session ? "Find the strongest move and continue against the reply. Move pieces by dragging, clicking, or using the keyboard." : "Opening the local puzzle pack…"}</p>
    {feedback ? <div className={`feedback ${solved ? "success" : "retry"}`} role="status"><strong>{feedback}</strong></div> : null}
    {solved && session ? <div className="coach-practice-explanation">
      <p>{selection?.connection}</p>
      <p><strong>Published continuation:</strong> {session.puzzle.solutionSans.join(" ")}</p>
      <p className="quiet-note">Corpus tags: {session.puzzle.themes.join(", ")}. A tag names a pattern; it is not a full explanation of this position.</p>
      {selection?.positions[index].explanation ? <p>{selection.positions[index].explanation}</p> : null}
      <button className="primary-action inline" disabled={saving} onClick={() => void next()}>{saving ? "Saving…" : index === 0 ? "Next position →" : "Back to game →"}</button>
    </div> : session ? <button className="secondary-action" onClick={() => { setSession(recordPuzzleHint(session)); setHint(session.puzzle.solution[session.cursor]); setFeedback("Hint: the highlighted piece and destination show the next move."); }}>Show a hint</button> : null}
    {error ? <div role="alert"><p className="error-text">{error}</p><button className="text-button" onClick={onClose}>Return without saving this attempt</button></div> : null}
    <p className="quiet-note">Two positions, then back to playing. Clean solves stay in your history; missed, hinted, or unusually slow positions become spaced-review cards.</p>
  </PracticeFrame>;
}

function SavedDecisionPractice({ onClose, onRecorded, leaveRef }: { onClose: () => void; onRecorded: () => void; leaveRef?: PracticeLeaveRef }) {
  const [item, setItem] = useState<SavedPracticeDecision | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [assessment, setAssessment] = useState<MoveAssessment | null>(null);
  const [candidateFen, setCandidateFen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const engine = useRef<StockfishClient | null>(null);
  const controller = useRef<AbortController | null>(null);
  const started = useRef(new Date());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const db = getChessTrainerDb();
      if (!db) throw new Error("Local review storage is unavailable.");
      const cards = await db.reviewCards.where("kind").equals("custom").filter((card) => card.due.getTime() <= Date.now()).sortBy("due");
      for (const card of cards) {
        const events = await db.reviewEvents.where("cardId").equals(card.id).toArray();
        const decision = savedPracticeDecision(card, events);
        if (decision) { if (mounted.current) { setItem(decision); started.current = new Date(); } break; }
      }
    })().catch((cause: unknown) => { if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not load your saved decision."); })
      .finally(() => { if (mounted.current) setLoaded(true); });
    return () => { mounted.current = false; controller.current?.abort(); engine.current?.dispose(); };
  }, []);

  async function save(result: MoveAssessment) {
    if (!item || saved) return;
    const grade = savedPracticeGrade(result);
    if (grade === null) return;
    const now = new Date();
    const durationMs = now.getTime() - started.current.getTime();
    await reviewCard(item.cardId, grade, { itemId: item.itemId, kind: "custom", source: "coach-revisit", durationMs, context: savedPracticeReviewContext(item, result) });
    // The scheduling event is already durable if history persistence fails.
    if (mounted.current) setSaved(true);
    await putTrainingAttempt({ itemId: item.itemId, kind: "custom", startedAt: started.current, finishedAt: now, durationMs, outcome: grade >= 3 ? "solved" : "failed", mistakes: grade >= 3 ? 0 : 1, metadata: { activity: "coach-revisit", classification: result.classification, fen: item.fen } });
    onRecorded();
  }

  function move(uci: string): boolean {
    if (!item || busy || assessment) return false;
    const board = new Chess(item.fen);
    try { board.move(parseUciMove(uci)); } catch { return false; }
    setCandidateFen(board.fen()); setBusy(true); setError("");
    const active = new AbortController(); controller.current = active;
    engine.current ??= new StockfishClient();
    // Old imported cards do not always record an opening. The fallback only
    // selects an analysis context; no inferred opening prose is displayed.
    const family = item.family ?? (new Chess(item.fen).turn() === "w" ? "kia" : "pirc");
    void assessMove(engine.current, { initialFen: item.fen, moves: [], playedMove: uci, family, signal: active.signal }).then(async (result) => {
      if (active.signal.aborted) return;
      setAssessment(result);
      try { await save(result); } catch { if (mounted.current) setError("Your answer was checked, but some review data could not be saved. You can still return to the game."); }
    }).catch((cause: unknown) => {
      if (!active.signal.aborted) { setCandidateFen(null); setError(cause instanceof Error ? cause.message : "The engine could not check this move. Try again."); }
    }).finally(() => { if (!active.signal.aborted) setBusy(false); });
    return true;
  }

  async function close() { controller.current?.abort(); engine.current?.stop(); onClose(); return true; }
  useImperativeHandle(leaveRef, () => close);
  const grade = assessment ? savedPracticeGrade(assessment) : null;
  const continuation = assessment ? replayCoachingLine(assessment.beforeFen, assessment.bestLine).san.join(" ") : "";
  return <PracticeFrame label="Revisit a saved decision" fen={candidateFen ?? item?.fen} orientation={item && new Chess(item.fen).turn() === "b" ? "black" : "white"} disabled={busy || Boolean(assessment)} onMove={move} onClose={close}>
    <p className="step-count">ONE PREVIOUS DECISION</p>
    <h2>{!loaded ? "Finding a saved position…" : item ? assessment ? "What changed this time?" : "Find a strong move." : "Nothing to revisit yet."}</h2>
    <p>{item ? "Check your opponent’s threats, then choose a move. Your earlier answer stays hidden until you try." : loaded ? "Saved game decisions will appear here when they are due. There is no queue you need to finish before playing." : "Reading your on-device review history."}</p>
    {busy ? <p role="status">Checking your move against a strong alternative…</p> : null}
    {assessment ? <div className="coach-practice-explanation">
      <div className={`feedback ${grade === 3 ? "success" : "retry"}`}><strong>{assessment.title}</strong><p>{assessment.explanation}</p></div>
      {item?.explanation ? <details><summary>The lesson saved from your original game</summary><p>{item.explanation}</p></details> : null}
      {continuation ? <details><summary>Compare the engine’s preferred continuation</summary><p>{continuation}</p></details> : null}
      <p className="quiet-note">{saved ? grade === 3 ? "A sound alternative counts as successful recall. Your review was saved." : "This position will return sooner. Your original lesson is preserved." : grade === null ? "The comparison was not stable enough to grade. Your review schedule is unchanged." : "The review has not been saved."}</p>
      <button className="primary-action inline" onClick={close}>Back to game →</button>
    </div> : null}
    {error ? <p className="error-text" role="alert">{error}</p> : null}
  </PracticeFrame>;
}
