import type { GameState, Board, PieceColor, PieceType, Position } from './types';
import { getLegalMoves, hasAnyLegalMoves, isKingInCheck } from './logic';

// Piece type to FEN char mapping (CRITICAL: knight = 'n', NOT 'k')
const PIECE_TO_FEN: Record<PieceType, string> = {
  king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p',
};

const FEN_TO_PIECE: Record<string, PieceType> = {
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn',
};

export type EnPassantPolicy = 'fen-spec-compatible' | 'legal-only';
export type FenFieldName = 'piecePlacement' | 'activeColor' | 'castlingAvailability' | 'enPassantTarget' | 'halfmoveClock' | 'fullmoveNumber';
export interface FenValidationError { code: string; message: string; field?: FenFieldName; }
export interface FenValidationWarning { code: string; message: string; field?: FenFieldName; }
export interface FenValidationResult { valid: boolean; errors: FenValidationError[]; warnings: FenValidationWarning[]; }

export function parseFen(fen: string, options?: { strict?: boolean }): GameState | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.length !== 6) return null;

  const [placement, activeColorStr, castlingStr, epStr, halfmoveStr, fullmoveStr] = parts;

  // Parse board
  const board: Board = Array(8).fill(null).map(() => Array(8).fill(null));
  const ranks = placement.split('/');
  if (ranks.length !== 8) return null;

  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    let col = 0;
    for (const ch of ranks[rankIdx]) {
      if (/[1-8]/.test(ch)) {
        col += parseInt(ch, 10);
      } else if (/[pnbrqkPNBRQK]/.test(ch)) {
        const pieceType = FEN_TO_PIECE[ch.toLowerCase()];
        if (!pieceType) return null;
        const color: PieceColor = ch === ch.toUpperCase() ? 'white' : 'black';
        if (col >= 8) return null;
        board[rankIdx][col] = { type: pieceType, color };
        col++;
      } else {
        return null;
      }
    }
    if (col !== 8) return null;
  }

  // Active color
  if (activeColorStr !== 'w' && activeColorStr !== 'b') return null;
  const currentTurn: PieceColor = activeColorStr === 'w' ? 'white' : 'black';

  // Castling
  const wCK = castlingStr.includes('K');
  const wCQ = castlingStr.includes('Q');
  const bCK = castlingStr.includes('k');
  const bCQ = castlingStr.includes('q');
  if (castlingStr !== '-' && !/^[KQkq]+$/.test(castlingStr)) return null;

  // En passant
  let enPassantTarget: Position | null = null;
  if (epStr !== '-') {
    if (!/^[a-h][36]$/.test(epStr)) return null;
    const col = epStr.charCodeAt(0) - 97;
    const row = 8 - parseInt(epStr[1], 10);
    enPassantTarget = { row, col };
  }

  // Clocks
  const halfmoveClock = parseInt(halfmoveStr, 10);
  const fullmoveNumber = parseInt(fullmoveStr, 10);
  if (isNaN(halfmoveClock) || halfmoveClock < 0) return null;
  if (isNaN(fullmoveNumber) || fullmoveNumber < 1) return null;

  // Strict semantic validation
  if (options?.strict) {
    let whiteKings = 0, blackKings = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        if (piece.type === 'king') {
          if (piece.color === 'white') whiteKings++;
          else blackKings++;
        }
        if (piece.type === 'pawn' && (r === 0 || r === 7)) return null;
      }
    }
    if (whiteKings !== 1 || blackKings !== 1) return null;
    // Castling rights must match rook/king placement
    if (wCK && (board[7][4]?.type !== 'king' || board[7][4]?.color !== 'white' || board[7][7]?.type !== 'rook' || board[7][7]?.color !== 'white')) return null;
    if (wCQ && (board[7][4]?.type !== 'king' || board[7][4]?.color !== 'white' || board[7][0]?.type !== 'rook' || board[7][0]?.color !== 'white')) return null;
    if (bCK && (board[0][4]?.type !== 'king' || board[0][4]?.color !== 'black' || board[0][7]?.type !== 'rook' || board[0][7]?.color !== 'black')) return null;
    if (bCQ && (board[0][4]?.type !== 'king' || board[0][4]?.color !== 'black' || board[0][0]?.type !== 'rook' || board[0][0]?.color !== 'black')) return null;
    // En passant target must be consistent with active color:
    // white to move → black just pushed (ep on rank 6, row 2); black to move → white just pushed (ep on rank 3, row 5)
    if (enPassantTarget) {
      const expectedRow = currentTurn === 'white' ? 2 : 5;
      if (enPassantTarget.row !== expectedRow) return null;
    }
  }

  // Compute check/checkmate/stalemate
  const isCheck = isKingInCheck(board, currentTurn);
  const hasLegal = hasAnyLegalMoves(board, currentTurn, enPassantTarget, wCK, wCQ, bCK, bCQ);
  const isCheckmate = isCheck && !hasLegal;
  const isStalemate = !isCheck && !hasLegal;

  return {
    board,
    currentTurn,
    moveHistory: [],
    whiteCanCastleKingside: wCK,
    whiteCanCastleQueenside: wCQ,
    blackCanCastleKingside: bCK,
    blackCanCastleQueenside: bCQ,
    enPassantTarget,
    halfmoveClock,
    fullmoveNumber,
    isCheck,
    isCheckmate,
    isStalemate,
  };
}

