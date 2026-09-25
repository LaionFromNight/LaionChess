// ── Shared arrow palette ─────────────────────────────────────────────────────
// One modern, saturated palette for every arrow on the board (hints, book,
// engine, user drawings). Arrows are painted opaque and the whole arrow gets a
// single group opacity, so the shaft and head never double up where they meet.

export const ARROW = {
  green: 'rgba(38, 208, 140, 0.9)',   // primary hint / best move
  gold: 'rgba(255, 184, 48, 0.92)',   // reveal / second choice
  violet: 'rgba(160, 128, 255, 0.85)',
  red: 'rgba(255, 84, 104, 0.9)',
  blue: 'rgba(64, 156, 255, 0.9)',
  coral: 'rgba(255, 122, 89, 0.82)',
  sky: 'rgba(90, 200, 250, 0.9)',     // hover preview
  engine: 'rgba(56, 148, 255, 0.9)',  // every engine line — rank shown by a number
  book: 'rgba(255, 150, 50, 0.5)',    // Lichess book moves — lighter, see-through
} as const;

export interface ParsedColor { rgb: string; alpha: number }

/** Split an rgb/rgba/hex colour into an opaque rgb() and its alpha. */
export function parseColor(color: string): ParsedColor {
  const m = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (m) {
    return { rgb: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, alpha: m[4] !== undefined ? Number(m[4]) : 1 };
  }
  return { rgb: color, alpha: 1 };
}

/** Mix an rgb() colour towards white (amount 0..1) — used for the arrow highlight. */
export function lighten(rgb: string, amount: number): string {
  const m = rgb.match(/rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/i);
  if (!m) return rgb;
  const mix = (v: string) => Math.round(Number(v) + (255 - Number(v)) * amount);
  return `rgb(${mix(m[1])}, ${mix(m[2])}, ${mix(m[3])})`;
}
