import { useState } from 'react';
import { ENDGAMES, type EndgameDef } from '../data/endgames';
import { parseFen } from '../chess/fen';
import { BOARD_THEMES, useSettings } from '../settings/useSettings';
import { pieceSrc } from '../board/pieceSrc';
import { getPieceLabel } from '../chess/logic';

const DONE_KEY = 'laionchess-endgames-done';
export function loadEndgamesDone(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(DONE_KEY) ?? '{}'); } catch { return {}; }
}
export function markEndgameDone(id: string) {
  const d = loadEndgamesDone();
  d[id] = true;
  try { localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch { /* ignore */ }
}

const GOAL_LABEL = { win: 'Checkmate', promote: 'Promote', draw: 'Hold the draw' } as const;

function Mini({ fen, flipped }: { fen: string; flipped: boolean }) {
  const { settings } = useSettings();
  const theme = BOARD_THEMES[settings.boardTheme] ?? BOARD_THEMES.classic;
  const s = parseFen(fen);
  if (!s) return null;
  const rows = flipped ? [...s.board].reverse().map(r => [...r].reverse()) : s.board;
  return (
    <div className="mini-board" aria-hidden="true">
      {rows.map((row, r) => row.map((p, c) => {
        const src = p ? pieceSrc(settings.pieceSet, p.color, p.type) : null;
        return (
          <span key={`${r}${c}`} style={{ background: (r + c) % 2 ? theme.dark : theme.light }}>
            {p && (src ? <img src={src} alt="" /> : <i>{getPieceLabel(p)}</i>)}
          </span>
        );
      }))}
    </div>
  );
}

export default function EndgamesView({ onStart }: { onStart: (e: EndgameDef) => void }) {
  const [done] = useState(loadEndgamesDone);
  const groups = [...new Set(ENDGAMES.map(e => e.group))];
  const total = ENDGAMES.length, solved = ENDGAMES.filter(e => done[e.id]).length;
  return (
    <main className="catalog-view">
      <div className="page-head">
        <div>
          <span className="eyebrow">Technique</span>
          <h1>Essential endgames</h1>
          <p className="lead">The positions every player must know — play them against Stockfish until the technique is automatic. The Lichess tablebase tells you the moment a move spoils the result.</p>
        </div>
        <div className="stat-box"><strong>{solved}<span>/{total}</span></strong><span>solved</span></div>
      </div>
      {groups.map(g => (
        <section key={g} className="eg-group">
          <h2 className="eg-title">{g}</h2>
          <div className="course-grid">
            {ENDGAMES.filter(e => e.group === g).map(e => (
              <button key={e.id} type="button" className="course-card eg-card" onClick={() => onStart(e)}>
                <div className="mini"><Mini fen={e.fen} flipped={e.you === 'black'} /></div>
                <div className="body">
                  <div className="ttl">
                    <h3>{e.name}</h3>
                    <span className={`eg-goal ${e.goal}${done[e.id] ? ' done' : ''}`}>{done[e.id] ? '✓ ' : ''}{GOAL_LABEL[e.goal]}</span>
                  </div>
                  <p className="desc">{e.lesson}</p>
                  <div className="foot"><span className={`side-pill ${e.you}`}>{e.you === 'white' ? 'You play White' : 'You play Black'}</span></div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
