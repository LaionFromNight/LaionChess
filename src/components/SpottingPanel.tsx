import React from 'react';
import { SpottingMode } from '../chess/analysis';

interface SpottingPanelProps {
  modes: Set<SpottingMode>;
  onChange: (modes: Set<SpottingMode>) => void;
}

const TOP_MODES: Array<{ key: SpottingMode; label: string; icon: string }> = [
  { key: 'dalmacja',  label: 'Dalmacja',  icon: '⬡' },
  { key: 'lufycfer',  label: 'Lucyfer',   icon: '⚡' },
  { key: 'king-path', label: 'King Path', icon: '♔' },
  { key: 'king-shot', label: 'King Shot', icon: '⚔' },
];

const LAION_MODES: Array<{ key: SpottingMode; label: string }> = [
  { key: 'eye-black', label: 'Black'        },
  { key: 'eye-white', label: 'White'        },
  { key: 'eye-1',     label: 'Attack'       },
  { key: 'eye-2',     label: 'Passive'      },
  { key: 'eye-full',  label: 'Full'         },
];

function ModeBtn({
  modeKey, label, icon, active, hovered,
  onEnter, onLeave, onClick,
}: {
  modeKey: SpottingMode; label: string; icon?: string;
  active: boolean; hovered: boolean;
  onEnter: () => void; onLeave: () => void; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        padding: '7px 10px',
        background: active
          ? 'rgba(255,0,64,0.12)'
          : hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        border: `1px solid ${active ? '#ff0040' : '#333'}`,
        borderRadius: '5px',
        cursor: 'pointer',
        color: active ? '#ffffff' : hovered ? '#999' : '#666',
        fontSize: '11px',
        fontFamily: 'monospace',
        textAlign: 'left',
        transition: 'all 0.15s ease',
        boxShadow: active
          ? '0 0 8px rgba(255,0,64,0.3)'
          : hovered ? '0 0 6px rgba(255,255,255,0.06)' : 'none',
        outline: 'none',
      }}
    >
      {icon && <span style={{ fontSize: '13px', lineHeight: 1, flexShrink: 0 }}>{icon}</span>}
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
    </button>
  );
}

export default function SpottingPanel({ modes, onChange }: SpottingPanelProps) {
  const [hovered, setHovered] = React.useState<SpottingMode | null>(null);

  const isStandard = modes.size === 0;

  function toggle(key: SpottingMode) {
    const next = new Set(modes);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  return (
    <div style={{
      width: '148px',
      background: '#0a0a14',
      border: '1px solid #1a1a2e',
      borderRadius: '8px',
      padding: '12px 8px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      alignSelf: 'flex-start',
    }}>
      <div style={{
        fontSize: '10px', fontWeight: 700, letterSpacing: '0.15em',
        color: '#00ffff', textAlign: 'center', marginBottom: '4px', fontFamily: 'monospace',
      }}>
        MODE
      </div>

      {/* Standard — clears all */}
      <ModeBtn
        modeKey="none" label="Standard" icon="◉"
        active={isStandard} hovered={hovered === 'none'}
        onEnter={() => setHovered('none')} onLeave={() => setHovered(null)}
        onClick={() => onChange(new Set())}
      />

      {TOP_MODES.map(({ key, label, icon }) => (
        <ModeBtn key={key} modeKey={key} label={label} icon={icon}
          active={modes.has(key)} hovered={hovered === key}
          onEnter={() => setHovered(key)} onLeave={() => setHovered(null)}
          onClick={() => toggle(key)} />
      ))}

      {/* Laion section */}
      <div style={{
        borderTop: '1px solid #1a1a2e', margin: '4px 0 2px',
        paddingTop: '8px',
        fontSize: '9px', fontWeight: 700, letterSpacing: '0.18em',
        color: '#ff4488', fontFamily: 'monospace', textAlign: 'center',
      }}>
        LAION
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '8px' }}>
        {LAION_MODES.map(({ key, label }) => (
          <ModeBtn key={key} modeKey={key} label={label}
            active={modes.has(key)} hovered={hovered === key}
            onEnter={() => setHovered(key)} onLeave={() => setHovered(null)}
            onClick={() => toggle(key)} />
        ))}
      </div>
    </div>
  );
}
