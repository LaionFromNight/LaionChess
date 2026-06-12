import type { GameState, Position, PieceColor, Board as ChessBoard } from '../chess/types';
import { getLegalMoves, findKing, isKingInCheck } from '../chess/logic';
import type { SpottingMode } from '../chess/analysis';
import { getAttackedSquares, computeDefenseEdges, computeExchanges } from '../chess/analysis';

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

export function buildSpottingOverlay(modes: Set<SpottingMode>, state: GameState): React.ReactNode {
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
      const mobileBright = color === 'white' ? '#ffe040' : '#00eeff';

      elems.push(<circle key={`king-ring-${color}`}
        cx={kx} cy={ky} r={0.43}
        fill="none" stroke={ringColor} strokeWidth={0.08} />);

      const colorInCheck = isKingInCheck(board, color);

      if (!colorInCheck) {
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

            const checkers = findCheckingPieces(tmp, oppKingPos, currentTurn);
            const unsafe = checkers.some(chk => isRawAttackedBy(tmp, chk, oppColor));

            sources.add(`${r},${c}`);
            shots.push({ fr: r, fc: c, tr: dest.row, tc: dest.col, checkers, unsafe });
          }
        }
      }

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

        const shotColor  = unsafe ? '#b400ff' : '#3cff5a';
        const destFill   = unsafe ? 'rgba(180,0,255,0.28)' : 'rgba(50,255,80,0.28)';
        const arrowMark  = unsafe ? 'url(#arr-shot-unsafe)' : 'url(#arr-shot-safe)';

        elems.push(<rect key={`shot-dest-${k}`}
          x={tc} y={tr} width={1} height={1} fill={destFill} />);

        const adx = tx - fx, ady = ty - fy;
        const alen = Math.sqrt(adx * adx + ady * ady);
        if (alen > 0.01) {
          elems.push(<line key={`shot-arrow-${k}`}
            x1={fx} y1={fy}
            x2={tx - (adx / alen) * 0.38} y2={ty - (ady / alen) * 0.38}
            stroke={shotColor} strokeWidth={0.07}
            markerEnd={arrowMark} strokeLinecap="round" />);
        }

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

  if (layers.length <= 1) return null;
  return <svg {...SVG_PROPS}>{layers}</svg>;
}
