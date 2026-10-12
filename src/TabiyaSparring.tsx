"use client";

import { Chess, type Color, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  openingModules,
  openingRecallPrompts,
  type OpeningFamily,
  type OpeningRecallPrompt,
} from "../lib/curriculum";
import { canonicalEpd, moveToUci, parseUciMove } from "../lib/chess";
import {
  EngineCancelledError,
  EngineUnavailableError,
  StockfishClient,
} from "../lib/engine";
import { putTrainingAttempt } from "../lib/storage";
import type { EngineAnalysis, EngineScore, UciMove } from "../lib/types";

export type TabiyaSparringProps = {
  orientation: "white" | "black";
  onRecorded: () => void;
};

type SparringPhase = "ready" | "thinking" | "complete" | "engine-unavailable";
type CompletionReason = "six-turns" | "game-over" | "no-engine-move";
type AuthoredPreference = "preferred" | "legal-alternative" | "not-authored";

type SparringDecision = {
  learnerUci: UciMove;
  learnerSan: string;
  opponentUci?: UciMove;
  opponentSan?: string;
  authoredPromptId?: string;
  authoredExplanation?: string;
  preference: AuthoredPreference;
};

type PromotionChoice = "q" | "r" | "b" | "n";

const MAX_LEARNER_TURNS = 6;
const ENGINE_NODES = 12_000;

const FAMILY_ORDER = ["pirc", "kid", "kia"] as const satisfies readonly OpeningFamily[];

const FAMILY_COLORS: Record<OpeningFamily, string> = {
  pirc: "#b66e3c",
  kid: "#214d3b",
  kia: "#526886",
};

const TABIYA_IDS: Record<OpeningFamily, readonly string[]> = {
  pirc: [
    "recall-pirc-austrian-develop",
    "recall-pirc-150-counterplay",
    "recall-pirc-classical-break",
  ],
  kid: [
    "recall-kid-closed-f5",
    "recall-kid-fianchetto-c5",
    "recall-kid-samisch-safety",
  ],
  kia: [
    "recall-kia-e6-route",
    "recall-kia-c5-c3",
    "recall-kia-dutch-pressure",
  ],
};

const ALL_PROMPTS: readonly OpeningRecallPrompt[] = openingRecallPrompts;

function promptLearnerColor(prompt: OpeningRecallPrompt): Color {
  return new Chess(prompt.fen).turn();
}

function colorLabel(color: Color): "White" | "Black" {
  return color === "w" ? "White" : "Black";
}

function promptIsUsable(prompt: OpeningRecallPrompt, family: OpeningFamily): boolean {
  try {
    const learner = promptLearnerColor(prompt);
    return (
      prompt.family === family &&
      prompt.orientation === (learner === "w" ? "white" : "black")
    );
  } catch {
    return false;
  }
}

function tabiyasFor(family: OpeningFamily): OpeningRecallPrompt[] {
  const prompts = TABIYA_IDS[family]
    .map((id) => ALL_PROMPTS.find((prompt) => prompt.id === id))
    .filter((prompt): prompt is OpeningRecallPrompt => Boolean(prompt))
    .filter((prompt) => promptIsUsable(prompt, family));

  if (prompts.length) return prompts;
  return ALL_PROMPTS.filter((prompt) => promptIsUsable(prompt, family)).slice(0, 3);
}

function promptsAtPosition(fen: string, learner: Color): OpeningRecallPrompt[] {
  let key: string;
  try {
    key = canonicalEpd(fen);
  } catch {
    return [];
  }
  return ALL_PROMPTS.filter(
    (prompt) =>
      (() => {
        try {
          return promptLearnerColor(prompt) === learner && canonicalEpd(prompt.fen) === key;
        } catch {
          return false;
        }
      })(),
  );
}

function playUci(board: Chess, uci: UciMove) {
  const parsed = parseUciMove(uci);
  return board.move(parsed);
}

function pvAsSan(fen: string, pv: readonly UciMove[]): string {
  const board = new Chess(fen);
  const sans: string[] = [];
  for (const uci of pv.slice(0, 8)) {
    try {
      sans.push(playUci(board, uci).san);
    } catch {
      break;
    }
  }
  return sans.join(" ");
}

function scoreFromLearnerView(
  score: EngineScore | undefined,
  analysisPerspective: Color,
  learner: Color,
): string {
  if (!score) return "No score";
  const signed = score.value * (analysisPerspective === learner ? 1 : -1);
  if (score.type === "mate") {
    if (signed === 0) return "M0";
    return signed > 0 ? `+M${Math.abs(signed)}` : `−M${Math.abs(signed)}`;
  }
  const pawns = signed / 100;
  if (Math.abs(pawns) < 0.005) return "0.00";
  return `${pawns > 0 ? "+" : "−"}${Math.abs(pawns).toFixed(2)}`;
}

