import type { PieceColor, PieceType } from '../chess/types';
import { PIECE_SETS, type PieceSet } from '../settings/useSettings';

// Piece code as used by the open-source SVG sets: e.g. 'wK', 'bN'.
const TYPE_CODE: Record<PieceType, string> = {
  king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: 'P',
};

export function pieceCode(color: PieceColor, type: PieceType): string {
  return (color === 'white' ? 'w' : 'b') + TYPE_CODE[type];
}

/**
 * Returns an <img src> for image piece sets, or null for the glyph (Unicode)
 * set — in which case callers fall back to getPieceLabel().
 */
export function pieceSrc(pieceSet: PieceSet, color: PieceColor, type: PieceType): string | null {
  const set = PIECE_SETS[pieceSet] ?? PIECE_SETS.classic;
  if (set.kind === 'glyph') return null;
  return set.dir + pieceCode(color, type) + '.svg';
}
