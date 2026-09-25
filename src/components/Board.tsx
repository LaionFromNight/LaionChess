import { useEffect, useMemo, useRef, useState } from 'react';
import type { Square, Position } from '../chess/types';
import SquareComponent from './Square';
import { useSettings, BOARD_THEMES } from '../settings/useSettings';
import { pieceSrc, pieceCode } from '../board/pieceSrc';
import { getPieceLabel } from '../chess/logic';
import '../App.css';

const BOARD_MIN_PX = 240;

export interface BoardArrow {
  from: Position;
  to: Position;
  color: string;
  /** Stroke width in board-percent units (12.5 = one square). */
  width: number;
}

// ── user-drawn shapes (right-click drag, lichess style) ───────────────────────
type Brush = 'green' | 'red' | 'blue' | 'yellow';
const BRUSH_COLORS: Record<Brush, string> = {
  green: 'rgba(52, 199, 120, 0.82)',
  red: 'rgba(230, 72, 72, 0.82)',
  blue: 'rgba(66, 133, 244, 0.82)',
  yellow: 'rgba(240, 190, 40, 0.85)',
};
interface UserShape { from: Position; to: Position | null; brush: Brush }

function brushFor(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): Brush {
  const alt = e.altKey || e.ctrlKey || e.metaKey;
  if (e.shiftKey && alt) return 'yellow';
  if (e.shiftKey) return 'red';
  if (alt) return 'blue';
  return 'green';
}

const samePos = (a: Position | null | undefined, b: Position | null | undefined) =>
  !!a && !!b && a.row === b.row && a.col === b.col;

// ── arrow geometry (viewBox 0 0 8 8 — one unit per square) ───────────────────
function arrowGeometry(from: Position, to: Position, width: number) {
  const x1 = from.col + 0.5, y1 = from.row + 0.5;
  const x2 = to.col + 0.5, y2 = to.row + 0.5;
  const dc = to.col - from.col, dr = to.row - from.row;
  const isKnight = (Math.abs(dc) === 1 && Math.abs(dr) === 2) || (Math.abs(dc) === 2 && Math.abs(dr) === 1);

  const headLen = Math.max(0.34, width * 2.3);
  const headHalf = Math.max(0.22, width * 1.55);
  // Knight moves bend: long leg first, then the short leg into the target square.
  const corner = isKnight
    ? (Math.abs(dr) > Math.abs(dc) ? { x: x1, y: y2 } : { x: x2, y: y1 })
    : null;
  const sx = corner ? corner.x : x1, sy = corner ? corner.y : y1;
  const dx = x2 - sx, dy = y2 - sy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tipX = x2 - ux * 0.08, tipY = y2 - uy * 0.08;
  const baseX = tipX - ux * headLen, baseY = tipY - uy * headLen;
  const px = -uy, py = ux;
  const d = corner
    ? `M ${x1} ${y1} L ${corner.x} ${corner.y} L ${baseX} ${baseY}`
    : `M ${x1} ${y1} L ${baseX} ${baseY}`;
  const head = `${tipX},${tipY} ${baseX + px * headHalf},${baseY + py * headHalf} ${baseX - px * headHalf},${baseY - py * headHalf}`;
  return { d, head };
}

