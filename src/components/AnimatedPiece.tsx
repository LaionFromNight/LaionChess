import { useEffect, useRef } from 'react';
import type { Piece, Position } from '../chess/types';
import { getPieceLabel } from '../chess/logic';
import { useSettings } from '../settings/useSettings';
import { pieceSrc, pieceCode } from '../board/pieceSrc';

export type AnimPiece = { piece: Piece; from: Position; to: Position };

export default function AnimatedPiece({ anim, boardSize, onDone }: {
  anim: AnimPiece; boardSize: number; onDone: () => void;
}) {
  const { settings } = useSettings();
  const divRef = useRef<HTMLDivElement>(null);
  const squarePx = boardSize / 8;
  const initDX = (anim.from.col - anim.to.col) * squarePx;
  const initDY = (anim.from.row - anim.to.row) * squarePx;

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = divRef.current;
        if (!el) return;
        el.style.transition = 'transform 0.3s cubic-bezier(0, 0, 0.2, 1)';
        el.style.transform = 'translate(0px, 0px)';
      });
    });
    const timer = setTimeout(onDone, 340);
    return () => { cancelAnimationFrame(id); clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fontSize = Math.round(squarePx * 0.70);
  const isWhite = anim.piece.color === 'white';
  const src = pieceSrc(settings.pieceSet, anim.piece.color, anim.piece.type);

  return (
    <div ref={divRef} style={{
      position: 'absolute',
      left: anim.to.col * squarePx,
      top: anim.to.row * squarePx,
      width: squarePx,
      height: squarePx,
      transform: `translate(${initDX}px, ${initDY}px)`,
      transition: 'none',
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize,
      userSelect: 'none',
    }}>
      {src ? (
        <img src={src} alt={pieceCode(anim.piece.color, anim.piece.type)} draggable={false}
          style={{ width: '92%', height: '92%', display: 'block' }} />
      ) : (
        <span style={{
          lineHeight: 1,
          color: isWhite ? '#ffffff' : '#1a1a1a',
          textShadow: isWhite
            ? '0 0 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.4)'
            : '0 0 3px rgba(255,255,255,0.5)',
          filter: isWhite ? 'drop-shadow(0 0 1px rgba(0,0,0,0.9))' : 'none',
        }}>
          {getPieceLabel(anim.piece)}
        </span>
      )}
    </div>
  );
}
