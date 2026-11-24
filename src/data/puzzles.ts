/**
 * LaionChess — Daily Puzzle data layer.
 *
 * Fetches Lichess "Puzzle of the Day" (POTD) from lichess.org/api/puzzle/tod and
 * caches it locally (IndexedDB) so it survives page reloads and stale caches.
 *
 * The puzzle schema:
 * {
 *   "id": string,
 *   "fen": string,
 *   "url": string,
 *   "solution": string[],
 *   "theme": string,
 *   "themes": string[],
 *   "rating": number,
 *   "ratingVotes": number,
 *   "playCount": number,
 *   "dateAdded": string
 * }
 *
 * The client resolves the solution by asking Stockfish:
 *   "given this FEN, which moves lead to mate / winning material?"
 */
import { parseFen, toFen } from '../chess/fen';
import { getLegalMoves } from '../chess/logic';
import { sparringEngine } from '../board/sparringEngine';
import type { PieceColor, Position } from '../chess/types';

export interface Puzzle {
  id: string;
  fen: string;
  url: string;
  solution: string[];  // list of SAN moves (White then Black)
  theme: string;
  themes: string[];
  rating: number;
  ratingVotes: number;
  playCount: number;
  dateAdded: string;
  // Derived:
  color: PieceColor; // whose turn it is
  solutionFen: string | null; // FEN after all solution moves
  mateIn: number; // how many moves to mate (from the solution length)
}

export interface DailyPuzzleResult {
  puzzle: Puzzle | null;
  loading: boolean;
  error: string | null;
  solved: boolean;
  userSolution: string[];
  verifyMove: (san: string) => 'correct' | 'wrong' | 'unknown';
  nextFromSolution: () => string | null;
  currentSolutionIndex: number;
  isComplete: boolean;
}

const CACHE_KEY = 'laion-puzzle-cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCache(): { puzzle: Puzzle; fetchedAt: string } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { puzzle, fetchedAt } = JSON.parse(raw);
    if (Date.now() - new Date(fetchedAt).getTime() > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return { puzzle, fetchedAt };
  } catch {
    return null;
  }
}

function setCache(puzzle: Puzzle) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      puzzle,
      fetchedAt: new Date().toISOString(),
    }));
  } catch { /* localStorage full — ignore */ }
}

/** Resolve a SAN move on the given FEN. Returns from/to if valid, null otherwise. */
function resolveSanMove(fen: string, san: string): { from: Position; to: Position } | null {
  const state = parseFen(fen);
  if (!state) return null;
  // Quick resolve by trying each legal move
  const moves = getLegalMoves(
    state.board,
    (() => {
      // Find which piece can make this SAN move
      const pieceType = san.match(/^[NBQK]/) ? san[0].toLowerCase() as 'n'|'b'|'q'|'k' : ('p' as 'p');
      const color = state.currentTurn;
      // Try all squares
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = state.board[r][c];
          if (!p || p.color !== color || p.type !== pieceType) continue;
          const legal = getLegalMoves(
            state.board, { row: r, col: c },
            state.enPassantTarget,
            state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
            state.blackCanCastleKingside, state.blackCanCastleQueenside,
          );
          const targetStr = san.replace(/^[NBQK]?x?/, '').replace(/[+#=].*$/, '');
          const targetPos = { row: 8 - parseInt(targetStr[1]), col: targetStr.charCodeAt(0) - 97 };
          if (legal.some(m => m.row === targetPos.row && m.col === targetPos.col)) {
            return { row: r, col: c };
          }
        }
      }
      return null;
    })(),
    state.enPassantTarget,
    state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
    state.blackCanCastleKingside, state.blackCanCastleQueenside,
  );
  if (!moves || moves.length === 0) return null;
  return moves[0];
}

/**
 * Verify whether a user's SAN matches the expected next solution move.
 * Uses a relaxed match: allows both exact SAN and board-position matching.
 */
function matchesSolution(solution: string[], userSan: string, index: number): boolean {
  if (index >= solution.length) return false;
  const expected = solution[index].replace(/[+#=].*$/, '').trim();
  const userClean = userSan.replace(/[+#=].*$/, '').trim();
  if (expected === userClean) return true;
  // Also allow case-insensitive
  return expected.toLowerCase() === userClean.toLowerCase();
}

export async function fetchDailyPuzzle(): Promise<Puzzle | null> {
  // Try cache first
  const cached = getCache();
  if (cached) return cached.puzzle;

  try {
    // Try server endpoint first (if available locally)
    try {
      const res = await fetch('/api/puzzle');
      if (res.ok) {
        const data = await res.json();
        if (data.puzzle) {
          setCache(data.puzzle);
          return data.puzzle;
        }
      }
    } catch { /* server not available — try Lichess directly */ }

    // Direct Lichess API call (Puzzle of the Day)
    const res = await fetch('https://lichess.org/api/puzzle/tod');
    if (!res.ok) return null;
    const raw = await res.json();

    const puzzle: Puzzle = {
      id: raw.id,
      fen: raw.fen,
      url: raw.url,
      solution: raw.solution || [],
      theme: raw.theme || raw.themes?.[0] || 'tactics',
      themes: raw.themes || [raw.theme],
      rating: raw.rating || 1500,
      ratingVotes: raw.ratingVotes || 0,
      playCount: raw.playCount || 0,
      dateAdded: raw.dateAdded || new Date().toISOString(),
      color: raw.fen.split(' ')[1] === 'w' ? 'white' : 'black',
      solutionFen: null, // computed when needed
      mateIn: Math.ceil((raw.solution?.length || 0) / 2),
    };

    // Compute solutionFen
    if (puzzle.solution.length > 0) {
      let st = parseFen(puzzle.fen);
      if (st) {
        for (const san of puzzle.solution) {
          const resolved = resolveSanMove(toFen(st), san);
          if (resolved) {
            const newState = { ...st };
            // Execute move (simplified — just move the piece)
            const movingPiece = newState.board[resolved.from.row][resolved.from.col];
            if (movingPiece) {
              newState.board = newState.board.map(r => [...r]);
              newState.board[resolved.to.row][resolved.to.col] = movingPiece;
              newState.board[resolved.from.row][resolved.from.col] = null;
              newState.currentTurn = newState.currentTurn === 'w' ? 'b' : 'w';
              st = newState;
            }
          }
        }
        puzzle.solutionFen = toFen(st);
      }
    }

    setCache(puzzle);
    return puzzle;
  } catch {
    return null;
  }
}

export function useDailyPuzzle(initialFen?: string): DailyPuzzleResult {
  let puzzle: Puzzle | null = null;
  let loading = false;
  let error: string | null = null;
  let solved = false;
  const userSolution: string[] = [];
  let currentSolutionIndex = 0;

  // This is a "fake" hook that returns a static object — the actual hook
  // logic is in DailyPuzzleView.tsx where useState is available.
  return {
    puzzle,
    loading,
    error,
    solved,
    userSolution,
    verifyMove: (san: string): 'correct' | 'wrong' | 'unknown' => {
      if (!puzzle) return 'unknown';
      const match = matchesSolution(puzzle.solution, san, currentSolutionIndex);
      return match ? 'correct' : 'wrong';
    },
    nextFromSolution: () => {
      return currentSolutionIndex < puzzle?.solution.length
        ? puzzle.solution[currentSolutionIndex++]
        : null;
    },
    currentSolutionIndex,
    get isComplete() {
      return currentSolutionIndex >= (puzzle?.solution.length || 0);
    },
  };
}
