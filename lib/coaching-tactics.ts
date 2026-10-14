import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

import type { CoachingEvidence, ReplayedCoachingLine } from "./coaching";

const NAMES: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const opposite = (color: Color): Color => color === "w" ? "b" : "w";
const colorName = (color: Color) => color === "w" ? "White" : "Black";
const unique = (squares: string[]) => [...new Set(squares)];
const captureCache = new WeakMap<Chess, { fen: string; byColor: Map<Color, Move[]> }>();

/** A hypothetical immediate capture, with chess.js still deciding legality.
 * Clearing en passant when changing the turn prevents inventing a stale right.
 * These are threats, never evidence that an opponent can skip a real turn.
 */
function forTurn(board: Chess, color: Color): Chess {
  const fields = board.fen().split(" ");
  if (fields[1] !== color) fields[3] = "-";
  fields[1] = color;
  return new Chess(fields.join(" "));
}

function captures(board: Chess, color: Color, target: Square): Move[] {
  const fen = board.fen();
  let cached = captureCache.get(board);
  if (cached?.fen !== fen) {
    cached = { fen, byColor: new Map() };
    captureCache.set(board, cached);
  }
  let moves = cached.byColor.get(color);
  if (!moves) {
    moves = forTurn(board, color).moves({ verbose: true }).filter((move) => move.captured && move.captured !== "k");
    cached.byColor.set(color, moves);
  }
  // En passant lands behind its victim. Threats target the pawn's square;
  // subsequent recaptures still target the capturing piece's real move.to.
  return moves.filter((move) => (move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to) === target);
}

function recaptures(board: Chess, capture: Move): Move[] {
  const after = forTurn(board, capture.color);
  try { after.move({ from: capture.from, to: capture.to, promotion: capture.promotion }); }
  catch { return []; }
  return captures(after, opposite(capture.color), capture.to);
}

function ray(from: Square, to: Square): { file: number; rank: number } | undefined {
  const file = to.charCodeAt(0) - from.charCodeAt(0);
  const rank = Number(to[1]) - Number(from[1]);
  if (!file && !rank) return undefined;
  return file === 0 || rank === 0 || Math.abs(file) === Math.abs(rank)
    ? { file: Math.sign(file), rank: Math.sign(rank) } : undefined;
}

function nextSquare(from: Square, direction: { file: number; rank: number }): Square | undefined {
  const file = from.charCodeAt(0) + direction.file;
  const rank = Number(from[1]) + direction.rank;
  return file >= 97 && file <= 104 && rank >= 1 && rank <= 8 ? `${String.fromCharCode(file)}${rank}` as Square : undefined;
}

function absolutePin(board: Chess, defender: Square, color: Color): { king: Square; pinner: Square } | undefined {
  const king = board.board().flat().find((piece) => piece?.type === "k" && piece.color === color)?.square;
  if (!king) return undefined;
  const direction = ray(king, defender);
  if (!direction) return undefined;
  let square = nextSquare(king, direction);
  while (square && square !== defender) {
    if (board.get(square)) return undefined;
    square = nextSquare(square, direction);
  }
  if (square !== defender) return undefined;
  square = nextSquare(defender, direction);
  while (square) {
    const piece = board.get(square);
    if (piece) {
      const diagonal = direction.file !== 0 && direction.rank !== 0;
      return piece.color !== color && (piece.type === "q" || piece.type === (diagonal ? "b" : "r"))
        ? { king, pinner: square } : undefined;
    }
    square = nextSquare(square, direction);
  }
  return undefined;
}

