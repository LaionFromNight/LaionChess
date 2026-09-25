import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameState, PieceColor, PieceType, Position } from '../chess/types';
import { executeMove, findKing, getLegalMoves } from '../chess/logic';
import { parseFen, toFen } from '../chess/fen';
import { renderSanForMoveList } from '../chess/san';
import type { SpottingMode } from '../chess/analysis';
import { detectPlan } from '../chess/structures';
import Board, { type BoardArrow } from '../components/Board';
import SpottingPanel from '../components/SpottingPanel';
import SettingsMenu from '../components/SettingsMenu';
import AnimatedPiece, { type AnimPiece } from '../components/AnimatedPiece';
import PlanCardView from '../components/PlanCardView';
import { useSettings } from '../settings/useSettings';
import { buildSpottingOverlay } from '../board/spottingOverlay';
import { useBoardKeys, useFitBoardSize } from '../board/useBoardLayout';
import { ARROW } from '../board/arrowPalette';
import { SPARRING_LEVELS, sparringEngine, tablebase, type TbCategory } from '../board/sparringEngine';

export type SparringGoal = 'play' | 'win' | 'promote' | 'draw';

export interface SparringSetup {
  fen: string;
  you: PieceColor;
  title: string;
  subtitle?: string;
  goal: SparringGoal;
  /** Lesson / rule shown in the coach bubble. */
  lesson?: string;
  /** Show the pawn-structure plan card (used after an opening line). */
  showPlan?: boolean;
  /** Starting strength (index into SPARRING_LEVELS). */
  level?: number;
  /** Moves the defender must survive for a "draw" goal. */
  surviveMoves?: number;
}

interface Props {
  setup: SparringSetup;
  spottingModes: Set<SpottingMode>;
  setSpottingModes: (m: Set<SpottingMode>) => void;
  onBack: () => void;
  backLabel: string;
  onAnalysis: (state: GameState) => void;
  /** Called once per attempt when a goal is reached (true) or failed (false). */
  onComplete?: (success: boolean) => void;
}

interface Ply { state: GameState; move: { from: Position; to: Position } | null; san: string | null }
type Outcome = { kind: 'success' | 'fail' | 'over'; title: string; sub: string } | null;

const same = (a: Position | null | undefined, b: Position | null | undefined) => !!a && !!b && a.row === b.row && a.col === b.col;
const sqName = (p: Position) => `${'abcdefgh'[p.col]}${8 - p.row}`;
const fromUci = (s: string): Position => ({ col: s.charCodeAt(0) - 97, row: 8 - Number(s[1]) });
const PROMO: Record<string, PieceType> = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' };

function legalTargets(s: GameState, from: Position) {
  return getLegalMoves(s.board, from, s.enPassantTarget, s.whiteCanCastleKingside, s.whiteCanCastleQueenside, s.blackCanCastleKingside, s.blackCanCastleQueenside);
}

function material(s: GameState) {
  const out: Record<PieceColor, PieceType[]> = { white: [], black: [] };
  for (const row of s.board) for (const p of row) if (p && p.type !== 'king') out[p.color].push(p.type);
  return out;
}

function insufficient(s: GameState): boolean {
  const m = material(s);
  const weak = (l: PieceType[]) => l.length === 0 || (l.length === 1 && (l[0] === 'knight' || l[0] === 'bishop'));
  return weak(m.white) && weak(m.black);
}

const posKey = (s: GameState) => toFen(s).split(' ').slice(0, 4).join(' ');

/** Draw / mate detection for the final position of a game history. */
function terminal(hist: Ply[]): { result: 'mate' | 'stalemate' | 'insufficient' | 'repetition' | 'fifty'; loser?: PieceColor } | null {
  const s = hist[hist.length - 1].state;
  if (s.isCheckmate) return { result: 'mate', loser: s.currentTurn };
  if (s.isStalemate) return { result: 'stalemate' };
  if (insufficient(s)) return { result: 'insufficient' };
  if (s.halfmoveClock >= 100) return { result: 'fifty' };
  const k = posKey(s);
  if (hist.filter(h => posKey(h.state) === k).length >= 3) return { result: 'repetition' };
  return null;
}

