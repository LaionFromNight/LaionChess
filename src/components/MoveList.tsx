import { useEffect, useRef } from 'react';
import type { Move } from '../chess/types';
import { renderSanForMoveList } from '../chess/san';

interface MoveListProps {
  moves: Move[];
  activeIndex: number;
  onMoveClick: (idx: number) => void;
  boardSize?: number;
}

export default function MoveList({ moves, activeIndex, onMoveClick, boardSize }: MoveListProps) {
  const activeRowRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to keep the active move visible
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  const rows: Array<{ number: number; whiteIdx: number; blackIdx: number }> = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push({ number: Math.floor(i / 2) + 1, whiteIdx: i, blackIdx: i + 1 });
  }

  function cellStyle(idx: number): React.CSSProperties {
    const isActive = idx === activeIndex;
    const exists = idx < moves.length;
    return {
      padding: '3px 6px',
      borderRadius: 3,
      cursor: exists ? 'pointer' : 'default',
      backgroundColor: isActive ? 'rgba(0,255,136,0.15)' : 'transparent',
      color: isActive ? '#00ff88' : idx % 2 === 0 ? '#e0e0e0' : '#00ffff',
      fontWeight: isActive ? 700 : 400,
      transition: 'background 0.15s',
      outline: isActive ? '1px solid rgba(0,255,136,0.4)' : 'none',
      fontSize: 13,
    };
  }

  return (
    <div style={{
      width: 200,
      height: boardSize ? `${boardSize}px` : 'min(80vw, 560px)',
      overflowY: 'auto',
      backgroundColor: '#0d1117',
      border: '1px solid #00ffff20',
      borderRadius: 8,
      fontFamily: "'Segoe UI', monospace",
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #00ffff20',
        color: '#00ffff',
        fontSize: 11,
        letterSpacing: 2,
        textTransform: 'uppercase',
        fontWeight: 700,
        flexShrink: 0,
      }}>
        Moves
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rows.map(({ number, whiteIdx, blackIdx }) => {
          const isActiveRow = whiteIdx === activeIndex || blackIdx === activeIndex;
          return (
            <div
              key={number}
              ref={isActiveRow ? activeRowRef : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 1fr',
                padding: '3px 6px',
                borderBottom: '1px solid #ffffff06',
                alignItems: 'center',
              }}
            >
              <span style={{ color: '#444', fontSize: 11, paddingRight: 4 }}>{number}</span>
              <span
                style={cellStyle(whiteIdx)}
                onClick={() => whiteIdx < moves.length && onMoveClick(whiteIdx)}
              >
                {moves[whiteIdx]?.san ? renderSanForMoveList(moves[whiteIdx].san!, 'w') : ''}
              </span>
              <span
                style={cellStyle(blackIdx)}
                onClick={() => blackIdx < moves.length && onMoveClick(blackIdx)}
              >
                {moves[blackIdx]?.san ? renderSanForMoveList(moves[blackIdx].san!, 'b') : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
