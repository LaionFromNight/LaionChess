// ── Positional & tactical patterns behind the board overlays ─────────────────
// Each helper encodes a rule of thumb players are taught: static exchange
// evaluation for hanging pieces, "loose pieces drop off" (LPDO), pawn-structure
// weaknesses, outposts, open files, opening development and piece activity.
import type { Board, GameState, PieceColor, PieceType, Position } from './types';
import { getAttackedSquares } from './analysis';
import { getLegalMoves } from './logic';

export const VALUE: Record<PieceType, number> = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };
const other = (c: PieceColor): PieceColor => (c === 'white' ? 'black' : 'white');

export interface Hit { pos: Position; type: PieceType; color: PieceColor }

/** All pieces of both colours that attack (or defend) `sq`. */
export function hitsOn(board: Board, sq: Position): Hit[] {
  const out: Hit[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p || (r === sq.row && c === sq.col)) continue;
    if (getAttackedSquares(board, { row: r, col: c }, p.type, p.color).some(s => s.row === sq.row && s.col === sq.col)) {
      out.push({ pos: { row: r, col: c }, type: p.type, color: p.color });
    }
  }
  return out;
}

/**
 * Static exchange evaluation: material the attacker nets by starting a capture
 * sequence on `sq`, both sides always recapturing with their cheapest piece and
 * free to stop when it stops paying. > 0 means the piece is really en prise.
 */
export function see(target: PieceType, attackers: PieceType[], defenders: PieceType[]): number {
  const a = attackers.map(t => VALUE[t]).sort((x, y) => x - y);
  const d = defenders.map(t => VALUE[t]).sort((x, y) => x - y);
  if (!a.length) return 0;
  const gain: number[] = [VALUE[target]];
  let onSquare = a[0];
  let ai = 1, di = 0, side: 'a' | 'd' = 'd';
  for (;;) {
    const list = side === 'a' ? a : d;
    const idx = side === 'a' ? ai : di;
    if (idx >= list.length) break;
    gain.push(onSquare - gain[gain.length - 1]);
    onSquare = list[idx];
    if (side === 'a') ai++; else di++;
    side = side === 'a' ? 'd' : 'a';
  }
  for (let i = gain.length - 1; i > 0; i--) gain[i - 1] = -Math.max(-gain[i - 1], gain[i]);
  return gain[0];
}

export interface PieceSafety {
  pos: Position;
  color: PieceColor;
  type: PieceType;
  attackers: Hit[];
  defenders: Hit[];
  /** Material the opponent wins by capturing here (SEE), 0 if safe. */
  loss: number;
}

/** Safety of every non-king piece: attackers, defenders and SEE loss. */
export function pieceSafety(board: Board): PieceSafety[] {
  const out: PieceSafety[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p || p.type === 'king') continue;
    const hits = hitsOn(board, { row: r, col: c });
    const attackers = hits.filter(h => h.color !== p.color);
    const defenders = hits.filter(h => h.color === p.color);
    const loss = Math.max(0, see(p.type, attackers.map(h => h.type), defenders.map(h => h.type)));
    out.push({ pos: { row: r, col: c }, color: p.color, type: p.type, attackers, defenders, loss });
  }
  return out;
}

// ── pawn structure ─────────────────────────────────────────────────────────────
export type PawnFlag = 'passed' | 'isolated' | 'doubled' | 'backward';
export interface PawnInfo { pos: Position; color: PieceColor; flags: PawnFlag[] }