function pinPreventsRecapture(board: Chess, defender: Square, target: Square, pin: { king: Square; pinner: Square }): boolean {
  const pinRay = ray(pin.king, defender)!;
  const targetRay = ray(pin.king, target);
  // Moving along the pin ray can maintain the shield or capture the pinner.
  // If another check makes that move illegal, the pin is not its cause.
  if (targetRay?.file === pinRay.file && targetRay.rank === pinRay.rank) return false;
  const withoutPinner = new Chess(board.fen());
  withoutPinner.remove(pin.pinner);
  try {
    // A concurrent check may also prohibit this recapture. Attribute the
    // failure to this pin only when removing its pinner makes it legal.
    withoutPinner.move({ from: defender, to: target, promotion: "q" });
    return true;
  } catch {
    return false;
  }
}

function evidence(kind: CoachingEvidence["kind"], text: string, squares: string[], line: "played" | "best", ply: number,
  steps?: CoachingEvidence["steps"]): CoachingEvidence {
  return { kind, text, squares: unique(squares), line, ply, ...(steps ? { steps } : {}) };
}

/** Facts about the shown material sequence. The caller must first verify the
 * settled material comparison; this function never evaluates a sacrifice.
 */
export function materialMechanisms(beforeFen: string, replay: ReplayedCoachingLine, line: "played" | "best"): CoachingEvidence[] {
  if (!replay.legal || replay.moves.length < 2) return [];
  const learner = new Chess(beforeFen).turn();
  const losingColor = replay.materialChange < 0 ? learner : opposite(learner);
  const found: CoachingEvidence[] = [];
  const possessive = losingColor === learner ? "your" : `${colorName(losingColor)}'s`;
  const first = replay.moves[0];

  // Look only at the near tactical sequence; distant PV events are unlikely
  // to explain the root decision well enough to deserve a coaching claim.
  for (let index = 0; index < Math.min(replay.moves.length, 6); index++) {
    const capture = replay.moves[index];
    if (capture.color === losingColor || !capture.captured || capture.isEnPassant()) continue;
    const beforeCapture = new Chess(replay.fens[index]);
    const afterCapture = new Chess(replay.fens[index + 1]);
    const defenders = beforeCapture.attackers(capture.to, losingColor);
    const legalRecaptures = captures(afterCapture, losingColor, capture.to);
    const captureText = `${colorName(capture.color)}'s ${capture.san} captures ${possessive} ${NAMES[capture.captured]} on ${capture.to}`;

    const pinned = defenders.map((square) => ({ square, pin: absolutePin(afterCapture, square, losingColor) }))
      .find(({ square, pin }) => pin && !legalRecaptures.some((move) => move.from === square)
        && afterCapture.attackers(capture.to, losingColor).includes(square)
        && pinPreventsRecapture(afterCapture, square, capture.to, pin));
    if (pinned?.pin) {
      const piece = afterCapture.get(pinned.square)!;
      const text = `${captureText}. The ${NAMES[piece.type]} on ${pinned.square} appears to defend it, but is pinned to the king on ${pinned.pin.king} by the piece on ${pinned.pin.pinner}; that recapture is illegal because it exposes the king.`;
      found.push(evidence("pin", text, [capture.from, capture.to, pinned.square, pinned.pin.king, pinned.pin.pinner], line, index + 1));
      break;
    }

    if (index === 1 && losingColor === learner) {
      const initial = new Chess(beforeFen);
      const priorCapture = captures(initial, capture.color, capture.to).find((move) => move.from === capture.from);
      if (priorCapture && recaptures(initial, priorCapture).some((move) => move.from === first.from)
        && !legalRecaptures.some((move) => move.from === first.to) && capture.to !== first.to) {
        const text = `${first.san} moves the ${NAMES[first.piece]} away from ${first.from}, removing its recapture on ${capture.to}. ${captureText}; the moved ${NAMES[first.piece]} can no longer take that attacker back.`;
        found.push(evidence("defender", text, [first.from, first.to, capture.from, capture.to], line, 1, [
          { ply: 1, text: `${first.san} moves the ${NAMES[first.piece]} away from ${first.from}; it no longer has the recapture on ${capture.to}.`, squares: [first.from, first.to, capture.to] },
          { ply: 2, text: `${captureText}. The defender that could previously recapture has moved away.`, squares: [capture.from, capture.to, first.to] },
        ]));
        break;
      }
    }

    // Removing a defender: its hypothetical recapture was legal immediately
    // before its capture. Mere geometric protection is insufficient.
    if (index >= 2) {
      const removalIndex = replay.moves.findIndex((move, prior) => prior < index && move.color === capture.color && !!move.captured);
      if (removalIndex >= 0) {
        const removal = replay.moves[removalIndex];
        const beforeRemoval = new Chess(replay.fens[removalIndex]);
        const threatenedCapture = captures(beforeRemoval, capture.color, capture.to).find((move) => move.from === capture.from);
        if (threatenedCapture && recaptures(beforeRemoval, threatenedCapture).some((move) => move.from === removal.to)
          && !legalRecaptures.length) {
          const text = `${removal.san} removes the ${NAMES[removal.captured!]} on ${removal.to} that could recapture on ${capture.to}. Later in this line, ${captureText}; there is no legal immediate recapture of that attacker.`;
          found.push(evidence("defender", text, [removal.from, removal.to, capture.from, capture.to], line, removalIndex + 1, [
            { ply: removalIndex + 1, text: `${removal.san} captures the defender on ${removal.to}, removing its possible recapture on ${capture.to}.`, squares: [removal.to, capture.to] },
            { ply: index + 1, text: `${captureText}. With the defender removed, that attacker cannot immediately be recaptured.`, squares: [capture.from, capture.to, removal.to] },
          ]));
          break;
        }
      }
    }

    // A moving blocker exposes a stationary rook, bishop, or queen's attack.
    if (["b", "r", "q"].includes(capture.piece)) {
      for (let revealIndex = 0; revealIndex < index; revealIndex++) {
        const reveal = replay.moves[revealIndex];
        if (reveal.from === capture.from || reveal.to === capture.from || reveal.to === capture.to) continue;
        const beforeReveal = new Chess(replay.fens[revealIndex]);
        const afterReveal = new Chess(replay.fens[revealIndex + 1]);
        if (beforeReveal.get(capture.from)?.type !== capture.piece || beforeReveal.get(capture.from)?.color !== capture.color
          || afterReveal.get(capture.from)?.type !== capture.piece || afterReveal.get(capture.from)?.color !== capture.color
          || beforeReveal.get(capture.to)?.type !== capture.captured || beforeReveal.get(capture.to)?.color !== losingColor
          || replay.moves.slice(revealIndex + 1, index).some((move) => [move.from, move.to].some((square) => square === capture.from || square === capture.to))
          || beforeReveal.attackers(capture.to, capture.color).includes(capture.from)
          || !afterReveal.attackers(capture.to, capture.color).includes(capture.from)) continue;
        const text = `${reveal.san} opens the ${NAMES[capture.piece]}'s line from ${capture.from} to ${capture.to}. In the displayed continuation, ${captureText}.`;
        found.push(evidence("discovered-attack", text, [reveal.from, reveal.to, capture.from, capture.to], line, revealIndex + 1, [
          { ply: revealIndex + 1, text: `${reveal.san} clears the line from the ${NAMES[capture.piece]} on ${capture.from} to the ${NAMES[capture.captured]} on ${capture.to}.`, squares: [reveal.from, capture.from, capture.to] },
          { ply: index + 1, text: `${captureText} along the opened line.`, squares: [capture.from, capture.to] },
        ]));
        break;
      }
      if (found.length) break;
    }

    if (!legalRecaptures.length && index <= 1) {
      const arrived = index === 1 && capture.to === first.to;
      const tradedDown = arrived && first.captured && VALUES[capture.captured] > VALUES[first.captured];
      const trade = tradedDown ? ` You have traded your ${NAMES[capture.captured]} for a ${NAMES[first.captured!]}.` : "";
      const introduction = arrived
        ? `Your ${first.san}${first.captured ? ` takes a ${NAMES[first.captured]}, but` : ` puts the ${NAMES[first.promotion ?? first.piece]} on ${first.to}, where`} ${colorName(capture.color)} can reply ${capture.san}, capturing your ${NAMES[capture.captured]}.`
        : `${captureText}.`;
      const text = `${introduction}${trade} After this capture there is no legal immediate recapture of the attacker on ${capture.to}.`;
      found.push(evidence("hanging-piece", text, [capture.from, capture.to, ...(arrived ? [first.from] : [])], line, index + 1,
        arrived ? [
          { ply: 1, text: `Your ${first.san}${first.captured ? ` takes a ${NAMES[first.captured]}, but` : ""} puts your ${NAMES[first.promotion ?? first.piece]} on ${first.to}, where ${colorName(capture.color)}'s ${NAMES[capture.piece]} on ${capture.from} can capture it.`, squares: [first.from, first.to, capture.from] },
          { ply: 2, text: `${captureText}.${trade} You have no legal immediate recapture of that attacker.`, squares: [capture.from, capture.to] },
        ] : undefined));
      break;
    }
  }
  return found;
}

