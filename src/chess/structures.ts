// ── Pawn-structure recognition → middlegame plan ─────────────────────────────
// The pawn structure decides the plans (see Flores Rios, "Chess Structures").
// We recognise the classic structures that the courses lead into and add
// concrete, position-specific hints from the pattern helpers.
import type { Board, PieceColor, Position } from './types';
import { pawnStructure, outposts, fileKinds } from './patterns';

export interface PlanCard {
  structure: string;
  summary: string;
  you: string[];
  opponent: string[];
  /** Concrete hints for this exact position (targets, outposts, files). */
  hints: string[];
}

type Side = 'white' | 'black';
const sq = (p: Position) => `${'abcdefgh'[p.col]}${8 - p.row}`;

function pawnSet(board: Board, color: PieceColor): Set<string> {
  const s = new Set<string>();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (p?.type === 'pawn' && p.color === color) s.add(sq({ row: r, col: c }));
  }
  return s;
}
const onFile = (set: Set<string>, f: string) => [...set].some(s => s[0] === f);

interface Template { structure: string; summary: string; white: string[]; black: string[] }

const T: Record<string, Template> = {
  iqpWhite: {
    structure: 'Isolated queen\'s pawn (White)', summary: 'White has an isolated d-pawn: dynamic piece play vs. a long-term weakness.',
    white: ['Keep pieces on — the IQP gives space and outposts on e5 and c5.', 'Attack on the kingside: Bd3/Qd3 battery, Ne5, rook lift Re1–e3–g3.', 'Break with d4–d5 when your pieces are ready.'],
    black: ['Blockade d5 with a knight — the ideal blockader.', 'Trade minor pieces: every trade makes the d4-pawn weaker.', 'Pile up on d4 with ...Rd8, ...Nc6, ...Bf6 and win it in the endgame.'],
  },
  iqpBlack: {
    structure: 'Isolated queen\'s pawn (Black)', summary: 'Black has an isolated d-pawn: activity now, weakness later.',
    white: ['Blockade d4 with a knight.', 'Trade pieces, especially the light-squared bishops.', 'Attack d5 with Rd1, Nf4/Nc3, Bf3 and win it in the endgame.'],
    black: ['Stay active: outposts on e4 and c4, pressure on the half-open files.', 'Look for a kingside attack before the position simplifies.', 'The ...d5–d4 break frees the position when it works tactically.'],
  },
  carlsbad: {
    structure: 'Carlsbad (QGD Exchange)', summary: 'White d4 vs. Black d5/c6 with the c- and e-files half-open.',
    white: ['Minority attack: Rb1, b4–b5 to create a weak c6-pawn.', 'Alternatively castle long and push on the kingside, or play f3 and e4.', 'Put a knight on e5 and keep the dark-squared bishop active.'],
    black: ['Counter on the kingside: ...Ne4, ...f5 or a piece attack towards g2.', 'Meet b4–b5 with ...cxb5 or ...c5 at the right moment.', 'Use the e4-outpost and the half-open e-file.'],
  },
  french: {
    structure: 'French advance chain', summary: 'White e5/d4 vs. Black e6/d5: the pawn chains point at opposite wings.',
    white: ['Hold the d4 base; space on the kingside is your trump.', 'Attack the king: Bd3, Qg4/Qh5, f4–f5 ideas.', 'Keep a knight on d4 if the pawn is traded.'],
    black: ['Hit the base of the chain: ...c5 and ...Qb6 against d4.', 'Then ...f6 to break the head of the chain.', 'Your bad light-squared bishop: trade it (...Bd7–b5) or free it.'],
  },
  kidClosed: {
    structure: 'Closed King\'s Indian centre', summary: 'White d5/e4 vs. Black d6/e5: a race on opposite wings.',
    white: ['Play on the queenside: c4–c5, b4, Nd2–c4 and a breakthrough on c7.', 'Keep your king\'s pawn cover intact against ...f5–f4–g5.', 'Close the kingside with f3 and g4 if needed.'],
    black: ['Attack the king: ...Ne8/...Nd7, ...f5, ...f4, ...g5–g4.', 'Don\'t worry about the queenside — speed on the kingside decides.', 'Your dark-squared bishop may look passive but defends the king.'],
  },
  maroczy: {
    structure: 'Maróczy Bind', summary: 'White pawns on c4 and e4 clamp d5 against a Sicilian set-up.',
    white: ['Keep the bind: prevent ...b5 and ...d5 breaks.', 'Slowly expand with f3/f4 and b3; Nd5 when it can\'t be exchanged well.', 'Trade Black\'s dark-squared bishop if you can.'],
    black: ['Trade pieces — the bind hurts less with fewer pieces.', 'Play ...a5 and ...Nd7–c5, pressure c4 and e4.', 'Prepare ...b5 or ...f5 as the freeing break.'],
  },
  openSicilian: {
    structure: 'Open Sicilian', summary: 'White e4 without a d-pawn vs. Black\'s c-pawn gone: opposite-wing play.',
    white: ['Use your space and lead in development: f4/f3, g4, a kingside pawn storm.', 'Use the d5-square — jump in with a knight.', 'Castle long for a sharp race, or short for positional pressure.'],
    black: ['Counter on the half-open c-file: ...Rc8, ...b5–b4.', 'The ...d5 break equalises when it works.', 'Your central pawn majority is a long-term trump in the endgame.'],
  },
  openCentre: {
    structure: 'Open centre', summary: 'No central pawns: piece activity and open files decide.',
    white: ['Develop fast and put rooks on the open files.', 'Look for tactics — open positions punish loose pieces.', 'Centralise the king early if queens come off.'],
    black: ['Same rules: rooks to open files, active minor pieces.', 'Watch your back rank and loose pieces.', 'Trade the opponent\'s most active piece.'],
  },
  generic: {
    structure: 'Classical middlegame', summary: 'No single dominant structure — follow the general principles.',
    white: ['Finish development and castle; connect the rooks.', 'Improve your worst piece before starting action.', 'Prepare a pawn break (d4, f4 or c4) to open lines for your pieces.'],
    black: ['Finish development and castle; connect the rooks.', 'Improve your worst piece before starting action.', 'Prepare a pawn break (...d5, ...f5 or ...c5) to open lines for your pieces.'],
  },
};

