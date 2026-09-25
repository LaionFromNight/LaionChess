import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Square, Position } from '../chess/types';
import SquareComponent from './Square';
import { useSettings, BOARD_THEMES } from '../settings/useSettings';
import { pieceSrc, pieceCode } from '../board/pieceSrc';
import { getPieceLabel } from '../chess/logic';
import { ARROW, parseColor, lighten } from '../board/arrowPalette';
import '../App.css';

const BOARD_MIN_PX = 240;

export interface BoardArrow {
  from: Position;
  to: Position;
  color: string;
  /** Stroke width in board-percent units (12.5 = one square). */
  width: number;
  /** Small badge (e.g. rank "1", "2") drawn on the arrow. */
  label?: string;
  /** Where the badge sits: inside the arrowhead (default) or at the tail. */
  labelAt?: 'head' | 'tail';
}

// ── user-drawn shapes (right-click drag, lichess style) ───────────────────────
type Brush = 'green' | 'red' | 'blue' | 'yellow';
const BRUSH_COLORS: Record<Brush, string> = {
  green: ARROW.green,
  red: ARROW.red,
  blue: ARROW.blue,
  yellow: ARROW.gold,
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

  const headLen = Math.max(0.36, width * 2.35);
  const headHalf = Math.max(0.24, width * 1.6);
  // Knight moves bend: long leg first, then the short leg into the target square.
  const corner = isKnight
    ? (Math.abs(dr) > Math.abs(dc) ? { x: x1, y: y2 } : { x: x2, y: y1 })
    : null;
  const sx = corner ? corner.x : x1, sy = corner ? corner.y : y1;
  const dx = x2 - sx, dy = y2 - sy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tipX = x2 - ux * 0.1, tipY = y2 - uy * 0.1;
  const baseX = tipX - ux * headLen, baseY = tipY - uy * headLen;
  // The shaft stops a hair inside the head so the round cap never pokes out.
  const shaftX = baseX + ux * Math.min(width * 0.5, headLen * 0.3);
  const shaftY = baseY + uy * Math.min(width * 0.5, headLen * 0.3);
  // Tail starts slightly off-centre so it doesn't cover the moving piece's face.
  const tx0 = (corner ? corner.x : x2) - x1, ty0 = (corner ? corner.y : y2) - y1;
  const tl = Math.hypot(tx0, ty0) || 1;
  const startX = x1 + (tx0 / tl) * 0.18, startY = y1 + (ty0 / tl) * 0.18;
  const px = -uy, py = ux;
  const d = corner
    ? `M ${startX} ${startY} L ${corner.x} ${corner.y} L ${shaftX} ${shaftY}`
    : `M ${startX} ${startY} L ${shaftX} ${shaftY}`;
  const f = (n: number) => Math.round(n * 10000) / 10000;
  const headPath = `M ${f(tipX)} ${f(tipY)} L ${f(baseX + px * headHalf)} ${f(baseY + py * headHalf)} `
    + `L ${f(baseX + ux * headLen * 0.18)} ${f(baseY + uy * headLen * 0.18)} L ${f(baseX - px * headHalf)} ${f(baseY - py * headHalf)} Z`;
  return {
    d, headPath, headLen, x1: startX, y1: startY, x2: tipX, y2: tipY,
    cx: corner ? corner.x : undefined, cy: corner ? corner.y : undefined,
  };
}

/** Point `dist` back from the tip along the last leg (or forward from the tail). */
function pointOnArrow(g: ReturnType<typeof arrowGeometry>, at: 'head' | 'tail', dist: number) {
  if (at === 'tail') {
    const ex = g.cx ?? g.x2, ey = g.cy ?? g.y2;
    const len = Math.hypot(ex - g.x1, ey - g.y1) || 1;
    const d = Math.min(dist, len * 0.5);
    return { x: g.x1 + ((ex - g.x1) / len) * d, y: g.y1 + ((ey - g.y1) / len) * d };
  }
  const sx = g.cx ?? g.x1, sy = g.cy ?? g.y1;
  const len = Math.hypot(g.x2 - sx, g.y2 - sy) || 1;
  const d = Math.min(dist, len * 0.8);
  return { x: g.x2 - ((g.x2 - sx) / len) * d, y: g.y2 - ((g.y2 - sy) / len) * d };
}

function inkFor(rgb: string): string {
  const m = rgb.match(/[\d.]+/g);
  if (!m) return '#fff';
  const [r, g, b] = m.map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#16181c' : '#fff';
}

