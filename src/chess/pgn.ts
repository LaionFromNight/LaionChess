export type PgnResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface PgnEmbeddedCommand { name: string; value: string; raw: string; }
export interface PgnComment { text: string; commands: PgnEmbeddedCommand[]; raw: string; }
export interface PgnVariation { moves: PgnMoveNode[]; raw?: string; }
export interface PgnMoveNode {
  moveNumber?: number;
  color?: 'w' | 'b';
  san: string;
  nags: number[];
  commentsBefore: PgnComment[];
  commentsAfter: PgnComment[];
  variations: PgnVariation[];
  raw?: string;
}
export interface PgnGame { tags: Record<string, string>; moves: PgnMoveNode[]; result: PgnResult; raw?: string; }
export interface PgnDatabase { games: PgnGame[]; }
export interface PgnMoveTableRow {
  moveNumber: number;
  white?: PgnMoveNode;
  black?: PgnMoveNode;
  whiteDisplay?: string;
  blackDisplay?: string;
}
export interface ParsePgnOptions { strict?: boolean; normalizeAnnotations?: boolean; }
export interface ExportPgnOptions { lineWidth?: number; }
export interface PgnValidationResult { valid: boolean; errors: Array<{code: string; message: string}>; warnings: Array<{code: string; message: string}>; }

// Import GameState type only for gameStateToPgnGame
import type { GameState } from './types';

// Token types
type Token =
  | { type: 'tag'; name: string; value: string }
  | { type: 'comment'; text: string; commands: PgnEmbeddedCommand[]; raw: string }
  | { type: 'move_number'; number: number; dots: number }
  | { type: 'san'; san: string }
  | { type: 'nag'; value: number }
  | { type: 'var_open' }
  | { type: 'var_close' }
  | { type: 'result'; value: PgnResult };

