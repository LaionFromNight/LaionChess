import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameState, Position } from '../chess/types';
import { createInitialState, executeMove, findKing, getLegalMoves } from '../chess/logic';
import type { SpottingMode } from '../chess/analysis';
import Board, { type BoardArrow } from '../components/Board';
import SpottingPanel from '../components/SpottingPanel';
import SettingsMenu from '../components/SettingsMenu';
import CommonMoves from '../components/CommonMoves';
import BookFilters from '../components/BookFilters';
import AnimatedPiece, { type AnimPiece } from '../components/AnimatedPiece';
import { useSettings } from '../settings/useSettings';
import { buildSpottingOverlay } from '../board/spottingOverlay';
import { resolvePly, type ResolvedMove } from '../board/topArrows';
import { useOpeningExplorer } from '../board/lichess';
import { useBoardKeys, useFitBoardSize } from '../board/useBoardLayout';
import { toFen } from '../chess/fen';
import { renderSanForMoveList } from '../chess/san';
import type { Course } from '../courses/useCourses';
import {
  loadProgress, saveProgress, countDone, type Progress, type TrainerMode,
} from '../courses/progress';

interface TrainerViewProps {
  course: Course;
  spottingModes: Set<SpottingMode>;
  setSpottingModes: (m: Set<SpottingMode>) => void;
  onAnalysis: (state: GameState) => void;
  onBack: () => void;
}

interface HistEntry {
  state: GameState;
  move: { from: Position; to: Position } | null;
  san: string | null;
}

const HINT_COLOR = 'rgba(52,199,120,0.85)';
const REVEAL_COLOR = 'rgba(240,190,40,0.9)';
const OPPONENT_DELAY = 480;

const MODES: Array<{ key: TrainerMode; label: string; icon: string; blurb: string }> = [
  { key: 'learn', label: 'Learn', icon: '📖', blurb: 'Guided — the coach shows every move.' },
  { key: 'practice', label: 'Practice', icon: '🎯', blurb: 'Recall the chosen line without hints.' },
  { key: 'drill', label: 'Drill', icon: '🔥', blurb: 'Random lines, no hints — play it like a game.' },
];

function checkSquareOf(state: GameState): Position | null {
  return state.isCheck ? findKing(state.board, state.currentTurn) : null;
}

function legalTargets(state: GameState, from: Position): Position[] {
  return getLegalMoves(
    state.board, from, state.enPassantTarget,
    state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
    state.blackCanCastleKingside, state.blackCanCastleQueenside,
  );
}

const same = (a: Position | null | undefined, b: Position | null | undefined) =>
  !!a && !!b && a.row === b.row && a.col === b.col;

