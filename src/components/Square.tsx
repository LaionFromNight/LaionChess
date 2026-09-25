import { type Square } from '../chess/types';
import { getPieceLabel } from '../chess/logic';
import { useSettings } from '../settings/useSettings';
import { pieceSrc, pieceCode } from '../board/pieceSrc';
import '../App.css';

interface SquareProps {
  piece: Square;
  row: number;
  col: number;
  flipped?: boolean;
  showRank: boolean;
  showFile: boolean;
  isSelected: boolean;
  isValidMove: boolean;
  isLastMove: boolean;
  isCheckSquare: boolean;
  isCheckmateSquare: boolean;
  onClick: () => void;
  squarePx: number;
  hidePiece?: boolean;
}

export default function Square({
  piece,
  row,
  col,
  flipped,
  showRank,
  showFile,
  isSelected,
  isValidMove,
  isLastMove,
  isCheckSquare,
  isCheckmateSquare,
  onClick,
  squarePx,
  hidePiece,
}: SquareProps) {
  const { settings } = useSettings();
  const isLight = (row + col) % 2 === 0;

  let cls = `lc-sq ${isLight ? 'light' : 'dark'}`;
  if (isLastMove) cls += ' last';
  if (isSelected) cls += ' selected';
  if (isCheckmateSquare) cls += ' checkmate-square';
  else if (isCheckSquare) cls += ' check-square';

  const src = piece ? pieceSrc(settings.pieceSet, piece.color, piece.type) : null;

  return (
    <div
      className={cls}
      data-square={`${String.fromCharCode(97 + col)}${8 - row}`}
      style={{
        fontSize: Math.round(squarePx * 0.72),
        // Counter-rotate so pieces and coordinates stay upright on a flipped board.
        transform: flipped ? 'rotate(180deg)' : undefined,
      }}
      onClick={onClick}
    >
      {piece && !hidePiece && (
        src
          ? <img className="lc-piece-img" src={src} alt={pieceCode(piece.color, piece.type)} draggable={false} />
          : <span className={`glyph ${piece.color}`}>{getPieceLabel(piece)}</span>
      )}

      {isValidMove && <span className={piece ? 'lc-capture' : 'lc-dot'} />}

      {settings.coords && showRank && (
        <span className="coord rank" style={{ fontSize: Math.max(9, Math.round(squarePx * 0.17)) }}>{8 - row}</span>
      )}
      {settings.coords && showFile && (
        <span className="coord file" style={{ fontSize: Math.max(9, Math.round(squarePx * 0.17)) }}>{String.fromCharCode(97 + col)}</span>
      )}
    </div>
  );
}
