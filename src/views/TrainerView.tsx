import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameState, Position } from '../chess/types';
import { createInitialState, executeMove, findKing } from '../chess/logic';
import type { SpottingMode } from '../chess/analysis';
import Board, { type BoardArrow } from '../components/Board';
import SpottingPanel from '../components/SpottingPanel';
import SettingsMenu from '../components/SettingsMenu';
import CommonMoves from '../components/CommonMoves';
import BookFilters from '../components/BookFilters';
import AnimatedPiece, { type AnimPiece } from '../components/AnimatedPiece';
import { useSettings } from '../settings/useSettings';
import { buildSpottingOverlay } from '../board/spottingOverlay';
import { resolvePly } from '../board/topArrows';
import { useOpeningExplorer } from '../board/lichess';
import { toFen } from '../chess/fen';
import type { Course } from '../courses/useCourses';
import {
  loadProgress, saveProgress, countDone, type Progress, type TrainerMode,
} from '../courses/progress';
import { resolveSan } from '../chess/san';

interface TrainerViewProps {
  course: Course;
  spottingModes: Set<SpottingMode>;
  setSpottingModes: (m: Set<SpottingMode>) => void;
  boardSize: number;
  setBoardSize: React.Dispatch<React.SetStateAction<number>>;
  onAnalysis: (state: GameState) => void;
}

const BOARD_MIN = 240, BOARD_STEP = 60;

function checkSquareOf(state: GameState): Position | null {
  if (!state.isCheck) return null;
  return findKing(state.board, state.currentTurn);
}

