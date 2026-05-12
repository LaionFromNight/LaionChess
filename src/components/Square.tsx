import { type Square } from '../chess/types';
import { getPieceLabel } from '../chess/logic';
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
  const isLight = (row + col) % 2 === 0;

  let bgColor = isLight ? '#f0d9b5' : '#b58863';
  if (isSelected) bgColor = '#7fc97f';
  else if (isLastMoveFrom || isLastMoveTo)
    bgColor = isLight ? '#f7f769' : '#bca13a';

  let squareClassName = '';
  if (isCheckmateSquare) squareClassName = 'checkmate-square';
  else if (isCheckSquare) squareClassName = 'check-square';

  const pieceFontSize = squarePx ? `${Math.round(squarePx * 0.70)}px` : 'clamp(24px, 5vw, 52px)';
  const coordFontSize = squarePx ? `${Math.max(8, Math.round(squarePx * 0.17))}px` : 'clamp(8px, 1.2vw, 12px)';

  const pieceStyle = piece ? {
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
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: bgColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        position: 'relative',
        fontSize: pieceFontSize,
        userSelect: 'none',
      }}
      onClick={onClick}
    >
      {piece && !hidePiece && <span style={pieceStyle}>{getPieceLabel(piece)}</span>}

      {isValidMove && !piece && (
        <span style={{
          position: 'absolute',
          width: '30%', height: '30%',
          borderRadius: '50%',
          backgroundColor: 'rgba(0,0,0,0.2)',
        }} />
      )}
      {isValidMove && piece && (
        <span style={{
          position: 'absolute',
          width: '90%', height: '90%',
          borderRadius: '50%',
          border: '4px solid rgba(0,0,0,0.25)',
        }} />
      )}

      {col === 0 && (
        <span style={{
          position: 'absolute', top: 2, left: 4,
          fontSize: coordFontSize,
          color: isLight ? '#b58863' : '#f0d9b5',
          fontWeight: 'bold',
        }}>
          {8 - row}
        </span>
      )}
      {row === 7 && (
        <span style={{
          position: 'absolute', bottom: 2, right: 4,
          fontSize: coordFontSize,
          color: isLight ? '#b58863' : '#f0d9b5',
          fontWeight: 'bold',
        }}>
          {String.fromCharCode(97 + col)}
        </span>
      )}
    </div>
  );
}
