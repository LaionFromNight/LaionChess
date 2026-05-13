import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { GameState, Position, PieceColor, Board as ChessBoard, Piece } from './chess/types';
import {
  createInitialState,
  executeMove,
  getLegalMoves,
  findKing,
  isKingInCheck,
  getPieceLabel,
} from './chess/logic';
import { parseFen, toFen } from './chess/fen';
import { exportPgn, parsePgn } from './chess/pgn';
import type { SpottingMode } from './chess/analysis';
import {
  createGameTree, addNode, getNodeState, findChildByMove,
  getMainLineTip, deleteSubtree, pgnGameToTree, treeToPgnGame,
} from './chess/tree';
import type { GameTree } from './chess/tree';
import { getAttackedSquares, computeDefenseEdges, computeExchanges } from './chess/analysis';
import Board from './components/Board';
import MoveList from './components/MoveList';
import SpottingPanel from './components/SpottingPanel';
import PromotionPicker from './components/PromotionPicker';

// ── shared style helpers ──────────────────────────────────────────────────────

const BTN: React.CSSProperties = {
  padding: '10px 22px', fontSize: 13, fontWeight: 600,
  borderRadius: 6, cursor: 'pointer', letterSpacing: 1,
  textTransform: 'uppercase', transition: 'all 0.2s', border: 'none',
};

const MODAL_OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const MODAL_BOX: React.CSSProperties = {
  backgroundColor: '#0d1117', borderRadius: 12, padding: 32,
  maxWidth: 520, width: '92%',
};

const TEXTAREA: React.CSSProperties = {
  width: '100%', backgroundColor: '#0a0a1a', border: '1px solid #2a2a3a',
  borderRadius: 6, color: '#e0e0e0', padding: 12,
  fontSize: 12, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box',
};

function ModalTitle({ color, text }: { color: string; text: string }) {
  return (
    <h2 style={{
      color, fontSize: 18, letterSpacing: 3, textTransform: 'uppercase',
      margin: '0 0 24px', textAlign: 'center', textShadow: `0 0 10px ${color}44`,
    }}>{text}</h2>
  );
}

function Btn({ color, bg, border, onClick, children, disabled }: {
  color: string; bg: string; border: string;
  onClick: () => void; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '8px 16px', fontSize: 13, fontWeight: 600,
      border: `1px solid ${border}`, borderRadius: 6,
      cursor: disabled ? 'not-allowed' : 'pointer',
      backgroundColor: disabled ? '#111' : bg,
      color: disabled ? '#444' : color,
      opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  );
}

function downloadBlob(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── animated piece ────────────────────────────────────────────────────────────

type AnimPiece = { piece: Piece; from: Position; to: Position };

function AnimatedPiece({ anim, boardSize, onDone }: {
  anim: AnimPiece; boardSize: number; onDone: () => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const squarePx = boardSize / 8;
  const initDX = (anim.from.col - anim.to.col) * squarePx;
  const initDY = (anim.from.row - anim.to.row) * squarePx;

  useEffect(() => {
    // Two rAFs ensure initial transform is painted before transition starts
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = divRef.current;
        if (!el) return;
        el.style.transition = 'transform 0.3s cubic-bezier(0, 0, 0.2, 1)';
        el.style.transform = 'translate(0px, 0px)';
      });
    });
    const timer = setTimeout(onDone, 340);
    return () => { cancelAnimationFrame(id); clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fontSize = Math.round(squarePx * 0.70);
  const isWhite = anim.piece.color === 'white';

  return (
    <div ref={divRef} style={{
      position: 'absolute',
      left: anim.to.col * squarePx,
      top: anim.to.row * squarePx,
      width: squarePx,
      height: squarePx,
      transform: `translate(${initDX}px, ${initDY}px)`,
      transition: 'none',
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize,
      userSelect: 'none',
    }}>
      <span style={{
        lineHeight: 1,
        color: isWhite ? '#ffffff' : '#1a1a1a',
        textShadow: isWhite
          ? '0 0 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.4)'
          : '0 0 3px rgba(255,255,255,0.5)',
        filter: isWhite ? 'drop-shadow(0 0 1px rgba(0,0,0,0.9))' : 'none',
      }}>
        {getPieceLabel(anim.piece)}
      </span>
    </div>
  );
}

// ── king-shot helpers ─────────────────────────────────────────────────────────

function findCheckingPieces(board: ChessBoard, kingPos: Position, attackerColor: PieceColor): Position[] {
  const result: Position[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== attackerColor) continue;
      const attacked = getAttackedSquares(board, { row: r, col: c }, piece.type, piece.color);
      if (attacked.some(sq => sq.row === kingPos.row && sq.col === kingPos.col)) {
        result.push({ row: r, col: c });
      }
    }
  }
  return result;
}

function isRawAttackedBy(board: ChessBoard, pos: Position, byColor: PieceColor): boolean {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== byColor) continue;
      const attacked = getAttackedSquares(board, { row: r, col: c }, piece.type, piece.color);
      if (attacked.some(sq => sq.row === pos.row && sq.col === pos.col)) return true;
    }
  }
  return false;
}

// ── spotting overlay SVG renderer ─────────────────────────────────────────────

function getPinAxis(board: ChessBoard, piecePos: Position, color: PieceColor): Set<string> | null {
  const kingPos = findKing(board, color);
  if (!kingPos) return null;

  const tmp: ChessBoard = board.map(row => [...row]);
  tmp[piecePos.row][piecePos.col] = null;
  if (!isKingInCheck(tmp, color)) return null;

  const dr = piecePos.row - kingPos.row;
  const dc = piecePos.col - kingPos.col;
  const stepR = dr === 0 ? 0 : dr > 0 ? 1 : -1;
  const stepC = dc === 0 ? 0 : dc > 0 ? 1 : -1;

  const axis = new Set<string>();
  let r = kingPos.row + stepR, c = kingPos.col + stepC;
  while (r >= 0 && r < 8 && c >= 0 && c < 8) {
    axis.add(`${r},${c}`); r += stepR; c += stepC;
  }
  r = kingPos.row - stepR; c = kingPos.col - stepC;
  while (r >= 0 && r < 8 && c >= 0 && c < 8) {
    axis.add(`${r},${c}`); r -= stepR; c -= stepC;
  }
  return axis;
}