export function pawnStructure(board: Board): PawnInfo[] {
  const files: Record<PieceColor, number[][]> = { white: [[], [], [], [], [], [], [], []], black: [[], [], [], [], [], [], [], []] };
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (p?.type === 'pawn') files[p.color][c].push(r);
  }
  const out: PawnInfo[] = [];
  for (const color of ['white', 'black'] as PieceColor[]) {
    const dir = color === 'white' ? -1 : 1; // forward row step
    const opp = files[other(color)];
    const own = files[color];
    for (let c = 0; c < 8; c++) for (const r of own[c]) {
      const flags: PawnFlag[] = [];
      const ahead = (row: number) => (color === 'white' ? row < r : row > r);
      // Passed: no enemy pawn in front on this or an adjacent file (and not the
      // rear pawn of a doubled pair — its own pawn blocks the way).
      const passed = [c - 1, c, c + 1].every(f => f < 0 || f > 7 || !opp[f].some(ahead)) && !own[c].some(ahead);
      if (passed) flags.push('passed');
      const neighbours = [c - 1, c + 1].filter(f => f >= 0 && f <= 7);
      const isolated = neighbours.every(f => own[f].length === 0);
      if (isolated) flags.push('isolated');
      if (own[c].length > 1) flags.push('doubled');
      if (!isolated && !passed) {
        // Backward: every friendly neighbour pawn is further advanced, and the
        // square in front is covered by an enemy pawn.
        const behindAll = neighbours.every(f => own[f].every(nr => (color === 'white' ? nr < r : nr > r)));
        const stop = r + dir;
        const stopHit = stop >= 0 && stop <= 7 && [c - 1, c + 1].some(f => f >= 0 && f <= 7 && opp[f].includes(stop + dir));
        if (behindAll && stopHit) flags.push('backward');
      }
      if (flags.length) out.push({ pos: { row: r, col: c }, color, flags });
    }
  }
  return out;
}

// ── outposts ───────────────────────────────────────────────────────────────────
export interface Outpost { pos: Position; color: PieceColor; occupied: boolean }

/**
 * A square in the enemy half, supported by an own pawn, that no enemy pawn can
 * ever attack (no enemy pawn left on the adjacent files in front of it).
 */
export function outposts(board: Board): Outpost[] {
  const out: Outpost[] = [];
  for (const color of ['white', 'black'] as PieceColor[]) {
    const rows = color === 'white' ? [2, 3, 4] : [3, 4, 5]; // ranks 4-6 for each side
    const opp = other(color);
    const dir = color === 'white' ? -1 : 1;
    for (const r of rows) for (let c = 0; c < 8; c++) {
      const occ = board[r][c];
      if (occ?.type === 'pawn') continue;
      const supported = [c - 1, c + 1].some(f => f >= 0 && f <= 7 && board[r - dir]?.[f]?.type === 'pawn' && board[r - dir][f]!.color === color);
      if (!supported) continue;
      let attackable = false;
      for (const f of [c - 1, c + 1]) {
        if (f < 0 || f > 7) continue;
        for (let rr = r + dir; rr >= 0 && rr <= 7; rr += dir) {
          const p = board[rr][f];
          if (p?.type === 'pawn' && p.color === opp) attackable = true;
        }
      }
      if (attackable) continue;
      out.push({ pos: { row: r, col: c }, color, occupied: !!occ && occ.color === color && (occ.type === 'knight' || occ.type === 'bishop') });
    }
  }
  return out;
}

// ── open files ─────────────────────────────────────────────────────────────────
export type FileKind = 'open' | 'half-white' | 'half-black';
/** Open (no pawns) and half-open files (half-white = open for White's rooks). */
export function fileKinds(board: Board): Array<{ col: number; kind: FileKind }> {
  const out: Array<{ col: number; kind: FileKind }> = [];
  for (let c = 0; c < 8; c++) {
    let w = false, b = false;
    for (let r = 0; r < 8; r++) {
      const p = board[r][c];
      if (p?.type === 'pawn') { if (p.color === 'white') w = true; else b = true; }
    }
    if (!w && !b) out.push({ col: c, kind: 'open' });
    else if (!w) out.push({ col: c, kind: 'half-white' });
    else if (!b) out.push({ col: c, kind: 'half-black' });
  }
  return out;
}

