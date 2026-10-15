import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

import { canonicalFen, moveToUci, parseUciMove } from "./chess";
import type { OpeningFamily } from "./curriculum";

export interface PositionLesson {
  theme: string;
  yourMove: string;
  opponentReply?: string;
  alternative?: string;
  takeaway: string;
  evidence: Array<{ kind: "position"; text: string; squares: string[]; line: "played" | "best"; ply: number }>;
}

export interface PositionLessonInput {
  beforeFen: string;
  playedMove: string;
  bestMove: string;
  playedLine: string[];
  bestLine: string[];
  classification: string;
  family: OpeningFamily;
}

interface Branch { moves: Move[]; boards: Chess[] }
interface Observation { theme: string; text: string; squares: string[]; takeaway: string }
const NAMES: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const CENTRAL: Square[] = ["d4", "e4", "d5", "e5"];
const opposite = (color: Color): Color => color === "w" ? "b" : "w";
const unique = (squares: string[]) => [...new Set(squares)];
const pawn = (board: Chess, square: Square, color: Color) => board.get(square)?.type === "p" && board.get(square)?.color === color;
const pieceAt = (board: Chess, square: Square, type: PieceSymbol, color: Color) => board.get(square)?.type === type && board.get(square)?.color === color;

function replay(fen: string, line: string[], root: string): Branch | undefined {
  if (!line.length) return undefined;
  try {
    const board = new Chess(canonicalFen(fen));
    const boards = [new Chess(board.fen())];
    const moves: Move[] = [];
    if (moveToUci(parseUciMove(line[0])) !== moveToUci(parseUciMove(root))) return undefined;
    for (const uci of line) {
      moves.push(board.move(parseUciMove(uci)));
      boards.push(new Chess(board.fen()));
    }
    return { moves, boards };
  } catch { return undefined; }
}

function forTurn(board: Chess, color: Color): Chess {
  const fields = board.fen().split(" ");
  if (fields[1] !== color) fields[3] = "-";
  fields[1] = color;
  return new Chess(fields.join(" "));
}

/** A geometric attack is insufficient: pinned pieces may not be able to
 * capture. Replacing a friendly occupant only tests whether this piece could
 * legally recapture on that square; it does not claim the occupant is safe.
 */
function canControl(board: Chess, from: Square, target: Square): boolean {
  const piece = board.get(from);
  if (!piece || !board.attackers(target, piece.color).includes(from) || board.get(target)?.type === "k") return false;
  const probe = forTurn(board, piece.color);
  probe.remove(target);
  if (!probe.put({ type: "p", color: opposite(piece.color) }, target)) return false;
  try { probe.move({ from, to: target, promotion: "q" }); return true; }
  catch { return false; }
}

function relevantControl(board: Chess, square: Square): Square[] {
  return CENTRAL.filter((target) => canControl(board, square, target));
}

function fianchetto(board: Chess, color: Color): Square | undefined {
  const square = color === "w" ? "g2" : "g7";
  return pieceAt(board, square, "b", color) ? square : undefined;
}

function diagonal(board: Chess, bishop: Square): { clear: Square[]; blocker?: Square } {
  const rankDirection = bishop === "g2" ? 1 : -1;
  const clear: Square[] = [];
  let file = bishop.charCodeAt(0) - 1;
  let rank = Number(bishop[1]) + rankDirection;
  while (file >= 97 && rank >= 1 && rank <= 8) {
    const square = `${String.fromCharCode(file)}${rank}` as Square;
    if (board.get(square)) return { clear, blocker: square };
    clear.push(square);
    file--; rank += rankDirection;
  }
  return { clear };
}