/** Other checking forks, and non-checking forks with the actual target capture
 * replayed. A geometric double attack alone is not a material verdict.
 */
export function broaderFork(replay: ReplayedCoachingLine, learner: Color): CoachingEvidence | undefined {
  if (!replay.legal || !replay.materialSettled || replay.materialChange >= 0) return undefined;
  const fork = replay.moves[1];
  const capture = replay.moves[3];
  if (!fork || fork.color === learner || !capture?.captured || capture.from !== fork.to || capture.piece !== fork.piece) return undefined;
  const board = new Chess(replay.fens[2]);
  const target = board.get(capture.to);
  if (!target || target.color !== learner || target.type !== capture.captured) return undefined;
  const second = board.board().flat().find((piece) => piece?.color === learner && piece.square !== capture.to
    && (piece.type === "k" ? board.attackers(piece.square, fork.color).includes(fork.to)
      : VALUES[piece.type] >= VALUES[fork.piece] && captures(board, fork.color, piece.square).some((move) => move.from === fork.to)));
  if (!second || !captures(board, fork.color, capture.to).some((move) => move.from === fork.to)) return undefined;
  const text = `In the displayed continuation, ${fork.san} forks your ${NAMES[second.type]} on ${second.square} and ${NAMES[target.type]} on ${capture.to}. ${capture.san} then captures the ${NAMES[target.type]} after your reply.`;
  return evidence("fork", text, [fork.to, second.square, capture.to], "played", 2, [
    { ply: 2, text: `${fork.san} attacks both your ${NAMES[second.type]} on ${second.square} and ${NAMES[target.type]} on ${capture.to}.`, squares: [fork.to, second.square, capture.to] },
    { ply: 4, text: `${capture.san} captures the ${NAMES[target.type]} that was one of the fork's two targets.`, squares: [fork.to, capture.to] },
  ]);
}

