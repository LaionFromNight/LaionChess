import type { GameState, Position, PieceType } from '../chess/types';
import { resolveSan } from '../chess/san';
import type { BoardArrow } from '../components/Board';
import type { BookRow } from '../data/book';

const COLORS = ['rgba(0,255,136,0.9)', 'rgba(255,217,61,0.8)', 'rgba(255,0,255,0.7)'];
const WIDTHS = [2.8, 2.2, 1.7];

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
      arrows.push({ from: resolved.from, to: resolved.to, color: COLORS[i], width: WIDTHS[i] });
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
  if (from && to) {
    const promo = ply.promo
      ? ({ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[ply.promo.toLowerCase()] as PieceType | undefined)
      : undefined;
    return { from, to, promotionPiece: promo };
  }
  return null;
}