function longDiagonalChange(before: Chess, after: Chess, move: Move): Observation | undefined {
  const square = fianchetto(after, move.color);
  if (!square) return undefined;
  const now = diagonal(after, square);
  const then = fianchetto(before, move.color) ? diagonal(before, square) : undefined;
  const changed = move.to === square && move.piece === "b"
    || then && (then.clear.length !== now.clear.length || then.blocker !== now.blocker);
  if (!changed) return undefined;
  const blocker = now.blocker ? after.get(now.blocker)! : undefined;
  const access = now.clear.length ? `The diagonal is open through ${now.clear.join("–")}` : "The diagonal has no empty square before its first blocker";
  const end = blocker && now.blocker
    ? `${blocker.color === move.color ? "your" : "the opposing"} ${NAMES[blocker.type]} on ${now.blocker} is the first blocker.`
    : "it has no blocker.";
  const change = !then ? `places your bishop on ${square}, facing the long diagonal.`
    : now.clear.length > then.clear.length ? `opens more squares along the ${square} bishop's diagonal.`
      : `changes the first obstruction on the ${square} bishop's diagonal.`;
  return {
    theme: "The fianchetto bishop",
    text: `${move.san} ${change} ${access}; ${end}`,
    squares: unique([move.from, move.to, square, ...now.clear, ...(now.blocker ? [now.blocker] : [])]),
    takeaway: blocker?.color === move.color
      ? `Before planning an attack with the ${square} bishop, account for your ${NAMES[blocker.type]} on ${now.blocker}. Opening a diagonal gives the bishop access; it does not by itself prove a tactic works.`
      : `Trace the ${square} bishop's diagonal to its first blocker. More open squares mean more scope, but check the actual captures before calling that a threat.`,
  };
}

function closedKid(board: Chess, color: Color, family: OpeningFamily): boolean {
  return family === "kid" && color === "b" && !!fianchetto(board, "b")
    && pawn(board, "d6", "b") && pawn(board, "e5", "b")
    && pawn(board, "c4", "w") && pawn(board, "d5", "w") && pawn(board, "e4", "w");
}

