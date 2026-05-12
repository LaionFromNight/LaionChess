import type { GameState, Move, PieceType, Position } from './types';
import { getLegalMoves, executeMove } from './logic';

export function moveToSan(state: GameState, move: Move): string {
  const next = executeMove(state, move.from, move.to, move.promotion);
  return next.moveHistory[next.moveHistory.length - 1]?.san ?? '';
}

const WHITE_SYMBOLS: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const BLACK_SYMBOLS: Record<string, string> = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };

export function renderSanForMoveList(san: string, color: 'w' | 'b'): string {
  if (san.startsWith('O')) return san;
  const first = san[0];
  if (first && 'KQRBN'.includes(first)) {
    const symbols = color === 'w' ? WHITE_SYMBOLS : BLACK_SYMBOLS;
    return symbols[first] + san.slice(1);
  }
  return san;
}

export function resolveSan(
  state: GameState,
  san: string
): { from: Position; to: Position; promotionPiece?: PieceType } | null {
  // Strip check/checkmate/annotation suffixes
  let s = san.replace(/[+#!?]+$/, '');

  // Handle castling
  if (s === 'O-O-O' || s === '0-0-0') {
    const row = state.currentTurn === 'white' ? 7 : 0;
    return { from: { row, col: 4 }, to: { row, col: 2 } };
  }
  if (s === 'O-O' || s === '0-0') {
    const row = state.currentTurn === 'white' ? 7 : 0;
    return { from: { row, col: 4 }, to: { row, col: 6 } };
  }

  // Promotion
  let promotionPiece: PieceType | undefined;
  const promMatch = s.match(/=([NBRQ])$/i);
  if (promMatch) {
    const promMap: Record<string, PieceType> = { N: 'knight', B: 'bishop', R: 'rook', Q: 'queen' };
    promotionPiece = promMap[promMatch[1].toUpperCase()];
    s = s.replace(/=[NBRQ]$/i, '');
  }

  // Strip capture 'x'
  s = s.replace('x', '');

  // Destination: last two chars
  if (s.length < 2) return null;
  const destStr = s.slice(-2);
  if (!/^[a-h][1-8]$/.test(destStr)) return null;
  const toCol = destStr.charCodeAt(0) - 97;
  const toRow = 8 - parseInt(destStr[1], 10);
  const to: Position = { row: toRow, col: toCol };
  s = s.slice(0, -2);

  // Piece type
  const PIECE_LETTERS: Record<string, PieceType> = {
    K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight',
  };
  let pieceType: PieceType = 'pawn';
  if (s.length > 0 && 'KQRBN'.includes(s[0])) {
    pieceType = PIECE_LETTERS[s[0]];
    s = s.slice(1);
  }

  // Disambiguation
  let disambigFile: number | undefined;
  let disambigRank: number | undefined;
  for (const ch of s) {
    if (/[a-h]/.test(ch)) disambigFile = ch.charCodeAt(0) - 97;
    else if (/[1-8]/.test(ch)) disambigRank = 8 - parseInt(ch, 10);
  }

  // Find all legal moves for current player
  const candidates: { from: Position; to: Position }[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = state.board[r][c];
      if (!piece || piece.color !== state.currentTurn || piece.type !== pieceType) continue;
      if (disambigFile !== undefined && c !== disambigFile) continue;
      if (disambigRank !== undefined && r !== disambigRank) continue;

      const legalTos = getLegalMoves(
        state.board,
        { row: r, col: c },
        state.enPassantTarget,
        state.whiteCanCastleKingside,
        state.whiteCanCastleQueenside,
        state.blackCanCastleKingside,
        state.blackCanCastleQueenside
      );

      if (legalTos.some(m => m.row === to.row && m.col === to.col)) {
        candidates.push({ from: { row: r, col: c }, to });
      }
    }
  }

  if (candidates.length !== 1) return null;
  return { ...candidates[0], promotionPiece };
}
