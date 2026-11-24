import { useState, useEffect, useRef } from 'react';
import { parseFen, toFen } from '../chess/fen';
import { createInitialState, executeMove, getLegalMoves, getPieceLabel } from '../chess/logic';
import { resolveSan } from '../chess/san';
import type { GameState, Position, PieceColor, PieceType } from '../chess/types';
import { useSettings, BOARD_THEMES } from '../settings/useSettings';
import { pieceSrc } from '../board/pieceSrc';

export interface Puzzle {
  id: string;
  fen: string;
  solution: string[];
  theme: string;
  rating: number;
  mateIn: number;
  description: string;
  color: PieceColor;
}

let puzzleCache: Puzzle[] | null = null;
let fetchPromise: Promise<Puzzle[]> | null = null;

async function loadPuzzles(): Promise<Puzzle[]> {
  if (puzzleCache) return puzzleCache;
  if (!fetchPromise) {
    fetchPromise = (async () => {
      try {
        const res = await fetch('courses/puzzles.json');
        if (res.ok) {
          const raw = await res.json();
          puzzleCache = (raw as any[]).map((p: any) => ({
            ...p,
            color: p.fen.split(' ')[1] === 'w' ? 'white' : 'black',
          } as Puzzle));
          return puzzleCache;
        }
      } catch {}
      return [];
    })();
  }
  return fetchPromise;
}

export async function fetchRandomPuzzle(): Promise<Puzzle | null> {
  const puzzles = await loadPuzzles();
  if (!puzzles.length) return null;
  const today = new Date();
  const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000);
  return puzzles[dayOfYear % puzzles.length];
}