export function toFen(state: GameState, _options?: { enPassantPolicy?: EnPassantPolicy }): string {
  // Piece placement
  const ranks: string[] = [];
  for (let row = 0; row < 8; row++) {
    let rankStr = '';
    let empty = 0;
    for (let col = 0; col < 8; col++) {
      const piece = state.board[row][col];
      if (!piece) {
        empty++;
      } else {
        if (empty > 0) { rankStr += empty; empty = 0; }
        const ch = PIECE_TO_FEN[piece.type];
        rankStr += piece.color === 'white' ? ch.toUpperCase() : ch;
      }
    }
    if (empty > 0) rankStr += empty;
    ranks.push(rankStr);
  }

  const placement = ranks.join('/');
  const activeColor = state.currentTurn === 'white' ? 'w' : 'b';

  let castling = '';
  if (state.whiteCanCastleKingside) castling += 'K';
  if (state.whiteCanCastleQueenside) castling += 'Q';
  if (state.blackCanCastleKingside) castling += 'k';
  if (state.blackCanCastleQueenside) castling += 'q';
  if (!castling) castling = '-';

  let ep = '-';
  if (state.enPassantTarget) {
    const { row, col } = state.enPassantTarget;
    ep = String.fromCharCode(97 + col) + String(8 - row);
  }

  return `${placement} ${activeColor} ${castling} ${ep} ${state.halfmoveClock} ${state.fullmoveNumber}`;
}

export function validateFen(fen: string, options?: { strict?: boolean }): FenValidationResult {
  const errors: FenValidationError[] = [];
  const warnings: FenValidationWarning[] = [];

  const parts = fen.trim().split(/\s+/);
  if (parts.length !== 6) {
    errors.push({ code: 'INVALID_FIELD_COUNT', message: `Expected 6 fields, got ${parts.length}` });
    return { valid: false, errors, warnings };
  }

  const [placement, activeColor, castling, ep, halfmove, fullmove] = parts;

  // Validate placement
  const ranks = placement.split('/');
  if (ranks.length !== 8) {
    errors.push({ code: 'INVALID_RANK_COUNT', message: 'Expected 8 ranks', field: 'piecePlacement' });
  } else {
    let whiteKings = 0, blackKings = 0;
    for (let i = 0; i < 8; i++) {
      let count = 0;
      for (const ch of ranks[i]) {
        if (/[1-8]/.test(ch)) count += parseInt(ch, 10);
        else if (/[pnbrqkPNBRQK]/.test(ch)) {
          count++;
          if (ch === 'K') whiteKings++;
          if (ch === 'k') blackKings++;
          if (options?.strict) {
            if ((ch === 'P' || ch === 'p') && (i === 0 || i === 7)) {
              errors.push({ code: 'PAWN_ON_BACKRANK', message: `Pawn on rank ${i === 0 ? 8 : 1}`, field: 'piecePlacement' });
            }
          }
        } else {
          errors.push({ code: 'UNKNOWN_PIECE', message: `Unknown piece '${ch}'`, field: 'piecePlacement' });
        }
      }
      if (count !== 8) {
        errors.push({ code: 'INVALID_RANK_LENGTH', message: `Rank ${8-i} expands to ${count} squares`, field: 'piecePlacement' });
      }
    }
    if (options?.strict) {
      if (whiteKings !== 1) errors.push({ code: whiteKings === 0 ? 'MISSING_WHITE_KING' : 'MULTIPLE_WHITE_KINGS', message: `White has ${whiteKings} kings`, field: 'piecePlacement' });
      if (blackKings !== 1) errors.push({ code: blackKings === 0 ? 'MISSING_BLACK_KING' : 'MULTIPLE_BLACK_KINGS', message: `Black has ${blackKings} kings`, field: 'piecePlacement' });
    }
  }

  if (activeColor !== 'w' && activeColor !== 'b') {
    errors.push({ code: 'INVALID_ACTIVE_COLOR', message: `Invalid active color '${activeColor}'`, field: 'activeColor' });
  }

  if (castling !== '-' && !/^[KQkq]+$/.test(castling)) {
    errors.push({ code: 'INVALID_CASTLING', message: `Invalid castling '${castling}'`, field: 'castlingAvailability' });
  }

  if (ep !== '-' && !/^[a-h][36]$/.test(ep)) {
    errors.push({ code: 'INVALID_EN_PASSANT', message: `Invalid en passant '${ep}'`, field: 'enPassantTarget' });
  }

  const hm = parseInt(halfmove, 10);
  if (isNaN(hm) || hm < 0 || String(hm) !== halfmove) {
    errors.push({ code: 'INVALID_HALFMOVE_CLOCK', message: `Invalid halfmove clock '${halfmove}'`, field: 'halfmoveClock' });
  }

  const fm = parseInt(fullmove, 10);
  if (isNaN(fm) || fm < 1 || String(fm) !== fullmove) {
    errors.push({ code: 'INVALID_FULLMOVE_NUMBER', message: `Invalid fullmove number '${fullmove}'`, field: 'fullmoveNumber' });
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function normalizeFen(fen: string, options?: { strict?: boolean; enPassantPolicy?: EnPassantPolicy }): string {
  const state = parseFen(fen, options);
  if (!state) return fen;
  return toFen(state, options);
}
