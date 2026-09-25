import { useEffect, useRef, useState } from 'react';
import type { SpottingMode } from '../chess/analysis';
import { OV } from '../board/spottingOverlay';

interface SpottingPanelProps {
  modes: Set<SpottingMode>;
  onChange: (modes: Set<SpottingMode>) => void;
}

interface OverlayDef {
  key: SpottingMode;
  label: string;
  icon: string;
  /** The principle behind it, in one line. */
  hint: string;
  /** Colour legend shown while the overlay is on. */
  legend: Array<[string, string]>;
}

const GROUPS: Array<{ title: string; blurb: string; items: OverlayDef[] }> = [
  {
    title: 'Tactics',
    blurb: 'Checks, captures, threats — scan these before every move.',
    items: [
      { key: 'hanging', label: 'Hanging pieces', icon: '⚠', hint: 'Pieces that lose material to a capture (exchange count)',
        legend: [[OV.bad, 'you lose it (−value)'], [OV.good, 'you can win it (+value)'], [OV.warn, 'attacked but held (attackers:defenders)']] },
      { key: 'loose', label: 'Loose pieces', icon: '◌', hint: '“Loose pieces drop off” — undefended pieces are tactical targets',
        legend: [[OV.warn, 'no defender']] },
      { key: 'checks', label: 'Checks', icon: '+', hint: 'Every check the side to move has',
        legend: [[OV.good, 'safe check'], [OV.violet, 'checking piece can be taken']] },
      { key: 'king-safety', label: 'King safety & pins', icon: '♔', hint: 'Enemy pressure around each king, escape squares and pinned pieces',
        legend: [[OV.bad, 'attacked king square (count)'], [OV.good, 'escape square'], [OV.violet, 'pinned piece']] },
    ],
  },
  {
    title: 'Position',
    blurb: 'Structure, space and activity — what to aim for when there are no tactics.',
    items: [
      { key: 'control-balance', label: 'Square control', icon: '▦', hint: 'Who controls each square, and by how much',
        legend: [[OV.white, 'White controls'], [OV.black, 'Black controls'], [OV.violet, 'contested evenly']] },
      { key: 'control-white', label: 'White’s control', icon: '▤', hint: 'Every square White attacks (count)',
        legend: [[OV.white, 'attacked by White']] },
      { key: 'control-black', label: 'Black’s control', icon: '▥', hint: 'Every square Black attacks (count)',
        legend: [[OV.black, 'attacked by Black']] },
      { key: 'protection', label: 'Protection map', icon: '🛡', hint: 'Which pieces defend which, and how many times',
        legend: [[OV.white, 'White defender links'], [OV.black, 'Black defender links']] },
      { key: 'pawns', label: 'Pawn structure', icon: '♙', hint: 'Passed, isolated, doubled and backward pawns',
        legend: [[OV.good, 'P passed'], [OV.bad, 'I isolated'], [OV.warn, 'D doubled'], [OV.violet, 'B backward']] },
      { key: 'outposts', label: 'Outposts', icon: '◆', hint: 'Pawn-supported squares no enemy pawn can attack — ideal for knights',
        legend: [[OV.white, 'White outpost'], [OV.black, 'Black outpost']] },
      { key: 'files', label: 'Open files', icon: '⇕', hint: 'Open and half-open files — where the rooks belong',
        legend: [[OV.good, 'open'], [OV.white, 'half-open for White'], [OV.black, 'half-open for Black']] },
      { key: 'development', label: 'Opening principles', icon: '♘', hint: 'Develop minors, castle, don’t bring the queen out early, fight for the centre',
        legend: [[OV.white, 'undeveloped (dev)'], [OV.bad, 'not castled yet'], [OV.warn, 'early queen']] },
      { key: 'activity', label: 'Piece activity', icon: '⚡', hint: 'Legal moves per piece — improve your worst piece',
        legend: [[OV.good, 'active'], [OV.warn, 'average'], [OV.bad, 'passive (≤2 moves)'], [OV.violet, 'bad bishop']] },
    ],
  },
  {
    title: 'Endgame',
    blurb: 'King-and-pawn geometry every player should see at a glance.',
    items: [
      { key: 'pawn-square', label: 'Rule of the square', icon: '▢', hint: 'Can the king catch the passed pawn? Step into the square and it can',
        legend: [[OV.good, 'king catches it'], [OV.bad, 'pawn runs through']] },
      { key: 'key-squares', label: 'Key squares & opposition', icon: '⚿', hint: 'Pawn endings: the king squares that force promotion, and who holds the opposition',
        legend: [[OV.white, 'White key square / opposition'], [OV.black, 'Black key square / opposition']] },
    ],
  },
];

const ALL = GROUPS.flatMap(g => g.items);
export const MAX_ON = 3;

/** Board overlays — a toolbar button with a grouped popover and a live legend. */
export default function SpottingPanel({ modes, onChange }: SpottingPanelProps) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Up to MAX_ON overlays at once — more than that turns the board into noise.
  // Turning on another one drops the oldest.
  const toggle = (key: SpottingMode) => {
    const list = [...modes];
    if (modes.has(key)) { onChange(new Set(list.filter(k => k !== key))); return; }
    onChange(new Set([...list, key].slice(-MAX_ON)));
  };

  const active = ALL.filter(o => modes.has(o.key));
  const count = active.length;

  return (
    <div className="popover-host" ref={hostRef}>
      <button
        type="button"
        className={`tool-btn${count ? ' on' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        title="Board overlays: tactics and positional patterns"
      >
        <span aria-hidden>◎</span> Overlays{count ? <span className="badge">{count}</span> : null}
      </button>
      {open && (
        <div className="popover spot-popover">
          <div className="spot-head">
            <span className="popover-title">Board overlays <small className="muted">· up to {MAX_ON} at once</small></span>
            {count > 0 && <button type="button" className="link-btn" onClick={() => onChange(new Set())}>Clear all</button>}
          </div>
          {GROUPS.map(g => (
            <div key={g.title} className="spot-group">
              <div className="popover-sub">{g.title}<small>{g.blurb}</small></div>
              <div className="spot-grid">
                {g.items.map(m => (
                  <button key={m.key} type="button" aria-pressed={modes.has(m.key)}
                    className={`spot-card${modes.has(m.key) ? ' on' : ''}`} onClick={() => toggle(m.key)} title={m.hint}>
                    <span className="ic" aria-hidden>{m.icon}</span>
                    <span className="nm">{m.label}<small>{m.hint}</small></span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {count > 0 && (
            <div className="spot-legend">
              {active.map(o => (
                <div key={o.key} className="lg-row">
                  <b>{o.label}</b>
                  {o.legend.map(([c, t]) => <span key={t}><i style={{ background: c }} />{t}</span>)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