export default function DailyPuzzleView(): JSX.Element {
  const { settings } = useSettings();
  const theme = BOARD_THEMES[settings.boardTheme] ?? BOARD_THEMES.classic;

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentFen, setCurrentFen] = useState<string>('');
  const [currentTurn, setCurrentTurn] = useState<PieceColor>('white');
  const [gameState, setGameState] = useState<GameState>(() => createInitialState());
  const [userSolutions, setUserSolutions] = useState<string[]>([]);
  const [solved, setSolved] = useState(false);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [selectedPos, setSelectedPos] = useState<{ row: number; col: number } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [locked, setLocked] = useState(false);
  const restartToken = useRef(0);
  const [winWidth, setWinWidth] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1280);

  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const applyPuzzle = (p: Puzzle) => {
    restartToken.current++;
    setPuzzle(p);
    setCurrentFen(p.fen);
    setCurrentTurn(p.color);
    const st = parseFen(p.fen);
    if (st) setGameState(st);
    setSelectedPos(null);
    setUserSolutions([]);
    setSolved(false);
    setFeedback(null);
    setFeedbackMsg('');
    setLocked(false);
    setFlipped(false);
  };

  // Fetch puzzle on mount
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchRandomPuzzle()
      .then(p => {
        if (p) {
          applyPuzzle(p);
        } else {
          setError('No puzzles available. Check public/courses/puzzles.json');
        }
        setLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Failed to load puzzles');
        setLoading(false);
      });
  }, []);

  const state = parseFen(currentFen) ?? gameState;
  const rows = flipped ? [...state.board].reverse().map(r => [...r].reverse()) : state.board;
  const legalMoves = selectedPos ? getLegalMoves(state.board, selectedPos, state.enPassantTarget,
    state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
    state.blackCanCastleKingside, state.blackCanCastleQueenside) : [];

  const userColor = puzzle?.color ?? 'white';
  const userMoveCount = Math.ceil((puzzle?.solution?.length ?? 0) / 2);

  const handleSquareClick = (row: number, col: number) => {
    if (solved || locked) return;
    const piece = state.board[row][col];
    if (!piece || piece.color !== userColor) return;
    setSelectedPos({ row, col });
  };

  const handleFlip = () => setFlipped(f => !f);

  const handleDestClick = (toRow: number, toCol: number) => {
    if (!selectedPos || locked || solved) return;
    const from = selectedPos;
    const legal = getLegalMoves(state.board, from, state.enPassantTarget,
      state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
      state.blackCanCastleKingside, state.blackCanCastleQueenside);
    const isLegal = legal.some(m => m.row === toRow && m.col === toCol);
    if (!isLegal) {
      setSelectedPos(null);
      return;
    }

    const moveFrom = `${String.fromCharCode(97 + from.col)}${8 - from.row}`;
    const moveTo = `${String.fromCharCode(97 + toCol)}${8 - toRow}`;

    // The user plays the even-index moves in the solution (their color always moves first)
    const expectedIdx = userSolutions.length * 2;
    const expectedSan = puzzle?.solution?.[expectedIdx];
    let correct = false;
    if (expectedSan) {
      const resolved = resolveSan(state, expectedSan);
      if (resolved) {
        correct = resolved.from.row === from.row && resolved.from.col === from.col
          && resolved.to.row === toRow && resolved.to.col === toCol;
      } else {
        // Fallback: relaxed destination-coordinate match
        const coordMatch = expectedSan.trim().toLowerCase().match(/[a-h][1-8]/);
        const expectedCoord = coordMatch ? coordMatch[0].toLowerCase() : null;
        correct = !!expectedCoord && moveTo.toLowerCase() === expectedCoord;
      }
    }

    if (!correct) {
      setFeedback('wrong');
      setFeedbackMsg('Wrong move.');
      setTimeout(() => { setFeedback(null); setFeedbackMsg(''); }, 2000);
      setSelectedPos(null);
      return;
    }

    const to = { row: toRow, col: toCol };
    const newState = executeMove(state, from, to);
    const newUserSolutions = [...userSolutions, `${moveFrom}${moveTo}`];
    setUserSolutions(newUserSolutions);
    setGameState(newState);
    setCurrentFen(toFen(newState));
    setCurrentTurn(newState.currentTurn);
    setSelectedPos(null);
    setFeedback('correct');
    setFeedbackMsg('Correct!');

    if (newUserSolutions.length >= userMoveCount) {
      setSolved(true);
      setFeedback('correct');
      setFeedbackMsg('Puzzle Solved!');
      return;
    }

    // The opponent's next move (odd index) is played automatically
    const oppIdx = newUserSolutions.length * 2 - 1;
    const oppSan = puzzle?.solution?.[oppIdx];
    if (oppSan && oppIdx < (puzzle?.solution?.length ?? 0)) {
      setLocked(true);
      const token = restartToken.current;
      setTimeout(() => {
        if (restartToken.current !== token) return;
        const resolved = resolveSan(newState, oppSan);
        if (resolved) {
          const oppState = executeMove(newState, resolved.from, resolved.to, resolved.promotionPiece);
          setGameState(oppState);
          setCurrentFen(toFen(oppState));
          setCurrentTurn(oppState.currentTurn);
        }
        setFeedback(null);
        setFeedbackMsg('');
        setLocked(false);
      }, 650);
    }
  };

  const handleRestart = () => {
    if (puzzle) applyPuzzle(puzzle);
  };

  const handleNextPuzzle = () => {
    const list = puzzleCache ?? [];
    if (!list.length || !puzzle) return;
    const idx = list.findIndex(p => p.id === puzzle.id);
    const next = list[(idx + 1) % list.length];
    applyPuzzle(next);
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: winWidth < 640 ? '12px 12px 20px' : '20px' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <span style={{ display: 'block', marginBottom: 8 }}>Daily Puzzle</span>
        <h2 style={{ margin: 0, fontSize: winWidth < 640 ? 22 : 28 }}>
          {puzzle ? `${puzzle.theme} • ${puzzle.rating} rating` : 'Loading puzzle...'}
        </h2>
        <p style={{ color: '#888', margin: '8px 0 0' }}>
          {puzzle ? `Find the best move${puzzle.solution?.length > 1 ? 's' : ''}. ${puzzle.description}` : 'Find the best move.'}
        </p>
      </div>

      {feedback && (
        <div style={{
          textAlign: 'center', padding: '12px 20px', borderRadius: 8, marginBottom: 16,
          background: feedback === 'correct' ? 'rgba(76, 175, 80, 0.15)' : 'rgba(244, 67, 54, 0.15)',
          border: `1px solid ${feedback === 'correct' ? '#4caf50' : '#f44336'}`,
          color: feedback === 'correct' ? '#4caf50' : '#f44336',
          fontSize: 16, fontWeight: 500,
        }}>
          {feedbackMsg}
        </div>
      )}

      {solved && (
        <div style={{ textAlign: 'center', padding: 20, borderRadius: 12, background: 'rgba(76, 175, 80, 0.1)', border: '1px solid #4caf50', marginBottom: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🏆</div>
          <h3 style={{ margin: 0, color: '#4caf50' }}>Puzzle Solved!</h3>
          <p style={{ margin: '4px 0 0', color: '#888' }}>
            Solution: {puzzle?.solution.join(' ')}
          </p>
          <button className="btn btn-primary btn-sm" type="button" onClick={handleNextPuzzle} style={{ marginTop: 12 }}>
            Next Puzzle →
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gridTemplateRows: 'repeat(8, 1fr)',
          width: Math.max(220, Math.floor(Math.min(560, winWidth - (winWidth < 640 ? 24 : 40)) / 8) * 8),
          aspectRatio: '1', border: '2px solid #333', borderRadius: 8, overflow: 'hidden',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35)',
        }}>
          {rows.map((row, rowIdx) =>
            row.map((piece, colIdx) => {
              const boardRow = flipped ? 7 - rowIdx : rowIdx;
              const boardCol = flipped ? 7 - colIdx : colIdx;
              const light = (rowIdx + colIdx) % 2 === 0;
              const key = `${rowIdx}-${colIdx}`;
              const isSelected = selectedPos?.row === boardRow && selectedPos?.col === boardCol;
              const isLegalHighlight = legalMoves.some(m => m.row === boardRow && m.col === boardCol);
              const src = piece ? pieceSrc(settings.pieceSet, piece.color, piece.type as PieceType) : null;
              return (
                <span key={key} style={{
                  background: light ? theme.light : theme.dark,
                  cursor: (piece && piece.color === userColor && !locked && !solved) ? 'pointer' : 'default',
                  position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onClick={() => {
                  if (piece && piece.color === userColor) {
                    handleSquareClick(boardRow, boardCol);
                  } else if (selectedPos) {
                    handleDestClick(boardRow, boardCol);
                  }
                }}>
                  {src ? (
                    <img src={src} alt="" style={{ width: '86%', height: '86%', objectFit: 'contain', pointerEvents: 'none', filter: 'drop-shadow(0 2px 2px rgba(0, 0, 0, 0.35))' }} />
                  ) : piece ? (
                    <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: 'clamp(20px, 4vw, 48px)', pointerEvents: 'none', textShadow: '0 2px 3px rgba(0, 0, 0, 0.4)' }}>{getPieceLabel(piece)}</span>
                  ) : null}
                  {isLegalHighlight && !piece && (
                    <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '28%', height: '28%', borderRadius: '50%', background: theme.light, opacity: 0.5 }} />
                  )}
                  {isSelected && (
                    <span style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: theme.light, opacity: 0.3 }} />
                  )}
                  {rowIdx === 7 && (
                    <span style={{ position: 'absolute', bottom: 2, right: 4, fontSize: '12px', fontWeight: 600, color: light ? theme.dark : theme.light, opacity: 0.9, pointerEvents: 'none' }}>{String.fromCharCode(97 + boardCol)}</span>
                  )}
                  {colIdx === 0 && (
                    <span style={{ position: 'absolute', top: 2, left: 4, fontSize: '12px', fontWeight: 600, color: light ? theme.dark : theme.light, opacity: 0.9, pointerEvents: 'none' }}>{8 - boardRow}</span>
                  )}
                </span>
              );
            })
          )}
        </div>

        {/* Sidebar */}
        <div style={{ width: winWidth < 720 ? '100%' : 260, maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {puzzle ? (
            <>
              <div style={{ background: '#1a1a2e', borderRadius: 10, padding: 16, border: '1px solid #333' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>{puzzle.theme} Puzzle</h3>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ background: '#2196f3', padding: '2px 8px', borderRadius: 12, fontSize: 12, color: '#fff' }}>{puzzle.rating}</span>
                  <span style={{ background: '#ff9800', padding: '2px 8px', borderRadius: 12, fontSize: 12, color: '#fff' }}>{puzzle.theme}</span>
                  <span style={{ background: '#9c27b0', padding: '2px 8px', borderRadius: 12, fontSize: 12, color: '#fff' }}>{puzzle.mateIn} move{puzzle.mateIn > 1 ? 's' : ''}</span>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 13, color: '#888' }}>
                  {locked ? `${currentTurn === 'white' ? 'White' : 'Black'} (auto)` : `${userColor === 'white' ? 'White' : 'Black'} to move`}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#ccc' }}>
                  {puzzle.description}
                </p>
              </div>

              {solved && puzzle.solution.length > 0 && (
                <div style={{ background: '#1a1a2e', borderRadius: 10, padding: 16, border: '1px solid #333' }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#4caf50' }}>Solution</h4>
                  <div style={{ fontFamily: 'monospace', fontSize: 14 }}>
                    {puzzle.solution.map((m, i) => (
                      <span key={i}>
                        {i % 2 === 0 && <span style={{ color: '#888' }}>{Math.floor(i / 2) + 1}.</span>}
                        <span style={{ color: '#4caf50' }}>{m}</span>{' '}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!solved && userMoveCount > 0 && (
                <div style={{ background: '#1a1a2e', borderRadius: 10, padding: 12, border: '1px solid #333' }}>
                  <span style={{ fontSize: 12, color: '#888' }}>Progress: </span>
                  <div style={{ height: 6, background: '#333', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                    <div style={{ height: '100%', width: `${(userSolutions.length / userMoveCount) * 100}%`, background: '#4caf50', borderRadius: 3, transition: 'width 0.3s' }} />
                  </div>
                </div>
              )}
            </>
          ) : loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>Loading puzzle...</div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: '#f44336' }}>{error}</div>
          )}

          {!solved && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-sm" type="button" onClick={handleFlip}>⇅ Flip Board</button>
              <button className="btn btn-sm" type="button" onClick={handleRestart}>↻ Restart</button>
            </div>
          )}
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 16, color: '#666', fontSize: 12 }}>
        <span>Click piece, then destination square • ↻ to restart</span>
      </div>
    </div>
  );
}
