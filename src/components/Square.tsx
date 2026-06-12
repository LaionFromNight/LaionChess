import { type Square } from '../chess/types';
import { getPieceLabel } from '../chess/logic';
import { useSettings } from '../settings/useSettings';
import { pieceSrc, pieceCode } from '../board/pieceSrc';
import '../App.css';

interface SquareProps {
  piece: Square;
  row: number;
  col: number;
  isSelected: boolean;
  isValidMove: boolean;
  isLastMoveFrom: boolean;
  isLastMoveTo: boolean;
  isCheckSquare: boolean;
  isCheckmateSquare: boolean;
  onClick: () => void;
  squarePx?: number;
  hidePiece?: boolean;
}

export default function Square({
  piece,
  row,
  col,
  isSelected,
  isValidMove,
  isLastMoveFrom,
  isLastMoveTo,
  isCheckSquare,
  isCheckmateSquare,
  onClick,
  squarePx,
  hidePiece,
}: SquareProps) {
  const { settings } = useSettings();
  const isLight = (row + col) % 2 === 0;

  const isLastMove = isLastMoveFrom || isLastMoveTo;

  let squareClassName = `lc-sq ${isLight ? 'light' : 'dark'}`;
  if (isCheckmateSquare) squareClassName += ' checkmate-square';
  else if (isCheckSquare) squareClassName += ' check-square';

  const pieceFontSize = squarePx ? `${Math.round(squarePx * 0.70)}px` : 'clamp(24px, 5vw, 52px)';
  const coordFontSize = squarePx ? `${Math.max(8, Math.round(squarePx * 0.17))}px` : 'clamp(8px, 1.2vw, 12px)';

  const src = piece ? pieceSrc(settings.pieceSet, piece.color, piece.type) : null;

  const glyphStyle = piece ? {
    lineHeight: 1,
    color: piece.color === 'white' ? '#ffffff' : '#1a1a1a',
    textShadow: piece.color === 'white'
      ? '0 0 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.4)'
      : '0 0 3px rgba(255,255,255,0.5)',
    filter: piece.color === 'white' ? 'drop-shadow(0 0 1px rgba(0,0,0,0.9))' : 'none',
  } as React.CSSProperties : undefined;

  return (
    <div
      className={squareClassName}
      data-square={`${String.fromCharCode(97 + col)}${8 - row}`}
      style={{ fontSize: pieceFontSize }}
      onClick={onClick}
    >
      {/* last-move tint (below pieces) */}
      {isLastMove && (
        <span style={{ position: 'absolute', inset: 0, background: 'rgba(255,217,61,0.30)', pointerEvents: 'none' }} />
      )}
      {/* selection ring */}
      {isSelected && (
        <span style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'rgba(0,255,255,0.28)', boxShadow: 'inset 0 0 0 3px rgba(0,255,255,0.65)',
        }} />
      )}

      {piece && !hidePiece && (
        src
          ? <img className="lc-piece-img" src={src} alt={pieceCode(piece.color, piece.type)} draggable={false} />
          : <span style={glyphStyle}>{getPieceLabel(piece)}</span>
      )}

      {isValidMove && !piece && (
        <span style={{
          position: 'absolute', width: '30%', height: '30%', borderRadius: '50%',
          backgroundColor: 'rgba(0,0,0,0.22)', pointerEvents: 'none',
        }} />
      )}
      {isValidMove && piece && (
        <span style={{
          position: 'absolute', width: '90%', height: '90%', borderRadius: '50%',
          border: '4px solid rgba(0,0,0,0.25)', pointerEvents: 'none',
        }} />
      )}

      {settings.coords && col === 0 && (
        <span className="coord rank" style={{ fontSize: coordFontSize }}>{8 - row}</span>
      )}
      {settings.coords && row === 7 && (
        <span className="coord file" style={{ fontSize: coordFontSize }}>{String.fromCharCode(97 + col)}</span>
      )}
    </div>
  );
}