/**
 * One arrow: opaque shaft + swept head inside a single group whose opacity
 * carries the colour's alpha (no darker seam where they overlap) and a
 * gradient that brightens towards the tip. The soft shadow is a CSS
 * drop-shadow on the whole <svg> — per-element SVG filters get clipped to the
 * geometry's bounding box in Safari (heads or whole straight arrows vanished).
 */
function PremiumArrow({ gradId, from, to, color, width, ghost }: {
  gradId: string; from: Position; to: Position; color: string; width: number; ghost?: boolean;
}) {
  const { rgb, alpha } = parseColor(color);
  const g = arrowGeometry(from, to, width);
  return (
    <g className="lc-arrow" opacity={ghost ? alpha * 0.6 : alpha}>
      <path d={g.d} stroke={`url(#${gradId})`} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d={g.headPath} fill={rgb} stroke={rgb} strokeWidth={width * 0.35} strokeLinejoin="round" />
    </g>
  );
}

function arrowGradient(id: string, from: Position, to: Position, color: string, width: number) {
  const { rgb } = parseColor(color);
  const g = arrowGeometry(from, to, width);
  return (
    <linearGradient key={id} id={id} gradientUnits="userSpaceOnUse" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
      <stop offset="0" stopColor={lighten(rgb, 0.12)} stopOpacity={0.55} />
      <stop offset="0.55" stopColor={rgb} stopOpacity={0.92} />
      <stop offset="1" stopColor={rgb} stopOpacity={1} />
    </linearGradient>
  );
}

function ShapesLayer({ arrows, shapes, ghost, flipped }: {
  arrows: BoardArrow[]; shapes: UserShape[]; ghost: UserShape | null; flipped: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  if (arrows.length === 0 && shapes.length === 0 && !ghost) return null;
  const all = ghost ? [...shapes, ghost] : shapes;
  const drawn = arrows.filter(a => !samePos(a.from, a.to));
  const USER_W = 0.18;
  return (
    <svg className="lc-arrows" viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg">
      <defs>
        {drawn.map((a, i) => arrowGradient(`${uid}a${i}`, a.from, a.to, a.color, a.width / 12.5))}
        {all.map((s, i) => (s.to && !samePos(s.from, s.to)
          ? arrowGradient(`${uid}s${i}`, s.from, s.to, BRUSH_COLORS[s.brush], USER_W) : null))}
      </defs>
      {drawn.map((a, i) => (
        <PremiumArrow key={`a${i}-${a.from.row}${a.from.col}${a.to.row}${a.to.col}`} gradId={`${uid}a${i}`}
          from={a.from} to={a.to} color={a.color} width={a.width / 12.5} />
      ))}
      {all.map((s, i) => {
        const color = BRUSH_COLORS[s.brush];
        const isGhost = s === ghost;
        if (!s.to || samePos(s.from, s.to)) {
          const { rgb, alpha } = parseColor(color);
          return (
            <g key={`s${i}`} className="lc-arrow" opacity={isGhost ? alpha * 0.6 : alpha}>
              <circle cx={s.from.col + 0.5} cy={s.from.row + 0.5} r={0.44} fill={rgb} fillOpacity={0.14} stroke={rgb} strokeWidth={0.07} />
            </g>
          );
        }
        return <PremiumArrow key={`s${i}`} gradId={`${uid}s${i}`} from={s.from} to={s.to} color={color}
          width={USER_W} ghost={isGhost} />;
      })}
      {/* Rank badges on top of every arrow, fully opaque so they stay readable. */}
      {drawn.map((a, i) => {
        if (!a.label) return null;
        const w = a.width / 12.5;
        const g = arrowGeometry(a.from, a.to, w);
        const at = a.labelAt ?? 'head';
        const p = pointOnArrow(g, at, at === 'head' ? g.headLen * 0.52 : 0.12);
        const { rgb } = parseColor(a.color);
        return (
          <g key={`l${i}`} className="lc-arrow-label" transform={flipped ? `rotate(180 ${p.x} ${p.y})` : undefined}>
            <circle cx={p.x} cy={p.y} r={0.17} fill={rgb} stroke="rgba(255,255,255,0.92)" strokeWidth={0.03} />
            <text x={p.x} y={p.y} dy="0.075" textAnchor="middle" fontSize="0.21" fontWeight="800"
              fontFamily="Inter, system-ui, sans-serif" fill={inkFor(rgb)}>{a.label}</text>
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
        <ShapesLayer arrows={arrows ?? []} shapes={shapes} ghost={drawing} flipped={flipped} />

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
