import { useRef } from 'react';
import { Square, Position } from '../chess/types';
import SquareComponent from './Square';
import { useSettings, BOARD_THEMES } from '../settings/useSettings';
import '../App.css';

const BOARD_MIN_PX = 240;

export interface BoardArrow {
  from: Position;
  to: Position;
  color: string;
  width: number;
}

/** Renders board arrows in 0..100 SVG space (mirrors prototype js/board.js addArrow). */
function ArrowsLayer({ arrows }: { arrows: BoardArrow[] }) {
  if (arrows.length === 0) return null;
  return (
    <svg className="lc-arrows" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      {arrows.map((a, i) => {
        const x1 = a.from.col * 12.5 + 6.25, y1 = a.from.row * 12.5 + 6.25;
        const x2 = a.to.col * 12.5 + 6.25, y2 = a.to.row * 12.5 + 6.25;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len, uy = dy / len;
        const x2s = x2 - ux * 4.4, y2s = y2 - uy * 4.4;
        const px = -uy, py = ux;
        const tipX = x2 - ux * 1.2, tipY = y2 - uy * 1.2;
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2s} y2={y2s} stroke={a.color} strokeWidth={a.width} strokeLinecap="round" />
            <polygon
              points={`${x2s + px * 2.4},${y2s + py * 2.4} ${x2s - px * 2.4},${y2s - py * 2.4} ${tipX},${tipY}`}
              fill={a.color}
            />
          </g>
        );
      })}
    </svg>
  );
}

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
  arrows?: BoardArrow[];
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
  arrows,
}: BoardProps) {
  const { settings } = useSettings();
  const theme = BOARD_THEMES[settings.boardTheme] ?? BOARD_THEMES.classic;
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
      <div className="lc-board-grid" style={{
        width: dim, height: dim,
        ['--sq-light' as string]: theme.light,
        ['--sq-dark' as string]: theme.dark,
        ['--coord-on-light' as string]: theme.coordL,
        ['--coord-on-dark' as string]: theme.coordD,
      } as React.CSSProperties}>
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

        {/* Arrows overlay (z=6) — Top-3 book moves, trainer hints */}
        {arrows && arrows.length > 0 && <ArrowsLayer arrows={arrows} />}

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
