import type { GameState } from './types';
import { createInitialState, executeMove } from './logic';
import { parseFen } from './fen';
import { resolveSan } from './san';
import type { PgnGame } from './pgn';

export function replayPgnGame(
  game: PgnGame,
  options?: { lenient?: boolean }
): { state: GameState; errors: string[] } {
  const errors: string[] = [];

  let state: GameState;
  if (game.tags.SetUp === '1' && game.tags.FEN) {
    const parsed = parseFen(game.tags.FEN);
    if (!parsed) {
      return { state: createInitialState(), errors: [`Invalid FEN in game: ${game.tags.FEN}`] };
    }
    state = parsed;
  } else {
    state = createInitialState();
  }

  for (let i = 0; i < game.moves.length; i++) {
    const node = game.moves[i];
    const resolved = resolveSan(state, node.san);
    if (!resolved) {
      errors.push(`Move ${i + 1}: could not resolve '${node.san}'`);
      if (!options?.lenient) break;
      continue;
    }
    state = executeMove(state, resolved.from, resolved.to, resolved.promotionPiece);
  }

  return { state, errors };
}