// ── development (opening principles) ─────────────────────────────────────────────
export interface DevelopmentInfo {
  undeveloped: Array<{ pos: Position; color: PieceColor }>;
  uncastled: Array<{ pos: Position; color: PieceColor }>;
  earlyQueen: Array<{ pos: Position; color: PieceColor }>;
}

const HOME: Record<PieceColor, Array<{ col: number; type: PieceType }>> = {
  white: [{ col: 1, type: 'knight' }, { col: 6, type: 'knight' }, { col: 2, type: 'bishop' }, { col: 5, type: 'bishop' }],
  black: [{ col: 1, type: 'knight' }, { col: 6, type: 'knight' }, { col: 2, type: 'bishop' }, { col: 5, type: 'bishop' }],
};

export function development(state: GameState): DevelopmentInfo {
  const { board } = state;
  const info: DevelopmentInfo = { undeveloped: [], uncastled: [], earlyQueen: [] };
  for (const color of ['white', 'black'] as PieceColor[]) {
    const back = color === 'white' ? 7 : 0;
    let homeMinors = 0;
    for (const h of HOME[color]) {
      const p = board[back][h.col];
      if (p && p.color === color && p.type === h.type) { info.undeveloped.push({ pos: { row: back, col: h.col }, color }); homeMinors++; }
    }
    const k = board[back][4];
    const canCastle = color === 'white'
      ? state.whiteCanCastleKingside || state.whiteCanCastleQueenside
      : state.blackCanCastleKingside || state.blackCanCastleQueenside;
    if (k?.type === 'king' && k.color === color && canCastle && state.fullmoveNumber >= 6) info.uncastled.push({ pos: { row: back, col: 4 }, color });
    // Queen out while two or more minor pieces are still at home.
    if (homeMinors >= 2) {
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p?.type === 'queen' && p.color === color && !(r === back && c === 3)) info.earlyQueen.push({ pos: { row: r, col: c }, color });
      }
    }
  }
  return info;
}

// ── piece activity ───────────────────────────────────────────────────────────────
export interface Activity { pos: Position; color: PieceColor; type: PieceType; moves: number; badBishop: boolean }

/** Mobility (legal moves) of every minor/major piece, plus "bad bishop" detection. */
export function activity(state: GameState): Activity[] {
  const { board } = state;
  const out: Activity[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p || p.type === 'pawn' || p.type === 'king') continue;
    const moves = getLegalMoves(board, { row: r, col: c }, state.enPassantTarget,
      state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
      state.blackCanCastleKingside, state.blackCanCastleQueenside).length;
    let badBishop = false;
    if (p.type === 'bishop') {
      // Own centre pawns (c–f files) fixed on the bishop's square colour.
      const shade = (r + c) % 2;
      let blockers = 0;
      for (let rr = 0; rr < 8; rr++) for (let cc = 2; cc <= 5; cc++) {
        const q = board[rr][cc];
        if (q?.type === 'pawn' && q.color === p.color && (rr + cc) % 2 === shade) blockers++;
      }
      badBishop = blockers >= 2;
    }
    out.push({ pos: { row: r, col: c }, color: p.color, type: p.type, moves, badBishop });
  }
  return out;
}

/** Squares around each king (the "king zone") and how often the enemy hits them. */
export function kingZone(board: Board, color: PieceColor, kingPos: Position, attackMap: number[][]): Array<{ pos: Position; hits: number }> {
  const out: Array<{ pos: Position; hits: number }> = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const r = kingPos.row + dr, c = kingPos.col + dc;
    if (r < 0 || r > 7 || c < 0 || c > 7 || (dr === 0 && dc === 0)) continue;
    const occ = board[r][c];
    if (occ && occ.color === color && occ.type !== 'pawn' && attackMap[r][c] === 0) continue;
    out.push({ pos: { row: r, col: c }, hits: attackMap[r][c] });
  }
  return out;
}
