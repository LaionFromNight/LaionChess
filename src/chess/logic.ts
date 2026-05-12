import {
  Board,
  GameState,
  Move,
  Piece,
  PieceColor,
  PieceType,
  Position,
} from './types';

const PIECE_UNICODE: Record<PieceColor, Record<PieceType, string>> = {
  white: {
    king: '♔',
    queen: '♕',
    rook: '♖',
    bishop: '♗',
    knight: '♘',
    pawn: '♙',
  },
  black: {
    king: '♚',
    queen: '♛',
    rook: '♜',
    bishop: '♝',
    knight: '♞',
    pawn: '♟',
  },
};

function createInitialBoard(): Board {
  const board: Board = Array(8)
    .fill(null)
    .map(() => Array(8).fill(null));

  const backRank: PieceType[] = [
    'rook',
    'knight',
    'bishop',
    'queen',
    'king',
    'bishop',
    'knight',
    'rook',
  ];

  for (let col = 0; col < 8; col++) {
    board[0][col] = { type: backRank[col], color: 'black' };
    board[1][col] = { type: 'pawn', color: 'black' };
    board[6][col] = { type: 'pawn', color: 'white' };
    board[7][col] = { type: backRank[col], color: 'white' };
  }

  return board;
}

export function createInitialState(): GameState {
  return {
    board: createInitialBoard(),
    currentTurn: 'white',
    moveHistory: [],
    whiteCanCastleKingside: true,
    whiteCanCastleQueenside: true,
    blackCanCastleKingside: true,
    blackCanCastleQueenside: true,
    enPassantTarget: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    isCheck: false,
    isCheckmate: false,
    isStalemate: false,
  };
}

function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((sq) => (sq ? { ...sq } : null)));
}

function isInBounds(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

export function findKing(board: Board, color: PieceColor): Position | null {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece && piece.type === 'king' && piece.color === color) {
        return { row, col };
      }
    }
  }
  return null;
}

