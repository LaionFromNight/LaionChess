// ── Essential endgames ───────────────────────────────────────────────────────
// Every position was checked with Stockfish: "win" / "promote" positions are
// winning for the trainee, "draw" positions are holdable with correct play.

export type EndgameGoal = 'win' | 'promote' | 'draw';

export interface EndgameDef {
  id: string;
  group: 'Basic mates' | 'King & pawn' | 'Rook endgames' | 'Other';
  name: string;
  fen: string;
  you: 'white' | 'black';
  goal: EndgameGoal;
  /** The rule / technique the position teaches. */
  lesson: string;
}

export const ENDGAMES: EndgameDef[] = [
  { id: 'kq-k', group: 'Basic mates', name: 'Queen mate', fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', you: 'white', goal: 'win',
    lesson: 'Use the queen a knight\'s jump away to box the king in, shrink the box, then bring your king. Watch out for stalemate!' },
  { id: 'kr-k', group: 'Basic mates', name: 'Rook mate', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', you: 'white', goal: 'win',
    lesson: 'Cut the king off with the rook, bring your king into opposition, then check along the edge. Waiting rook moves keep the box.' },
  { id: 'rr-k', group: 'Basic mates', name: 'Two-rook ladder', fen: '8/8/8/4k3/8/8/8/R3K2R w - - 0 1', you: 'white', goal: 'win',
    lesson: 'The "lawnmower": the rooks take turns checking and cutting off one rank at a time. Keep them away from the king.' },
  { id: 'kp-key', group: 'King & pawn', name: 'Key squares', fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', you: 'white', goal: 'promote',
    lesson: 'King on the sixth rank in front of the pawn always wins. The squares two ranks ahead of the pawn are the key squares — reach them and the pawn queens.' },
  { id: 'kp-race', group: 'King & pawn', name: 'Reach the key squares', fen: '8/8/4k3/8/3K4/4P3/8/8 w - - 0 1', you: 'white', goal: 'promote',
    lesson: 'King first, pawn later: march your king to a key square (d5, e5, f5) before pushing the pawn.' },
  { id: 'kp-opposition-win', group: 'King & pawn', name: 'Take the opposition', fen: '8/8/8/4k3/8/4K3/4P3/8 b - - 0 1', you: 'white', goal: 'promote',
    lesson: 'Kings facing each other with one square between: the side NOT to move has the opposition. Keep it, and use the spare pawn move e2–e3 when you need a tempo.' },
  { id: 'kp-opposition-draw', group: 'King & pawn', name: 'Hold with the opposition', fen: '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1', you: 'black', goal: 'draw',
    lesson: 'Defender: always answer by taking the opposition in front of the pawn. Retreat straight back, never to the side.' },
  { id: 'kp-defend', group: 'King & pawn', name: 'Defend K+P vs K', fen: '8/8/4k3/8/4P3/4K3/8/8 b - - 0 1', you: 'black', goal: 'draw',
    lesson: 'Stay in front of the pawn and mirror the white king. When the pawn reaches the sixth with check, go to the promotion square.' },
  { id: 'square', group: 'King & pawn', name: 'Rule of the square', fen: '7k/8/8/p7/8/8/8/4K3 w - - 0 1', you: 'white', goal: 'draw',
    lesson: 'Draw a square from the pawn to its promotion rank: if your king can step into it, it catches the pawn. Walk diagonally — it counts as fast as straight.' },
  { id: 'rook-pawn', group: 'King & pawn', name: 'Rook-pawn fortress', fen: 'k7/8/1K6/P7/8/8/8/8 b - - 0 1', you: 'black', goal: 'draw',
    lesson: 'A rook pawn can\'t win if the defending king reaches the corner: shuttle between a8 and b8 (or b7) and never leave it.' },
  { id: 'outside-passer', group: 'King & pawn', name: 'Outside passed pawn', fen: '8/pp3k2/8/8/8/8/PP3K1P/8 w - - 0 1', you: 'white', goal: 'promote',
    lesson: 'Create a passed pawn far from the kings (the h-pawn). It drags the enemy king away while your king eats the queenside.' },
  { id: 'lucena', group: 'Rook endgames', name: 'Lucena — build a bridge', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', you: 'white', goal: 'promote',
    lesson: 'Check the king away (Rd1+), then put the rook on the fourth rank (Rd4) to block the checks with it — "building a bridge".' },
  { id: 'philidor', group: 'Rook endgames', name: 'Philidor — third-rank defence', fen: '3k4/8/7r/3PK3/8/8/R7/8 b - - 0 1', you: 'black', goal: 'draw',
    lesson: 'Keep your rook on the sixth rank so the king can\'t come forward. Once the pawn advances to the sixth, check from behind forever.' },
  { id: 'q-vs-p', group: 'Other', name: 'Queen vs pawn on the 7th', fen: 'K7/8/8/8/8/8/3pk3/7Q w - - 0 1', you: 'white', goal: 'win',
    lesson: 'Check or pin to force the king in front of its pawn, gain a tempo each time, and bring your own king closer.' },
];
