import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameState, Position } from '../chess/types';
import { createInitialState, executeMove, findKing } from '../chess/logic';
import { makeQuestion, VISION_TASKS, type VisionQuestion, type VisionTask } from '../chess/vision';
import { resolvePly } from '../board/topArrows';
import Board from '../components/Board';
import SettingsMenu from '../components/SettingsMenu';
import { useSettings } from '../settings/useSettings';
import { useFitBoardSize } from '../board/useBoardLayout';
import type { Course } from '../courses/useCourses';

interface Props {
  courses: Record<string, Course>;
  onAnalysis: (s: GameState) => void;
}

const TIMES = [10, 20, 30, 0]; // 0 = no clock
const BEST_KEY = 'laionchess-vision-best';
const key = (p: Position) => `${p.row},${p.col}`;

interface Result { correct: Position[]; wrong: Position[]; missed: Position[]; points: number; perfect: boolean }

/** Every position reached in the courses from move 4 on — realistic, varied material. */
function buildPool(courses: Record<string, Course>): GameState[] {
  const pool: GameState[] = [];
  for (const c of Object.values(courses)) for (const line of c.lines) {
    let s = createInitialState();
    line.plies.forEach((ply, i) => {
      const mv = resolvePly(s, ply);
      if (!mv) return;
      s = executeMove(s, mv.from, mv.to, mv.promotionPiece);
      if (i >= 7) pool.push(s);
    });
  }
  return pool;
}

