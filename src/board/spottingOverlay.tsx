import type { GameState, Position, PieceColor, Board as ChessBoard } from '../chess/types';
import { getLegalMoves, findKing, isKingInCheck } from '../chess/logic';
import type { SpottingMode } from '../chess/analysis';
import { getAttackedSquares, computeDefenseEdges } from '../chess/analysis';
import {
  pieceSafety, pawnStructure, outposts, fileKinds, development, activity, kingZone, VALUE,
} from '../chess/patterns';

// ── palette (matches the arrow palette) ────────────────────────────────────────
export const OV = {
  white: '#ffb830',   // White's pieces / control
  black: '#409cff',   // Black's pieces / control
  good: '#26d08c',    // an opportunity for the side to move
  bad: '#ff5468',     // a danger for the side to move
  warn: '#ffb830',
  violet: '#a080ff',
  ink: '#101216',
} as const;
const side = (c: PieceColor) => (c === 'white' ? OV.white : OV.black);
const other = (c: PieceColor): PieceColor => (c === 'white' ? 'black' : 'white');

// ── legal control map (pins respected, king only to legal squares) ─────────────
function getPinAxis(board: ChessBoard, piecePos: Position, color: PieceColor): Set<string> | null {
  const kingPos = findKing(board, color);
  if (!kingPos) return null;
  const tmp: ChessBoard = board.map(row => [...row]);
  tmp[piecePos.row][piecePos.col] = null;
  if (!isKingInCheck(tmp, color)) return null;
  const stepR = Math.sign(piecePos.row - kingPos.row);
  const stepC = Math.sign(piecePos.col - kingPos.col);
  const axis = new Set<string>();
  for (const s of [1, -1]) {
    let r = kingPos.row + stepR * s, c = kingPos.col + stepC * s;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) { axis.add(`${r},${c}`); r += stepR * s; c += stepC * s; }
  }
  return axis;
}

function legalControl(state: GameState): Record<PieceColor, number[][]> {
  const white = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const black = Array.from({ length: 8 }, () => new Array(8).fill(0));
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const piece = state.board[r][c];
    if (!piece) continue;
    const map = piece.color === 'white' ? white : black;
    if (piece.type === 'king') {
      for (const sq of getAttackedSquares(state.board, { row: r, col: c }, 'king', piece.color)) map[sq.row][sq.col]++;
      continue;
    }
    const pinAxis = getPinAxis(state.board, { row: r, col: c }, piece.color);
    for (const sq of getAttackedSquares(state.board, { row: r, col: c }, piece.type, piece.color)) {
      if (pinAxis && !pinAxis.has(`${sq.row},${sq.col}`)) continue;
      map[sq.row][sq.col]++;
    }
  }
  return { white, black };
}

// ── drawing primitives (viewBox 0 0 8 8, one unit per square) ──────────────────
type Corner = 'tl' | 'tr' | 'bl' | 'br';