/** Explain exactly which immediate threat the alternative changes. */
export function alternativeDefense(beforeFen: string, played: ReplayedCoachingLine, best: ReplayedCoachingLine): CoachingEvidence | undefined {
  const first = played.moves[0];
  const capture = played.moves[1];
  const alternative = best.moves[0];
  if (!played.legal || !best.legal || !first || !alternative || !capture?.captured || capture.isEnPassant()) return undefined;
  const initial = new Chess(beforeFen);
  const after = new Chess(best.fens[1]);
  const learner = initial.turn();
  if (capture.color === learner) return undefined;
  let text: string | undefined;
  let squares: string[] = [alternative.from, alternative.to, capture.from, capture.to];
  if (alternative.to === capture.from && alternative.captured) {
    text = `${alternative.san} captures the attacking ${NAMES[capture.piece]} on ${capture.from}, removing the piece that makes that capture in your line.`;
  } else {
    const targetSquare = capture.to === first.to ? first.from : capture.to;
    const actualSquare = alternative.from === targetSquare ? alternative.to : targetSquare;
    const piece = after.get(actualSquare);
    if (piece?.color === learner && piece.type === capture.captured && actualSquare !== capture.to
      && !captures(after, capture.color, actualSquare).length) {
      text = `${alternative.san} ${alternative.from === targetSquare ? "moves" : "keeps"} your ${NAMES[piece.type]} ${alternative.from === targetSquare ? "to" : "on"} ${actualSquare}, where ${colorName(capture.color)} has no legal immediate capture of it.`;
      squares = [...squares, actualSquare];
    } else if (after.isCheck() && !captures(after, capture.color, capture.to).some((move) => move.from === capture.from)) {
      text = `${alternative.san} gives check. ${colorName(capture.color)} must answer the check, so the same immediate capture on ${capture.to} is not legal.`;
    } else {
      const sameCapture = captures(after, capture.color, capture.to).find((move) => move.from === capture.from);
      const recapture = sameCapture && recaptures(after, sameCapture).find((move) => VALUES[move.piece] <= VALUES[capture.piece]);
      if (sameCapture && recapture && VALUES[capture.captured] <= VALUES[capture.piece]) {
        text = `${alternative.san} leaves a legal answer to ${sameCapture.san}: ${recapture.san} can recapture the ${NAMES[capture.piece]} on ${capture.to}. Compare that with the material loss in your displayed line.`;
        squares.push(recapture.from);
      }
    }
  }
  return text ? evidence("defense", text, squares, "best", 1) : undefined;
}

