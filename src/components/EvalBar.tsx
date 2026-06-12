interface EvalBarProps {
  /** White-relative evaluation in pawns (used when mate is null). */
  pawns: number;
  /** White-relative forced mate distance (signed, |N| ≥ 1), or null. */
  mate?: number | null;
  /** Game-over override: who won (or a draw), pins the bar to the result. */
  terminal?: 'white' | 'black' | 'draw' | null;
  /** Bar height in px (matches the board). */
  height?: number;
}

export default function EvalBar({ pawns, mate, terminal, height }: EvalBarProps) {
  let pct: number;        // white's share of the bar height
  let label: string;
  let whiteAhead: boolean;
  let title: string;

  if (terminal === 'white' || terminal === 'black') {
    whiteAhead = terminal === 'white';
    pct = whiteAhead ? 100 : 0;
    label = whiteAhead ? '1-0' : '0-1';
    title = `Checkmate — ${whiteAhead ? 'White' : 'Black'} wins`;
  } else if (terminal === 'draw') {
    whiteAhead = true;
    pct = 50;
    label = '½-½';
    title = 'Draw';
  } else if (mate != null) {
    whiteAhead = mate > 0;
    pct = whiteAhead ? 100 : 0;
    label = `M${Math.abs(mate)}`;
    title = `Forced mate in ${Math.abs(mate)} for ${whiteAhead ? 'White' : 'Black'}`;
  } else {
    whiteAhead = pawns >= 0;
    pct = 50 + Math.max(-48, Math.min(48, pawns * 6));
    label = `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
    title = `Evaluation ${label}`;
  }

  return (
    <div className="eval-bar" title={title} style={height ? { height } : undefined}>
      <div className="white-share" style={{ height: `${pct}%` }} />
      {whiteAhead
        ? <span className="val bottom">{label}</span>
        : <span className="val top">{label}</span>}
    </div>
  );
}
