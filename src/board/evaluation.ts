import type { GameState, PieceType } from '../chess/types';
import { toFen } from '../chess/fen';

const VALUES: Record<PieceType, number> = {
  pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0,
};

/**
 * v1 evaluation = material balance (white positive), in pawns.
 * Isolated behind this seam so a later Stockfish / Lichess-cloud integration
 * can swap only this function (see tech-chess-docs/stockfish-analysis-*).
 */
export function getEvaluation(state: GameState): number {
  let score = 0;
  for (const row of state.board) {
    for (const piece of row) {
      if (!piece) continue;
      const v = VALUES[piece.type];
      score += piece.color === 'white' ? v : -v;
    }
  }
  return score;
}

/** Book key = "<placement> <w|b>" derived from the position's FEN. */
export function bookKey(state: GameState): string {
  const fen = toFen(state);
  const fields = fen.split(' ');
  return `${fields[0]} ${fields[1]}`;
}
