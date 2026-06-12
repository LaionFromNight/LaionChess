import { useEffect, useRef, useState } from 'react';
import {
  useSettings, BOARD_THEMES, PIECE_SETS, ACCENT_SWATCHES,
  type BoardTheme, type PieceSet,
} from '../settings/useSettings';

interface SettingsMenuProps {
  /** Which sections to render. Defaults to all. */
  sections?: Array<'board' | 'pieces' | 'accent' | 'toggles'>;
}

function Check({ on }: { on: boolean }) {
  return <span className="check">{on ? '✓' : ''}</span>;
}

export default function SettingsMenu({
  sections = ['board', 'pieces', 'accent', 'toggles'],
}: SettingsMenuProps) {
  const { settings, setSetting } = useSettings();
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [open]);

  return (
    <div className="menu-host" ref={hostRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-icon btn-ghost"
        title="Settings"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
      >⚙</button>

      {open && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          {sections.includes('board') && (
            <>
              <div className="menu-section">Board Theme</div>
              {(Object.keys(BOARD_THEMES) as BoardTheme[]).map(key => (
                <button
                  key={key} type="button" className="menu-item"
                  onClick={() => { setSetting('boardTheme', key); setOpen(false); }}
                >
                  <span>{BOARD_THEMES[key].label}</span>
                  <Check on={settings.boardTheme === key} />
                </button>
              ))}
              <hr className="menu-hr" />
            </>
          )}

          {sections.includes('pieces') && (
            <>
              <div className="menu-section">Piece Set</div>
              {(Object.keys(PIECE_SETS) as PieceSet[]).map(key => (
                <button
                  key={key} type="button" className="menu-item"
                  onClick={() => { setSetting('pieceSet', key); setOpen(false); }}
                >
                  <span>{PIECE_SETS[key].label}</span>
                  <Check on={settings.pieceSet === key} />
                </button>
              ))}
              <hr className="menu-hr" />
            </>
          )}

          {sections.includes('accent') && (
            <>
              <div className="menu-section">UI Accent</div>
              <div className="swatch-row">
                {ACCENT_SWATCHES.map(({ value, color }) => (
                  <button
                    key={value} type="button" title={value}
                    className={`swatch ${settings.accent === value ? 'sel' : ''}`}
                    style={{ background: color }}
                    onClick={() => setSetting('accent', value)}
                  />
                ))}
              </div>
            </>
          )}

          {sections.includes('toggles') && (
            <>
              <hr className="menu-hr" />
              <div className="menu-section">Trainer</div>
              <button type="button" className="menu-item" onClick={() => setSetting('arrows', !settings.arrows)}>
                <span>Training arrows</span>
                <Check on={settings.arrows} />
              </button>
              <button type="button" className="menu-item" onClick={() => setSetting('coords', !settings.coords)}>
                <span>Coordinates</span>
                <Check on={settings.coords} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