export default function TrainerView({
  course, spottingModes, setSpottingModes, boardSize, setBoardSize, onAnalysis,
}: TrainerViewProps) {
  const { settings } = useSettings();
  const userColor = course.playAs === 'w' ? 'white' : 'black';

  const [mode, setMode] = useState<TrainerMode>('learn');
  const [lineIdx, setLineIdx] = useState(0);
  const [progress, setProgress] = useState<Progress>(() => loadProgress(course.id));

  // board / flow state
  const [gameState, setGameState] = useState<GameState>(() => createInitialState());
  const [ply, setPly] = useState(0);
  const [selected, setSelected] = useState<Position | null>(null);
  const [done, setDone] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [hintUsed, setHintUsed] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; sub?: string }>({ text: '' });
  const [wrongSquare, setWrongSquare] = useState<Position | null>(null);
  const [animPiece, setAnimPiece] = useState<AnimPiece | null>(null);
  const [hintArrow, setHintArrow] = useState<BoardArrow | null>(null);
  const [lastMove, setLastMove] = useState<{ from: Position; to: Position } | null>(null);

  // refs for timeout-safe imperative flow (avoid stale closures in setTimeout)
  const stateRef = useRef(gameState);
  const plyRef = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const doneRef = useRef(false);
  const modeRef = useRef(mode);
  const mistakesRef = useRef(mistakes);
  const hintUsedRef = useRef(hintUsed);
  const arrowsRef = useRef(settings.arrows);
  const lineIdxRef = useRef(lineIdx);
  stateRef.current = gameState;
  modeRef.current = mode;
  mistakesRef.current = mistakes;
  hintUsedRef.current = hintUsed;
  arrowsRef.current = settings.arrows;
  lineIdxRef.current = lineIdx;

  const line = course.lines[lineIdx] ?? course.lines[0];
  const lineAt = useCallback((idx: number) => course.lines[idx] ?? course.lines[0], [course.lines]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const isUserPly = useCallback((i: number) =>
    ((i % 2 === 0) ? 'white' : 'black') === userColor, [userColor]);

  const userMovesTotal = useMemo(
    () => line.plies.reduce((n, _, i) => n + (isUserPly(i) ? 1 : 0), 0),
    [line, isUserPly],
  );
  const userMovesDone = useMemo(() => {
    let n = 0;
    for (let i = 0; i < ply; i++) if (isUserPly(i)) n++;
    return n;
  }, [ply, isUserPly]);

  const commit = useCallback((state: GameState, nextPly: number, mv: { from: Position; to: Position } | null) => {
    stateRef.current = state;
    plyRef.current = nextPly;
    setGameState(state);
    setPly(nextPly);
    setLastMove(mv);
  }, []);

  const finishLine = useCallback(() => {
    doneRef.current = true;
    setDone(true);
    setSelected(null);
    setHintArrow(null);
    const m = modeRef.current;
    const ln = lineAt(lineIdxRef.current);
    setProgress(prev => {
      const next: Progress = {
        learn: { ...prev.learn },
        practice: { ...prev.practice },
      };
      next[m][ln.id] = true;
      saveProgress(course.id, next);
      return next;
    });
    const mk = mistakesRef.current;
    const flawless = mk === 0 && !hintUsedRef.current;
    setFeedback({
      text: flawless ? 'Flawless. The line is yours.' : 'Line complete — review it again to make it stick.',
      sub: mk ? `${mk} mistake${mk > 1 ? 's' : ''}` : 'No mistakes',
    });
  }, [lineAt, course.id]);

  // Plays consecutive opponent plies, then prompts the user (or finishes the line).
  const replyLoop = useCallback(() => {
    const ln = lineAt(lineIdxRef.current);
    const run = () => {
      if (doneRef.current) return;
      const i = plyRef.current;
      const expected = ln.plies[i];
      if (!expected) { finishLine(); return; }
      if (stateRef.current.currentTurn === userColor) {
        // user's turn → prompt
        const mv = resolvePly(stateRef.current, expected);
        if (modeRef.current === 'learn') {
          setFeedback({ text: expected.note || 'Your move — find it.', sub: `Play ${expected.san}` });
          if (arrowsRef.current && mv) setHintArrow({ from: mv.from, to: mv.to, color: 'rgba(0,255,136,0.85)', width: 2.6 });
          else setHintArrow(null);
        } else {
          const mk = mistakesRef.current;
          setFeedback({ text: 'Your move — recall the line.', sub: mk ? `${mk} mistake${mk > 1 ? 's' : ''} so far` : '' });
          setHintArrow(null);
        }
        return;
      }
      // opponent move
      const mv = resolvePly(stateRef.current, expected);
      if (!mv) { finishLine(); return; }
      const t = setTimeout(() => {
        const piece = stateRef.current.board[mv.from.row][mv.from.col];
        if (piece) setAnimPiece({ piece, from: mv.from, to: mv.to });
        const next = executeMove(stateRef.current, mv.from, mv.to, mv.promotionPiece);
        commit(next, i + 1, { from: mv.from, to: mv.to });
        run();
      }, 620);
      timers.current.push(t);
    };
    run();
  }, [lineAt, userColor, finishLine, commit]);

  const startLine = useCallback((idx: number, m: TrainerMode) => {
    clearTimers();
    doneRef.current = false;
    lineIdxRef.current = idx;
    modeRef.current = m;
    mistakesRef.current = 0;
    hintUsedRef.current = false;
    const fresh = createInitialState();
    stateRef.current = fresh;
    plyRef.current = 0;
    setGameState(fresh);
    setPly(0);
    setLineIdx(idx);
    setMode(m);
    setSelected(null);
    setDone(false);
    setMistakes(0);
    setHintUsed(false);
    setWrongSquare(null);
    setAnimPiece(null);
    setHintArrow(null);
    setLastMove(null);
    setFeedback({ text: course.lines[idx]?.plies[0]?.note || 'Make your first move.', sub: '' });
    // kick the flow on next tick so refs are settled
    const t = setTimeout(() => replyLoop(), 0);
    timers.current.push(t);
  }, [clearTimers, course.lines, replyLoop]);

  // (re)start whenever the course changes
  useEffect(() => {
    setProgress(loadProgress(course.id));
    startLine(0, 'learn');
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

  const playUserMove = useCallback((from: Position, to: Position, promo?: import('../chess/types').PieceType) => {
    const piece = stateRef.current.board[from.row][from.col];
    if (piece) setAnimPiece({ piece, from, to });
    const next = executeMove(stateRef.current, from, to, promo);
    commit(next, plyRef.current + 1, { from, to });
    setSelected(null);
    setHintArrow(null);
    setFeedback({ text: 'Good.', sub: '' });
    replyLoop();
  }, [commit, replyLoop]);

  const wrongMove = useCallback((sq: Position) => {
    setMistakes(m => m + 1);
    setSelected(null);
    setWrongSquare(sq);
    const expected = line.plies[plyRef.current];
    if (modeRef.current === 'learn' && expected) {
      const mv = resolvePly(stateRef.current, expected);
      setFeedback({ text: 'Not quite — try again.', sub: `Hint: ${expected.san}` });
      if (arrowsRef.current && mv) setHintArrow({ from: mv.from, to: mv.to, color: 'rgba(0,255,136,0.85)', width: 2.6 });
    } else {
      setFeedback({ text: 'Not the repertoire move — try again.', sub: '' });
    }
    const t = setTimeout(() => setWrongSquare(null), 480);
    timers.current.push(t);
  }, [line]);

  const onSquareClick = useCallback((pos: Position) => {
    if (doneRef.current) return;
    const expected = line.plies[plyRef.current];
    if (!expected) return;
    if (stateRef.current.currentTurn !== userColor) return; // opponent thinking
    const mv = resolvePly(stateRef.current, expected);
    if (!mv) return;
    const piece = stateRef.current.board[pos.row][pos.col];

    if (selected) {
      if (pos.row === selected.row && pos.col === selected.col) { setSelected(null); return; }
      if (selected.row === mv.from.row && selected.col === mv.from.col &&
          pos.row === mv.to.row && pos.col === mv.to.col) {
        playUserMove(mv.from, mv.to, mv.promotionPiece);
        return;
      }
      if (piece && piece.color === userColor) { setSelected(pos); return; }
      wrongMove(pos);
      return;
    }
    if (piece && piece.color === userColor) setSelected(pos);
  }, [line, userColor, selected, playUserMove, wrongMove]);

  const onHint = useCallback(() => {
    if (doneRef.current) return;
    const expected = line.plies[plyRef.current];
    if (!expected) return;
    const mv = resolvePly(stateRef.current, expected);
    if (!mv) return;
    setHintUsed(true);
    setHintArrow({ from: mv.from, to: mv.to, color: 'rgba(255,217,61,0.9)', width: 2.6 });
    setFeedback({ text: `Hint: ${expected.san}`, sub: '' });
  }, [line]);

  // ── derived render data ───────────────────────────────────────────────────
  const spottingOverlay = useMemo(
    () => buildSpottingOverlay(spottingModes, gameState),
    [spottingModes, gameState],
  );
  const bookFen = useMemo(() => toFen(gameState), [gameState]);
  const { rows: bookRows, loading: bookLoading } = useOpeningExplorer(bookFen, settings.bookSpeeds, settings.bookRatings);
  const checkSq = checkSquareOf(gameState);
  const expectedNow = line.plies[ply];
  const expectedMv = expectedNow && gameState.currentTurn === userColor ? resolveSan(gameState, expectedNow.san) : null;
  // learn-mode: dot on the target when the source is selected
  const validMoves = (mode === 'learn' && selected && expectedMv &&
    selected.row === expectedMv.from.row && selected.col === expectedMv.from.col)
    ? [expectedMv.to] : [];

  const wrongFlash = wrongSquare ? (
    <div className="wrong-flash" style={{
      left: `${wrongSquare.col * 12.5}%`, top: `${wrongSquare.row * 12.5}%`,
    }} />
  ) : null;

  const learnDone = countDone(progress, 'learn');
  const practiceDone = countDone(progress, 'practice');
  const total = course.lines.length;
  const perfect = mistakes === 0 && !hintUsed;

  const nextUndoneIdx = () => {
    for (let i = 1; i <= total; i++) {
      const idx = (lineIdx + i) % total;
      if (!progress[mode][course.lines[idx].id]) return idx;
    }
    return (lineIdx + 1) % total;
  };

  return (
    <div className="trainer-grid">
      <div className="board-col">
        <div style={{ width: 'min(92vw, 560px)' }}>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${userMovesTotal ? (userMovesDone / userMovesTotal) * 100 : 0}%` }} /></div>
          <div className="mono-dim" style={{ marginTop: 4 }}>{userMovesDone} / {userMovesTotal} moves</div>
        </div>

        <div className="board-row">
          <SpottingPanel modes={spottingModes} onChange={setSpottingModes} />
          <div style={{ position: 'relative' }}>
            <Board
              board={gameState.board}
              selectedPos={selected}
              validMoves={validMoves}
              lastMove={lastMove}
              checkSquare={checkSq}
              enPassantTarget={gameState.enPassantTarget}
              whiteCanCastleKingside={gameState.whiteCanCastleKingside}
              whiteCanCastleQueenside={gameState.whiteCanCastleQueenside}
              blackCanCastleKingside={gameState.blackCanCastleKingside}
              blackCanCastleQueenside={gameState.blackCanCastleQueenside}
              isCheck={gameState.isCheck}
              isCheckmate={gameState.isCheckmate}
              isStalemate={gameState.isStalemate}
              currentTurn={gameState.currentTurn}
              onSquareClick={onSquareClick}
              onResize={setBoardSize}
              overlay={<>{spottingOverlay}{wrongFlash}</>}
              arrows={hintArrow ? [hintArrow] : []}
              boardSize={boardSize}
              hidePieceAt={animPiece?.to ?? null}
              animOverlay={animPiece ? (
                <AnimatedPiece anim={animPiece} boardSize={boardSize} onDone={() => setAnimPiece(null)} />
              ) : undefined}
            />
          </div>
        </div>

        <div className="board-size-control">
          <span>BOARD</span>
          <button onClick={() => setBoardSize(s => Math.max(BOARD_MIN, s - BOARD_STEP))} disabled={boardSize <= BOARD_MIN}>−</button>
          <strong>{boardSize}px</strong>
          <button onClick={() => setBoardSize(s => s + BOARD_STEP)}>+</button>
        </div>
      </div>

      <aside className="side-panel trainer-panel">
        <div className="mode-header">
          <span className="mode-name">{mode}</span>
          <span className="course">{course.name}</span>
          <span className="line-no">#{lineIdx + 1}</span>
          <SettingsMenu />
        </div>

        <div className="coach">
          <div className="avatar">♘</div>
          <div className="bubble">
            {feedback.text}
            {feedback.sub ? <span className="sub">{feedback.sub}</span> : null}
          </div>
        </div>

        <div className="mode-tabs">
          <button className={`mode-tab ${mode === 'learn' ? 'active' : ''}`} type="button" onClick={() => startLine(lineIdx, 'learn')}>
            <span className="t">📖 Learn</span><span className="s">{learnDone}/{total} lines</span>
          </button>
          <button className={`mode-tab ${mode === 'practice' ? 'active' : ''}`} type="button" onClick={() => startLine(lineIdx, 'practice')}>
            <span className="t">🎯 Practice</span><span className="s">{practiceDone}/{total} lines</span>
          </button>
          <button className="mode-tab" type="button" disabled title="Learn 3 lines to unlock">
            <span className="t">🔥 Drill</span><span className="s">locked</span>
          </button>
          <button className="mode-tab" type="button" disabled title="Learn 3 lines to unlock">
            <span className="t">⏳ Time</span><span className="s">locked</span>
          </button>
        </div>

        <div className="lines-list">
          {course.lines.map((l, i) => (
            <button key={l.id} className={`line-row ${i === lineIdx ? 'current' : ''}`} type="button" onClick={() => startLine(i, mode)}>
              <span className={`st ${progress[mode][l.id] ? 'done' : 'todo'}`}>{progress[mode][l.id] ? '✓' : '○'}</span>
              <span className="nm">{l.name}</span>
              <span className="tg">{l.tag}</span>
            </button>
          ))}
        </div>

        <div className="sec-block">
          <div className="sec-title">Common moves</div>
          <BookFilters />
          <CommonMoves rows={bookRows} loading={bookLoading} onPlay={(san) => {
            // playing a book move only counts if it matches the expected user move
            if (doneRef.current || gameState.currentTurn !== userColor) return;
            const expected = line.plies[plyRef.current];
            const mv = expected ? resolvePly(stateRef.current, expected) : null;
            const book = resolveSan(stateRef.current, san);
            if (mv && book && book.from.row === mv.from.row && book.from.col === mv.from.col &&
                book.to.row === mv.to.row && book.to.col === mv.to.col) {
              playUserMove(mv.from, mv.to, mv.promotionPiece);
            }
          }} />
        </div>

        {done && (
          <div className="complete-banner fade-in-up">
            <div className="big">✓ Line Complete</div>
            <div className="small">{line.name} — {userMovesTotal} moves{perfect ? ' · perfect run' : ''}</div>
            <div className="row">
              <button className="btn btn-green" type="button" onClick={() => startLine(nextUndoneIdx(), mode)}>▸ Next line</button>
              <button className="btn btn-ghost" type="button" onClick={() => startLine(lineIdx, mode)}>↻ Replay</button>
            </div>
          </div>
        )}

        <div className="panel-toolbar">
          <button className="btn btn-ghost" type="button" onClick={() => startLine(lineIdx, mode)}>↻ Restart</button>
          <button className="btn btn-cyan" type="button" onClick={() => onAnalysis(gameState)}>Analysis →</button>
          <button className="btn btn-yellow" type="button" onClick={onHint} disabled={done}>💡 Hint</button>
        </div>
      </aside>
    </div>
  );
}
