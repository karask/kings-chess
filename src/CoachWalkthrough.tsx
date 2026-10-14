import { Chess } from "chess.js";
import type { MoveAssessment } from "../lib/coaching";
import { parseUciMove } from "../lib/chess";

interface NarratedStep { ply: number; title: string; text: string; squares: string[] }

export function CoachWalkthrough({ assessment, line, step, frames, sans, trial, testing, busy, canTest, onLine, onStep, onTest, onCancelTest, onBack, onReturn }: {
  assessment: MoveAssessment; line: "played" | "best"; step: number;
  frames: NarratedStep[]; sans: string[]; trial: boolean; testing: boolean; busy: boolean; canTest: boolean;
  onLine: (line: "played" | "best") => void; onStep: (step: number) => void;
  onTest: () => void; onCancelTest: () => void; onBack?: () => void; onReturn: () => void;
}) {
  const frame = frames[Math.min(step, frames.length - 1)];
  const side = new Chess(assessment.beforeFen).turn() === "w" ? "White" : "Black";
  const evidencePlies = assessment.evidence.filter((item) => item.line === line && item.kind !== "material")
    .flatMap((item) => item.steps?.map((stage) => stage.ply) ?? (item.ply ? [item.ply] : []))
    .filter((ply) => ply > 0 && ply < frames.length);
  const teachingPlies = evidencePlies.length
    ? [...new Set([0, 1, ...evidencePlies])].sort((a, b) => a - b)
    : frames.map((item) => item.ply);
  const previous = [...teachingPlies].reverse().find((ply) => ply < step);
  const next = teachingPlies.find((ply) => ply > step);
  const score = assessment.playedScore;
  const afterMove = new Chess(assessment.beforeFen);
  afterMove.move(parseUciMove(assessment.playedMove));
  const outcome = afterMove.isCheckmate()
    ? `This move gives checkmate. ${side} wins.`
    : afterMove.isStalemate()
      ? "This move ends the game in stalemate: a draw."
    : !score || score.bound || assessment.classification === "unrated"
    ? "The outcome is uncertain at this analysis depth. A move label alone does not show that the threat has been solved."
    : score.type === "mate"
      ? `The engine still reports forced mate ${score.value > 0 ? "for" : "against"} ${side} in ${Math.abs(score.value)}.`
      : `After this reply: ${score.value >= 0 ? "+" : ""}${(score.value / 100).toFixed(2)} from ${side}’s perspective.${score.value < -50 ? ` ${side} remains worse, even if this is the best defense.` : score.value > 50 ? ` The engine favors ${side}.` : " The engine considers the position roughly balanced."}`;
  return <section className="coach-walkthrough" aria-label="Move explanation">
    <div className="walkthrough-heading"><span className="eyebrow">{trial ? `TESTING ${side.toUpperCase()}’S MOVE` : "SHOW WHY"}</span><span className={`move-grade grade-${assessment.classification}`}>{assessment.classification}</span></div>
    {trial ? <p className="walkthrough-trial-note">The verdict is from {side}’s perspective. Your game is unchanged.</p> : null}
    {trial ? <p className="walkthrough-outcome">{outcome}</p> : null}
    <div className="walkthrough-branches" aria-label="Compare continuations">
      <button aria-pressed={line === "played"} onClick={() => onLine("played")}>{trial ? "Tested move" : "Your move"}<strong>{assessment.playedSan}</strong></button>
      <button aria-pressed={line === "best"} onClick={() => onLine("best")}>Alternative<strong>{assessment.bestSan}</strong></button>
    </div>
    <div className="walkthrough-narration" role="status" aria-live="polite" aria-atomic="true">
      <strong>{busy ? "Checking your reply…" : testing ? "Try your idea on the board" : frame?.title ?? "Starting position"}</strong>
      <p>{busy ? "Comparing this move with the strongest reply for the side to move." : testing ? "Drag a piece, or click its start and destination. You can play for either side when it is their turn." : frame?.text}</p>
    </div>
    <div className="walkthrough-controls">
      <button className="secondary-action" disabled={previous === undefined} onClick={() => previous !== undefined && onStep(previous)}>← Back</button>
      <span>{evidencePlies.length ? `Point ${Math.min(teachingPlies.filter((ply) => ply <= step).length, teachingPlies.length)} / ${teachingPlies.length}` : `${step} / ${sans.length}`}</span>
      <button className="secondary-action" disabled={next === undefined} onClick={() => next !== undefined && onStep(next)}>Next →</button>
    </div>
    {evidencePlies.length ? <p className="walkthrough-hint">Key teaching positions. The arrows under the board step through every move.</p> : null}
    {testing ? <button className="text-button" onClick={onCancelTest}>{busy ? "Cancel check" : "Cancel reply"}</button> : <button className="secondary-action walkthrough-test" disabled={!canTest} onClick={onTest}>{step === 0 ? "Try a different move" : "Try a different reply"}</button>}
    <details className="walkthrough-detail"><summary>Full explanation & moves</summary>
      <p>{assessment.explanation}</p>
      <div className="variation-san">{sans.map((san, index) => <button key={index} aria-current={step === index + 1 ? "step" : undefined} onClick={() => onStep(index + 1)}>{san}</button>)}</div>
      <small>This is a checked example continuation. Other replies can change the outcome; a legal line alone does not prove every reply is forced.</small>
    </details>
    <div className="walkthrough-return">{onBack ? <button className="text-button" onClick={onBack}>← Back to previous explanation</button> : null}<button className="text-button" onClick={onReturn}>Return to game</button></div>
  </section>;
}
