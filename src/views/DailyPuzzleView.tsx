import { useState, useEffect, useCallback, useMemo } from 'react';
import Board, { type BoardArrow } from '../components/Board';
import { parseFen, toFen } from '../chess/fen';
import { createInitialState, getLegalMoves, findKing, getPieceLabel } from '../chess/logic';
import type { GameState, Position, PieceType, PieceColor } from '../chess/types';
import { pieceSrc, pieceCode } from '../board/pieceSrc';
import { useSettings, BOARD_THEMES } from '../settings/useSettings';
import { useOpeningExplorer } from '../board/lichess';
import { sparringEngine } from '../board/sparringEngine';
import type { Puzzle, DailyPuzzleResult } from '../data/puzzles';
import { ARROW } from '../board/arrowPalette';

export default function DailyPuzzleView({
  onAnalysis,
}: {
  onAnalysis: (state: GameState) => void;
}) {
  const { settings } = useSettings();
  const theme = BOARD_THEMES[settings.boardTheme] ?? BOARD_THEMES.classic;
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
  const [solutionFen, setSolutionFen] = useState<string>('');
  const [solutionMoves, setSolutionMoves] = useState<string[]>([]);
  const [totalMoves, setTotalMoves] = useState(0);

  // Fetch puzzle on mount
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch('/api/puzzle')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && data.puzzle) {
          const p = data.puzzle;
          setPuzzle(p);
          setCurrentFen(p.fen);
          setCurrentTurn(p.color);
          setSolutionFen(p.solutionFen || p.fen);
          setSolutionMoves(p.solution);
          setTotalMoves(p.solution?.length || 0);
          const st = parseFen(p.fen);
          if (st) setGameState(st);
        } else {
          // Fetch directly from Lichess
          return fetch('https://lichess.org/api/puzzle/tod');
        }
      })
      .then(res => {
        if (!res || !res.ok) throw new Error('No puzzle available');
        return res.json();
      })
      .then(raw => {
        if (raw) {
          const p: Puzzle = {
            id: raw.id,
            fen: raw.fen,
            url: raw.url,
            solution: raw.solution || [],
            theme: raw.theme || 'tactics',
            themes: raw.themes || [raw.theme],
            rating: raw.rating || 1500,
            ratingVotes: raw.ratingVotes || 0,
            playCount: raw.playCount || 0,
            dateAdded: raw.dateAdded || new Date().toISOString(),
            color: raw.fen.split(' ')[1] === 'w' ? 'white' : 'black',
            solutionFen: raw.finalFen || raw.fen,
            mateIn: Math.ceil((raw.solution?.length || 0) / 2),
          };
          setPuzzle(p);
          setCurrentFen(p.fen);
          setCurrentTurn(p.color);
          setSolutionFen(p.solutionFen || p.fen);
          setSolutionMoves(p.solution);
          setTotalMoves(p.solution?.length || 0);
          const st = parseFen(p.fen);
          if (st) setGameState(st);
        } else {
          setError('No puzzle available right now.');
        }
        setLoading(false);
      })
      .catch(err => {
        setError(err.message || 'Failed to load puzzle');
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

  // Book explorer for the current position
  const { rows: bookRows } = useOpeningExplorer(currentFen, [], [], false);

  // Check if a move is in the legal set
  const isLegal = useCallback((from: Position, to: Position) => {
    return legalMoves.some(m => m.row === to.row && m.col === to.col);
  }, [legalMoves]);

  // Handle piece click (select piece to move)
  const handleSquareClick = (row: number, col: number) => {
    if (solved || !isLegal(selectedPos?.row ?? 0, 0)) return;
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

    // Make the move
    const movingPiece = state.board[from.row][from.col];
    if (!movingPiece) { setSelectedPos(null); return; }

    const newState = { ...state, board: state.board.map(r => [...r]) };
    newState.board[toRow][toCol] = movingPiece;
    newState.board[from.row][from.col] = null;
    newState.currentTurn = newState.currentTurn === 'w' ? 'b' : 'w';

    // Determine SAN (simplified)
    const san = `${pieceCode(movingPiece.color, movingPiece.type)}${String.fromCharCode(97 + from.col)}${8 - from.row}-${String.fromCharCode(97 + toCol)}${8 - toRow}`;

    // Check if it matches the solution
    const nextIdx = userSolutions.length;
    if (nextIdx < (puzzle?.solution?.length || 0)) {
      const expectedSan = puzzle.solution[nextIdx].replace(/[+#=].*$/, '').trim().toLowerCase();
      const moveFrom = `${String.fromCharCode(97 + from.col)}${8 - from.row}`;
      const moveTo = `${String.fromCharCode(97 + toCol)}${8 - toRow}`;
      const userSan = `${pieceCode(movingPiece.color, movingPiece.type)}${moveFrom}-${moveTo}`.toLowerCase();

      // Also check the expected SAN vs user move coordinates
      const matchCoords = expectedSan.includes(moveFrom) && expectedSan.includes(moveTo);
      const matchPiece = expectedSan.toLowerCase().startsWith(movingPiece.type === 'pawn' ? '' : movingPiece.type);

      if (matchCoords && (matchPiece || expectedSan.toLowerCase().includes(movingPiece.type === 'pawn' ? '' : movingPiece.type))) {
        // CORRECT!
        setFeedback('correct');
        setFeedbackMsg('✅ Correct!');
        setUserSolutions([...userSolutions, `${moveFrom}${moveTo}`]);
        setCurrentFen(toFen(newState));
        setGameState(newState);

        // Check if puzzle is complete
        if (userSolutions.length + 1 >= (puzzle?.solution?.length || 0)) {
          setSolved(true);
          setFeedbackMsg('🎉 Puzzle solved! Well done!');
        }
      } else {
        // WRONG
        setFeedback('wrong');
        setFeedbackMsg(`❌ Not the best move. Hint: try the correct piece.`);
        setShowHint(true);
        // Show hint arrow
        setHintArrow({
          from,
          to: { row: toRow, col: toCol },
          color: ARROW.red,
          width: 2.0,
          label: '✗',
          labelAt: 'head',
        });
        setTimeout(() => { setFeedback(null); setFeedbackMsg(''); }, 2000);
      }
    }

    setSelectedPos(null);
  };

  // Show hint: ask Stockfish for the best move from current position
  const handleHint = async () => {
    setShowHint(true);
    const uci = await sparringEngine.bestMove(currentFen, { label: 'puzzle-hint', skill: 15, movetime: 1500 });
    if (uci) {
      const from = { row: 8 - Number(uci[1]), col: uci.charCodeAt(0) - 97 };
      const to = { row: 8 - Number(uci[3]), col: uci.charCodeAt(2) - 97 };
      setHintArrow({ from, to, color: ARROW.green, width: 2.4, label: '💡', labelAt: 'head' });
    }
  };

  const handleRestart = () => {
    if (puzzle) {
      setCurrentFen(puzzle.fen);
      setCurrentTurn(puzzle.color);
      setGameState(parseFen(puzzle.fen) ?? gameState);
      setUserSolutions([]);
      setSolved(false);
      setFeedback(null);
      setShowHint(false);
      setHintArrow(null);
    }
  };

  const handleOpenInAnalysis = () => {
    if (currentFen) onAnalysis(parseFen(currentFen));
  };

  const handleFlip = () => setFlipped(f => !f);

  // Legal move highlights for selected piece
  const legalHighlights = useMemo(() => {
    if (!selectedPos) return new Set<string>();
    return new Set(legalMoves.map(m => `${m.row}-${m.col}`));
  }, [selectedPos, legalMoves]);

  const checkSquare = useMemo(() => {
    if (!state.isCheck) return null;
    return findKing(state.board, state.currentTurn);
  }, [state.isCheck, state.currentTurn, state.board]);

  // Build board display
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
          Find the best move{puzzle && puzzle.solution?.length > 1 ? 's' : ''}.
          {puzzle && ` ${puzzle.solution?.length || 0} move${(puzzle.solution?.length || 0) > 1 ? 's' : ''}`}
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
            Solution: {solutionMoves.join(' ')}
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
          width: Math.min(560, window.innerWidth - 40),
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
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 13, color: '#888' }}>
                  {puzzle.color === 'w' ? 'White' : 'Black'} to move
                </p>
                {puzzle.themes && puzzle.themes.length > 1 && (
                  <div style={{ marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: '#666' }}>Themes: </span>
                    {puzzle.themes.map((t, i) => (
                      <span key={i} style={{
                        background: '#333',
                        padding: '1px 6px',
                        borderRadius: 8,
                        fontSize: 11,
                        marginRight: 4,
                        color: '#aaa',
                      }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Solution (if solved) */}
              {solved && solutionMoves.length > 0 && (
                <div style={{
                  background: '#1a1a2e',
                  borderRadius: 10,
                  padding: 16,
                  border: '1px solid #333',
                }}>
                  <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#4caf50' }}>Solution</h4>
                  <div style={{ fontFamily: 'monospace', fontSize: 14 }}>
                    {solutionMoves.map((m, i) => (
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
              {error || 'No puzzle available right now. Try again later!'}
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
              <button className="btn btn-sm" type="button" onClick={handleOpenInAnalysis}>
                Analyse →
              </button>
              {puzzle?.url && (
                <a href={puzzle.url} target="_blank" rel="noopener noreferrer"
                   className="btn btn-sm" style={{ textDecoration: 'none', textAlign: 'center' }}>
                  View on Lichess ↗
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div style={{ textAlign: 'center', marginTop: 16, color: '#666', fontSize: 12 }}>
        <span>Click piece, then destination square • Use 💡 for hint • ↻ to restart</span>
      </div>

      {/* Hint arrow */}
      {hintArrow && (
        <div style={{
          position: 'absolute',
          pointerEvents: 'none',
        }}>
          {/* Simple arrow SVG overlay */}
          <svg style={{
            position: 'absolute',
            top: 0, left: 0,
            width: '100%', height: '100%',
            pointerEvents: 'none',
          }}>
            <line
              x1={`${(hintArrow.from.col + 0.5) * 12.5}%`}
              y1={`${(hintArrow.from.row + 0.5) * 12.5}%`}
              x2={`${(hintArrow.to.col + 0.5) * 12.5}%`}
              y2={`${(hintArrow.to.row + 0.5) * 12.5}%`}
              stroke={hintArrow.color}
              strokeWidth="4"
              markerEnd="url(#arrowhead)"
              style={{ transition: 'all 0.3s' }}
            />
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill={hintArrow.color} />
              </marker>
            </defs>
          </svg>
        </div>
      )}
    </div>
  );
}