function computeLegalControlMap(state: GameState): { white: number[][]; black: number[][] } {
  const white = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const black = Array.from({ length: 8 }, () => new Array(8).fill(0));

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = state.board[r][c];
      if (!piece) continue;
      const map = piece.color === 'white' ? white : black;

      if (piece.type === 'king') {
        const moves = getLegalMoves(
          state.board, { row: r, col: c },
          state.enPassantTarget,
          state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
          state.blackCanCastleKingside, state.blackCanCastleQueenside,
        );
        for (const sq of moves) map[sq.row][sq.col]++;
      } else {
        const attacked = getAttackedSquares(state.board, { row: r, col: c }, piece.type, piece.color);
        const pinAxis = getPinAxis(state.board, { row: r, col: c }, piece.color);
        for (const sq of attacked) {
          if (pinAxis && !pinAxis.has(`${sq.row},${sq.col}`)) continue;
          map[sq.row][sq.col]++;
        }
      }
    }
  }
  return { white, black };
}

const ALL_DEFS = (
  <defs>
    <pattern id="stripe-lo" patternUnits="userSpaceOnUse" width="0.28" height="0.28" patternTransform="rotate(45 0 0)">
      <line x1="0" y1="0" x2="0" y2="0.28" stroke="rgba(255,70,70,0.80)" strokeWidth="0.10" />
    </pattern>
    <pattern id="stripe-hi" patternUnits="userSpaceOnUse" width="0.28" height="0.28" patternTransform="rotate(45 0 0)">
      <line x1="0" y1="0" x2="0" y2="0.28" stroke="rgba(200,0,0,0.95)" strokeWidth="0.17" />
    </pattern>
    <marker id="arr-a" markerWidth="4" markerHeight="4" refX="3.5" refY="2" orient="auto" markerUnits="strokeWidth">
      <polygon points="0 0, 4 2, 0 4" fill="rgba(255,80,80,0.9)" />
    </marker>
    <marker id="arr-d" markerWidth="4" markerHeight="4" refX="3.5" refY="2" orient="auto" markerUnits="strokeWidth">
      <polygon points="0 0, 4 2, 0 4" fill="rgba(80,255,160,0.9)" />
    </marker>
    <marker id="arr-shot-safe" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto" markerUnits="strokeWidth">
      <polygon points="0 0, 5 2.5, 0 5" fill="rgba(60,255,90,0.95)" />
    </marker>
    <marker id="arr-shot-unsafe" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto" markerUnits="strokeWidth">
      <polygon points="0 0, 5 2.5, 0 5" fill="rgba(180,0,255,0.95)" />
    </marker>
  </defs>
);

