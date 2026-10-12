import { Chess, type PieceSymbol, type Square } from "chess.js";

import type { LearnerColor, OpeningFamily } from "./curriculum";

export type TacticTheme =
  | "mate"
  | "mateIn1"
  | "mateIn2"
  | "mateIn3"
  | "backRankMate"
  | "smotheredMate"
  | "arabianMate"
  | "bodenMate"
  | "fork"
  | "skewer"
  | "discoveredAttack"
  | "deflection"
  | "sacrifice"
  | "promotion"
  | "zwischenzug"
  | "hangingPiece";

export type TacticPuzzle = {
  id: string;
  /**
   * Lichess semantics: this is the position before the opponent's final move.
   * Apply moves[0] before showing the board to the learner.
   */
  fenBeforeOpponentMove: string;
  /** UCI moves. Index 0 is the opponent setup move; the solution starts at index 1. */
  moves: readonly [string, ...string[]];
  learnerColor: LearnerColor;
  rating: number;
  ratingDeviation: number;
  popularity: number;
  nbPlays: number;
  themes: readonly TacticTheme[];
  phase: "opening" | "middlegame" | "endgame";
  openingFamily?: OpeningFamily;
  openingTag?: string;
  prompt: string;
  explanation: string;
  source: "starter-original" | "classic-pattern";
};

/**
 * Small, deterministic starter set. Ratings and engagement fields are local
 * seed values, not claimed Lichess statistics. Replace or recalibrate them as
 * learner attempts accumulate.
 */
