import { useState, useEffect, useCallback, useMemo } from 'react';
import Board, { type BoardArrow } from '../components/Board';
import { parseFen, toFen } from '../chess/fen';
import { executeMove, getLegalMoves, findKing, getPieceLabel } from '../chess/logic';
import type { GameState, Position, PieceType, PieceColor } from '../chess/types';
import { pieceSrc, pieceCode } from '../board/pieceSrc';
import { useSettings, BOARD_THEMES } from '../settings/useSettings';
import { sparringEngine } from '../board/sparringEngine';
import { ARROW } from '../board/arrowPalette';

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

let puzzleCache: Puzzle[] | null = null;
let fetchPromise: Promise<Puzzle[]> | null = null;

async function loadPuzzles(): Promise<Puzzle[]> {
  if (puzzleCache) return puzzleCache;
  if (!fetchPromise) {
    fetchPromise = (async () => {
      try {
        const res = await fetch('/courses/puzzles.json');
        if (res.ok) {
          const raw = await res.json();
          puzzleCache = (raw as any[]).map((p: any) => ({
            ...p,
            color: p.fen.split(' ')[1] === 'w' ? 'white' : 'black',
          } as Puzzle));
          return puzzleCache;
        }
      } catch {}
      // Fallback: use a few hardcoded puzzles
      return [];
    })();
  }
  return fetchPromise;
}

export async function fetchRandomPuzzle(): Promise<Puzzle | null> {
  const puzzles = await loadPuzzles();
  if (!puzzles.length) return null;
  // Pick a random puzzle (based on date to keep it "daily")
  const today = new Date();
  const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / 86400000);
  const idx = dayOfYear % puzzles.length;
  return puzzles[idx];
}