function loadBest(): { streak: number; score: number } {
  try { return { streak: 0, score: 0, ...JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') }; } catch { return { streak: 0, score: 0 }; }
}

export default function VisionView({ courses, onAnalysis }: Props) {
  const { settings, setSetting } = useSettings();
  const pool = useMemo(() => buildPool(courses), [courses]);
  const [tasks, setTasks] = useState<Set<VisionTask>>(new Set(['checks', 'captures', 'attacked', 'hanging']));
  const [time, setTime] = useState(20);
  const [q, setQ] = useState<VisionQuestion | null>(null);
  const [marks, setMarks] = useState<Position[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [left, setLeft] = useState(20);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [rounds, setRounds] = useState({ played: 0, perfect: 0 });
  const [best, setBest] = useState(loadBest);
  const startedAt = useRef(0);

  const next = useCallback(() => {
    const nq = makeQuestion(pool, [...tasks]);
    setQ(nq);
    setMarks([]);
    setResult(null);
    setLeft(time);
    startedAt.current = Date.now();
  }, [pool, tasks, time]);

  // First question once the courses are in.
  useEffect(() => { if (!q && pool.length) next(); }, [pool, q, next]);

  const check = useCallback(() => {
    if (!q || result) return;
    const ans = new Set(q.answer.map(key));
    const mk = new Set(marks.map(key));
    const correct = marks.filter(m => ans.has(key(m)));
    const wrong = marks.filter(m => !ans.has(key(m)));
    const missed = q.answer.filter(a => !mk.has(key(a)));
    const perfect = wrong.length === 0 && missed.length === 0;
    const secs = (Date.now() - startedAt.current) / 1000;
    const speed = perfect && time ? Math.max(0, Math.round((time - secs) * 2)) : 0;
    const points = Math.max(0, correct.length * 10 - wrong.length * 6 - missed.length * 4 + speed);
    setResult({ correct, wrong, missed, points, perfect });
    setScore(s => s + points);
    setRounds(r => ({ played: r.played + 1, perfect: r.perfect + (perfect ? 1 : 0) }));
    const n = perfect ? streak + 1 : 0;
    setStreak(n);
    if (n > best.streak) {
      const nb = { ...best, streak: n };
      setBest(nb);
      try { localStorage.setItem(BEST_KEY, JSON.stringify(nb)); } catch { /* ignore */ }
    }
  }, [q, result, marks, time, streak, best]);

  // Clock.
  useEffect(() => {
    if (!q || result || !time) return;
    if (left <= 0) { check(); return; }
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [q, result, left, time, check]);

  // Enter = check / next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'BUTTON')) return;
      if (e.key === 'Enter') { e.preventDefault(); if (result) next(); else check(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, next, check]);

  const toggleMark = (p: Position) => {
    if (result) return;
    setMarks(m => (m.some(x => key(x) === key(p)) ? m.filter(x => key(x) !== key(p)) : [...m, p]));
  };

  const flipped = q?.state.currentTurn === 'black';
  const { ref: fitRef, size: boardSize } = useFitBoardSize(settings.boardMax, { reserveHeight: 170 });

  const overlay = useMemo(() => {
    if (!q) return null;
    const cell = (p: Position, cls: string, sym?: string) => (
      <div key={`${cls}${key(p)}`} className={`vz-mark ${cls}`} style={{ left: `${p.col * 12.5}%`, top: `${p.row * 12.5}%` }}>
        {sym && <span style={flipped ? { transform: 'rotate(180deg)' } : undefined}>{sym}</span>}
      </div>
    );
    if (!result) return <>{marks.map(m => cell(m, 'picked'))}</>;
    return (
      <>
        {result.correct.map(p => cell(p, 'ok', '✓'))}
        {result.wrong.map(p => cell(p, 'bad', '✕'))}
        {result.missed.map(p => cell(p, 'miss', '!'))}
      </>
    );
  }, [q, marks, result, flipped]);

  const taskInfo = q ? VISION_TASKS.find(t => t.key === q.task)! : null;
  const accuracy = rounds.played ? Math.round((rounds.perfect / rounds.played) * 100) : null;
  const pct = time ? (left / time) * 100 : 100;

  return (
    <div className="board-page">
      <div className="board-main" ref={fitRef}>
        <div className="board-head" style={{ width: boardSize }}>
          <div className="bh-title">
            <strong>Board vision</strong>
            <span>{taskInfo ? `${taskInfo.icon} ${taskInfo.label}` : 'Loading positions…'}</span>
          </div>
          <span className="streak-chip" title={`Best streak ${best.streak}`}>🔥 {streak}</span>
        </div>

        {q && <div className={`vz-prompt${result ? (result.perfect ? ' ok' : ' bad') : ''}`} style={{ width: boardSize }}>{q.prompt}</div>}

        <div className="board-stage">
          {q ? (
            <Board
              board={q.state.board}
              selectedPos={null}
              validMoves={[]}
              lastMove={q.lastMove}
              checkSquare={q.state.isCheck ? findKing(q.state.board, q.state.currentTurn) : null}
              currentTurn={q.state.currentTurn}
              onSquareClick={toggleMark}
              onResize={n => setSetting('boardMax', n)}
              overlay={overlay}
              boardSize={boardSize}
              flipped={flipped}
            />
          ) : <div className="vz-empty" style={{ width: boardSize, height: boardSize }}>Loading positions from the courses…</div>}
          {result && (
            <div className={`board-result compact fade-in-up${result.perfect ? ' perfect' : ''}`}>
              <div className="br-title">{result.perfect ? 'Perfect!' : `${result.correct.length}/${q!.answer.length} found`}</div>
              <div className="br-sub">
                {result.wrong.length ? `${result.wrong.length} wrong · ` : ''}{result.missed.length ? `${result.missed.length} missed · ` : ''}+{result.points} pts
              </div>
              <div className="br-actions">
                <button className="btn btn-primary" type="button" onClick={next} autoFocus>Next →</button>
                <button className="btn" type="button" onClick={() => q && onAnalysis(q.state)}>Analyse</button>
              </div>
            </div>
          )}
        </div>

        <div className="board-toolbar" style={{ width: boardSize }}>
          <div className="progress-track slim vz-clock"><div className={`progress-fill${left <= 5 && time ? ' low' : ''}`} style={{ width: `${pct}%` }} /></div>
          <span className="tb-count">{time ? `${left}s` : '∞'}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={result ? next : check} disabled={!q}>
            {result ? 'Next →' : `Check (${marks.length})`}
          </button>
        </div>
      </div>

      <aside className="panel trainer-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Find it yourself</div>
            <h2 className="panel-title">Board vision</h2>
          </div>
          <SettingsMenu />
        </div>
        <p className="muted vz-intro">
          Strong players scan every position for <b>checks, captures and threats</b> before they move. Tap every square that answers the
          question, then press <b>Check</b>. Green = found, red = wrong, amber = missed.
        </p>

        <div className="drill-stats">
          <span>Score <strong>{score}</strong></span>
          <span>Streak <strong>{streak}</strong></span>
          <span>Best <strong>{best.streak}</strong></span>
          {accuracy !== null && <span>Perfect <strong>{accuracy}%</strong></span>}
        </div>

        <div className="section">
          <div className="section-head"><span>Questions</span><span className="muted">{tasks.size} selected</span></div>
          <div className="spot-grid">
            {VISION_TASKS.map(t => (
              <button key={t.key} type="button" className={`spot-card${tasks.has(t.key) ? ' on' : ''}`} aria-pressed={tasks.has(t.key)}
                onClick={() => setTasks(prev => {
                  const n = new Set(prev);
                  if (n.has(t.key)) { if (n.size > 1) n.delete(t.key); } else n.add(t.key);
                  return n;
                })}>
                <span className="ic">{t.icon}</span>
                <span className="nm">{t.label}<small>{t.blurb}</small></span>
              </button>
            ))}
          </div>
        </div>

        <div className="section">
          <div className="section-head"><span>Clock</span></div>
          <div className="segmented small">
            {TIMES.map(t => (
              <button key={t} type="button" className={time === t ? 'on' : ''} onClick={() => { setTime(t); setLeft(t); }}>
                <span className="t">{t ? `${t}s` : 'Off'}</span>
              </button>
            ))}
          </div>
        </div>
        <button className="btn" type="button" onClick={next}>↻ New position</button>
      </aside>
    </div>
  );
}
