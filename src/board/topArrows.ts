import type { GameState, Position, PieceType } from '../chess/types';
import { resolveSan } from '../chess/san';
import { getLegalMoves } from '../chess/logic';
import type { BoardArrow } from '../components/Board';
import type { BookRow } from '../data/book';
import { ARROW } from './arrowPalette';

// Wider than engine arrows, so where both agree the book shows as a see-through halo.
const WIDTHS = [3.6, 3.2, 2.9];

/**
 * Top-3 most-played book moves for the current position, drawn as board arrows.
 * `rows` come from the live Lichess explorer (or the static fallback).
 */
export function computeTopArrows(state: GameState, rows: BookRow[] | null): BoardArrow[] {
  if (!rows) return [];
  const arrows: BoardArrow[] = [];
  rows.slice(0, 3).forEach((row, i) => {
    const resolved = resolveSan(state, row[0]);
    if (resolved) {
      // One see-through colour for all book moves; the number is the popularity rank.
      arrows.push({
        from: resolved.from, to: resolved.to, color: ARROW.book, width: WIDTHS[i],
        label: String(i + 1), labelAt: 'tail',
      });
    }
  });
  return arrows;
}

// ── algebraic square helpers (for course ply from/to fallbacks) ───────────────
export function algebraicToPos(sq: string): Position | null {
  if (!sq || sq.length < 2) return null;
  const col = sq.charCodeAt(0) - 97;
  const row = 8 - parseInt(sq[1], 10);
  if (col < 0 || col > 7 || row < 0 || row > 7 || Number.isNaN(row)) return null;
  return { row, col };
}

function isLegal(state: GameState, from: Position, to: Position): boolean {
  const piece = state.board[from.row]?.[from.col];
  if (!piece || piece.color !== state.currentTurn) return false;
  return getLegalMoves(
    state.board, from, state.enPassantTarget,
    state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
    state.blackCanCastleKingside, state.blackCanCastleQueenside,
  ).some(m => m.row === to.row && m.col === to.col);
}

export interface ResolvedMove { from: Position; to: Position; promotionPiece?: PieceType }

/**
 * Resolve a course ply to a concrete move against the live state. Prefers the
 * engine's SAN resolver (so data stays engine-consistent), falling back to the
 * advisory from/to squares (covers castling SANs the resolver may not parse).
 */
export function resolvePly(
  state: GameState,
  ply: { san: string; from?: string; to?: string; promo?: string },
): ResolvedMove | null {
  const bySan = resolveSan(state, ply.san);
  if (bySan) return bySan;
  const from = ply.from ? algebraicToPos(ply.from) : null;
  const to = ply.to ? algebraicToPos(ply.to) : null;
  if (from && to && isLegal(state, from, to)) {
    const promo = ply.promo
      ? ({ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[ply.promo.toLowerCase()] as PieceType | undefined)
      : undefined;
    return { from, to, promotionPiece: promo };
  }
  return null;
}