export const starterTactics = [
  {
    id: "starter-fools-mate",
    fenBeforeOpponentMove: "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2",
    moves: ["g2g4", "d8h4"],
    learnerColor: "black",
    rating: 650,
    ratingDeviation: 90,
    popularity: 96,
    nbPlays: 0,
    themes: ["mate", "mateIn1"],
    phase: "opening",
    openingTag: "Fool's Mate pattern",
    prompt: "White's last pawn move opened a diagonal to the king. Find the immediate finish.",
    explanation: "...Qh4# uses the newly opened e1-h4 diagonal; White cannot block, capture the queen, or give the king a flight square.",
    source: "classic-pattern",
  },
  {
    id: "starter-scholars-mate",
    fenBeforeOpponentMove: "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3",
    moves: ["g8f6", "h5f7"],
    learnerColor: "white",
    rating: 700,
    ratingDeviation: 90,
    popularity: 95,
    nbPlays: 0,
    themes: ["mate", "mateIn1"],
    phase: "opening",
    openingTag: "King's Pawn early queen attack",
    prompt: "Black developed while overlooking the weakest starting pawn. Finish the attack.",
    explanation: "Qxf7# is protected by the bishop on c4 and attacks the king on e8; every escape or interposition is covered.",
    source: "classic-pattern",
  },
  {
    id: "starter-legal-mate",
    fenBeforeOpponentMove: "rn1qkbnr/ppp2p1p/3p2p1/4N3/2B1P1b1/2N5/PPPP1PPP/R1BQK2R b KQkq - 0 5",
    moves: ["g4d1", "c4f7", "e8e7", "c3d5"],
    learnerColor: "white",
    rating: 1050,
    ratingDeviation: 85,
    popularity: 97,
    nbPlays: 0,
    themes: ["mate", "mateIn2", "sacrifice", "zwischenzug"],
    phase: "opening",
    openingTag: "Legal mate pattern",
    prompt: "Black accepted the queen. Ignore material and calculate forcing moves against the exposed king.",
    explanation: "Bxf7+ forces Ke7, after which Nd5# closes every flight square. The queen was a decoy; king safety decides the position.",
    source: "classic-pattern",
  },
  {
    id: "starter-back-rank-one",
    fenBeforeOpponentMove: "6k1/p4ppp/8/8/8/8/8/4R1K1 b - - 0 1",
    moves: ["a7a6", "e1e8"],
    learnerColor: "white",
    rating: 725,
    ratingDeviation: 95,
    popularity: 92,
    nbPlays: 0,
    themes: ["mate", "mateIn1", "backRankMate"],
    phase: "endgame",
    prompt: "The king is boxed in by its own pawns. Use the open file.",
    explanation: "Re8# checks along the eighth rank; the three pawns remove all downward flight squares and there is no piece available to interpose.",
    source: "starter-original",
  },
  {
    id: "starter-knight-royal-fork",
    fenBeforeOpponentMove: "6k1/8/8/8/3n4/8/P4PPP/2Q2RK1 w - - 0 1",
    moves: ["a2a3", "d4e2", "g1h1", "e2c1"],
    learnerColor: "black",
    rating: 850,
    ratingDeviation: 90,
    popularity: 91,
    nbPlays: 0,
    themes: ["fork"],
    phase: "middlegame",
    prompt: "Find a knight check that also attacks White's most valuable loose piece.",
    explanation: "...Ne2+ forces the king away and the knight then takes the queen on c1. The forcing check gives White no tempo to save it.",
    source: "starter-original",
  },
  {
    id: "starter-rook-skewer",
    fenBeforeOpponentMove: "r5k1/8/8/8/8/8/1P4KQ/8 w - - 0 1",
    moves: ["b2b3", "a8a2", "g2h3", "a2h2"],
    learnerColor: "black",
    rating: 900,
    ratingDeviation: 90,
    popularity: 90,
    nbPlays: 0,
    themes: ["skewer"],
    phase: "endgame",
    prompt: "Line up the king and queen with a forcing rook move.",
    explanation: "...Ra2+ forces the king off the second rank, exposing the queen on h2 to ...Rxh2+. The king is the front target in the skewer.",
    source: "starter-original",
  },
  {
    id: "starter-discovered-queen-attack",
    fenBeforeOpponentMove: "3r2k1/8/8/2b5/3b4/8/5PPP/3Q2K1 w - - 0 1",
    moves: ["h2h3", "d4f2", "g1h1", "d8d1"],
    learnerColor: "black",
    rating: 1025,
    ratingDeviation: 90,
    popularity: 93,
    nbPlays: 0,
    themes: ["discoveredAttack", "hangingPiece"],
    phase: "middlegame",
    prompt: "Move the blocking bishop with tempo and uncover the rook's attack on the queen.",
    explanation: "...Bxf2+ vacates the d-file while checking. After the king moves, ...Rxd1+ wins the queen before it can escape.",
    source: "starter-original",
  },
  {
    id: "starter-promotion-mate",
    fenBeforeOpponentMove: "6k1/q3Pppp/8/8/8/8/8/6K1 b - - 0 1",
    moves: ["a7a6", "e7e8q"],
    learnerColor: "white",
    rating: 775,
    ratingDeviation: 95,
    popularity: 94,
    nbPlays: 0,
    themes: ["mate", "mateIn1", "promotion", "backRankMate"],
    phase: "endgame",
    prompt: "Promote with tempo and use the king's own pawns as a cage.",
    explanation: "e8=Q# promotes to a checking queen on the eighth rank. The pawns on f7, g7, and h7 leave their king no escape.",
    source: "starter-original",
  },
  {
    id: "starter-deflection-back-rank",
    fenBeforeOpponentMove: "5rk1/p3Qppp/8/1B6/8/8/8/4R1K1 b - - 0 1",
    moves: ["a7a6", "e7f8", "g8f8", "e1e8"],
    learnerColor: "white",
    rating: 1100,
    ratingDeviation: 85,
    popularity: 96,
    nbPlays: 0,
    themes: ["mate", "mateIn2", "deflection", "sacrifice", "backRankMate"],
    phase: "middlegame",
    prompt: "Remove the back-rank defender and lure the king onto the rook's mating line.",
    explanation: "Qxf8+ sacrifices the queen to remove Black's rook and force ...Kxf8. Re8# is protected by Bb5, while Black's own pawns close every flight square.",
    source: "starter-original",
  },
  {
    id: "starter-boden-mate",
    fenBeforeOpponentMove: "2kr4/1p1p4/2Q5/8/2B2B2/8/8/6K1 b - - 0 1",
    moves: ["b7c6", "c4a6"],
    learnerColor: "white",
    rating: 1125,
    ratingDeviation: 85,
    popularity: 96,
    nbPlays: 0,
    themes: ["mate", "mateIn1", "sacrifice", "bodenMate"],
    phase: "middlegame",
    prompt: "Black captured the checking queen and opened a diagonal. Find the crossing-bishop mate.",
    explanation: "Ba6# uses one bishop to check through b7 while the f4-bishop covers b8 and c7. Black's own rook and pawn close the other exits.",
    source: "classic-pattern",
  },
  {
    id: "starter-smothered-mate",
    fenBeforeOpponentMove: "5rk1/6pp/4Q2N/8/8/8/8/6K1 b - - 0 1",
    moves: ["g8h8", "e6g8", "f8g8", "h6f7"],
    learnerColor: "white",
    rating: 1175,
    ratingDeviation: 85,
    popularity: 98,
    nbPlays: 0,
    themes: ["mate", "mateIn2", "smotheredMate", "sacrifice", "deflection"],
    phase: "middlegame",
    prompt: "Force a rook onto the king's last flight square, then let the knight finish.",
    explanation: "Qg8+ compels ...Rxg8; Nf7# checks a king completely boxed in by its own rook and pawns.",
    source: "classic-pattern",
  },
  {
    id: "starter-arabian-mate",
    fenBeforeOpponentMove: "7k/p5pp/5N2/8/8/8/8/6KR b - - 0 1",
    moves: ["a7a6", "h1h7"],
    learnerColor: "white",
    rating: 825,
    ratingDeviation: 90,
    popularity: 95,
    nbPlays: 0,
    themes: ["mate", "mateIn1", "arabianMate"],
    phase: "endgame",
    prompt: "The knight covers the two squares a rook needs. Find the mating capture.",
    explanation: "Rxh7# is protected by Nf6, which also covers g8. The pawn on g7 completes the king's cage.",
    source: "classic-pattern",
  },
  {
    id: "starter-bishop-fork",
    fenBeforeOpponentMove: "6k1/p4p2/8/7q/2B5/8/8/5RK1 b - - 0 1",
    moves: ["a7a6", "c4f7", "g8h8", "f7h5"],
    learnerColor: "white",
    rating: 875,
    ratingDeviation: 90,
    popularity: 91,
    nbPlays: 0,
    themes: ["fork"],
    phase: "middlegame",
    prompt: "Use a protected bishop check that also attacks the queen.",
    explanation: "Bxf7+ is protected by the rook on f1 and forks king and queen. After ...Kh8, Bxh5 wins the queen.",
    source: "starter-original",
  },
  {
    id: "starter-pawn-fork",
    fenBeforeOpponentMove: "6k1/p2q1r2/8/4P3/8/8/8/6K1 b - - 0 1",
    moves: ["a7a6", "e5e6", "d7e8", "e6f7"],
    learnerColor: "white",
    rating: 800,
    ratingDeviation: 95,
    popularity: 90,
    nbPlays: 0,
    themes: ["fork"],
    phase: "endgame",
    prompt: "Advance the pawn to attack two major pieces at once.",
    explanation: "e6 forks the queen on d7 and rook on f7. After the queen moves, exf7+ wins the exchange with tempo.",
    source: "starter-original",
  },
] as const satisfies readonly TacticPuzzle[];

function uciMove(uci: string): {
  from: Square;
  to: Square;
  promotion?: PieceSymbol;
} {
  const from = uci.slice(0, 2) as Square;
  const to = uci.slice(2, 4) as Square;
  const promotion = uci[4] as PieceSymbol | undefined;

  return promotion ? { from, to, promotion } : { from, to };
}

/** Returns the exact FEN the learner should see after the opponent setup move. */
export function getPresentedFen(puzzle: TacticPuzzle): string {
  const chess = new Chess(puzzle.fenBeforeOpponentMove);
  chess.move(uciMove(puzzle.moves[0]));
  return chess.fen();
}
