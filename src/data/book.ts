/**
 * Opening "book" — demo statistics keyed by board placement + side to move
 * ("<placement> <w|b>"). Ported verbatim from the prototype js/book.js.
 * Each row: [san, played%, gamesLabel, whiteWin%, draw%]  (black% = remainder).
 */
export type BookRow = [san: string, played: number, games: string, whiteWin: number, draw: number, name?: string | null];

export const BOOK: Record<string, BookRow[]> = {
  /* start position */
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': [
    ['e4', 62, '1749m', 50, 4], ['d4', 25, '691m', 50, 5],
    ['Nf3', 3, '84m', 50, 5], ['c4', 3, '84m', 51, 5], ['e3', 2, '46m', 47, 4],
  ],
  /* 1.e4 */
  'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': [
    ['c5', 31, '540m', 48, 4], ['e5', 26, '455m', 50, 4],
    ['e6', 11, '188m', 49, 4], ['d5', 9, '152m', 51, 3], ['c6', 7, '128m', 49, 4],
  ],
  /* 1.e4 e5 */
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w': [
    ['Nf3', 71, '323m', 50, 4], ['Bc4', 9, '41m', 49, 3],
    ['Nc3', 6, '27m', 48, 4], ['f4', 4, '18m', 47, 3], ['d4', 3, '14m', 50, 3],
  ],
  /* 1.e4 e5 2.Nf3 */
  'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b': [
    ['Nc6', 70, '226m', 50, 4], ['d6', 9, '29m', 53, 3],
    ['Nf6', 8, '26m', 51, 4], ['Qe7', 2, '6m', 50, 2],
  ],
  /* 1.e4 e5 2.Nf3 Nc6 */
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w': [
    ['Bc4', 38, '86m', 50, 4], ['Bb5', 30, '68m', 52, 5],
    ['d4', 15, '34m', 51, 4], ['Nc3', 9, '20m', 49, 5],
  ],
  /* Scotch: 1.e4 e5 2.Nf3 Nc6 3.d4 */
  'r1bqkbnr/pppp1ppp/2n5/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R b': [
    ['exd4', 83, '28m', 51, 4], ['d6', 7, '2.4m', 55, 3], ['Nxd4', 4, '1.4m', 54, 3],
  ],
  /* 1.d4 */
  'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b': [
    ['Nf6', 36, '250m', 50, 5], ['d5', 33, '228m', 50, 5],
    ['e6', 9, '62m', 50, 5], ['d6', 5, '34m', 51, 4],
  ],
};

/** Look up book rows for a "<placement> <w|b>" key, or null when no data. */
export function lookup(key: string): BookRow[] | null {
  return BOOK[key] ?? null;
}