function centralObservation(before: Chess, after: Chess, move: Move, family: OpeningFamily): Observation | undefined {
  const isBlackFamily = move.color === "b" && (family === "pirc" || family === "kid");
  if (isBlackFamily && move.piece === "p" && !move.captured && move.from[0] === move.to[0] && ["c5", "e5"].includes(move.to)
    && pawn(before, "d4", "w") && pawn(before, "e4", "w") && pawn(before, "d6", "b")
    && canControl(after, move.to, "d4")) {
    const capture = forTurn(after, "w").moves({ verbose: true }).find((candidate) => candidate.from === "d4" && candidate.to === move.to);
    return {
      theme: "Challenge the pawn centre",
      text: `${move.san} brings your ${move.to[0]}-pawn into contact with White's d4 pawn. Your pawn on ${move.to} can capture d4${capture ? `, and White can answer ${capture.san} to release that tension` : ""}.`,
      squares: [move.from, move.to, "d4", "e4"],
      takeaway: "Against the d4–e4 centre, prepare a pawn challenge and calculate both captures and advances. A central break changes the pawn structure permanently; its timing depends on the resulting position.",
    };
  }
  if (closedKid(before, move.color, family)) {
    if (move.piece === "p" && move.from[0] === "f" && !move.captured && move.to === "f5") {
      const canChallenge = canControl(after, "f5", "e4");
      return {
        theme: "Time the King's Indian pawn break",
        text: `${move.san} advances the f-pawn beside the d5/e5 pawn chains${canChallenge ? " and creates a capture against White's e4 pawn" : "; the f-pawn cannot currently make a legal capture on e4"}. The pawn's departure also leaves ${move.from} empty.`,
        squares: [move.from, "f5", "e4", "d5", "e5"],
        takeaway: "In this closed centre, ...f5 is a thematic way to challenge e4. Before choosing it, calculate exf5 and check e5 support, your king, and White's c-file or b-pawn counterplay; a familiar break is not automatically timely.",
      };
    }
    if (move.piece === "n" && move.from === "f6" && !move.captured && pawn(before, "f7", "b")) {
      const next = forTurn(after, "b").moves({ verbose: true });
      const f5 = next.some((candidate) => candidate.from === "f7" && candidate.to === "f5");
      return {
        theme: "Prepare the King's Indian pawn break",
        text: `${move.san} vacates f6, clearing the f7 pawn's path toward f5.${f5 ? " A two-square ...f5 advance is now legally available on a later Black turn if White does not change the position." : " Other obstacles still prevent an immediate ...f5 advance."}`,
        squares: [move.from, move.to, "f7", "f5", "e5"],
        takeaway: "A knight retreat can prepare ...f5 in this closed centre. Recheck the position after White's reply: clearing the route is preparation, not proof that the break is safe.",
      };
    }
  }
  const kiaCentre = family === "kia" && move.color === "w" && !!fianchetto(before, "w")
    && pawn(before, "d3", "w");
  if (kiaCentre && move.piece === "p" && move.from === "e4" && move.to === "e5") {
    const controls = ["d6", "f6"].filter((square) => canControl(after, "e5", square as Square));
    const locked = pawn(before, "e6", "b");
    const advanced = pawn(before, "d5", "b");
    if (locked || advanced) return {
      theme: "Choose the KIA centre",
      text: `${move.san} gains space on e5${locked ? " and locks against Black's e6 pawn" : ""}${controls.length ? `; the pawn can control ${controls.join(" and ")}` : "; no legal pawn capture on d6 or f6 has been established in this position"}.${advanced ? " Black's d5 pawn remains beside the chain, so the centre is not completely locked." : ""}`,
      squares: unique(["e4", "e5", ...controls, ...(locked ? ["e6"] : []), ...(advanced ? ["d5"] : [])]),
      takeaway: locked
        ? "The e5/e6 lock can support a KIA space plan, but e5 needs protection against ...f6 and ...Nc6 pressure. Check Black's central breaks before committing pieces to a kingside attack."
        : "An e5 pawn does not by itself create the usual locked KIA centre. Check how Black can challenge it and whether c4 or development fits the remaining d5 tension.",
    };
  }
  if (kiaCentre && move.piece === "p" && !move.captured && move.from[0] === move.to[0] && ["c4", "e4"].includes(move.to)
    && pawn(before, "d5", "b") && canControl(after, move.to, "d5")) return {
    theme: "Challenge Black's d5 pawn",
    text: `${move.san} uses the ${move.to[0]}-pawn to challenge Black's pawn on d5. The pawn on ${move.to} can now capture d5, so play concerns central tension as well as development.`,
    squares: [move.from, move.to, "d5"],
    takeaway: "Against a d5 centre, compare c4 and e4 by the captures and pawn structure they produce. The KIA piece setup does not require a kingside attack in every position.",
  };
  const capturedPawnSquare = move.isEnPassant() ? `${move.to[0]}${move.from[1]}` as Square : move.to;
  if (move.piece === "p" && move.captured === "p" && CENTRAL.includes(capturedPawnSquare)) return {
    theme: "Resolve central tension",
    text: `${move.san} removes the opposing pawn from ${capturedPawnSquare} and places your pawn on ${move.to}.${move.isEnPassant() ? ` The en-passant capture leaves both ${move.from} and ${capturedPawnSquare} empty.` : ` The pawn tension between ${move.from} and ${capturedPawnSquare} has been resolved by a capture.`}`,
    squares: unique([move.from, move.to, capturedPawnSquare]),
    takeaway: "Before releasing central tension, compare the opponent's recaptures with keeping the pawns in contact. Decide from the resulting activity and pawn structure, not from the capture alone.",
  };
  if (move.piece === "p" && ["c", "d", "e"].includes(move.to[0]) && !move.captured) {
    const controls = relevantControl(after, move.to);
    const supports = controls.filter((square) => pawn(after, square, move.color));
    const enemyPawns = controls.filter((square) => pawn(after, square, opposite(move.color)));
    const empty = controls.filter((square) => !after.get(square));
    if (supports.length || enemyPawns.length || empty.length) return {
      theme: supports.length ? "Support the centre" : "Central pawn tension",
      text: `${move.san} places your pawn on ${move.to}${supports.length ? `, where it can recapture on ${supports.join(" and ")} if the supported pawn is exchanged` : ""}${enemyPawns.length ? `${supports.length ? "; it" : " and"} creates a capture against the opposing pawn on ${enemyPawns.join(" and ")}` : ""}.${empty.length ? ` It also controls the empty central ${empty.length === 1 ? "square" : "squares"} ${empty.join(" and ")}.` : ""}`,
      squares: [move.from, move.to, ...supports, ...enemyPawns, ...empty],
      takeaway: "Connect pawn moves to a concrete central task: control an entry square, support a pawn, or challenge one. Count legal captures and recaptures before deciding that the centre is secure.",
    };
  }
  return undefined;
}

