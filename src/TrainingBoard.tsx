import { Chess, type Square } from "chess.js";
import { Chessboard, type Arrow } from "react-chessboard";
import { useId, useState } from "react";

export function TrainingBoard({ fen, orientation, onMove, disabled = false, hintMove, arrows = [], highlightSquares = [], showKeyboardEntry = true, label = "Chess position" }: {
  fen: string;
  orientation: "white" | "black";
  onMove?: (uci: string) => boolean;
  disabled?: boolean;
  hintMove?: string | null;
  arrows?: Arrow[];
  highlightSquares?: string[];
  showKeyboardEntry?: boolean;
  label?: string;
}) {
  const keyboardId = useId();
  const [selection, setSelection] = useState<{ fen: string; square: string } | null>(null);
  const [keyboardEntry, setKeyboardEntry] = useState<{ fen: string; value: string } | null>(null);
  const [promotion, setPromotion] = useState<{ fen: string; from: Square; to: Square; choices: Array<"q" | "r" | "b" | "n"> } | null>(null);
  const selected = selection?.fen === fen ? selection.square : null;
  const keyboardMove = keyboardEntry?.fen === fen ? keyboardEntry.value : "";
  const pendingPromotion = promotion?.fen === fen ? promotion : null;
  const styles: Record<string, React.CSSProperties> = {};
  for (const square of highlightSquares) styles[square] = { boxShadow: "inset 0 0 0 4px rgba(154,90,12,.65)" };
  if (selected) styles[selected] = { boxShadow: "inset 0 0 0 4px #c58b36" };
  if (hintMove) {
    styles[hintMove.slice(0, 2)] = { boxShadow: "inset 0 0 0 4px #c58b36" };
    styles[hintMove.slice(2, 4)] = { background: "#d4a85f" };
  }

  const tryMove = (from: string, to: string): "moved" | "promotion" | "invalid" => {
    if (!onMove || disabled || pendingPromotion) return "invalid";
    const board = new Chess(fen);
    const candidates = board.moves({ verbose: true, square: from as Square }).filter((move) => move.to === to);
    if (!candidates.length) return "invalid";
    const promotionChoices = candidates.map((move) => move.promotion).filter((piece): piece is "q" | "r" | "b" | "n" => piece === "q" || piece === "r" || piece === "b" || piece === "n");
    if (promotionChoices.length) {
      setPromotion({ fen, from: from as Square, to: to as Square, choices: [...new Set(promotionChoices)] });
      return "promotion";
    }
    return onMove(`${from}${to}`) ? "moved" : "invalid";
  };

  return (
    <div className="board-input-group" role="group" aria-label={label}>
      <div className="chessboard-frame">
        <Chessboard options={{
        id: label.replace(/\s+/g, "-").toLowerCase(),
        position: fen,
        boardOrientation: orientation,
        allowDragging: !disabled && !pendingPromotion,
        allowDrawingArrows: false,
        arrows,
        clearArrowsOnClick: false,
        clearArrowsOnPositionChange: false,
        arrowOptions: {
          colors: { default: "#bd8331", shift: "#526f8b", ctrl: "#a95438", alt: "#214d3b", meta: "#214d3b" },
          color: "#bd8331",
          secondaryColor: "#526f8b",
          tertiaryColor: "#a95438",
          arrowLengthReducerDenominator: 8,
          sameTargetArrowLengthReducerDenominator: 4,
          arrowWidthDenominator: 9,
          activeArrowWidthMultiplier: 1.15,
          opacity: 0.96,
          activeOpacity: 1,
          arrowStartOffset: 0,
        },
        showNotation: true,
        animationDurationInMs: 220,
        darkSquareStyle: { backgroundColor: "#66806a" },
        lightSquareStyle: { backgroundColor: "#dfe0cb" },
        squareStyles: styles,
        boardStyle: { boxShadow: "0 18px 42px rgba(24,32,28,.18)" },
        onPieceDrop: ({ sourceSquare, targetSquare }) => {
          if (!targetSquare) return false;
          const result = tryMove(sourceSquare, targetSquare);
          if (result !== "invalid") setSelection(null);
          return result === "moved";
        },
        onSquareClick: ({ square }) => {
          if (disabled || pendingPromotion) return;
          if (selected) {
            const result = tryMove(selected, square);
            setSelection(result !== "invalid" ? null : { fen, square });
            return;
          }
          const board = new Chess(fen);
          if (board.get(square as Square)?.color === board.turn()) setSelection({ fen, square });
        },
        }} />
      </div>
      {onMove && !disabled && showKeyboardEntry ? <form className="keyboard-move" onSubmit={(event) => { event.preventDefault(); const normalized = keyboardMove.trim().toLowerCase(); if (normalized && onMove(normalized)) setKeyboardEntry(null); }}><label htmlFor={keyboardId}>Keyboard move (for example, e2e4)</label><input id={keyboardId} value={keyboardMove} onChange={(event) => setKeyboardEntry({ fen, value: event.target.value })} inputMode="text" autoComplete="off" pattern="[a-hA-H][1-8][a-hA-H][1-8][qQrRbBnN]?" placeholder="e2e4" /><button type="submit" disabled={!keyboardMove.trim()}>Play</button></form> : null}
      {pendingPromotion ? <div className="promotion-picker" role="dialog" aria-label="Choose promotion piece"><strong>Promote to</strong>{pendingPromotion.choices.map((piece) => <button type="button" className="secondary-action" key={piece} onClick={() => { if (onMove?.(`${pendingPromotion.from}${pendingPromotion.to}${piece}`)) setPromotion(null); }}>{piece === "q" ? "Queen" : piece === "r" ? "Rook" : piece === "b" ? "Bishop" : "Knight"}</button>)}<button type="button" className="text-button" onClick={() => setPromotion(null)}>Cancel</button></div> : null}
    </div>
  );
}
