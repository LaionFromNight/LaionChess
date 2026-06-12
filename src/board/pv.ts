import type { GameState, Position, PieceType } from '../chess/types';
import { executeMove } from '../chess/logic';
import { toFen } from '../chess/fen';
import { algebraicToPos } from './topArrows';

export interface PvMove {
  san: string;
  fen: string;        // position AFTER this move
  from: Position;
  to: Position;
}

const PROMO: Record<string, PieceType> = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };

/**
 * Replay a UCI principal variation from `start`, producing SAN + resulting FEN
 * (for board preview) + from/to for each move. Stops on the first illegal move.
 */
export function expandPv(start: GameState, uci: string[], maxPlies = 12): PvMove[] {
  const out: PvMove[] = [];
  let state = start;

  for (let i = 0; i < uci.length && i < maxPlies; i++) {
    const move = uci[i];
    const from = algebraicToPos(move.slice(0, 2));
    const to = algebraicToPos(move.slice(2, 4));
    if (!from || !to) break;
    const promotion = move[4] ? PROMO[move[4].toLowerCase()] : undefined;

    let next: GameState;
    try {
      next = executeMove(state, from, to, promotion);
    } catch {
      break;
    }
    const san = next.moveHistory[next.moveHistory.length - 1]?.san ?? move;
    out.push({ san, fen: toFen(next), from, to });
    state = next;
  }

  return out;
}