function makeKit(flipped: boolean) {
  // Badges sit in a *visual* corner and their text stays upright when the board
  // (and this layer) is rotated 180°.
  const flipCorner: Record<Corner, Corner> = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' };
  const at = (p: Position, corner: Corner) => {
    const k = flipped ? flipCorner[corner] : corner;
    const x = p.col + (k === 'tl' || k === 'bl' ? 0.2 : 0.8);
    const y = p.row + (k === 'tl' || k === 'tr' ? 0.2 : 0.8);
    return { x, y };
  };
  const upright = (x: number, y: number) => (flipped ? `rotate(180 ${x} ${y})` : undefined);

  return {
    tint: (key: string, p: Position, color: string, alpha: number) => (
      <rect key={key} x={p.col + 0.035} y={p.row + 0.035} width={0.93} height={0.93} rx={0.09}
        fill={color} fillOpacity={alpha} />
    ),
    frame: (key: string, p: Position, color: string, opts: { dashed?: boolean; width?: number; alpha?: number } = {}) => (
      <rect key={key} x={p.col + 0.06} y={p.row + 0.06} width={0.88} height={0.88} rx={0.12}
        fill="none" stroke={color} strokeOpacity={opts.alpha ?? 0.95} strokeWidth={opts.width ?? 0.055}
        strokeDasharray={opts.dashed ? '0.14 0.09' : undefined} />
    ),
    ring: (key: string, p: Position, color: string, opts: { dashed?: boolean; width?: number; r?: number; glow?: boolean } = {}) => (
      <g key={key}>
        {opts.glow && <circle cx={p.col + 0.5} cy={p.row + 0.5} r={opts.r ?? 0.44} fill={color} fillOpacity={0.16} />}
        <circle cx={p.col + 0.5} cy={p.row + 0.5} r={opts.r ?? 0.44} fill="none"
          stroke={color} strokeWidth={opts.width ?? 0.065} strokeDasharray={opts.dashed ? '0.16 0.1' : undefined} />
      </g>
    ),
    dot: (key: string, p: Position, color: string, r = 0.13) => (
      <circle key={key} cx={p.col + 0.5} cy={p.row + 0.5} r={r} fill={color} stroke={OV.ink} strokeOpacity={0.4} strokeWidth={0.02} />
    ),
    badge: (key: string, p: Position, corner: Corner, text: string, bg: string, fg: string = OV.ink) => {
      const { x, y } = at(p, corner);
      const w = Math.max(0.3, 0.13 * text.length + 0.14);
      return (
        <g key={key} transform={upright(x, y)} className="ov-badge">
          <rect x={x - w / 2} y={y - 0.14} width={w} height={0.28} rx={0.14} fill={bg} stroke="rgba(255,255,255,0.85)" strokeWidth={0.022} />
          <text x={x} y={y} dy={0.075} textAnchor="middle" fontSize={0.2} fontWeight={800}
            fontFamily="Inter, system-ui, sans-serif" fill={fg}>{text}</text>
        </g>
      );
    },
    line: (key: string, a: Position, b: Position, color: string, opts: { dashed?: boolean; width?: number; arrow?: string; shorten?: number; alpha?: number } = {}) => {
      const x1 = a.col + 0.5, y1 = a.row + 0.5, x2 = b.col + 0.5, y2 = b.row + 0.5;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const s = opts.shorten ?? 0;
      return (
        <line key={key} x1={x1} y1={y1} x2={x2 - ((x2 - x1) / len) * s} y2={y2 - ((y2 - y1) / len) * s}
          stroke={color} strokeOpacity={opts.alpha ?? 0.9} strokeWidth={opts.width ?? 0.06} strokeLinecap="round"
          strokeDasharray={opts.dashed ? '0.14 0.09' : undefined} markerEnd={opts.arrow ? `url(#${opts.arrow})` : undefined} />
      );
    },
    label: (key: string, x: number, y: number, text: string, color: string) => (
      <text key={key} x={x} y={y} transform={upright(x, y)} textAnchor="middle" fontSize={0.19} fontWeight={800}
        fontFamily="Inter, system-ui, sans-serif" fill={color} className="ov-badge">{text}</text>
    ),
  };
}

function markers(id: string) {
  const m = (name: string, color: string) => (
    <marker id={`${id}-${name}`} markerWidth="4" markerHeight="4" refX="2.6" refY="2" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L4,2 L0,4 L1,2 Z" fill={color} />
    </marker>
  );
  return <defs>{m('good', OV.good)}{m('bad', OV.bad)}{m('violet', OV.violet)}{m('white', OV.white)}{m('black', OV.black)}</defs>;
}

const PIECE_LETTER: Record<string, string> = { knight: 'N', bishop: 'B', rook: 'R', queen: 'Q' };