function parseEmbeddedCommands(text: string): PgnEmbeddedCommand[] {
  const commands: PgnEmbeddedCommand[] = [];
  const re = /\[%(\w+)\s+([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    commands.push({ name: m[1], value: m[2].trim(), raw: m[0] });
  }
  return commands;
}

function tokenize(input: string, normalizeAnnotations = false): Token[] {
  const s = input.replace(/\r\n?/g, '\n');
  const tokens: Token[] = [];
  let i = 0;
  const n = s.length;

  const SYMBOL_TO_NAG: Record<string, number> = { '!!': 3, '??': 4, '!?': 5, '?!': 6, '!': 1, '?': 2 };

  while (i < n) {
    const ch = s[i];
    if (ch <= ' ') { i++; continue; }

    // Tag pair
    if (ch === '[') {
      const tagMatch = /^\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"\\])*)"\s*\]/.exec(s.slice(i));
      if (tagMatch) {
        const value = tagMatch[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        tokens.push({ type: 'tag', name: tagMatch[1], value });
        i += tagMatch[0].length;
        continue;
      }
      i++; continue;
    }

    // Brace comment
    if (ch === '{') {
      const end = s.indexOf('}', i + 1);
      const raw = end === -1 ? s.slice(i) : s.slice(i, end + 1);
      const inner = end === -1 ? s.slice(i + 1) : s.slice(i + 1, end);
      const commands = parseEmbeddedCommands(inner);
      const text = inner.replace(/\[%\w+[^\]]*\]/g, '').trim();
      tokens.push({ type: 'comment', text, commands, raw });
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Semicolon comment
    if (ch === ';') {
      const end = s.indexOf('\n', i + 1);
      const text = end === -1 ? s.slice(i + 1) : s.slice(i + 1, end);
      tokens.push({ type: 'comment', text: text.trim(), commands: [], raw: ';' + text });
      i = end === -1 ? n : end + 1;
      continue;
    }

    if (ch === '(') { tokens.push({ type: 'var_open' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'var_close' }); i++; continue; }

    // NAG $N
    if (ch === '$') {
      const m = /^\$(\d+)/.exec(s.slice(i));
      if (m) { tokens.push({ type: 'nag', value: parseInt(m[1], 10) }); i += m[0].length; continue; }
      i++; continue;
    }

    // Result markers (check before other patterns)
    const resultMatch = /^(1-0|0-1|1\/2-1\/2|\*)/.exec(s.slice(i));
    if (resultMatch) {
      tokens.push({ type: 'result', value: resultMatch[1] as PgnResult });
      i += resultMatch[0].length;
      continue;
    }

    // Move number N. or N...
    const moveNumMatch = /^(\d+)(\.{1,3})/.exec(s.slice(i));
    if (moveNumMatch) {
      tokens.push({ type: 'move_number', number: parseInt(moveNumMatch[1], 10), dots: moveNumMatch[2].length });
      i += moveNumMatch[0].length;
      continue;
    }

    // Castling (before SAN to avoid partial match)
    const castleMatch = /^(O-O-O|O-O|0-0-0|0-0)([+#])?([!?]*)/.exec(s.slice(i));
    if (castleMatch) {
      const annot = castleMatch[3];
      const san = (castleMatch[1] === '0-0-0' ? 'O-O-O' : castleMatch[1] === '0-0' ? 'O-O' : castleMatch[1]) + (castleMatch[2] || '') + (normalizeAnnotations ? '' : annot);
      tokens.push({ type: 'san', san });
      if (normalizeAnnotations && annot && SYMBOL_TO_NAG[annot]) tokens.push({ type: 'nag', value: SYMBOL_TO_NAG[annot] });
      i += castleMatch[0].length;
      continue;
    }

    // SAN
    const sanMatch = /^([PNBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQK])?)([+#])?([!?]*)/.exec(s.slice(i));
    if (sanMatch && sanMatch[1].length >= 2) {
      const annot = sanMatch[3];
      const san = sanMatch[1] + (sanMatch[2] || '') + (normalizeAnnotations ? '' : annot);
      tokens.push({ type: 'san', san });
      if (normalizeAnnotations && annot && SYMBOL_TO_NAG[annot]) tokens.push({ type: 'nag', value: SYMBOL_TO_NAG[annot] });
      i += sanMatch[0].length;
      continue;
    }

    i++;
  }
  return tokens;
}

function buildMoveTree(tokens: Token[], start: number): { moves: PgnMoveNode[]; end: number; result?: PgnResult } {
  const moves: PgnMoveNode[] = [];
  let i = start;
  let lastNode: PgnMoveNode | null = null;
  let pendingComments: PgnComment[] = [];
  let currentMoveNumber = 1;
  let currentColor: 'w' | 'b' = 'w';
  let result: PgnResult | undefined;

  while (i < tokens.length) {
    const tok = tokens[i];

    if (tok.type === 'var_close') { return { moves, end: i, result }; }
    if (tok.type === 'result') { result = tok.value; i++; return { moves, end: i, result }; }

    if (tok.type === 'tag') { i++; continue; }

    if (tok.type === 'comment') {
      const comment = { text: tok.text, commands: tok.commands, raw: tok.raw };
      if (lastNode === null) pendingComments.push(comment);
      else lastNode.commentsAfter.push(comment);
      i++; continue;
    }

    if (tok.type === 'nag') {
      if (lastNode) lastNode.nags.push(tok.value);
      i++; continue;
    }

    if (tok.type === 'move_number') {
      currentMoveNumber = tok.number;
      currentColor = tok.dots >= 3 ? 'b' : 'w';
      i++; continue;
    }

    if (tok.type === 'san') {
      const node: PgnMoveNode = {
        moveNumber: currentMoveNumber,
        color: currentColor,
        san: tok.san,
        nags: [],
        commentsBefore: pendingComments,
        commentsAfter: [],
        variations: [],
      };
      pendingComments = [];
      moves.push(node);
      lastNode = node;
      currentColor = currentColor === 'w' ? 'b' : 'w';
      if (currentColor === 'w') currentMoveNumber++;
      i++; continue;
    }

    if (tok.type === 'var_open') {
      if (lastNode) {
        const sub = buildMoveTree(tokens, i + 1);
        lastNode.variations.push({ moves: sub.moves });
        i = sub.end + 1;
      } else {
        i++;
      }
      continue;
    }

    i++;
  }
  return { moves, end: i, result };
}

export function parsePgn(input: string, options?: ParsePgnOptions): PgnDatabase {
  const tokens = tokenize(input, options?.normalizeAnnotations);
  const games: PgnGame[] = [];

  let i = 0;
  while (i < tokens.length) {
    // Collect tags
    const tags: Record<string, string> = {};
    while (i < tokens.length && tokens[i].type === 'tag') {
      const t = tokens[i] as { type: 'tag'; name: string; value: string };
      tags[t.name] = t.value;
      i++;
    }

    // Skip if no tags and no moves (end of input or blank)
    if (i >= tokens.length) break;

    // Build movetext
    const { moves, end, result } = buildMoveTree(tokens, i);
    i = end;

    if (moves.length > 0 || Object.keys(tags).length > 0) {
      games.push({
        tags,
        moves,
        result: result ?? (tags.Result as PgnResult) ?? '*',
      });
    }
  }

  return { games };
}

export function parseSinglePgnGame(input: string, options?: ParsePgnOptions): PgnGame {
  const db = parsePgn(input, options);
  return db.games[0] ?? { tags: {}, moves: [], result: '*' };
}

const SEVEN_TAG_ROSTER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
const SEVEN_TAG_DEFAULTS: Record<string, string> = {
  Event: '?', Site: '?', Date: '????.??.??', Round: '?', White: '?', Black: '?', Result: '*',
};

function escapeTagValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function exportPgn(game: PgnGame, options?: ExportPgnOptions): string {
  const lineWidth = options?.lineWidth ?? 80;
  const lines: string[] = [];

  // Seven Tag Roster
  for (const tag of SEVEN_TAG_ROSTER) {
    const value = game.tags[tag] ?? SEVEN_TAG_DEFAULTS[tag];
    lines.push(`[${tag} "${escapeTagValue(value)}"]`);
  }

  // Extra tags
  for (const [k, v] of Object.entries(game.tags)) {
    if (!SEVEN_TAG_ROSTER.includes(k)) {
      lines.push(`[${k} "${escapeTagValue(v)}"]`);
    }
  }

  lines.push('');

  // Movetext
  const tokens: string[] = [];

  function emitComments(comments: PgnComment[]) {
    for (const c of comments) {
      const inner = c.commands.length > 0
        ? (c.text ? c.text + ' ' : '') + c.commands.map(cmd => cmd.raw).join(' ')
        : c.text;
      tokens.push(`{${inner.trim()}}`);
    }
  }

  function emitMoves(moves: PgnMoveNode[], forceNumber = false) {
    let forceMoveNum = forceNumber;
    for (const node of moves) {
      emitComments(node.commentsBefore);

      if (node.color === 'w' || forceMoveNum) {
        tokens.push(`${node.moveNumber ?? ''}.${node.color === 'b' ? '..' : ''}`);
        forceMoveNum = false;
      }
      tokens.push(node.san);

      for (const nag of node.nags) tokens.push(`$${nag}`);

      emitComments(node.commentsAfter);

      for (const variation of node.variations) {
        tokens.push('(');
        emitMoves(variation.moves, true);
        tokens.push(')');
      }
    }
  }

  emitMoves(game.moves);
  tokens.push(game.result);

  // Wrap to lineWidth
  let line = '';
  for (const tok of tokens) {
    if (line.length + tok.length + 1 > lineWidth && line.length > 0) {
      lines.push(line.trimEnd());
      line = tok + ' ';
    } else {
      line += tok + ' ';
    }
  }
  if (line.trim()) lines.push(line.trimEnd());

  return lines.join('\n') + '\n';
}

export function gameStateToPgnGame(state: GameState, tags?: Record<string, string>): PgnGame {
  let result: PgnResult = '*';
  if (state.isCheckmate) result = state.currentTurn === 'white' ? '0-1' : '1-0';
  else if (state.isStalemate) result = '1/2-1/2';

  const moves: PgnMoveNode[] = state.moveHistory.map((move, i) => ({
    moveNumber: Math.ceil((i + 1) / 2),
    color: i % 2 === 0 ? 'w' : 'b',
    san: move.san ?? '',
    nags: [],
    commentsBefore: [],
    commentsAfter: [],
    variations: [],
  }));

  return {
    tags: {
      Event: '?', Site: '?', Date: '????.??.??', Round: '?',
      White: '?', Black: '?', Result: result,
      ...tags,
    },
    moves,
    result,
  };
}

export function buildMoveTableRows(moves: PgnMoveNode[]): PgnMoveTableRow[] {
  const rows: PgnMoveTableRow[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const white = moves[i];
    const black = moves[i + 1];
    rows.push({
      moveNumber: white?.moveNumber ?? Math.ceil((i + 1) / 2),
      white,
      black,
      whiteDisplay: white?.san,
      blackDisplay: black?.san,
    });
  }
  return rows;
}

export function validatePgn(input: string, _options?: ParsePgnOptions): PgnValidationResult {
  const errors: Array<{code: string; message: string}> = [];
  const warnings: Array<{code: string; message: string}> = [];

  const db = parsePgn(input);
  if (db.games.length === 0) {
    errors.push({ code: 'NO_GAMES', message: 'No games found' });
  }

  // Check balanced parentheses
  let depth = 0;
  for (const ch of input) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth < 0) { errors.push({ code: 'UNBALANCED_PARENS', message: 'Unbalanced parentheses' }); break; }
  }
  if (depth !== 0) errors.push({ code: 'UNBALANCED_PARENS', message: 'Unclosed parentheses' });

  return { valid: errors.length === 0, errors, warnings };
}
