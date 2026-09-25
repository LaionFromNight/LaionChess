// ── Board-vision drills ("Find it yourself") ─────────────────────────────────
// Turns the overlay logic into quiz questions: the trainee taps every square
// that matches the question, then sees what they found, missed or got wrong.
import type { GameState, PieceColor, Position } from './types';
import { executeMove, findKing, getLegalMoves, isKingInCheck } from './logic';
import { pieceSafety } from './patterns';

export type VisionTask = 'checks' | 'captures' | 'attacked' | 'hanging' | 'loose' | 'pins';

export const VISION_TASKS: Array<{ key: VisionTask; label: string; icon: string; blurb: string }> = [
  { key: 'checks', label: 'Checks', icon: '+', blurb: 'Every square where the side to move can give check' },
  { key: 'captures', label: 'Captures', icon: '×', blurb: 'Every enemy piece the side to move can capture' },
  { key: 'attacked', label: 'Threats', icon: '⚠', blurb: 'Your pieces the opponent is attacking' },
  { key: 'hanging', label: 'Hanging', icon: '$', blurb: 'Pieces that lose material to a capture' },
  { key: 'loose', label: 'Loose', icon: '◌', blurb: 'Undefended pieces (not pawns or kings)' },
  { key: 'pins', label: 'Pins', icon: '📌', blurb: 'Pieces pinned to their king' },
];

export interface VisionQuestion {
  state: GameState;
  lastMove: { from: Position; to: Position } | null;
  task: VisionTask;
  prompt: string;
  answer: Position[];
}

const other = (c: PieceColor): PieceColor => (c === 'white' ? 'black' : 'white');
const key = (p: Position) => `${p.row},${p.col}`;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function legalFrom(s: GameState, from: Position) {
  return getLegalMoves(s.board, from, s.enPassantTarget, s.whiteCanCastleKingside, s.whiteCanCastleQueenside, s.blackCanCastleKingside, s.blackCanCastleQueenside);
}

function allMoves(s: GameState): Array<{ from: Position; to: Position }> {
  const out: Array<{ from: Position; to: Position }> = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = s.board[r][c];
    if (!p || p.color !== s.currentTurn) continue;
    for (const to of legalFrom(s, { row: r, col: c })) out.push({ from: { row: r, col: c }, to });
  }
  return out;
}

export function answerFor(s: GameState, task: VisionTask): Position[] {
  const me = s.currentTurn, opp = other(me);
  const uniq = (list: Position[]) => [...new Map(list.map(p => [key(p), p])).values()];
  switch (task) {
    case 'checks': {
      const out: Position[] = [];
      for (const m of allMoves(s)) {
        const piece = s.board[m.from.row][m.from.col]!;
        const promo = piece.type === 'pawn' && (m.to.row === 0 || m.to.row === 7) ? 'queen' : undefined;
        const next = executeMove(s, m.from, m.to, promo);
        if (next.isCheck) out.push(m.to);
      }
      return uniq(out);
    }
    case 'captures':
      return uniq(allMoves(s).filter(m => s.board[m.to.row][m.to.col]?.color === opp).map(m => m.to));
    case 'attacked':
      return pieceSafety(s.board).filter(p => p.color === me && p.attackers.length > 0).map(p => p.pos);
    case 'hanging':
      return pieceSafety(s.board).filter(p => p.loss > 0).map(p => p.pos);
    case 'loose':
      return pieceSafety(s.board).filter(p => p.type !== 'pawn' && p.defenders.length === 0).map(p => p.pos);
    case 'pins': {
      const out: Position[] = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = s.board[r][c];
        if (!p || p.type === 'king' || !findKing(s.board, p.color)) continue;
        if (isKingInCheck(s.board, p.color)) continue;
        const tmp = s.board.map(row => [...row]);
        tmp[r][c] = null;
        if (isKingInCheck(tmp, p.color)) out.push({ row: r, col: c });
      }
      return out;
    }
  }
}

function promptFor(s: GameState, task: VisionTask): string {
  const me = cap(s.currentTurn), opp = cap(other(s.currentTurn));
  switch (task) {
    case 'checks': return `${me} to move: tap every square where ${me} can give check.`;
    case 'captures': return `${me} to move: tap every ${opp} piece that ${me} can capture.`;
    case 'attacked': return `${me} to move: which ${me} pieces is ${opp} attacking?`;
    case 'hanging': return 'Tap every piece (either side) that loses material to a capture.';
    case 'loose': return 'Tap every loose piece — undefended, not a pawn or king (either side).';
    case 'pins': return 'Tap every piece that is pinned to its king (either side).';
  }
}

/**
 * Build a question: start from a real opening position, play a few random
 * moves to create imbalances, and keep it if the chosen task has 1–8 answers.
 */
export function makeQuestion(pool: GameState[], tasks: VisionTask[], rnd: () => number = Math.random): VisionQuestion | null {
  if (!pool.length || !tasks.length) return null;
  for (let attempt = 0; attempt < 60; attempt++) {
    let s = pool[Math.floor(rnd() * pool.length)];
    let lastMove: { from: Position; to: Position } | null = null;
    const extra = Math.floor(rnd() * 7);
    for (let i = 0; i < extra; i++) {
      const moves = allMoves(s);
      if (!moves.length) break;
      // Prefer captures now and then so material starts hanging.
      const caps = moves.filter(m => s.board[m.to.row][m.to.col]);
      const list = caps.length && rnd() < 0.35 ? caps : moves;
      const m = list[Math.floor(rnd() * list.length)];
      const piece = s.board[m.from.row][m.from.col]!;
      const promo = piece.type === 'pawn' && (m.to.row === 0 || m.to.row === 7) ? 'queen' : undefined;
      s = executeMove(s, m.from, m.to, promo);
      lastMove = m;
    }
    if (s.isCheckmate || s.isStalemate) continue;
    const task = tasks[Math.floor(rnd() * tasks.length)];
    const answer = answerFor(s, task);
    if (answer.length < 1 || answer.length > 8) continue;
    return { state: s, lastMove, task, prompt: promptFor(s, task), answer };
  }
  return null;
}