function isSquareAttackedBy(
  board: Board,
  pos: Position,
  byColor: PieceColor
): boolean {
  // Pawn attacks
  const pawnDir = byColor === 'white' ? 1 : -1;
  for (const dc of [-1, 1]) {
    const r = pos.row + pawnDir;
    const c = pos.col + dc;
    if (isInBounds(r, c)) {
      const p = board[r][c];
      if (p && p.type === 'pawn' && p.color === byColor) return true;
    }
  }

  // Knight attacks
  const knightMoves = [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1],
  ];
  for (const [dr, dc] of knightMoves) {
    const r = pos.row + dr;
    const c = pos.col + dc;
    if (isInBounds(r, c)) {
      const p = board[r][c];
      if (p && p.type === 'knight' && p.color === byColor) return true;
    }
  }

  // King attacks
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = pos.row + dr;
      const c = pos.col + dc;
      if (isInBounds(r, c)) {
        const p = board[r][c];
        if (p && p.type === 'king' && p.color === byColor) return true;
      }
    }
  }

  // Sliding pieces
  const straightDirs = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  const diagDirs = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  for (const [dr, dc] of straightDirs) {
    let r = pos.row + dr;
    let c = pos.col + dc;
    while (isInBounds(r, c)) {
      const p = board[r][c];
      if (p) {
        if (
          p.color === byColor &&
          (p.type === 'rook' || p.type === 'queen')
        )
          return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  for (const [dr, dc] of diagDirs) {
    let r = pos.row + dr;
    let c = pos.col + dc;
    while (isInBounds(r, c)) {
      const p = board[r][c];
      if (p) {
        if (
          p.color === byColor &&
          (p.type === 'bishop' || p.type === 'queen')
        )
          return true;
        break;
      }
      r += dr;
      c += dc;
    }
  }

  return false;
}

export function isKingInCheck(board: Board, color: PieceColor): boolean {
  const kingPos = findKing(board, color);
  if (!kingPos) return false;
  const opponent: PieceColor = color === 'white' ? 'black' : 'white';
  return isSquareAttackedBy(board, kingPos, opponent);
}

export function getRawMoves(
  board: Board,
  pos: Position,
  enPassantTarget: Position | null,
  whiteCanCastleKingside: boolean,
  whiteCanCastleQueenside: boolean,
  blackCanCastleKingside: boolean,
  blackCanCastleQueenside: boolean
): Position[] {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];

  const moves: Position[] = [];
  const color = piece.color;
  const opponent: PieceColor = color === 'white' ? 'black' : 'white';

  const addIfValid = (r: number, c: number) => {
    if (!isInBounds(r, c)) return;
    const target = board[r][c];
    if (!target || target.color !== color) {
      moves.push({ row: r, col: c });
    }
  };

  switch (piece.type) {
    case 'pawn': {
      const dir = color === 'white' ? -1 : 1;
      const startRow = color === 'white' ? 6 : 1;

      const f1 = pos.row + dir;
      if (isInBounds(f1, pos.col) && !board[f1][pos.col]) {
        moves.push({ row: f1, col: pos.col });
        const f2 = pos.row + 2 * dir;
        if (pos.row === startRow && !board[f2][pos.col]) {
          moves.push({ row: f2, col: pos.col });
        }
      }

      for (const dc of [-1, 1]) {
        const c = pos.col + dc;
        if (!isInBounds(f1, c)) continue;
        const target = board[f1][c];
        if (target && target.color === opponent) {
          moves.push({ row: f1, col: c });
        }
        if (
          enPassantTarget &&
          enPassantTarget.row === f1 &&
          enPassantTarget.col === c
        ) {
          moves.push({ row: f1, col: c });
        }
      }
      break;
    }

    case 'knight': {
      const knightMoves = [
        [-2, -1],
        [-2, 1],
        [-1, -2],
        [-1, 2],
        [1, -2],
        [1, 2],
        [2, -1],
        [2, 1],
      ];
      for (const [dr, dc] of knightMoves) {
        addIfValid(pos.row + dr, pos.col + dc);
      }
      break;
    }

    case 'bishop': {
      const dirs = [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ];
      for (const [dr, dc] of dirs) {
        let r = pos.row + dr;
        let c = pos.col + dc;
        while (isInBounds(r, c)) {
          const target = board[r][c];
          if (!target) {
            moves.push({ row: r, col: c });
          } else {
            if (target.color !== color) moves.push({ row: r, col: c });
            break;
          }
          r += dr;
          c += dc;
        }
      }
      break;
    }

    case 'rook': {
      const dirs = [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ];
      for (const [dr, dc] of dirs) {
        let r = pos.row + dr;
        let c = pos.col + dc;
        while (isInBounds(r, c)) {
          const target = board[r][c];
          if (!target) {
            moves.push({ row: r, col: c });
          } else {
            if (target.color !== color) moves.push({ row: r, col: c });
            break;
          }
          r += dr;
          c += dc;
        }
      }
      break;
    }

    case 'queen': {
      const dirs = [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ];
      for (const [dr, dc] of dirs) {
        let r = pos.row + dr;
        let c = pos.col + dc;
        while (isInBounds(r, c)) {
          const target = board[r][c];
          if (!target) {
            moves.push({ row: r, col: c });
          } else {
            if (target.color !== color) moves.push({ row: r, col: c });
            break;
          }
          r += dr;
          c += dc;
        }
      }
      break;
    }

    case 'king': {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          addIfValid(pos.row + dr, pos.col + dc);
        }
      }

      const canCastleKingside =
        color === 'white'
          ? whiteCanCastleKingside
          : blackCanCastleKingside;
      const canCastleQueenside =
        color === 'white'
          ? whiteCanCastleQueenside
          : blackCanCastleQueenside;
      const row = color === 'white' ? 7 : 0;

      if (pos.row === row && pos.col === 4) {
        // Kingside
        if (
          canCastleKingside &&
          !board[row][5] &&
          !board[row][6] &&
          board[row][7]?.type === 'rook' &&
          board[row][7]?.color === color &&
          !isSquareAttackedBy(board, { row, col: 4 }, opponent) &&
          !isSquareAttackedBy(board, { row, col: 5 }, opponent) &&
          !isSquareAttackedBy(board, { row, col: 6 }, opponent)
        ) {
          moves.push({ row, col: 6 });
        }

        // Queenside
        if (
          canCastleQueenside &&
          !board[row][3] &&
          !board[row][2] &&
          !board[row][1] &&
          board[row][0]?.type === 'rook' &&
          board[row][0]?.color === color &&
          !isSquareAttackedBy(board, { row, col: 4 }, opponent) &&
          !isSquareAttackedBy(board, { row, col: 3 }, opponent) &&
          !isSquareAttackedBy(board, { row, col: 2 }, opponent)
        ) {
          moves.push({ row, col: 2 });
        }
      }
      break;
    }
  }

  return moves;
}