function observe(before: Chess, after: Chess, move: Move, family: OpeningFamily): Observation | undefined {
  if (move.promotion || move.san.includes("#")) return undefined;
  const central = centralObservation(before, after, move, family);
  if (central) return central;
  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    const rookFrom = `${move.isKingsideCastle() ? "h" : "a"}${move.from[1]}`;
    const rookTo = `${move.isKingsideCastle() ? "f" : "d"}${move.from[1]}`;
    const kingSideFiles = move.isKingsideCastle() ? ["f", "g", "h"] : ["b", "c", "d"];
    const pawnRank = move.color === "w" ? "2" : "7";
    const shield = kingSideFiles.map((file) => `${file}${pawnRank}` as Square).filter((square) => pawn(after, square, move.color));
    return {
      theme: "King placement and rook development",
      text: `${move.san} moves your king from ${move.from} to ${move.to} and brings the ${rookFrom} rook to ${rookTo}.${shield.length ? ` Your pawns on ${shield.join(", ")} remain in front of this side of the king.` : " There is no intact home-rank pawn shield on that side."}`,
      squares: [move.from, move.to, rookFrom, rookTo, ...shield],
      takeaway: "Castling changes both king placement and rook activity. Check open files and attacking pieces near the king; the castling move alone does not establish that the king is safe.",
    };
  }
  const other = opposite(move.color);
  const opponentBishop = fianchetto(before, other);
  const ownBishop = fianchetto(before, move.color);
  if (move.captured === "b" && move.to === opponentBishop || move.piece === "b" && move.from === ownBishop && move.captured) {
    return {
      theme: "Exchanging the fianchetto bishop",
      text: move.to === opponentBishop
        ? `${move.san} captures the fianchetto bishop on ${move.to}. That bishop can no longer cover its diagonal.`
        : `${move.san} moves your fianchetto bishop away from ${move.from} to capture on ${move.to}. The bishop now works from ${move.to}; check which diagonal squares it can still reach before allowing a recapture.`,
      squares: [move.from, move.to],
      takeaway: "Before exchanging a fianchetto bishop, compare the piece you receive with the diagonal and king-side squares you give up. An exchange is not automatically good or bad because the bishop was fianchettoed.",
    };
  }
  const bishop = longDiagonalChange(before, after, move);
  if (bishop) return bishop;
  if ((move.piece === "n" || move.piece === "b") && !move.captured) {
    const homeRank = move.color === "w" ? "1" : "8";
    const homeSquares = move.piece === "n" ? [`b${homeRank}`, `g${homeRank}`] : [`c${homeRank}`, `f${homeRank}`];
    const develops = homeSquares.includes(move.from) && move.to[1] !== homeRank;
    const now = relevantControl(after, move.to);
    const beforeControl = relevantControl(before, move.from);
    const gained = now.filter((square) => !beforeControl.includes(square));
    const supports = now.filter((square) => pawn(after, square, move.color));
    if (develops || gained.length || supports.length) return {
      theme: develops ? "Develop with a central task" : "Give the piece a job",
      text: `${move.san} ${develops ? `develops the ${NAMES[move.piece]} from its starting square ${move.from}` : `reroutes the ${NAMES[move.piece]} from ${move.from} to ${move.to}`}.${gained.length ? ` From ${move.to} it gains legal access to ${gained.join(" and ")}${supports.some((square) => gained.includes(square)) ? ", including a recapture square for your central pawn" : ""}.` : supports.length ? ` It can still recapture on ${supports.join(" and ")} if your central pawn is exchanged.` : " Its new square does not add a legal attack on d4, e4, d5, or e5."}`,
      squares: unique([move.from, move.to, ...gained, ...supports]),
      takeaway: develops
        ? "Develop toward a specific job in the centre, then coordinate the remaining pieces. A developed piece can still be tactically vulnerable; check the opponent's reply."
        : "Judge a knight or bishop route by the squares it can actually influence, not just whether the destination looks active. Recheck pins before counting defenders.",
    };
  }
  if (move.piece === "r" && !move.captured && ["c", "d", "e"].includes(move.to[0])) {
    const ownPawns = after.board().flat().filter((piece) => piece?.type === "p" && piece.color === move.color && piece.square[0] === move.to[0]);
    const enemyPawns = after.board().flat().filter((piece) => piece?.type === "p" && piece.color !== move.color && piece.square[0] === move.to[0]);
    if (!ownPawns.length) return {
      theme: "Put the rook on a useful file",
      text: `${move.san} places your rook on the ${move.to[0]}-file, which has ${enemyPawns.length ? "no pawn of yours but still has an opposing pawn" : "no pawns of either colour"}. Other pieces can still obstruct the rook.`,
      squares: [move.from, move.to, ...enemyPawns.map((piece) => piece!.square)],
      takeaway: "An open or half-open file gives a rook a route, not an automatic invasion. Check the entry squares and whether another piece blocks access.",
    };
  }
  return undefined;
}