function buildSpottingOverlay(modes: Set<SpottingMode>, state: GameState): React.ReactNode {
  if (modes.size === 0) return null;

  const { board, currentTurn } = state;

  const SVG_PROPS = {
    viewBox: '0 0 8 8',
    width: '100%',
    height: '100%',
    style: { position: 'absolute' as const, inset: 0 },
    xmlns: 'http://www.w3.org/2000/svg',
  };

  const layers: React.ReactNode[] = [ALL_DEFS];

  // ── LaionEye ────────────────────────────────────────────────────────────────
  const eyeModes = (['eye-full','eye-white','eye-black','eye-1','eye-2'] as SpottingMode[]).filter(m => modes.has(m));
  if (eyeModes.length > 0) {
    const ctl = computeLegalControlMap(state);
    const rects: React.ReactNode[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        let count = 0;
        for (const m of eyeModes) {
          let v = 0;
          if (m === 'eye-full')  v = Math.max(ctl.white[r][c], ctl.black[r][c]);
          else if (m === 'eye-white') v = ctl.white[r][c];
          else if (m === 'eye-black') v = ctl.black[r][c];
          else if (m === 'eye-1') v = currentTurn === 'white' ? ctl.white[r][c] : ctl.black[r][c];
          else if (m === 'eye-2') v = currentTurn === 'white' ? ctl.black[r][c] : ctl.white[r][c];
          if (v > count) count = v;
        }
        if (count > 0) {
          const fill = count <= 2 ? 'url(#stripe-lo)' : 'url(#stripe-hi)';
          rects.push(<rect key={`e-${r}-${c}`} x={c} y={r} width={1} height={1} fill={fill} />);
        }
      }
    }
    layers.push(<g key="eye">{rects}</g>);
  }

  // ── Dalmacja ────────────────────────────────────────────────────────────────
  if (modes.has('dalmacja')) {
    const edges = computeDefenseEdges(board);
    const lines = edges.map((e, i) => {
      const x1 = e.from.col + 0.5, y1 = e.from.row + 0.5;
      const x2 = e.to.col + 0.5, y2 = e.to.row + 0.5;
      const stroke = e.color === 'white' ? 'rgba(255,220,90,0.82)' : 'rgba(0,200,255,0.82)';
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={stroke} strokeWidth={0.065} strokeLinecap="round"
        strokeDasharray="0.18 0.10" />;
    });
    const defended = new Set<string>();
    edges.forEach(e => defended.add(`${e.to.row},${e.to.col}`));
    const dots = [...defended].map(key => {
      const [r, c] = key.split(',').map(Number);
      const piece = board[r][c];
      const fill = piece?.color === 'white' ? 'rgba(255,220,90,0.45)' : 'rgba(0,200,255,0.45)';
      return <circle key={key} cx={c + 0.5} cy={r + 0.5} r={0.38} fill={fill} />;
    });
    layers.push(<g key="dalmacja">{dots}{lines}</g>);
  }

  // ── Lufycfer ────────────────────────────────────────────────────────────────
  if (modes.has('lufycfer')) {
    const exchanges = computeExchanges(board);
    const elems: React.ReactNode[] = [];
    for (const ex of exchanges) {
      const { square, attackers, defenders } = ex;
      const sqFill = attackers.length > defenders.length
        ? 'rgba(255,60,60,0.50)'
        : 'rgba(50,255,130,0.45)';
      elems.push(<rect key={`sq-${square.row}-${square.col}`}
        x={square.col} y={square.row} width={1} height={1} fill={sqFill} />);
      const tx = square.col + 0.5, ty = square.row + 0.5;
      for (const a of attackers) {
        const ax = a.pos.col + 0.5, ay = a.pos.row + 0.5;
        const dx = tx - ax, dy = ty - ay;
        const len = Math.sqrt(dx * dx + dy * dy);
        elems.push(<line key={`a-${a.pos.row}-${a.pos.col}-${square.row}-${square.col}`}
          x1={ax} y1={ay} x2={tx - (dx / len) * 0.4} y2={ty - (dy / len) * 0.4}
          stroke="rgba(255,80,80,0.80)" strokeWidth={0.06}
          markerEnd="url(#arr-a)" strokeLinecap="round" />);
      }
      for (const d of defenders) {
        const dx2 = d.pos.col + 0.5, dy2 = d.pos.row + 0.5;
        const vx = tx - dx2, vy = ty - dy2;
        const len = Math.sqrt(vx * vx + vy * vy);
        elems.push(<line key={`d-${d.pos.row}-${d.pos.col}-${square.row}-${square.col}`}
          x1={dx2} y1={dy2} x2={tx - (vx / len) * 0.4} y2={ty - (vy / len) * 0.4}
          stroke="rgba(80,255,160,0.80)" strokeWidth={0.06}
          markerEnd="url(#arr-d)" strokeLinecap="round" />);
      }
    }
    layers.push(<g key="lufycfer">{elems}</g>);
  }

  // ── King Path ────────────────────────────────────────────────────────────────
  if (modes.has('king-path')) {
    const elems: React.ReactNode[] = [];

    for (const color of ['white', 'black'] as PieceColor[]) {
      const kingPos = findKing(board, color);
      if (!kingPos) continue;
      const kx = kingPos.col + 0.5, ky = kingPos.row + 0.5;
      const ringColor   = color === 'white' ? 'rgba(255,215,60,0.85)' : 'rgba(0,210,255,0.85)';
      const pinColor    = color === 'white' ? 'rgba(255,200,50,0.90)' : 'rgba(0,220,255,0.90)';
      // Bright inner color for mobile-piece rings — high contrast on any square
      const mobileBright = color === 'white' ? '#ffe040' : '#00eeff';

      // King always gets a ring
      elems.push(<circle key={`king-ring-${color}`}
        cx={kx} cy={ky} r={0.43}
        fill="none" stroke={ringColor} strokeWidth={0.08} />);

      const colorInCheck = isKingInCheck(board, color);

      if (!colorInCheck) {
        // No check: pin lines only, nothing on free pieces
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (!piece || piece.color !== color || piece.type === 'king') continue;
            const tmp: ChessBoard = board.map(row => [...row]);
            tmp[r][c] = null;
            if (!isKingInCheck(tmp, color)) continue;

            const px = c + 0.5, py = r + 0.5;
            elems.push(<line key={`pin-line-${r}-${c}`}
              x1={kx} y1={ky} x2={px} y2={py}
              stroke={pinColor} strokeWidth={0.07}
              strokeDasharray="0.18 0.10" strokeLinecap="round" />);

            const dr = r === kingPos.row ? 0 : r > kingPos.row ? 1 : -1;
            const dc = c === kingPos.col ? 0 : c > kingPos.col ? 1 : -1;
            let sr = r + dr, sc = c + dc;
            while (sr >= 0 && sr < 8 && sc >= 0 && sc < 8) {
              if (tmp[sr][sc]) {
                elems.push(<line key={`pin-ray-${r}-${c}`}
                  x1={px} y1={py} x2={sc + 0.5} y2={sr + 0.5}
                  stroke="rgba(255,60,60,0.60)" strokeWidth={0.05}
                  strokeDasharray="0.10 0.08" strokeLinecap="round" />);
                break;
              }
              sr += dr; sc += dc;
            }
          }
        }
      } else {
        // In check: double-stroke ring on pieces that can move, no lines
        const dests = new Set<string>();
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            const piece = board[r][c];
            if (!piece || piece.color !== color) continue;
            const moves = getLegalMoves(board, { row: r, col: c },
              state.enPassantTarget,
              state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
              state.blackCanCastleKingside, state.blackCanCastleQueenside);
            if (moves.length > 0) {
              // Dark halo for contrast, bright inner ring
              elems.push(<circle key={`mobile-halo-${r}-${c}`}
                cx={c + 0.5} cy={r + 0.5} r={0.41}
                fill="none" stroke="rgba(0,0,0,0.70)" strokeWidth={0.14} />);
              elems.push(<circle key={`mobile-${r}-${c}`}
                cx={c + 0.5} cy={r + 0.5} r={0.41}
                fill="none" stroke={mobileBright} strokeWidth={0.08} />);
              for (const m of moves) dests.add(`${m.row},${m.col}`);
            }
          }
        }
        // Purple dots on legal destinations
        for (const key of dests) {
          const [r, c] = key.split(',').map(Number);
          elems.push(<circle key={`dest-${r}-${c}`}
            cx={c + 0.5} cy={r + 0.5} r={0.20}
            fill="rgba(190,0,255,0.85)" />);
        }
      }
    }

    layers.push(<g key="king-path">{elems}</g>);
  }

  // ── King Shot ────────────────────────────────────────────────────────────────
  if (modes.has('king-shot')) {
    const elems: React.ReactNode[] = [];
    const oppColor: PieceColor = currentTurn === 'white' ? 'black' : 'white';
    const oppKingPos = findKing(board, oppColor);

    if (oppKingPos) {
      // Source ring: orange for white pieces, blue for black pieces
      const srcRing = currentTurn === 'white' ? '#ff9020' : '#2090ff';

      type ShotInfo = {
        fr: number; fc: number; tr: number; tc: number;
        checkers: Position[];
        unsafe: boolean;
      };
      const shots: ShotInfo[] = [];
      const sources = new Set<string>();

      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const piece = board[r][c];
          if (!piece || piece.color !== currentTurn) continue;

          const legal = getLegalMoves(board, { row: r, col: c },
            state.enPassantTarget,
            state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
            state.blackCanCastleKingside, state.blackCanCastleQueenside);

          for (const dest of legal) {
            const tmp: ChessBoard = board.map(row => [...row]);
            if (piece.type === 'pawn' && state.enPassantTarget &&
                dest.row === state.enPassantTarget.row && dest.col === state.enPassantTarget.col) {
              tmp[piece.color === 'white' ? dest.row + 1 : dest.row - 1][dest.col] = null;
            }
            tmp[dest.row][dest.col] = (piece.type === 'pawn' && (dest.row === 0 || dest.row === 7))
              ? { type: 'queen', color: piece.color }
              : piece;
            tmp[r][c] = null;

            if (!isKingInCheck(tmp, oppColor)) continue;

            // Find which pieces are actually delivering check (ray source)
            const checkers = findCheckingPieces(tmp, oppKingPos, currentTurn);
            // Unsafe = any checking piece is attacked by opponent (can be recaptured)
            const unsafe = checkers.some(chk => isRawAttackedBy(tmp, chk, oppColor));

            sources.add(`${r},${c}`);
            shots.push({ fr: r, fc: c, tr: dest.row, tc: dest.col, checkers, unsafe });
          }
        }
      }

      // Source rings (deduplicated per piece)
      for (const key of sources) {
        const [r, c] = key.split(',').map(Number);
        const fx = c + 0.5, fy = r + 0.5;
        elems.push(<circle key={`shot-halo-${key}`}
          cx={fx} cy={fy} r={0.42}
          fill="none" stroke="rgba(0,0,0,0.65)" strokeWidth={0.15} />);
        elems.push(<circle key={`shot-src-${key}`}
          cx={fx} cy={fy} r={0.42}
          fill="none" stroke={srcRing} strokeWidth={0.09} />);
      }

      const kx = oppKingPos.col + 0.5, ky = oppKingPos.row + 0.5;

      for (const { fr, fc, tr, tc, checkers, unsafe } of shots) {
        const fx = fc + 0.5, fy = fr + 0.5;
        const tx = tc + 0.5, ty = tr + 0.5;
        const k = `${fr}-${fc}-${tr}-${tc}`;

        // Green = safe (checker can't be recaptured), purple = unsafe (checker can be taken)
        const shotColor  = unsafe ? '#b400ff' : '#3cff5a';
        const destFill   = unsafe ? 'rgba(180,0,255,0.28)' : 'rgba(50,255,80,0.28)';
        const arrowMark  = unsafe ? 'url(#arr-shot-unsafe)' : 'url(#arr-shot-safe)';

        elems.push(<rect key={`shot-dest-${k}`}
          x={tc} y={tr} width={1} height={1} fill={destFill} />);

        // Move arrow: piece → destination
        const adx = tx - fx, ady = ty - fy;
        const alen = Math.sqrt(adx * adx + ady * ady);
        if (alen > 0.01) {
          elems.push(<line key={`shot-arrow-${k}`}
            x1={fx} y1={fy}
            x2={tx - (adx / alen) * 0.38} y2={ty - (ady / alen) * 0.38}
            stroke={shotColor} strokeWidth={0.07}
            markerEnd={arrowMark} strokeLinecap="round" />);
        }

        // Attack rays from each checking piece to king (not from dest)
        checkers.forEach((chk, i) => {
          const cx = chk.col + 0.5, cy = chk.row + 0.5;
          const rdx = kx - cx, rdy = ky - cy;
          const rlen = Math.sqrt(rdx * rdx + rdy * rdy);
          if (rlen > 0.01) {
            elems.push(<line key={`shot-ray-${k}-${i}`}
              x1={cx} y1={cy}
              x2={kx - (rdx / rlen) * 0.43} y2={ky - (rdy / rlen) * 0.43}
              stroke="rgba(255,50,50,0.75)" strokeWidth={0.06}
              strokeDasharray="0.13 0.09" strokeLinecap="round" />);
          }
        });
      }
    }

    layers.push(<g key="king-shot">{elems}</g>);
  }

  if (layers.length <= 1) return null; // only defs, nothing visible
  return <svg {...SVG_PROPS}>{layers}</svg>;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  // ── game tree ───────────────────────────────────────────────────────────────
  const [tree, setTree] = useState<GameTree>(() => createGameTree(createInitialState()));
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [animPiece, setAnimPiece] = useState<AnimPiece | null>(null);

  // ── playback ────────────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1000);

  // Refs for stale-closure-safe callbacks
  const currentNodeIdRef = useRef(currentNodeId);
  const treeRef = useRef(tree);
  const displayedStateRef = useRef<GameState>(tree.initialState);

  const mainLineTip = useMemo(() => getMainLineTip(tree), [tree]);
  const isAnalysisMode = currentNodeId !== mainLineTip;
  const hasAnyMoves = tree.rootChildren.length > 0;

  const displayedState = useMemo(() => getNodeState(tree, currentNodeId), [tree, currentNodeId]);

  const displayedLastMove = currentNodeId !== null ? (tree.nodes[currentNodeId]?.move ?? null) : null;

  const displayedCheckSquare = useMemo(() => {
    if (!displayedState.isCheck) return null;
    return findKing(displayedState.board, displayedState.currentTurn);
  }, [displayedState]);

  // Keep refs in sync
  useEffect(() => { currentNodeIdRef.current = currentNodeId; });
  useEffect(() => { treeRef.current = tree; });
  useEffect(() => { displayedStateRef.current = displayedState; });

  // ── promotion picker ────────────────────────────────────────────────────────
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Position; to: Position } | null>(null);

  // ── spotting modes (multi-select) ───────────────────────────────────────────
  const [spottingModes, setSpottingModes] = useState<Set<SpottingMode>>(new Set());

  const spottingOverlay = useMemo(
    () => buildSpottingOverlay(spottingModes, displayedState),
    [spottingModes, displayedState],
  );

  // ── board size ───────────────────────────────────────────────────────────────
  const [boardSize, setBoardSize] = useState(900);
  const BOARD_MIN = 240, BOARD_STEP = 60;

  // ── modal states ────────────────────────────────────────────────────────────
  const [showNewGame, setShowNewGame] = useState(false);
  const [ngView, setNgView] = useState<'choice' | 'pgn' | 'fen'>('choice');
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState('');
  const [pgnText, setPgnText] = useState('');
  const [pgnError, setPgnError] = useState('');

  const [showExport, setShowExport] = useState(false);
  const [copyFenMsg, setCopyFenMsg] = useState('');
  const [copyPgnMsg, setCopyPgnMsg] = useState('');
  const pgnRef = useRef<HTMLTextAreaElement>(null);
  const anyModalOpen = showNewGame || showExport || pendingPromotion !== null;

  // ── valid moves ─────────────────────────────────────────────────────────────
  const validMoves = useMemo(() => {
    if (!selectedPos) return [];
    return getLegalMoves(
      displayedState.board, selectedPos,
      displayedState.enPassantTarget,
      displayedState.whiteCanCastleKingside, displayedState.whiteCanCastleQueenside,
      displayedState.blackCanCastleKingside, displayedState.blackCanCastleQueenside,
    );
  }, [displayedState, selectedPos]);

  // ── step-forward with animation ──────────────────────────────────────────────
  const stepForwardWithAnim = useCallback(() => {
    setIsPlaying(false);
    setSelectedPos(null);
    const t = treeRef.current;
    const curId = currentNodeIdRef.current;
    const children = curId === null ? t.rootChildren : (t.nodes[curId]?.children ?? []);
    if (children.length === 0) return;
    const nextId = children[0];
    const move = t.nodes[nextId]?.move;
    const curState = displayedStateRef.current;
    if (move && curState) {
      const piece = curState.board[move.from.row][move.from.col];
      if (piece) setAnimPiece({ piece, from: move.from, to: move.to });
    }
    setCurrentNodeId(nextId);
  }, []);

  // ── keyboard ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (anyModalOpen) return;
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false); setSelectedPos(null);
        const curId = currentNodeIdRef.current;
        const t = treeRef.current;
        setCurrentNodeId(curId !== null ? (t.nodes[curId]?.parentId ?? null) : null);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepForwardWithAnim();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyModalOpen, stepForwardWithAnim]);

  // ── auto-play ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      const t = treeRef.current;
      const curId = currentNodeIdRef.current;
      const children = curId === null ? t.rootChildren : (t.nodes[curId]?.children ?? []);
      if (children.length === 0) { setIsPlaying(false); return; }
      const nextId = children[0];
      const move = t.nodes[nextId]?.move;
      const curState = displayedStateRef.current;
      if (move && curState) {
        const piece = curState.board[move.from.row][move.from.col];
        if (piece) setAnimPiece({ piece, from: move.from, to: move.to });
      }
      setCurrentNodeId(nextId);
    }, playSpeed);
    return () => clearInterval(id);
  }, [isPlaying, playSpeed]);

  // ── helpers ─────────────────────────────────────────────────────────────────
  function applyNewTree(newTree: GameTree, nodeId?: string | null) {
    setTree(newTree);
    setCurrentNodeId(nodeId !== undefined ? nodeId : getMainLineTip(newTree));
    setSelectedPos(null);
    setIsPlaying(false);
  }

  function doTreeMove(from: Position, to: Position, promotion?: import('./chess/types').PieceType) {
    const movingPiece = displayedState.board[from.row][from.col];
    const existing = findChildByMove(tree, currentNodeId, from, to, promotion);
    if (existing) {
      if (movingPiece) setAnimPiece({ piece: movingPiece, from, to });
      setCurrentNodeId(existing);
      return;
    }
    if (movingPiece) setAnimPiece({ piece: movingPiece, from, to });
    const newState = executeMove(displayedState, from, to, promotion);
    const lastMove = newState.moveHistory[newState.moveHistory.length - 1];
    const { tree: newTree, nodeId } = addNode(tree, currentNodeId, lastMove, newState);
    setTree(newTree);
    setCurrentNodeId(nodeId);
  }

  const handleSquareClick = useCallback((pos: Position) => {
    if (displayedState.isCheckmate || displayedState.isStalemate) return;
    if (pendingPromotion) return;
    if (selectedPos && validMoves.some(m => m.row === pos.row && m.col === pos.col)) {
      const movingPiece = displayedState.board[selectedPos.row][selectedPos.col];
      const isPromotion = movingPiece?.type === 'pawn' && (pos.row === 0 || pos.row === 7);
      if (isPromotion) {
        setPendingPromotion({ from: selectedPos, to: pos });
        setSelectedPos(null);
        return;
      }
      setSelectedPos(null);
      doTreeMove(selectedPos, pos);
      return;
    }
    const piece = displayedState.board[pos.row][pos.col];
    setSelectedPos(piece && piece.color === displayedState.currentTurn ? pos : null);
  }, [displayedState, selectedPos, validMoves, pendingPromotion, tree, currentNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePromotionSelect = useCallback((pieceType: import('./chess/types').PieceType) => {
    if (!pendingPromotion) return;
    setPendingPromotion(null);
    doTreeMove(pendingPromotion.from, pendingPromotion.to, pieceType);
  }, [pendingPromotion, displayedState, tree, currentNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePromotionCancel = useCallback(() => {
    setPendingPromotion(null);
  }, []);

  const handleUndo = () => {
    const tip = getMainLineTip(tree);
    if (tip === null) return;
    const parentId = tree.nodes[tip].parentId;
    setTree(deleteSubtree(tree, tip));
    setCurrentNodeId(parentId);
  };

  // ── new game modal ──────────────────────────────────────────────────────────
  const openNewGame = () => {
    setNgView('choice'); setFenInput(''); setFenError('');
    setPgnText(''); setPgnError(''); setShowNewGame(true);
  };

  const startFresh = () => { applyNewTree(createGameTree(createInitialState()), null); setShowNewGame(false); };

  const loadFromFen = () => {
    const trimmed = fenInput.trim();
    if (!trimmed) { setFenError('FEN cannot be empty'); return; }
    const state = parseFen(trimmed);
    if (!state) { setFenError('Invalid FEN — check all 6 fields'); return; }
    applyNewTree(createGameTree(state), null); setShowNewGame(false);
  };

  const loadFromPgn = () => {
    const db = parsePgn(pgnText);
    if (db.games.length === 0) { setPgnError('No valid PGN found'); return; }
    const game = db.games[0];
    const initState = (game.tags.SetUp === '1' && game.tags.FEN)
      ? (parseFen(game.tags.FEN) ?? createInitialState())
      : createInitialState();
    const newTree = pgnGameToTree(game, initState);
    if (newTree.rootChildren.length === 0 && game.moves.length > 0) {
      setPgnError('Could not parse any moves from PGN'); return;
    }
    applyNewTree(newTree); setShowNewGame(false);
  };

  // ── export ──────────────────────────────────────────────────────────────────
  const currentFen = toFen(displayedState);
  const currentPgn = exportPgn(treeToPgnGame(tree));

  const copyFen = () => navigator.clipboard.writeText(currentFen).then(() => {
    setCopyFenMsg('Copied!'); setTimeout(() => setCopyFenMsg(''), 2000);
  });
  const copyPgn = () => navigator.clipboard.writeText(currentPgn).then(() => {
    setCopyPgnMsg('Copied!'); setTimeout(() => setCopyPgnMsg(''), 2000);
  });

  // ── status ───────────────────────────────────────────────────────────────────
  const statusText = displayedState.isCheckmate
    ? `Checkmate! ${displayedState.currentTurn === 'white' ? 'Black' : 'White'} wins!`
    : displayedState.isStalemate ? 'Stalemate! Draw.'
    : displayedState.isCheck
      ? `${displayedState.currentTurn === 'white' ? 'White' : 'Black'} is in check!`
      : isAnalysisMode ? 'Analysis'
      : `${displayedState.currentTurn === 'white' ? 'White' : 'Black'} to move`;

  const statusColor = displayedState.isCheckmate ? '#ff0040'
    : displayedState.isStalemate ? '#ffd93d'
    : displayedState.isCheck ? '#ff9f43'
    : isAnalysisMode ? '#ff9f43'
    : displayedState.currentTurn === 'white' ? '#fff' : '#0ff';

  const statusClass = displayedState.isCheckmate ? 'checkmate-overlay'
    : displayedState.isCheck ? 'status-slide-in' : '';

  const SPEED_OPTIONS = [{ label: '1s', ms: 1000 }, { label: '5s', ms: 5000 }, { label: '15s', ms: 15000 }];

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(180deg, #0a0a1a 0%, #0d1117 40%, #0a1628 100%)',
      fontFamily: "'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif",
      color: '#e0e0e0', padding: 16, position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(rgba(0,255,255,0.03) 1px, transparent 1px),linear-gradient(90deg, rgba(0,255,255,0.03) 1px, transparent 1px)`, backgroundSize: '40px 40px', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,255,0.01) 2px, rgba(0,255,255,0.01) 4px)', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 4 }}>
          <h1 style={{
            fontSize: 36, fontWeight: 800, letterSpacing: 6, margin: 0,
            background: 'linear-gradient(90deg, #00ffff, #00ff88, #ff00ff, #00ffff)',
            backgroundSize: '200% 100%',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            textTransform: 'uppercase', filter: 'drop-shadow(0 0 10px rgba(0,255,255,0.3))',
          }}>Laion Chess</h1>
          <div style={{ width: 200, height: 2, background: 'linear-gradient(90deg, transparent, #00ffff, transparent)', margin: '4px auto 0' }} />
        </div>

        {/* Status */}
        <div className={statusClass} style={{
          fontSize: 18, fontWeight: 700, padding: '8px 28px', borderRadius: 6,
          backgroundColor: statusColor, color: statusColor === '#fff' || statusColor === '#0ff' ? '#000' : '#fff',
          boxShadow: `0 0 20px ${statusColor}40, 0 2px 8px rgba(0,0,0,0.4)`,
          letterSpacing: 1, textTransform: 'uppercase',
        }}>{statusText}</div>

        {/* Board row: SpottingPanel | Board | MoveList */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center' }}>

          <SpottingPanel modes={spottingModes} onChange={setSpottingModes} />

          {/* Board + history overlay */}
          <div style={{ position: 'relative' }}>
            <Board
              board={displayedState.board}
              selectedPos={selectedPos}
              validMoves={validMoves}
              lastMove={displayedLastMove ? { from: displayedLastMove.from, to: displayedLastMove.to } : null}
              checkSquare={displayedCheckSquare}
              enPassantTarget={displayedState.enPassantTarget}
              whiteCanCastleKingside={displayedState.whiteCanCastleKingside}
              whiteCanCastleQueenside={displayedState.whiteCanCastleQueenside}
              blackCanCastleKingside={displayedState.blackCanCastleKingside}
              blackCanCastleQueenside={displayedState.blackCanCastleQueenside}
              isCheck={displayedState.isCheck}
              isCheckmate={displayedState.isCheckmate}
              isStalemate={displayedState.isStalemate}
              currentTurn={displayedState.currentTurn}
              onSquareClick={handleSquareClick}
              onResize={setBoardSize}
              overlay={spottingOverlay}
              interactiveOverlay={pendingPromotion ? (
                <PromotionPicker
                  color={displayedState.currentTurn}
                  col={pendingPromotion.to.col}
                  isWhitePromotion={displayedState.currentTurn === 'white'}
                  squarePx={Math.round(boardSize / 8)}
                  onSelect={handlePromotionSelect}
                  onCancel={handlePromotionCancel}
                />
              ) : undefined}
              boardSize={boardSize}
              hidePieceAt={animPiece?.to ?? null}
              animOverlay={animPiece ? (
                <AnimatedPiece
                  anim={animPiece}
                  boardSize={boardSize}
                  onDone={() => setAnimPiece(null)}
                />
              ) : undefined}
            />
            {isAnalysisMode && (
              <div style={{
                position: 'absolute', inset: 0,
                backgroundColor: 'rgba(200,200,255,0.06)',
                border: '2px solid rgba(255,160,50,0.22)',
                borderRadius: 4, pointerEvents: 'none', zIndex: 20,
                boxSizing: 'border-box',
              }} />
            )}
          </div>

          {hasAnyMoves && (
            <MoveList
              tree={tree}
              currentNodeId={currentNodeId}
              onNavigate={(id: string | null) => { setIsPlaying(false); setSelectedPos(null); setCurrentNodeId(id); }}
              boardSize={boardSize}
            />
          )}
        </div>

        {/* Navigation controls */}
        {hasAnyMoves && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
              <Btn color="#00ffff" bg="#051520" border="#00ffff30" onClick={() => { setIsPlaying(false); setCurrentNodeId(null); }} disabled={currentNodeId === null}>⏮</Btn>
              <Btn color="#00ffff" bg="#051520" border="#00ffff30" onClick={() => { setIsPlaying(false); setCurrentNodeId(currentNodeId !== null ? (tree.nodes[currentNodeId]?.parentId ?? null) : null); }} disabled={currentNodeId === null}>◀</Btn>
              <button onClick={() => {
                if (isPlaying) { setIsPlaying(false); return; }
                if (currentNodeId === mainLineTip) setCurrentNodeId(null);
                setIsPlaying(true);
              }} style={{
                padding: '8px 20px', fontSize: 13, fontWeight: 700,
                border: `1px solid ${isPlaying ? '#ff9f43' : '#00ff88'}60`,
                borderRadius: 6, cursor: 'pointer',
                backgroundColor: isPlaying ? '#1a0e00' : '#001a0a',
                color: isPlaying ? '#ff9f43' : '#00ff88', letterSpacing: 1,
              }}>{isPlaying ? '⏸ Pause' : '▶ Play'}</button>
              <Btn color="#00ffff" bg="#051520" border="#00ffff30" onClick={stepForwardWithAnim} disabled={!(currentNodeId === null ? tree.rootChildren.length > 0 : (tree.nodes[currentNodeId]?.children.length ?? 0) > 0)}>▶</Btn>
              <Btn color="#00ffff" bg="#051520" border="#00ffff30" onClick={() => { setIsPlaying(false); setCurrentNodeId(mainLineTip); }} disabled={currentNodeId === mainLineTip}>⏭</Btn>
              <div style={{ display: 'flex', gap: 3, marginLeft: 8 }}>
                {SPEED_OPTIONS.map(({ label, ms }) => (
                  <button key={ms} onClick={() => setPlaySpeed(ms)} style={{
                    padding: '6px 10px', fontSize: 11, fontWeight: 600,
                    border: `1px solid ${playSpeed === ms ? '#00ff8880' : '#333'}`,
                    borderRadius: 4, cursor: 'pointer',
                    backgroundColor: playSpeed === ms ? '#001a0a' : 'transparent',
                    color: playSpeed === ms ? '#00ff88' : '#555', letterSpacing: 1,
                  }}>{label}</button>
                ))}
              </div>
            </div>
            {isAnalysisMode && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#ff9f43' }}>
                <span style={{ letterSpacing: 1 }}>Analysis — moves create variations</span>
                <button onClick={() => { setIsPlaying(false); setCurrentNodeId(mainLineTip); }} style={{
                  padding: '4px 12px', fontSize: 11, fontWeight: 600,
                  border: '1px solid #ff9f4360', borderRadius: 4,
                  cursor: 'pointer', backgroundColor: '#1a0e00', color: '#ff9f43',
                }}>Jump to end →</button>
              </div>
            )}
          </div>
        )}

        {/* Board size control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#444', letterSpacing: 1, fontFamily: 'monospace' }}>BOARD</span>
          <button onClick={() => setBoardSize(s => Math.max(BOARD_MIN, s - BOARD_STEP))} disabled={boardSize <= BOARD_MIN} style={{
            width: 28, height: 28, fontSize: 16, fontWeight: 700,
            border: '1px solid #333', borderRadius: 4, cursor: boardSize <= BOARD_MIN ? 'not-allowed' : 'pointer',
            backgroundColor: 'transparent', color: boardSize <= BOARD_MIN ? '#333' : '#888', lineHeight: 1,
          }}>−</button>
          <span style={{ fontSize: 12, color: '#666', fontFamily: 'monospace', minWidth: 40, textAlign: 'center' }}>{boardSize}px</span>
          <button onClick={() => setBoardSize(s => s + BOARD_STEP)} style={{
            width: 28, height: 28, fontSize: 16, fontWeight: 700,
            border: '1px solid #333', borderRadius: 4, cursor: 'pointer',
            backgroundColor: 'transparent', color: '#888', lineHeight: 1,
          }}>+</button>
        </div>

        {/* Game controls */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button onClick={handleUndo} disabled={mainLineTip === null} style={{
            ...BTN, border: '1px solid #00ffff40',
            backgroundColor: mainLineTip === null ? '#1a1a2e' : '#0d2840',
            color: mainLineTip === null ? '#555' : '#00ffff',
            cursor: mainLineTip === null ? 'not-allowed' : 'pointer',
          }}>↩ Undo</button>
          <button onClick={openNewGame} style={{ ...BTN, border: '1px solid #ff00ff40', backgroundColor: '#1a0a2e', color: '#ff00ff' }}>⟳ New Game</button>
          <button onClick={() => setShowExport(true)} style={{ ...BTN, border: '1px solid #00ff8840', backgroundColor: '#0a1a0a', color: '#00ff88' }}>↑ Export</button>
        </div>
      </div>

      {/* ── NEW GAME MODAL ── */}
      {showNewGame && (
        <div style={MODAL_OVERLAY} onClick={() => setShowNewGame(false)}>
          <div style={{ ...MODAL_BOX, border: '1px solid #ff00ff30', boxShadow: '0 0 40px rgba(255,0,255,0.15)' }} onClick={e => e.stopPropagation()}>
            {ngView === 'choice' && (
              <>
                <ModalTitle color="#ff00ff" text="New Game" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <button onClick={startFresh} style={{ ...BTN, border: '1px solid #ff00ff60', backgroundColor: '#1a001a', color: '#ff00ff', width: '100%', padding: '16px 22px', fontSize: 14 }}>♟ Standard Starting Position</button>
                  <button onClick={() => { setNgView('pgn'); setPgnText(''); setPgnError(''); }} style={{ ...BTN, border: '1px solid #00ffff40', backgroundColor: '#001a1a', color: '#00ffff', width: '100%', padding: '16px 22px', fontSize: 14 }}>📄 Load from PGN</button>
                  <button onClick={() => { setNgView('fen'); setFenInput(currentFen); setFenError(''); }} style={{ ...BTN, border: '1px solid #ffd93d40', backgroundColor: '#1a1a00', color: '#ffd93d', width: '100%', padding: '16px 22px', fontSize: 14 }}>⚙ Load from FEN</button>
                </div>
                <div style={{ textAlign: 'right', marginTop: 20 }}>
                  <Btn color="#666" bg="transparent" border="#444" onClick={() => setShowNewGame(false)}>Cancel</Btn>
                </div>
              </>
            )}
            {ngView === 'pgn' && (
              <>
                <ModalTitle color="#00ffff" text="Load from PGN" />
                <textarea value={pgnText} onChange={e => { setPgnText(e.target.value); setPgnError(''); }} placeholder="Paste PGN here..." style={{ ...TEXTAREA, minHeight: 160 }} />
                <label style={{ display: 'block', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: '#666', cursor: 'pointer', textDecoration: 'underline' }}>Or load from .pgn file</span>
                  <input type="file" accept=".pgn,text/plain" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => setPgnText((ev.target?.result as string) ?? ''); r.readAsText(f); }} />
                </label>
                {pgnError && <div style={{ color: '#ff4060', fontSize: 13, marginTop: 8 }}>{pgnError}</div>}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                  <Btn color="#666" bg="transparent" border="#444" onClick={() => setNgView('choice')}>← Back</Btn>
                  <Btn color="#00ffff" bg="#001a1a" border="#00ffff50" onClick={loadFromPgn}>Load Game</Btn>
                </div>
              </>
            )}
            {ngView === 'fen' && (
              <>
                <ModalTitle color="#ffd93d" text="Load from FEN" />
                <textarea value={fenInput} onChange={e => { setFenInput(e.target.value); setFenError(''); }} style={{ ...TEXTAREA, minHeight: 64 }} />
                <div style={{ fontSize: 11, color: '#555', marginTop: 6, lineHeight: 1.5 }}>Format: pieces / turn / castling / en passant / halfmove / fullmove</div>
                <label style={{ display: 'block', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: '#666', cursor: 'pointer', textDecoration: 'underline' }}>Or load from .fen file</span>
                  <input type="file" accept=".fen,text/plain" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => setFenInput(((ev.target?.result as string) ?? '').trim()); r.readAsText(f); }} />
                </label>
                {fenError && <div style={{ color: '#ff4060', fontSize: 13, marginTop: 8 }}>{fenError}</div>}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                  <Btn color="#666" bg="transparent" border="#444" onClick={() => setNgView('choice')}>← Back</Btn>
                  <Btn color="#ffd93d" bg="#1a1a00" border="#ffd93d50" onClick={loadFromFen}>Load Position</Btn>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── EXPORT MODAL ── */}
      {showExport && (
        <div style={MODAL_OVERLAY} onClick={() => setShowExport(false)}>
          <div style={{ ...MODAL_BOX, border: '1px solid #00ff8830', boxShadow: '0 0 40px rgba(0,255,136,0.12)', maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <ModalTitle color="#00ff88" text="Export" />
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: '#00ffff', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>FEN Position</div>
              <textarea value={currentFen} readOnly style={{ ...TEXTAREA, minHeight: 48, color: '#ffd93d', cursor: 'text' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Btn color="#ffd93d" bg="#1a1a00" border="#ffd93d40" onClick={copyFen}>{copyFenMsg || '📋 Copy FEN'}</Btn>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#00ffff', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>PGN Game</div>
              <textarea ref={pgnRef} value={currentPgn} readOnly style={{ ...TEXTAREA, minHeight: 120, color: '#00ff88', cursor: 'text' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <Btn color="#00ff88" bg="#0a1a0a" border="#00ff8840" onClick={copyPgn}>{copyPgnMsg || '📋 Copy PGN'}</Btn>
                <Btn color="#00ff88" bg="#0a1a0a" border="#00ff8840" onClick={() => downloadBlob(currentPgn, 'game.pgn')}>↓ Download .pgn</Btn>
                <Btn color="#ffd93d" bg="#1a1a00" border="#ffd93d40" onClick={() => downloadBlob(currentFen, 'position.fen')}>↓ Download .fen</Btn>
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: 24 }}>
              <Btn color="#666" bg="transparent" border="#444" onClick={() => setShowExport(false)}>Close</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