export function useDailyPuzzle(initialFen?: string): DailyPuzzleResult {
  const { settings } = useSettings();
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentFen, setCurrentFen] = useState<string>('');
  const [currentTurn, setCurrentTurn] = useState<PieceColor>('white');
  const [userSolutions, setUserSolutions] = useState<string[]>([]);
  const [solved, setSolved] = useState(false);
  const [gameState, setGameState] = useState<GameState>(() => createInitialState());
  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [hintArrow, setHintArrow] = useState<BoardArrow | null>(null);
  const [totalMoves, setTotalMoves] = useState(0);

  // Fetch puzzle on mount
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchRandomPuzzle()
      .then(p => {
        if (p) {
          setPuzzle(p);
          setCurrentFen(p.fen);
          setCurrentTurn(p.color);
          setTotalMoves(p.solution?.length || 0);
          const st = parseFen(p.fen);
          if (st) setGameState(st);
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

  const state = useMemo(() => parseFen(currentFen) ?? gameState, [currentFen, gameState]);
  const rows = flipped ? [...state.board].reverse().map(r => [...r].reverse()) : state.board;

  const legalMoves = useMemo(() => {
    if (!selectedPos) return [];
    return getLegalMoves(
      state.board, selectedPos,
      state.enPassantTarget,
      state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
      state.blackCanCastleKingside, state.blackCanCastleQueenside,
    );
  }, [state, selectedPos]);

  const isLegal = useCallback((from: Position, to: Position) => {
    return legalMoves.some(m => m.row === to.row && m.col === to.col);
  }, [legalMoves]);

  // Handle piece click (select piece to move)
  const handleSquareClick = (row: number, col: number) => {
    if (solved) return;
    const piece = state.board[row][col];
    if (!piece || piece.color !== currentTurn) {
      setSelectedPos(null);
      return;
    }
    if (selectedPos && selectedPos.row === row && selectedPos.col === col) {
      setSelectedPos(null);
      return;
    }
    setSelectedPos({ row, col });
  };

  // Handle destination click (make move)
  const handleDestClick = (toRow: number, toCol: number) => {
    if (!selectedPos) return;
    const from = selectedPos;
    if (!isLegal(from, { row: toRow, col: toCol })) {
      setSelectedPos(null);
      return;
    }

    const movingPiece = state.board[from.row][from.col];
    if (!movingPiece) { setSelectedPos(null); return; }

    const newState = { ...state, board: state.board.map(r => [...r]) };
    newState.board[toRow][toCol] = movingPiece;
    newState.board[from.row][from.col] = null;
    newState.currentTurn = newState.currentTurn === 'w' ? 'b' : 'w';

    const moveFrom = `${String.fromCharCode(97 + from.col)}${8 - from.row}`;
    const moveTo = `${String.fromCharCode(97 + toCol)}${8 - toRow}`;

    // Check if it matches the next solution move
    const nextIdx = userSolutions.length;
    if (nextIdx < (puzzle?.solution?.length || 0)) {
      const expected = puzzle.solution[nextIdx].trim().toLowerCase();
      // Extract coordinates from expected SAN (e.g. "Qxf7" -> "f7", "Nf3" -> "f3")
      const coordMatch = expected.match(/[a-h][1-8]/);
      const expectedCoord = coordMatch ? coordMatch[0].toLowerCase() : null;

      if (expectedCoord && moveTo.toLowerCase() === expectedCoord) {
        // CORRECT!
        setFeedback('correct');
        setFeedbackMsg(`✅ Correct!`);
        setUserSolutions([...userSolutions, `${moveFrom}${moveTo}`]);
        setCurrentFen(toFen(newState));
        setGameState(newState);

        // Check if puzzle is complete
        if (userSolutions.length + 1 >= (puzzle?.solution?.length || 0)) {
          setSolved(true);
          setFeedbackMsg(`🎉 Puzzle solved! Well done!`);
        }
      } else {
        // WRONG
        setFeedback('wrong');
        setFeedbackMsg(`❌ Not the right move. Try again.`);
        setTimeout(() => { setFeedback(null); setFeedbackMsg(''); }, 2000);
      }
    }

    setSelectedPos(null);
  };

  // Show hint: ask Stockfish for the best move from current position
  const handleHint = async () => {
    setShowHint(true);
    if (puzzle) {
      const expected = puzzle.solution[userSolutions.length]?.trim();
      const coordMatch = expected?.match(/[a-h][1-8]/);
      if (coordMatch) {
        const to = coordMatch[0];
        const toRow = 8 - Number(to[1]);
        const toCol = to.charCodeAt(0) - 97;
        setHintArrow({
          from: selectedPos || { row: 0, col: 0 },
          to: { row: toRow, col: toCol },
          color: ARROW.green,
          width: 2.4,
          label: '💡',
          labelAt: 'head',
        });
      }
    }
  };

  const handleRestart = () => {
    if (puzzle) {
      const st = parseFen(puzzle.fen);
      setCurrentFen(puzzle.fen);
      setCurrentTurn(puzzle.color);
      setGameState(st ?? gameState);
      setUserSolutions([]);
      setSolved(false);
      setFeedback(null);
      setShowHint(false);
      setHintArrow(null);
    }
  };

  const handleOpenInAnalysis = () => {
    if (currentFen) {
      const st = parseFen(currentFen);
      if (st) {
        // Navigate to analysis view with this position
        const navBtn = document.querySelector('button:has(> span:contains("Analysis"))');
        // Just show the fen
        alert(`FEN: ${currentFen}`);
      }
    }
  };

  const handleFlip = () => setFlipped(f => !f);

  const legalHighlights = useMemo(() => {
    if (!selectedPos) return new Set<string>();
    return new Set(legalMoves.map(m => `${m.row}-${m.col}`));
  }, [selectedPos, legalMoves]);

  const checkSquare = useMemo(() => {
    if (!state.isCheck) return null;
    return findKing(state.board, state.currentTurn);
  }, [state.isCheck, state.currentTurn, state.board]);

  const boardElements = rows.map((row, rowIdx) =>
    row.map((piece, colIdx) => {
      const light = (rowIdx + colIdx) % 2 === 0;
      const key = `${rowIdx}-${colIdx}`;
      const isSelected = selectedPos?.row === rowIdx && selectedPos?.col === colIdx;
      const isLegalHighlight = legalHighlights.has(key);
      const src = piece ? pieceSrc(settings.pieceSet, piece.color, piece.type) : null;

      return (
        <span
          key={key}
          style={{
            background: light ? theme.light : theme.dark,
            cursor: (piece && piece.color === currentTurn) ? 'pointer' : 'default',
            position: 'relative',
            width: '12.5%',
            aspectRatio: '1',
          }}
          onClick={() => {
            if (piece && piece.color === currentTurn) {
              handleSquareClick(rowIdx, colIdx);
            } else if (selectedPos) {
              handleDestClick(rowIdx, colIdx);
            }
          }}
        >
          {/* Legal move dot */}
          {isLegalHighlight && !piece && (
            <span style={{
              position: 'absolute',
              top: '50%', left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '28%', height: '28%',
              borderRadius: '50%',
              background: theme.light,
              opacity: 0.5,
            }} />
          )}
          {/* Piece capture highlight */}
          {isLegalHighlight && piece && (
            <span style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              borderRadius: '50%',
              border: `4px solid ${theme.light}`,
              opacity: 0.6,
            }} />
          )}
          {/* Selected square */}
          {isSelected && (
            <span style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              background: theme.light,
              opacity: 0.3,
            }} />
          )}
          {/* Check highlight */}
          {checkSquare && checkSquare.row === rowIdx && checkSquare.col === colIdx && (
            <span style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              background: 'radial-gradient(circle, rgba(255,0,0,0.5) 0%, transparent 70%)',
            }} />
          )}
          {/* Piece */}
          {piece ? (
            src
              ? <img src={src} alt={pieceCode(piece.color, piece.type)} draggable={false}
                  style={{ width: '88%', height: '88%', objectFit: 'contain', position: 'relative', zIndex: 1 }} />
              : <span className={`glyph ${piece.color}`} style={{ position: 'relative', zIndex: 1 }}>
                  {getPieceLabel(piece)}
                </span>
          ) : null}
          {/* Board coordinates */}
          <span style={{
            position: 'absolute',
            fontSize: '8px',
            color: light ? theme.dark : theme.light,
            opacity: 0.6,
            pointerEvents: 'none',
          }}>
            {colIdx === (flipped ? 7 : 0)}{String.fromCharCode(97 + colIdx)}
            {' '}
            {flipped ? (8 - rowIdx) : (rowIdx + 1)}
          </span>
        </span>
      );
    })
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 20 }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <span className="eyebrow" style={{ display: 'block', marginBottom: 8 }}>Daily Puzzle</span>
        <h2 style={{ margin: 0, fontSize: 28 }}>
          {puzzle ? `${puzzle.theme} • ${puzzle.rating} rating` : 'Loading puzzle...'}
        </h2>
        <p style={{ color: '#888', margin: '8px 0 0' }}>
          {puzzle ? `Find the best move${puzzle.solution?.length > 1 ? 's' : ''}. ${puzzle.description}` : 'Find the best move.'}
        </p>
      </div>

      {/* Feedback */}
      {feedback && (
        <div style={{
          textAlign: 'center',
          padding: '12px 20px',
          borderRadius: 8,
          marginBottom: 16,
          background: feedback === 'correct' ? 'rgba(76, 175, 80, 0.15)' : 'rgba(244, 67, 54, 0.15)',
          border: `1px solid ${feedback === 'correct' ? '#4caf50' : '#f44336'}`,
          color: feedback === 'correct' ? '#4caf50' : '#f44336',
          fontSize: 16,
          fontWeight: 500,
        }}>
          {feedbackMsg}
        </div>
      )}

      {/* Solved banner */}
      {solved && (
        <div style={{
          textAlign: 'center',
          padding: 20,
          borderRadius: 12,
          background: 'rgba(76, 175, 80, 0.1)',
          border: '1px solid #4caf50',
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🏆</div>
          <h3 style={{ margin: 0, color: '#4caf50' }}>Puzzle Solved!</h3>
          <p style={{ margin: '4px 0 0', color: '#888' }}>
            Solution: {puzzle?.solution.join(' ')}
          </p>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={handleRestart}
            style={{ marginTop: 12 }}
          >
            Next Puzzle →
          </button>
        </div>
      )}

      {/* Main board */}
      <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr)',
          width: Math.min(560, (typeof window !== 'undefined' ? window.innerWidth - 40 : 560)),
          aspectRatio: '1',
          border: '2px solid #333',
          borderRadius: 8,
          overflow: 'hidden',
        }}>
          {boardElements}
        </div>

        {/* Sidebar */}
        <div style={{
          minWidth: 220,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}>
          {puzzle ? (
            <>
              {/* Info card */}
              <div style={{
                background: '#1a1a2e',
                borderRadius: 10,
                padding: 16,
                border: '1px solid #333',
              }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>
                  {puzzle.theme} Puzzle
                </h3>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    background: '#2196f3',
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontSize: 12,
                    color: '#fff',
                  }}>
                    {puzzle.rating}
                  </span>
                  <span style={{
                    background: '#ff9800',
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontSize: 12,
                    color: '#fff',
                  }}>
                    {puzzle.theme}
                  </span>
                  <span style={{
                    background: '#9c27b0',
                    padding: '2px 8px',
                    borderRadius: 12,
                    fontSize: 12,
                    color: '#fff',
                  }}>
                    {puzzle.mateIn} move{puzzle.mateIn > 1 ? 's' : ''}
                  </span>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 13, color: '#888' }}>
                  {puzzle.color === 'w' ? 'White' : 'Black'} to move
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#ccc' }}>
                  {puzzle.description}
                </p>
              </div>

              {/* Solution (if solved) */}
              {solved && puzzle.solution.length > 0 && (
                <div style={{
                  background: '#1a1a2e',
                  borderRadius: 10,
                  padding: 16,
                  border: '1px solid #333',
                }}>
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

              {/* Progress */}
              {!solved && totalMoves > 0 && (
                <div style={{
                  background: '#1a1a2e',
                  borderRadius: 10,
                  padding: 12,
                  border: '1px solid #333',
                }}>
                  <span style={{ fontSize: 12, color: '#888' }}>Progress: </span>
                  <div style={{
                    height: 6,
                    background: '#333',
                    borderRadius: 3,
                    overflow: 'hidden',
                    marginTop: 4,
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${userSolutions.length / totalMoves * 100}%`,
                      background: '#4caf50',
                      borderRadius: 3,
                      transition: 'width 0.3s',
                    }} />
                  </div>
                </div>
              )}
            </>
          ) : loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#888' }}>
              Loading puzzle...
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: '#f44336' }}>
              {error}
            </div>
          )}

          {/* Action buttons */}
          {!solved && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-sm" type="button" onClick={handleHint}>
                💡 Hint
              </button>
              <button className="btn btn-sm" type="button" onClick={handleFlip}>
                ⇅ Flip Board
              </button>
              <button className="btn btn-sm" type="button" onClick={handleRestart}>
                ↻ Restart
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div style={{ textAlign: 'center', marginTop: 16, color: '#666', fontSize: 12 }}>
        <span>Click piece, then destination square • Use 💡 for hint • ↻ to restart</span>
      </div>
    </div>
  );
}