const DRAW_TEXT: Record<string, string> = {
  stalemate: 'Stalemate', insufficient: 'Draw — insufficient material', repetition: 'Draw by repetition', fifty: 'Draw — 50-move rule',
};

export default function SparringView({ setup, spottingModes, setSpottingModes, onBack, backLabel, onAnalysis, onComplete }: Props) {
  const { settings, setSetting } = useSettings();
  const start = useMemo(() => parseFen(setup.fen), [setup.fen]);
  const [hist, setHist] = useState<Ply[]>(() => (start ? [{ state: start, move: null, san: null }] : []));
  const [level, setLevel] = useState(setup.level ?? 1);
  const [selected, setSelected] = useState<Position | null>(null);
  const [thinking, setThinking] = useState(false);
  const [anim, setAnim] = useState<AnimPiece | null>(null);
  const [hint, setHint] = useState<BoardArrow | null>(null);
  const [coach, setCoach] = useState<{ text: string; tone: 'info' | 'ok' | 'bad' }>({ text: setup.lesson ?? 'Your move.', tone: 'info' });
  const [tb, setTb] = useState<TbCategory>('unknown');
  const [flipOverride, setFlipOverride] = useState(false);
  const [cardHidden, setCardHidden] = useState(false);
  const [showPlan, setShowPlan] = useState(!!setup.showPlan);
  const gen = useRef(0); // bumps on restart/takeback so stale engine replies are dropped
  const tbRef = useRef<TbCategory>('unknown');

  const flipped = (setup.you === 'black') !== flipOverride;
  const cur = hist[hist.length - 1]?.state ?? start!;
  const startMove = start?.fullmoveNumber ?? 1;
  const survive = setup.surviveMoves ?? 25;

  // Reset when a new setup arrives.
  useEffect(() => {
    gen.current++;
    sparringEngine.cancel();
    setHist(start ? [{ state: start, move: null, san: null }] : []);
    setSelected(null); setHint(null); setAnim(null); setThinking(false); setCardHidden(false);
    setCoach({ text: setup.lesson ?? 'Your move.', tone: 'info' });
    setTb('unknown'); tbRef.current = 'unknown';
    setFlipOverride(false);
    setShowPlan(!!setup.showPlan);
    setLevel(setup.level ?? 1);
  }, [setup, start]);

  const plan = useMemo(() => (start ? detectPlan(start.board, setup.you) : null), [start, setup.you]);

  // ── outcome ──────────────────────────────────────────────────────────────────
  const outcome: Outcome = useMemo(() => {
    if (!hist.length) return null;
    const end = terminal(hist);
    const s = cur;
    // Promotion goal: the trainee has a queen that isn't just hanging to the king.
    if (setup.goal === 'promote') {
      const last = hist[hist.length - 1];
      const promoted = last.san?.includes('=') && s.currentTurn !== setup.you;
      if (promoted) return { kind: 'success', title: 'Pawn promoted!', sub: 'Technique complete — the rest is a basic mate.' };
    }
    if (setup.goal === 'draw' && !end) {
      const moves = s.fullmoveNumber - startMove;
      const oppPromoted = hist.some((h, i) => i > 0 && h.san?.includes('=') && hist[i - 1].state.currentTurn !== setup.you);
      if (oppPromoted) return { kind: 'fail', title: 'The pawn queened', sub: 'Look at the lesson and try again.' };
      if (moves >= survive) return { kind: 'success', title: 'Held!', sub: `You survived ${survive} moves with correct defence.` };
    }
    if (!end) return null;
    if (end.result === 'mate') {
      const youWon = end.loser !== setup.you;
      if (setup.goal === 'draw') return youWon ? { kind: 'success', title: 'You even won!', sub: 'Checkmate.' } : { kind: 'fail', title: 'Checkmated', sub: 'Try the defence again.' };
      if (setup.goal === 'play') return { kind: 'over', title: youWon ? 'You won by checkmate' : 'Checkmated', sub: '' };
      return youWon ? { kind: 'success', title: 'Checkmate!', sub: 'Goal reached.' } : { kind: 'fail', title: 'Checkmated', sub: 'Try again.' };
    }
    const txt = DRAW_TEXT[end.result];
    if (setup.goal === 'draw') return { kind: 'success', title: txt, sub: 'Goal reached — a draw.' };
    if (setup.goal === 'play') return { kind: 'over', title: txt, sub: '' };
    return { kind: 'fail', title: txt, sub: 'The win slipped away — try again.' };
  }, [hist, cur, setup.goal, setup.you, startMove, survive]);

  const over = !!outcome;
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (!outcome || outcome.kind === 'over') { if (!outcome) reported.current = null; return; }
    const tag = `${hist.length}:${outcome.kind}`;
    if (reported.current === tag) return;
    reported.current = tag;
    onComplete?.(outcome.kind === 'success');
  }, [outcome, hist.length, onComplete]);
  const userTurn = cur.currentTurn === setup.you && !over;

  // ── engine replies ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (over || cur.currentTurn === setup.you || !hist.length) return;
    const g = gen.current;
    setThinking(true);
    const t = setTimeout(async () => {
      const uci = await sparringEngine.bestMove(toFen(cur), SPARRING_LEVELS[level]);
      if (g !== gen.current) return;
      setThinking(false);
      if (!uci) return;
      const from = fromUci(uci.slice(0, 2)), to = fromUci(uci.slice(2, 4));
      const piece = cur.board[from.row][from.col];
      if (piece) setAnim({ piece, from, to });
      const next = executeMove(cur, from, to, uci[4] ? PROMO[uci[4]] : undefined);
      setHist(h => [...h, { state: next, move: { from, to }, san: next.moveHistory[next.moveHistory.length - 1]?.san ?? '' }]);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hist, over, level]);

  // ── tablebase feedback after the trainee's move (≤ 7 pieces) ─────────────────
  useEffect(() => {
    if (hist.length < 2) return;
    const last = hist[hist.length - 1];
    if (last.state.currentTurn === setup.you) return; // only right after our move
    let cancelled = false;
    tablebase(toFen(last.state)).then(cat => {
      if (cancelled || cat === 'unknown') return;
      // `cat` is for the opponent (side to move): their loss = our win.
      const ours: TbCategory = cat === 'loss' ? 'win' : cat === 'win' ? 'loss' : 'draw';
      const prev = tbRef.current;
      tbRef.current = ours;
      setTb(ours);
      if (setup.goal === 'play') return;
      if ((setup.goal === 'win' || setup.goal === 'promote') && ours !== 'win' && prev !== 'draw' && prev !== 'loss') {
        setCoach({ text: `Careful — ${last.san} lets the win slip (tablebase: ${ours}). Take it back and find another move.`, tone: 'bad' });
      } else if (setup.goal === 'draw' && ours === 'loss' && prev !== 'loss') {
        setCoach({ text: `${last.san} loses by force (tablebase). Take it back and look for the drawing move.`, tone: 'bad' });
      } else if (ours === (setup.goal === 'draw' ? 'draw' : 'win')) {
        setCoach({ text: 'Good move — still on track (tablebase).', tone: 'ok' });
      }
    });
    return () => { cancelled = true; };
  }, [hist, setup.you, setup.goal]);

  // ── user moves ───────────────────────────────────────────────────────────────
  const play = useCallback((from: Position, to: Position) => {
    if (!userTurn) return false;
    if (!legalTargets(cur, from).some(t => same(t, to))) return false;
    const piece = cur.board[from.row][from.col];
    if (!piece) return false;
    const promo = piece.type === 'pawn' && (to.row === 0 || to.row === 7) ? 'queen' : undefined;
    setAnim({ piece, from, to });
    const next = executeMove(cur, from, to, promo);
    setHist(h => [...h, { state: next, move: { from, to }, san: next.moveHistory[next.moveHistory.length - 1]?.san ?? '' }]);
    setSelected(null);
    setHint(null);
    return true;
  }, [cur, userTurn]);

  const onSquareClick = (pos: Position) => {
    if (!userTurn) return;
    const p = cur.board[pos.row][pos.col];
    if (selected) {
      if (same(selected, pos)) { setSelected(null); return; }
      if (p && p.color === setup.you) { setSelected(pos); return; }
      if (!play(selected, pos)) setSelected(null);
      return;
    }
    if (p && p.color === setup.you) setSelected(pos);
  };

  const restart = () => {
    gen.current++;
    sparringEngine.cancel();
    setHist(start ? [{ state: start, move: null, san: null }] : []);
    setSelected(null); setHint(null); setThinking(false); setCardHidden(false); setTb('unknown'); tbRef.current = 'unknown';
    setCoach({ text: setup.lesson ?? 'Your move.', tone: 'info' });
  };

  const takeback = () => {
    gen.current++;
    sparringEngine.cancel();
    setThinking(false);
    setHint(null);
    setCardHidden(false);
    setHist(h => {
      let n = h.length;
      // Remove plies until it's our move again (at least one of ours).
      while (n > 1) {
        n--;
        if (h[n - 1].state.currentTurn === setup.you) break;
      }
      return h.slice(0, Math.max(1, n));
    });
    setCoach({ text: 'Move taken back — your turn.', tone: 'info' });
  };

  const askHint = async () => {
    if (!userTurn) return;
    const g = gen.current;
    setCoach({ text: 'Thinking about a hint…', tone: 'info' });
    const uci = await sparringEngine.bestMove(toFen(cur), SPARRING_LEVELS[SPARRING_LEVELS.length - 1]);
    if (g !== gen.current || !uci) return;
    const from = fromUci(uci.slice(0, 2)), to = fromUci(uci.slice(2, 4));
    setHint({ from, to, color: ARROW.gold, width: 2.4 });
    setCoach({ text: `Hint: ${sqName(from)} → ${sqName(to)}.`, tone: 'info' });
  };

  useBoardKeys({ flip: () => setFlipOverride(f => !f) });

  const { ref: fitRef, size: boardSize } = useFitBoardSize(settings.boardMax, { reserveHeight: 150 });
  const overlay = useMemo(() => buildSpottingOverlay(spottingModes, cur, flipped), [spottingModes, cur, flipped]);
  const last = hist[hist.length - 1];
  const checkSq = cur.isCheck ? findKing(cur.board, cur.currentTurn) : null;
  const validMoves = userTurn && selected ? legalTargets(cur, selected) : [];

  const pairs = useMemo(() => {
    const out: Array<{ num: number; w?: string; b?: string }> = [];
    hist.forEach((h, i) => {
      if (i === 0 || !h.san) return;
      const mover = hist[i - 1].state.currentTurn;
      const num = hist[i - 1].state.fullmoveNumber;
      if (mover === 'white') out.push({ num, w: h.san });
      else if (out.length && out[out.length - 1].num === num && !out[out.length - 1].b) out[out.length - 1].b = h.san;
      else out.push({ num, b: h.san });
    });
    return out;
  }, [hist]);

  if (!start) return <div className="page-shell-msg">Invalid position.</div>;

  const goalText = {
    play: 'Play the position out against Stockfish.',
    win: 'Goal: checkmate.',
    promote: 'Goal: promote your pawn.',
    draw: `Goal: hold the draw (${survive} moves, or reach a drawn position).`,
  }[setup.goal];
  const tbLabel = tb === 'unknown' ? null : tb === 'win' ? 'Tablebase: winning' : tb === 'draw' ? 'Tablebase: draw' : 'Tablebase: losing';

  return (
    <div className="board-page">
      <div className="board-main" ref={fitRef}>
        <div className="board-head" style={{ width: boardSize }}>
          <button type="button" className="link-btn" onClick={onBack}>← {backLabel}</button>
          <div className="bh-title">
            <strong>{setup.title}</strong>
            <span>{setup.subtitle ?? goalText}</span>
          </div>
          <span className={`side-pill ${setup.you}`}>{setup.you === 'white' ? 'You play White' : 'You play Black'}</span>
        </div>

        <div className="board-stage">
          <Board
            board={cur.board}
            selectedPos={selected}
            validMoves={validMoves}
            lastMove={last?.move ?? null}
            checkSquare={checkSq}
            isCheckmate={cur.isCheckmate}
            currentTurn={cur.currentTurn}
            onSquareClick={onSquareClick}
            onMove={(f, t) => { if (!play(f, t)) setSelected(null); }}
            canDrag={p => userTurn && cur.board[p.row][p.col]?.color === setup.you}
            onResize={n => setSetting('boardMax', n)}
            overlay={overlay}
            arrows={hint ? [hint] : []}
            boardSize={boardSize}
            flipped={flipped}
            hidePieceAt={anim?.to ?? null}
            animOverlay={anim ? <AnimatedPiece anim={anim} boardSize={boardSize} flipped={flipped} onDone={() => setAnim(null)} /> : undefined}
          />
          {outcome && !cardHidden && (
            <div className={`board-result fade-in-up${outcome.kind === 'success' ? ' perfect' : ''}`} role="dialog">
              <button type="button" className="br-close" title="Hide" onClick={() => setCardHidden(true)}>×</button>
              <div className="br-icon">{outcome.kind === 'success' ? '✓' : outcome.kind === 'fail' ? '✕' : '■'}</div>
              <div className="br-title">{outcome.title}</div>
              {outcome.sub && <div className="br-sub">{outcome.sub}</div>}
              <div className="br-actions">
                <button className="btn btn-primary" type="button" onClick={restart} autoFocus>↻ Try again</button>
                {outcome.kind === 'fail'
                  ? <button className="btn" type="button" onClick={takeback}>↶ Take back</button>
                  : <button className="btn" type="button" onClick={onBack}>{backLabel} →</button>}
              </div>
            </div>
          )}
          {outcome && cardHidden && (
            <button type="button" className="review-chip" onClick={() => setCardHidden(false)}>{outcome.title} · show result</button>
          )}
        </div>

        <div className="board-toolbar" style={{ width: boardSize }}>
          <span className={`turn-chip${thinking ? ' thinking' : ''}`}>
            {over ? 'Game over' : thinking ? 'Stockfish is thinking…' : userTurn ? 'Your move' : '…'}
          </span>
          <SpottingPanel modes={spottingModes} onChange={setSpottingModes} />
          <button type="button" className="tool-btn" onClick={() => setFlipOverride(f => !f)} title="Flip board (F)">⇅ Flip</button>
        </div>
      </div>

      <aside className="panel trainer-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">{setup.goal === 'play' ? 'Play it out' : 'Endgame trainer'}</div>
            <h2 className="panel-title">{setup.title}</h2>
          </div>
          <SettingsMenu />
        </div>

        <div className={`coach tone-${coach.tone}`}>
          <div className="avatar">♞</div>
          <div className="bubble">
            <p>{coach.text}</p>
            <span className="sub">{goalText}{tbLabel ? ` · ${tbLabel}` : ''}</span>
          </div>
        </div>

        <div className="section">
          <div className="section-head"><span>Opponent strength</span><span className="muted">Stockfish</span></div>
          <div className="segmented small">
            {SPARRING_LEVELS.map((l, i) => (
              <button key={l.label} type="button" className={i === level ? 'on' : ''} onClick={() => setLevel(i)}>
                <span className="t">{l.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="moves-card">
          {pairs.length === 0
            ? <span className="empty">{setup.you === cur.currentTurn ? 'Make your first move.' : 'Stockfish moves first.'}</span>
            : pairs.map(p => (
              <span key={p.num} className="mp">
                <span className="num">{p.num}.</span>
                {p.w ? <span className="mv">{renderSanForMoveList(p.w, 'w')}</span> : <span className="mv dim">…</span>}
                {p.b && <span className="mv">{renderSanForMoveList(p.b, 'b')}</span>}
              </span>
            ))}
        </div>

        <div className="panel-actions">
          <button className="btn" type="button" onClick={askHint} disabled={!userTurn}>💡 Hint</button>
          <button className="btn" type="button" onClick={takeback} disabled={hist.length < 2}>↶ Take back</button>
          <button className="btn" type="button" onClick={restart}>↻ Restart</button>
        </div>
        <button className="btn btn-sm" type="button" onClick={() => onAnalysis(cur)}>Analyse this position →</button>

        {plan && setup.showPlan && (
          <div className="section">
            <button type="button" className="section-head toggleable" onClick={() => setShowPlan(v => !v)} aria-expanded={showPlan}>
              <span>Middlegame plan</span><span className="muted">{showPlan ? '▾' : '▸'}</span>
            </button>
            {showPlan && <PlanCardView plan={plan} />}
          </div>
        )}
      </aside>
    </div>
  );
}