export function getLegalMoves(
  board: Board,
  pos: Position,
  enPassantTarget: Position | null,
  wCK: boolean,
  wCQ: boolean,
  bCK: boolean,
  bCQ: boolean
): Position[] {
  const piece = board[pos.row][pos.col];
  if (!piece) return [];

  const rawMoves = getRawMoves(
    board,
    pos,
    enPassantTarget,
    wCK,
    wCQ,
    bCK,
    bCQ
  );

  return rawMoves.filter((to) => {
    const simBoard = cloneBoard(board);
    const isEnPassant =
      piece.type === 'pawn' &&
      enPassantTarget?.row === to.row &&
      enPassantTarget?.col === to.col &&
      !simBoard[to.row][to.col];

    simBoard[to.row][to.col] = { ...piece };
    simBoard[pos.row][pos.col] = null;

    if (isEnPassant) {
      const capturedRow = piece.color === 'white' ? to.row + 1 : to.row - 1;
      simBoard[capturedRow][to.col] = null;
    }

    if (piece.type === 'king' && Math.abs(to.col - pos.col) === 2) {
      const row = pos.row;
      if (to.col === 6) {
        simBoard[row][5] = simBoard[row][7];
        simBoard[row][7] = null;
      } else if (to.col === 2) {
        simBoard[row][3] = simBoard[row][0];
        simBoard[row][0] = null;
      }
    }

    return !isKingInCheck(simBoard, piece.color);
  });
}

const PIECE_SHORT: Record<PieceType, string> = {
  king: 'K', queen: 'Q', rook: 'R', bishop: 'B', knight: 'N', pawn: '',
};

function moveToSan(
  stateBefore: GameState,
  move: Move,
  isCheckAfter: boolean,
  isCheckmateAfter: boolean
): string {
  if (move.isCastle) return move.isCastle === 'kingside' ? 'O-O' : 'O-O-O';

  const pieceShort = PIECE_SHORT[move.piece.type];
  const isCapture = move.captured !== undefined || move.isEnPassant;
  let disambiguation = '';

  if (pieceShort !== '') {
    let sameFileAmbiguous = false;
    let sameRankAmbiguous = false;
    let anyAmbiguous = false;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (r === move.from.row && c === move.from.col) continue;
        const p = stateBefore.board[r][c];
        if (p && p.type === move.piece.type && p.color === move.piece.color) {
          const otherMoves = getLegalMoves(
            stateBefore.board,
            { row: r, col: c },
            stateBefore.enPassantTarget,
            stateBefore.whiteCanCastleKingside,
            stateBefore.whiteCanCastleQueenside,
            stateBefore.blackCanCastleKingside,
            stateBefore.blackCanCastleQueenside
          );
          const canReach = otherMoves.some(
            m => m.row === move.to.row && m.col === move.to.col
          );
          if (canReach) {
            anyAmbiguous = true;
            if (c === move.from.col) sameFileAmbiguous = true;
            if (r === move.from.row) sameRankAmbiguous = true;
          }
        }
      }
    }

    if (anyAmbiguous) {
      if (sameFileAmbiguous && sameRankAmbiguous) {
        // 3+ pieces case: full square needed
        disambiguation = String.fromCharCode(97 + move.from.col) + String(8 - move.from.row);
      } else if (sameFileAmbiguous) {
        disambiguation = String(8 - move.from.row);
      } else {
        disambiguation = String.fromCharCode(97 + move.from.col);
      }
    }
  }

  let notation = pieceShort + disambiguation;

  if (isCapture) {
    if (pieceShort === '') notation += String.fromCharCode(97 + move.from.col);
    notation += 'x';
  }

  notation += String.fromCharCode(97 + move.to.col) + String(8 - move.to.row);

  if (move.promotion) {
    notation += '=' + PIECE_SHORT[move.promotion];
  }

  if (isCheckmateAfter) notation += '#';
  else if (isCheckAfter) notation += '+';

  return notation;
}