export function detectPlan(board: Board, you: Side): PlanCard {
  const w = pawnSet(board, 'white'), b = pawnSet(board, 'black');
  let t: Template;
  if (onFile(w, 'd') && !onFile(w, 'c') && !onFile(w, 'e') && !(onFile(b, 'd') && !onFile(b, 'c') && !onFile(b, 'e'))) t = T.iqpWhite;
  else if (onFile(b, 'd') && !onFile(b, 'c') && !onFile(b, 'e') && !onFile(w, 'd')) t = T.iqpBlack;
  else if (w.has('d4') && !onFile(w, 'c') && b.has('d5') && b.has('c6') && !onFile(b, 'e')) t = T.carlsbad;
  else if (w.has('e5') && w.has('d4') && b.has('e6') && b.has('d5')) t = T.french;
  else if (w.has('d5') && w.has('e4') && b.has('d6') && b.has('e5')) t = T.kidClosed;
  else if (w.has('c4') && w.has('e4') && !onFile(w, 'd') && !onFile(b, 'c')) t = T.maroczy;
  else if (w.has('e4') && !onFile(w, 'd') && !onFile(b, 'c') && (b.has('d6') || b.has('e6'))) t = T.openSicilian;
  else if (!onFile(w, 'd') && !onFile(w, 'e') && !onFile(b, 'd') && !onFile(b, 'e')) t = T.openCentre;
  else t = T.generic;

  const opp: Side = you === 'white' ? 'black' : 'white';
  const hints: string[] = [];
  for (const p of pawnStructure(board)) {
    const mine = p.color === you;
    if (p.flags.includes('passed')) hints.push(mine ? `Push or support your passed pawn on ${sq(p.pos)}.` : `Blockade the passed pawn on ${sq(p.pos)}.`);
    else if (!mine && (p.flags.includes('isolated') || p.flags.includes('backward'))) hints.push(`Target: the ${p.flags.includes('isolated') ? 'isolated' : 'backward'} pawn on ${sq(p.pos)}.`);
  }
  const outs = outposts(board).filter(o => o.color === you);
  if (outs.length) hints.push(`Outpost${outs.length > 1 ? 's' : ''} for your knight: ${outs.slice(0, 3).map(o => sq(o.pos)).join(', ')}.`);
  const files = fileKinds(board).filter(f => f.kind === 'open' || f.kind === (you === 'white' ? 'half-white' : 'half-black'));
  if (files.length) hints.push(`Rooks belong on the ${files.map(f => 'abcdefgh'[f.col]).join(', ')}-file${files.length > 1 ? 's' : ''}.`);

  return { structure: t.structure, summary: t.summary, you: t[you], opponent: t[opp], hints: hints.slice(0, 4) };
}