export default function TrainerView({
  course, spottingModes, setSpottingModes, onAnalysis, onBack,
}: TrainerViewProps) {
  const { settings, setSetting } = useSettings();
  const userColor = course.playAs === 'w' ? 'white' : 'black';

  const [mode, setMode] = useState<TrainerMode>('learn');
  const [lineIdx, setLineIdx] = useState(0);
  const [progress, setProgress] = useState<Progress>(() => loadProgress(course.id));
  const [flipOverride, setFlipOverride] = useState(false);
  const flipped = (userColor === 'black') !== flipOverride;

  // board / flow state
  const [hist, setHist] = useState<HistEntry[]>(() => [{ state: createInitialState(), move: null, san: null }]);
  const [viewIdx, setViewIdx] = useState<number | null>(null); // null = live position
  const [selected, setSelected] = useState<Position | null>(null);
  const [done, setDone] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [hintUsed, setHintUsed] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; sub?: string; tone?: 'ok' | 'bad' | 'info' }>({ text: '' });
  const [wrongSquare, setWrongSquare] = useState<Position | null>(null);
  const [animPiece, setAnimPiece] = useState<AnimPiece | null>(null);
  const [hintArrow, setHintArrow] = useState<BoardArrow | null>(null);
  const [streak, setStreak] = useState(0);
  const [showBook, setShowBook] = useState(false);

  const ply = hist.length - 1;
  const gameState = hist[ply].state;

  // refs for timeout-safe imperative flow (avoid stale closures in setTimeout)
  const stateRef = useRef(gameState);
  const plyRef = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const doneRef = useRef(false);
  const modeRef = useRef(mode);
  const mistakesRef = useRef(0);
  const plyMistakesRef = useRef(0);
  const hintUsedRef = useRef(false);
  const arrowsRef = useRef(settings.arrows);
  const lineIdxRef = useRef(lineIdx);
  arrowsRef.current = settings.arrows;

  const line = course.lines[lineIdx] ?? course.lines[0];
  const lineAt = useCallback((idx: number) => course.lines[idx] ?? course.lines[0], [course.lines]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const isUserPly = useCallback((i: number) => ((i % 2 === 0) ? 'white' : 'black') === userColor, [userColor]);
  const userMovesTotal = useMemo(() => line.plies.reduce((n, _, i) => n + (isUserPly(i) ? 1 : 0), 0), [line, isUserPly]);
  const userMovesDone = useMemo(() => {
    let n = 0;
    for (let i = 0; i < ply; i++) if (isUserPly(i)) n++;
    return n;
  }, [ply, isUserPly]);

  const commit = useCallback((state: GameState, mv: ResolvedMove, san: string) => {
    stateRef.current = state;
    plyRef.current += 1;
    setHist(h => [...h, { state, move: { from: mv.from, to: mv.to }, san }]);
    setViewIdx(null);
  }, []);

  const pickDrillIdx = useCallback((exclude: number, prog: Progress) => {
    const n = course.lines.length;
    if (n <= 1) return 0;
    const all = course.lines.map((_, i) => i).filter(i => i !== exclude);
    const fresh = all.filter(i => !prog.drill[course.lines[i].id]);
    const pool = fresh.length ? fresh : all;
    return pool[Math.floor(Math.random() * pool.length)];
  }, [course.lines]);

  const finishLine = useCallback(() => {
    doneRef.current = true;
    setDone(true);
    setSelected(null);
    setHintArrow(null);
    const m = modeRef.current;
    const ln = lineAt(lineIdxRef.current);
    const mk = mistakesRef.current;
    const flawless = mk === 0 && !hintUsedRef.current;
    setProgress(prev => {
      const next: Progress = { learn: { ...prev.learn }, practice: { ...prev.practice }, drill: { ...prev.drill } };
      // Drill only counts a line once it is played cleanly.
      if (m !== 'drill' || flawless) next[m][ln.id] = true;
      saveProgress(course.id, next);
      return next;
    });
    if (m === 'drill') setStreak(s => (flawless ? s + 1 : 0));
    setFeedback({
      text: flawless ? 'Flawless — the line is yours.' : 'Line complete. Run it again to make it stick.',
      sub: mk ? `${mk} mistake${mk > 1 ? 's' : ''}${hintUsedRef.current ? ' · hint used' : ''}` : (hintUsedRef.current ? 'Hint used' : 'No mistakes'),
      tone: flawless ? 'ok' : 'info',
    });
  }, [lineAt, course.id]);

  const promptUser = useCallback(() => {
    const ln = lineAt(lineIdxRef.current);
    const expected = ln.plies[plyRef.current];
    const mv = expected ? resolvePly(stateRef.current, expected) : null;
    plyMistakesRef.current = 0;
    if (modeRef.current === 'learn') {
      setFeedback({ text: expected?.note || 'Your move — find it.', sub: expected ? `Play ${expected.san}` : '', tone: 'info' });
      setHintArrow(arrowsRef.current && mv ? { from: mv.from, to: mv.to, color: HINT_COLOR, width: 2.4 } : null);
    } else {
      const mk = mistakesRef.current;
      const text = modeRef.current === 'drill' ? 'Your move — what does the repertoire say?' : 'Your move — recall the line.';
      setFeedback({ text, sub: mk ? `${mk} mistake${mk > 1 ? 's' : ''} so far` : '', tone: 'info' });
      setHintArrow(null);
    }
  }, [lineAt]);

  // Plays consecutive opponent plies, then prompts the user (or finishes the line).
  const replyLoop = useCallback(() => {
    const ln = lineAt(lineIdxRef.current);
    const run = () => {
      if (doneRef.current) return;
      const i = plyRef.current;
      const expected = ln.plies[i];
      if (!expected) { finishLine(); return; }
      if (stateRef.current.currentTurn === userColor) { promptUser(); return; }
      const mv = resolvePly(stateRef.current, expected);
      if (!mv) { finishLine(); return; }
      later(() => {
        if (doneRef.current) return;
        const piece = stateRef.current.board[mv.from.row][mv.from.col];
        if (piece) setAnimPiece({ piece, from: mv.from, to: mv.to });
        const next = executeMove(stateRef.current, mv.from, mv.to, mv.promotionPiece);
        commit(next, mv, expected.san);
        run();
      }, OPPONENT_DELAY);
    };
    run();
  }, [lineAt, userColor, finishLine, commit, promptUser, later]);

  const startLine = useCallback((idx: number, m: TrainerMode) => {
    clearTimers();
    doneRef.current = false;
    lineIdxRef.current = idx;
    modeRef.current = m;
    mistakesRef.current = 0;
    plyMistakesRef.current = 0;
    hintUsedRef.current = false;
    const fresh = createInitialState();
    stateRef.current = fresh;
    plyRef.current = 0;
    setHist([{ state: fresh, move: null, san: null }]);
    setViewIdx(null);
    setLineIdx(idx);
    setMode(m);
    setSelected(null);
    setDone(false);
    setMistakes(0);
    setHintUsed(false);
    setWrongSquare(null);
    setAnimPiece(null);
    setHintArrow(null);
    setFeedback({ text: m === 'drill' ? 'A random line from the course — play your repertoire.' : 'Get ready…', tone: 'info' });
    later(() => replyLoop(), 0);
  }, [clearTimers, replyLoop, later]);

  // (re)start whenever the course changes
  useEffect(() => {
    setProgress(loadProgress(course.id));
    setStreak(0);
    setFlipOverride(false);
    startLine(0, 'learn');
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id]);

  const playUserMove = useCallback((mv: ResolvedMove) => {
    const expected = lineAt(lineIdxRef.current).plies[plyRef.current];
    const piece = stateRef.current.board[mv.from.row][mv.from.col];
    if (piece) setAnimPiece({ piece, from: mv.from, to: mv.to });
    const next = executeMove(stateRef.current, mv.from, mv.to, mv.promotionPiece);
    commit(next, mv, expected?.san ?? '');
    setSelected(null);
    setHintArrow(null);
    setFeedback({ text: 'Correct.', tone: 'ok' });
    replyLoop();
  }, [commit, replyLoop, lineAt]);

  const wrongMove = useCallback((sq: Position) => {
    mistakesRef.current += 1;
    plyMistakesRef.current += 1;
    setMistakes(mistakesRef.current);
    setSelected(null);
    setWrongSquare(sq);
    const expected = lineAt(lineIdxRef.current).plies[plyRef.current];
    const mv = expected ? resolvePly(stateRef.current, expected) : null;
    if (modeRef.current === 'learn' && expected) {
      setFeedback({ text: 'Not quite — follow the arrow.', sub: `The move is ${expected.san}`, tone: 'bad' });
      if (mv) setHintArrow({ from: mv.from, to: mv.to, color: HINT_COLOR, width: 2.4 });
    } else if (plyMistakesRef.current >= 3 && expected && mv) {
      // Don't let the trainee get stuck: reveal after three misses.
      hintUsedRef.current = true;
      setHintUsed(true);
      setFeedback({ text: `The repertoire move is ${expected.san}.`, sub: expected.note, tone: 'bad' });
      setHintArrow({ from: mv.from, to: mv.to, color: REVEAL_COLOR, width: 2.4 });
    } else {
      setFeedback({ text: 'Not the repertoire move — try again.', sub: `${mistakesRef.current} mistake${mistakesRef.current > 1 ? 's' : ''}`, tone: 'bad' });
    }
    later(() => setWrongSquare(null), 480);
  }, [lineAt, later]);

  /** Try a user move; returns true when it was consumed (right or wrong). */
  const attemptMove = useCallback((from: Position, to: Position): boolean => {
    const st = stateRef.current;
    const expected = lineAt(lineIdxRef.current).plies[plyRef.current];
    if (!expected) return false;
    if (!legalTargets(st, from).some(t => same(t, to))) return false;
    const mv = resolvePly(st, expected);
    if (mv && same(mv.from, from) && same(mv.to, to)) { playUserMove(mv); return true; }
    wrongMove(to);
    return true;
  }, [lineAt, playUserMove, wrongMove]);

  const canInteract = !done && viewIdx === null && gameState.currentTurn === userColor;

  const onSquareClick = useCallback((pos: Position) => {
    if (viewIdx !== null) { setViewIdx(null); return; } // reviewing → back to live
    if (doneRef.current || stateRef.current.currentTurn !== userColor) return;
    const piece = stateRef.current.board[pos.row][pos.col];
    if (selected) {
      if (same(pos, selected)) { setSelected(null); return; }
      if (piece && piece.color === userColor) { setSelected(pos); return; }
      if (!attemptMove(selected, pos)) setSelected(null);
      return;
    }
    if (piece && piece.color === userColor) setSelected(pos);
  }, [viewIdx, userColor, selected, attemptMove]);

  const onDragMove = useCallback((from: Position, to: Position) => {
    if (!canInteract) return;
    if (!attemptMove(from, to)) setSelected(null);
  }, [canInteract, attemptMove]);

  const onHint = useCallback(() => {
    if (doneRef.current) return;
    const expected = lineAt(lineIdxRef.current).plies[plyRef.current];
    if (!expected || stateRef.current.currentTurn !== userColor) return;
    const mv = resolvePly(stateRef.current, expected);
    if (!mv) return;
    setViewIdx(null);
    hintUsedRef.current = true;
    setHintUsed(true);
    setHintArrow({ from: mv.from, to: mv.to, color: REVEAL_COLOR, width: 2.4 });
    setFeedback({ text: `Hint: ${expected.san}`, sub: expected.note, tone: 'info' });
  }, [lineAt, userColor]);

  const total = course.lines.length;
  const nextIdx = useCallback(() => {
    if (mode === 'drill') return pickDrillIdx(lineIdx, progress);
    for (let i = 1; i <= total; i++) {
      const idx = (lineIdx + i) % total;
      if (!progress[mode][course.lines[idx].id]) return idx;
    }
    return (lineIdx + 1) % total;
  }, [mode, lineIdx, progress, total, course.lines, pickDrillIdx]);

  // Drill flows straight into the next random line after a clean run.
  useEffect(() => {
    if (!done || mode !== 'drill' || mistakes > 0 || hintUsed) return;
    const t = setTimeout(() => startLine(nextIdx(), 'drill'), 1400);
    return () => clearTimeout(t);
  }, [done, mode, mistakes, hintUsed, nextIdx, startLine]);

  const switchMode = (m: TrainerMode) => {
    if (m === 'drill') startLine(pickDrillIdx(-1, progress), 'drill');
    else startLine(lineIdx, m);
  };

  // ── keyboard: ← → review the moves played so far, F flips ─────────────────
  useBoardKeys({
    prev: () => setViewIdx(v => Math.max(0, (v ?? ply) - 1)),
    next: () => setViewIdx(v => (v === null || v + 1 >= ply ? null : v + 1)),
    first: () => setViewIdx(ply > 0 ? 0 : null),
    last: () => setViewIdx(null),
    flip: () => setFlipOverride(f => !f),
  });

  // ── derived render data ───────────────────────────────────────────────────
  const shown = viewIdx !== null ? hist[viewIdx] : hist[ply];
  const boardState = shown.state;
  const spottingOverlay = useMemo(() => buildSpottingOverlay(spottingModes, boardState), [spottingModes, boardState]);
  const bookFen = useMemo(() => toFen(gameState), [gameState]);
  const { rows: bookRows, loading: bookLoading } = useOpeningExplorer(bookFen, settings.bookSpeeds, settings.bookRatings);
  const validMoves = canInteract && selected ? legalTargets(gameState, selected) : [];

  const wrongFlash = wrongSquare ? (
    <div className="wrong-flash" style={{ left: `${wrongSquare.col * 12.5}%`, top: `${wrongSquare.row * 12.5}%` }} />
  ) : null;

  const { ref: fitRef, size: boardSize } = useFitBoardSize(settings.boardMax, { reserveHeight: 150 });

  const learnDone = countDone(progress, 'learn');
  const practiceDone = countDone(progress, 'practice');
  const drillDone = countDone(progress, 'drill');
  const counts: Record<TrainerMode, number> = { learn: learnDone, practice: practiceDone, drill: drillDone };
  const perfect = mistakes === 0 && !hintUsed;
  const hideLineName = mode === 'drill' && !done;
  const pct = userMovesTotal ? (userMovesDone / userMovesTotal) * 100 : 0;

  const movePairs = useMemo(() => {
    const out: Array<{ num: number; w?: { san: string; idx: number }; b?: { san: string; idx: number } }> = [];
    hist.forEach((h, i) => {
      if (i === 0 || !h.san) return;
      const plyNo = i - 1;
      const num = Math.floor(plyNo / 2) + 1;
      if (plyNo % 2 === 0) out.push({ num, w: { san: h.san, idx: i } });
      else if (out.length && out[out.length - 1].num === num) out[out.length - 1].b = { san: h.san, idx: i };
      else out.push({ num, b: { san: h.san, idx: i } });
    });
    return out;
  }, [hist]);
  const activeIdx = viewIdx ?? ply;

  return (
    <div className="board-page">
      <div className="board-main" ref={fitRef}>
        <div className="board-head" style={{ width: boardSize }}>
          <button type="button" className="link-btn" onClick={onBack}>← Courses</button>
          <div className="bh-title">
            <strong>{course.name}</strong>
            <span>{hideLineName ? 'Mystery line' : line.name}</span>
          </div>
          <span className={`side-pill ${userColor}`}>{userColor === 'white' ? 'You play White' : 'You play Black'}</span>
        </div>

        <div className="board-stage">
          <Board
            board={boardState.board}
            selectedPos={viewIdx === null ? selected : null}
            validMoves={validMoves}
            lastMove={shown.move}
            checkSquare={checkSquareOf(boardState)}
            isCheckmate={boardState.isCheckmate}
            currentTurn={boardState.currentTurn}
            onSquareClick={onSquareClick}
            onMove={onDragMove}
            canDrag={pos => canInteract && boardState.board[pos.row][pos.col]?.color === userColor}
            onResize={n => setSetting('boardMax', n)}
            overlay={<>{spottingOverlay}{wrongFlash}</>}
            arrows={hintArrow && viewIdx === null ? [hintArrow] : []}
            boardSize={boardSize}
            flipped={flipped}
            hidePieceAt={viewIdx === null ? (animPiece?.to ?? null) : null}
            animOverlay={animPiece && viewIdx === null ? (
              <AnimatedPiece anim={animPiece} boardSize={boardSize} flipped={flipped} onDone={() => setAnimPiece(null)} />
            ) : undefined}
          />
          {viewIdx !== null && (
            <button type="button" className="review-chip" onClick={() => setViewIdx(null)}>
              Reviewing move {viewIdx}/{ply} · back to live →
            </button>
          )}
        </div>

        <div className="board-toolbar" style={{ width: boardSize }}>
          <div className="progress-track slim"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
          <span className="tb-count">{userMovesDone}/{userMovesTotal}</span>
          <SpottingPanel modes={spottingModes} onChange={setSpottingModes} />
          <button type="button" className="tool-btn" onClick={() => setFlipOverride(f => !f)} title="Flip board (F)">⇅ Flip</button>
          <div className="tb-nav">
            <button type="button" className="tool-btn icon" title="Previous move (←)" disabled={activeIdx === 0} onClick={() => setViewIdx(v => Math.max(0, (v ?? ply) - 1))}>‹</button>
            <button type="button" className="tool-btn icon" title="Next move (→)" disabled={viewIdx === null} onClick={() => setViewIdx(v => (v === null || v + 1 >= ply ? null : v + 1))}>›</button>
          </div>
        </div>
      </div>

      <aside className="panel trainer-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Opening trainer</div>
            <h2 className="panel-title">{course.name}</h2>
          </div>
          <SettingsMenu />
        </div>

        <div className="segmented" role="tablist">
          {MODES.map(m => (
            <button key={m.key} type="button" role="tab" aria-selected={mode === m.key}
              className={mode === m.key ? 'on' : ''} onClick={() => switchMode(m.key)} title={m.blurb}>
              <span className="t">{m.icon} {m.label}</span>
              <span className="s">{counts[m.key]}/{total}</span>
            </button>
          ))}
        </div>

        <div className={`coach tone-${feedback.tone ?? 'info'}`}>
          <div className="avatar">♞</div>
          <div className="bubble">
            <p>{feedback.text}</p>
            {feedback.sub ? <span className="sub">{feedback.sub}</span> : null}
          </div>
        </div>

        {mode === 'drill' && (
          <div className="drill-stats">
            <span>Streak <strong>{streak}</strong></span>
            <span>Clean lines <strong>{drillDone}/{total}</strong></span>
          </div>
        )}

        {done && (
          <div className={`complete-banner fade-in-up${perfect ? ' perfect' : ''}`}>
            <div className="big">{perfect ? '✓ Perfect run' : '✓ Line complete'}</div>
            <div className="small">{line.name} · {userMovesTotal} moves</div>
            <div className="row">
              <button className="btn btn-primary" type="button" onClick={() => startLine(nextIdx(), mode)}>
                {mode === 'drill' ? 'Next random line' : 'Next line'} →
              </button>
              <button className="btn" type="button" onClick={() => startLine(lineIdx, mode)}>↻ Again</button>
            </div>
          </div>
        )}

        <div className="moves-card">
          {movePairs.length === 0
            ? <span className="empty">Moves will appear here.</span>
            : movePairs.map(p => (
              <span key={p.num} className="mp">
                <span className="num">{p.num}.</span>
                {p.w ? <button type="button" className={`mv${activeIdx === p.w.idx ? ' cur' : ''}`} onClick={() => setViewIdx(p.w!.idx === ply ? null : p.w!.idx)}>{renderSanForMoveList(p.w.san, 'w')}</button> : <span className="mv dim">…</span>}
                {p.b && <button type="button" className={`mv${activeIdx === p.b.idx ? ' cur' : ''}`} onClick={() => setViewIdx(p.b!.idx === ply ? null : p.b!.idx)}>{renderSanForMoveList(p.b.san, 'b')}</button>}
              </span>
            ))}
        </div>

        <div className="panel-actions">
          <button className="btn" type="button" onClick={onHint} disabled={done || !canInteract}>💡 Hint</button>
          <button className="btn" type="button" onClick={() => startLine(lineIdx, mode)}>↻ Restart</button>
          <button className="btn" type="button" onClick={() => onAnalysis(boardState)}>Analyse →</button>
        </div>

        <div className="section">
          <div className="section-head">
            <span>Lines</span>
            <span className="muted">{counts[mode]}/{total} {mode === 'learn' ? 'learned' : mode === 'practice' ? 'recalled' : 'clean'}</span>
          </div>
          <div className="lines-list">
            {course.lines.map((l, i) => {
              const isDone = !!progress[mode][l.id];
              return (
                <button key={l.id} className={`line-row${i === lineIdx ? ' current' : ''}`} type="button"
                  onClick={() => startLine(i, mode)}>
                  <span className={`st${isDone ? ' done' : ''}`}>{isDone ? '✓' : ''}</span>
                  <span className="nm">{mode === 'drill' && i === lineIdx && !done ? 'Mystery line' : l.name}</span>
                  <span className={`tg tg-${l.tag.toLowerCase()}`}>{l.tag}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="section">
          <button type="button" className="section-head toggleable" onClick={() => setShowBook(v => !v)} aria-expanded={showBook}>
            <span>Common moves</span>
            <span className="muted">{showBook ? '▾' : '▸'}</span>
          </button>
          {showBook && (
            <>
              <BookFilters />
              <CommonMoves rows={bookRows} loading={bookLoading} onPlay={(san) => {
                if (!canInteract) return;
                const book = resolvePly(stateRef.current, { san });
                if (book) attemptMove(book.from, book.to);
              }} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

