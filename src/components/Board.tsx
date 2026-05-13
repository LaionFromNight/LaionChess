import { useRef } from 'react';
import { Square, Position } from '../chess/types';
import SquareComponent from './Square';
import '../App.css';

const BOARD_MIN_PX = 240;

interface BoardProps {
  board: Square[][];
  selectedPos: Position | null;
  validMoves: Position[];
  lastMove: { from: Position; to: Position } | null;
  checkSquare: Position | null;
  enPassantTarget: Position | null;
  whiteCanCastleKingside: boolean;
  whiteCanCastleQueenside: boolean;
  blackCanCastleKingside: boolean;
  blackCanCastleQueenside: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  currentTurn: 'white' | 'black';
  onSquareClick: (pos: Position) => void;
  onResize?: (size: number) => void;
  overlay?: React.ReactNode;
  animOverlay?: React.ReactNode;
  interactiveOverlay?: React.ReactNode;
  hidePieceAt?: Position | null;
  boardSize?: number;
}

export default function Board({
  board,
  selectedPos,
  validMoves,
  lastMove,
  checkSquare,
  enPassantTarget,
  whiteCanCastleKingside,
  whiteCanCastleQueenside,
  blackCanCastleKingside,
  blackCanCastleQueenside,
  isCheck,
  isCheckmate,
  isStalemate,
  currentTurn,
  onSquareClick,
  onResize,
  overlay,
  animOverlay,
  interactiveOverlay,
  hidePieceAt,
  boardSize,
}: BoardProps) {
  const dim = boardSize ? `${boardSize}px` : 'min(80vw, 560px)';
  const squarePx = boardSize ? Math.round(boardSize / 8) : undefined;

  const dragRef = useRef<{ startX: number; startY: number; startSize: number } | null>(null);

  const handleResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onResize) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startSize: boardSize ?? 560 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !onResize) return;
    const { startX, startY, startSize } = dragRef.current;
    const delta = Math.round((e.clientX - startX + (e.clientY - startY)) / 2);
    onResize(Math.max(BOARD_MIN_PX, startSize + delta));
  };

  const handleResizeUp = () => { dragRef.current = null; };

  const isValidMove = (row: number, col: number) =>
    validMoves.some((m) => m.row === row && m.col === col);

  const isLastMoveSquare = (row: number, col: number) =>
    lastMove &&
    ((lastMove.from.row === row && lastMove.from.col === col) ||
      (lastMove.to.row === row && lastMove.to.col === col));

  const winner = isCheckmate ? (currentTurn === 'white' ? 'Black' : 'White') : null;

  // Build castling hint text — always reserve space so layout never shifts
  const castleText = (() => {
    if (isCheck) return null;
    const ks = currentTurn === 'white' ? whiteCanCastleKingside  : blackCanCastleKingside;
    const qs = currentTurn === 'white' ? whiteCanCastleQueenside : blackCanCastleQueenside;
    const side = currentTurn === 'white' ? 'White' : 'Black';
    if (ks && qs) return `${side} can castle kingside (O-O) | ${side} can castle queenside (O-O-O)`;
    if (ks) return `${side} can castle kingside (O-O)`;
    if (qs) return `${side} can castle queenside (O-O-O)`;
    return null;
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, position: 'relative' }}>

      {/* Castling hints — fixed height so board never jumps */}
      <div style={{
        fontSize: 12, color: '#888', textAlign: 'center',
        height: 18, lineHeight: '18px', overflow: 'hidden',
      }}>
        {castleText ?? <span style={{ visibility: 'hidden' }}>placeholder</span>}
      </div>

      {/* Board grid */}
      <div style={{
        width: dim, height: dim,
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 1fr)',
        gridTemplateRows: 'repeat(8, 1fr)',
        border: '3px solid #5a3a1a',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        position: 'relative',
      }}>
        {board.map((row, rowIdx) =>
          row.map((piece, colIdx) => (
            <SquareComponent
              key={`${rowIdx}-${colIdx}`}
              piece={piece}
              row={rowIdx}
              col={colIdx}
              isSelected={selectedPos?.row === rowIdx && selectedPos?.col === colIdx}
              isValidMove={isValidMove(rowIdx, colIdx)}
              isLastMoveFrom={!!isLastMoveSquare(rowIdx, colIdx)}
              isLastMoveTo={!!isLastMoveSquare(rowIdx, colIdx)}
              isCheckSquare={!!checkSquare && checkSquare.row === rowIdx && checkSquare.col === colIdx}
              isCheckmateSquare={!!isCheckmate && checkSquare?.row === rowIdx && checkSquare?.col === colIdx}
              onClick={() => onSquareClick({ row: rowIdx, col: colIdx })}
              squarePx={squarePx}
              hidePiece={
                hidePieceAt != null &&
                hidePieceAt.row === rowIdx &&
                hidePieceAt.col === colIdx
              }
            />
          ))
        )}

        {/* Spotting overlay (z=5) */}
        {overlay && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}>
            {overlay}
          </div>
        )}

        {/* Animated piece overlay (z=30) */}
        {animOverlay && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'none' }}>
            {animOverlay}
          </div>
        )}

        {/* Interactive overlay — pointer events on (z=50) */}
        {interactiveOverlay && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 50 }}>
            {interactiveOverlay}
          </div>
        )}

        {/* Resize handle */}
        {onResize && (
          <div
            onPointerDown={handleResizeDown}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeUp}
            title="Drag to resize board"
            style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 28, height: 28,
              cursor: 'nwse-resize',
              zIndex: 60,
              display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
              padding: 5,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" style={{ pointerEvents: 'none' }}>
              <line x1="2" y1="13" x2="13" y2="2" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="6" y1="13" x2="13" y2="6" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="10" y1="13" x2="13" y2="10" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
        )}

        {/* Checkmate overlay */}
        {isCheckmate && winner && (
          <div className="checkmate-overlay" style={{
            position: 'absolute', inset: 0,
            backgroundColor: 'rgba(0,0,0,0.75)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            zIndex: 10, borderRadius: '2px',
          }}>
            <div style={{
              fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 900,
              color: '#ff0040', letterSpacing: 6, textTransform: 'uppercase', marginBottom: 12,
            }}>Checkmate!</div>
            <div className="winner-text" style={{
              fontSize: 'clamp(20px, 3.5vw, 36px)', fontWeight: 700,
              color: '#ffd700', letterSpacing: 3, textTransform: 'uppercase',
            }}>{winner} wins!</div>
          </div>
        )}
      </div>
    </div>
  );
}