/** Praise a concrete defensive function only for an engine-rated sound move.
 * The observation is about immediate legal captures, not long-term safety.
 */
export function goodDefense(beforeFen: string, replay: ReplayedCoachingLine): CoachingEvidence | undefined {
  if (!replay.legal || !replay.moves.length) return undefined;
  const before = new Chess(beforeFen);
  const first = replay.moves[0];
  if (before.isCheck() || first.piece === "k" || first.captured || first.promotion) return undefined;
  const after = new Chess(replay.fens[1]);
  const opponent = opposite(first.color);
  const threat = captures(before, opponent, first.from).find((move) => !recaptures(before, move).length || VALUES[move.piece] < VALUES[first.piece]);
  if (threat && !captures(after, opponent, first.to).length) {
    const text = `${first.san} moves your ${NAMES[first.piece]} away from ${opponent === "w" ? "White" : "Black"}'s ${NAMES[threat.piece]} on ${threat.from}. On ${first.to} it cannot be captured immediately by any legal reply. This is a concrete defensive benefit; it does not guarantee the whole position is safe.`;
    return evidence("defense", text, [first.from, first.to, threat.from], "played", 1);
  }
  for (const piece of before.board().flat()) {
    if (!piece || piece.color !== first.color || piece.square === first.from || piece.type === "k") continue;
    const attack = captures(before, opponent, piece.square).find((move) => !recaptures(before, move).length && VALUES[move.piece] >= VALUES[piece.type]);
    if (!attack) continue;
    const afterAttack = captures(after, opponent, piece.square).find((move) => move.from === attack.from);
    const recapture = afterAttack && recaptures(after, afterAttack).find((move) => move.from === first.to);
    if (!afterAttack || !recapture) continue;
    const text = `${first.san} adds your ${NAMES[first.piece]} on ${first.to} as a defender of the ${NAMES[piece.type]} on ${piece.square}. If ${colorName(opponent)} plays ${afterAttack.san}, ${recapture.san} is a legal recapture; that immediate recapture was unavailable before your move.`;
    return evidence("defense", text, [first.from, first.to, piece.square, attack.from], "played", 1);
  }
  return undefined;
}
