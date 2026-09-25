import { useEffect, useRef } from 'react';
import type { Piece, Position } from '../chess/types';
import { getPieceLabel } from '../chess/logic';
import { useSettings } from '../settings/useSettings';
import { pieceSrc, pieceCode } from '../board/pieceSrc';

export type AnimPiece = { piece: Piece; from: Position; to: Position };

/**
 * Slides a piece from `from` to `to`. Rendered inside the board's rotating
 * layer, so geometry is in logical squares; `flipped` only keeps the glyph upright.
 */
export default function AnimatedPiece({ anim, boardSize, flipped, onDone }: {
  anim: AnimPiece; boardSize: number; flipped?: boolean; onDone: () => void;
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
        el.style.transition = 'transform 0.22s cubic-bezier(0.2, 0, 0.2, 1)';
        el.style.transform = 'translate(0px, 0px)';
      });
    });
    const timer = setTimeout(onDone, 250);
    return () => { cancelAnimationFrame(id); clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      fontSize: Math.round(squarePx * 0.72),
      userSelect: 'none',
    }}>
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: flipped ? 'rotate(180deg)' : undefined }}>
        {src ? (
          <img className="lc-piece-img" src={src} alt={pieceCode(anim.piece.color, anim.piece.type)} draggable={false} />
        ) : (
          <span className={`glyph ${anim.piece.color}`}>{getPieceLabel(anim.piece)}</span>
        )}
      </div>
    </div>
  );
}
