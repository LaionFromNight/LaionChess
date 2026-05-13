import { useState } from 'react';
import type { PieceColor, PieceType } from '../chess/types';
import { getPieceLabel } from '../chess/logic';

const PROMO_PIECES: PieceType[] = ['queen', 'rook', 'bishop', 'knight'];

export interface PromotionPickerProps {
  color: PieceColor;
  col: number;
  isWhitePromotion: boolean;
  squarePx: number;
  onSelect: (piece: PieceType) => void;
  onCancel: () => void;
}

function PickerCell({
  pieceType, color, squarePx, isTop, isBottom, onClick,
}: {
  pieceType: PieceType;
  color: PieceColor;
  squarePx: number;
  isTop: boolean;
  isBottom: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isWhite = color === 'white';
  const label = getPieceLabel({ type: pieceType, color });

  const borderRadius =
    `${isTop ? 6 : 0}px ${isTop ? 6 : 0}px ${isBottom ? 6 : 0}px ${isBottom ? 6 : 0}px`;

  return (
    <div
      role="button"
      aria-label={`Promote to ${pieceType}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: squarePx,
        height: squarePx,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(squarePx * 0.70),
        cursor: 'pointer',
        backgroundColor: hovered ? '#2a4a6a' : '#152030',
        borderRadius,
        border: '1px solid #3a5a7a',
        boxSizing: 'border-box',
        transition: 'background-color 0.12s',
        userSelect: 'none',
      }}
    >
      <span style={{
        lineHeight: 1,
        color: isWhite ? '#ffffff' : '#1a1a1a',
        textShadow: isWhite
          ? '0 0 3px rgba(0,0,0,0.8), 0 0 6px rgba(0,0,0,0.4)'
          : '0 0 3px rgba(255,255,255,0.5)',
        filter: isWhite ? 'drop-shadow(0 0 1px rgba(0,0,0,0.9))' : 'none',
      }}>
        {label}
      </span>
    </div>
  );
}

export default function PromotionPicker({
  color, col, isWhitePromotion, squarePx, onSelect, onCancel,
}: PromotionPickerProps) {
  const pieces = isWhitePromotion ? PROMO_PIECES : [...PROMO_PIECES].reverse();
  const topOffset = isWhitePromotion ? 0 : (8 - 4) * squarePx;

  return (
    <>
      <div
        onClick={onCancel}
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.45)',
          zIndex: 40,
          cursor: 'default',
        }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: col * squarePx,
          top: topOffset,
          width: squarePx,
          zIndex: 41,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 4px 24px rgba(0,0,0,0.8), 0 0 0 2px #3a5a7a',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        {pieces.map((type, i) => (
          <PickerCell
            key={type}
            pieceType={type}
            color={color}
            squarePx={squarePx}
            isTop={i === 0}
            isBottom={i === pieces.length - 1}
            onClick={() => onSelect(type)}
          />
        ))}
      </div>
    </>
  );
}