function familyName(family: OpeningFamily): string {
  return openingModules[family].name;
}

function makeAttemptId(): string {
  return `attempt:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

function SparringBoard({
  fen,
  orientation,
  learner,
  disabled,
  lastMove,
  label,
  onMove,
}: {
  fen: string;
  orientation: "white" | "black";
  learner: Color;
  disabled: boolean;
  lastMove: UciMove | null;
  label: string;
  onMove: (uci: UciMove) => boolean;
}) {
  const boardId = useId().replaceAll(":", "-");
  const [selected, setSelected] = useState<string | null>(null);
  const [keyboardMove, setKeyboardMove] = useState("");
  const [promotion, setPromotion] = useState<{
    from: Square;
    to: Square;
    choices: PromotionChoice[];
  } | null>(null);

  const squareStyles: Record<string, CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.slice(0, 2)] = { background: "rgba(197, 139, 54, .32)" };
    squareStyles[lastMove.slice(2, 4)] = { background: "rgba(197, 139, 54, .48)" };
  }
  if (selected) {
    squareStyles[selected] = { boxShadow: "inset 0 0 0 4px #c58b36" };
  }

  function attemptMove(from: string, to: string): "moved" | "promotion" | "invalid" {
    if (disabled || promotion) return "invalid";
    const board = new Chess(fen);
    const fromSquare = from as Square;
    const toSquare = to as Square;
    const candidates = board
      .moves({ verbose: true, square: fromSquare })
      .filter((move) => move.to === toSquare);
    if (!candidates.length) return "invalid";

    const promotionChoices = candidates
      .map((move) => move.promotion)
      .filter((piece): piece is PromotionChoice =>
        piece === "q" || piece === "r" || piece === "b" || piece === "n",
      );
    if (promotionChoices.length) {
      setPromotion({ from: fromSquare, to: toSquare, choices: [...new Set(promotionChoices)] });
      return "promotion";
    }
    return onMove(moveToUci(candidates[0])) ? "moved" : "invalid";
  }

  function choosePromotion(piece: PromotionChoice): void {
    if (!promotion) return;
    if (onMove(`${promotion.from}${promotion.to}${piece}`)) {
      setPromotion(null);
      setSelected(null);
    }
  }

  return (
    <div className="tabiya-board" role="group" aria-label={label} aria-busy={disabled}>
      <div className="chessboard-frame">
        <Chessboard
          options={{
            id: `tabiya-${boardId}`,
            position: fen,
            boardOrientation: orientation,
            allowDragging: !disabled && !promotion,
            showNotation: true,
            animationDurationInMs: 220,
            darkSquareStyle: { backgroundColor: "#66806a" },
            lightSquareStyle: { backgroundColor: "#dfe0cb" },
            squareStyles,
            boardStyle: { boxShadow: "0 18px 42px rgba(24,32,28,.18)" },
            canDragPiece: ({ square }) => {
              if (disabled || promotion || !square) return false;
              const board = new Chess(fen);
              return board.get(square as Square)?.color === learner;
            },
            onPieceDrop: ({ sourceSquare, targetSquare }) => {
              if (!targetSquare) return false;
              const result = attemptMove(sourceSquare, targetSquare);
              if (result !== "invalid") setSelected(null);
              return result === "moved";
            },
            onSquareClick: ({ square }) => {
              if (disabled || promotion) return;
              if (selected) {
                const result = attemptMove(selected, square);
                if (result !== "invalid") {
                  setSelected(null);
                  return;
                }
              }
              const board = new Chess(fen);
              const ownPiece = board.get(square as Square)?.color === learner;
              setSelected(ownPiece ? square : null);
            },
          }}
        />
      </div>
      <form className="keyboard-move" onSubmit={(event) => {
        event.preventDefault();
        const normalized = keyboardMove.trim().toLowerCase();
        if (normalized && !disabled && onMove(normalized)) setKeyboardMove("");
      }}>
        <label htmlFor={`tabiya-keyboard-${boardId}`}>Keyboard move (for example, e2e4)</label>
        <input id={`tabiya-keyboard-${boardId}`} value={keyboardMove} disabled={disabled} autoComplete="off" inputMode="text" pattern="[a-hA-H][1-8][a-hA-H][1-8][qQrRbBnN]?" placeholder="e2e4" onChange={(event) => setKeyboardMove(event.target.value)} />
        <button type="submit" disabled={disabled || !keyboardMove.trim()}>Play</button>
      </form>
      {promotion ? (
        <div className="promotion-picker" role="dialog" aria-label="Choose promotion piece">
          <strong>Promote to</strong>
          {promotion.choices.map((piece) => (
            <button
              className="secondary-action"
              type="button"
              key={piece}
              onClick={() => choosePromotion(piece)}
            >
              {piece === "q" ? "Queen" : piece === "r" ? "Rook" : piece === "b" ? "Bishop" : "Knight"}
            </button>
          ))}
          <button className="text-button" type="button" onClick={() => setPromotion(null)}>
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TabiyaSparringSession({ orientation, onRecorded }: TabiyaSparringProps) {
  const headingId = useId();
  const [family, setFamily] = useState<OpeningFamily>("pirc");
  const promptPool = useMemo(() => tabiyasFor(family), [family]);
  const [promptIndex, setPromptIndex] = useState(0);
  const prompt = promptPool[promptIndex % promptPool.length];
  const learner = promptLearnerColor(prompt);
  const [fen, setFen] = useState(() => tabiyasFor("pirc")[0].fen);
  const [phase, setPhase] = useState<SparringPhase>("ready");
  const [learnerTurns, setLearnerTurns] = useState(0);
  const [decisions, setDecisions] = useState<SparringDecision[]>([]);
  const [analysis, setAnalysis] = useState<EngineAnalysis | null>(null);
  const [lastMove, setLastMove] = useState<UciMove | null>(null);
  const [engineMessage, setEngineMessage] = useState("");
  const clientRef = useRef<StockfishClient | null>(null);
  const sequenceRef = useRef(0);
  const busyRef = useRef(false);
  const recordedRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);

  function resetState(nextPrompt: OpeningRecallPrompt, nextIndex: number): void {
    sequenceRef.current += 1;
    clientRef.current?.stop("tabiya changed");
    setPromptIndex(nextIndex);
    setFen(nextPrompt.fen);
    setPhase("ready");
    setLearnerTurns(0);
    setDecisions([]);
    setAnalysis(null);
    setLastMove(null);
    setEngineMessage("");
    busyRef.current = false;
    recordedRef.current = false;
    startedAtRef.current = null;
  }

  function resetSession(nextIndex: number): void {
    const normalizedIndex = ((nextIndex % promptPool.length) + promptPool.length) % promptPool.length;
    resetState(promptPool[normalizedIndex], normalizedIndex);
  }

  function selectFamily(nextFamily: OpeningFamily): void {
    if (nextFamily === family) return;
    const nextPrompt = tabiyasFor(nextFamily)[0];
    setFamily(nextFamily);
    resetState(nextPrompt, 0);
  }

  useEffect(
    () => () => {
      sequenceRef.current += 1;
      clientRef.current?.dispose();
      clientRef.current = null;
    },
    [],
  );

  async function recordCompletedSession(
    completedPrompt: OpeningRecallPrompt,
    finalDecisions: SparringDecision[],
    reason: CompletionReason,
  ): Promise<void> {
    if (recordedRef.current) return;
    recordedRef.current = true;
    const finishedAt = new Date();
    const startedAt = new Date(startedAtRef.current ?? finishedAt.getTime());
    await putTrainingAttempt({
      id: makeAttemptId(),
      itemId: completedPrompt.id,
      kind: "opening",
      startedAt,
      finishedAt,
      outcome: "solved",
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      metadata: {
        activity: "tabiya-sparring",
        orientation,
        boardOrientation: orientation,
        learnerColor: promptLearnerColor(completedPrompt),
        family: completedPrompt.family,
        branchId: completedPrompt.branchId,
        completionReason: reason,
        learnerTurns: finalDecisions.length,
        preferredDecisions: finalDecisions.filter(
          (decision) => decision.preference === "preferred",
        ).length,
        moves: finalDecisions.flatMap((decision) =>
          decision.opponentUci
            ? [decision.learnerUci, decision.opponentUci]
            : [decision.learnerUci],
        ),
      },
    }).catch(() => undefined);
    onRecorded();
  }

  function finishSession(
    completedPrompt: OpeningRecallPrompt,
    finalDecisions: SparringDecision[],
    reason: CompletionReason,
  ): void {
    busyRef.current = false;
    setPhase("complete");
    void recordCompletedSession(completedPrompt, finalDecisions, reason);
  }

  async function requestOpponentReply(
    positionAfterLearnerMove: string,
    turnNumber: number,
    decisionsAfterLearnerMove: SparringDecision[],
    sessionPrompt: OpeningRecallPrompt,
    sequence: number,
  ): Promise<void> {
    clientRef.current ??= new StockfishClient();
    try {
      const nextAnalysis = await clientRef.current.analyze(positionAfterLearnerMove, {
        nodes: ENGINE_NODES,
        multiPv: 1,
        timeoutMs: 20_000,
      });
      if (sequenceRef.current !== sequence) return;
      setAnalysis(nextAnalysis);

      if (!nextAnalysis.bestMove) {
        setDecisions(decisionsAfterLearnerMove);
        finishSession(sessionPrompt, decisionsAfterLearnerMove, "no-engine-move");
        return;
      }

      const responseBoard = new Chess(positionAfterLearnerMove);
      const response = playUci(responseBoard, nextAnalysis.bestMove);
      const withResponse = decisionsAfterLearnerMove.map((decision, index) =>
        index === decisionsAfterLearnerMove.length - 1
          ? {
              ...decision,
              opponentUci: moveToUci(response),
              opponentSan: response.san,
            }
          : decision,
      );
      setDecisions(withResponse);
      setFen(responseBoard.fen());
      setLastMove(moveToUci(response));

      if (responseBoard.isGameOver()) {
        finishSession(sessionPrompt, withResponse, "game-over");
      } else if (turnNumber >= MAX_LEARNER_TURNS) {
        finishSession(sessionPrompt, withResponse, "six-turns");
      } else {
        busyRef.current = false;
        setPhase("ready");
      }
    } catch (error) {
      if (sequenceRef.current !== sequence) return;
      busyRef.current = false;
      setPhase("engine-unavailable");
      setEngineMessage(
        error instanceof EngineUnavailableError
          ? "The local engine is unavailable in this browser."
          : error instanceof EngineCancelledError
            ? "The local engine stopped before it found a reply."
          : "The local engine could not finish this reply.",
      );
    }
  }

  function onLearnerMove(uci: UciMove): boolean {
    if (phase !== "ready" || busyRef.current) return false;
    const board = new Chess(fen);
    if (board.turn() !== learner) return false;
    startedAtRef.current ??= Date.now();

    const authoredPrompts = promptsAtPosition(fen, learner);
    const cue =
      authoredPrompts.find((candidate) => candidate.family === prompt.family) ?? authoredPrompts[0];
    const acceptedMoves = new Set(authoredPrompts.flatMap((candidate) => candidate.acceptedMoves ?? []));
    let move;
    try {
      move = playUci(board, uci);
    } catch {
      return false;
    }

    busyRef.current = true;
    const normalizedUci = moveToUci(move);
    const preference: AuthoredPreference = acceptedMoves.size
      ? acceptedMoves.has(normalizedUci)
        ? "preferred"
        : "legal-alternative"
      : "not-authored";
    const decision: SparringDecision = {
      learnerUci: normalizedUci,
      learnerSan: move.san,
      ...(cue
        ? {
            authoredPromptId: cue.id,
            authoredExplanation: cue.explanation,
          }
        : {}),
      preference,
    };
    const nextDecisions = [...decisions, decision];
    const nextTurn = learnerTurns + 1;
    const positionAfterLearnerMove = board.fen();
    const sequence = sequenceRef.current;

    setDecisions(nextDecisions);
    setLearnerTurns(nextTurn);
    setFen(positionAfterLearnerMove);
    setLastMove(normalizedUci);
    setAnalysis(null);
    setEngineMessage("");

    if (board.isGameOver()) {
      finishSession(prompt, nextDecisions, "game-over");
    } else {
      setPhase("thinking");
      void requestOpponentReply(
        positionAfterLearnerMove,
        nextTurn,
        nextDecisions,
        prompt,
        sequence,
      );
    }
    return true;
  }

  const currentAuthoredPrompt =
    promptsAtPosition(fen, learner).find((candidate) => candidate.family === prompt.family) ?? prompt;
  const lastDecision = decisions.at(-1);
  const latestLine = analysis?.lines[0];
  const statusText =
    phase === "thinking"
      ? "Stockfish is choosing the opponent reply."
      : phase === "complete"
        ? `${learnerTurns} learner decision${learnerTurns === 1 ? "" : "s"} complete.`
        : phase === "engine-unavailable"
          ? engineMessage
          : `${colorLabel(learner)} to move.`;

  return (
    <section className="tabiya-sparring" aria-labelledby={headingId}>
      <div className="review-layout tabiya-sparring-layout">
        <aside className="review-coach tabiya-sparring-coach">
          <div className="family-tabs tabiya-family-tabs" role="tablist" aria-label="Tabiya opening family">
            {FAMILY_ORDER.map((candidateFamily) => (
              <button
                type="button"
                role="tab"
                aria-selected={family === candidateFamily}
                className={family === candidateFamily ? "selected" : ""}
                key={candidateFamily}
                aria-label={`${openingModules[candidateFamily].name}, ${colorLabel(promptLearnerColor(tabiyasFor(candidateFamily)[0]))}`}
              onClick={() => selectFamily(candidateFamily)}
            >
              <span style={{ background: FAMILY_COLORS[candidateFamily] }} />
              <strong>{candidateFamily === "pirc" ? "Pirc" : candidateFamily.toUpperCase()}</strong>
              <small>{colorLabel(promptLearnerColor(tabiyasFor(candidateFamily)[0]))}</small>
            </button>
            ))}
          </div>
          <div>
            <p className="step-count">TABIYA SPARRING · AUTHORED CUE</p>
            <h2 id={headingId}>{currentAuthoredPrompt.prompt}</h2>
            <div className="concept-row">
              {currentAuthoredPrompt.concepts.map((concept) => (
                <span key={concept}>{concept}</span>
              ))}
            </div>
          </div>

          <progress
            max={MAX_LEARNER_TURNS}
            value={learnerTurns}
            aria-label={`${learnerTurns} of ${MAX_LEARNER_TURNS} learner turns complete`}
          />
          <p className="quiet-note" role="status" aria-live="polite">
            {statusText}
          </p>

          {lastDecision ? (
            <div className="feedback success">
              <strong>
                {lastDecision.preference === "preferred"
                  ? `Authored move · ${lastDecision.learnerSan}`
                  : lastDecision.preference === "legal-alternative"
                    ? `Legal alternative · ${lastDecision.learnerSan}`
                    : `Legal move · ${lastDecision.learnerSan}`}
              </strong>
              {lastDecision.preference === "legal-alternative" ? (
                <p>This move continues the game and is not graded as an error.</p>
              ) : null}
              {lastDecision.authoredExplanation ? <p>{lastDecision.authoredExplanation}</p> : null}
              {lastDecision.opponentSan ? <p>Stockfish replied {lastDecision.opponentSan}.</p> : null}
            </div>
          ) : (
            <div className="retry-prompt">
              Any legal move is accepted. The authored repertoire move is identified only after you
              commit.
            </div>
          )}

          {decisions.length ? (
            <ol className="sparring-history" aria-label="Sparring moves">
              {decisions.map((decision, index) => (
                <li key={`${index}-${decision.learnerUci}`}>
                  <span>{index + 1}.</span> {decision.learnerSan}
                  {decision.opponentSan ? ` · ${decision.opponentSan}` : ""}
                </li>
              ))}
            </ol>
          ) : null}

          {analysis && decisions.length ? (
            <div className="engine-result" aria-label="Stockfish evaluation">
              <header>
                <strong>
                  {scoreFromLearnerView(
                    latestLine?.score,
                    analysis.perspective,
                    learner,
                  )}
                </strong>
                <span>{latestLine?.nodes ? `${latestLine.nodes.toLocaleString()} nodes` : "fixed search"}</span>
              </header>
              <p>Evaluation from your side after your move.</p>
              <code>{latestLine?.pv.length ? pvAsSan(analysis.fen, latestLine.pv) : "No PV returned"}</code>
            </div>
          ) : null}

          {phase === "complete" || phase === "engine-unavailable" ? (
            <button
              className="primary-action"
              type="button"
              onClick={() => resetSession(promptIndex + 1)}
            >
              Next tabiya <span>→</span>
            </button>
          ) : null}
        </aside>

        <section className="board-panel" aria-label="Tabiya sparring board">
          <div className="board-wrap">
            <SparringBoard
              key={fen}
              fen={fen}
              orientation={orientation}
              learner={learner}
              disabled={phase !== "ready"}
              lastMove={lastMove}
              label={`${familyName(prompt.family)} tabiya, ${colorLabel(learner)} to move, ${orientation} board perspective`}
              onMove={onLearnerMove}
            />
            <div className="position-meta">
              <span className="opening-dot" />
              {familyName(prompt.family)} · free play
              <span className="move-chip">
                {learnerTurns}/{MAX_LEARNER_TURNS}
              </span>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

export function TabiyaSparring(props: TabiyaSparringProps) {
  return <TabiyaSparringSession {...props} />;
}

export default TabiyaSparring;