export function executeMove(
  state: GameState,
  from: Position,
  to: Position,
  promotionPiece?: PieceType
): GameState {
  const newState: GameState = {
    ...state,
    board: cloneBoard(state.board),
    moveHistory: [...state.moveHistory],
  };

  const board = newState.board;
  const piece = { ...board[from.row][from.col]! };
  const captured = board[to.row][to.col];
  const isEnPassant =
    piece.type === 'pawn' &&
    state.enPassantTarget?.row === to.row &&
    state.enPassantTarget?.col === to.col &&
      !captured;

  const move: Move = { from, to, piece, captured: captured || undefined };

  // En passant capture
  if (isEnPassant) {
    move.isEnPassant = true;
    const capturedRow = piece.color === 'white' ? to.row + 1 : to.row - 1;
    move.captured = { ...board[capturedRow][to.col]! };
    board[capturedRow][to.col] = null;
  }

  // Castling
  if (piece.type === 'king' && Math.abs(to.col - from.col) === 2) {
    const row = from.row;
    if (to.col === 6) {
      move.isCastle = 'kingside';
      board[row][5] = board[row][7] ? { ...board[row][7] } : null;
      board[row][7] = null;
    } else if (to.col === 2) {
      move.isCastle = 'queenside';
      board[row][3] = board[row][0] ? { ...board[row][0] } : null;
      board[row][0] = null;
    }
  }

  // Move piece
  board[to.row][to.col] = piece;
  board[from.row][from.col] = null;

  // Pawn promotion
  const promotionRow = piece.color === 'white' ? 0 : 7;
  if (piece.type === 'pawn' && to.row === promotionRow) {
    const promType = promotionPiece ?? 'queen';
    piece.type = promType;
    move.promotion = promType;
    board[to.row][to.col] = piece;
  }

  // Update en passant target
  newState.enPassantTarget = null;
  if (piece.type === 'pawn' && Math.abs(to.row - from.row) === 2) {
    newState.enPassantTarget = {
      row: (from.row + to.row) / 2,
      col: from.col,
    };
  }

  // Update castling rights
  if (piece.type === 'king') {
    if (piece.color === 'white') {
      newState.whiteCanCastleKingside = false;
      newState.whiteCanCastleQueenside = false;
    } else {
      newState.blackCanCastleKingside = false;
      newState.blackCanCastleQueenside = false;
    }
  }
  if (piece.type === 'rook') {
    if (from.row === 7 && from.col === 0) newState.whiteCanCastleQueenside = false;
    if (from.row === 7 && from.col === 7) newState.whiteCanCastleKingside = false;
    if (from.row === 0 && from.col === 0) newState.blackCanCastleQueenside = false;
    if (from.row === 0 && from.col === 7) newState.blackCanCastleKingside = false;
  }
  if (captured?.type === 'rook') {
    if (to.row === 7 && to.col === 0) newState.whiteCanCastleQueenside = false;
    if (to.row === 7 && to.col === 7) newState.whiteCanCastleKingside = false;
    if (to.row === 0 && to.col === 0) newState.blackCanCastleQueenside = false;
    if (to.row === 0 && to.col === 7) newState.blackCanCastleKingside = false;
  }

  // Update halfmoveClock: reset on pawn move or capture, else increment
  newState.halfmoveClock = (move.piece.type === 'pawn' || move.captured !== undefined || move.isEnPassant)
    ? 0
    : state.halfmoveClock + 1;

  // Update fullmoveNumber: increment after Black's move
  newState.fullmoveNumber = state.currentTurn === 'black'
    ? state.fullmoveNumber + 1
    : state.fullmoveNumber;

  newState.moveHistory.push(move);

  const nextTurn: PieceColor =
    state.currentTurn === 'white' ? 'black' : 'white';

  newState.isCheck = isKingInCheck(board, nextTurn);
  const hasLegal = hasAnyLegalMoves(
    board,
    nextTurn,
    newState.enPassantTarget,
    newState.whiteCanCastleKingside,
    newState.whiteCanCastleQueenside,
    newState.blackCanCastleKingside,
    newState.blackCanCastleQueenside
  );
  newState.isCheckmate = newState.isCheck && !hasLegal;
  newState.isStalemate = !newState.isCheck && !hasLegal;
  newState.currentTurn = nextTurn;

  // Generate and store SAN in the last move
  const lastMove = newState.moveHistory[newState.moveHistory.length - 1];
  newState.moveHistory[newState.moveHistory.length - 1] = {
    ...lastMove,
    san: moveToSan(state, lastMove, newState.isCheck, newState.isCheckmate),
  };

  return newState;
}

export function hasAnyLegalMoves(
  board: Board,
  color: PieceColor,
  enPassantTarget: Position | null,
  wCK: boolean,
  wCQ: boolean,
  bCK: boolean,
  bCQ: boolean
): boolean {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece && piece.color === color) {
        const legal = getLegalMoves(
          board,
          { row, col },
          enPassantTarget,
          wCK,
          wCQ,
          bCK,
          bCQ
        );
        if (legal.length > 0) return true;
      }
    }
  }
  return false;
}

export function positionToAlgebraic(pos: Position): string {
  return String.fromCharCode(97 + pos.col) + (8 - pos.row);
}

export function getPieceLabel(piece: Piece): string {
  return PIECE_UNICODE[piece.color][piece.type];
}
