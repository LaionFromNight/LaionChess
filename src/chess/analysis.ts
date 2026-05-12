import { Board, PieceColor, PieceType, Position } from './types';

export type SpottingMode = 'none' | 'eye-full' | 'eye-1' | 'eye-2' | 'eye-white' | 'eye-black' | 'dalmacja' | 'lufycfer' | 'king-path' | 'king-shot';

const PIECE_VALUES: Record<PieceType, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 100,
};

function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

export function getAttackedSquares(board: Board, pos: Position, type: PieceType, color: PieceColor): Position[] {
  const { row, col } = pos;
  const result: Position[] = [];

  if (type === 'pawn') {
    const dir = color === 'white' ? -1 : 1;
    const targets: [number, number][] = [
      [row + dir, col - 1],
      [row + dir, col + 1],
    ];
    for (const [r, c] of targets) {
      if (inBounds(r, c)) {
        result.push({ row: r, col: c });
      }
    }
    return result;
  }

  if (type === 'knight') {
    const jumps: [number, number][] = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1],
    ];
    for (const [dr, dc] of jumps) {
      const r = row + dr;
      const c = col + dc;
      if (inBounds(r, c)) {
        result.push({ row: r, col: c });
      }
    }
    return result;
  }

  if (type === 'king') {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (inBounds(r, c)) {
          result.push({ row: r, col: c });
        }
      }
    }
    return result;
  }

  const directions: [number, number][] = [];

  if (type === 'rook' || type === 'queen') {
    directions.push([0, 1], [0, -1], [1, 0], [-1, 0]);
  }

  if (type === 'bishop' || type === 'queen') {
    directions.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  }

  for (const [dr, dc] of directions) {
    let r = row + dr;
    let c = col + dc;
    while (inBounds(r, c)) {
      result.push({ row: r, col: c });
      if (board[r][c] !== null) break;
      r += dr;
      c += dc;
    }
  }

  return result;
}

export interface AttackMap {
  white: number[][];
  black: number[][];
}

export function computeAttackMap(board: Board): AttackMap {
  const white: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const black: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0));

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece) continue;
      const attacked = getAttackedSquares(board, { row, col }, piece.type, piece.color);
      const map = piece.color === 'white' ? white : black;
      for (const sq of attacked) {
        map[sq.row][sq.col]++;
      }
    }
  }

  return { white, black };
}

export interface DefenseEdge {
  from: Position;
  to: Position;
  color: PieceColor;
}

export function computeDefenseEdges(board: Board): DefenseEdge[] {
  const edges: DefenseEdge[] = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece) continue;
      const attacked = getAttackedSquares(board, { row, col }, piece.type, piece.color);
      for (const sq of attacked) {
        const target = board[sq.row][sq.col];
        if (target && target.color === piece.color) {
          edges.push({ from: { row, col }, to: sq, color: piece.color });
        }
      }
    }
  }

  return edges;
}

export type ExchangeResult = 'attacker' | 'defender' | 'equal';

export interface ExchangeInfo {
  square: Position;
  attackers: Array<{ pos: Position; color: PieceColor; type: PieceType }>;
  defenders: Array<{ pos: Position; color: PieceColor; type: PieceType }>;
  result: ExchangeResult;
  attackerColor: PieceColor;
}

export function computeExchanges(board: Board): ExchangeInfo[] {
  const exchanges: ExchangeInfo[] = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const target = board[row][col];
      if (!target) continue;

      const attackers: Array<{ pos: Position; color: PieceColor; type: PieceType }> = [];
      const defenders: Array<{ pos: Position; color: PieceColor; type: PieceType }> = [];

      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (r === row && c === col) continue;
          const piece = board[r][c];
          if (!piece) continue;
          const attacked = getAttackedSquares(board, { row: r, col: c }, piece.type, piece.color);
          const hits = attacked.some(sq => sq.row === row && sq.col === col);
          if (!hits) continue;
          if (piece.color !== target.color) {
            attackers.push({ pos: { row: r, col: c }, color: piece.color, type: piece.type });
          } else {
            defenders.push({ pos: { row: r, col: c }, color: piece.color, type: piece.type });
          }
        }
      }

      if (attackers.length === 0) continue;

      const attackerColor = attackers[0].color;
      const targetValue = PIECE_VALUES[target.type];

      const sortedAttackers = [...attackers].sort((a, b) => PIECE_VALUES[a.type] - PIECE_VALUES[b.type]);
      const sortedDefenders = [...defenders].sort((a, b) => PIECE_VALUES[a.type] - PIECE_VALUES[b.type]);

      const cheapestAttacker = PIECE_VALUES[sortedAttackers[0].type];
      const cheapestDefender = sortedDefenders.length > 0 ? PIECE_VALUES[sortedDefenders[0].type] : Infinity;

      let result: ExchangeResult;

      if (cheapestAttacker < targetValue) {
        if (sortedDefenders.length > 0 && cheapestDefender <= cheapestAttacker) {
          result = 'equal';
        } else {
          result = 'attacker';
        }
      } else if (cheapestAttacker === targetValue) {
        result = 'equal';
      } else {
        result = 'defender';
      }

      exchanges.push({
        square: { row, col },
        attackers,
        defenders,
        result,
        attackerColor,
      });
    }
  }

  return exchanges;
}