function plainMove(move: Move): string {
  return `${move.san} ${move.captured ? `captures the ${NAMES[move.captured]} on ${move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to}` : `moves your ${NAMES[move.piece]} from ${move.from} to ${move.to}`}${move.san.includes("+") ? " with check" : ""}.`;
}

function reply(branch: Branch, family: OpeningFamily): { text: string; squares: string[] } | undefined {
  const move = branch.moves[1];
  if (!move) return undefined;
  const observation = observe(branch.boards[1], branch.boards[2], move, family);
  // A capture/check deserves explicit priority over a positional description.
  const action = move.san.includes("#") ? `${move.san} delivers checkmate.`
    : move.captured ? `${move.san} captures the ${NAMES[move.captured]} on ${move.isEnPassant() ? `${move.to[0]}${move.from[1]}` : move.to}${move.san.includes("+") ? " with check" : ""}.`
      : move.san.includes("+") ? `${move.san} gives check, so the check must be answered.`
        : observation?.text.replaceAll("your ", "their ") ?? `${move.san} moves the ${NAMES[move.piece]} from ${move.from} to ${move.to}.`;
  return { text: `The engine's continuation shows ${action}`, squares: observation?.squares ?? [move.from, move.to] };
}

/** Describes board changes, never assigns a grade or infers why a score fell.
 * Both PVs are replayed in full before any teaching claim is emitted.
 */
export function positionalLesson(input: PositionLessonInput): PositionLesson | undefined {
  const played = replay(input.beforeFen, input.playedLine, input.playedMove);
  const best = replay(input.beforeFen, input.bestLine, input.bestMove);
  if (!played || !best) return undefined;
  const own = observe(played.boards[0], played.boards[1], played.moves[0], input.family);
  const differentMove = moveToUci(played.moves[0]) !== moveToUci(best.moves[0]);
  const other = differentMove ? observe(best.boards[0], best.boards[1], best.moves[0], input.family) : undefined;
  if (!own && !other) return undefined;
  const main = own ?? other!;
  const yourMove = own?.text ?? plainMove(played.moves[0]);
  const response = reply(played, input.family);
  const bestResponse = differentMove ? reply(best, input.family) : undefined;
  const sound = input.classification === "good" || input.classification === "excellent";
  const alternative = differentMove
    ? `${sound ? "Another playable option: " : "The engine's preferred move: "}${other?.text ?? `${plainMove(best.moves[0])} A specific positional purpose has not yet been established for this move.`}${bestResponse ? ` ${bestResponse.text}` : ""}${sound ? " These plans can differ without your move being a mistake." : ""}`
    : undefined;
  const evidence: PositionLesson["evidence"] = [];
  if (own) evidence.push({ kind: "position", text: own.text, squares: own.squares, line: "played", ply: 1 });
  if (response) evidence.push({ kind: "position", text: response.text, squares: response.squares, line: "played", ply: 2 });
  if (other) evidence.push({ kind: "position", text: other.text, squares: other.squares, line: "best", ply: 1 });
  if (bestResponse) evidence.push({ kind: "position", text: bestResponse.text, squares: bestResponse.squares, line: "best", ply: 2 });
  return { theme: main.theme, yourMove, ...(response ? { opponentReply: response.text } : {}), ...(alternative ? { alternative } : {}), takeaway: (sound ? main : other ?? main).takeaway, evidence };
}
