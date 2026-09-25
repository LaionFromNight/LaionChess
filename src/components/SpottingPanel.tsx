import { useEffect, useRef, useState } from 'react';
import type { SpottingMode } from '../chess/analysis';

interface SpottingPanelProps {
  modes: Set<SpottingMode>;
  onChange: (modes: Set<SpottingMode>) => void;
}

const TOP_MODES: Array<{ key: SpottingMode; label: string; icon: string; hint: string }> = [
  { key: 'dalmacja',  label: 'Dalmacja',  icon: '⬡', hint: 'Defence network' },
  { key: 'lufycfer',  label: 'Lucyfer',   icon: '⚡', hint: 'Exchanges & hanging pieces' },
  { key: 'king-path', label: 'King Path', icon: '♔', hint: 'King escape squares' },
  { key: 'king-shot', label: 'King Shot', icon: '⚔', hint: 'Checking moves' },
];

const LAION_MODES: Array<{ key: SpottingMode; label: string }> = [
  { key: 'eye-black', label: 'Black' },
  { key: 'eye-white', label: 'White' },
  { key: 'eye-1',     label: 'Attack' },
  { key: 'eye-2',     label: 'Passive' },
  { key: 'eye-full',  label: 'Full' },
];

/** Board overlay ("spotting") modes — a compact toolbar button with a popover. */
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

  const toggle = (key: SpottingMode) => {
    const next = new Set(modes);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };

  const count = modes.size;

  return (
    <div className="popover-host" ref={hostRef}>
      <button
        type="button"
        className={`tool-btn${count ? ' on' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        title="Board overlays"
      >
        <span aria-hidden>◎</span> Overlays{count ? <span className="badge">{count}</span> : null}
      </button>
      {open && (
        <div className="popover spot-popover">
          <div className="popover-title">Overlays</div>
          <button type="button" className={`opt-row${count === 0 ? ' on' : ''}`} onClick={() => onChange(new Set())}>
            <span className="ic">◉</span><span className="nm">None</span>
          </button>
          {TOP_MODES.map(m => (
            <button key={m.key} type="button" className={`opt-row${modes.has(m.key) ? ' on' : ''}`} onClick={() => toggle(m.key)}>
              <span className="ic">{m.icon}</span>
              <span className="nm">{m.label}<small>{m.hint}</small></span>
              <span className="ck">{modes.has(m.key) ? '✓' : ''}</span>
            </button>
          ))}
          <div className="popover-sub">Laion Eye</div>
          <div className="chip-row">
            {LAION_MODES.map(m => (
              <button key={m.key} type="button" className={`chip${modes.has(m.key) ? ' on' : ''}`} onClick={() => toggle(m.key)}>{m.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
