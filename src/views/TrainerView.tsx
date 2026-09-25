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
import { ARROW } from '../board/arrowPalette';
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

const HINT_COLOR = ARROW.green;
const REVEAL_COLOR = ARROW.gold;
const OPPONENT_DELAY = 480;
/** Pause before a clean drill run rolls into the next random line. */
const AUTO_NEXT_MS = 1800;
/** A failed drill line comes back after this many other lines (spaced retry). */
const RETRY_GAP = 2;

interface SessionStats { lines: number; clean: number; correct: number; wrong: number }
const EMPTY_SESSION: SessionStats = { lines: 0, clean: 0, correct: 0, wrong: 0 };

function bestStreakKey(courseId: string) { return `laionchess-drill-best-${courseId}`; }
function loadBestStreak(courseId: string): number {
  try { return Number(localStorage.getItem(bestStreakKey(courseId))) || 0; } catch { return 0; }
}
function saveBestStreak(courseId: string, n: number) {
  try { localStorage.setItem(bestStreakKey(courseId), String(n)); } catch { /* ignore */ }
}

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
  const [bestStreak, setBestStreak] = useState(() => loadBestStreak(course.id));
  const [session, setSession] = useState<SessionStats>(EMPTY_SESSION);
  const [showBook, setShowBook] = useState(false);
  /** Progressive hint: glow on the piece that should move (before the full arrow). */
  const [pieceHint, setPieceHint] = useState<Position | null>(null);
  /** ✓ / ✗ badge on the square just played. */
  const [moveMark, setMoveMark] = useState<{ pos: Position; ok: boolean; key: number } | null>(null);
  /** The on-board result card can be dismissed to look at the final position. */
  const [resultHidden, setResultHidden] = useState(false);
  /** Auto-advance after a clean drill run (user can pause it). */
  const [autoNext, setAutoNext] = useState(true);

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
  const retryRef = useRef<Array<{ idx: number; due: number }>>([]);
  const drillPlayedRef = useRef(0);
  const markSeq = useRef(0);
  const streakRef = useRef(0);
  const bestStreakRef = useRef(bestStreak);
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
    // Spaced retry: a line you stumbled on comes back a couple of lines later.
    const due = retryRef.current.find(r => r.due <= drillPlayedRef.current && r.idx !== exclude);
    if (due) return due.idx;
    const queued = new Set(retryRef.current.map(r => r.idx));
    const all = course.lines.map((_, i) => i).filter(i => i !== exclude);
    const fresh = all.filter(i => !prog.drill[course.lines[i].id] && !queued.has(i));
    const rest = all.filter(i => !queued.has(i));
    const pool = fresh.length ? fresh : rest.length ? rest : all;
    return pool[Math.floor(Math.random() * pool.length)];
  }, [course.lines]);

  const flashMark = useCallback((pos: Position, ok: boolean) => {
    markSeq.current += 1;
    setMoveMark({ pos, ok, key: markSeq.current });
  }, []);

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
    if (m === 'drill') {
      drillPlayedRef.current += 1;
      const idx = lineIdxRef.current;
      retryRef.current = retryRef.current.filter(r => r.idx !== idx);
      if (!flawless) retryRef.current.push({ idx, due: drillPlayedRef.current + RETRY_GAP });
      setSession(s => ({ ...s, lines: s.lines + 1, clean: s.clean + (flawless ? 1 : 0) }));
      const nextStreak = flawless ? streakRef.current + 1 : 0;
      streakRef.current = nextStreak;
      setStreak(nextStreak);
      if (nextStreak > bestStreakRef.current) {
        bestStreakRef.current = nextStreak;
        setBestStreak(nextStreak);
        saveBestStreak(course.id, nextStreak);
      }
    }
    setFeedback({
      text: flawless
        ? 'Flawless — the line is yours.'
        : m === 'drill' ? 'Line complete. It will come back in a couple of lines for another try.' : 'Line complete. Run it again to make it stick.',
      sub: mk ? `${mk} mistake${mk > 1 ? 's' : ''}${hintUsedRef.current ? ' · hint used' : ''}` : (hintUsedRef.current ? 'Hint used' : 'No mistakes'),
      tone: flawless ? 'ok' : 'info',
    });
  }, [lineAt, course.id]);

  const promptUser = useCallback(() => {
    const ln = lineAt(lineIdxRef.current);
    const expected = ln.plies[plyRef.current];
    const mv = expected ? resolvePly(stateRef.current, expected) : null;
    plyMistakesRef.current = 0;
    setPieceHint(null);
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
    setPieceHint(null);
    setMoveMark(null);
    setResultHidden(false);
    setAutoNext(true);
    setFeedback({ text: m === 'drill' ? 'A random line from the course — play your repertoire.' : 'Get ready…', tone: 'info' });
    later(() => replyLoop(), 0);
  }, [clearTimers, replyLoop, later]);

  // (re)start whenever the course changes
  useEffect(() => {
    setProgress(loadProgress(course.id));
    setStreak(0);
    streakRef.current = 0;
    bestStreakRef.current = loadBestStreak(course.id);
    setBestStreak(bestStreakRef.current);
    setSession(EMPTY_SESSION);
    retryRef.current = [];
    drillPlayedRef.current = 0;
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
    setPieceHint(null);
    if (modeRef.current !== 'learn') {
      flashMark(mv.to, true);
      setSession(s => ({ ...s, correct: s.correct + 1 }));
    }
    setFeedback({ text: 'Correct.', tone: 'ok' });
    replyLoop();
  }, [commit, replyLoop, lineAt, flashMark]);

  const wrongMove = useCallback((sq: Position) => {
    mistakesRef.current += 1;
    plyMistakesRef.current += 1;
    setMistakes(mistakesRef.current);
    setSelected(null);
    setWrongSquare(sq);
    const expected = lineAt(lineIdxRef.current).plies[plyRef.current];
    const mv = expected ? resolvePly(stateRef.current, expected) : null;
    if (modeRef.current !== 'learn') {
      flashMark(sq, false);
      setSession(s => ({ ...s, wrong: s.wrong + 1 }));
    }
    if (modeRef.current === 'learn' && expected) {
      setFeedback({ text: 'Not quite — follow the arrow.', sub: `The move is ${expected.san}`, tone: 'bad' });
      if (mv) setHintArrow({ from: mv.from, to: mv.to, color: HINT_COLOR, width: 2.4 });
    } else if (plyMistakesRef.current >= 3 && expected && mv) {
      // Don't let the trainee get stuck: reveal after three misses.
      hintUsedRef.current = true;
      setHintUsed(true);
      setPieceHint(null);
      setFeedback({ text: `The repertoire move is ${expected.san}.`, sub: expected.note, tone: 'bad' });
      setHintArrow({ from: mv.from, to: mv.to, color: REVEAL_COLOR, width: 2.4 });
    } else if (plyMistakesRef.current === 2 && mv) {
      // Second miss: show which piece moves (Chessable / Chessbook style), not where.
      setPieceHint(mv.from);
      setFeedback({ text: 'Still not it — this piece moves.', sub: `${mistakesRef.current} mistakes · one more miss reveals the move`, tone: 'bad' });
    } else {
      setFeedback({ text: 'Not the repertoire move — try again.', sub: `${mistakesRef.current} mistake${mistakesRef.current > 1 ? 's' : ''}`, tone: 'bad' });
    }
    later(() => setWrongSquare(null), 480);
  }, [lineAt, later, flashMark]);

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
    // Outside Learn the first press only shows the piece; the second shows the move.
    if (modeRef.current !== 'learn' && !pieceHint && !hintArrow) {
      setPieceHint(mv.from);
      setFeedback({ text: 'Hint: this piece moves.', sub: 'Press Hint again to see the move', tone: 'info' });
      return;
    }
    setPieceHint(null);
    setHintArrow({ from: mv.from, to: mv.to, color: REVEAL_COLOR, width: 2.4 });
    setFeedback({ text: `Hint: ${expected.san}`, sub: expected.note, tone: 'info' });
  }, [lineAt, userColor, pieceHint, hintArrow]);

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
  const autoAdvancing = done && mode === 'drill' && mistakes === 0 && !hintUsed && autoNext;
  useEffect(() => {
    if (!autoAdvancing) return;
    const t = setTimeout(() => startLine(nextIdx(), 'drill'), AUTO_NEXT_MS);
    return () => clearTimeout(t);
  }, [autoAdvancing, nextIdx, startLine]);

  // ✓/✗ badges fade on their own.
  useEffect(() => {
    if (!moveMark) return;
    const t = setTimeout(() => setMoveMark(m => (m && m.key === moveMark.key ? null : m)), 900);
    return () => clearTimeout(t);
  }, [moveMark]);

  // Enter / Space → next line, R → again (only once the line is finished).
  useEffect(() => {
    if (!done) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable)) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startLine(nextIdx(), mode); }
      else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); startLine(lineIdx, mode); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, mode, lineIdx, nextIdx, startLine]);

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
  // Common Moves would give the drill answers away, so it's off until the line ends.
  const bookHidden = mode !== 'learn' && !done;
  const { rows: bookRows, loading: bookLoading, source: bookSource } = useOpeningExplorer(
    bookFen, settings.bookSpeeds, settings.bookRatings, showBook && !bookHidden,
  );
  const validMoves = canInteract && selected ? legalTargets(gameState, selected) : [];

  const sqStyle = (p: Position) => ({ left: `${p.col * 12.5}%`, top: `${p.row * 12.5}%` });
  const wrongFlash = wrongSquare ? <div className="wrong-flash" style={sqStyle(wrongSquare)} /> : null;
  const pieceGlow = pieceHint && viewIdx === null ? <div className="piece-hint" style={sqStyle(pieceHint)} /> : null;
  const markBadge = moveMark && viewIdx === null ? (
    <div key={moveMark.key} className={`move-mark ${moveMark.ok ? 'ok' : 'bad'}`} style={sqStyle(moveMark.pos)}>
      <span style={flipped ? { transform: 'rotate(180deg)' } : undefined}>{moveMark.ok ? '✓' : '✕'}</span>
    </div>
  ) : null;

  const { ref: fitRef, size: boardSize } = useFitBoardSize(settings.boardMax, { reserveHeight: 150 });

  const learnDone = countDone(progress, 'learn');
  const practiceDone = countDone(progress, 'practice');
  const drillDone = countDone(progress, 'drill');
  const counts: Record<TrainerMode, number> = { learn: learnDone, practice: practiceDone, drill: drillDone };
  const perfect = mistakes === 0 && !hintUsed;
  const attempts = session.correct + session.wrong;
  const accuracy = attempts ? Math.round((session.correct / attempts) * 100) : null;
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
            overlay={<>{spottingOverlay}{wrongFlash}{pieceGlow}{markBadge}</>}
            arrows={hintArrow && viewIdx === null ? [hintArrow] : []}
            boardSize={boardSize}
            flipped={flipped}
            hidePieceAt={viewIdx === null ? (animPiece?.to ?? null) : null}
            animOverlay={animPiece && viewIdx === null ? (
              <AnimatedPiece anim={animPiece} boardSize={boardSize} flipped={flipped} onDone={() => setAnimPiece(null)} />
            ) : undefined}
          />
          {done && viewIdx === null && !resultHidden && (
            <div className={`board-result fade-in-up${perfect ? ' perfect' : ''}`} role="dialog" aria-label="Line complete">
              <button type="button" className="br-close" title="Hide — look at the final position" onClick={() => setResultHidden(true)}>×</button>
              <div className="br-icon">{perfect ? '✓' : '↻'}</div>
              <div className="br-title">{perfect ? 'Perfect run' : 'Line complete'}</div>
              <div className="br-sub">
                {line.name}
                {mistakes ? ` · ${mistakes} mistake${mistakes > 1 ? 's' : ''}` : ''}
                {hintUsed ? ' · hint used' : ''}
              </div>
              {mode === 'drill' && (
                <div className="br-stats">
                  <span>🔥 <b>{streak}</b> streak</span>
                  <span>Best <b>{bestStreak}</b></span>
                  {accuracy !== null && <span><b>{accuracy}%</b> accuracy</span>}
                </div>
              )}
              <div className="br-actions">
                <button className="btn btn-primary" type="button" onClick={() => startLine(nextIdx(), mode)} autoFocus>
                  Next line →
                </button>
                <button className="btn" type="button" onClick={() => startLine(lineIdx, mode)}>↻ Again</button>
              </div>
              {autoAdvancing && (
                <div className="br-auto">
                  <div className="br-auto-bar" style={{ animationDuration: `${AUTO_NEXT_MS}ms` }} />
                  <button type="button" className="link-btn" onClick={() => setAutoNext(false)}>Stay on this position</button>
                </div>
              )}
            </div>
          )}
          {done && viewIdx === null && resultHidden && (
            <button type="button" className="review-chip" onClick={() => setResultHidden(false)}>
              {perfect ? '✓' : '↻'} Line complete · Next / Again
            </button>
          )}
          {viewIdx !== null && (
            <button type="button" className="review-chip" onClick={() => setViewIdx(null)}>
              Reviewing move {viewIdx}/{ply} · back to live →
            </button>
          )}
        </div>

        <div className="board-toolbar" style={{ width: boardSize }}>
          <div className="progress-track slim"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
          <span className="tb-count">{userMovesDone}/{userMovesTotal}</span>
          {mode === 'drill' && <span className="streak-chip" title={`Best streak: ${bestStreak}`}>🔥 {streak}</span>}
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
            <span>Best <strong>{bestStreak}</strong></span>
            <span>Session <strong>{session.clean}/{session.lines}</strong></span>
            {accuracy !== null && <span>Accuracy <strong>{accuracy}%</strong></span>}
            <span>Mastered <strong>{drillDone}/{total}</strong></span>
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
                <button key={l.id} className={`line-row${i === lineIdx && !hideLineName ? ' current' : ''}`} type="button"
                  onClick={() => startLine(i, mode)}>
                  <span className={`st${isDone ? ' done' : ''}`}>{isDone ? '✓' : ''}</span>
                  <span className="nm">{l.name}</span>
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
          {showBook && bookHidden && (
            <div className="book-empty">Hidden while you play the line — it would give the answers away.</div>
          )}
          {showBook && !bookHidden && (
            <>
              <BookFilters />
              <CommonMoves rows={bookRows} loading={bookLoading} source={bookSource} onPlay={(san) => {
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