export function buildSpottingOverlay(modes: Set<SpottingMode>, state: GameState, flipped = false): React.ReactNode {
  if (modes.size === 0) return null;
  const { board, currentTurn } = state;
  const k = makeKit(flipped);
  const mid = 'ovm';
  const layers: React.ReactNode[] = [];
  const needControl = modes.has('control-white') || modes.has('control-black') || modes.has('control-balance') || modes.has('king-safety');
  const ctl = needControl ? legalControl(state) : null;

  // ── Square control ─────────────────────────────────────────────────────────
  if (ctl && (modes.has('control-white') || modes.has('control-black'))) {
    const els: React.ReactNode[] = [];
    for (const color of ['white', 'black'] as PieceColor[]) {
      if (!modes.has(color === 'white' ? 'control-white' : 'control-black')) continue;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const n = ctl[color][r][c];
        if (!n) continue;
        els.push(k.tint(`c${color}${r}${c}`, { row: r, col: c }, side(color), Math.min(0.14 + 0.09 * (n - 1), 0.4)));
        if (n > 1) els.push(k.badge(`cb${color}${r}${c}`, { row: r, col: c }, color === 'white' ? 'bl' : 'tr', String(n), side(color)));
      }
    }
    layers.push(<g key="control">{els}</g>);
  }

  if (ctl && modes.has('control-balance')) {
    const els: React.ReactNode[] = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const w = ctl.white[r][c], b = ctl.black[r][c];
      if (!w && !b) continue;
      const p = { row: r, col: c };
      if (w === b) {
        els.push(k.frame(`bal${r}${c}`, p, OV.violet, { dashed: true, width: 0.045 }));
        continue;
      }
      const lead: PieceColor = w > b ? 'white' : 'black';
      els.push(k.tint(`bal${r}${c}`, p, side(lead), Math.min(0.12 + 0.08 * Math.abs(w - b), 0.34)));
      if (w && b) els.push(k.badge(`balb${r}${c}`, p, 'br', `${w}:${b}`, side(lead)));
    }
    layers.push(<g key="balance">{els}</g>);
  }

  // ── Open files ───────────────────────────────────────────────────────────────
  if (modes.has('files')) {
    const els: React.ReactNode[] = [];
    for (const { col, kind } of fileKinds(board)) {
      const color = kind === 'open' ? OV.good : kind === 'half-white' ? OV.white : OV.black;
      els.push(<rect key={`f${col}`} x={col + 0.1} y={0.05} width={0.8} height={7.9} rx={0.4} fill={color} fillOpacity={0.12}
        stroke={color} strokeOpacity={0.55} strokeWidth={0.035} strokeDasharray="0.2 0.12" />);
      const y = flipped ? 7.8 : 0.26;
      els.push(k.label(`fl${col}`, col + 0.5, y, kind === 'open' ? 'OPEN' : 'HALF', color));
      // Rooks / queens already on it get a ring.
      for (let r = 0; r < 8; r++) {
        const p = board[r][col];
        if (p && (p.type === 'rook' || p.type === 'queen')) {
          const fits = kind === 'open' || (kind === 'half-white' && p.color === 'white') || (kind === 'half-black' && p.color === 'black');
          if (fits) els.push(k.ring(`fr${r}${col}`, { row: r, col }, side(p.color), { glow: true }));
        }
      }
    }
    layers.push(<g key="files">{els}</g>);
  }

  // ── Outposts ─────────────────────────────────────────────────────────────────
  if (modes.has('outposts')) {
    const els: React.ReactNode[] = [];
    for (const o of outposts(board)) {
      const cx = o.pos.col + 0.5, cy = o.pos.row + 0.5, s = o.occupied ? 0.3 : 0.2;
      els.push(<path key={`o${o.pos.row}${o.pos.col}${o.color}`} d={`M${cx} ${cy - s} L${cx + s} ${cy} L${cx} ${cy + s} L${cx - s} ${cy} Z`}
        fill={side(o.color)} fillOpacity={o.occupied ? 0.9 : 0.55} stroke="rgba(255,255,255,0.8)" strokeWidth={0.025} />);
      if (o.occupied) els.push(k.ring(`or${o.pos.row}${o.pos.col}`, o.pos, side(o.color), { glow: true }));
    }
    layers.push(<g key="outposts">{els}</g>);
  }

  // ── Pawn structure ───────────────────────────────────────────────────────────
  if (modes.has('pawns')) {
    const els: React.ReactNode[] = [];
    const TAG = { passed: { t: 'P', c: OV.good }, isolated: { t: 'I', c: OV.bad }, doubled: { t: 'D', c: OV.warn }, backward: { t: 'B', c: OV.violet } };
    for (const pw of pawnStructure(board)) {
      const key = `${pw.pos.row}${pw.pos.col}`;
      if (pw.flags.includes('passed')) {
        // Path to promotion.
        const end = { row: pw.color === 'white' ? 0 : 7, col: pw.pos.col };
        if (end.row !== pw.pos.row) els.push(k.line(`pp${key}`, pw.pos, end, OV.good, { dashed: true, width: 0.05, alpha: 0.7 }));
        els.push(<circle key={`pq${key}`} cx={end.col + 0.5} cy={end.row + 0.5} r={0.1} fill={OV.good} />);
        els.push(k.ring(`pr${key}`, pw.pos, OV.good, { glow: true }));
      } else if (pw.flags.includes('isolated') || pw.flags.includes('backward')) {
        els.push(k.ring(`pw${key}`, pw.pos, pw.flags.includes('isolated') ? OV.bad : OV.violet, { dashed: true }));
      }
      pw.flags.forEach((f, i) => els.push(k.badge(`pb${key}${f}`, pw.pos, i === 0 ? 'tl' : i === 1 ? 'tr' : 'bl', TAG[f].t, TAG[f].c)));
    }
    layers.push(<g key="pawns">{els}</g>);
  }

  // ── Development & opening principles ────────────────────────────────────────
  if (modes.has('development')) {
    const els: React.ReactNode[] = [];
    const dev = development(state);
    // The four centre squares, tinted by who controls them.
    const c2 = ctl ?? legalControl(state);
    for (const [r, c] of [[3, 3], [3, 4], [4, 3], [4, 4]]) {
      const w = c2.white[r][c], b = c2.black[r][c];
      const lead = w === b ? OV.violet : side(w > b ? 'white' : 'black');
      els.push(k.frame(`dc${r}${c}`, { row: r, col: c }, lead, { width: 0.06 }));
    }
    for (const u of dev.undeveloped) {
      els.push(k.ring(`du${u.pos.row}${u.pos.col}`, u.pos, side(u.color), { dashed: true }));
      els.push(k.badge(`dub${u.pos.row}${u.pos.col}`, u.pos, 'tr', 'dev', side(u.color)));
    }
    for (const u of dev.uncastled) {
      els.push(k.ring(`dk${u.pos.row}${u.pos.col}`, u.pos, OV.bad, { dashed: true, width: 0.075 }));
      els.push(k.badge(`dkb${u.pos.row}${u.pos.col}`, u.pos, 'tr', 'O-O?', OV.bad));
    }
    for (const q of dev.earlyQueen) {
      els.push(k.ring(`dq${q.pos.row}${q.pos.col}`, q.pos, OV.warn, { width: 0.07 }));
      els.push(k.badge(`dqb${q.pos.row}${q.pos.col}`, q.pos, 'tr', 'early', OV.warn));
    }
    layers.push(<g key="development">{els}</g>);
  }

  // ── Piece activity ───────────────────────────────────────────────────────────
  if (modes.has('activity')) {
    const els: React.ReactNode[] = [];
    for (const a of activity(state)) {
      const max = { knight: 8, bishop: 13, rook: 14, queen: 27 }[a.type as 'knight'] ?? 8;
      const ratio = a.moves / max;
      const color = ratio >= 0.5 ? OV.good : a.moves <= 2 ? OV.bad : OV.warn;
      const key = `${a.pos.row}${a.pos.col}`;
      if (a.moves <= 2) els.push(k.ring(`ar${key}`, a.pos, OV.bad, { dashed: true }));
      els.push(k.badge(`ab${key}`, a.pos, 'br', String(a.moves), color));
      if (a.badBishop) els.push(k.badge(`abb${key}`, a.pos, 'tl', 'bad', OV.violet, '#fff'));
    }
    layers.push(<g key="activity">{els}</g>);
  }

  // ── Protection map (who defends whom) ──────────────────────────────────────
  if (modes.has('protection')) {
    const els: React.ReactNode[] = [];
    const edges = computeDefenseEdges(board);
    edges.forEach((e, i) => els.push(k.line(`pe${i}`, e.from, e.to, side(e.color), { width: 0.035, alpha: 0.45, shorten: 0.3 })));
    const count = new Map<string, { n: number; color: PieceColor; pos: Position }>();
    for (const e of edges) {
      const key = `${e.to.row},${e.to.col}`;
      const cur = count.get(key) ?? { n: 0, color: e.color, pos: e.to };
      cur.n++;
      count.set(key, cur);
    }
    for (const [key, v] of count) els.push(k.badge(`pb${key}`, v.pos, 'bl', `×${v.n}`, side(v.color)));
    layers.push(<g key="protection">{els}</g>);
  }

  // ── Loose pieces (LPDO) ──────────────────────────────────────────────────────
  const safety = modes.has('loose') || modes.has('hanging') ? pieceSafety(board) : [];
  if (modes.has('loose')) {
    const els: React.ReactNode[] = [];
    for (const s of safety) {
      if (s.defenders.length || s.loss > 0) continue; // hanging ones are shown by "Hanging pieces"
      if (s.type === 'pawn') continue;
      els.push(k.ring(`l${s.pos.row}${s.pos.col}`, s.pos, OV.warn, { dashed: true, width: 0.07, glow: true }));
      els.push(k.badge(`lb${s.pos.row}${s.pos.col}`, s.pos, 'tl', 'loose', OV.warn));
    }
    layers.push(<g key="loose">{els}</g>);
  }

  // ── Hanging pieces (static exchange evaluation) ───────────────────────────────
  if (modes.has('hanging')) {
    const els: React.ReactNode[] = [];
    for (const s of safety) {
      if (!s.attackers.length) continue;
      const key = `${s.pos.row}${s.pos.col}`;
      const mine = s.color === currentTurn; // a danger for the side to move
      if (s.loss > 0) {
        const color = mine ? OV.bad : OV.good;
        els.push(<g key={`h${key}`} className="ov-pulse">{k.tint(`ht${key}`, s.pos, color, 0.3)}</g>);
        els.push(k.ring(`hr${key}`, s.pos, color, { width: 0.08 }));
        const cheapest = [...s.attackers].sort((a, b) => VALUE[a.type] - VALUE[b.type])[0];
        els.push(k.line(`ha${key}`, cheapest.pos, s.pos, color, { width: 0.075, arrow: `${mid}-${mine ? 'bad' : 'good'}`, shorten: 0.42 }));
        els.push(k.badge(`hb${key}`, s.pos, 'tr', `${mine ? '−' : '+'}${s.loss}`, color, '#fff'));
      } else {
        // Attacked but adequately defended: a quiet amber frame with the count.
        els.push(k.frame(`hs${key}`, s.pos, OV.warn, { dashed: true, width: 0.04, alpha: 0.8 }));
        els.push(k.badge(`hsb${key}`, s.pos, 'tr', `${s.attackers.length}:${s.defenders.length}`, OV.warn));
      }
    }
    layers.push(<g key="hanging">{els}</g>);
  }

  // ── King safety: king zone pressure, escape squares and pins ────────────────
  if (modes.has('king-safety') && ctl) {
    const els: React.ReactNode[] = [];
    for (const color of ['white', 'black'] as PieceColor[]) {
      const kp = findKing(board, color);
      if (!kp) continue;
      const enemy = ctl[other(color)];
      let pressure = 0;
      for (const z of kingZone(board, color, kp, enemy)) {
        pressure += z.hits;
        if (z.hits) {
          els.push(k.tint(`kz${color}${z.pos.row}${z.pos.col}`, z.pos, OV.bad, Math.min(0.18 + 0.1 * z.hits, 0.45)));
          if (z.hits > 1) els.push(k.badge(`kzb${color}${z.pos.row}${z.pos.col}`, z.pos, 'br', String(z.hits), OV.bad, '#fff'));
        }
      }
      const escapes = getLegalMoves(board, kp, state.enPassantTarget,
        state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
        state.blackCanCastleKingside, state.blackCanCastleQueenside)
        .filter(m => Math.abs(m.col - kp.col) <= 1);
      escapes.forEach(m => els.push(k.dot(`ke${color}${m.row}${m.col}`, m, OV.good, 0.11)));
      const inCheck = isKingInCheck(board, color);
      els.push(k.ring(`kr${color}`, kp, inCheck ? OV.bad : side(color), { width: 0.085, glow: true }));
      // Escape-square count only matters once the king is under some pressure.
      if (inCheck || pressure > 0) {
        els.push(k.badge(`kb${color}`, kp, 'tr', `${escapes.length}`, escapes.length <= 1 ? OV.bad : OV.good, escapes.length <= 1 ? '#fff' : OV.ink));
      }
      // Pins: a piece that shields its king from a slider.
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p || p.color !== color || p.type === 'king') continue;
        const tmp: ChessBoard = board.map(row => [...row]);
        tmp[r][c] = null;
        if (!isKingInCheck(tmp, color)) continue;
        const dr = Math.sign(r - kp.row), dc = Math.sign(c - kp.col);
        let sr = r + dr, sc = c + dc;
        while (sr >= 0 && sr < 8 && sc >= 0 && sc < 8 && !tmp[sr][sc]) { sr += dr; sc += dc; }
        if (sr >= 0 && sr < 8 && sc >= 0 && sc < 8) {
          els.push(k.line(`kp${r}${c}`, { row: sr, col: sc }, kp, OV.bad, { dashed: true, width: 0.05, alpha: 0.75, shorten: 0.4 }));
        }
        els.push(k.ring(`kpr${r}${c}`, { row: r, col: c }, OV.violet, { width: 0.07 }));
        els.push(k.badge(`kpb${r}${c}`, { row: r, col: c }, 'tl', 'pin', OV.violet, '#fff'));
      }
    }
    layers.push(<g key="king">{els}</g>);
  }

  // ── Checks available to the side to move ─────────────────────────────────────
  if (modes.has('checks')) {
    const els: React.ReactNode[] = [];
    const opp = other(currentTurn);
    const oppKing = findKing(board, opp);
    if (oppKing) {
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece || piece.color !== currentTurn) continue;
        const legal = getLegalMoves(board, { row: r, col: c }, state.enPassantTarget,
          state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
          state.blackCanCastleKingside, state.blackCanCastleQueenside);
        for (const dest of legal) {
          const tmp: ChessBoard = board.map(row => [...row]);
          tmp[dest.row][dest.col] = (piece.type === 'pawn' && (dest.row === 0 || dest.row === 7)) ? { type: 'queen', color: piece.color } : piece;
          tmp[r][c] = null;
          if (!isKingInCheck(tmp, opp)) continue;
          // Safe check = the checking piece can't simply be taken.
          const moved = tmp[dest.row][dest.col]!;
          const hits = [];
          for (let rr = 0; rr < 8; rr++) for (let cc = 0; cc < 8; cc++) {
            const q = tmp[rr][cc];
            if (q && q.color === opp && getAttackedSquares(tmp, { row: rr, col: cc }, q.type, q.color).some(s => s.row === dest.row && s.col === dest.col)) hits.push(q);
          }
          const safe = hits.length === 0;
          const color = safe ? OV.good : OV.violet;
          const key = `${r}${c}${dest.row}${dest.col}`;
          els.push(k.tint(`cht${key}`, dest, color, 0.22));
          els.push(k.line(`cha${key}`, { row: r, col: c }, dest, color, { width: 0.065, arrow: `${mid}-${safe ? 'good' : 'violet'}`, shorten: 0.36, dashed: !safe }));
          els.push(k.badge(`chb${key}`, dest, 'tr', `${PIECE_LETTER[moved.type] ?? ''}+`, color, safe ? OV.ink : '#fff'));
        }
      }
      els.push(k.ring('chk', oppKing, OV.bad, { width: 0.07, dashed: true }));
    }
    layers.push(<g key="checks">{els}</g>);
  }

  if (!layers.length) return null;
  return (
    <svg className="ov-layer" viewBox="0 0 8 8" width="100%" height="100%" style={{ position: 'absolute', inset: 0 }} xmlns="http://www.w3.org/2000/svg">
      {markers(mid)}
      {layers}
    </svg>
  );
}