function ShapesLayer({ arrows, shapes }: { arrows: BoardArrow[]; shapes: UserShape[] }) {
  if (arrows.length === 0 && shapes.length === 0) return null;
  return (
    <svg className="lc-arrows" viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg">
      {arrows.map((a, i) => {
        if (samePos(a.from, a.to)) return null;
        const w = a.width / 12.5;
        const { d, head } = arrowGeometry(a.from, a.to, w);
        return (
          <g key={`a${i}`}>
            <path d={d} stroke={a.color} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <polygon points={head} fill={a.color} strokeLinejoin="round" />
          </g>
        );
      })}
      {shapes.map((s, i) => {
        const color = BRUSH_COLORS[s.brush];
        if (!s.to || samePos(s.from, s.to)) {
          return <circle key={`s${i}`} cx={s.from.col + 0.5} cy={s.from.row + 0.5} r={0.46} fill="none" stroke={color} strokeWidth={0.075} />;
        }
        const w = 0.19;
        const { d, head } = arrowGeometry(s.from, s.to, w);
        return (
          <g key={`s${i}`}>
            <path d={d} stroke={color} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <polygon points={head} fill={color} />
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
  isCheckmate?: boolean;
  currentTurn: 'white' | 'black';
  onSquareClick: (pos: Position) => void;
  /** Drag-and-drop move. When omitted, pieces can only be moved by clicking. */
  onMove?: (from: Position, to: Position) => void;
  /** Which squares may start a drag (defaults to pieces of the side to move). */
  canDrag?: (pos: Position) => boolean;
  onResize?: (size: number) => void;
  overlay?: React.ReactNode;
  animOverlay?: React.ReactNode;
  interactiveOverlay?: React.ReactNode;
  hidePieceAt?: Position | null;
  boardSize: number;
  arrows?: BoardArrow[];
  /** Show the board from Black's side. */
  flipped?: boolean;
}

export default function Board({
  board,
  selectedPos,
  validMoves,
  lastMove,
  checkSquare,
  isCheckmate,
  currentTurn,
  onSquareClick,
  onMove,
  canDrag,
  onResize,
  overlay,
  animOverlay,
  interactiveOverlay,
  hidePieceAt,
  boardSize,
  arrows,
  flipped = false,
}: BoardProps) {
  const { settings } = useSettings();
  const theme = BOARD_THEMES[settings.boardTheme] ?? BOARD_THEMES.classic;
  const squarePx = boardSize / 8;
  const wrapRef = useRef<HTMLDivElement>(null);

  // ── user shapes: cleared whenever the position changes ──────────────────────
  const [shapes, setShapes] = useState<UserShape[]>([]);
  const [drawing, setDrawing] = useState<UserShape | null>(null);
  const placement = useMemo(
    () => board.map(r => r.map(p => (p ? p.color[0] + p.type[0] : '.')).join('')).join('/'),
    [board],
  );
  useEffect(() => { setShapes([]); setDrawing(null); }, [placement]);

  // ── drag state ──────────────────────────────────────────────────────────────
  const pressRef = useRef<{ from: Position; x: number; y: number; id: number } | null>(null);
  const [drag, setDrag] = useState<{ from: Position; x: number; y: number } | null>(null);

  /** Pointer → logical square (accounts for board orientation). */
  const squareAt = (clientX: number, clientY: number): Position | null => {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    if (x < 0 || y < 0 || x >= r.width || y >= r.height) return null;
    let col = Math.floor((x / r.width) * 8), row = Math.floor((y / r.height) * 8);
    if (flipped) { col = 7 - col; row = 7 - row; }
    return { row, col };
  };

  const localXY = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  const draggable = (pos: Position) => {
    if (!onMove) return false;
    if (canDrag) return canDrag(pos);
    const p = board[pos.row][pos.col];
    return !!p && p.color === currentTurn;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const sq = squareAt(e.clientX, e.clientY);
    if (!sq) return;
    if (e.button === 2) {
      e.preventDefault();
      setDrawing({ from: sq, to: null, brush: brushFor(e) });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (shapes.length) setShapes([]);
    if (draggable(sq)) {
      pressRef.current = { from: sq, x: e.clientX, y: e.clientY, id: e.pointerId };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drawing) {
      const sq = squareAt(e.clientX, e.clientY);
      if (sq && !samePos(sq, drawing.to)) setDrawing({ ...drawing, to: sq });
      return;
    }
    const press = pressRef.current;
    if (!press) return;
    if (!drag) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) return;
      e.currentTarget.setPointerCapture(press.id);
      // Select the piece so legal-move dots appear while dragging.
      if (!samePos(selectedPos, press.from)) onSquareClick(press.from);
    }
    const { x, y } = localXY(e.clientX, e.clientY);
    setDrag({ from: press.from, x, y });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drawing) {
      const to = squareAt(e.clientX, e.clientY) ?? drawing.to;
      const shape: UserShape = { from: drawing.from, to: to && !samePos(to, drawing.from) ? to : null, brush: drawing.brush };
      setDrawing(null);
      setShapes(prev => {
        const same = (s: UserShape) => samePos(s.from, shape.from) &&
          ((s.to === null && shape.to === null) || samePos(s.to, shape.to));
        const existing = prev.find(same);
        const rest = prev.filter(s => !same(s));
        // Re-drawing the same shape with the same brush removes it (toggle).
        return existing && existing.brush === shape.brush ? rest : [...rest, shape];
      });
      return;
    }
    const press = pressRef.current;
    pressRef.current = null;
    if (!drag || !press) return;
    setDrag(null);
    const to = squareAt(e.clientX, e.clientY);
    if (to && !samePos(to, press.from)) onMove?.(press.from, to);
  };

  const handlePointerCancel = () => { pressRef.current = null; setDrag(null); setDrawing(null); };

  // ── manual resize handle ────────────────────────────────────────────────────
  const resizeRef = useRef<{ startX: number; startY: number; startSize: number } | null>(null);
  const handleResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onResize) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startSize: boardSize };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current || !onResize) return;
    e.stopPropagation();
    const { startX, startY, startSize } = resizeRef.current;
    const delta = Math.round((e.clientX - startX + (e.clientY - startY)) / 2);
    onResize(Math.max(BOARD_MIN_PX, startSize + delta));
  };
  const handleResizeUp = (e: React.PointerEvent<HTMLDivElement>) => { e.stopPropagation(); resizeRef.current = null; };

  const isValidMove = (row: number, col: number) => validMoves.some(m => m.row === row && m.col === col);
  const winner = isCheckmate ? (currentTurn === 'white' ? 'Black' : 'White') : null;
  const dragPiece = drag ? board[drag.from.row][drag.from.col] : null;
  const dragSrc = dragPiece ? pieceSrc(settings.pieceSet, dragPiece.color, dragPiece.type) : null;
  const allShapes = drawing ? [...shapes, drawing] : shapes;

  return (
    <div
      ref={wrapRef}
      className={`lc-board${drag ? ' dragging' : ''}`}
      style={{
        width: boardSize, height: boardSize,
        ['--sq-light' as string]: theme.light,
        ['--sq-dark' as string]: theme.dark,
        ['--coord-on-light' as string]: theme.coordL,
        ['--coord-on-dark' as string]: theme.coordD,
      } as React.CSSProperties}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={e => e.preventDefault()}
    >
      {/* Everything in board space rotates together when flipped. */}
      <div className="lc-board-grid" style={flipped ? { transform: 'rotate(180deg)' } : undefined}>
        {board.map((row, rowIdx) =>
          row.map((piece, colIdx) => (
            <SquareComponent
              key={`${rowIdx}-${colIdx}`}
              piece={piece}
              row={rowIdx}
              col={colIdx}
              flipped={flipped}
              showRank={flipped ? colIdx === 7 : colIdx === 0}
              showFile={flipped ? rowIdx === 0 : rowIdx === 7}
              isSelected={samePos(selectedPos, { row: rowIdx, col: colIdx })}
              isValidMove={isValidMove(rowIdx, colIdx)}
              isLastMove={!!lastMove && (samePos(lastMove.from, { row: rowIdx, col: colIdx }) || samePos(lastMove.to, { row: rowIdx, col: colIdx }))}
              isCheckSquare={samePos(checkSquare, { row: rowIdx, col: colIdx })}
              isCheckmateSquare={!!isCheckmate && samePos(checkSquare, { row: rowIdx, col: colIdx })}
              onClick={() => onSquareClick({ row: rowIdx, col: colIdx })}
              squarePx={squarePx}
              hidePiece={samePos(hidePieceAt, { row: rowIdx, col: colIdx }) || samePos(drag?.from, { row: rowIdx, col: colIdx })}
            />
          )),
        )}

        {/* Spotting overlay (z=5) */}
        {overlay && <div className="lc-layer" style={{ zIndex: 5 }}>{overlay}</div>}

        {/* Arrows + user shapes (z=6) */}
        <ShapesLayer arrows={arrows ?? []} shapes={allShapes} />

        {/* Animated piece overlay (z=30) */}
        {animOverlay && <div className="lc-layer" style={{ zIndex: 30 }}>{animOverlay}</div>}
      </div>

      {/* Dragged piece follows the pointer (always upright). */}
      {drag && dragPiece && (
        <div className="lc-drag-piece" style={{
          width: squarePx * 1.1, height: squarePx * 1.1,
          left: drag.x - squarePx * 0.55, top: drag.y - squarePx * 0.55,
          fontSize: squarePx * 0.75,
        }}>
          {dragSrc
            ? <img src={dragSrc} alt={pieceCode(dragPiece.color, dragPiece.type)} draggable={false} />
            : <span className={`glyph ${dragPiece.color}`}>{getPieceLabel(dragPiece)}</span>}
        </div>
      )}

      {/* Interactive overlay — pointer events on (z=50) */}
      {interactiveOverlay && (
        <div className="lc-layer" style={{ zIndex: 50, pointerEvents: 'auto' }} onPointerDown={e => e.stopPropagation()}>
          {interactiveOverlay}
        </div>
      )}

      {/* Checkmate banner */}
      {isCheckmate && winner && (
        <div className="lc-result checkmate-overlay">
          <strong>Checkmate</strong>
          <span>{winner} wins</span>
        </div>
      )}

      {/* Resize handle */}
      {onResize && (
        <div
          className="lc-resize"
          onPointerDown={handleResizeDown}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeUp}
          title="Drag to resize board"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2 11 L11 2 M6 11 L11 6 M10 11 L11 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
}
